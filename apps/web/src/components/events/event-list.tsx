"use client";

import { CalendarDays } from "lucide-react";
import { Card, EmptyState } from "@open-social/ui";
import type { CommunityEvent } from "@open-social/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { EventCard, EventCardSkeleton } from "./event-card";

export type EventScope = "upcoming" | "past" | "going" | "organising";

/** A responsive grid of events for a scope, optionally within one community. */
export function EventList({ scope = "upcoming", communityId, emptyText, action }: { scope?: EventScope; communityId?: string; emptyText?: string; action?: React.ReactNode }) {
  const list = usePagedList<CommunityEvent>({
    queryKey: qk.events(scope, communityId),
    fetchPage: (cursor) => api().events.list({ scope, communityId, cursor }),
  });
  if (list.isPending)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <EventCardSkeleton key={i} />
        ))}
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.items.length)
    return (
      <Card>
        <EmptyState icon={<CalendarDays />} title={emptyText ?? "No events here yet"} description={scope === "upcoming" ? "When an event is scheduled it will show up here." : undefined} action={action} />
      </Card>
    );
  return (
    <div data-testid="event-list">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.items.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </div>
  );
}
