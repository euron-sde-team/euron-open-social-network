import { describe, expect, test } from "vitest";
import { ageHours, compareRanked, engagementScore, hotScore, inTopWindow } from "../../src/domain/ranking";
import { decodeScore, decodeTime, encodeScore, encodeTime, pageBy } from "../../src/repositories/keyset";

const now = new Date("2026-06-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe("ranking", () => {
  test("engagement counts a comment as two reactions", () => {
    expect(engagementScore(3, 2)).toBe(7);
    expect(engagementScore(-1, -5)).toBe(0);
  });

  test("hot divides by age in hours, never by less than one", () => {
    expect(hotScore(10, 0, hoursAgo(0.25), now)).toBe(10);
    expect(hotScore(10, 0, hoursAgo(5), now)).toBe(2);
    expect(hotScore(4, 3, hoursAgo(2), now)).toBe(5);
    expect(ageHours(hoursAgo(3), now)).toBe(3);
  });

  test("fresh activity beats an old total", () => {
    expect(hotScore(5, 0, hoursAgo(1), now)).toBeGreaterThan(hotScore(40, 0, hoursAgo(48), now));
  });

  test("top window is seven days", () => {
    expect(inTopWindow(hoursAgo(24 * 7 - 1), now)).toBe(true);
    expect(inTopWindow(hoursAgo(24 * 7 + 1), now)).toBe(false);
  });

  test("ties break by id descending so ordering is total", () => {
    const rows = [
      { score: 1, id: "01A" },
      { score: 3, id: "01B" },
      { score: 1, id: "01C" },
    ];
    expect([...rows].sort(compareRanked).map((r) => r.id)).toEqual(["01B", "01C", "01A"]);
  });
});

describe("keyset cursors", () => {
  const id = "01HZX0000000000000000000AA";
  test("time cursors round-trip microsecond timestamps", () => {
    const at = "2026-01-02T03:04:05.123456+00";
    expect(decodeTime(encodeTime(at, id))).toEqual({ at, id });
    expect(decodeTime(undefined)).toBeNull();
  });

  test("score cursors round-trip floats exactly and carry the hot reference time", () => {
    const score = 0.1 + 0.2;
    expect(decodeScore(encodeScore(score, id))).toEqual({ score, id });
    const ref = "2026-01-02T03:04:05.000000+00";
    expect(decodeScore(encodeScore(2.5, id, ref))).toEqual({ score: 2.5, id, ref });
  });

  test("tampered cursors are rejected with a 400", () => {
    for (const bad of ["x", Buffer.from('["2026-01-01", "nope"]').toString("base64url"), Buffer.from('{"a":1}').toString("base64url"), Buffer.from(`["drop table", "${id}"]`).toString("base64url")]) {
      expect(() => decodeTime(bad)).toThrow(/cursor/i);
    }
    expect(() => decodeScore(Buffer.from(`["NaN", "${id}"]`).toString("base64url"))).toThrow(/cursor/i);
  });

  test("pageBy trims the look-ahead row and only then sets a cursor", () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    expect(pageBy(rows, 3, (r) => String(r.n))).toEqual({ items: rows, nextCursor: null });
    expect(pageBy(rows, 2, (r) => String(r.n))).toEqual({ items: rows.slice(0, 2), nextCursor: "2" });
  });
});
