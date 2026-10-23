"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { flattenAll, nextCursor } from "@open-social/api-client";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, Skeleton, cn } from "@open-social/ui";
import type { Post, ReactionType } from "@open-social/types";
import { api } from "@/lib/api";
import { useInfiniteScroll } from "@/lib/hooks/use-infinite-scroll";
import { qk } from "@/lib/query-keys";
import { REACTION_META, topReactions } from "@/lib/reactions";
import { PersonRow } from "@/components/common/user-bits";

export function ReactionsDialog({ post, open, onOpenChange }: { post: Post; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [type, setType] = useState<ReactionType | undefined>(undefined);
  const q = useInfiniteQuery({
    queryKey: qk.reactions(post.id, type),
    queryFn: ({ pageParam }) => api().posts.reactions(post.id, { cursor: pageParam, type }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: open,
  });
  const rows = flattenAll(q.data?.pages);
  const ref = useInfiniteScroll<HTMLDivElement>(() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage(), { enabled: !!q.hasNextPage });
  const types = topReactions(post.reactionCounts, 7);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Reactions</DialogTitle>
          <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto no-scrollbar">
            <TabBtn active={!type} onClick={() => setType(undefined)}>
              All {post.reactionCount}
            </TabBtn>
            {types.map((t) => (
              <TabBtn key={t} active={type === t} onClick={() => setType(t)}>
                <span aria-hidden>{REACTION_META[t].emoji}</span> {post.reactionCounts[t]}
                <span className="sr-only">{REACTION_META[t].label}</span>
              </TabBtn>
            ))}
          </div>
        </DialogHeader>
        <DialogBody className="max-h-[60vh]">
          {q.isPending
            ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-2 h-10" />)
            : rows.map((r) => (
                <PersonRow
                  key={r.user.id}
                  user={r.user}
                  action={
                    <span className="text-lg" aria-label={REACTION_META[r.type].label}>
                      {REACTION_META[r.type].emoji}
                    </span>
                  }
                />
              ))}
          <div ref={ref} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("flex h-11 shrink-0 items-center gap-1 border-b-2 px-3 text-sm font-semibold", active ? "border-primary text-primary-soft-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}
