import type { ModerationActionType, ModerationCase } from "@open-social/types";

export const MOD_ACTIONS: ModerationActionType[] = ["APPROVE", "HIDE", "REMOVE", "RESTORE", "DISMISS"];
export const STAFF_ACTIONS: ModerationActionType[] = ["WARN", "SUSPEND", "BAN"];
export const DESTRUCTIVE = new Set<ModerationActionType>(["REMOVE", "SUSPEND", "BAN"]);

export const ACTION_LABEL: Record<ModerationActionType, string> = {
  APPROVE: "Approve",
  HIDE: "Hide",
  REMOVE: "Remove",
  RESTORE: "Restore",
  WARN: "Warn author",
  SUSPEND: "Suspend author",
  BAN: "Ban author",
  UNBAN: "Unban author",
  DISMISS: "Dismiss",
};

/**
 * Actions offered for a case. Community moderators act on content only;
 * platform staff can also act on the account. Actions that would not change
 * anything given the target's current status are left out.
 */
export function availableActions(c: Pick<ModerationCase, "status" | "targetType" | "targetStatus" | "author">, isStaff: boolean): ModerationActionType[] {
  const isUser = c.targetType === "USER";
  const out: ModerationActionType[] = [];
  if (!isUser) {
    const s = c.targetStatus;
    if (s === "PENDING_REVIEW") out.push("APPROVE");
    if (s !== "HIDDEN" && s !== "REMOVED" && s !== "DELETED") out.push("HIDE");
    if (s !== "REMOVED" && s !== "DELETED") out.push("REMOVE");
    if (s === "HIDDEN" || s === "REMOVED") out.push("RESTORE");
  }
  if (c.status === "OPEN") out.push("DISMISS");
  if (isStaff && (c.author || isUser)) {
    out.push("WARN", "SUSPEND");
    out.push(c.targetStatus === "BANNED" ? "UNBAN" : "BAN");
  }
  return out;
}

export type Severity = "low" | "medium" | "high";
export function severity(score: number): Severity {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/** Categories sorted by score, highest first. */
export function sortedScores(scores: Record<string, number> | null | undefined): [string, number][] {
  return Object.entries(scores ?? {})
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
}

export function caseSnippet(c: Pick<ModerationCase, "snapshot" | "targetType">): string {
  const s = c.snapshot ?? {};
  const text = (typeof s.title === "string" && s.title) || (typeof s.body === "string" && s.body) || "";
  if (text) return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  if (Array.isArray(s.media) && s.media.length) return `${s.media.length} attachment${s.media.length === 1 ? "" : "s"}`;
  return c.targetType === "USER" ? "Account" : "No text";
}

export const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Resolutions the author may appeal. WARN is not one: the API answers NOT_APPEALABLE. */
export const APPEALABLE_RESOLUTIONS: readonly ModerationActionType[] = ["HIDE", "REMOVE", "SUSPEND", "BAN"];

/**
 * Whether the author may appeal this case: once, against a hide, removal,
 * suspension or ban, or while the case is still open if the content was
 * already hidden automatically.
 */
export function canAppeal(c: Pick<ModerationCase, "status" | "resolution" | "targetStatus" | "appeal">): boolean {
  if (c.appeal) return false;
  if (c.status === "OPEN") return c.targetStatus === "HIDDEN";
  return !!c.resolution && APPEALABLE_RESOLUTIONS.includes(c.resolution);
}
