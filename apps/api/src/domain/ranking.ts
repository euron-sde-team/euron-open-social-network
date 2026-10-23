/**
 * Feed ranking. Pure, so the formulas are unit-tested and the SQL in
 * repositories/post.repository.ts mirrors exactly these definitions.
 *
 *   engagement = reactions + 2 * comments          (a comment is worth two reactions)
 *   top        = engagement, over the last TOP_WINDOW_DAYS
 *   hot        = engagement / max(1, age in hours)  (fresh activity beats old totals)
 *
 * Ported from the source system's (upvotes + 2 * comments) / age_hours, with reactions
 * standing in for upvotes.
 */
export const TOP_WINDOW_DAYS = 7;
export const COMMENT_WEIGHT = 2;

export function engagementScore(reactionCount: number, commentCount: number): number {
  return Math.max(0, reactionCount) + COMMENT_WEIGHT * Math.max(0, commentCount);
}

export function ageHours(createdAt: Date, now: Date): number {
  return (now.getTime() - createdAt.getTime()) / 3600_000;
}

export function hotScore(reactionCount: number, commentCount: number, createdAt: Date, now: Date): number {
  return engagementScore(reactionCount, commentCount) / Math.max(1, ageHours(createdAt, now));
}

/** True when a post is inside the "top" window. */
export function inTopWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= TOP_WINDOW_DAYS * 86400_000;
}

/** Sort key used by both top and hot: score descending, then id descending (stable ties). */
export function compareRanked(a: { score: number; id: string }, b: { score: number; id: string }): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
