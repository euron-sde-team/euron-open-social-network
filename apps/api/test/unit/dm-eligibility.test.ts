import { describe, expect, test } from "vitest";
import { canMessage, directKey, type DmFacts } from "../../src/domain/dm-eligibility";

const base: DmFacts = {
  sender: { id: "A", status: "ACTIVE", role: "USER" },
  recipient: { id: "B", status: "ACTIVE", dmPrivacy: "COMMUNITIES" },
  blocked: false,
  sharedCommunity: true,
  recipientFollowsSender: false,
};
const facts = (over: Partial<{ sender: Partial<DmFacts["sender"]>; recipient: Partial<DmFacts["recipient"]> }> & Partial<Omit<DmFacts, "sender" | "recipient">> = {}): DmFacts => ({
  ...base,
  ...over,
  sender: { ...base.sender, ...(over.sender ?? {}) },
  recipient: { ...base.recipient, ...(over.recipient ?? {}) },
});

describe("canMessage", () => {
  test("members of a shared community can message; first contact is a request", () => {
    expect(canMessage(facts())).toEqual({ allowed: true, asRequest: true });
  });

  test("if the recipient follows the sender, it is not a request", () => {
    expect(canMessage(facts({ recipientFollowsSender: true }))).toEqual({ allowed: true, asRequest: false });
  });

  test("no shared community, no message", () => {
    expect(canMessage(facts({ sharedCommunity: false }))).toEqual({ allowed: false, reason: "NO_SHARED_COMMUNITY" });
  });

  test("following someone does not replace the shared-community rule", () => {
    expect(canMessage(facts({ sharedCommunity: false, recipientFollowsSender: true }))).toEqual({ allowed: false, reason: "NO_SHARED_COMMUNITY" });
  });

  test("a block wins over everything, including staff", () => {
    expect(canMessage(facts({ blocked: true }))).toEqual({ allowed: false, reason: "BLOCKED" });
    expect(canMessage(facts({ blocked: true, sender: { role: "ADMIN" } }))).toEqual({ allowed: false, reason: "BLOCKED" });
  });

  test("staff may message anyone who has not blocked them, never as a request", () => {
    expect(canMessage(facts({ sharedCommunity: false, sender: { role: "MODERATOR" }, recipient: { dmPrivacy: "NOBODY" } }))).toEqual({ allowed: true, asRequest: false });
  });

  test("privacy NOBODY refuses ordinary members", () => {
    expect(canMessage(facts({ recipient: { dmPrivacy: "NOBODY" }, recipientFollowsSender: true }))).toEqual({ allowed: false, reason: "RECIPIENT_DISABLED_DMS" });
  });

  test("privacy FOLLOWING needs a follow AND a shared community", () => {
    expect(canMessage(facts({ recipient: { dmPrivacy: "FOLLOWING" } }))).toEqual({ allowed: false, reason: "RECIPIENT_NOT_FOLLOWING" });
    expect(canMessage(facts({ recipient: { dmPrivacy: "FOLLOWING" }, recipientFollowsSender: true }))).toEqual({ allowed: true, asRequest: false });
    expect(canMessage(facts({ recipient: { dmPrivacy: "FOLLOWING" }, recipientFollowsSender: true, sharedCommunity: false }))).toEqual({ allowed: false, reason: "NO_SHARED_COMMUNITY" });
  });

  test("restricted senders and unavailable recipients", () => {
    for (const status of ["SUSPENDED", "BANNED", "DEACTIVATED", "PENDING_VERIFICATION"] as const) {
      expect(canMessage(facts({ sender: { status } }))).toEqual({ allowed: false, reason: "SENDER_RESTRICTED" });
      expect(canMessage(facts({ recipient: { status } }))).toEqual({ allowed: false, reason: "RECIPIENT_UNAVAILABLE" });
    }
  });

  test("you cannot message yourself", () => {
    expect(canMessage(facts({ recipient: { id: "A" } }))).toEqual({ allowed: false, reason: "SELF" });
  });

  test("denials are checked in a fixed order", () => {
    // Blocked AND no shared community: the block is reported, so the UI never hints at membership.
    expect(canMessage(facts({ blocked: true, sharedCommunity: false }))).toEqual({ allowed: false, reason: "BLOCKED" });
  });
});

describe("directKey", () => {
  test("is the same in both directions", () => {
    expect(directKey("01B", "01A")).toBe(directKey("01A", "01B"));
    expect(directKey("01A", "01B")).toBe("01A:01B");
  });
});
