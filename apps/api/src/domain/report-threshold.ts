/**
 * When user reports alone take content down. Pure, so the rule is unit-tested.
 *
 * Three distinct reporters whose accounts are older than a day hide the content
 * pending review. The caller passes only reporters on the target's OPEN case who are
 * ACTIVE (moderationRepo.reporterAges), so content a moderator restored needs three
 * new reports, not one. The age floor stops a burst of throwaway accounts from taking down
 * anything they like; staff content is never auto-hidden (it still gets a case); and
 * only content is hidden this way, never a whole account or community.
 */
import type { ModerationTarget } from "@open-social/types";

export const AUTO_HIDE_REPORTERS = 3;
export const MIN_REPORTER_AGE_DAYS = 1;
export const REPORT_PRIORITY_STEP = 10;
export const MAX_PRIORITY = 1000;

export interface ReportHideFacts {
  targetType: ModerationTarget;
  /** Account age in days of each ACTIVE reporter on the target's open case. */
  reporterAgesDays: number[];
  authorIsStaff: boolean;
  /** Current status of the target; only PUBLISHED content can be hidden. */
  targetStatus: string;
}

export function shouldAutoHideFromReports(f: ReportHideFacts): boolean {
  if (f.targetType === "USER" || f.targetType === "COMMUNITY") return false;
  if (f.authorIsStaff || f.targetStatus !== "PUBLISHED") return false;
  return f.reporterAgesDays.filter((d) => d > MIN_REPORTER_AGE_DAYS).length >= AUTO_HIDE_REPORTERS;
}

/** Each report raises the case in the queue, up to a cap. */
export function bumpPriority(current: number, step = REPORT_PRIORITY_STEP): number {
  return Math.min(current + step, MAX_PRIORITY);
}
