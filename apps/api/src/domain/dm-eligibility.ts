/**
 * Who may message whom. Pure: the service gathers the facts, this decides.
 *
 * The rules, in order (the first that applies wins):
 *   1. You cannot message yourself.
 *   2. A restricted sender (suspended, banned) cannot start conversations.
 *   3. A recipient who is not ACTIVE cannot be messaged.
 *   4. A block in EITHER direction stops everything, staff included.
 *   5. Staff (moderators, admins) may message anyone, for support.
 *   6. The recipient's privacy setting:
 *        NOBODY      nobody but staff
 *        FOLLOWING   only people the recipient follows, who also share a community
 *        COMMUNITIES anyone who shares at least one community (both ACTIVE members)
 *
 * A first contact from someone the recipient does not follow arrives as a message
 * request: the recipient sees it under "Message requests" and is not notified loudly
 * until they accept.
 */
import type { DmDenialReason, DmPrivacy, UserRole, UserStatus } from "@open-social/types";

export interface DmFacts {
  sender: { id: string; status: UserStatus; role: UserRole };
  recipient: { id: string; status: UserStatus; dmPrivacy: DmPrivacy };
  /** A block exists in either direction. */
  blocked: boolean;
  /** Both are ACTIVE members of at least one common community. */
  sharedCommunity: boolean;
  /** The recipient follows the sender. */
  recipientFollowsSender: boolean;
}

export type DmDecision = { allowed: true; asRequest: boolean } | { allowed: false; reason: DmDenialReason };

export function canMessage(f: DmFacts): DmDecision {
  if (f.sender.id === f.recipient.id) return { allowed: false, reason: "SELF" };
  if (f.sender.status !== "ACTIVE") return { allowed: false, reason: "SENDER_RESTRICTED" };
  if (f.recipient.status !== "ACTIVE") return { allowed: false, reason: "RECIPIENT_UNAVAILABLE" };
  if (f.blocked) return { allowed: false, reason: "BLOCKED" };
  if (f.sender.role === "ADMIN" || f.sender.role === "MODERATOR") return { allowed: true, asRequest: false };
  if (f.recipient.dmPrivacy === "NOBODY") return { allowed: false, reason: "RECIPIENT_DISABLED_DMS" };
  if (!f.sharedCommunity) return { allowed: false, reason: "NO_SHARED_COMMUNITY" };
  if (f.recipient.dmPrivacy === "FOLLOWING" && !f.recipientFollowsSender) return { allowed: false, reason: "RECIPIENT_NOT_FOLLOWING" };
  return { allowed: true, asRequest: !f.recipientFollowsSender };
}

/** Human copy for each denial, shown in the composer. */
export const DM_DENIAL_MESSAGES: Record<DmDenialReason, string> = {
  SELF: "You cannot message yourself.",
  BLOCKED: "You cannot message this person.",
  NO_SHARED_COMMUNITY: "You can message people once you are in a community together.",
  RECIPIENT_NOT_FOLLOWING: "This person only accepts messages from people they follow.",
  RECIPIENT_DISABLED_DMS: "This person is not accepting messages.",
  RECIPIENT_UNAVAILABLE: "This account is not available.",
  SENDER_RESTRICTED: "Your account cannot send messages right now.",
};

/** The canonical key of a 1:1 thread: the two ids sorted, so A->B and B->A find the same row. */
export function directKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
