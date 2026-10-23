/**
 * Posts: create (with tags, mentions, media, a poll or a share), edit, delete, pin, lock,
 * bookmark and hide. Feeds and lists are in feed.service.ts, reactions in
 * reaction.service.ts.
 *
 * Rules (several fix the source system):
 *   - Only ACTIVE members post; communities with allowMemberPosts off accept posts from
 *     moderators only. Suspended members and suspended accounts cannot post.
 *   - ANNOUNCEMENT is for moderators; an author cannot promote their own post.
 *   - A held post (pre-moderation) is PENDING_REVIEW: visible to its author and the
 *     community's moderators only, not counted, no points, no feed signal. Its
 *     PREMODERATION case opens in the same transaction; mentions are sent on approval.
 *   - Mentions notify only people who can read the community, so a private
 *     community's text never reaches a non-member through a notification snippet.
 *   - A post from a private community cannot be shared outside it.
 */
import type { Post } from "@open-social/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { newMentions, parseMentions } from "../domain/mentions";
import { collectTags, parseHashtags } from "../domain/tags";
import { presentPost } from "../presenters/post.presenter";
import { rooms } from "../realtime/port";
import { bookmarkRepo } from "../repositories/bookmark.repository";
import { pollRepo } from "../repositories/poll.repository";
import { postRepo, type PostRow } from "../repositories/post.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import * as counters from "./counters.service";
import { claimUploads } from "./media-attach.service";
import { loadContext, memberError, type CommunityContext } from "./membership.service";
import { notify } from "./notification.service";
import { openCaseFor } from "./moderation/cases.service";
import { recordModeratorRemoval } from "./moderation/removal";
import { loadTarget } from "./moderation/targets";
import { requiresPremoderation } from "./premoderation.service";

export interface PollInput {
  question: string;
  options: string[];
  allowMultiple?: boolean;
  isAnonymous?: boolean;
  closesAt?: string | null;
}

export interface CreatePostInput {
  communityId: string;
  body: string;
  kind?: "POST" | "ANNOUNCEMENT";
  feeling?: string | null;
  tags?: string[];
  mediaIds?: string[];
  poll?: PollInput;
  sharedPostId?: string;
}

/**
 * Load a post the viewer may see, with its community context. 404 (never 403) when it
 * does not exist, is deleted or removed, sits in a community the viewer cannot read, or
 * is by someone with a block either way. PENDING_REVIEW and HIDDEN posts are visible to
 * their author and the community's moderators only, unless `publishedOnly`.
 */
export async function loadReadablePost(viewer: Actor | null, postId: string, exec: Executor = db, opts: { publishedOnly?: boolean; lock?: boolean } = {}): Promise<{ post: PostRow; ctx: CommunityContext }> {
  const post = opts.lock ? await postRepo.findByIdForUpdate(postId, exec) : await postRepo.findById(postId, exec);
  if (!post || post.status === "DELETED" || post.status === "REMOVED") throw notFound("Post not found");
  const ctx = await loadContext(viewer, post.community_id, exec).catch(() => {
    throw notFound("Post not found");
  });
  if (!ctx.access.canRead) throw notFound("Post not found");
  if (viewer && viewer.id !== post.author_id && (await isBlockedEitherWay(viewer.id, post.author_id, exec))) throw notFound("Post not found");
  if (post.status !== "PUBLISHED") {
    const allowed = !opts.publishedOnly && (viewer?.id === post.author_id || ctx.access.canModerate);
    if (!allowed) throw notFound("Post not found");
  }
  return { post, ctx };
}

/** Resolve @usernames to user ids: existing, active accounts with no block against the author. */
export async function resolveMentions(authorId: string, usernames: readonly string[], exec: Executor): Promise<string[]> {
  if (!usernames.length) return [];
  const rows = await exec.selectFrom("users").select(["id", "username"]).where("username", "in", [...usernames]).where("status", "=", "ACTIVE").execute();
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === authorId) continue;
    if (await isBlockedEitherWay(authorId, r.id, exec)) continue;
    out.push(r.id);
  }
  return out;
}

/** Of these users, the ones who can read the community (members of a private one). */
export async function readersOf(ctx: CommunityContext, userIds: readonly string[], exec: Executor): Promise<string[]> {
  if (!userIds.length) return [];
  if (ctx.community.visibility === "PUBLIC") return [...userIds];
  const rows = await exec
    .selectFrom("community_members")
    .select("user_id")
    .where("community_id", "=", ctx.community.id)
    .where("status", "=", "ACTIVE")
    .where("user_id", "in", [...userIds])
    .execute();
  return rows.map((r) => r.user_id);
}

async function notifyMentions(
  actor: Actor,
  ctx: CommunityContext,
  userIds: readonly string[],
  target: { entityType: "post" | "comment"; entityId: string; postId: string; snippet: string },
  fx: Effects,
  exec: Executor,
): Promise<void> {
  for (const recipientId of await readersOf(ctx, userIds, exec)) {
    await notify(
      {
        recipientId,
        actorId: actor.id,
        type: "MENTION",
        entityType: target.entityType,
        entityId: target.entityId,
        communityId: ctx.community.id,
        snippet: target.snippet,
        data: { postId: target.postId },
      },
      fx,
      exec,
    );
  }
}
export { notifyMentions };

export async function create(actor: Actor, input: CreatePostInput): Promise<Post> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const ctx = await loadContext(actor, input.communityId, trx);
    if (!ctx.access.canRead) throw notFound("Community not found");
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (!ctx.access.canPost) throw forbidden("Only moderators can post in this community", "POSTING_RESTRICTED");
    const kind = input.kind ?? "POST";
    if (kind === "ANNOUNCEMENT" && !ctx.access.canModerate) throw forbidden("Only moderators can post announcements", "ANNOUNCEMENT_MODS_ONLY");
    const body = input.body ?? "";
    if (!body.trim() && !input.mediaIds?.length && !input.poll && !input.sharedPostId) throw badRequest("Write something first", "EMPTY_POST");

    let sharedId: string | null = null;
    if (input.sharedPostId) {
      const { post: shared } = await loadReadablePost(actor, input.sharedPostId, trx, { publishedOnly: true });
      const rootId = shared.shared_post_id ?? shared.id;
      const { post: root, ctx: rootCtx } = rootId === shared.id ? { post: shared, ctx: null } : await loadReadablePost(actor, rootId, trx, { publishedOnly: true });
      const rootVisibility = rootCtx ? rootCtx.community.visibility : (await loadContext(actor, root.community_id, trx)).community.visibility;
      if (rootVisibility === "PRIVATE" && root.community_id !== ctx.community.id) throw badRequest("Posts from a private community cannot be shared outside it", "SHARE_NOT_ALLOWED");
      sharedId = root.id;
    }

    const media = await claimUploads(actor.id, input.mediaIds ?? [], "POST", trx);
    const held = await requiresPremoderation(actor, ctx.community, { isCommunityModerator: ctx.access.canModerate }, trx);
    const post = await postRepo.insert(
      {
        id: newId(),
        community_id: ctx.community.id,
        author_id: actor.id,
        kind,
        body,
        feeling: input.feeling ?? null,
        shared_post_id: sharedId,
        status: held ? "PENDING_REVIEW" : "PUBLISHED",
        created_at: new Date(),
      },
      trx,
    );
    await postRepo.setTags(post.id, collectTags(input.tags, body), trx);
    const mentioned = await resolveMentions(actor.id, parseMentions(body), trx);
    await postRepo.setMentions(post.id, mentioned, trx);
    await postRepo.insertMedia(post.id, media.map((m) => m.id), trx);
    if (input.poll) {
      await pollRepo.create(
        {
          id: newId(),
          postId: post.id,
          question: input.poll.question,
          allowMultiple: input.poll.allowMultiple ?? false,
          isAnonymous: input.poll.isAnonymous ?? false,
          closesAt: input.poll.closesAt ? new Date(input.poll.closesAt) : null,
          options: input.poll.options.map((label) => ({ id: newId(), label })),
        },
        trx,
      );
    }
    if (sharedId) await postRepo.adjust(sharedId, { shares: 1 }, trx);

    if (post.status === "PUBLISHED") {
      await counters.postPublished(post, trx);
      await notifyMentions(actor, ctx, mentioned, { entityType: "post", entityId: post.id, postId: post.id, snippet: body }, fx, trx);
      fx.emit([rooms.community(ctx.community.id)], "feed:new-posts", { communityId: ctx.community.id, count: 1, latestId: post.id });
    } else {
      // Held for review: the case opens with the post, so it reaches the queue even when
      // moderation is off or the provider is failing. Mentions wait for the approval.
      const info = await loadTarget("POST", post.id, trx);
      if (info) await openCaseFor(info, "PREMODERATION", {}, trx, fx);
    }
    fx.job("moderation.scan", { targetType: "POST", targetId: post.id });
    return post;
  });
  return presentPost(actor, row);
}

export async function get(viewer: Actor | null, postId: string): Promise<Post> {
  const { post } = await loadReadablePost(viewer, postId);
  return presentPost(viewer, post);
}

export async function update(actor: Actor, postId: string, patch: { body?: string; tags?: string[]; feeling?: string | null }): Promise<Post> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { post, ctx } = await loadReadablePost(actor, postId, trx, { lock: true });
    if (post.author_id !== actor.id) throw forbidden("Only the author can edit this post", "NOT_AUTHOR");
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (post.status === "HIDDEN") throw conflict("This post is under review and cannot be edited", "POST_UNDER_REVIEW");
    const body = patch.body ?? post.body;
    if (patch.body !== undefined && !body.trim()) {
      const hasOther = !!post.shared_post_id || (await trx.selectFrom("post_media").select("upload_id").where("post_id", "=", post.id).executeTakeFirst()) || (await trx.selectFrom("polls").select("id").where("post_id", "=", post.id).executeTakeFirst());
      if (!hasOther) throw badRequest("Write something first", "EMPTY_POST");
    }
    const updated = await postRepo.update(
      post.id,
      { body, ...(patch.feeling !== undefined ? { feeling: patch.feeling } : {}), edited_at: patch.body !== undefined && patch.body !== post.body ? new Date() : post.edited_at },
      trx,
    );
    if (patch.body !== undefined || patch.tags !== undefined) {
      // Without an explicit list, keep the tags that did not come from the old body's hashtags.
      const oldHashtags = new Set(parseHashtags(post.body));
      const explicit = patch.tags ?? (await postRepo.tagsFor([post.id], trx)).map((t) => String(t.tag).toLowerCase()).filter((t) => !oldHashtags.has(t));
      await postRepo.setTags(post.id, collectTags(explicit, body), trx);
    }
    if (patch.body !== undefined && patch.body !== post.body) {
      const mentioned = await resolveMentions(actor.id, parseMentions(body), trx);
      await postRepo.setMentions(post.id, mentioned, trx);
      if (updated.status === "PUBLISHED") {
        const fresh = await resolveMentions(actor.id, newMentions(post.body, body), trx);
        await notifyMentions(actor, ctx, fresh, { entityType: "post", entityId: post.id, postId: post.id, snippet: body }, fx, trx);
      }
      fx.job("moderation.scan", { targetType: "POST", targetId: post.id });
    }
    return updated;
  });
  return presentPost(actor, row);
}

/** The author deletes (DELETED); a moderator removing someone else's post marks it REMOVED. */
export async function remove(actor: Actor, postId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const { post, ctx } = await loadReadablePost(actor, postId, trx, { lock: true });
    const isAuthor = post.author_id === actor.id;
    if (!isAuthor && !ctx.access.canModerate) throw forbidden("You cannot delete this post", "NOT_AUTHOR");
    const next = isAuthor ? "DELETED" : "REMOVED";
    await postRepo.update(post.id, { status: next, is_pinned: false }, trx);
    if (post.status === "PUBLISHED") await counters.postUnpublished(post, trx);
    if (!isAuthor) await recordModeratorRemoval(actor.id, { type: "POST", id: post.id, communityId: post.community_id, reason: "Removed by a moderator", auditAction: "post.remove" }, trx);
    fx.emit([rooms.post(post.id), rooms.community(post.community_id)], "post:removed", { postId: post.id });
  });
}

async function moderatorFlag(actor: Actor, postId: string, patch: { is_pinned?: boolean; is_locked?: boolean }): Promise<Post> {
  requireActive(actor);
  const row = await withTransaction(async (trx) => {
    const { post, ctx } = await loadReadablePost(actor, postId, trx, { publishedOnly: true, lock: true });
    if (!ctx.access.canModerate) throw forbidden("Only moderators can do that", "NOT_A_MODERATOR");
    const pinnedAt = patch.is_pinned === undefined ? {} : { pinned_at: patch.is_pinned ? new Date() : null };
    return postRepo.update(post.id, { ...patch, ...pinnedAt }, trx);
  });
  return presentPost(actor, row);
}

export const pin = (actor: Actor, postId: string) => moderatorFlag(actor, postId, { is_pinned: true });
export const unpin = (actor: Actor, postId: string) => moderatorFlag(actor, postId, { is_pinned: false });
export const lock = (actor: Actor, postId: string) => moderatorFlag(actor, postId, { is_locked: true });
export const unlock = (actor: Actor, postId: string) => moderatorFlag(actor, postId, { is_locked: false });

export async function bookmark(actor: Actor, postId: string): Promise<void> {
  await loadReadablePost(actor, postId, db, { publishedOnly: true });
  await bookmarkRepo.add(actor.id, postId);
}

export async function unbookmark(actor: Actor, postId: string): Promise<void> {
  await bookmarkRepo.remove(actor.id, postId);
}

export async function hide(actor: Actor, postId: string): Promise<void> {
  await loadReadablePost(actor, postId, db, { publishedOnly: true });
  await bookmarkRepo.hide(actor.id, postId);
}
