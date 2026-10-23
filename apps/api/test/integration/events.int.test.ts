import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { getHandler } from "../../src/jobs/registry";
import { anon, as, createUser, type TestUser } from "./harness";
import { addMember, allPages, notificationsOf, resetSettings, setSettings, world } from "./social-fixtures";

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function makeEvent(user: TestUser, communityId: string | null, over: Record<string, unknown> = {}) {
  const res = await as(user)
    .post("/api/events")
    .send({ communityId, title: "Team sync", description: "Weekly", startsAt: inHours(24), endsAt: inHours(25), isVirtual: true, virtualLink: "https://meet.example.com/room-1", ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function members(communityId: string, n: number): Promise<TestUser[]> {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = await createUser();
    await addMember(communityId, u);
    out.push(u);
  }
  return out;
}

describe("events", () => {
  test("capacity: GOING past capacity is WAITLISTED; leaving promotes the first in line and notifies them", async () => {
    const { owner, community } = await world({ members: 0 });
    const event = await makeEvent(owner, community.id, { capacity: 2 });
    const [a, b, c, d] = await members(community.id, 4);
    expect((await as(a!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200)).body.viewer.rsvp).toBe("GOING");
    await as(b!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);
    expect((await as(c!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200)).body.viewer.rsvp).toBe("WAITLISTED");
    const last = await as(d!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);
    expect(last.body).toMatchObject({ goingCount: 2, waitlistCount: 2 });
    // Asking again keeps your place.
    await as(c!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);

    const after = await as(a!).delete(`/api/events/${event.id}/rsvp`).expect(200);
    expect(after.body).toMatchObject({ goingCount: 2, waitlistCount: 1, viewer: { rsvp: null } });
    expect((await as(c!).get(`/api/events/${event.id}`).expect(200)).body.viewer.rsvp).toBe("GOING");
    expect((await notificationsOf(c!.id)).find((n) => n.type === "EVENT_PROMOTED")?.entity_id).toBe(event.id);
    expect((await as(d!).get(`/api/events/${event.id}`).expect(200)).body.viewer.rsvp).toBe("WAITLISTED");

    // GOING to INTERESTED frees a seat too.
    await as(b!).put(`/api/events/${event.id}/rsvp`).send({ status: "INTERESTED" }).expect(200);
    const final = (await as(d!).get(`/api/events/${event.id}`).expect(200)).body;
    expect(final).toMatchObject({ goingCount: 2, waitlistCount: 0, interestedCount: 1, viewer: { rsvp: "GOING" } });
  });

  test("viewer.waitlistPosition: 1-based in promotion order, null unless WAITLISTED, and it moves up on promotion", async () => {
    const { owner, community } = await world({ members: 0 });
    const event = await makeEvent(owner, community.id, { capacity: 1 });
    const [a, b, c, d] = await members(community.id, 4);
    const rsvp = async (u: TestUser) => (await as(u).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200)).body;
    expect((await rsvp(a!)).viewer).toMatchObject({ rsvp: "GOING", waitlistPosition: null });
    expect((await rsvp(b!)).viewer).toMatchObject({ rsvp: "WAITLISTED", waitlistPosition: 1 });
    expect((await rsvp(c!)).viewer).toMatchObject({ rsvp: "WAITLISTED", waitlistPosition: 2 });
    expect((await rsvp(d!)).viewer).toMatchObject({ rsvp: "WAITLISTED", waitlistPosition: 3 });
    // Asking again keeps your place.
    expect((await rsvp(c!)).viewer.waitlistPosition).toBe(2);
    const position = async (u: TestUser | null) => (await as(u).get(`/api/events/${event.id}`).expect(200)).body.viewer.waitlistPosition;
    expect(await position(null)).toBeNull();
    expect(await position(owner)).toBeNull();
    // The list endpoint carries it too (one batched query for the page).
    const listed = await as(d!).get(`/api/events?communityId=${community.id}`).expect(200);
    expect(listed.body.items.find((e: { id: string }) => e.id === event.id).viewer.waitlistPosition).toBe(3);

    await as(a!).delete(`/api/events/${event.id}/rsvp`).expect(200);
    expect((await as(b!).get(`/api/events/${event.id}`).expect(200)).body.viewer).toMatchObject({ rsvp: "GOING", waitlistPosition: null });
    expect(await position(c!)).toBe(1);
    expect(await position(d!)).toBe(2);
    await as(c!).delete(`/api/events/${event.id}/rsvp`).expect(200);
    expect(await position(d!)).toBe(1);
  });

  test("a private-community event's .ics needs the bearer token of a member", async () => {
    const { owner, community } = await world({ members: 0, visibility: "PRIVATE" });
    const event = await makeEvent(owner, community.id);
    await anon().get(`/api/events/${event.id}/ics`).expect(404);
    await as(await createUser()).get(`/api/events/${event.id}/ics`).expect(404);
    const [m] = await members(community.id, 1);
    const ok = await as(m!).get(`/api/events/${event.id}/ics`).expect(200);
    expect(ok.text).toContain("BEGIN:VEVENT");
  });

  test("ten parallel RSVPs at capacity 3: exactly 3 GOING", async () => {
    const { owner, community } = await world({ members: 0 });
    const event = await makeEvent(owner, community.id, { capacity: 3 });
    const people = await members(community.id, 10);
    const results = await Promise.all(people.map((p) => as(p).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const rows = await db.selectFrom("event_rsvps").select("status").where("event_id", "=", event.id).execute();
    expect(rows.filter((r) => r.status === "GOING")).toHaveLength(3);
    expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(7);
    const e = await db.selectFrom("events").select(["going_count", "waitlist_count"]).where("id", "=", event.id).executeTakeFirstOrThrow();
    expect(e).toEqual({ going_count: 3, waitlist_count: 7 });
  });

  test("the virtual link is only for people GOING and the organiser", async () => {
    const { owner, community } = await world({ members: 0 });
    const event = await makeEvent(owner, community.id);
    expect(event.virtualLink).toBe("https://meet.example.com/room-1");
    const [m] = await members(community.id, 1);
    expect((await as(m!).get(`/api/events/${event.id}`).expect(200)).body.virtualLink).toBeNull();
    await as(m!).put(`/api/events/${event.id}/rsvp`).send({ status: "INTERESTED" }).expect(200);
    expect((await as(m!).get(`/api/events/${event.id}`).expect(200)).body.virtualLink).toBeNull();
    expect((await as(m!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200)).body.virtualLink).toBe("https://meet.example.com/room-1");
    expect((await anon().get(`/api/events/${event.id}`).expect(200)).body.virtualLink).toBeNull();
    const ics = await anon().get(`/api/events/${event.id}/ics`).expect(200);
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.text).toContain("BEGIN:VEVENT");
    expect(ics.text).not.toContain("meet.example.com");
    const mine = await as(m!).get(`/api/events/${event.id}/ics`).expect(200);
    expect(mine.text).toContain("meet.example.com");
  });

  test("edits and cancellation notify attendees; raising capacity promotes the waitlist", async () => {
    const { owner, community } = await world({ members: 0 });
    const event = await makeEvent(owner, community.id, { capacity: 1 });
    const [a, b, stranger] = await members(community.id, 3);
    await as(a!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);
    await as(b!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);
    await as(stranger!).patch(`/api/events/${event.id}`).send({ title: "Hijacked" }).expect(403);
    const edited = await as(owner).patch(`/api/events/${event.id}`).send({ capacity: 5, location: "Room 2" }).expect(200);
    expect(edited.body).toMatchObject({ goingCount: 2, waitlistCount: 0, location: "Room 2" });
    expect((await notificationsOf(a!.id)).some((n) => n.type === "EVENT_UPDATED")).toBe(true);
    expect((await notificationsOf(b!.id)).some((n) => n.type === "EVENT_PROMOTED")).toBe(true);
    await as(owner).delete(`/api/events/${event.id}`).expect(204);
    expect((await notificationsOf(a!.id)).some((n) => n.type === "EVENT_CANCELLED")).toBe(true);
    expect((await as(a!).get(`/api/events/${event.id}`).expect(200)).body.status).toBe("CANCELLED");
    expect((await as(stranger!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(409)).body.code).toBe("EVENT_CLOSED");
    await as(owner).patch(`/api/events/${event.id}`).send({ endsAt: inHours(1), startsAt: inHours(2) }).expect(409);
  });

  test("validation: end after start; network-wide events follow settings", async () => {
    const { owner, community } = await world({ members: 0 });
    expect((await as(owner).post("/api/events").send({ communityId: community.id, title: "Bad", startsAt: inHours(5), endsAt: inHours(4) }).expect(400)).body.code).toBe("INVALID_EVENT_TIMES");
    const user = await createUser();
    expect((await as(user).post("/api/events").send({ communityId: null, title: "Global", startsAt: inHours(5), endsAt: inHours(6) }).expect(403)).body.code).toBe("NETWORK_EVENTS_RESTRICTED");
    try {
      await setSettings({ networkWideEvents: "EVERYONE" });
      const e = await makeEvent(user, null);
      expect(e.community).toBeNull();
      const anyone = await createUser();
      await as(anyone).put(`/api/events/${e.id}/rsvp`).send({ status: "GOING" }).expect(200);
    } finally {
      await resetSettings();
    }
  });

  test("lists by scope page once each; attendees list", async () => {
    const { owner, community } = await world({ members: 0 });
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await makeEvent(owner, community.id, { startsAt: inHours(10 + i), endsAt: inHours(11 + i) })).id);
    const past = await makeEvent(owner, community.id, { startsAt: inHours(-5), endsAt: inHours(-4) });
    const up = await allPages(async (c) => (await anon().get(`/api/events?communityId=${community.id}&limit=2${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(up.map((e: { id: string }) => e.id)).toEqual(ids);
    const p = await anon().get(`/api/events?communityId=${community.id}&scope=past`).expect(200);
    expect(p.body.items.map((e: { id: string }) => e.id)).toEqual([past.id]);
    const [m] = await members(community.id, 1);
    await as(m!).put(`/api/events/${ids[0]}/rsvp`).send({ status: "GOING" }).expect(200);
    const going = await as(m!).get("/api/events?scope=going").expect(200);
    expect(going.body.items.map((e: { id: string }) => e.id)).toEqual([ids[0]]);
    const org = await as(owner).get(`/api/events?scope=organising&communityId=${community.id}`).expect(200);
    expect(org.body.items).toHaveLength(6);
    const att = await anon().get(`/api/events/${ids[0]}/attendees`).expect(200);
    expect(att.body.items).toEqual([{ user: expect.objectContaining({ id: m!.id }), status: "GOING" }]);
  });

  test("the reminder job notifies GOING attendees once, an hour before", async () => {
    const { owner, community } = await world({ members: 0 });
    const soon = await makeEvent(owner, community.id, { startsAt: inHours(0.5), endsAt: inHours(1.5) });
    const later = await makeEvent(owner, community.id, { startsAt: inHours(5), endsAt: inHours(6) });
    const [g, i] = await members(community.id, 2);
    await as(g!).put(`/api/events/${soon.id}/rsvp`).send({ status: "GOING" }).expect(200);
    await as(g!).put(`/api/events/${later.id}/rsvp`).send({ status: "GOING" }).expect(200);
    await as(i!).put(`/api/events/${soon.id}/rsvp`).send({ status: "INTERESTED" }).expect(200);
    const run = getHandler("maintenance.event-reminders")!;
    await run({});
    await run({});
    const reminders = (await notificationsOf(g!.id)).filter((n) => n.type === "EVENT_REMINDER");
    expect(reminders.map((n) => n.entity_id)).toEqual([soon.id]);
    expect((await notificationsOf(i!.id)).filter((n) => n.type === "EVENT_REMINDER")).toHaveLength(0);
  });
});
