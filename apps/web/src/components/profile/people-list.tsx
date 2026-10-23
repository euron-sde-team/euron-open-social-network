"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Users } from "lucide-react";
import { Card, EmptyState, Skeleton } from "@open-social/ui";
import type { FollowEntry } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { PersonRow } from "@/components/common/user-bits";
import { FollowButton } from "./follow-button";

/** Followers or following of a person, infinite. */
export function PeopleList({ username, kind }: { username: string; kind: "followers" | "following" }) {
  const { user } = useAuth();
  const profile = useQuery({ queryKey: qk.profile(username), queryFn: () => api().users.profile(username) });
  const list = usePagedList<FollowEntry>({
    queryKey: kind === "followers" ? qk.followers(username) : qk.following(username),
    fetchPage: (cursor) => (kind === "followers" ? api().users.followers(username, { cursor }) : api().users.following(username, { cursor })),
  });
  const name = profile.data?.displayName ?? `@${username}`;

  return (
    <Card data-testid={`${kind}-list`}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href={`/u/${encodeURIComponent(username)}`} aria-label="Back to profile" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">{kind === "followers" ? "Followers" : "Following"}</h1>
          <p className="text-sm text-subtle-foreground">{name}</p>
        </div>
      </div>
      <div className="px-4 py-2">
        {list.isPending ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="my-3 h-10" />)
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
        ) : !list.items.length ? (
          <EmptyState compact icon={<Users />} title={kind === "followers" ? "No followers yet" : "Not following anyone yet"} />
        ) : (
          <div className="divide-y divide-border">
            {list.items.map((u) => (
              <PersonRow
                key={u.id}
                user={u}
                action={
                  // Every row carries the viewer's own follow state, so the button starts right on any list.
                  user && u.id !== user.id ? <FollowButton key={`${u.id}:${u.viewerFollows}`} userId={u.id} following={u.viewerFollows} size="sm" testId="list-follow-button" /> : null
                }
              />
            ))}
          </div>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </div>
    </Card>
  );
}
