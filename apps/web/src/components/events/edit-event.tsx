"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@open-social/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState, NotFoundState, PageTitle } from "@/components/common/states";
import { EventForm } from "./event-form";

export function EditEvent({ id }: { id: string }) {
  const q = useQuery({ queryKey: qk.event(id), queryFn: () => api().events.get(id) });
  if (q.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.viewer.canEdit) return <NotFoundState title="You can not edit this event" description="Only the organiser and community moderators can edit it." />;
  return (
    <>
      <PageTitle title="Edit event" description={q.data.title} />
      <EventForm event={q.data} />
    </>
  );
}
