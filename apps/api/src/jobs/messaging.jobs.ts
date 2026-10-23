/**
 * Job handlers of the messaging, media and moderation modules:
 *
 *   media.process                  re-encode images, thumbnails, durations
 *   maintenance.expire-uploads     abandoned, rejected and never-attached uploads
 *   maintenance.lift-suspensions   timed suspensions that have run out
 *   moderation.scan                classify a piece of content (throws to retry)
 *   notifications.email            the "while you were away" digest
 */
import { sql } from "kysely";
import { config } from "../core/config";
import { captureError } from "../core/logger";
import { db } from "../db/kysely";
import { sendMail } from "../integrations/mail/mailer";
import * as templates from "../integrations/mail/templates";
import { expireUploads, processUpload } from "../services/media.service";
import { hrefFor } from "../services/notification.service";
import { networkName } from "../services/settings.service";
import { liftSuspensionsJob, moderationScanJob } from "./moderation.jobs";
import { registerJob } from "./registry";

/** Notifications must sit unread this long before they are emailed. */
const DIGEST_DELAY = "1 hour";
/** At most one digest per user in this window. */
const DIGEST_GAP = "6 hours";
const DIGEST_MAX_LINES = 10;

const LABELS: Record<string, string> = {
  POST_COMMENT: "commented on your post",
  COMMENT_REPLY: "replied to your comment",
  POST_REACTION: "reacted to your post",
  COMMENT_REACTION: "reacted to your comment",
  MENTION: "mentioned you",
  FOLLOW: "started following you",
  JOIN_REQUEST: "asked to join your community",
  MEMBERSHIP_APPROVED: "approved your membership",
  COMMUNITY_INVITE: "invited you to a community",
  DM_REQUEST: "sent you a message request",
  EVENT_UPDATED: "updated an event you are attending",
  EVENT_CANCELLED: "cancelled an event you were attending",
  EVENT_PROMOTED: "moved you off the waitlist",
  EVENT_REMINDER: "An event you are attending starts soon",
  ANSWER_POSTED: "answered your question",
  ANSWER_ACCEPTED: "accepted your answer",
  MODERATION_ACTION: "A moderation decision about your content",
  APPEAL_DECIDED: "Your appeal was decided",
};

/** Lines that would put private words in an inbox get this text instead (no snippet, no name). */
export const GENERIC_DM_REQUEST = "You have a new message request";
export const GENERIC_PRIVATE_COMMUNITY = "New activity in a private community";

/** The digest line for one notification. Pure, so the privacy rule is unit-tested. */
export function digestLine(r: { type: string; snippet: string | null; actor_name: string | null; private_community: boolean }): string {
  // Email leaves the network: a message request's first words, or anything from a
  // private community, could be read by whoever else sees the inbox or a preview pane.
  if (r.type === "DM_REQUEST") return GENERIC_DM_REQUEST;
  if (r.private_community) return GENERIC_PRIVATE_COMMUNITY;
  const label = LABELS[r.type] ?? "New activity";
  const text = r.actor_name && /^[a-z]/.test(label) ? `${r.actor_name} ${label}` : label;
  return r.snippet ? `${text}: ${r.snippet.slice(0, 80)}` : text;
}

/**
 * Email each eligible user one digest of the notifications they have not read for an
 * hour and that were never emailed. `onlyUserId` narrows it to one recipient (the job
 * payload's notification); without it every eligible user is swept. Users who turned
 * digests off (users.email_digest = false) are skipped and their rows left unclaimed.
 */
export async function sendNotificationDigests(onlyUserId?: string): Promise<number> {
  const pending = await sql<{ id: string; recipient_id: string; type: string; entity_type: string; entity_id: string; data: unknown; snippet: string | null; actor_name: string | null; private_community: boolean; email: string; display_name: string }>`
    SELECT n.id, n.recipient_id, n.type, n.entity_type, n.entity_id, n.data, n.snippet, a.display_name AS actor_name,
           coalesce(c.visibility = 'PRIVATE', false) AS private_community, u.email, u.display_name
      FROM notifications n
      JOIN users u ON u.id = n.recipient_id AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL AND u.email_digest
      LEFT JOIN users a ON a.id = n.actor_id
      LEFT JOIN communities c ON c.id = n.community_id
     WHERE n.read_at IS NULL AND n.emailed_at IS NULL
       AND n.created_at < now() - ${sql.raw(`interval '${DIGEST_DELAY}'`)}
       AND n.created_at > now() - interval '7 days'
       ${onlyUserId ? sql`AND n.recipient_id = ${onlyUserId}` : sql``}
       AND NOT EXISTS (SELECT 1 FROM notifications e WHERE e.recipient_id = n.recipient_id AND e.emailed_at > now() - ${sql.raw(`interval '${DIGEST_GAP}'`)})
     ORDER BY n.recipient_id, n.created_at DESC
     LIMIT 5000`.execute(db);

  const byUser = new Map<string, typeof pending.rows>();
  for (const row of pending.rows) {
    const list = byUser.get(row.recipient_id) ?? [];
    list.push(row);
    byUser.set(row.recipient_id, list);
  }
  let sent = 0;
  const network = byUser.size ? await networkName() : "";
  for (const rows of byUser.values()) {
    // Claim first so two workers never email the same batch.
    const claimed = await db
      .updateTable("notifications")
      .set({ emailed_at: new Date() })
      .where("id", "in", rows.map((r) => r.id))
      .where("emailed_at", "is", null)
      .returning("id")
      .execute();
    if (!claimed.length) continue;
    const claimedIds = new Set(claimed.map((c) => c.id));
    const lines = rows
      .filter((r) => claimedIds.has(r.id))
      .slice(0, DIGEST_MAX_LINES)
      .map((r) => ({ text: digestLine(r), href: `${config.APP_WEB_URL}${hrefFor({ type: r.type as never, entity_type: r.entity_type, entity_id: r.entity_id, data: r.data })}` }));
    const first = rows[0]!;
    await sendMail(templates.notificationDigest(network, first.email, first.display_name, lines));
    sent += 1;
  }
  return sent;
}

let registered = false;

export function registerMessagingJobs(): void {
  if (registered) return;
  registered = true;
  registerJob("media.process", async ({ uploadId }) => processUpload(uploadId));
  registerJob("maintenance.expire-uploads", async () => {
    await expireUploads();
  });
  registerJob("maintenance.lift-suspensions", async () => liftSuspensionsJob());
  registerJob("moderation.scan", async (data) => moderationScanJob(data));
  registerJob("notifications.email", async (data) => {
    const id = (data as { notificationId?: string } | undefined)?.notificationId;
    let userId: string | undefined;
    if (id) {
      const row = await db.selectFrom("notifications").select("recipient_id").where("id", "=", id).executeTakeFirst();
      if (!row) return;
      userId = row.recipient_id;
    }
    await sendNotificationDigests(userId).catch((err) => {
      captureError(err, { job: "notifications.email" });
      throw err;
    });
  });
}
