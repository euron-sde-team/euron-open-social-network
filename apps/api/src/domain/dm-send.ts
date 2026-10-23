/**
 * Whether a participant may send into an existing DM thread right now. Pure; the service
 * gathers fresh facts on every send and asks this.
 *
 * canMessage() (dm-eligibility.ts) decides who may START a conversation. Inside a 1:1
 * thread its privacy reasons (no shared community, not followed, DMs off) are waived
 * once the counterpart is ACTIVE in the thread: they started it or accepted it, which is
 * consent. Blocks and account status are never waived.
 *
 * Message requests: while the recipient has not accepted, the sender may send up to
 * REQUEST_MESSAGE_CAP messages, enough to introduce themselves without flooding. The
 * count includes messages the sender has since deleted.
 * A declined request reads as "this person is not accepting messages" so the sender is
 * not told they were declined specifically.
 */
import type { DmDenialReason } from "@open-social/types";
import type { DmDecision } from "./dm-eligibility";

export const REQUEST_MESSAGE_CAP = 3;

export type ParticipantState = "ACTIVE" | "REQUESTED" | "DECLINED" | "LEFT";

export type SendDecision =
  | { allowed: true }
  | { allowed: false; code: "DM_NOT_ALLOWED"; reason: DmDenialReason }
  | { allowed: false; code: "DM_REQUEST_PENDING" };

const HARD: DmDenialReason[] = ["SELF", "SENDER_RESTRICTED", "RECIPIENT_UNAVAILABLE", "BLOCKED"];

export function directSendDecision(i: { eligibility: DmDecision; counterpartState: ParticipantState; sentWhilePending: number }): SendDecision {
  const e = i.eligibility;
  if (!e.allowed && HARD.includes(e.reason)) return { allowed: false, code: "DM_NOT_ALLOWED", reason: e.reason };
  if (i.counterpartState === "DECLINED") return { allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_DISABLED_DMS" };
  if (i.counterpartState === "LEFT") return { allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_UNAVAILABLE" };
  if (!e.allowed && i.counterpartState !== "ACTIVE") return { allowed: false, code: "DM_NOT_ALLOWED", reason: e.reason };
  if (i.counterpartState === "REQUESTED" && i.sentWhilePending >= REQUEST_MESSAGE_CAP) return { allowed: false, code: "DM_REQUEST_PENDING" };
  return { allowed: true };
}

export function groupSendDecision(i: { senderActive: boolean; blockedWithAnyMember: boolean }): SendDecision {
  if (!i.senderActive) return { allowed: false, code: "DM_NOT_ALLOWED", reason: "SENDER_RESTRICTED" };
  if (i.blockedWithAnyMember) return { allowed: false, code: "DM_NOT_ALLOWED", reason: "BLOCKED" };
  return { allowed: true };
}
