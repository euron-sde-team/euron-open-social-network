import { describe, expect, test } from "vitest";
import type { DmDecision } from "../../src/domain/dm-eligibility";
import { directSendDecision, groupSendDecision, REQUEST_MESSAGE_CAP } from "../../src/domain/dm-send";
import { inboxTotals, isUnread } from "../../src/domain/unread";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

describe("isUnread", () => {
  const joined = t(0);
  test("newer than the read cursor, not mine, published", () => {
    expect(isUnread({ senderId: "B", status: "PUBLISHED", createdAt: t(10) }, "A", t(5), joined)).toBe(true);
    expect(isUnread({ senderId: "B", status: "PUBLISHED", createdAt: t(5) }, "A", t(5), joined)).toBe(false);
    expect(isUnread({ senderId: "A", status: "PUBLISHED", createdAt: t(10) }, "A", null, joined)).toBe(false);
    expect(isUnread({ senderId: "B", status: "DELETED", createdAt: t(10) }, "A", null, joined)).toBe(false);
    expect(isUnread({ senderId: "B", status: "HIDDEN", createdAt: t(10) }, "A", null, joined)).toBe(false);
  });
  test("never read: anything after joining counts, history before joining does not", () => {
    expect(isUnread({ senderId: "B", status: "PUBLISHED", createdAt: t(10) }, "A", null, t(3))).toBe(true);
    expect(isUnread({ senderId: "B", status: "PUBLISHED", createdAt: t(1) }, "A", null, t(3))).toBe(false);
  });
});

describe("inboxTotals", () => {
  const now = t(100);
  test("inbox sums unread messages of accepted, unmuted threads; requests counts threads", () => {
    expect(
      inboxTotals(
        [
          { state: "ACTIVE", unread: 3, mutedUntil: null },
          { state: "ACTIVE", unread: 2, mutedUntil: t(50) },
          { state: "ACTIVE", unread: 4, mutedUntil: t(200) },
          { state: "REQUESTED", unread: 5, mutedUntil: null },
          { state: "REQUESTED", unread: 0, mutedUntil: null },
          { state: "DECLINED", unread: 9, mutedUntil: null },
        ],
        now,
      ),
    ).toEqual({ inbox: 5, requests: 1 });
  });
  test("nothing unread", () => expect(inboxTotals([], now)).toEqual({ inbox: 0, requests: 0 }));
});

describe("directSendDecision", () => {
  const allowed: DmDecision = { allowed: true, asRequest: true };
  test("pending request: up to the cap, then DM_REQUEST_PENDING", () => {
    expect(directSendDecision({ eligibility: allowed, counterpartState: "REQUESTED", sentWhilePending: REQUEST_MESSAGE_CAP - 1 })).toEqual({ allowed: true });
    expect(directSendDecision({ eligibility: allowed, counterpartState: "REQUESTED", sentWhilePending: REQUEST_MESSAGE_CAP })).toEqual({ allowed: false, code: "DM_REQUEST_PENDING" });
  });
  test("declined reads as DMs disabled", () => {
    expect(directSendDecision({ eligibility: allowed, counterpartState: "DECLINED", sentWhilePending: 0 })).toEqual({ allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_DISABLED_DMS" });
  });
  test("privacy reasons are waived once the counterpart is ACTIVE; blocks never are", () => {
    expect(directSendDecision({ eligibility: { allowed: false, reason: "NO_SHARED_COMMUNITY" }, counterpartState: "ACTIVE", sentWhilePending: 0 })).toEqual({ allowed: true });
    expect(directSendDecision({ eligibility: { allowed: false, reason: "NO_SHARED_COMMUNITY" }, counterpartState: "REQUESTED", sentWhilePending: 0 })).toMatchObject({ allowed: false, reason: "NO_SHARED_COMMUNITY" });
    expect(directSendDecision({ eligibility: { allowed: false, reason: "BLOCKED" }, counterpartState: "ACTIVE", sentWhilePending: 0 })).toMatchObject({ allowed: false, reason: "BLOCKED" });
    expect(directSendDecision({ eligibility: { allowed: false, reason: "SENDER_RESTRICTED" }, counterpartState: "ACTIVE", sentWhilePending: 0 })).toMatchObject({ allowed: false, reason: "SENDER_RESTRICTED" });
  });
  test("groups: restricted senders and blocks stop sends", () => {
    expect(groupSendDecision({ senderActive: true, blockedWithAnyMember: false })).toEqual({ allowed: true });
    expect(groupSendDecision({ senderActive: false, blockedWithAnyMember: false })).toMatchObject({ reason: "SENDER_RESTRICTED" });
    expect(groupSendDecision({ senderActive: true, blockedWithAnyMember: true })).toMatchObject({ reason: "BLOCKED" });
  });
});
