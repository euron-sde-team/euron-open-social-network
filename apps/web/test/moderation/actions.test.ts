import { describe, expect, it } from "vitest";
import type { ModerationCase } from "@open-social/types";
import { availableActions, canAppeal, caseSnippet, severity, sortedScores } from "@/lib/moderation";

const author = { id: "u1", username: "a", displayName: "A", avatarUrl: null, headline: null, role: "USER" as const };
const base: Pick<ModerationCase, "status" | "targetType" | "targetStatus" | "author"> = { status: "OPEN", targetType: "POST", targetStatus: "PUBLISHED", author };

describe("availableActions", () => {
  it("gives community moderators content actions only", () => {
    expect(availableActions(base, false)).toEqual(["HIDE", "REMOVE", "DISMISS"]);
  });
  it("adds account actions for staff", () => {
    expect(availableActions(base, true)).toEqual(["HIDE", "REMOVE", "DISMISS", "WARN", "SUSPEND", "BAN"]);
  });
  it("offers approve for pre-moderated content and restore for hidden content", () => {
    expect(availableActions({ ...base, targetStatus: "PENDING_REVIEW" }, false)).toEqual(["APPROVE", "HIDE", "REMOVE", "DISMISS"]);
    expect(availableActions({ ...base, targetStatus: "HIDDEN" }, false)).toEqual(["REMOVE", "RESTORE", "DISMISS"]);
    expect(availableActions({ ...base, targetStatus: "REMOVED", status: "RESOLVED" }, false)).toEqual(["RESTORE"]);
  });
  it("treats user cases as account-only and offers unban for banned accounts", () => {
    expect(availableActions({ ...base, targetType: "USER", targetStatus: "ACTIVE" }, false)).toEqual(["DISMISS"]);
    expect(availableActions({ ...base, targetType: "USER", targetStatus: "BANNED" }, true)).toEqual(["DISMISS", "WARN", "SUSPEND", "UNBAN"]);
  });
});

describe("scores and snippets", () => {
  it("buckets severity", () => {
    expect([severity(0.1), severity(0.5), severity(0.79), severity(0.8)]).toEqual(["low", "medium", "medium", "high"]);
  });
  it("sorts categories by score and drops junk", () => {
    expect(sortedScores({ spam: 0.2, hate: 0.9, bad: Number.NaN })).toEqual([["hate", 0.9], ["spam", 0.2]]);
    expect(sortedScores(null)).toEqual([]);
  });
  it("prefers title, then body, then media count", () => {
    expect(caseSnippet({ targetType: "QUESTION", snapshot: { title: "T", body: "B" } })).toBe("T");
    expect(caseSnippet({ targetType: "POST", snapshot: { body: "x".repeat(200) } })).toHaveLength(140);
    expect(caseSnippet({ targetType: "POST", snapshot: { media: [{}, {}] as never } })).toBe("2 attachments");
    expect(caseSnippet({ targetType: "USER", snapshot: {} })).toBe("Account");
  });
});

describe("canAppeal", () => {
  const resolved = (resolution: ModerationCase["resolution"]) => ({ status: "RESOLVED" as const, resolution, targetStatus: "HIDDEN" as const, appeal: null });
  it("allows hide, remove, suspend and ban decisions", () => {
    for (const r of ["HIDE", "REMOVE", "SUSPEND", "BAN"] as const) expect(canAppeal(resolved(r))).toBe(true);
  });
  it("refuses warnings and no-action outcomes (the API answers NOT_APPEALABLE)", () => {
    for (const r of ["WARN", "APPROVE", "DISMISS", "RESTORE", null] as const) expect(canAppeal(resolved(r))).toBe(false);
  });
  it("allows an open case only while the content is auto-hidden", () => {
    expect(canAppeal({ status: "OPEN", resolution: null, targetStatus: "HIDDEN", appeal: null })).toBe(true);
    expect(canAppeal({ status: "OPEN", resolution: null, targetStatus: "PUBLISHED", appeal: null })).toBe(false);
  });
  it("allows one appeal only", () => {
    const appeal = { id: "a1", caseId: "c1", appellant: author, statement: "x", status: "PENDING" as const, decisionNote: null, decidedAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(canAppeal({ ...resolved("REMOVE"), appeal })).toBe(false);
  });
});
