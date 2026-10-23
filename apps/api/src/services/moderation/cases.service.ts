/**
 * The moderation queue: who sees which cases, listing and detail, assignment, history,
 * the author's own view, stats, and the helpers every other moderation service shares
 * (opening a case with a snapshot, telling the author, refreshing the staff badge).
 *
 * Scope: platform staff see every case. Community moderators (ACTIVE OWNER, ADMIN or
 * MODERATOR) see cases whose community is one of theirs; DM cases have no community,
 * so only staff ever see them. The author of the content (the subject, for USER cases)
 * gets the author view of their own cases: no raw AI scores and no moderator identity
 * (reporters never appear in any case DTO).
 */
import type { CaseSource, ModerationActionRecord, ModerationCase, ModerationTarget, Page } from "@open-social/types";
import { isStaff, requireActor, requireStaff, type Actor } from "../../core/context";
import { decodeCursor, encodeCursor, toPage } from "../../core/cursor";
import type { Effects } from "../../core/effects";
import { withTransaction } from "../../core/effects";
import { badRequest, forbidden, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { db, type Executor } from "../../db/kysely";
import { presentActions, presentCases } from "../../presenters/moderation.presenter";
import { realtime, rooms } from "../../realtime/port";
import { moderationRepo, msOf, type CaseFilters, type CaseRow, type QueueCursor } from "../../repositories/moderation.repository";
import { audit } from "../audit.service";
import { notify } from "../notification.service";
import type { TargetInfo } from "./targets";

// ─── Shared helpers ─────────────────────────────────────────────────────────

const LABEL: Record<ModerationTarget, string> = {
  POST: "post",
  COMMENT: "comment",
  CHAT_MESSAGE: "chat message",
  DM_MESSAGE: "message",
  QUESTION: "question",
  ANSWER: "answer",
  EVENT: "event",
  USER: "account",
  COMMUNITY: "community",
};

export function labelOf(type: ModerationTarget): string {
  return LABEL[type];
}

/** The content as it is now. Media is stored by upload id and signed when presented. */
export function snapshotOf(info: TargetInfo): Record<string, unknown> {
  const body = info.type === "QUESTION" || info.type === "EVENT" ? info.text.slice((info.title ?? "").length).trim() : info.text;
  return { body: body.slice(0, 20000), ...(info.title ? { title: info.title } : {}), mediaIds: info.mediaIds, authorId: info.authorId, status: info.status, capturedAt: new Date().toISOString() };
}

/** Open (or join) the target's single OPEN case. */
export async function openCaseFor(
  info: TargetInfo,
  source: CaseSource,
  extra: { priority?: number; aiProvider?: string; aiScores?: Record<string, number>; aiCategories?: string[] },
  exec: Executor,
  fx: Effects,
): Promise<{ row: CaseRow; created: boolean }> {
  const result = await moderationRepo.openCase(
    {
      id: newId(),
      target_type: info.type,
      target_id: info.id,
      // Account and community cases are platform matters: no community moderator sees them.
      community_id: info.type === "COMMUNITY" || info.type === "USER" ? null : info.communityId,
      author_id: info.authorId,
      source,
      priority: extra.priority ?? 0,
      ai_provider: extra.aiProvider ?? null,
      ai_scores: extra.aiScores ? JSON.stringify(extra.aiScores) : null,
      ai_categories: extra.aiCategories ?? null,
      snapshot: JSON.stringify(snapshotOf(info)),
    },
    exec,
  );
  if (result.created) emitQueue(fx);
  else if (extra.aiScores) {
    result.row = await moderationRepo.updateCase(
      result.row.id,
      {
        ai_provider: extra.aiProvider ?? null,
        ai_scores: JSON.stringify(extra.aiScores),
        ai_categories: extra.aiCategories ?? null,
        priority: Math.max(result.row.priority, extra.priority ?? 0),
        snapshot: JSON.stringify(snapshotOf(info)),
      },
      exec,
    );
  }
  return result;
}

/** Refresh the open-case badge of every connected staff member, after commit. */
export function emitQueue(fx: Effects): void {
  fx.after(async () => realtime.emit([rooms.staff], "moderation:queue", { openCases: await moderationRepo.countOpen() }));
}

/** Tell the author what happened. The actor is never shown for automated actions; reporters never are. */
export async function notifyAuthor(
  authorId: string | null,
  actorId: string | null,
  caseId: string | null,
  info: Pick<TargetInfo, "type" | "communityId">,
  snippet: string,
  exec: Executor,
  fx: Effects,
  type: "MODERATION_ACTION" | "APPEAL_DECIDED" = "MODERATION_ACTION",
): Promise<void> {
  if (!authorId) return;
  await notify(
    {
      recipientId: authorId,
      // Moderators act for the platform: notifications do not name them.
      actorId: null,
      type,
      entityType: "moderation_case",
      entityId: caseId ?? info.type,
      communityId: info.type === "DM_MESSAGE" || info.type === "USER" ? null : info.communityId,
      snippet,
      data: { caseId, targetType: info.type, by: actorId ? "moderator" : "automatic" },
    },
    fx,
    exec,
  );
}

// ─── Access ─────────────────────────────────────────────────────────────────

/** Communities the actor may moderate cases for; undefined means every case (staff). */
export async function caseScope(actor: Actor, exec: Executor = db): Promise<string[] | undefined> {
  if (isStaff(actor)) return undefined;
  const ids = await moderationRepo.moderatedCommunityIds(actor.id, exec);
  if (!ids.length) throw forbidden();
  return ids;
}

/** The case is about the actor: their content, or their account for USER cases. */
export function isCaseSubject(actor: Actor, row: Pick<CaseRow, "author_id" | "target_type" | "target_id">): boolean {
  return row.author_id === actor.id || (row.target_type === "USER" && row.target_id === actor.id);
}

export async function canSeeCase(actor: Actor, row: CaseRow, exec: Executor = db): Promise<boolean> {
  if (isStaff(actor)) return true;
  if (!row.community_id) return false;
  return (await moderationRepo.moderatedCommunityIds(actor.id, exec)).includes(row.community_id);
}

// ─── Queue cursor (priority DESC, opened_at ASC, id ASC) ────────────────────

export function encodeQueueCursor(c: QueueCursor): string {
  return Buffer.from(`${c.priority}|${c.at.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeQueueCursor(raw: string | undefined): QueueCursor | null {
  if (!raw) return null;
  const [p, iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const priority = Number(p);
  const at = new Date(iso ?? "");
  if (!Number.isInteger(priority) || Number.isNaN(at.getTime()) || !id || !/^[0-9A-Z]{26}$/.test(id)) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  return { priority, at, id };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export interface ListCasesQuery {
  status?: "OPEN" | "RESOLVED";
  source?: CaseSource;
  communityId?: string;
  targetType?: ModerationTarget;
  cursor?: string;
  limit: number;
}

export async function listCases(actor: Actor, q: ListCasesQuery): Promise<Page<ModerationCase>> {
  requireActor(actor);
  const scope = await caseScope(actor);
  const filters: CaseFilters = { status: q.status ?? "OPEN", source: q.source, communityId: q.communityId, targetType: q.targetType, communityIds: scope };
  const queue = filters.status === "OPEN";
  const rows = await moderationRepo.listCases(filters, queue ? { queue: decodeQueueCursor(q.cursor) } : { at: decodeCursor(q.cursor) }, q.limit);
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? (queue ? encodeQueueCursor({ priority: last.priority, at: last.opened_at, id: last.id }) : encodeCursor(last.opened_at, last.id)) : null;
  return { items: await presentCases(items), nextCursor };
}

/** Moderators who may see the case get the full view; its author gets the author view; anyone else a 404. */
export async function getCase(actor: Actor, id: string): Promise<ModerationCase> {
  const row = await moderationRepo.findCase(id);
  if (!row) throw notFound("Case not found", "CASE_NOT_FOUND");
  if (await canSeeCase(actor, row)) return (await presentCases([row]))[0] as ModerationCase;
  if (isCaseSubject(actor, row)) return (await presentCases([row], db, { view: "author" }))[0] as ModerationCase;
  throw notFound("Case not found", "CASE_NOT_FOUND");
}

export async function assignCase(actor: Actor, id: string, userId: string | null): Promise<ModerationCase> {
  requireStaff(actor);
  return withTransaction(async (trx) => {
    const row = await moderationRepo.lockCase(id, trx);
    if (!row) throw notFound("Case not found", "CASE_NOT_FOUND");
    if (userId) {
      const assignee = await trx.selectFrom("users").select(["id", "role"]).where("id", "=", userId).executeTakeFirst();
      if (!assignee || assignee.role === "USER") throw badRequest("Cases can only be assigned to staff", "ASSIGNEE_NOT_STAFF");
    }
    const updated = await moderationRepo.updateCase(id, { assigned_to: userId }, trx);
    await audit({ actorId: actor.id, action: "moderation.assign", entityType: "moderation_case", entityId: id, data: { userId } }, trx);
    return (await presentCases([updated], trx))[0] as ModerationCase;
  });
}

export async function history(actor: Actor, targetType: ModerationTarget, targetId: string): Promise<ModerationActionRecord[]> {
  requireStaff(actor);
  return presentActions(await moderationRepo.history(targetType, targetId));
}

/** Cases about the viewer's own content or account, newest first. */
export async function myCases(actor: Actor, cursor: string | undefined, limit: number): Promise<Page<ModerationCase>> {
  requireActor(actor);
  const c = decodeCursor(cursor);
  let q = db
    .selectFrom("moderation_cases")
    .selectAll()
    .where((eb) => eb.or([eb("author_id", "=", actor.id), eb.and([eb("target_type", "=", "USER"), eb("target_id", "=", actor.id)])]));
  if (c) q = q.where((eb) => eb.or([eb(msOf("opened_at"), "<", c.at), eb.and([eb(msOf("opened_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await q.orderBy(msOf("opened_at"), "desc").orderBy("id", "desc").limit(limit + 1).execute();
  const page = toPage(rows, limit, (r) => ({ at: r.opened_at, id: r.id }));
  return { items: await presentCases(page.items, db, { view: "author" }), nextCursor: page.nextCursor };
}

/** Queue counters: network-wide for staff, the moderated communities only for community moderators (403 otherwise). */
export async function stats(actor: Actor) {
  requireActor(actor);
  return moderationRepo.stats(await caseScope(actor));
}
