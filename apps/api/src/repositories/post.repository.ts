/**
 * Posts and their tags, mentions and media. Every list starts from `visible()`, which
 * applies the visibility rules (PUBLISHED, live community, private communities only for
 * members, blocks both ways), so no feed can forget one.
 *
 * Ranked lists mirror domain/ranking.ts:
 *   top  (reaction_count + 2 * comment_count)
 *   hot  top / max(1, age in hours at the cursor's reference time)
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql, type RawBuilder } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Posts } from "../db/types";
import { COMMENT_WEIGHT, TOP_WINDOW_DAYS } from "../domain/ranking";
import { atKey, belowScore, olderThan, type ScoreKey, type TimeKey } from "./keyset";
import { tsMatches } from "./text-search";
import { canReadCommunity, notBlocked } from "./visibility";

export type PostRow = Selectable<Posts>;
export type ListedPost = PostRow & { _at: string; _score?: number };

export const topScoreSql = sql<number>`((p.reaction_count + ${sql.lit(COMMENT_WEIGHT)} * p.comment_count)::float8)`;
export function hotScoreSql(ref: string): RawBuilder<number> {
  return sql<number>`((p.reaction_count + ${sql.lit(COMMENT_WEIGHT)} * p.comment_count)::float8 / greatest(1::float8, (extract(epoch from (${ref}::timestamptz - p.created_at)) / 3600)::float8))`;
}

export class PostRepository {
  /** The visible-posts base query, aliased `p` (posts) and `c` (communities). */
  visible(viewer: Actor | null, exec: Executor = db) {
    return exec
      .selectFrom("posts as p")
      .innerJoin("communities as c", "c.id", "p.community_id")
      .selectAll("p")
      .select(atKey("p.created_at"))
      .where("c.status", "=", "PUBLISHED")
      .where("p.status", "=", "PUBLISHED")
      .where(notBlocked(viewer?.id, "p.author_id"))
      .where(canReadCommunity(viewer, "p.community_id"));
  }

  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("posts").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("posts").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  visibleByIds(viewer: Actor | null, ids: readonly string[], exec: Executor = db): Promise<ListedPost[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.visible(viewer, exec).where("p.id", "in", [...new Set(ids)]).execute();
  }

  async communityFeed(
    viewer: Actor | null,
    communityId: string,
    opts: { sort: "new" | "top" | "hot"; tag?: string; cursor: string | undefined; limit: number; time: TimeKey | null; score: ScoreKey | null; ref: string },
    exec: Executor = db,
  ): Promise<ListedPost[]> {
    let q = this.visible(viewer, exec).where("p.community_id", "=", communityId);
    if (opts.tag) q = q.where((eb) => eb.exists(eb.selectFrom("post_tags as t").select("t.post_id").whereRef("t.post_id", "=", "p.id").where("t.tag", "=", opts.tag as string)));
    if (opts.sort === "new") {
      return q.where(olderThan("p.created_at", "p.id", opts.time)).orderBy("p.created_at", "desc").orderBy("p.id", "desc").limit(opts.limit + 1).execute();
    }
    const score = opts.sort === "top" ? topScoreSql : hotScoreSql(opts.ref);
    return q
      .select(score.as("_score"))
      .where(belowScore(score, "p.id", opts.score))
      .orderBy(score, "desc")
      .orderBy("p.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  pinned(viewer: Actor | null, communityId: string, exec: Executor = db) {
    return this.visible(viewer, exec).where("p.community_id", "=", communityId).where("p.is_pinned", "=", true).orderBy("p.pinned_at", "desc").limit(10).execute();
  }

  /** Your communities, plus public posts by people you follow, minus posts you hid. */
  async homeFeed(viewer: Actor, opts: { sort: "latest" | "top"; time: TimeKey | null; score: ScoreKey | null; limit: number }, exec: Executor = db): Promise<ListedPost[]> {
    const q = this.visible(viewer, exec)
      .where((eb) =>
        eb.or([
          eb.exists(eb.selectFrom("community_members as fm").select("fm.id").whereRef("fm.community_id", "=", "p.community_id").where("fm.user_id", "=", viewer.id).where("fm.status", "=", "ACTIVE")),
          eb.and([
            eb("c.visibility", "=", "PUBLIC"),
            eb.exists(eb.selectFrom("follows as f").select("f.followee_id").where("f.follower_id", "=", viewer.id).whereRef("f.followee_id", "=", "p.author_id")),
          ]),
        ]),
      )
      .where((eb) => eb.not(eb.exists(eb.selectFrom("post_hides as h").select("h.post_id").where("h.user_id", "=", viewer.id).whereRef("h.post_id", "=", "p.id"))));
    if (opts.sort === "latest") {
      return q.where(olderThan("p.created_at", "p.id", opts.time)).orderBy("p.created_at", "desc").orderBy("p.id", "desc").limit(opts.limit + 1).execute();
    }
    return q
      .select(topScoreSql.as("_score"))
      .where("p.created_at", ">", sql<Date>`now() - ${sql.lit(`${TOP_WINDOW_DAYS} days`)}::interval`)
      .where(belowScore(topScoreSql, "p.id", opts.score))
      .orderBy(topScoreSql, "desc")
      .orderBy("p.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  /** A profile's posts. The author also sees their own pending and hidden posts. */
  byAuthor(viewer: Actor | null, authorId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const own = viewer?.id === authorId;
    return exec
      .selectFrom("posts as p")
      .innerJoin("communities as c", "c.id", "p.community_id")
      .selectAll("p")
      .select(atKey("p.created_at"))
      .where("p.author_id", "=", authorId)
      .where("c.status", "=", "PUBLISHED")
      .where("p.status", "in", own ? ["PUBLISHED", "PENDING_REVIEW", "HIDDEN"] : ["PUBLISHED"])
      .where(notBlocked(viewer?.id, "p.author_id"))
      .where(canReadCommunity(viewer, "p.community_id"))
      .where(olderThan("p.created_at", "p.id", cursor))
      .orderBy("p.created_at", "desc")
      .orderBy("p.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  byTag(viewer: Actor | null, tag: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec)
      .where((eb) => eb.exists(eb.selectFrom("post_tags as t").select("t.post_id").whereRef("t.post_id", "=", "p.id").where("t.tag", "=", tag)))
      .where(olderThan("p.created_at", "p.id", cursor))
      .orderBy("p.created_at", "desc")
      .orderBy("p.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  search(viewer: Actor | null, q: string, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec).where(tsMatches("p.search", q)).orderBy("p.created_at", "desc").orderBy("p.id", "desc").limit(limit).execute();
  }

  bookmarks(viewer: Actor, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec)
      .innerJoin("post_bookmarks as b", "b.post_id", "p.id")
      .select(atKey("b.created_at", "_bat"))
      .where("b.user_id", "=", viewer.id)
      .where(olderThan("b.created_at", "b.post_id", cursor))
      .orderBy("b.created_at", "desc")
      .orderBy("b.post_id", "desc")
      .limit(limit + 1)
      .execute();
  }

  insert(row: Insertable<Posts>, exec: Executor = db) {
    return exec.insertInto("posts").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Posts>, exec: Executor = db) {
    return exec
      .updateTable("posts")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjust(id: string, delta: { comments?: number; shares?: number }, exec: Executor = db) {
    const comments = delta.comments ?? 0;
    const shares = delta.shares ?? 0;
    if (!comments && !shares) return Promise.resolve(undefined);
    return exec
      .updateTable("posts")
      .set({ comment_count: sql`greatest(0, comment_count + ${comments})`, share_count: sql`greatest(0, share_count + ${shares})` })
      .where("id", "=", id)
      .returning(["id", "reaction_count", "reaction_counts", "comment_count"])
      .executeTakeFirst();
  }

  // ─── Tags, mentions, media ────────────────────────────────────────────────

  async setTags(postId: string, tags: readonly string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("post_tags").where("post_id", "=", postId).execute();
    if (tags.length) await exec.insertInto("post_tags").values(tags.map((tag) => ({ post_id: postId, tag }))).execute();
  }

  tagsFor(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([]);
    return exec.selectFrom("post_tags").select(["post_id", "tag"]).where("post_id", "in", [...postIds]).orderBy("tag").execute();
  }

  async setMentions(postId: string, userIds: readonly string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("post_mentions").where("post_id", "=", postId).execute();
    if (userIds.length) await exec.insertInto("post_mentions").values(userIds.map((user_id) => ({ post_id: postId, user_id }))).execute();
  }

  mentionsFor(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([]);
    return exec.selectFrom("post_mentions").select(["post_id", "user_id"]).where("post_id", "in", [...postIds]).execute();
  }

  async insertMedia(postId: string, uploadIds: readonly string[], exec: Executor = db): Promise<void> {
    if (!uploadIds.length) return;
    await exec
      .insertInto("post_media")
      .values(uploadIds.map((upload_id, position) => ({ post_id: postId, upload_id, position })))
      .execute();
  }

  mediaFor(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([]);
    return exec.selectFrom("post_media").select(["post_id", "upload_id", "position"]).where("post_id", "in", [...postIds]).orderBy("position").execute();
  }

  /** Media of visible posts, newest post first: profile and community media tabs. */
  mediaOf(viewer: Actor | null, scope: { authorId?: string; communityId?: string }, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    let q = this.visible(viewer, exec)
      .innerJoin("post_media as pm", "pm.post_id", "p.id")
      .innerJoin("media_uploads as mu", "mu.id", "pm.upload_id")
      .select(["pm.upload_id"])
      .where("mu.status", "in", ["COMPLETE", "READY"]);
    if (scope.authorId) q = q.where("p.author_id", "=", scope.authorId);
    if (scope.communityId) q = q.where("p.community_id", "=", scope.communityId);
    return q
      .where(olderThan("p.created_at", "pm.upload_id", cursor))
      .orderBy("p.created_at", "desc")
      .orderBy("pm.upload_id", "desc")
      .limit(limit + 1)
      .execute();
  }
}

export const postRepo = new PostRepository();
