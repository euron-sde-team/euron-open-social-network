/**
 * Comments: one level of replies (a reply to a reply attaches to the same top-level
 * comment). Lists are oldest first and only ever return PUBLISHED comments by people
 * the viewer has no block with.
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Comments } from "../db/types";
import { atKey, newerThan, type TimeKey } from "./keyset";
import { notBlocked } from "./visibility";

export type CommentRow = Selectable<Comments>;

export class CommentRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("comments").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("comments").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  list(scope: { postId: string; parentId: null } | { postId?: undefined; parentId: string }, viewerId: string | null, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    let q = exec
      .selectFrom("comments as cm")
      .selectAll("cm")
      .select(atKey("cm.created_at"))
      .where("cm.status", "=", "PUBLISHED")
      .where(notBlocked(viewerId, "cm.author_id"));
    q = scope.parentId === null ? q.where("cm.post_id", "=", scope.postId).where("cm.parent_id", "is", null) : q.where("cm.parent_id", "=", scope.parentId);
    return q.where(newerThan("cm.created_at", "cm.id", cursor)).orderBy("cm.created_at", "asc").orderBy("cm.id", "asc").limit(limit + 1).execute();
  }

  insert(row: Insertable<Comments>, exec: Executor = db) {
    return exec.insertInto("comments").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Comments>, exec: Executor = db) {
    return exec
      .updateTable("comments")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjustReplies(id: string, delta: number, exec: Executor = db) {
    return exec.updateTable("comments").set({ reply_count: sql`greatest(0, reply_count + ${delta})` }).where("id", "=", id).execute();
  }

  async setMentions(commentId: string, userIds: readonly string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("comment_mentions").where("comment_id", "=", commentId).execute();
    if (userIds.length) await exec.insertInto("comment_mentions").values(userIds.map((user_id) => ({ comment_id: commentId, user_id }))).execute();
  }

  mentionsFor(commentIds: readonly string[], exec: Executor = db) {
    if (!commentIds.length) return Promise.resolve([]);
    return exec.selectFrom("comment_mentions").select(["comment_id", "user_id"]).where("comment_id", "in", [...commentIds]).execute();
  }
}

export const commentRepo = new CommentRepository();
