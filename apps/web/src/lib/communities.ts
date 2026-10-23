/** Pure helpers for the communities area (unit-tested). */
import type { Community, CommunityRole, JoinPolicy, MembershipStatus } from "@open-social/types";

/** URL-safe slug from a name: lower case, ascii letters and digits joined by single hyphens, max 48. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export type JoinState = "join" | "request" | "requested" | "joined" | "invite-only" | "banned" | "suspended" | "owner";

/** What the join button should offer, from the viewer's membership and the join policy. */
export function joinState(viewer: Pick<Community["viewer"], "role" | "status" | "isMember">, policy: JoinPolicy): JoinState {
  if (viewer.status === "BANNED") return "banned";
  if (viewer.status === "SUSPENDED") return "suspended";
  if (viewer.status === "ACTIVE" || viewer.isMember) return viewer.role === "OWNER" ? "owner" : "joined";
  if (viewer.status === "PENDING") return "requested";
  if (policy === "INVITE_ONLY") return "invite-only";
  if (policy === "APPROVAL") return "request";
  return "join";
}

export const JOIN_LABEL: Record<JoinState, string> = {
  join: "Join community",
  request: "Request to join",
  requested: "Requested",
  joined: "Joined",
  owner: "Owner",
  "invite-only": "Invite only",
  banned: "Banned",
  suspended: "Suspended",
};

export const ROLE_LABEL: Record<CommunityRole, string> = { OWNER: "Owner", ADMIN: "Admin", MODERATOR: "Moderator", MEMBER: "Member" };

export const STATUS_LABEL: Partial<Record<MembershipStatus, string>> = { PENDING: "Requests", SUSPENDED: "Suspended", BANNED: "Banned", ACTIVE: "Members" };

export const JOIN_POLICY_COPY: Record<JoinPolicy, { label: string; hint: string }> = {
  OPEN: { label: "Anyone can join", hint: "People join instantly" },
  APPROVAL: { label: "Approval required", hint: "Moderators approve each request" },
  INVITE_ONLY: { label: "Invite only", hint: "People need an invite link" },
};

/** Accent colours offered in the community form (all readable with white text). */
export const COMMUNITY_COLORS = ["#2557D6", "#0E7C66", "#7A3FD1", "#C2410C", "#B4235A", "#0369A1", "#4D7C0F", "#475569"] as const;

/** Can the viewer manage settings (OWNER or ADMIN of the community)? */
export const canManageSettings = (c: Pick<Community, "viewer">) => c.viewer.role === "OWNER" || c.viewer.role === "ADMIN";

/** Roles an actor may assign: owners assign up to ADMIN, admins up to MODERATOR. */
export function assignableRoles(actor: CommunityRole | null): CommunityRole[] {
  if (actor === "OWNER") return ["ADMIN", "MODERATOR", "MEMBER"];
  if (actor === "ADMIN") return ["MODERATOR", "MEMBER"];
  return [];
}

/** Parse "a, b #c" tag input into unique lowercase tags. */
export function parseTags(input: string, max = 5): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const t = raw.replace(/^#/, "").toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "");
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export type CommunityTab = "discussion" | "chat" | "qa" | "events" | "members" | "media" | "about";
export const COMMUNITY_TABS: { value: CommunityTab; label: string; membersOnly?: boolean }[] = [
  { value: "discussion", label: "Discussion" },
  { value: "chat", label: "Chat", membersOnly: true },
  { value: "qa", label: "Q&A" },
  { value: "events", label: "Events" },
  { value: "members", label: "Members" },
  { value: "media", label: "Media" },
  { value: "about", label: "About" },
];

export function normaliseTab(v: string | null | undefined): CommunityTab {
  return COMMUNITY_TABS.some((t) => t.value === v) ? (v as CommunityTab) : "discussion";
}

/** Toggle a vote: clicking the current direction clears it. Returns the new vote and score. */
export function nextVote(current: -1 | 0 | 1, clicked: -1 | 1, score: number): { vote: -1 | 0 | 1; score: number } {
  const vote: -1 | 0 | 1 = current === clicked ? 0 : clicked;
  return { vote, score: score - current + vote };
}
