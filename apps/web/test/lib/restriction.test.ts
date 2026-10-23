import { describe, expect, it } from "vitest";
import { markSuspended, revocationEffect } from "@/lib/realtime/reducers";
import { isRestricted, restrictionMessage } from "@/lib/restriction";
import { me } from "../fixtures";

describe("session:revoked by reason", () => {
  it("keeps a suspended user signed in (read-only)", () => {
    expect(revocationEffect("SUSPENDED").signOut).toBe(false);
  });
  it("signs out on a ban and on a server sign-out", () => {
    expect(revocationEffect("BANNED")).toEqual({ signOut: true, title: "This account has been banned." });
    expect(revocationEffect("SIGNED_OUT")).toEqual({ signOut: true, title: "You were signed out." });
  });
  it("marks the cached user suspended until /auth/me answers", () => {
    const next = markSuspended(me);
    expect(next?.status).toBe("SUSPENDED");
    expect(me.status).toBe("ACTIVE");
    expect(markSuspended(null)).toBeNull();
  });
});

describe("restriction", () => {
  it("is on only for SUSPENDED accounts", () => {
    expect(isRestricted({ status: "SUSPENDED" })).toBe(true);
    expect(isRestricted({ status: "ACTIVE" })).toBe(false);
    expect(isRestricted(null)).toBe(false);
  });
  it("names the end date when the API reports it", () => {
    expect(restrictionMessage("2026-03-05T09:41:00.000Z", "en-US", "UTC")).toBe("Your account is restricted until Thursday, March 5, 2026 at 9:41 AM.");
    expect(restrictionMessage(null)).toBe("Your account is restricted.");
  });
});
