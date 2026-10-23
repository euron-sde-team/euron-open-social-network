"use client";

import { useState } from "react";
import Link from "next/link";
import { Compass, Plus, Search } from "lucide-react";
import { Button, EmptyState, Segmented } from "@open-social/ui";
import type { Community } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { CommunityCard, CommunityCardSkeleton } from "./community-card";

type Filter = "all" | "joined" | "managed";

export function CommunityDiscover() {
  const { status } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim(), 250);
  const signedIn = status === "signed-in";
  const effective: Filter = signedIn ? filter : "all";
  const list = usePagedList<Community>({
    queryKey: qk.communities(effective, search),
    fetchPage: (cursor) => api().communities.list({ q: search || undefined, filter: effective, cursor }),
  });

  return (
    <div>
      <PageTitle
        title="Communities"
        description="Find your people. Join public communities instantly, or ask to join private ones."
        actions={
          signedIn ? (
            <Button asChild data-testid="create-community">
              <Link href="/communities/new">
                <Plus /> Create community
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search communities"
            aria-label="Search communities"
            data-testid="communities-search"
            className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm shadow-sm placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        {signedIn ? (
          <Segmented
            aria-label="Filter communities"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "joined", label: "Joined" },
              { value: "managed", label: "Managed" },
            ]}
          />
        ) : null}
      </div>
      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<Compass />}
          title={search ? "No communities match" : effective === "joined" ? "You have not joined any communities yet" : effective === "managed" ? "You do not manage any communities" : "No communities yet"}
          description={search ? "Try a different search." : signedIn ? "Start one around something you care about." : undefined}
          action={
            signedIn && !search ? (
              <Button asChild variant="soft">
                <Link href="/communities/new">Create a community</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="communities-grid">
            {list.items.map((c) => (
              <CommunityCard key={c.id} community={c} />
            ))}
          </div>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
        </>
      )}
    </div>
  );
}
