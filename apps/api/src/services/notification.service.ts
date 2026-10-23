/**
 * Creating notifications. Every module calls `notify` inside its transaction with its
 * Effects buffer; the socket push and the unread badge update go out after commit.
 *
 * Rules applied here so callers cannot forget them:
 *   - never notify yourself
 *   - never notify across a block
 *   - collapse duplicates: the same (recipient, actor, type, entity) within an hour
 *     updates the existing row instead of stacking a new one (reaction toggling)
 *   - respect the recipient's settings for that community (posts ALL / HIGHLIGHTS /
 *     OFF, events on or off; see domain/notification-prefs.ts)
 */
import type { Notification, NotificationType } from "@open-social/types";
import { sql } from "kysely";
import type { Effects } from "../core/effects";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { isCommunityControlled, readCommunityNotificationSettings, silencedBy } from "../domain/notification-prefs";
import { loadSummaries } from "../presenters/user.presenter";
import { realtime, rooms } from "../realtime/port";
import { isBlockedEitherWay } from "../repositories/visibility";
// Inbox reads (added by the social module). The presenter imports hrefFor from this
// file; the cycle is safe because both sides only call each other at run time.
import type { Actor } from "../core/context";
import { notFound } from "../core/errors";
import { presentNotifications } from "../presenters/notification.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { notificationRepo } from "../repositories/notification.repository";

export interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  entityType: string;
  entityId: string;
  communityId?: string | null;
  snippet?: string | null;
  /** Free-form extras for building the link (postId for a comment, slug, threadId...). */
  data?: Record<string, unknown>;
}

/** Where a notification should take the user, from its type and data. */
export function hrefFor(n: { type: NotificationType; entity_type: string; entity_id: string; data: unknown }): string {
  const d = (n.data ?? {}) as Record<string, string | undefined>;
  switch (n.type) {
    case "POST_COMMENT":
    case "COMMENT_REPLY":
    case "COMMENT_REACTION":
      return `/posts/${d.postId ?? n.entity_id}${d.commentId ? `?comment=${d.commentId}` : ""}`;
    case "POST_REACTION":
      return `/posts/${n.entity_id}`;
    case "MENTION":
      return n.entity_type === "comment" ? `/posts/${d.postId}?comment=${n.entity_id}` : `/posts/${n.entity_id}`;
    case "FOLLOW":
      return `/u/${d.username ?? ""}`;
    case "JOIN_REQUEST":
      return `/c/${d.slug ?? ""}/members?tab=requests`;
    case "MEMBERSHIP_APPROVED":
    case "COMMUNITY_INVITE":
      return `/c/${d.slug ?? ""}`;
    case "DM_REQUEST":
      return `/messages/${n.entity_id}`;
    case "EVENT_UPDATED":
    case "EVENT_CANCELLED":
    case "EVENT_PROMOTED":
    case "EVENT_REMINDER":
      return `/events/${n.entity_id}`;
    case "ANSWER_POSTED":
    case "ANSWER_ACCEPTED":
      return `/questions/${d.questionId ?? n.entity_id}`;
    case "MODERATION_ACTION":
    case "APPEAL_DECIDED":
      return `/account/moderation/${d.caseId ?? ""}`;
    default:
      return "/notifications";
  }
}

export async function notify(input: NotifyInput, fx: Effects, exec: Executor = db): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;
  if (input.actorId && (await isBlockedEitherWay(input.actorId, input.recipientId, exec))) return;
  if (input.communityId && isCommunityControlled(input.type)) {
    const m = await exec.selectFrom("community_members").select("notification_settings").where("community_id", "=", input.communityId).where("user_id", "=", input.recipientId).executeTakeFirst();
    if (m && silencedBy(input.type, readCommunityNotificationSettings(m.notification_settings))) return;
  }

  const snippet = input.snippet ? input.snippet.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  const data = JSON.stringify(input.data ?? {});

  const recent = await exec
    .selectFrom("notifications")
    .select("id")
    .where("recipient_id", "=", input.recipientId)
    .where("type", "=", input.type)
    .where("entity_id", "=", input.entityId)
    .where((eb) => (input.actorId ? eb("actor_id", "=", input.actorId) : eb("actor_id", "is", null)))
    .where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirst();

  const row = recent
    ? await exec.updateTable("notifications").set({ read_at: null, snippet, data, created_at: new Date() }).where("id", "=", recent.id).returningAll().executeTakeFirstOrThrow()
    : await exec
        .insertInto("notifications")
        .values({
          id: newId(),
          recipient_id: input.recipientId,
          actor_id: input.actorId,
          type: input.type,
          entity_type: input.entityType,
          entity_id: input.entityId,
          community_id: input.communityId ?? null,
          snippet,
          data,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

  fx.after(async () => {
    const actors = await loadSummaries([row.actor_id]);
    const dto: Notification = {
      id: row.id,
      type: row.type,
      actor: row.actor_id ? (actors.get(row.actor_id) ?? null) : null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      communityId: row.community_id,
      snippet: row.snippet,
      href: hrefFor(row),
      readAt: null,
      createdAt: row.created_at.toISOString(),
    };
    const { unread } = await unreadCount(row.recipient_id);
    realtime.emit([rooms.user(row.recipient_id)], "notification:new", dto);
    realtime.emit([rooms.user(row.recipient_id)], "notification:count", { unread });
  });
}

export async function unreadCount(userId: string, exec: Executor = db): Promise<{ unread: number }> {
  const r = await exec
    .selectFrom("notifications")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("recipient_id", "=", userId)
    .where("read_at", "is", null)
    .executeTakeFirstOrThrow();
  return { unread: Number(r.n) };
}

// ─── Reading the inbox (social module) ──────────────────────────────────────

export async function listNotifications(actor: Actor, q: { unreadOnly: boolean; cursor?: string; limit: number }): Promise<Paged<Notification>> {
  const page = timePage(await notificationRepo.list(actor.id, { unreadOnly: q.unreadOnly, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await presentNotifications(actor, page.items), nextCursor: page.nextCursor };
}

export async function markRead(actor: Actor, id: string): Promise<void> {
  if (!(await notificationRepo.markRead(actor.id, id))) throw notFound("Notification not found");
  realtime.emit([rooms.user(actor.id)], "notification:count", await unreadCount(actor.id));
}

export async function markAllRead(actor: Actor): Promise<void> {
  await notificationRepo.markAllRead(actor.id);
  realtime.emit([rooms.user(actor.id)], "notification:count", { unread: 0 });
}
