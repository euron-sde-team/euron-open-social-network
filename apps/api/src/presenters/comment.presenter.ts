/**
 * Comment rows to DTOs, batched per page (authors, mentions, media, the viewer's
 * reactions and their moderation rights on the parent posts' communities).
 */
import type { Comment } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Access } from "../domain/community-access";
import type { CommentRow } from "../repositories/comment.repository";
import { commentRepo } from "../repositories/comment.repository";
import { communityRepo } from "../repositories/community.repository";
import { reactionRepo } from "../repositories/reaction.repository";
import { blockedSet } from "../repositories/visibility";
import { accessMap } from "./community.presenter";
import { loadMedia } from "./media.presenter";
import { toReactionCounts } from "./post.presenter";
import { loadSummaries } from "./user.presenter";

export async function presentComments(viewer: Actor | null, rows: readonly CommentRow[], exec: Executor = db): Promise<Comment[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const postIds = [...new Set(rows.map((r) => r.post_id))];
  const [mentions, reactions, blocked, posts] = await Promise.all([
    commentRepo.mentionsFor(ids, exec),
    reactionRepo.viewerReactions("comment", viewer?.id, ids, exec),
    viewer ? blockedSet(viewer.id, exec) : Promise.resolve(new Set<string>()),
    exec.selectFrom("posts").select(["id", "community_id"]).where("id", "in", postIds).execute(),
  ]);
  const communities = await communityRepo.findMany(posts.map((p) => p.community_id), exec);
  const visibleMentions = mentions.filter((m) => !blocked.has(m.user_id));
  const [access, users, media] = await Promise.all([
    accessMap(viewer, communities, exec),
    loadSummaries([...rows.map((r) => r.author_id), ...visibleMentions.map((m) => m.user_id)], exec),
    loadMedia(rows.map((r) => r.upload_id), exec),
  ]);
  const communityOfPost = new Map(posts.map((p) => [p.id, p.community_id]));

  const out: Comment[] = [];
  for (const r of rows) {
    const author = users.get(r.author_id);
    if (!author) continue;
    const a = access.get(communityOfPost.get(r.post_id) ?? "") as Access | undefined;
    const isAuthor = viewer?.id === r.author_id;
    const active = viewer?.status === "ACTIVE";
    out.push({
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id,
      author,
      body: r.body,
      media: r.upload_id ? (media.get(r.upload_id) ?? null) : null,
      mentions: visibleMentions
        .filter((m) => m.comment_id === r.id)
        .map((m) => users.get(m.user_id))
        .filter((u): u is NonNullable<typeof u> => !!u),
      status: r.status,
      replyCount: r.reply_count,
      reactionCount: r.reaction_count,
      reactionCounts: toReactionCounts(r.reaction_counts),
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      viewer: {
        reaction: reactions.get(r.id) ?? null,
        canEdit: isAuthor && active && r.status === "PUBLISHED",
        canDelete: (isAuthor && active) || !!a?.canModerate,
      },
    });
  }
  return out;
}

export async function presentComment(viewer: Actor | null, row: CommentRow, exec: Executor = db): Promise<Comment> {
  const [c] = await presentComments(viewer, [row], exec);
  if (!c) throw new Error(`comment ${row.id} could not be presented`);
  return c;
}
