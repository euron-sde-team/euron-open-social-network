import { describe, expect, it } from "vitest";
import { anchorAfterPrepend, buildRows, isNearBottom } from "@/components/chat/grouping";
import { msg } from "./fixtures";

const at = (h: number, m: number, day = 10) => new Date(2026, 2, day, h, m).toISOString();

describe("buildRows", () => {
  it("adds a day divider before the first message of each day", () => {
    const rows = buildRows([msg("1", "a", at(9, 0, 9)), msg("2", "a", at(9, 1, 10))], new Date(2026, 2, 10, 12).getTime());
    expect(rows.map((r) => r.type)).toEqual(["day", "message", "day", "message"]);
    expect(rows[2]).toMatchObject({ type: "day", label: "Today" });
    expect(rows[0]).toMatchObject({ type: "day", label: "Yesterday" });
  });

  it("groups consecutive messages from one sender within five minutes", () => {
    const rows = buildRows([msg("1", "a", at(9, 0)), msg("2", "a", at(9, 3)), msg("3", "a", at(9, 7)), msg("4", "a", at(9, 20)), msg("5", "b", at(9, 21))]).filter((r) => r.type === "message");
    const flags = rows.map((r) => (r.type === "message" ? [r.message.id, r.firstInGroup, r.lastInGroup] : null));
    expect(flags).toEqual([
      ["1", true, false],
      ["2", false, false],
      ["3", false, true],
      ["4", true, true],
      ["5", true, true],
    ]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("scroll anchoring", () => {
  it("keeps the same content in view after older messages are prepended", () => {
    expect(anchorAfterPrepend({ scrollTop: 40, scrollHeight: 1000 }, 1600)).toBe(640);
    expect(anchorAfterPrepend({ scrollTop: 0, scrollHeight: 1000 }, 900)).toBe(0);
  });

  it("treats the last 120px as the bottom", () => {
    expect(isNearBottom({ scrollTop: 880, scrollHeight: 1500, clientHeight: 500 })).toBe(true);
    expect(isNearBottom({ scrollTop: 700, scrollHeight: 1500, clientHeight: 500 })).toBe(false);
  });
});
