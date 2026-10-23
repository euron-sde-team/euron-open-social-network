import { describe, expect, test } from "vitest";
import { POINTS, REASON_AMOUNT, leaderboardWindowStart, levelFor, pointsForLevel } from "../../src/domain/points";

describe("points and levels", () => {
  test("amounts: +5 post, +2 comment, +2 reaction on a post, +1 on a comment", () => {
    expect(POINTS).toEqual({ POST_CREATED: 5, COMMENT_CREATED: 2, POST_REACTION_RECEIVED: 2, COMMENT_REACTION_RECEIVED: 1 });
    expect(REASON_AMOUNT.post_reaction_received).toBe(2);
  });

  test("level = floor(sqrt(points / 10)) + 1", () => {
    expect([0, 9, 10, 39, 40, 89, 90, 159, 160, 250].map(levelFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 6]);
    expect(levelFor(-5)).toBe(1);
    expect(levelFor(Number.NaN)).toBe(1);
  });

  test("pointsForLevel is the inverse threshold", () => {
    for (let l = 1; l < 20; l++) {
      expect(levelFor(pointsForLevel(l))).toBe(l);
      if (l > 1) expect(levelFor(pointsForLevel(l) - 1)).toBe(l - 1);
    }
  });

  test("leaderboard windows", () => {
    const now = new Date("2026-06-30T00:00:00Z");
    expect(leaderboardWindowStart("all", now)).toBeNull();
    expect(leaderboardWindowStart("week", now)?.toISOString()).toBe("2026-06-23T00:00:00.000Z");
    expect(leaderboardWindowStart("month", now)?.toISOString()).toBe("2026-05-31T00:00:00.000Z");
  });
});
