"use client";

import Link from "next/link";
import { MapPin, Users, Video } from "lucide-react";
import { Badge, Card, Skeleton, cn } from "@open-social/ui";
import type { CommunityEvent } from "@open-social/types";
import { rsvpCopy } from "@/lib/events";
import { eventRange, compactNumber } from "@/lib/time";

/** Calendar-page date block: month over day, in the event's timezone. */
export function DateBlock({ iso, timeZone, size = "md", className }: { iso: string; timeZone?: string; size?: "md" | "lg"; className?: string }) {
  const d = new Date(iso);
  const tz = timeZone ? { timeZone } : {};
  const month = new Intl.DateTimeFormat(undefined, { month: "short", ...tz }).format(d);
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", ...tz }).format(d);
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border border-border bg-card leading-none shadow-sm",
        size === "lg" ? "size-16" : "size-12",
        className,
      )}
      aria-hidden
    >
      <span className={cn("font-bold uppercase text-danger", size === "lg" ? "text-xs" : "text-[10px]")}>{month}</span>
      <span className={cn("font-bold text-foreground", size === "lg" ? "mt-1 text-2xl" : "mt-0.5 text-lg")}>{day}</span>
    </span>
  );
}

export function RsvpBadge({ event }: { event: CommunityEvent }) {
  const copy = rsvpCopy(event.viewer.rsvp, event);
  if (!copy) return null;
  return (
    <Badge tone={copy.tone} data-testid="rsvp-badge">
      {copy.label}
    </Badge>
  );
}

export function EventCard({ event }: { event: CommunityEvent }) {
  const cancelled = event.status === "CANCELLED";
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-popover" data-testid="event-card">
      <Link href={`/events/${event.id}`} className="flex h-full flex-col">
        <div className="relative aspect-[2/1] bg-muted">
          {event.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.coverUrl} alt="" loading="lazy" className={cn("size-full object-cover", cancelled && "grayscale")} />
          ) : (
            <div className="flex size-full items-center justify-center">
              <DateBlock iso={event.startsAt} timeZone={event.timezone} size="lg" />
            </div>
          )}
        </div>
        <div className="flex flex-1 gap-3 p-3">
          {event.coverUrl ? <DateBlock iso={event.startsAt} timeZone={event.timezone} /> : null}
          <div className="min-w-0 flex-1 space-y-1">
            <p className={cn("text-xs font-semibold uppercase tracking-wide", cancelled ? "text-danger" : "text-primary-soft-foreground")}>
              {cancelled ? "Cancelled" : eventRange(event.startsAt, event.endsAt, event.timezone)}
            </p>
            <h3 className={cn("line-clamp-2 font-semibold leading-snug", cancelled && "line-through decoration-1")}>{event.title}</h3>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              {event.isVirtual ? <Video className="size-3.5 shrink-0" /> : <MapPin className="size-3.5 shrink-0" />}
              <span className="truncate">{event.isVirtual ? "Online event" : event.location || "Location to be announced"}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-subtle-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" /> {compactNumber(event.goingCount)} going
                {event.interestedCount ? `, ${compactNumber(event.interestedCount)} interested` : ""}
              </span>
              {event.community ? <span className="truncate">in {event.community.name}</span> : <span>Network-wide</span>}
              <RsvpBadge event={event} />
            </div>
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function EventCardSkeleton() {
  return (
    <Card className="overflow-hidden" aria-hidden>
      <Skeleton className="aspect-[2/1] rounded-none" />
      <div className="flex gap-3 p-3">
        <Skeleton className="size-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    </Card>
  );
}
