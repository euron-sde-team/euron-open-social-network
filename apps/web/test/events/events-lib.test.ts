import { describe, expect, it } from "vitest";
import { capacityFill, icsFileName, isoToZoned, rsvpCopy, spotsLeft, tzOffsetMs, zonedToIso } from "@/lib/events";
import { applyRsvp } from "@/components/events/event-detail";
import { eventSchema, toEventInput, type EventFormValues } from "@/components/events/event-form";
import { makeEvent } from "./fixtures";

describe("zonedToIso", () => {
  it("treats UTC wall time as the instant", () => {
    expect(zonedToIso("2026-06-10T16:00", "UTC")).toBe("2026-06-10T16:00:00.000Z");
  });
  it("applies standard and daylight offsets in New York", () => {
    expect(zonedToIso("2026-01-15T09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedToIso("2026-07-15T09:00", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
  });
  it("moves a spring-forward gap time forward by the gap", () => {
    // 2026-03-08 02:30 does not exist in New York; clocks jump 02:00 to 03:00 EDT.
    expect(zonedToIso("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });
  it("picks the earlier instant in a fall-back overlap", () => {
    // 01:30 happens twice on 2026-11-01 in New York: first in EDT (05:30Z), then EST (06:30Z).
    expect(zonedToIso("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });
  it("handles fractional and southern-hemisphere offsets", () => {
    expect(zonedToIso("2026-06-10T12:00", "Asia/Kolkata")).toBe("2026-06-10T06:30:00.000Z");
    expect(zonedToIso("2026-06-10T12:00", "Asia/Kathmandu")).toBe("2026-06-10T06:15:00.000Z");
    expect(zonedToIso("2026-01-15T09:00", "Australia/Sydney")).toBe("2026-01-14T22:00:00.000Z");
    expect(zonedToIso("2026-07-15T09:00", "Australia/Sydney")).toBe("2026-07-14T23:00:00.000Z");
  });
  it("rejects malformed input", () => {
    expect(zonedToIso("tomorrow", "UTC")).toBeNull();
  });
  it("round-trips with isoToZoned", () => {
    for (const tz of ["UTC", "Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"]) {
      const iso = zonedToIso("2026-09-21T18:45", tz)!;
      expect(isoToZoned(iso, tz)).toBe("2026-09-21T18:45");
    }
  });
  it("reports offsets east positive", () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 1), "Asia/Tokyo")).toBe(9 * 3_600_000);
    expect(tzOffsetMs(Date.UTC(2026, 0, 1), "America/Chicago")).toBe(-6 * 3_600_000);
  });
});

describe("rsvpCopy", () => {
  it("has copy for each state", () => {
    expect(rsvpCopy(null)).toBeNull();
    expect(rsvpCopy("GOING")?.label).toBe("Going");
    expect(rsvpCopy("INTERESTED")?.tone).toBe("primary");
  });
  it("explains the waitlist with what is known about its length", () => {
    expect(rsvpCopy("WAITLISTED", { waitlistCount: 1, status: "SCHEDULED" })?.description).toMatch(/only one on the waitlist/);
    expect(rsvpCopy("WAITLISTED", { waitlistCount: 4, status: "SCHEDULED" })?.description).toMatch(/4 people are on the waitlist/);
  });
  it("names the viewer's place on the waitlist when the API knows it", () => {
    expect(rsvpCopy("WAITLISTED", { waitlistCount: 4, status: "SCHEDULED" }, 3)?.description).toMatch(/You are #3 on the waitlist\./);
    expect(rsvpCopy("WAITLISTED", { waitlistCount: 4, status: "SCHEDULED" }, 1)?.description).toMatch(/#1 on the waitlist\. You are next in line/);
    expect(rsvpCopy("WAITLISTED", { waitlistCount: 4, status: "SCHEDULED" }, null)?.description).toMatch(/4 people are on the waitlist/);
  });
  it("says cancelled whatever the RSVP", () => {
    expect(rsvpCopy("GOING", { waitlistCount: 0, status: "CANCELLED" })?.label).toBe("Cancelled");
  });
});

describe("icsFileName", () => {
  it("slugs the title and falls back to the id", () => {
    expect(icsFileName({ id: "01EV", title: "Spring Meetup: Café & Code!" })).toBe("spring-meetup-cafe-code.ics");
    expect(icsFileName({ id: "01EV", title: "???" })).toBe("01EV.ics");
  });
});

describe("capacity", () => {
  it("computes fill and spots left", () => {
    expect(capacityFill(makeEvent({ capacity: null }))).toBeNull();
    expect(capacityFill(makeEvent({ capacity: 4, goingCount: 3 }))).toBe(0.75);
    expect(capacityFill(makeEvent({ capacity: 2, goingCount: 5 }))).toBe(1);
    expect(spotsLeft(makeEvent({ capacity: 2, goingCount: 5 }))).toBe(0);
  });
});

describe("applyRsvp (optimistic)", () => {
  it("moves counts between states", () => {
    const e = applyRsvp(makeEvent({ goingCount: 3, interestedCount: 1, viewer: { rsvp: "INTERESTED", waitlistPosition: null, canEdit: false } }), "GOING");
    expect(e.viewer.rsvp).toBe("GOING");
    expect(e.goingCount).toBe(4);
    expect(e.interestedCount).toBe(0);
  });
  it("lands on the waitlist when the event is full", () => {
    const e = applyRsvp(makeEvent({ capacity: 3, goingCount: 3 }), "GOING");
    expect(e.viewer.rsvp).toBe("WAITLISTED");
    expect(e.viewer.waitlistPosition).toBe(1);
    expect(e.waitlistCount).toBe(1);
    expect(e.goingCount).toBe(3);
  });
  it("cancelling frees the slot", () => {
    const e = applyRsvp(makeEvent({ goingCount: 3, viewer: { rsvp: "GOING", waitlistPosition: null, canEdit: false } }), null);
    expect(e.goingCount).toBe(2);
    expect(e.viewer.rsvp).toBeNull();
  });
});

describe("event form", () => {
  const base: EventFormValues = {
    communityId: "",
    title: "Launch party",
    description: "",
    start: "2026-06-10T18:00",
    end: "2026-06-10T20:00",
    timezone: "Europe/Berlin",
    isVirtual: false,
    virtualLink: "",
    location: "Rooftop",
    capacity: "",
  };
  it("builds the API body with instants in the chosen zone and network-wide as null", () => {
    expect(toEventInput(base)).toMatchObject({ communityId: null, startsAt: "2026-06-10T16:00:00.000Z", endsAt: "2026-06-10T18:00:00.000Z", location: "Rooftop", capacity: null, virtualLink: null });
  });
  it("drops the location for online events and keeps a safe link", () => {
    expect(toEventInput({ ...base, isVirtual: true, virtualLink: "https://meet.example.org/abc" })).toMatchObject({ location: null, virtualLink: "https://meet.example.org/abc" });
  });
  it("rejects an end before the start, a bad link and a zero capacity", () => {
    const r = eventSchema.safeParse({ ...base, end: "2026-06-10T17:00", isVirtual: true, virtualLink: "javascript:alert(1)", capacity: "0" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["end", "virtualLink", "capacity"]));
  });
});
