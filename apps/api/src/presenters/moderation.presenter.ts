/**
 * Moderation rows to DTOs, batched: one query per related table whatever the page size.
 *
 * Reporter identities never appear in any DTO: a case shows report reasons and counts
 * only, so an author reading their own case (/moderation/me) cannot learn who reported.
 * The author view (`view: "author"`) also drops the raw AI scores (categories stay) and
 * the moderator who resolved it: moderators act for the platform, not as people.
 */
import type { Appeal, ContentStatus, Media, ModerationActionRecord, ModerationCase, UserStatus } from "@open-social/types";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { moderationRepo, type ActionRow, type AppealRow, type CaseRow } from "../repositories/moderation.repository";
import { loadMedia } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

const STATUS_SOURCE: Record<string, { table: string; column: string }> = {
  POST: { table: "posts", column: "status" },
  COMMENT: { table: "comments", column: "status" },
  CHAT_MESSAGE: { table: "chat_messages", column: "status" },
  DM_MESSAGE: { table: "dm_messages", column: "status" },
  QUESTION: { table: "questions", column: "content_status" },
  ANSWER: { table: "answers", column: "status" },
  EVENT: { table: "events", column: "content_status" },
  USER: { table: "users", column: "status" },
  COMMUNITY: { table: "communities", column: "status" },
};

/** Current status of each case target, keyed by `${type}:${id}`. */
async function currentStatuses(rows: CaseRow[], exec: Executor): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<string, string[]>();
  for (const r of rows) byType.set(r.target_type, [...(byType.get(r.target_type) ?? []), r.target_id]);
  for (const [type, ids] of byType) {
    const src = STATUS_SOURCE[type];
    if (!src) continue;
    const res = await sql<{ id: string; status: string }>`SELECT id, ${sql.ref(src.column)}::text AS status FROM ${sql.table(src.table)} WHERE id IN (${sql.join(ids)})`.execute(exec);
    for (const r of res.rows) out.set(`${type}:${r.id}`, r.status);
  }
  return out;
}

export function toAppeal(row: AppealRow, appellants: Map<string, Appeal["appellant"]>): Appeal {
  return {
    id: row.id,
    caseId: row.case_id,
    appellant: appellants.get(row.appellant_id) ?? { id: row.appellant_id, username: "unknown", displayName: "Unknown", avatarUrl: null, headline: null, role: "USER" },
    statement: row.statement,
    status: row.status,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function presentAppeals(rows: AppealRow[], exec: Executor = db): Promise<Appeal[]> {
  const people = await loadSummaries(rows.map((r) => r.appellant_id), exec);
  return rows.map((r) => toAppeal(r, people));
}

export interface CaseView {
  /** "moderator" (default): everything. "author": the view of the person the case is about. */
  view?: "moderator" | "author";
}

export async function presentCases(rows: CaseRow[], exec: Executor = db, opts: CaseView = {}): Promise<ModerationCase[]> {
  if (!rows.length) return [];
  const author = opts.view === "author";
  const ids = rows.map((r) => r.id);
  const snapshots = rows.map((r) => (r.snapshot ?? {}) as Record<string, unknown>);
  const mediaIds = snapshots.flatMap((s) => (Array.isArray(s.mediaIds) ? (s.mediaIds as string[]) : []));
  const communityIds = [...new Set(rows.map((r) => r.community_id).filter((x): x is string => !!x))];

  const [people, media, reasons, appeals, statuses, communities] = await Promise.all([
    loadSummaries(rows.flatMap((r) => [r.author_id, author ? null : r.resolved_by]), exec),
    loadMedia(mediaIds, exec),
    moderationRepo.reasonsFor(ids, exec),
    moderationRepo.appealsFor(ids, exec),
    currentStatuses(rows, exec),
    communityIds.length ? exec.selectFrom("communities").select(["id", "slug", "name"]).where("id", "in", communityIds).execute() : Promise.resolve([]),
  ]);
  const appealPeople = await loadSummaries(appeals.map((a) => a.appellant_id), exec);
  const communityById = new Map(communities.map((c) => [c.id, { id: c.id, slug: c.slug, name: c.name }]));
  const appealByCase = new Map(appeals.map((a) => [a.case_id, toAppeal(a, appealPeople)]));

  return rows.map((r, i) => {
    const { mediaIds: snapMedia, ...rest } = snapshots[i] as { mediaIds?: string[] } & Record<string, unknown>;
    const snapshot: ModerationCase["snapshot"] = { ...rest, media: (snapMedia ?? []).map((id) => media.get(id)).filter((m): m is Media => !!m) };
    return {
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      community: r.community_id ? (communityById.get(r.community_id) ?? null) : null,
      author: r.author_id ? (people.get(r.author_id) ?? null) : null,
      source: r.source,
      status: r.status,
      priority: r.priority,
      aiProvider: r.ai_provider,
      aiScores: author ? null : ((r.ai_scores as Record<string, number> | null) ?? null),
      aiCategories: r.ai_categories ?? [],
      reportCount: r.report_count,
      reasons: reasons.filter((x) => x.case_id === r.id).map((x) => ({ reason: x.reason, count: Number(x.n) })),
      snapshot,
      targetStatus: (statuses.get(`${r.target_type}:${r.target_id}`) as ContentStatus | UserStatus | undefined) ?? null,
      resolution: r.resolution,
      resolvedBy: !author && r.resolved_by ? (people.get(r.resolved_by) ?? null) : null,
      openedAt: r.opened_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      appeal: appealByCase.get(r.id) ?? null,
    };
  });
}

export async function presentActions(rows: ActionRow[], exec: Executor = db): Promise<ModerationActionRecord[]> {
  const people = await loadSummaries(rows.map((r) => r.actor_id), exec);
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}
