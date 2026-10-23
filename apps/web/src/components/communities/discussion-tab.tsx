"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { Card, EmptyState, Segmented } from "@open-social/ui";
import type { Community } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { useRoom } from "@/lib/realtime/provider";
import { useSignals } from "@/lib/stores/signals";
import { NewPostsPill } from "@/components/feed/home-feed";
import { ComposerCard } from "@/components/posts/composer";
import { PostCard } from "@/components/posts/post-card";
import { PostFeed } from "@/components/posts/post-feed";
import { AboutCard, RulesCard } from "./about-tab";

type Sort = "new" | "top" | "hot";

export function DiscussionTab({ community: c }: { community: Community }) {
  const { status } = useAuth();
  const [sort, setSort] = useState<Sort>("new");
  useRoom("community", status === "signed-in" ? c.id : null);
  const clear = useSignals((s) => s.clearNewPosts);
  useEffect(() => () => clear(c.id), [clear, c.id]);

  const pinned = useQuery({ queryKey: qk.communityPinned(c.id), queryFn: () => api().communities.pinned(c.id), meta: { silent: true } });
  const pinnedIds = useMemo(() => new Set((pinned.data ?? []).map((p) => p.id)), [pinned.data]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {status === "signed-in" && c.viewer.canPost ? <ComposerCard community={c} /> : null}
        {status === "signed-in" && c.viewer.isMember && !c.viewer.canPost ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Only moderators can start new posts here. You can still react and comment.</p>
        ) : null}
        <NewPostsPill feedKey={c.id} queryKey={qk.communityPosts(c.id, sort)} />
        {(pinned.data ?? []).length ? (
          <section aria-label="Pinned posts" className="space-y-4" data-testid="pinned-posts">
            {pinned.data!.map((p) => (
              <PostCard key={p.id} post={p} showCommunity={false} />
            ))}
          </section>
        ) : null}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Discussion</h2>
          <Segmented
            aria-label="Sort posts"
            value={sort}
            onChange={setSort}
            options={[
              { value: "new", label: "New" },
              { value: "hot", label: "Hot" },
              { value: "top", label: "Top" },
            ]}
          />
        </div>
        <PostFeed
          key={sort}
          queryKey={qk.communityPosts(c.id, sort)}
          fetchPage={(cursor) => api().communities.posts(c.id, { sort, cursor })}
          showCommunity={false}
          exclude={pinnedIds}
          empty={
            <Card>
              <EmptyState icon={<MessageSquareText />} title="No posts yet" description={c.viewer.canPost ? "Start the conversation with the first post." : "When members post, it will show here."} />
            </Card>
          }
        />
      </div>
      <aside className="hidden space-y-4 lg:block">
        <div className="sticky top-[calc(var(--header-height)+16px)] space-y-4">
          <AboutCard community={c} />
          <RulesCard community={c} compact />
        </div>
      </aside>
    </div>
  );
}
