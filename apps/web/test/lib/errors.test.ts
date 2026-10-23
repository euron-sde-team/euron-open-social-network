import { describe, expect, it } from "vitest";
import { ApiError } from "@open-social/api-client";
import type { DmDenialReason } from "@open-social/types";
import { dmDenialCopy, errorCopy, errorMessage, isQuietError } from "@/lib/errors";

describe("DM denial copy", () => {
  const reasons: DmDenialReason[] = ["SELF", "BLOCKED", "NO_SHARED_COMMUNITY", "RECIPIENT_NOT_FOLLOWING", "RECIPIENT_DISABLED_DMS", "RECIPIENT_UNAVAILABLE", "SENDER_RESTRICTED"];
  it("has distinct, name-aware copy for every reason", () => {
    const copies = reasons.map((r) => dmDenialCopy(r, "Lin"));
    expect(new Set(copies).size).toBe(reasons.length);
    expect(dmDenialCopy("RECIPIENT_NOT_FOLLOWING", "Lin")).toBe("Lin only accepts messages from people they follow.");
    expect(dmDenialCopy("NO_SHARED_COMMUNITY", "Lin")).toMatch(/Join a community/);
  });
  it("does not reveal more than necessary for blocks", () => {
    expect(dmDenialCopy("BLOCKED", "Lin")).toBe("You can not message Lin.");
  });
  it("falls back for unknown or missing reasons", () => {
    expect(dmDenialCopy(null)).toBe("You can not message this person right now.");
  });
});

describe("error copy", () => {
  it("maps known codes and falls back to the server message", () => {
    expect(errorCopy("RATE_LIMITED")).toMatch(/too fast/);
    expect(errorCopy("SOMETHING_NEW", "Server says no")).toBe("Server says no");
    expect(errorCopy(undefined)).toBe("Something went wrong. Try again.");
  });
  it("uses the first field error for validation failures", () => {
    const e = new ApiError({ status: 400, code: "VALIDATION_FAILED", message: "x", details: { fields: [{ path: "body", message: "must not be empty" }] } });
    expect(errorMessage(e)).toBe("Some fields need attention. Must not be empty.");
  });
  it("treats 404, 401 and validation as quiet", () => {
    expect(isQuietError(new ApiError({ status: 404, code: "NOT_FOUND", message: "" }))).toBe(true);
    expect(isQuietError(new ApiError({ status: 500, code: "SERVER_ERROR", message: "" }))).toBe(false);
  });
});
