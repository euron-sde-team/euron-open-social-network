/**
 * Comments and replies. One level of nesting: replying to a reply attaches to the same
 * top-level comment and notifies the person replied to.
 *
 * Counters move in the same transaction (posts.comment_count counts every PUBLISHED
 * comment including replies; comments.reply_count counts PUBLISHED replies). A locked
 * post takes comments from moderators only.
 */
import type { Comment } from "@open-social/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { newMentions, parseMentions } from "../domain/mentions";
import { presentComment, presentComments } from "../presenters/comment.presenter";
import { toReactionCounts } from "../presenters/post.presenter";
import { realtime, rooms } from "../realtime/port";
import { commentRepo } from "../repositories/comment.repository";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { postRepo } from "../repositories/post.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { claimUploads } from "./media-attach.service";
import { memberError } from "./membership.service";
import { recordModeratorRemoval } from "./moderation/removal";
import { notify } from "./notification.service";
import * as points from "./points.service";
import { loadReadablePost, notifyMentions, resolveMentions } from "./post.service";
import { loadReadableComment } from "./reaction.service";

export async function listForPost(viewer: Actor | null, postId: string, q: { cursor?: string; limit: number }): Promise<Paged<Comment>> {
  const { post } = await loadReadablePost(viewer, postId);
  const page = timePage(await commentRepo.list({ postId: post.id, parentId: null }, viewer?.id ?? null, decodeTime(q.cursor), q.limit), q.limit);
  return { items: await presentComments(viewer, page.items), nextCursor: page.nextCursor };
}

export async function listReplies(viewer: Actor | null, commentId: string, q: { cursor?: string; limit: number }): Promise<Paged<Comment>> {
  const { comment } = await loadReadableComment(viewer, commentId);
  const page = timePage(await commentRepo.list({ parentId: comment.id }, viewer?.id ?? null, decodeTime(q.cursor), q.limit), q.limit);
  return { items: await presentComments(viewer, page.items), nextCursor: page.nextCursor };
}

export async function create(actor: Actor, postId: string, input: { body: string; parentId?: string; mediaId?: string }): Promise<Comment> {
  requireActive(actor);
  if (!input.body.trim() && !input.mediaId) throw badRequest("Write something first", "EMPTY_COMMENT");
  const row = await withTransaction(async (trx, fx) => {
    const { post, ctx } = await loadReadablePost(actor, postId, trx, { publishedOnly: true, lock: true });
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (post.is_locked && !ctx.access.canModerate) throw forbidden("Comments are closed on this post", "POST_LOCKED");

    let parent: Awaited<ReturnType<typeof commentRepo.findById>> = undefined;
    let rootId: string | null = null;
    if (input.parentId) {
      parent = await commentRepo.findById(input.parentId, trx);
      if (!parent || parent.post_id !== post.id || parent.status !== "PUBLISHED") throw notFound("Comment not found");
      if (await isBlockedEitherWay(actor.id, parent.author_id, trx)) throw notFound("Comment not found");
      rootId = parent.parent_id ?? parent.id;
    }
    const media = input.mediaId ? await claimUploads(actor.id, [input.mediaId], "COMMENT", trx) : [];

    const comment = await commentRepo.insert(
      { id: newId(), post_id: post.id, author_id: actor.id, parent_id: rootId, body: input.body, upload_id: media[0]?.id ?? null, created_at: new Date() },
      trx,
    );
    const mentioned = await resolveMentions(actor.id, parseMentions(input.body), trx);
    await commentRepo.setMentions(comment.id, mentioned, trx);

    const counts = await postRepo.adjust(post.id, { comments: 1 }, trx);
    if (rootId) await commentRepo.adjustReplies(rootId, 1, trx);
    await points.award({ userId: actor.id, reason: "comment_created", entityType: "comment", entityId: comment.id, actorId: actor.id }, trx);

    const data = { postId: post.id, commentId: comment.id };
    const notified = new Set<string>([actor.id]);
    if (parent) {
      await notify({ recipientId: parent.author_id, actorId: actor.id, type: "COMMENT_REPLY", entityType: "comment", entityId: parent.id, communityId: post.community_id, snippet: input.body, data }, fx, trx);
      notified.add(parent.author_id);
    }
    if (!notified.has(post.author_id)) {
      await notify({ recipientId: post.author_id, actorId: actor.id, type: "POST_COMMENT", entityType: "post", entityId: post.id, communityId: post.community_id, snippet: input.body, data }, fx, trx);
      notified.add(post.author_id);
    }
    await notifyMentions(actor, ctx, mentioned.filter((id) => !notified.has(id)), { entityType: "comment", entityId: comment.id, postId: post.id, snippet: input.body }, fx, trx);

    fx.after(async () => {
      const dto = await presentComment(null, comment);
      realtime.emit([rooms.post(post.id)], "post:comment", { postId: post.id, comment: dto });
    });
    if (counts) {
      fx.emit([rooms.post(post.id)], "post:updated", { postId: post.id, reactionCount: counts.reaction_count, reactionCounts: toReactionCounts(counts.reaction_counts), commentCount: counts.comment_count });
    }
    fx.job("moderation.scan", { targetType: "COMMENT", targetId: comment.id });
    return comment;
  });
  return presentComment(actor, row);
}

export async function update(actor: Actor, commentId: string, body: string): Promise<Comment> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { comment, post, ctx } = await loadReadableComment(actor, commentId, trx, { lock: true });
    if (comment.author_id !== actor.id) throw forbidden("Only the author can edit this comment", "NOT_AUTHOR");
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (!body.trim() && !comment.upload_id) throw badRequest("Write something first", "EMPTY_COMMENT");
    const updated = await commentRepo.update(comment.id, { body, edited_at: body !== comment.body ? new Date() : comment.edited_at }, trx);
    if (body !== comment.body) {
      await commentRepo.setMentions(comment.id, await resolveMentions(actor.id, parseMentions(body), trx), trx);
      const fresh = await resolveMentions(actor.id, newMentions(comment.body, body), trx);
      await notifyMentions(actor, ctx, fresh, { entityType: "comment", entityId: comment.id, postId: post.id, snippet: body }, fx, trx);
      fx.job("moderation.scan", { targetType: "COMMENT", targetId: comment.id });
    }
    return updated;
  });
  return presentComment(actor, row);
}

export async function remove(actor: Actor, commentId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const { comment, post, ctx } = await loadReadableComment(actor, commentId, trx, { lock: true });
    const isAuthor = comment.author_id === actor.id;
    if (!isAuthor && !ctx.access.canModerate) throw forbidden("You cannot delete this comment", "NOT_AUTHOR");
    await commentRepo.update(comment.id, { status: isAuthor ? "DELETED" : "REMOVED" }, trx);
    const counts = await postRepo.adjust(post.id, { comments: -1 }, trx);
    if (comment.parent_id) await commentRepo.adjustReplies(comment.parent_id, -1, trx);
    await points.revokeEntity("comment", comment.id, trx);
    if (!isAuthor) await recordModeratorRemoval(actor.id, { type: "COMMENT", id: comment.id, communityId: post.community_id, reason: "Removed by a moderator", auditAction: "comment.remove", data: { postId: post.id } }, trx);
    if (counts) {
      fx.emit([rooms.post(post.id)], "post:updated", { postId: post.id, reactionCount: counts.reaction_count, reactionCounts: toReactionCounts(counts.reaction_counts), commentCount: counts.comment_count });
    }
  });
}
