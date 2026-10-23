"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Post } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { updatePostEverywhere } from "@/lib/post-cache";
import { useRoom, useSocketEvent } from "@/lib/realtime/provider";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { PostCard, PostSkeleton } from "./post-card";

/** One post with its full comment thread and live counts. */
export function PostDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.post(id), queryFn: () => api().posts.get(id) });
  useRoom("post", q.data ? id : null);
  useSocketEvent("post:updated", (p) => {
    if (p.postId !== id) return;
    updatePostEverywhere(qc, id, (post: Post) => ({ ...post, reactionCount: p.reactionCount, reactionCounts: p.reactionCounts, commentCount: p.commentCount }));
  });
  useSocketEvent("post:comment", (p) => {
    if (p.postId !== id) return;
    void qc.invalidateQueries({ queryKey: qk.comments(id) });
  });
  useSocketEvent("post:removed", (p) => {
    if (p.postId === id) qc.setQueryData(qk.post(id), (old: Post | undefined) => (old ? { ...old, status: "REMOVED" as const } : old));
  });

  if (q.isPending) return <PostSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.status === "REMOVED" || q.data.status === "DELETED") return <NotFoundState title="This post is no longer available" />;
  return <PostCard post={q.data} detail />;
}
