/**
 * RSVP and waitlist rules. Pure: the event service locks the event row (SELECT ... FOR
 * UPDATE) so these decisions run one at a time per event, then applies the result.
 *
 *   - GOING with a free seat (or no capacity) is GOING.
 *   - GOING when full is WAITLISTED. Someone already on the waitlist keeps their place.
 *   - Leaving GOING (switching to INTERESTED, or removing the RSVP) frees a seat; the
 *     first WAITLISTED person, by updated_at, is promoted.
 */
import type { RsvpStatus } from "@open-social/types";

export interface RsvpCounters {
  going: number;
  waitlisted: number;
  interested: number;
}

export interface RsvpDecision {
  status: RsvpStatus | null;
  /** True when the row's updated_at must stay as it is (keeps the waitlist position). */
  keepPosition: boolean;
  /** Seats freed by this change (0 or 1); the caller promotes that many from the waitlist. */
  seatsFreed: number;
  delta: RsvpCounters;
}

function bucket(status: RsvpStatus | null): keyof RsvpCounters | null {
  if (status === "GOING") return "going";
  if (status === "WAITLISTED") return "waitlisted";
  if (status === "INTERESTED") return "interested";
  return null;
}

function deltaFor(from: RsvpStatus | null, to: RsvpStatus | null): RsvpCounters {
  const d: RsvpCounters = { going: 0, waitlisted: 0, interested: 0 };
  const a = bucket(from);
  const b = bucket(to);
  if (a === b) return d;
  if (a) d[a] -= 1;
  if (b) d[b] += 1;
  return d;
}

export function hasFreeSeat(capacity: number | null, goingCount: number): boolean {
  return capacity === null || goingCount < capacity;
}

/** The status a requested RSVP resolves to, given the current state of the event. */
export function decideRsvp(input: { capacity: number | null; goingCount: number; current: RsvpStatus | null; requested: "GOING" | "INTERESTED" | null }): RsvpDecision {
  const { capacity, goingCount, current, requested } = input;
  let status: RsvpStatus | null;
  let keepPosition = false;
  if (requested === null) status = null;
  else if (requested === "INTERESTED") status = "INTERESTED";
  else if (current === "GOING") {
    status = "GOING";
    keepPosition = true;
  } else if (current === "WAITLISTED") {
    status = hasFreeSeat(capacity, goingCount) ? "GOING" : "WAITLISTED";
    keepPosition = status === "WAITLISTED";
  } else status = hasFreeSeat(capacity, goingCount) ? "GOING" : "WAITLISTED";
  const seatsFreed = current === "GOING" && status !== "GOING" ? 1 : 0;
  return { status, keepPosition, seatsFreed, delta: deltaFor(current, status) };
}

/** How many waitlisted people fit after a change (capacity raised, or seats freed). */
export function promotable(capacity: number | null, goingCount: number, waitlisted: number): number {
  if (waitlisted <= 0) return 0;
  if (capacity === null) return waitlisted;
  return Math.max(0, Math.min(waitlisted, capacity - goingCount));
}

/** First come, first served: oldest updated_at first, user id breaks ties. */
export function waitlistOrder<T extends { updatedAt: Date; userId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}
