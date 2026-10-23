/**
 * Reputation. Authoring earns a little, receiving engagement earns more, and levels
 * follow a square-root curve so each level is harder than the last:
 *
 *   level = floor(sqrt(points / 10)) + 1
 *   L1: 0 to 9, L2: 10 to 39, L3: 40 to 89, L4: 90 to 159, L5: 160 to 249 ...
 *
 * Awards go through the points_ledger (one row per reason, entity and actor), so an
 * award is idempotent and a revocation removes exactly what was granted.
 */
export const POINTS = {
  POST_CREATED: 5,
  COMMENT_CREATED: 2,
  POST_REACTION_RECEIVED: 2,
  COMMENT_REACTION_RECEIVED: 1,
} as const;

export type PointsReason = "post_created" | "comment_created" | "post_reaction_received" | "comment_reaction_received";

export const REASON_AMOUNT: Record<PointsReason, number> = {
  post_created: POINTS.POST_CREATED,
  comment_created: POINTS.COMMENT_CREATED,
  post_reaction_received: POINTS.POST_REACTION_RECEIVED,
  comment_reaction_received: POINTS.COMMENT_REACTION_RECEIVED,
};

export function levelFor(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 1;
  return Math.floor(Math.sqrt(points / 10)) + 1;
}

/** Points needed to reach a level (the inverse of levelFor). */
export function pointsForLevel(level: number): number {
  if (level <= 1) return 0;
  return 10 * (level - 1) ** 2;
}

/** Start of a leaderboard window, in UTC. "all" has no start. */
export function leaderboardWindowStart(period: "week" | "month" | "all", now: Date): Date | null {
  if (period === "all") return null;
  const days = period === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 86400_000);
}
