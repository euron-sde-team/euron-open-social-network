"use client";

import { Bookmark } from "lucide-react";
import { Card, EmptyState } from "@open-social/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { PostFeed } from "@/components/posts/post-feed";

export function SavedPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Saved</h1>
        <p className="text-sm text-muted-foreground">Only you can see what you save.</p>
      </div>
      <PostFeed
        queryKey={qk.bookmarks}
        fetchPage={(cursor) => api().users.bookmarks({ cursor })}
        empty={
          <Card>
            <EmptyState icon={<Bookmark />} title="Nothing saved yet" description="Use Save post in a post's menu to keep it here for later." />
          </Card>
        }
      />
    </div>
  );
}
