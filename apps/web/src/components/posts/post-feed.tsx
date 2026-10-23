"use client";

import type { ReactNode } from "react";
import type { Page, Post } from "@open-social/types";
import { EmptyState } from "@open-social/ui";
import { Newspaper } from "lucide-react";
import { usePagedList } from "@/lib/hooks/queries";
import { ErrorState, LoadMore } from "@/components/common/states";
import { PostCard, PostSkeleton } from "./post-card";

/** An infinite list of PostCards over any Page<Post> endpoint. */
export function PostFeed({
  queryKey,
  fetchPage,
  empty,
  showCommunity = true,
  enabled,
  exclude,
}: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<Page<Post>>;
  empty?: ReactNode;
  showCommunity?: boolean;
  enabled?: boolean;
  /** Ids already shown above (pinned posts). */
  exclude?: Set<string>;
}) {
  const list = usePagedList<Post>({ queryKey, fetchPage, enabled });
  const posts = exclude ? list.items.filter((p) => !exclude.has(p.id)) : list.items;
  if (list.isPending) {
    return (
      <div className="space-y-4">
        <PostSkeleton />
        <PostSkeleton media={false} />
      </div>
    );
  }
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!posts.length) return <>{empty ?? <EmptyState icon={<Newspaper />} title="No posts yet" description="When people post, you will see it here." />}</>;
  return (
    <div className="space-y-4" data-testid="post-feed">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} showCommunity={showCommunity} />
      ))}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} endLabel={posts.length > 5 ? "You are all caught up" : undefined} />
    </div>
  );
}
