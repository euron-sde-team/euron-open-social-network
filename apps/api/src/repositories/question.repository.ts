/** Q&A: questions, answers, their tags and votes. */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Answers, Questions } from "../db/types";
import { atKey, belowScore, olderThan, type ScoreKey, type TimeKey } from "./keyset";
import { tsMatches } from "./text-search";
import { canReadCommunity, notBlocked } from "./visibility";

export type QuestionRow = Selectable<Questions>;
export type AnswerRow = Selectable<Answers>;

const qScore = sql<number>`q.score::float8`;
const aScore = sql<number>`a.score::float8`;

export class QuestionRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("questions").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("questions").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  visible(viewer: Actor | null, exec: Executor = db) {
    return exec
      .selectFrom("questions as q")
      .innerJoin("communities as c", "c.id", "q.community_id")
      .selectAll("q")
      .select(atKey("q.created_at"))
      .where("c.status", "=", "PUBLISHED")
      .where("q.content_status", "=", "PUBLISHED")
      .where(notBlocked(viewer?.id, "q.author_id"))
      .where(canReadCommunity(viewer, "q.community_id"));
  }

  list(
    viewer: Actor | null,
    communityId: string,
    opts: { status?: "OPEN" | "RESOLVED" | "CLOSED"; sort: "new" | "top" | "unanswered"; tag?: string; time: TimeKey | null; score: ScoreKey | null; limit: number },
    exec: Executor = db,
  ) {
    let q = this.visible(viewer, exec).where("q.community_id", "=", communityId);
    if (opts.status) q = q.where("q.status", "=", opts.status);
    if (opts.tag) q = q.where((eb) => eb.exists(eb.selectFrom("question_tags as t").select("t.question_id").whereRef("t.question_id", "=", "q.id").where("t.tag", "=", opts.tag as string)));
    if (opts.sort === "unanswered") q = q.where("q.answer_count", "=", 0);
    if (opts.sort === "top") {
      return q.select(qScore.as("_score")).where(belowScore(qScore, "q.id", opts.score)).orderBy(qScore, "desc").orderBy("q.id", "desc").limit(opts.limit + 1).execute();
    }
    return q.where(olderThan("q.created_at", "q.id", opts.time)).orderBy("q.created_at", "desc").orderBy("q.id", "desc").limit(opts.limit + 1).execute();
  }

  search(viewer: Actor | null, text: string, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec).where(tsMatches("q.search", text)).orderBy("q.created_at", "desc").limit(limit).execute();
  }

  insert(row: Insertable<Questions>, exec: Executor = db) {
    return exec.insertInto("questions").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Questions>, exec: Executor = db) {
    return exec
      .updateTable("questions")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjust(id: string, delta: { answers?: number; score?: number }, exec: Executor = db) {
    return exec
      .updateTable("questions")
      .set({ answer_count: sql`greatest(0, answer_count + ${delta.answers ?? 0})`, score: sql`score + ${delta.score ?? 0}` })
      .where("id", "=", id)
      .returning(["score", "answer_count"])
      .executeTakeFirstOrThrow();
  }

  viewIncrement(id: string, exec: Executor = db) {
    return exec.updateTable("questions").set({ view_count: sql`view_count + 1` }).where("id", "=", id).execute();
  }

  async setTags(questionId: string, tags: readonly string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("question_tags").where("question_id", "=", questionId).execute();
    if (tags.length) await exec.insertInto("question_tags").values(tags.map((tag) => ({ question_id: questionId, tag }))).execute();
  }

  tagsFor(ids: readonly string[], exec: Executor = db) {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("question_tags").select(["question_id", "tag"]).where("question_id", "in", [...ids]).orderBy("tag").execute();
  }

  // ─── Votes ────────────────────────────────────────────────────────────────

  async vote(kind: "question" | "answer", itemId: string, userId: string, value: -1 | 0 | 1, exec: Executor): Promise<number> {
    const table = kind === "question" ? "question_votes" : "answer_votes";
    const fk = kind === "question" ? "question_id" : "answer_id";
    const prev = (await (exec as any).selectFrom(table).select("value").where(fk, "=", itemId).where("user_id", "=", userId).forUpdate().executeTakeFirst()) as { value: number } | undefined;
    const before = prev?.value ?? 0;
    if (before === value) return 0;
    if (value === 0) await (exec as any).deleteFrom(table).where(fk, "=", itemId).where("user_id", "=", userId).execute();
    else
      await (exec as any)
        .insertInto(table)
        .values({ [fk]: itemId, user_id: userId, value })
        .onConflict((oc: any) => oc.columns([fk, "user_id"]).doUpdateSet({ value }))
        .execute();
    return value - before;
  }

  async viewerVotes(kind: "question" | "answer", userId: string | null | undefined, ids: readonly string[], exec: Executor = db): Promise<Map<string, -1 | 1>> {
    if (!userId || !ids.length) return new Map();
    const table = kind === "question" ? "question_votes" : "answer_votes";
    const fk = kind === "question" ? "question_id" : "answer_id";
    const rows = (await (exec as any).selectFrom(table).select([`${fk} as id`, "value"]).where("user_id", "=", userId).where(fk, "in", [...ids]).execute()) as { id: string; value: -1 | 1 }[];
    return new Map(rows.map((r) => [r.id, r.value]));
  }

  // ─── Answers ──────────────────────────────────────────────────────────────

  findAnswer(id: string, exec: Executor = db) {
    return exec.selectFrom("answers").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findAnswerForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("answers").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  insertAnswer(row: Insertable<Answers>, exec: Executor = db) {
    return exec.insertInto("answers").values(row).returningAll().executeTakeFirstOrThrow();
  }

  updateAnswer(id: string, patch: Updateable<Answers>, exec: Executor = db) {
    return exec
      .updateTable("answers")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjustAnswerScore(id: string, delta: number, exec: Executor) {
    return exec.updateTable("answers").set({ score: sql`score + ${delta}` }).where("id", "=", id).returning("score").executeTakeFirstOrThrow();
  }

  /** Answers other than the accepted one; the service puts the accepted answer first. */
  answers(questionId: string, viewerId: string | null, opts: { sort: "top" | "new"; excludeId: string | null; time: TimeKey | null; score: ScoreKey | null; limit: number }, exec: Executor = db) {
    let q = exec
      .selectFrom("answers as a")
      .selectAll("a")
      .select(atKey("a.created_at"))
      .where("a.question_id", "=", questionId)
      .where("a.status", "=", "PUBLISHED")
      .where(notBlocked(viewerId, "a.author_id"));
    if (opts.excludeId) q = q.where("a.id", "!=", opts.excludeId);
    if (opts.sort === "top") {
      return q.select(aScore.as("_score")).where(belowScore(aScore, "a.id", opts.score)).orderBy(aScore, "desc").orderBy("a.id", "desc").limit(opts.limit + 1).execute();
    }
    return q.where(olderThan("a.created_at", "a.id", opts.time)).orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(opts.limit + 1).execute();
  }
}

export const questionRepo = new QuestionRepository();
