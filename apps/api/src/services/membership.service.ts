/**
 * Membership: joining (OPEN, APPROVAL, INVITE_ONLY and invite codes), leaving,
 * approvals, roles, suspensions, bans, ownership transfer, invites and per-community
 * notification settings (what each one silences: domain/notification-prefs.ts). Also the access gates every other social service uses:
 *
 *   requireReadable   404 unless the viewer may read the community's content
 *   requireMember     an ACTIVE member with an ACTIVE account (403 otherwise)
 *   requireModerator  OWNER/ADMIN/MODERATOR (ACTIVE) or platform staff
 *
 * Fixes from the source system: rejoining never lifts a ban or an unexpired suspension;
 * a suspended or banned moderator has no powers; nobody can act on someone of equal or
 * higher rank, and nobody can act on the OWNER.
 *
 * Losing membership (leaving, removal, suspension, ban) also takes the person's sockets
 * out of the community's chat: and community: rooms after commit (revokeRooms), so live
 * chat stops at once instead of at their next reconnect. post: rooms are left lazily:
 * a post room only carries counts and new comments the person could read anyway when the
 * community is public, and private posts drop out on the next subscribe check.
 */
import crypto from "node:crypto";
import type { CommunityRole, Invite, Member, MembershipStatus } from "@open-social/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { outranks, type Access } from "../domain/community-access";
import { readCommunityNotificationSettings, type CommunityNotificationSettings } from "../domain/notification-prefs";
import { accessOf, presentCommunity, presentMembers, toInvite } from "../presenters/community.presenter";
import { rooms } from "../realtime/port";
import { communityRepo, type CommunityRow, type InviteRow } from "../repositories/community.repository";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { membershipRepo, type MembershipRow } from "../repositories/membership.repository";
import { audit } from "./audit.service";
import { notify } from "./notification.service";

/** After commit: the user's sockets leave the community's live rooms. */
export function revokeRooms(fx: Effects, userId: string, communityId: string): void {
  fx.leave([userId], [rooms.chat(communityId), rooms.community(communityId)]);
}

export interface CommunityContext {
  community: CommunityRow;
  membership: MembershipRow | null;
  access: Access;
}

/** A timed suspension that has run out becomes ACTIVE again (and counts as a member). */
async function liftIfExpired(m: MembershipRow | undefined, exec: Executor): Promise<MembershipRow | undefined> {
  if (!m || m.status !== "SUSPENDED" || !m.suspended_until || m.suspended_until > new Date()) return m;
  const res = await exec
    .updateTable("community_members")
    .set({ status: "ACTIVE", suspended_until: null, updated_at: new Date() })
    .where("id", "=", m.id)
    .where("status", "=", "SUSPENDED")
    .returningAll()
    .executeTakeFirst();
  if (res) await communityRepo.adjust(m.community_id, { members: 1 }, exec);
  return res ?? m;
}

/** Load a community and the viewer's standing in it. 404 when it does not exist or is gone. */
export async function loadContext(viewer: Actor | null, communityId: string, exec: Executor = db, opts: { lock?: boolean } = {}): Promise<CommunityContext> {
  const community = opts.lock ? await communityRepo.findByIdForUpdate(communityId, exec) : await communityRepo.findById(communityId, exec);
  if (!community) throw notFound("Community not found");
  const raw = viewer ? (opts.lock ? await membershipRepo.findForUpdate(community.id, viewer.id, exec) : await membershipRepo.find(community.id, viewer.id, exec)) : undefined;
  const membership = (await liftIfExpired(raw, exec)) ?? null;
  const access = accessOf(viewer, community, membership);
  if (community.status !== "PUBLISHED" && !(viewer && (viewer.role === "ADMIN" || viewer.role === "MODERATOR"))) throw notFound("Community not found");
  return { community, membership, access };
}

export async function requireReadable(viewer: Actor | null, communityId: string, exec: Executor = db): Promise<CommunityContext> {
  const ctx = await loadContext(viewer, communityId, exec);
  if (!ctx.access.canRead) throw notFound("Community not found");
  return ctx;
}

export async function requireMember(actor: Actor | null, communityId: string, exec: Executor = db): Promise<CommunityContext> {
  const a = requireActive(actor);
  const ctx = await requireReadable(a, communityId, exec);
  if (!ctx.access.canInteract) throw memberError(ctx);
  return ctx;
}

export async function requireModerator(actor: Actor | null, communityId: string, exec: Executor = db): Promise<CommunityContext> {
  const a = requireActive(actor);
  const ctx = await requireReadable(a, communityId, exec);
  if (!ctx.access.canModerate) throw forbidden("Only moderators can do that", "NOT_A_MODERATOR");
  return ctx;
}

export function memberError(ctx: CommunityContext) {
  const s = ctx.access.status;
  if (s === "SUSPENDED") return forbidden("You are suspended in this community", "MEMBERSHIP_SUSPENDED");
  if (s === "BANNED") return forbidden("You are banned from this community", "BANNED_FROM_COMMUNITY");
  return forbidden("Join the community first", "NOT_A_MEMBER");
}

// ─── Joining and leaving ────────────────────────────────────────────────────

export function inviteUsable(inv: InviteRow | undefined, communityId?: string): inv is InviteRow {
  if (!inv || inv.revoked_at) return false;
  if (communityId && inv.community_id !== communityId) return false;
  if (inv.expires_at && inv.expires_at <= new Date()) return false;
  if (inv.max_uses !== null && inv.uses >= inv.max_uses) return false;
  return true;
}

export async function join(actor: Actor, communityId: string, inviteCode: string | undefined): Promise<{ status: "ACTIVE" | "PENDING" }> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const community = await communityRepo.findById(communityId, trx);
    if (!community || community.status !== "PUBLISHED") throw notFound("Community not found");
    const existing = await liftIfExpired(await membershipRepo.findForUpdate(community.id, actor.id, trx), trx);
    if (existing?.status === "ACTIVE") return { status: "ACTIVE" as const };
    if (existing?.status === "BANNED") throw forbidden("You are banned from this community", "BANNED_FROM_COMMUNITY");
    if (existing?.status === "SUSPENDED") throw forbidden("You are suspended in this community", "MEMBERSHIP_SUSPENDED");

    let invite: InviteRow | null = null;
    if (inviteCode) {
      const inv = await communityRepo.findInviteByCodeForUpdate(inviteCode, trx);
      if (!inviteUsable(inv, community.id)) throw badRequest("This invite link is invalid or has expired", "INVITE_INVALID");
      invite = inv;
    }
    if (existing?.status === "PENDING" && !invite) return { status: "PENDING" as const };

    let status: "ACTIVE" | "PENDING";
    if (invite || community.join_policy === "OPEN") status = "ACTIVE";
    else if (community.join_policy === "APPROVAL") status = "PENDING";
    else throw forbidden("This community is invite only", "INVITE_REQUIRED");

    const now = new Date();
    const patch = {
      role: "MEMBER" as const,
      status,
      suspended_until: null,
      joined_at: status === "ACTIVE" ? now : null,
      requested_at: status === "PENDING" ? now : null,
    };
    if (existing) await membershipRepo.update(existing.id, patch, trx);
    else await membershipRepo.insert({ id: newId(), community_id: community.id, user_id: actor.id, ...patch }, trx);

    if (status === "ACTIVE") {
      await communityRepo.adjust(community.id, { members: 1 }, trx);
      if (invite) await communityRepo.useInvite(invite.id, trx);
    } else {
      for (const modId of await membershipRepo.moderatorIds(community.id, trx)) {
        await notify(
          { recipientId: modId, actorId: actor.id, type: "JOIN_REQUEST", entityType: "community", entityId: community.id, communityId: community.id, snippet: community.name, data: { slug: community.slug } },
          fx,
          trx,
        );
      }
    }
    return { status };
  });
}

export async function cancelRequest(actor: Actor, communityId: string): Promise<void> {
  await withTransaction(async (trx) => {
    const m = await membershipRepo.findForUpdate(communityId, actor.id, trx);
    if (!m || m.status !== "PENDING") throw notFound("No pending request");
    await membershipRepo.update(m.id, { status: "LEFT", requested_at: null }, trx);
  });
}

export async function leave(actor: Actor, communityId: string): Promise<void> {
  await withTransaction(async (trx, fx) => {
    const m = await membershipRepo.findForUpdate(communityId, actor.id, trx);
    if (!m || m.status !== "ACTIVE") throw notFound("You are not a member");
    if (m.role === "OWNER") throw conflict("Transfer ownership before leaving", "OWNER_MUST_TRANSFER");
    await membershipRepo.update(m.id, { status: "LEFT", role: "MEMBER" }, trx);
    await communityRepo.adjust(communityId, { members: -1 }, trx);
    revokeRooms(fx, actor.id, communityId);
  });
}

export async function transferOwnership(actor: Actor, communityId: string, userId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const ctx = await loadContext(actor, communityId, trx, { lock: true });
    if (!ctx.access.isOwner) throw forbidden("Only the owner can transfer the community", "NOT_OWNER");
    if (userId === actor.id) throw badRequest("You already own this community");
    const target = await membershipRepo.findForUpdate(communityId, userId, trx);
    if (!target || target.status !== "ACTIVE") throw notFound("That person is not a member");
    await membershipRepo.update(target.id, { role: "OWNER" }, trx);
    await membershipRepo.update(ctx.membership!.id, { role: "ADMIN" }, trx);
    await audit({ actorId: actor.id, action: "community.transfer", entityType: "community", entityId: communityId, data: { to: userId } }, trx);
  });
}

// ─── Members ────────────────────────────────────────────────────────────────

export async function listMembers(
  viewer: Actor | null,
  communityId: string,
  q: { status?: MembershipStatus; role?: CommunityRole; q?: string; cursor?: string; limit: number },
): Promise<Paged<Member>> {
  const ctx = await requireReadable(viewer, communityId);
  const status = q.status ?? "ACTIVE";
  if (status !== "ACTIVE" && !ctx.access.canModerate) throw forbidden("Only moderators can see that list", "NOT_A_MODERATOR");
  const rows = await membershipRepo.list(communityId, viewer?.id ?? null, { status, role: q.role, q: q.q, cursor: decodeTime(q.cursor), limit: q.limit });
  const page = timePage(rows, q.limit);
  return { items: await presentMembers(page.items), nextCursor: page.nextCursor };
}

/** Lock the target membership and check the actor may act on it. */
async function targetFor(ctx: CommunityContext, actor: Actor, userId: string, exec: Executor): Promise<MembershipRow> {
  if (userId === actor.id) throw badRequest("You cannot do that to yourself", "SELF_ACTION");
  const target = await membershipRepo.findForUpdate(ctx.community.id, userId, exec);
  if (!target || target.status === "LEFT") throw notFound("Member not found");
  if (target.role === "OWNER") throw forbidden("The owner cannot be moderated", "TARGET_IS_OWNER");
  const staff = actor.role === "ADMIN" || actor.role === "MODERATOR";
  const actorRole = ctx.membership?.status === "ACTIVE" ? ctx.membership.role : null;
  if (!staff && (!actorRole || !outranks(actorRole, target.role))) throw forbidden("You cannot moderate someone of equal or higher rank", "INSUFFICIENT_RANK");
  return target;
}

async function moderate<T>(actor: Actor, communityId: string, fn: (ctx: CommunityContext, trx: Executor, fx: Effects) => Promise<T>): Promise<T> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const ctx = await loadContext(actor, communityId, trx);
    if (!ctx.access.canRead) throw notFound("Community not found");
    if (!ctx.access.canModerate) throw forbidden("Only moderators can do that", "NOT_A_MODERATOR");
    return fn(ctx, trx, fx);
  });
}

async function memberDto(row: MembershipRow): Promise<Member> {
  return (await presentMembers([row]))[0] as Member;
}

export async function approve(actor: Actor, communityId: string, userId: string): Promise<Member> {
  const row = await moderate(actor, communityId, async (ctx, trx, fx) => {
    const m = await membershipRepo.findForUpdate(communityId, userId, trx);
    if (!m || m.status !== "PENDING") throw notFound("No pending request from that person");
    const updated = await membershipRepo.update(m.id, { status: "ACTIVE", joined_at: new Date() }, trx);
    await communityRepo.adjust(communityId, { members: 1 }, trx);
    await notify(
      { recipientId: userId, actorId: actor.id, type: "MEMBERSHIP_APPROVED", entityType: "community", entityId: communityId, communityId, snippet: ctx.community.name, data: { slug: ctx.community.slug } },
      fx,
      trx,
    );
    return updated;
  });
  return memberDto(row);
}

export async function reject(actor: Actor, communityId: string, userId: string): Promise<void> {
  await moderate(actor, communityId, async (_ctx, trx) => {
    const m = await membershipRepo.findForUpdate(communityId, userId, trx);
    if (!m || m.status !== "PENDING") throw notFound("No pending request from that person");
    await membershipRepo.update(m.id, { status: "LEFT", requested_at: null }, trx);
  });
}

export async function setRole(actor: Actor, communityId: string, userId: string, role: "ADMIN" | "MODERATOR" | "MEMBER"): Promise<Member> {
  const row = await moderate(actor, communityId, async (ctx, trx) => {
    if (!ctx.access.canAdminister) throw forbidden("Only the owner or an admin can change roles", "NOT_COMMUNITY_ADMIN");
    const target = await targetFor(ctx, actor, userId, trx);
    if (target.status !== "ACTIVE") throw conflict("Only active members can be given a role", "NOT_ACTIVE_MEMBER");
    const actorRole = ctx.membership?.status === "ACTIVE" ? ctx.membership.role : null;
    if (actor.role !== "ADMIN" && actorRole !== "OWNER" && role === "ADMIN") throw forbidden("Only the owner can appoint admins", "INSUFFICIENT_RANK");
    const updated = await membershipRepo.update(target.id, { role }, trx);
    await audit({ actorId: actor.id, action: "community.member.role", entityType: "community", entityId: communityId, data: { userId, role } }, trx);
    return updated;
  });
  return memberDto(row);
}

export async function suspend(actor: Actor, communityId: string, userId: string, days: number, reason: string | null): Promise<Member> {
  const row = await moderate(actor, communityId, async (_ctx, trx, fx) => {
    const target = await targetFor(_ctx, actor, userId, trx);
    if (target.status === "BANNED" || target.status === "PENDING") throw conflict("Only members can be suspended", "NOT_ACTIVE_MEMBER");
    const updated = await membershipRepo.update(target.id, { status: "SUSPENDED", suspended_until: new Date(Date.now() + days * 86400_000) }, trx);
    if (target.status === "ACTIVE") await communityRepo.adjust(communityId, { members: -1 }, trx);
    revokeRooms(fx, userId, communityId);
    await audit({ actorId: actor.id, action: "community.member.suspend", entityType: "community", entityId: communityId, data: { userId, days, reason } }, trx);
    return updated;
  });
  return memberDto(row);
}

export async function unsuspend(actor: Actor, communityId: string, userId: string): Promise<Member> {
  const row = await moderate(actor, communityId, async (ctx, trx) => {
    const target = await targetFor(ctx, actor, userId, trx);
    if (target.status !== "SUSPENDED") throw conflict("That member is not suspended", "NOT_SUSPENDED");
    const updated = await membershipRepo.update(target.id, { status: "ACTIVE", suspended_until: null }, trx);
    await communityRepo.adjust(communityId, { members: 1 }, trx);
    await audit({ actorId: actor.id, action: "community.member.unsuspend", entityType: "community", entityId: communityId, data: { userId } }, trx);
    return updated;
  });
  return memberDto(row);
}

export async function ban(actor: Actor, communityId: string, userId: string, reason: string | null): Promise<Member> {
  const row = await moderate(actor, communityId, async (ctx, trx, fx) => {
    const target = await targetFor(ctx, actor, userId, trx);
    if (target.status === "BANNED") return target;
    const updated = await membershipRepo.update(target.id, { status: "BANNED", role: "MEMBER", suspended_until: null }, trx);
    if (target.status === "ACTIVE") await communityRepo.adjust(communityId, { members: -1 }, trx);
    revokeRooms(fx, userId, communityId);
    await audit({ actorId: actor.id, action: "community.member.ban", entityType: "community", entityId: communityId, data: { userId, reason } }, trx);
    return updated;
  });
  return memberDto(row);
}

/** Lift a community ban: BANNED becomes LEFT (not ACTIVE), so the person may rejoin under the join policy. */
export async function unban(actor: Actor, communityId: string, userId: string): Promise<Member> {
  const row = await moderate(actor, communityId, async (ctx, trx) => {
    const target = await targetFor(ctx, actor, userId, trx);
    if (target.status !== "BANNED") throw conflict("That person is not banned", "NOT_BANNED");
    const updated = await membershipRepo.update(target.id, { status: "LEFT", role: "MEMBER", suspended_until: null }, trx);
    await audit({ actorId: actor.id, action: "community.member.unban", entityType: "community", entityId: communityId, data: { userId } }, trx);
    return updated;
  });
  return memberDto(row);
}

/**
 * Remove someone (they may rejoin). Any membership that is not already LEFT (ACTIVE,
 * PENDING, SUSPENDED or BANNED) becomes LEFT, so on a banned member this also lifts the
 * ban; POST /unban is the explicit way to do that.
 */
export async function removeMember(actor: Actor, communityId: string, userId: string): Promise<void> {
  await moderate(actor, communityId, async (ctx, trx, fx) => {
    const target = await targetFor(ctx, actor, userId, trx);
    await membershipRepo.update(target.id, { status: "LEFT", role: "MEMBER", suspended_until: null }, trx);
    if (target.status === "ACTIVE") await communityRepo.adjust(communityId, { members: -1 }, trx);
    revokeRooms(fx, userId, communityId);
    await audit({ actorId: actor.id, action: "community.member.remove", entityType: "community", entityId: communityId, data: { userId, from: target.status } }, trx);
  });
}

// ─── Invites ────────────────────────────────────────────────────────────────

export async function listInvites(actor: Actor, communityId: string): Promise<Invite[]> {
  await requireModerator(actor, communityId);
  return (await communityRepo.listInvites(communityId)).map(toInvite);
}

export async function createInvite(actor: Actor, communityId: string, input: { maxUses?: number | null; expiresInDays?: number | null }): Promise<Invite> {
  await requireModerator(actor, communityId);
  const row = await communityRepo.insertInvite({
    id: newId(),
    community_id: communityId,
    code: crypto.randomBytes(9).toString("base64url"),
    created_by: actor.id,
    max_uses: input.maxUses ?? null,
    expires_at: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
  });
  return toInvite(row);
}

export async function revokeInvite(actor: Actor, communityId: string, inviteId: string): Promise<void> {
  await requireModerator(actor, communityId);
  if (!(await communityRepo.revokeInvite(communityId, inviteId))) throw notFound("Invite not found");
}

/** An invite link's landing card. The invite itself grants a look at a private community's card. */
export async function getInvite(actor: Actor, code: string) {
  const inv = await communityRepo.findInviteByCode(code);
  if (!inviteUsable(inv)) throw notFound("This invite link is invalid or has expired", "INVITE_INVALID");
  const community = await communityRepo.findById(inv.community_id);
  if (!community || community.status !== "PUBLISHED") throw notFound("This invite link is invalid or has expired", "INVITE_INVALID");
  return { community: await presentCommunity(actor, community), invite: toInvite(inv) };
}

// ─── Notification settings ──────────────────────────────────────────────────

export type { CommunityNotificationSettings };

const readSettings = readCommunityNotificationSettings;

export async function getNotificationSettings(actor: Actor, communityId: string): Promise<CommunityNotificationSettings> {
  const ctx = await requireReadable(actor, communityId);
  if (!ctx.access.isMember || !ctx.membership) throw memberError(ctx);
  return readSettings(ctx.membership.notification_settings);
}

export async function updateNotificationSettings(actor: Actor, communityId: string, patch: Partial<CommunityNotificationSettings>): Promise<CommunityNotificationSettings> {
  const ctx = await requireReadable(actor, communityId);
  if (!ctx.access.isMember || !ctx.membership) throw memberError(ctx);
  const next = { ...readSettings(ctx.membership.notification_settings), ...patch };
  await db.updateTable("community_members").set({ notification_settings: JSON.stringify(next), updated_at: sql`now()` }).where("id", "=", ctx.membership.id).execute();
  return next;
}
