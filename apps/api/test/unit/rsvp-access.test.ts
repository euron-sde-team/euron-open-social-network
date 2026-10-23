import { describe, expect, test } from "vitest";
import { computeAccess, effectiveStatus, outranks, type AccessFacts } from "../../src/domain/community-access";
import { decideRsvp, hasFreeSeat, promotable, waitlistOrder } from "../../src/domain/rsvp";

describe("rsvp decisions", () => {
  test("GOING with a seat, WAITLISTED when full, unlimited without capacity", () => {
    expect(decideRsvp({ capacity: 2, goingCount: 1, current: null, requested: "GOING" })).toMatchObject({ status: "GOING", delta: { going: 1, waitlisted: 0, interested: 0 } });
    expect(decideRsvp({ capacity: 2, goingCount: 2, current: null, requested: "GOING" })).toMatchObject({ status: "WAITLISTED", delta: { going: 0, waitlisted: 1, interested: 0 } });
    expect(decideRsvp({ capacity: null, goingCount: 1000, current: null, requested: "GOING" }).status).toBe("GOING");
  });

  test("asking again keeps your waitlist place; a free seat takes you off the waitlist", () => {
    expect(decideRsvp({ capacity: 1, goingCount: 1, current: "WAITLISTED", requested: "GOING" })).toMatchObject({ status: "WAITLISTED", keepPosition: true, seatsFreed: 0 });
    expect(decideRsvp({ capacity: 2, goingCount: 1, current: "WAITLISTED", requested: "GOING" })).toMatchObject({ status: "GOING", delta: { going: 1, waitlisted: -1, interested: 0 } });
  });

  test("leaving GOING frees a seat, whether to INTERESTED or removed", () => {
    expect(decideRsvp({ capacity: 2, goingCount: 2, current: "GOING", requested: "INTERESTED" })).toMatchObject({ status: "INTERESTED", seatsFreed: 1, delta: { going: -1, waitlisted: 0, interested: 1 } });
    expect(decideRsvp({ capacity: 2, goingCount: 2, current: "GOING", requested: null })).toMatchObject({ status: null, seatsFreed: 1, delta: { going: -1, waitlisted: 0, interested: 0 } });
    expect(decideRsvp({ capacity: 2, goingCount: 2, current: "WAITLISTED", requested: null })).toMatchObject({ seatsFreed: 0, delta: { going: 0, waitlisted: -1, interested: 0 } });
  });

  test("promotable never exceeds free seats or the waitlist", () => {
    expect(promotable(5, 3, 10)).toBe(2);
    expect(promotable(5, 5, 10)).toBe(0);
    expect(promotable(null, 5, 4)).toBe(4);
    expect(promotable(5, 7, 1)).toBe(0);
    expect(hasFreeSeat(3, 2)).toBe(true);
  });

  test("the waitlist is first come, first served by updated_at, then user id", () => {
    const t = (s: number) => new Date(1_700_000_000_000 + s * 1000);
    const rows = [
      { userId: "C", updatedAt: t(5) },
      { userId: "B", updatedAt: t(1) },
      { userId: "A", updatedAt: t(1) },
      { userId: "D", updatedAt: t(3) },
    ];
    expect(waitlistOrder(rows).map((r) => r.userId)).toEqual(["A", "B", "D", "C"]);
  });
});

describe("community access", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const base: AccessFacts = {
    viewer: { id: "U", role: "USER", status: "ACTIVE" },
    community: { visibility: "PRIVATE", status: "PUBLISHED", allowMemberPosts: true },
    membership: { role: "MODERATOR", status: "ACTIVE", suspendedUntil: null },
    now,
  };
  const facts = (over: Partial<AccessFacts>): AccessFacts => ({ ...base, ...over });

  test("an ACTIVE moderator reads, posts and moderates", () => {
    expect(computeAccess(base)).toMatchObject({ isMember: true, canRead: true, canPost: true, canModerate: true, canAdminister: false });
  });

  test("a suspended or banned moderator loses everything, including reading a private community", () => {
    for (const status of ["SUSPENDED", "BANNED", "PENDING", "LEFT"] as const) {
      const a = computeAccess(facts({ membership: { role: "MODERATOR", status, suspendedUntil: status === "SUSPENDED" ? new Date(now.getTime() + 1000) : null } }));
      expect(a, status).toMatchObject({ isMember: false, canRead: false, canPost: false, canInteract: false, canModerate: false });
    }
  });

  test("an expired suspension counts as ACTIVE", () => {
    const m = { role: "MEMBER" as const, status: "SUSPENDED" as const, suspendedUntil: new Date(now.getTime() - 1) };
    expect(effectiveStatus(m, now)).toBe("ACTIVE");
    expect(computeAccess(facts({ membership: m })).canPost).toBe(true);
  });

  test("a restricted account reads but never writes", () => {
    expect(computeAccess(facts({ viewer: { id: "U", role: "USER", status: "SUSPENDED" } }))).toMatchObject({ canRead: true, canPost: false, canInteract: false, canModerate: false });
  });

  test("allowMemberPosts off: members interact but only moderators post", () => {
    const off = { visibility: "PUBLIC" as const, status: "PUBLISHED", allowMemberPosts: false };
    expect(computeAccess(facts({ community: off, membership: { role: "MEMBER", status: "ACTIVE", suspendedUntil: null } }))).toMatchObject({ canPost: false, canInteract: true });
    expect(computeAccess(facts({ community: off })).canPost).toBe(true);
  });

  test("public communities are readable by anyone; staff read and moderate everywhere", () => {
    expect(computeAccess(facts({ viewer: null, community: { ...base.community, visibility: "PUBLIC" }, membership: null })).canRead).toBe(true);
    expect(computeAccess(facts({ viewer: null, membership: null })).canRead).toBe(false);
    expect(computeAccess(facts({ viewer: { id: "S", role: "MODERATOR", status: "ACTIVE" }, membership: null }))).toMatchObject({ canRead: true, canModerate: true, canPost: false });
    expect(computeAccess(facts({ community: { ...base.community, status: "DELETED" } })).canRead).toBe(false);
  });

  test("rank: only strictly higher roles act", () => {
    expect(outranks("OWNER", "ADMIN")).toBe(true);
    expect(outranks("MODERATOR", "MODERATOR")).toBe(false);
    expect(outranks("MODERATOR", "MEMBER")).toBe(true);
    expect(outranks("ADMIN", "OWNER")).toBe(false);
  });
});
