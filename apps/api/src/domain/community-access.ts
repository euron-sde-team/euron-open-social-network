/**
 * What a viewer may do in a community, from their account and their membership. Pure,
 * so every service asks the same question the same way.
 *
 * The rules (fixing the source system, where a suspended moderator kept their powers
 * and rejoining lifted a ban):
 *   - Only an ACTIVE membership counts. SUSPENDED, BANNED, PENDING and LEFT members have
 *     no member rights at all: they cannot read private content, post, react or moderate.
 *   - A community suspension with an end date that has passed counts as ACTIVE.
 *   - A restricted account (not ACTIVE) can read but never write or moderate.
 *   - Platform staff can read every community and moderate any of them.
 */
import type { CommunityRole, CommunityVisibility, MembershipStatus, UserRole, UserStatus } from "@open-social/types";

export const ROLE_RANK: Record<CommunityRole, number> = { OWNER: 4, ADMIN: 3, MODERATOR: 2, MEMBER: 1 };
export const MOD_ROLES: readonly CommunityRole[] = ["OWNER", "ADMIN", "MODERATOR"];

export interface AccessFacts {
  viewer: { id: string; role: UserRole; status: UserStatus } | null;
  community: { visibility: CommunityVisibility; status: string; allowMemberPosts: boolean };
  membership: { role: CommunityRole; status: MembershipStatus; suspendedUntil: Date | null } | null;
  now: Date;
}

export interface Access {
  role: CommunityRole | null;
  status: MembershipStatus | null;
  isMember: boolean;
  canRead: boolean;
  /** Create posts (subject to allowMemberPosts). */
  canPost: boolean;
  /** Comment, react, vote, RSVP, answer. */
  canInteract: boolean;
  canModerate: boolean;
  /** OWNER or ADMIN: settings, roles. */
  canAdminister: boolean;
  isOwner: boolean;
}

export function effectiveStatus(m: AccessFacts["membership"], now: Date): MembershipStatus | null {
  if (!m) return null;
  if (m.status === "SUSPENDED" && m.suspendedUntil && m.suspendedUntil <= now) return "ACTIVE";
  return m.status;
}

export function isStaffRole(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "MODERATOR";
}

export function computeAccess(f: AccessFacts): Access {
  const status = effectiveStatus(f.membership, f.now);
  const role = f.membership?.role ?? null;
  const isMember = status === "ACTIVE";
  const staff = isStaffRole(f.viewer?.role);
  const live = f.community.status === "PUBLISHED";
  const canWrite = !!f.viewer && f.viewer.status === "ACTIVE" && live;
  const modRole = isMember && !!role && MOD_ROLES.includes(role);
  const canRead = live ? f.community.visibility === "PUBLIC" || isMember || staff : staff;
  return {
    role,
    status,
    isMember,
    canRead,
    canPost: canWrite && isMember && (f.community.allowMemberPosts || modRole),
    canInteract: canWrite && isMember,
    canModerate: canWrite && (modRole || staff),
    canAdminister: canWrite && ((isMember && (role === "OWNER" || role === "ADMIN")) || f.viewer?.role === "ADMIN"),
    isOwner: isMember && role === "OWNER",
  };
}

/** A moderator may act on someone only if they strictly outrank them. */
export function outranks(actor: CommunityRole, target: CommunityRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
