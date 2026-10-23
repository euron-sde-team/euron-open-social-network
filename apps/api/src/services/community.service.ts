/**
 * Communities: the directory, creation (subject to platform settings), settings and
 * deletion. Membership rules live in membership.service.ts.
 *
 * Who may create: settings.communityCreation (EVERYONE or STAFF), and at most
 * settings.maxCommunitiesPerUser live communities per creator (staff exempt).
 */
import type { Community, CommunityRule, CommunityVisibility, JoinPolicy } from "@open-social/types";
import type { Actor } from "../core/context";
import { isAdmin, isStaff, requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { presentCommunities, presentCommunity } from "../presenters/community.presenter";
import { communityRepo } from "../repositories/community.repository";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { membershipRepo } from "../repositories/membership.repository";
import { claimSingle } from "./media-attach.service";
import { audit } from "./audit.service";
import { loadContext } from "./membership.service";
import { getSettings } from "./settings.service";

export interface CommunityInput {
  name: string;
  slug?: string;
  description?: string | null;
  visibility: CommunityVisibility;
  joinPolicy: JoinPolicy;
  allowMemberPosts?: boolean;
  rules?: CommunityRule[];
  color?: string | null;
  iconUploadId?: string | null;
  coverUploadId?: string | null;
}

export type CommunityPatch = Partial<CommunityInput> & { premoderatePosts?: boolean };

const SLUG = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "community"}-${Math.random().toString(36).slice(2, 6)}`;
}

async function uniqueSlug(base: string): Promise<string> {
  if (!(await communityRepo.slugTaken(base))) return base;
  for (let i = 2; i < 10; i++) {
    const candidate = `${base.slice(0, 74)}-${i}`;
    if (!(await communityRepo.slugTaken(candidate))) return candidate;
  }
  return `${base.slice(0, 70)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function list(viewer: Actor | null, q: { filter: "all" | "joined" | "managed"; q?: string; cursor?: string; limit: number }): Promise<Paged<Community>> {
  if (q.filter !== "all" && !viewer) return { items: [], nextCursor: null };
  const rows = await communityRepo.list(viewer, { filter: q.filter, q: q.q, cursor: decodeTime(q.cursor), limit: q.limit });
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentCommunities(viewer, page.items), nextCursor: page.nextCursor };
}

export async function suggested(actor: Actor): Promise<Community[]> {
  return presentCommunities(actor, await communityRepo.suggested(actor.id, 10));
}

export async function getBySlug(viewer: Actor | null, slug: string): Promise<Community> {
  const row = await communityRepo.findBySlug(slug);
  if (!row) throw notFound("Community not found");
  const ctx = await loadContext(viewer, row.id);
  return presentCommunity(viewer, ctx.community);
}

export async function create(actor: Actor, input: CommunityInput): Promise<Community> {
  requireActive(actor);
  const settings = await getSettings();
  if (!isStaff(actor)) {
    if (settings.communityCreation === "STAFF") throw forbidden("Only moderators and admins can create communities here", "COMMUNITY_CREATION_RESTRICTED");
    if ((await communityRepo.countLiveCreatedBy(actor.id)) >= settings.maxCommunitiesPerUser) {
      throw forbidden(`You can create at most ${settings.maxCommunitiesPerUser} communities`, "COMMUNITY_LIMIT_REACHED");
    }
  }
  let slug: string;
  if (input.slug) {
    if (!SLUG.test(input.slug)) throw conflict("That address is not valid", "SLUG_INVALID");
    if (await communityRepo.slugTaken(input.slug)) throw conflict("That address is taken", "SLUG_TAKEN");
    slug = input.slug;
  } else slug = await uniqueSlug(slugify(input.name));

  const row = await withTransaction(async (trx) => {
    const icon = await claimSingle(actor.id, input.iconUploadId, "COMMUNITY_ICON", trx);
    const cover = await claimSingle(actor.id, input.coverUploadId, "COMMUNITY_COVER", trx);
    const c = await communityRepo.insert(
      {
        id: newId(),
        slug,
        name: input.name,
        description: input.description ?? null,
        rules: JSON.stringify(input.rules ?? []),
        visibility: input.visibility,
        join_policy: input.joinPolicy,
        allow_member_posts: input.allowMemberPosts ?? true,
        color: input.color ?? null,
        icon_upload_id: icon,
        cover_upload_id: cover,
        member_count: 1,
        created_by: actor.id,
      },
      trx,
    );
    await membershipRepo.insert({ id: newId(), community_id: c.id, user_id: actor.id, role: "OWNER", status: "ACTIVE", joined_at: new Date() }, trx);
    await audit({ actorId: actor.id, action: "community.create", entityType: "community", entityId: c.id }, trx);
    return c;
  });
  return presentCommunity(actor, row);
}

/** Moderators may edit the presentation; visibility, join policy and posting rules need OWNER or ADMIN. */
export async function update(actor: Actor, communityId: string, patch: CommunityPatch): Promise<Community> {
  requireActive(actor);
  const row = await withTransaction(async (trx) => {
    const ctx = await loadContext(actor, communityId, trx);
    if (!ctx.access.canRead) throw notFound("Community not found");
    if (!ctx.access.canModerate) throw forbidden("Only moderators can edit the community", "NOT_A_MODERATOR");
    const settingsFields = ["name", "slug", "visibility", "joinPolicy", "allowMemberPosts", "premoderatePosts"] as const;
    if (settingsFields.some((f) => patch[f] !== undefined) && !ctx.access.canAdminister) {
      throw forbidden("Only the owner or an admin can change community settings", "NOT_COMMUNITY_ADMIN");
    }
    if (patch.slug !== undefined && patch.slug !== ctx.community.slug) {
      if (!SLUG.test(patch.slug)) throw conflict("That address is not valid", "SLUG_INVALID");
      if (await communityRepo.slugTaken(patch.slug, trx)) throw conflict("That address is taken", "SLUG_TAKEN");
    }
    const icon = patch.iconUploadId === undefined ? undefined : patch.iconUploadId === null ? null : await claimSingle(actor.id, patch.iconUploadId, "COMMUNITY_ICON", trx);
    const cover = patch.coverUploadId === undefined ? undefined : patch.coverUploadId === null ? null : await claimSingle(actor.id, patch.coverUploadId, "COMMUNITY_COVER", trx);
    const updated = await communityRepo.update(
      communityId,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.rules !== undefined ? { rules: JSON.stringify(patch.rules) } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.joinPolicy !== undefined ? { join_policy: patch.joinPolicy } : {}),
        ...(patch.allowMemberPosts !== undefined ? { allow_member_posts: patch.allowMemberPosts } : {}),
        ...(patch.premoderatePosts !== undefined ? { premoderate_posts: patch.premoderatePosts } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(icon !== undefined ? { icon_upload_id: icon } : {}),
        ...(cover !== undefined ? { cover_upload_id: cover } : {}),
      },
      trx,
    );
    if (!updated) throw notFound("Community not found");
    await audit({ actorId: actor.id, action: "community.update", entityType: "community", entityId: communityId, data: { fields: Object.keys(patch) } }, trx);
    return updated;
  });
  return presentCommunity(actor, row);
}

export async function remove(actor: Actor, communityId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const ctx = await loadContext(actor, communityId, trx);
    if (!ctx.access.isOwner && !isAdmin(actor)) {
      if (!ctx.access.canRead) throw notFound("Community not found");
      throw forbidden("Only the owner can delete the community", "NOT_OWNER");
    }
    await communityRepo.update(communityId, { status: "DELETED", is_default: false }, trx);
    await audit({ actorId: actor.id, action: "community.delete", entityType: "community", entityId: communityId }, trx);
  });
}
