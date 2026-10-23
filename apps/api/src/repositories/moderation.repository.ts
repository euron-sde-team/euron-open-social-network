/**
 * Moderation storage: cases (one OPEN case per target, enforced by a partial unique
 * index), reports, the append-only action log and appeals.
 */
import type { CaseSource, ModerationTarget } from "@open-social/types";
import { sql, type Insertable, type Selectable, type Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Appeals, ModerationActions, ModerationCases, Reports } from "../db/types";

export type CaseRow = Selectable<ModerationCases>;
export type AppealRow = Selectable<Appeals>;
export type ActionRow = Selectable<ModerationActions>;

export interface CaseFilters {
  status: "OPEN" | "RESOLVED";
  source?: CaseSource;
  communityId?: string;
  targetType?: ModerationTarget;
  /** Restrict to these communities (community moderators). Undefined = everything (staff). */
  communityIds?: string[];
  authorId?: string;
}

/** Keyset position for the open queue: priority DESC, opened_at ASC, id ASC. */
export interface QueueCursor {
  priority: number;
  at: Date;
  id: string;
}

/**
 * A timestamp column at millisecond precision for keyset comparisons. Every column is
 * timestamptz(3) already (see db/migrations/0001_init.sql), so today this is a no-op;
 * it keeps cursor comparisons exact (a cursor is a JS Date, milliseconds only) even if
 * a column were ever declared with microsecond precision.
 */
export const msOf = (column: string) => sql<Date>`date_trunc('milliseconds', ${sql.ref(column)})`;

export class ModerationRepository {
  findCase(id: string, exec: Executor = db) {
    return exec.selectFrom("moderation_cases").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lockCase(id: string, exec: Executor) {
    return exec.selectFrom("moderation_cases").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  findOpenCase(targetType: ModerationTarget, targetId: string, exec: Executor = db) {
    return exec.selectFrom("moderation_cases").selectAll().where("target_type", "=", targetType).where("target_id", "=", targetId).where("status", "=", "OPEN").forUpdate().executeTakeFirst();
  }

  /** Insert an OPEN case, or return the one that already exists for the target (locked). */
  async openCase(row: Insertable<ModerationCases>, exec: Executor): Promise<{ row: CaseRow; created: boolean }> {
    const inserted = await exec
      .insertInto("moderation_cases")
      .values({ ...row, status: "OPEN" })
      .onConflict((oc) => oc.columns(["target_type", "target_id"]).where("status", "=", "OPEN").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return { row: inserted, created: true };
    const existing = await this.findOpenCase(row.target_type, row.target_id, exec);
    if (!existing) throw new Error("open case vanished");
    return { row: existing, created: false };
  }

  updateCase(id: string, patch: Updateable<ModerationCases>, exec: Executor = db) {
    return exec.updateTable("moderation_cases").set(patch).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }

  listCases(f: CaseFilters, cursor: { queue?: QueueCursor | null; at?: { at: Date; id: string } | null }, limit: number, exec: Executor = db) {
    let q = exec.selectFrom("moderation_cases").selectAll().where("status", "=", f.status);
    if (f.source) q = q.where("source", "=", f.source);
    if (f.communityId) q = q.where("community_id", "=", f.communityId);
    if (f.targetType) q = q.where("target_type", "=", f.targetType);
    if (f.authorId) q = q.where("author_id", "=", f.authorId);
    if (f.communityIds) q = f.communityIds.length ? q.where("community_id", "in", f.communityIds) : q.where(sql<boolean>`false`);
    if (f.status === "OPEN" && !f.authorId) {
      const c = cursor.queue;
      if (c)
        q = q.where((eb) =>
          eb.or([
            eb("priority", "<", c.priority),
            eb.and([eb("priority", "=", c.priority), eb(msOf("opened_at"), ">", c.at)]),
            eb.and([eb("priority", "=", c.priority), eb(msOf("opened_at"), "=", c.at), eb("id", ">", c.id)]),
          ]),
        );
      return q.orderBy("priority", "desc").orderBy(msOf("opened_at"), "asc").orderBy("id", "asc").limit(limit + 1).execute();
    }
    const c = cursor.at;
    if (c) q = q.where((eb) => eb.or([eb(msOf("opened_at"), "<", c.at), eb.and([eb(msOf("opened_at"), "=", c.at), eb("id", "<", c.id)])]));
    return q.orderBy(msOf("opened_at"), "desc").orderBy("id", "desc").limit(limit + 1).execute();
  }

  countOpen(exec: Executor = db): Promise<number> {
    return exec
      .selectFrom("moderation_cases")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("status", "=", "OPEN")
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  findReport(reporterId: string, targetType: ModerationTarget, targetId: string, exec: Executor = db) {
    return exec.selectFrom("reports").select("id").where("reporter_id", "=", reporterId).where("target_type", "=", targetType).where("target_id", "=", targetId).executeTakeFirst();
  }

  /** Returns null on the (reporter, target) unique conflict. */
  insertReport(row: Insertable<Reports>, exec: Executor) {
    return exec
      .insertInto("reports")
      .values(row)
      .onConflict((oc) => oc.columns(["reporter_id", "target_type", "target_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
  }

  /**
   * Account age in days of every reporter whose report is attached to this case (so
   * reports filed before the last resolution never count again) and whose account is
   * ACTIVE right now (a banned or suspended reporter's voice does not count).
   */
  async reporterAges(caseId: string, exec: Executor = db): Promise<number[]> {
    const rows = await exec
      .selectFrom("reports")
      .innerJoin("users", "users.id", "reports.reporter_id")
      .select(sql<number>`extract(epoch from now() - users.created_at) / 86400`.as("age"))
      .where("reports.case_id", "=", caseId)
      .where("users.status", "=", "ACTIVE")
      .execute();
    return rows.map((r) => Number(r.age));
  }

  reasonsFor(caseIds: string[], exec: Executor = db) {
    if (!caseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("reports")
      .select(["case_id", "reason", (eb) => eb.fn.countAll<number>().as("n")])
      .where("case_id", "in", caseIds)
      .groupBy(["case_id", "reason"])
      .orderBy("n", "desc")
      .execute();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  insertAction(row: Insertable<ModerationActions>, exec: Executor = db) {
    return exec.insertInto("moderation_actions").values(row).returningAll().executeTakeFirstOrThrow();
  }

  history(targetType: ModerationTarget, targetId: string, exec: Executor = db) {
    return exec.selectFrom("moderation_actions").selectAll().where("target_type", "=", targetType).where("target_id", "=", targetId).orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(200).execute();
  }

  // ─── Appeals ──────────────────────────────────────────────────────────────

  insertAppeal(row: Insertable<Appeals>, exec: Executor) {
    return exec
      .insertInto("appeals")
      .values(row)
      .onConflict((oc) => oc.columns(["case_id", "appellant_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  findAppeal(id: string, exec: Executor = db) {
    return exec.selectFrom("appeals").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lockAppeal(id: string, exec: Executor) {
    return exec.selectFrom("appeals").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  updateAppeal(id: string, patch: Updateable<Appeals>, exec: Executor) {
    return exec.updateTable("appeals").set(patch).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }

  /** The latest appeal of each case. */
  appealsFor(caseIds: string[], exec: Executor = db) {
    if (!caseIds.length) return Promise.resolve([]);
    return exec.selectFrom("appeals").selectAll().distinctOn("case_id").where("case_id", "in", caseIds).orderBy("case_id").orderBy("created_at", "desc").execute();
  }

  listAppeals(status: "PENDING" | "UPHELD" | "OVERTURNED" | undefined, cursor: { at: Date; id: string } | null, limit: number, exec: Executor = db) {
    let q = exec.selectFrom("appeals").selectAll();
    if (status) q = q.where("status", "=", status);
    if (cursor) q = q.where((eb) => eb.or([eb(msOf("created_at"), "<", cursor.at), eb.and([eb(msOf("created_at"), "=", cursor.at), eb("id", "<", cursor.id)])]));
    return q.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(limit + 1).execute();
  }

  // ─── Scope and stats ──────────────────────────────────────────────────────

  /** Communities where the user is an ACTIVE OWNER, ADMIN or MODERATOR. */
  async moderatedCommunityIds(userId: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec
      .selectFrom("community_members")
      .select("community_id")
      .where("user_id", "=", userId)
      .where("status", "=", "ACTIVE")
      .where("role", "in", ["OWNER", "ADMIN", "MODERATOR"])
      .execute();
    return rows.map((r) => r.community_id);
  }

  /** Dashboard counters; with `communityIds`, only cases (and their appeals and actions) in those communities. */
  async stats(communityIds?: readonly string[], exec: Executor = db) {
    if (communityIds && !communityIds.length) return { openCases: 0, openAppeals: 0, actionsToday: 0, autoHiddenToday: 0 };
    const scoped = communityIds ? sql`AND c.community_id IN (${sql.join([...communityIds])})` : sql``;
    const r = await sql<{ open_cases: number; open_appeals: number; actions_today: number; auto_hidden_today: number }>`
      SELECT
        (SELECT count(*) FROM moderation_cases c WHERE c.status = 'OPEN' ${scoped})::int AS open_cases,
        (SELECT count(*) FROM appeals a JOIN moderation_cases c ON c.id = a.case_id WHERE a.status = 'PENDING' ${scoped})::int AS open_appeals,
        (SELECT count(*) FROM moderation_actions m LEFT JOIN moderation_cases c ON c.id = m.case_id WHERE m.created_at >= date_trunc('day', now()) ${scoped})::int AS actions_today,
        (SELECT count(*) FROM moderation_actions m LEFT JOIN moderation_cases c ON c.id = m.case_id WHERE m.created_at >= date_trunc('day', now()) AND m.actor_id IS NULL AND m.action = 'HIDE' ${scoped})::int AS auto_hidden_today`.execute(exec);
    const row = r.rows[0]!;
    return { openCases: Number(row.open_cases), openAppeals: Number(row.open_appeals), actionsToday: Number(row.actions_today), autoHiddenToday: Number(row.auto_hidden_today) };
  }
}

export const moderationRepo = new ModerationRepository();
