/** Polls attached to posts, their options and votes. */
import type { Selectable } from "kysely";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { PollOptions, Polls } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { notBlocked } from "./visibility";

export type PollRow = Selectable<Polls>;
export type PollOptionRow = Selectable<PollOptions>;

export class PollRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("polls").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("polls").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  forPosts(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([] as PollRow[]);
    return exec.selectFrom("polls").selectAll().where("post_id", "in", [...postIds]).execute();
  }

  options(pollIds: readonly string[], exec: Executor = db) {
    if (!pollIds.length) return Promise.resolve([] as PollOptionRow[]);
    return exec.selectFrom("poll_options").selectAll().where("poll_id", "in", [...pollIds]).orderBy("position").execute();
  }

  viewerVotes(userId: string | null | undefined, pollIds: readonly string[], exec: Executor = db) {
    if (!userId || !pollIds.length) return Promise.resolve([] as { poll_id: string; option_id: string }[]);
    return exec.selectFrom("poll_votes").select(["poll_id", "option_id"]).where("user_id", "=", userId).where("poll_id", "in", [...pollIds]).execute();
  }

  async create(input: { id: string; postId: string; question: string; allowMultiple: boolean; isAnonymous: boolean; closesAt: Date | null; options: { id: string; label: string }[] }, exec: Executor) {
    await exec
      .insertInto("polls")
      .values({ id: input.id, post_id: input.postId, question: input.question, allow_multiple: input.allowMultiple, is_anonymous: input.isAnonymous, closes_at: input.closesAt })
      .execute();
    await exec
      .insertInto("poll_options")
      .values(input.options.map((o, position) => ({ id: o.id, poll_id: input.id, label: o.label, position })))
      .execute();
  }

  /** Remove a user's votes; returns the option ids they had voted for. */
  async clearVotes(pollId: string, userId: string, exec: Executor): Promise<string[]> {
    const removed = await exec.deleteFrom("poll_votes").where("poll_id", "=", pollId).where("user_id", "=", userId).returning("option_id").execute();
    const ids = removed.map((r) => r.option_id);
    if (ids.length) {
      await exec.updateTable("poll_options").set({ vote_count: sql`greatest(0, vote_count - 1)` }).where("id", "in", ids).execute();
      await exec
        .updateTable("polls")
        .set({ total_votes: sql`greatest(0, total_votes - ${ids.length})`, voter_count: sql`greatest(0, voter_count - 1)` })
        .where("id", "=", pollId)
        .execute();
    }
    return ids;
  }

  async addVotes(pollId: string, userId: string, optionIds: readonly string[], exec: Executor): Promise<void> {
    if (!optionIds.length) return;
    const now = new Date();
    await exec
      .insertInto("poll_votes")
      .values(optionIds.map((option_id) => ({ poll_id: pollId, option_id, user_id: userId, created_at: now })))
      .execute();
    await exec.updateTable("poll_options").set({ vote_count: sql`vote_count + 1` }).where("id", "in", [...optionIds]).execute();
    await exec
      .updateTable("polls")
      .set({ total_votes: sql`total_votes + ${optionIds.length}`, voter_count: sql`voter_count + 1` })
      .where("id", "=", pollId)
      .execute();
  }

  close(pollId: string, exec: Executor = db) {
    return exec.updateTable("polls").set({ closed_at: new Date() }).where("id", "=", pollId).where("closed_at", "is", null).execute();
  }

  /** One row per voter (a multi-choice vote is several rows sharing one created_at). */
  voters(pollId: string, optionId: string | undefined, viewerId: string | null, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    let inner = exec.selectFrom("poll_votes").select(["user_id", "created_at"]).distinct().where("poll_id", "=", pollId);
    if (optionId) inner = inner.where("option_id", "=", optionId);
    return exec
      .selectFrom(inner.as("v"))
      .innerJoin("users as u", "u.id", "v.user_id")
      .select(["v.user_id as id"])
      .select(atKey("v.created_at"))
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, "v.user_id"))
      .where(olderThan("v.created_at", "v.user_id", cursor))
      .orderBy("v.created_at", "desc")
      .orderBy("v.user_id", "desc")
      .limit(limit + 1)
      .execute();
  }
}

export const pollRepo = new PollRepository();
