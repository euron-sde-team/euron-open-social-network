/**
 * Event helpers: wall-clock time in a chosen timezone to and from an ISO
 * instant (the API stores instants plus the organiser's timezone), and the
 * copy for the viewer's RSVP state.
 */
import type { CommunityEvent, RsvpStatus } from "@open-social/types";

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function wallParts(instant: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of dtf(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year!, mo: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const w = wallParts(instant, timeZone);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Parse "YYYY-MM-DDTHH:mm" (a datetime-local value). */
export function parseLocal(value: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]! };
}

/**
 * The instant at which clocks in `timeZone` read `local`. In a spring-forward
 * gap (a time that does not exist) the result moves forward by the gap; in a
 * fall-back overlap the earlier of the two instants is used.
 */
export function zonedToIso(local: string, timeZone: string): string | null {
  const p = parseLocal(local);
  if (!p) return null;
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const o1 = tzOffsetMs(guess - 0, timeZone);
  let result = guess - o1;
  const o2 = tzOffsetMs(result, timeZone);
  if (o2 !== o1) {
    const alt = guess - o2;
    // Prefer a candidate that round-trips; otherwise (a gap) take the later one.
    if (isoToZoned(new Date(alt).toISOString(), timeZone) === local) result = alt;
    else if (isoToZoned(new Date(result).toISOString(), timeZone) !== local) result = Math.max(result, alt);
  }
  // Fall-back overlap: an hour earlier may also read the same wall time.
  const earlier = result - 3_600_000;
  if (isoToZoned(new Date(earlier).toISOString(), timeZone) === local) result = earlier;
  return new Date(result).toISOString();
}

/** "YYYY-MM-DDTHH:mm" as clocks in `timeZone` read at `iso` (for editing). */
export function isoToZoned(iso: string, timeZone: string): string {
  const w = wallParts(new Date(iso).getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** All IANA zones the runtime knows, with a small fallback list. */
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    /* older runtimes */
  }
  return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
}

export interface RsvpCopy {
  label: string;
  tone: "success" | "warning" | "primary" | "neutral";
  description: string | null;
}

/**
 * Badge and explainer for the viewer's RSVP. `waitlistPosition` comes from the API
 * (`viewer.waitlistPosition`); without it (an optimistic update) the copy falls back
 * to what the waitlist length says.
 */
export function rsvpCopy(rsvp: RsvpStatus | null, event?: Pick<CommunityEvent, "waitlistCount" | "status">, waitlistPosition?: number | null): RsvpCopy | null {
  if (event?.status === "CANCELLED") return { label: "Cancelled", tone: "neutral", description: "The organiser cancelled this event." };
  switch (rsvp) {
    case "GOING":
      return { label: "Going", tone: "success", description: "You are going. Add it to your calendar so you do not miss it." };
    case "WAITLISTED": {
      if (waitlistPosition) {
        const next = waitlistPosition === 1 ? " You are next in line." : "";
        return { label: "Waitlist", tone: "warning", description: `You are #${waitlistPosition} on the waitlist.${next} You move up automatically when a spot opens.` };
      }
      const n = event?.waitlistCount ?? 0;
      const position = n > 1 ? ` ${n} people are on the waitlist.` : n === 1 ? " You are the only one on the waitlist, so you are next." : "";
      return { label: "Waitlist", tone: "warning", description: `You are on the waitlist.${position} You move up automatically when a spot opens.` };
    }
    case "INTERESTED":
      return { label: "Interested", tone: "primary", description: "You are interested. We will remind you before it starts." };
    default:
      return null;
  }
}

/** Fraction of capacity taken (0..1), or null when there is no cap. */
export function capacityFill(event: Pick<CommunityEvent, "capacity" | "goingCount">): number | null {
  if (!event.capacity || event.capacity <= 0) return null;
  return Math.min(1, event.goingCount / event.capacity);
}

export function spotsLeft(event: Pick<CommunityEvent, "capacity" | "goingCount">): number | null {
  if (!event.capacity) return null;
  return Math.max(0, event.capacity - event.goingCount);
}

/** File name for an event's .ics download: a slug of the title, else the event id. */
export function icsFileName(event: Pick<CommunityEvent, "id" | "title">): string {
  const slug = event.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || event.id}.ics`;
}
