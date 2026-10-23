/**
 * A post can sit in many caches at once (home feed, community feed, profile,
 * tag page, saved, post detail, search). These helpers update or remove it
 * everywhere, which is what optimistic reactions and bookmarks need.
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Page, Post } from "@open-social/types";

const POST_LIST_ROOTS = new Set(["feed", "community-posts", "community-pinned", "user-posts", "tag-posts", "bookmarks", "search"]);

type Snapshot = [readonly unknown[], unknown][];

function mapPost(post: Post, id: string, fn: (p: Post) => Post): Post {
  if (post.id === id) return fn(post);
  if (post.sharedPost && post.sharedPost.id === id) return { ...post, sharedPost: fn(post.sharedPost) };
  return post;
}

function transform(data: unknown, id: string, fn: ((p: Post) => Post) | null): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  // Infinite query of Page<Post>
  if (Array.isArray(d.pages)) {
    const inf = data as InfiniteData<Page<Post>>;
    return {
      ...inf,
      pages: inf.pages.map((p) => ({
        ...p,
        items: fn ? p.items.map((x) => mapPost(x, id, fn)) : p.items.filter((x) => x.id !== id),
      })),
    };
  }
  // Plain Post[] (pinned)
  if (Array.isArray(data)) {
    const arr = data as Post[];
    return fn ? arr.map((x) => mapPost(x, id, fn)) : arr.filter((x) => x.id !== id);
  }
  // Search results { posts: Post[] }
  if (Array.isArray(d.posts)) {
    const posts = d.posts as Post[];
    return { ...d, posts: fn ? posts.map((x) => mapPost(x, id, fn)) : posts.filter((x) => x.id !== id) };
  }
  // Single Post
  if (typeof d.id === "string" && "author" in d) return fn ? mapPost(data as Post, id, fn) : data;
  return data;
}

const isPostList = (key: readonly unknown[]) => typeof key[0] === "string" && POST_LIST_ROOTS.has(key[0]);

/** Apply `fn` to the post with `id` in every cache; returns a snapshot for rollback. */
export function updatePostEverywhere(qc: QueryClient, id: string, fn: (p: Post) => Post): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData({ predicate: (q) => isPostList(q.queryKey) || (q.queryKey[0] === "post") })) {
    snapshot.push([key, data]);
    qc.setQueryData(key, transform(data, id, fn));
  }
  return snapshot;
}

export function removePostEverywhere(qc: QueryClient, id: string): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData({ predicate: (q) => isPostList(q.queryKey) })) {
    snapshot.push([key, data]);
    qc.setQueryData(key, transform(data, id, null));
  }
  return snapshot;
}

export function restoreSnapshot(qc: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/** Prepend a freshly created post to the home feed (latest) and its community feed. */
export function prependPost(qc: QueryClient, post: Post) {
  const add = (data: InfiniteData<Page<Post>> | undefined) => {
    if (!data) return data;
    if (data.pages.some((p) => p.items.some((x) => x.id === post.id))) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...(first ?? { nextCursor: null, items: [] }), items: [post, ...(first?.items ?? [])] }, ...rest] };
  };
  qc.setQueryData<InfiniteData<Page<Post>>>(["feed", "latest"], add);
  qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: ["community-posts", post.community.id, "new"] }, add);
  qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: ["user-posts", post.author.username] }, add);
}
