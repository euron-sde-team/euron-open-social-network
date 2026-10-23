/**
 * Post rows to DTOs. A whole page is presented with a fixed number of queries: one per
 * relation (communities, memberships, tags, mentions, media, polls, shared posts,
 * viewer reactions, bookmarks, blocks), never one per post.
 *
 * Mentions of people the viewer has a block with are dropped. A shared post is
 * presented only if the viewer may see it (otherwise `sharedPost` is null).
 */
import type { Post, ReactionCounts, ReactionType } from "@open-social/types";
import { REACTIONS } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Access } from "../domain/community-access";
import { bookmarkRepo } from "../repositories/bookmark.repository";
import { communityRepo } from "../repositories/community.repository";
import { pollRepo } from "../repositories/poll.repository";
import { postRepo, type PostRow } from "../repositories/post.repository";
import { reactionRepo } from "../repositories/reaction.repository";
import { blockedSet } from "../repositories/visibility";
import { accessMap } from "./community.presenter";
import { loadMedia, urlOf } from "./media.presenter";
import { presentPolls } from "./poll.presenter";
import { loadSummaries } from "./user.presenter";

export function toReactionCounts(raw: unknown): ReactionCounts {
  const out: ReactionCounts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const type of REACTIONS) {
    const n = Number((raw as Record<string, unknown>)[type] ?? 0);
    if (n > 0) out[type as ReactionType] = n;
  }
  return out;
}

export async function presentPosts(viewer: Actor | null, rows: readonly PostRow[], exec: Executor = db, depth = 0): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sharedIds = depth === 0 ? rows.map((r) => r.shared_post_id).filter((x): x is string => !!x) : [];

  const [communities, tags, mentions, mediaLinks, polls, reactions, bookmarks, blocked, sharedRows] = await Promise.all([
    communityRepo.findMany(rows.map((r) => r.community_id), exec),
    postRepo.tagsFor(ids, exec),
    postRepo.mentionsFor(ids, exec),
    postRepo.mediaFor(ids, exec),
    pollRepo.forPosts(ids, exec),
    reactionRepo.viewerReactions("post", viewer?.id, ids, exec),
    bookmarkRepo.bookmarkedSet(viewer?.id, ids, exec),
    viewer ? blockedSet(viewer.id, exec) : Promise.resolve(new Set<string>()),
    sharedIds.length ? postRepo.visibleByIds(viewer, sharedIds, exec) : Promise.resolve([] as PostRow[]),
  ]);

  const visibleMentionIds = mentions.filter((m) => !blocked.has(m.user_id));
  const [access, users, media, pollDtos, shared] = await Promise.all([
    accessMap(viewer, communities, exec),
    loadSummaries([...rows.map((r) => r.author_id), ...visibleMentionIds.map((m) => m.user_id)], exec),
    loadMedia([...communities.map((c) => c.icon_upload_id), ...mediaLinks.map((m) => m.upload_id)], exec),
    presentPolls(viewer, polls, exec),
    sharedRows.length ? presentPosts(viewer, sharedRows, exec, depth + 1) : Promise.resolve([] as Post[]),
  ]);

  const communityById = new Map(communities.map((c) => [c.id, c]));
  const pollByPost = new Map(polls.map((p) => [p.post_id, pollDtos.get(p.id) ?? null]));
  const sharedById = new Map(shared.map((p) => [p.id, p]));

  const out: Post[] = [];
  for (const r of rows) {
    const c = communityById.get(r.community_id);
    const author = users.get(r.author_id);
    if (!c || !author) continue;
    const a = access.get(c.id) as Access;
    const isAuthor = viewer?.id === r.author_id;
    const active = viewer?.status === "ACTIVE";
    out.push({
      id: r.id,
      kind: r.kind,
      community: { id: c.id, slug: c.slug, name: c.name, iconUrl: urlOf(media, c.icon_upload_id, "thumb"), visibility: c.visibility },
      author,
      body: r.body,
      feeling: r.feeling,
      tags: tags.filter((t) => t.post_id === r.id).map((t) => String(t.tag).toLowerCase()),
      mentions: visibleMentionIds.filter((m) => m.post_id === r.id).map((m) => users.get(m.user_id)).filter((u): u is NonNullable<typeof u> => !!u),
      media: mediaLinks
        .filter((m) => m.post_id === r.id)
        .map((m) => media.get(m.upload_id))
        .filter((m): m is NonNullable<typeof m> => !!m),
      poll: pollByPost.get(r.id) ?? null,
      sharedPost: r.shared_post_id ? (sharedById.get(r.shared_post_id) ?? null) : null,
      status: r.status,
      isPinned: r.is_pinned,
      isLocked: r.is_locked,
      reactionCount: r.reaction_count,
      reactionCounts: toReactionCounts(r.reaction_counts),
      commentCount: r.comment_count,
      shareCount: r.share_count,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      viewer: {
        reaction: reactions.get(r.id) ?? null,
        bookmarked: bookmarks.has(r.id),
        canEdit: isAuthor && active && r.status !== "REMOVED" && r.status !== "DELETED",
        canDelete: (isAuthor && active) || a.canModerate,
        canModerate: a.canModerate,
      },
    });
  }
  return out;
}

export async function presentPost(viewer: Actor | null, row: PostRow, exec: Executor = db): Promise<Post> {
  const [p] = await presentPosts(viewer, [row], exec);
  if (!p) throw new Error(`post ${row.id} could not be presented`);
  return p;
}
