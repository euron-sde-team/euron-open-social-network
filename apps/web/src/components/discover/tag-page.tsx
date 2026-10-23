"use client";

import { Hash } from "lucide-react";
import { Card, EmptyState } from "@open-social/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { PostFeed } from "@/components/posts/post-feed";

export function TagPage({ tag }: { tag: string }) {
  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <Hash className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">#{tag}</h1>
          <p className="text-sm text-muted-foreground">Posts tagged #{tag} that you can see</p>
        </div>
      </Card>
      <PostFeed
        queryKey={qk.tagPosts(tag)}
        fetchPage={(cursor) => api().discover.tagPosts(tag, { cursor })}
        empty={
          <Card>
            <EmptyState icon={<Hash />} title={`No posts with #${tag} yet`} description="Add the tag to a post to start the conversation." />
          </Card>
        }
      />
    </div>
  );
}
