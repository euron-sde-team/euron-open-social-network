/**
 * Reactions on posts and comments. The parent row is locked for the change, so two
 * concurrent toggles by the same person cannot double count. The first reaction by a
 * person earns the author points (+2 on a post, +1 on a comment) and notifies them;
 * removing it takes the points back. Live counts go to the post room after commit.
 */
import type { ReactionCounts, ReactionType, UserSummary } from "@open-social/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { notFound } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { toReactionCounts } from "../presenters/post.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { rooms } from "../realtime/port";
import { commentRepo, type CommentRow } from "../repositories/comment.repository";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { reactionRepo } from "../repositories/reaction.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { memberError } from "./membership.service";
import { notify } from "./notification.service";
import * as points from "./points.service";
import { loadReadablePost } from "./post.service";

export interface ReactionState {
  reactionCount: number;
  reactionCounts: ReactionCounts;
  viewerReaction: ReactionType | null;
}

function emitPostCounts(fx: Effects, post: { id: string; reaction_count: number; reaction_counts: unknown; comment_count: number }) {
  fx.emit([rooms.post(post.id)], "post:updated", {
    postId: post.id,
    reactionCount: post.reaction_count,
    reactionCounts: toReactionCounts(post.reaction_counts),
    commentCount: post.comment_count,
  });
}

export async function setPostReaction(actor: Actor, postId: string, type: ReactionType | null): Promise<ReactionState> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { post, ctx } = await loadReadablePost(actor, postId, trx, { publishedOnly: true, lock: true });
    if (!ctx.access.canInteract) throw memberError(ctx);
    const prev = await reactionRepo.find("post", post.id, actor.id, trx);
    if (prev === type) return { reactionCount: post.reaction_count, reactionCounts: toReactionCounts(post.reaction_counts), viewerReaction: prev };
    if (type) await reactionRepo.set("post", post.id, actor.id, type, trx);
    else await reactionRepo.remove("post", post.id, actor.id, trx);
    const counts = await reactionRepo.applyDelta("post", post.id, prev, type, trx);
    const award = { userId: post.author_id, reason: "post_reaction_received" as const, entityType: "post", entityId: post.id, actorId: actor.id };
    if (post.author_id !== actor.id) {
      if (!prev && type) {
        await points.award(award, trx);
        await notify(
          { recipientId: post.author_id, actorId: actor.id, type: "POST_REACTION", entityType: "post", entityId: post.id, communityId: post.community_id, snippet: post.body, data: { postId: post.id, reaction: type } },
          fx,
          trx,
        );
      } else if (prev && !type) await points.revoke(award, trx);
    }
    emitPostCounts(fx, { id: post.id, reaction_count: counts.reaction_count, reaction_counts: counts.reaction_counts, comment_count: post.comment_count });
    return { reactionCount: counts.reaction_count, reactionCounts: toReactionCounts(counts.reaction_counts), viewerReaction: type };
  });
}

/** A comment the viewer may see: PUBLISHED, on a visible post, by someone with no block. */
export async function loadReadableComment(viewer: Actor | null, commentId: string, exec: Executor = db, opts: { lock?: boolean } = {}) {
  const comment = opts.lock ? await commentRepo.findByIdForUpdate(commentId, exec) : await commentRepo.findById(commentId, exec);
  if (!comment || comment.status !== "PUBLISHED") throw notFound("Comment not found");
  const { post, ctx } = await loadReadablePost(viewer, comment.post_id, exec, { publishedOnly: true });
  if (viewer && viewer.id !== comment.author_id && (await isBlockedEitherWay(viewer.id, comment.author_id, exec))) throw notFound("Comment not found");
  return { comment, post, ctx };
}

export async function setCommentReaction(actor: Actor, commentId: string, type: ReactionType | null): Promise<ReactionState> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { comment, post, ctx } = await loadReadableComment(actor, commentId, trx, { lock: true });
    if (!ctx.access.canInteract) throw memberError(ctx);
    const prev = await reactionRepo.find("comment", comment.id, actor.id, trx);
    if (prev === type) return { reactionCount: comment.reaction_count, reactionCounts: toReactionCounts(comment.reaction_counts), viewerReaction: prev };
    if (type) await reactionRepo.set("comment", comment.id, actor.id, type, trx);
    else await reactionRepo.remove("comment", comment.id, actor.id, trx);
    const counts = await reactionRepo.applyDelta("comment", comment.id, prev, type, trx);
    const award = { userId: comment.author_id, reason: "comment_reaction_received" as const, entityType: "comment", entityId: comment.id, actorId: actor.id };
    if (comment.author_id !== actor.id) {
      if (!prev && type) {
        await points.award(award, trx);
        await notify(
          {
            recipientId: comment.author_id,
            actorId: actor.id,
            type: "COMMENT_REACTION",
            entityType: "comment",
            entityId: comment.id,
            communityId: post.community_id,
            snippet: comment.body,
            data: { postId: post.id, commentId: comment.id, reaction: type },
          },
          fx,
          trx,
        );
      } else if (prev && !type) await points.revoke(award, trx);
    }
    return { reactionCount: counts.reaction_count, reactionCounts: toReactionCounts(counts.reaction_counts), viewerReaction: type };
  });
}

export async function listPostReactions(viewer: Actor | null, postId: string, q: { type?: ReactionType; cursor?: string; limit: number }): Promise<Paged<{ user: UserSummary; type: ReactionType }>> {
  await loadReadablePost(viewer, postId, db, { publishedOnly: true });
  const rows = await reactionRepo.list("post", postId, viewer?.id ?? null, q.type, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const users = await loadSummaries(page.items.map((r) => r.id));
  return { items: page.items.filter((r) => users.has(r.id)).map((r) => ({ user: users.get(r.id)!, type: r.type })), nextCursor: page.nextCursor };
}

export type { CommentRow };
