/**
 * Community rows to DTOs, batched: one query each for the viewer's memberships, the
 * creators and the images of a whole page. A private community the viewer cannot read
 * becomes a limited card (no rules). `admin` (isDefault, status) is added only for
 * platform staff, so nobody else learns a community's oversight state.
 */
import type { Community, Invite, Member } from "@open-social/types";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { computeAccess, type Access } from "../domain/community-access";
import type { CommunityRow, InviteRow } from "../repositories/community.repository";
import { membershipRepo, type MembershipRow } from "../repositories/membership.repository";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export function accessOf(viewer: Actor | null, c: CommunityRow, m: MembershipRow | null | undefined, now = new Date()): Access {
  return computeAccess({
    viewer: viewer ? { id: viewer.id, role: viewer.role, status: viewer.status } : null,
    community: { visibility: c.visibility, status: c.status, allowMemberPosts: c.allow_member_posts },
    membership: m ? { role: m.role, status: m.status, suspendedUntil: m.suspended_until } : null,
    now,
  });
}

/** The viewer's access to each of a set of communities, in one query. */
export async function accessMap(viewer: Actor | null, communities: readonly CommunityRow[], exec: Executor = db): Promise<Map<string, Access>> {
  const memberships = await membershipRepo.forUser(viewer?.id, communities.map((c) => c.id), exec);
  const byCommunity = new Map(memberships.map((m) => [m.community_id, m]));
  const now = new Date();
  return new Map(communities.map((c) => [c.id, accessOf(viewer, c, byCommunity.get(c.id), now)]));
}

export function parseRules(raw: unknown): Community["rules"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is { title: unknown; body: unknown } => !!r && typeof r === "object")
    .map((r) => ({ title: String(r.title ?? ""), body: String(r.body ?? "") }));
}

export async function presentCommunities(viewer: Actor | null, rows: readonly CommunityRow[], exec: Executor = db): Promise<Community[]> {
  if (!rows.length) return [];
  const [access, creators, media] = await Promise.all([
    accessMap(viewer, rows, exec),
    loadSummaries(rows.map((r) => r.created_by), exec),
    loadMedia(rows.flatMap((r) => [r.icon_upload_id, r.cover_upload_id]), exec),
  ]);
  const staff = isStaff(viewer);
  return rows.map((c) => {
    const a = access.get(c.id) as Access;
    const community: Community = {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      rules: a.canRead ? parseRules(c.rules) : [],
      visibility: c.visibility,
      joinPolicy: c.join_policy,
      allowMemberPosts: c.allow_member_posts,
      premoderatePosts: c.premoderate_posts,
      color: c.color,
      iconUrl: urlOf(media, c.icon_upload_id, "thumb"),
      coverUrl: urlOf(media, c.cover_upload_id),
      memberCount: c.member_count,
      postCount: c.post_count,
      createdAt: c.created_at.toISOString(),
      createdBy: c.created_by ? (creators.get(c.created_by) ?? null) : null,
      viewer: { role: a.role, status: a.status, isMember: a.isMember, canPost: a.canPost, canModerate: a.canModerate },
    };
    if (staff) community.admin = { isDefault: c.is_default, status: c.status };
    return community;
  });
}

export async function presentCommunity(viewer: Actor | null, row: CommunityRow, exec: Executor = db): Promise<Community> {
  return (await presentCommunities(viewer, [row], exec))[0] as Community;
}

export async function presentMembers(rows: readonly MembershipRow[], exec: Executor = db): Promise<Member[]> {
  const users = await loadSummaries(rows.map((r) => r.user_id), exec);
  return rows
    .filter((r) => users.has(r.user_id))
    .map((r) => ({
      id: r.id,
      user: users.get(r.user_id)!,
      role: r.role,
      status: r.status,
      joinedAt: r.joined_at?.toISOString() ?? null,
      requestedAt: r.requested_at?.toISOString() ?? null,
    }));
}

export function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    code: row.code,
    url: `${config.APP_WEB_URL.replace(/\/$/, "")}/invite/${row.code}`,
    maxUses: row.max_uses,
    uses: row.uses,
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}
