/** Bookmarks and "hide from my feed". Listing bookmarks lives in post.repository (it needs the visibility rules). */
import { db, type Executor } from "../db/kysely";

export class BookmarkRepository {
  add(userId: string, postId: string, exec: Executor = db) {
    return exec
      .insertInto("post_bookmarks")
      .values({ user_id: userId, post_id: postId, created_at: new Date() })
      .onConflict((oc) => oc.columns(["user_id", "post_id"]).doNothing())
      .execute();
  }

  remove(userId: string, postId: string, exec: Executor = db) {
    return exec.deleteFrom("post_bookmarks").where("user_id", "=", userId).where("post_id", "=", postId).execute();
  }

  hide(userId: string, postId: string, exec: Executor = db) {
    return exec
      .insertInto("post_hides")
      .values({ user_id: userId, post_id: postId })
      .onConflict((oc) => oc.columns(["user_id", "post_id"]).doNothing())
      .execute();
  }

  async bookmarkedSet(userId: string | null | undefined, postIds: readonly string[], exec: Executor = db): Promise<Set<string>> {
    if (!userId || !postIds.length) return new Set();
    const rows = await exec.selectFrom("post_bookmarks").select("post_id").where("user_id", "=", userId).where("post_id", "in", [...postIds]).execute();
    return new Set(rows.map((r) => r.post_id));
  }
}

export const bookmarkRepo = new BookmarkRepository();
