/**
 * Every list of posts: the home feed, community feeds (new, top, hot), pinned posts,
 * tag pages, profiles, bookmarks and media tabs. All of them read through
 * postRepo.visible(), so blocks and private communities apply everywhere.
 *
 * Home feed: posts from communities where you are an ACTIVE member, plus posts in
 * PUBLIC communities by people you follow, minus posts you hid. "top" ranks the last
 * seven days by reactions + 2 * comments with a (score, id) cursor; "hot" also pins the
 * reference time in the cursor so scores do not shift between pages.
 */
import type { Media, Post } from "@open-social/types";
import type { Actor } from "../core/context";
import { normalizeTag } from "../domain/tags";
import { loadMedia } from "../presenters/media.presenter";
import { presentPosts } from "../presenters/post.presenter";
import { decodeScore, decodeTime, encodeScore, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { postRepo, type ListedPost } from "../repositories/post.repository";
import { requireReadable } from "./membership.service";

export interface PageQuery {
  cursor?: string;
  limit: number;
}

function nowRef(): string {
  return new Date().toISOString().replace("Z", "000+00");
}

async function present(viewer: Actor | null, page: Paged<ListedPost>): Promise<Paged<Post>> {
  return { items: await presentPosts(viewer, page.items), nextCursor: page.nextCursor };
}

const byTime = (rows: ListedPost[], limit: number) => pageBy(rows, limit, (r) => encodeTime(r._at, r.id));
const byScore = (rows: ListedPost[], limit: number, ref?: string) => pageBy(rows, limit, (r) => encodeScore(Number(r._score ?? 0), r.id, ref));

export async function homeFeed(actor: Actor, q: PageQuery & { sort: "latest" | "top" }): Promise<Paged<Post>> {
  if (q.sort === "latest") {
    const rows = await postRepo.homeFeed(actor, { sort: "latest", time: decodeTime(q.cursor), score: null, limit: q.limit });
    return present(actor, byTime(rows, q.limit));
  }
  const rows = await postRepo.homeFeed(actor, { sort: "top", time: null, score: decodeScore(q.cursor), limit: q.limit });
  return present(actor, byScore(rows, q.limit));
}

export async function communityPosts(viewer: Actor | null, communityId: string, q: PageQuery & { sort: "new" | "top" | "hot"; tag?: string }): Promise<Paged<Post>> {
  await requireReadable(viewer, communityId);
  const tag = q.tag ? (normalizeTag(q.tag) ?? undefined) : undefined;
  if (q.tag && !tag) return { items: [], nextCursor: null };
  if (q.sort === "new") {
    const rows = await postRepo.communityFeed(viewer, communityId, { sort: "new", tag, cursor: q.cursor, limit: q.limit, time: decodeTime(q.cursor), score: null, ref: nowRef() });
    return present(viewer, byTime(rows, q.limit));
  }
  const score = decodeScore(q.cursor);
  const ref = q.sort === "hot" ? (score?.ref ?? nowRef()) : nowRef();
  const rows = await postRepo.communityFeed(viewer, communityId, { sort: q.sort, tag, cursor: q.cursor, limit: q.limit, time: null, score, ref });
  return present(viewer, byScore(rows, q.limit, q.sort === "hot" ? ref : undefined));
}

export async function pinned(viewer: Actor | null, communityId: string): Promise<Post[]> {
  await requireReadable(viewer, communityId);
  return presentPosts(viewer, await postRepo.pinned(viewer, communityId));
}

export async function tagPosts(viewer: Actor | null, rawTag: string, q: PageQuery): Promise<Paged<Post>> {
  const tag = normalizeTag(rawTag);
  if (!tag) return { items: [], nextCursor: null };
  return present(viewer, byTime(await postRepo.byTag(viewer, tag, decodeTime(q.cursor), q.limit), q.limit));
}

export async function authorPosts(viewer: Actor | null, authorId: string, q: PageQuery): Promise<Paged<Post>> {
  return present(viewer, byTime(await postRepo.byAuthor(viewer, authorId, decodeTime(q.cursor), q.limit), q.limit));
}

export async function bookmarks(actor: Actor, q: PageQuery): Promise<Paged<Post>> {
  const rows = await postRepo.bookmarks(actor, decodeTime(q.cursor), q.limit);
  return present(actor, pageBy(rows, q.limit, (r) => encodeTime(r._bat, r.id)));
}

/** Media of visible posts (profile or community media tab). */
export async function media(viewer: Actor | null, scope: { authorId?: string; communityId?: string }, q: PageQuery): Promise<Paged<Media>> {
  if (scope.communityId) await requireReadable(viewer, scope.communityId);
  const rows = await postRepo.mediaOf(viewer, scope, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.upload_id));
  const signed = await loadMedia(page.items.map((r) => r.upload_id));
  return { items: page.items.map((r) => signed.get(r.upload_id)).filter((m): m is Media => !!m), nextCursor: page.nextCursor };
}
