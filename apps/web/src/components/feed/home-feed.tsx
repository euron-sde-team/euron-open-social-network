"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Compass, Users } from "lucide-react";
import { Button, Card, EmptyState, Segmented } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMyCommunities } from "@/lib/hooks/queries";
import { useProductName } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { useRoom } from "@/lib/realtime/provider";
import { HOME_FEED, useSignals } from "@/lib/stores/signals";
import { ComposerCard } from "@/components/posts/composer";
import { PostFeed } from "@/components/posts/post-feed";

/** Joins each community's feed room so feed:new-posts arrives for all of them. */
function CommunityRooms({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <Room key={id} id={id} />
      ))}
    </>
  );
}
function Room({ id }: { id: string }) {
  useRoom("community", id);
  return null;
}

export function NewPostsPill({ feedKey, queryKey }: { feedKey: string; queryKey: readonly unknown[] }) {
  const count = useSignals((s) => s.newPosts[feedKey] ?? 0);
  const clear = useSignals((s) => s.clearNewPosts);
  const qc = useQueryClient();
  if (!count) return null;
  return (
    <div className="pointer-events-none sticky top-[calc(var(--header-height)+12px)] z-30 flex justify-center">
      <Button
        size="sm"
        className="pointer-events-auto rounded-full shadow-popover animate-slide-up"
        data-testid="new-posts-pill"
        onClick={() => {
          clear(feedKey);
          window.scrollTo({ top: 0, behavior: "smooth" });
          void qc.resetQueries({ queryKey });
        }}
      >
        <ArrowUp /> {count === 1 ? "1 new post" : `${count > 99 ? "99+" : count} new posts`}
      </Button>
    </div>
  );
}

export function HomeFeed() {
  const { status } = useAuth();
  const [sort, setSort] = useState<"latest" | "top">("latest");
  const communities = useMyCommunities();
  const clear = useSignals((s) => s.clearNewPosts);
  useEffect(() => () => clear(HOME_FEED), [clear]);

  if (status === "loading") return null;
  if (status === "signed-out") return <Welcome />;

  const ids = (communities.data ?? []).map((c) => c.id);
  return (
    <div className="space-y-4">
      <CommunityRooms ids={ids} />
      <ComposerCard />
      <NewPostsPill feedKey={HOME_FEED} queryKey={qk.feed(sort)} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Your feed</h1>
        <Segmented
          aria-label="Sort feed"
          value={sort}
          onChange={setSort}
          options={[
            { value: "latest", label: "Latest" },
            { value: "top", label: "Top" },
          ]}
        />
      </div>
      <PostFeed
        key={sort}
        queryKey={qk.feed(sort)}
        fetchPage={(cursor) => api().posts.feed({ sort, cursor })}
        empty={
          <Card>
            <EmptyState
              icon={<Users />}
              title="Your feed is quiet"
              description="Join communities and follow people to fill it with posts you care about."
              action={
                <Button asChild>
                  <Link href="/communities">
                    <Compass /> Discover communities
                  </Link>
                </Button>
              }
            />
          </Card>
        }
      />
    </div>
  );
}

function Welcome() {
  const name = useProductName();
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-primary-soft px-6 py-10 text-center">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground">Welcome to {name}</h1>
        <p className="mx-auto mt-2 max-w-md text-balance text-muted-foreground">Communities, conversations and events, run by the people in them.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild size="lg">
            <Link href="/signup">Create an account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-3">
        {[
          ["Join communities", "Find your people around shared interests, with clear rules and active moderators."],
          ["Talk in real time", "Community chat rooms and private messages, with read receipts and typing indicators."],
          ["Meet up", "RSVP to events, online or in person, and add them to your calendar."],
        ].map(([t, d]) => (
          <div key={t}>
            <p className="font-semibold">{t}</p>
            <p className="mt-1 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-6 py-4 text-center">
        <Button asChild variant="link">
          <Link href="/communities">Browse public communities</Link>
        </Button>
      </div>
    </Card>
  );
}
