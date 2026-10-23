"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarPlus, Check, Clock, ExternalLink, Flag, Globe2, MapPin, MoreHorizontal, Pencil, Star, Users, Video, X } from "lucide-react";
import { flattenAll, nextCursor } from "@open-social/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Segmented,
  Skeleton,
  cn,
  toast,
} from "@open-social/ui";
import type { CommunityEvent, RsvpStatus } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { capacityFill, icsFileName, rsvpCopy, spotsLeft } from "@/lib/events";
import { useInfiniteScroll } from "@/lib/hooks/use-infinite-scroll";
import { qk } from "@/lib/query-keys";
import { safeHref } from "@/lib/text";
import { compactNumber, eventRange, fullTimestamp } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { ErrorState } from "@/components/common/states";
import { PersonRow, UserAvatar } from "@/components/common/user-bits";
import { DateBlock } from "./event-card";

/** Optimistic RSVP: the viewer's state and the counts it moves. */
export function applyRsvp(e: CommunityEvent, next: RsvpStatus | null): CommunityEvent {
  const prev = e.viewer.rsvp;
  if (prev === next) return e;
  let { goingCount, interestedCount, waitlistCount } = e;
  if (prev === "GOING") goingCount--;
  if (prev === "INTERESTED") interestedCount--;
  if (prev === "WAITLISTED") waitlistCount--;
  let state = next;
  if (next === "GOING" && e.capacity && goingCount >= e.capacity) state = "WAITLISTED";
  if (state === "GOING") goingCount++;
  if (state === "INTERESTED") interestedCount++;
  if (state === "WAITLISTED") waitlistCount++;
  return {
    ...e,
    goingCount: Math.max(0, goingCount),
    interestedCount: Math.max(0, interestedCount),
    waitlistCount: Math.max(0, waitlistCount),
    // The exact place comes back with the server's answer; joining appends to the end.
    viewer: { ...e.viewer, rsvp: state, waitlistPosition: state === "WAITLISTED" ? (prev === "WAITLISTED" ? e.viewer.waitlistPosition : waitlistCount) : null },
  };
}

function RsvpBar({ event }: { event: CommunityEvent }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const key = qk.event(event.id);
  const m = useMutation({
    mutationFn: (next: "GOING" | "INTERESTED" | null) => (next ? api().events.rsvp(event.id, next) : api().events.cancelRsvp(event.id)),
    onMutate: (next) => {
      const prev = qc.getQueryData<CommunityEvent>(key);
      qc.setQueryData<CommunityEvent>(key, (e) => (e ? applyRsvp(e, next) : e));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: (e) => {
      qc.setQueryData(key, e);
      void qc.invalidateQueries({ queryKey: ["attendees", event.id] });
      void qc.invalidateQueries({ queryKey: qk.eventsAll });
    },
  });
  if (event.status === "CANCELLED") return null;
  if (status !== "signed-in")
    return (
      <Button asChild>
        <Link href="/login">Sign in to RSVP</Link>
      </Button>
    );
  const rsvp = event.viewer.rsvp;
  const going = rsvp === "GOING" || rsvp === "WAITLISTED";
  const full = !!event.capacity && event.goingCount >= event.capacity && rsvp !== "GOING";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="rsvp-bar">
      <Button
        variant={going ? "soft" : "primary"}
        aria-pressed={going}
        data-testid="rsvp-going"
        onClick={() => m.mutate(going ? null : "GOING")}
        disabled={m.isPending}
      >
        {rsvp === "WAITLISTED" ? <Clock /> : <Check />}
        {rsvp === "GOING" ? "Going" : rsvp === "WAITLISTED" ? "On the waitlist" : full ? "Join waitlist" : "Going"}
      </Button>
      <Button
        variant={rsvp === "INTERESTED" ? "soft" : "secondary"}
        aria-pressed={rsvp === "INTERESTED"}
        data-testid="rsvp-interested"
        onClick={() => m.mutate(rsvp === "INTERESTED" ? null : "INTERESTED")}
        disabled={m.isPending}
      >
        <Star fill={rsvp === "INTERESTED" ? "currentColor" : "none"} /> Interested
      </Button>
      {rsvp ? (
        <Button variant="ghost" data-testid="rsvp-cancel" onClick={() => m.mutate(null)} disabled={m.isPending}>
          <X /> {rsvp === "WAITLISTED" ? "Leave waitlist" : "Cancel RSVP"}
        </Button>
      ) : null}
    </div>
  );
}

const ATTENDEE_TABS = [
  { value: "GOING", label: "Going" },
  { value: "INTERESTED", label: "Interested" },
  { value: "WAITLISTED", label: "Waitlist" },
] as const;

function Attendees({ event }: { event: CommunityEvent }) {
  const [tab, setTab] = useState<(typeof ATTENDEE_TABS)[number]["value"]>("GOING");
  const q = useInfiniteQuery({
    queryKey: qk.attendees(event.id, tab),
    queryFn: ({ pageParam }) => api().events.attendees(event.id, { cursor: pageParam, status: tab }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const rows = flattenAll(q.data?.pages);
  const ref = useInfiniteScroll<HTMLDivElement>(() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage(), { enabled: !!q.hasNextPage });
  const counts = { GOING: event.goingCount, INTERESTED: event.interestedCount, WAITLISTED: event.waitlistCount };
  return (
    <Card data-testid="attendees">
      <CardHeader>
        <CardTitle>Guests</CardTitle>
      </CardHeader>
      <CardContent>
        <Segmented
          aria-label="Guest list"
          value={tab}
          onChange={setTab}
          options={ATTENDEE_TABS.filter((t) => t.value !== "WAITLISTED" || event.capacity).map((t) => ({ value: t.value, label: `${t.label} ${compactNumber(counts[t.value])}` }))}
          className="mb-2"
        />
        {q.isPending ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="my-3 h-10" />)
        ) : q.isError ? (
          <ErrorState error={q.error} compact onRetry={() => void q.refetch()} />
        ) : !rows.length ? (
          <EmptyState compact icon={<Users />} title="Nobody here yet" />
        ) : (
          <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {rows.map((r) => (
              <PersonRow key={r.user.id} user={r.user} meta={r.user.id === event.organizer.id ? "Organiser" : undefined} />
            ))}
            <div ref={ref} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EventDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { status } = useAuth();
  const q = useQuery({ queryKey: qk.event(id), queryFn: () => api().events.get(id) });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [report, setReport] = useState(false);
  // Fetched through the client so the bearer token goes along: a plain link 404s for private-community events.
  const calendar = useMutation({
    mutationFn: async (e: CommunityEvent) => saveBlob(await api().events.ics(e.id), icsFileName(e)),
    onError: (err) => toast.error({ title: "Could not download the calendar file", description: errorMessage(err) }),
  });
  const cancel = useMutation({
    mutationFn: () => api().events.cancel(id),
    onSuccess: () => {
      qc.setQueryData<CommunityEvent>(qk.event(id), (e) => (e ? { ...e, status: "CANCELLED" } : e));
      void qc.invalidateQueries({ queryKey: qk.eventsAll });
    },
  });

  if (q.isPending)
    return (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="aspect-[3/1] rounded-lg" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const e = q.data;
  const cancelled = e.status === "CANCELLED";
  const copy = rsvpCopy(e.viewer.rsvp, e, e.viewer.waitlistPosition);
  const fill = capacityFill(e);
  const left = spotsLeft(e);
  const link = e.virtualLink ? safeHref(e.virtualLink) : null;
  const ownTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : e.timezone;

  return (
    <div className="space-y-4" data-testid="event-detail">
      <Card className="overflow-hidden">
        <div className="relative aspect-[3/1] max-h-[360px] bg-muted">
          {e.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.coverUrl} alt="" className={cn("size-full object-cover", cancelled && "grayscale")} />
          ) : (
            <div className="flex size-full items-center justify-center">
              <DateBlock iso={e.startsAt} timeZone={e.timezone} size="lg" />
            </div>
          )}
        </div>
        {cancelled ? (
          <div className="flex items-center gap-2 border-b border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-soft-foreground" data-testid="event-cancelled">
            <Ban className="size-4" /> This event was cancelled by the organiser.
          </div>
        ) : null}
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-6">
          <DateBlock iso={e.startsAt} timeZone={e.timezone} size="lg" className="hidden sm:flex" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-danger" title={fullTimestamp(e.startsAt, undefined, e.timezone)}>
              {eventRange(e.startsAt, e.endsAt, e.timezone)}
            </p>
            <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">{e.title}</h1>
            <p className="text-sm text-muted-foreground">
              {e.community ? (
                <>
                  In{" "}
                  <Link href={`/c/${encodeURIComponent(e.community.slug)}`} className="font-semibold text-foreground hover:underline">
                    {e.community.name}
                  </Link>
                </>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Globe2 className="size-3.5" /> Network-wide event
                </span>
              )}
              {ownTz !== e.timezone ? <span className="block text-xs text-subtle-foreground">Your time: {eventRange(e.startsAt, e.endsAt, ownTz)}</span> : null}
            </p>
            {copy && !cancelled ? (
              <p className="flex items-start gap-2 text-sm" data-testid="rsvp-status">
                <Badge tone={copy.tone}>{copy.label}</Badge>
                <span className="text-muted-foreground">{copy.description}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
          <RsvpBar event={e} />
          <span className="flex-1" />
          {!cancelled ? (
            <Button variant="secondary" data-testid="add-to-calendar" onClick={() => calendar.mutate(e)} disabled={calendar.isPending}>
              <CalendarPlus /> Add to calendar
            </Button>
          ) : null}
          {e.viewer.canEdit && !cancelled ? (
            <Button variant="secondary" onClick={() => router.push(`/events/${e.id}/edit`)} data-testid="event-edit">
              <Pencil /> Edit
            </Button>
          ) : null}
          {status === "signed-in" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More event options" variant="muted">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {e.viewer.canEdit && !cancelled ? (
                  <DropdownMenuItem destructive onSelect={() => setConfirmCancel(true)} data-testid="event-cancel">
                    <Ban /> Cancel event
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setReport(true)}>
                  <Flag /> Report event
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[15px]">
              <p className="flex items-center gap-3">
                <UserAvatar user={e.organizer} size="sm" />
                <span>
                  Organised by{" "}
                  <Link href={`/u/${encodeURIComponent(e.organizer.username)}`} className="font-semibold hover:underline">
                    {e.organizer.displayName}
                  </Link>
                </span>
              </p>
              {e.isVirtual ? (
                <p className="flex items-start gap-3">
                  <Video className="mt-0.5 size-5 shrink-0 text-subtle-foreground" />
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all font-medium text-link hover:underline" data-testid="virtual-link">
                      Join online <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Online event. The link appears here once you are going.</span>
                  )}
                </p>
              ) : (
                <p className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-subtle-foreground" />
                  <span>{e.location || "Location to be announced"}</span>
                </p>
              )}
              {e.capacity ? (
                <div className="space-y-1.5" data-testid="capacity">
                  <p className="flex items-center gap-3">
                    <Users className="size-5 shrink-0 text-subtle-foreground" />
                    <span>
                      {compactNumber(e.goingCount)} of {compactNumber(e.capacity)} spots taken
                      {left === 0 ? (e.waitlistCount ? `, ${e.waitlistCount} on the waitlist` : ", full") : `, ${left} left`}
                    </span>
                  </p>
                  <div className="ml-8 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((fill ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Capacity">
                    <div className={cn("h-full rounded-full", (fill ?? 0) >= 1 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round((fill ?? 0) * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-3">
                  <Users className="size-5 shrink-0 text-subtle-foreground" /> {compactNumber(e.goingCount)} going, {compactNumber(e.interestedCount)} interested
                </p>
              )}
              {e.description ? <p className="whitespace-pre-wrap border-t border-border pt-3">{e.description}</p> : null}
            </CardContent>
          </Card>
        </div>
        <Attendees event={e} />
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this event?"
        description="Everyone who RSVPed is notified. This can not be undone."
        confirmLabel="Cancel event"
        destructive
        onConfirm={() => cancel.mutateAsync()}
      />
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="EVENT" targetId={e.id} /> : null}
    </div>
  );
}
