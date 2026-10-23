/**
 * People: profiles, the follow graph, blocks, profile edits, sessions and suggestions.
 *
 * A block in either direction makes a profile (and everything under it) a 404, never a
 * 403, so a blocked person cannot even confirm the account exists. Blocking also
 * removes follows both ways. Profile.viewer.canMessage comes from the DM eligibility
 * rule in domain/dm-eligibility.ts, fed with the same facts the DM module uses.
 */
import type { Community, FollowEntry, Me, Media, Post, Profile, UserSummary } from "@open-social/types";
import type { Actor, RequestMeta } from "../core/context";
import { requireActive } from "../core/context";
import { withEffects, withTransaction, type Effects } from "../core/effects";
import { badRequest, notFound } from "../core/errors";
import { db } from "../db/kysely";
import { canMessage, directKey } from "../domain/dm-eligibility";
import { presentCommunities } from "../presenters/community.presenter";
import { loadMedia, urlOf } from "../presenters/media.presenter";
import { loadSummaries, toMe, toSummary } from "../presenters/user.presenter";
import { rooms } from "../realtime/port";
import { blockRepo } from "../repositories/block.repository";
import { communityRepo } from "../repositories/community.repository";
import { followRepo } from "../repositories/follow.repository";
import { dmRepo } from "../repositories/dm.repository";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo, type UserRow } from "../repositories/user.repository";
import { isBlockedEitherWay, shareActiveCommunity } from "../repositories/visibility";
import { audit } from "./audit.service";
import * as feed from "./feed.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";

const VISIBLE_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

/** A profile the viewer may see, by username or id. 404 on unknown, gone or blocked. */
async function visibleUser(viewer: Actor | null, by: { username?: string; id?: string }): Promise<UserRow> {
  const user = by.username ? await userRepo.findByUsername(by.username) : await userRepo.findById(by.id as string);
  if (!user || !VISIBLE_STATUSES.has(user.status)) throw notFound("User not found");
  if (viewer && viewer.id !== user.id && (await isBlockedEitherWay(viewer.id, user.id))) throw notFound("User not found");
  return user;
}

export async function profile(viewer: Actor | null, username: string): Promise<Profile> {
  const user = await visibleUser(viewer, { username });
  const media = await loadMedia([user.avatar_upload_id, user.cover_upload_id]);
  const isSelf = viewer?.id === user.id;
  const rel = viewer && !isSelf ? await followRepo.relation(viewer.id, user.id) : { following: false, followedBy: false };
  let messaging: { canMessage: boolean; messageBlockedReason: Profile["viewer"]["messageBlockedReason"] } = { canMessage: false, messageBlockedReason: null };
  if (viewer && !isSelf) {
    const decision = canMessage({
      sender: { id: viewer.id, status: viewer.status, role: viewer.role },
      recipient: { id: user.id, status: user.status, dmPrivacy: user.dm_privacy },
      blocked: false,
      sharedCommunity: await shareActiveCommunity(viewer.id, user.id),
      recipientFollowsSender: rel.followedBy,
    });
    messaging = decision.allowed ? { canMessage: true, messageBlockedReason: null } : { canMessage: false, messageBlockedReason: decision.reason };
  }
  return {
    ...toSummary(user, urlOf(media, user.avatar_upload_id, "thumb")),
    bio: user.bio,
    location: user.location,
    website: user.website,
    coverUrl: urlOf(media, user.cover_upload_id),
    reputation: user.reputation,
    level: user.level,
    postCount: user.post_count,
    followerCount: user.follower_count,
    followingCount: user.following_count,
    joinedAt: user.created_at.toISOString(),
    viewer: { isSelf, following: rel.following, followedBy: rel.followedBy, blocked: false, ...messaging },
  };
}

export async function posts(viewer: Actor | null, username: string, q: feed.PageQuery): Promise<Paged<Post>> {
  const user = await visibleUser(viewer, { username });
  return feed.authorPosts(viewer, user.id, q);
}

export async function media(viewer: Actor | null, username: string, q: feed.PageQuery): Promise<Paged<Media>> {
  const user = await visibleUser(viewer, { username });
  return feed.media(viewer, { authorId: user.id }, q);
}

export async function communities(viewer: Actor | null, username: string): Promise<Community[]> {
  const user = await visibleUser(viewer, { username });
  return presentCommunities(viewer, await communityRepo.memberOf(user.id, viewer));
}

/** Followers or followees, each with `viewerFollows` (false when signed out, and for the viewer's own row). */
export async function follows(viewer: Actor | null, username: string, direction: "followers" | "following", q: feed.PageQuery): Promise<Paged<FollowEntry>> {
  const user = await visibleUser(viewer, { username });
  const rows = await followRepo.list(user.id, direction, viewer?.id ?? null, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const ids = page.items.map((r) => r.id);
  const [users, followed] = await Promise.all([loadSummaries(ids), viewer ? followRepo.followedAmong(viewer.id, ids) : Promise.resolve(new Set<string>())]);
  const items: FollowEntry[] = [];
  for (const id of ids) {
    const u = users.get(id);
    if (u) items.push({ ...u, viewerFollows: id !== viewer?.id && followed.has(id) });
  }
  return { items, nextCursor: page.nextCursor };
}

export async function follow(actor: Actor, userId: string): Promise<void> {
  requireActive(actor);
  if (userId === actor.id) throw badRequest("You cannot follow yourself", "SELF_ACTION");
  const target = await visibleUser(actor, { id: userId });
  if (target.status !== "ACTIVE") throw notFound("User not found");
  await withTransaction(async (trx, fx: Effects) => {
    if (await followRepo.follow(actor.id, target.id, trx)) {
      await notify({ recipientId: target.id, actorId: actor.id, type: "FOLLOW", entityType: "user", entityId: actor.id, data: { username: actor.username } }, fx, trx);
    }
  });
}

export async function unfollow(actor: Actor, userId: string): Promise<void> {
  await withTransaction((trx) => followRepo.unfollow(actor.id, userId, trx));
}

/** Block someone. Their 1:1 conversation's live room is closed for both sides at once. */
export async function block(actor: Actor, userId: string, meta: RequestMeta): Promise<void> {
  if (userId === actor.id) throw badRequest("You cannot block yourself", "SELF_ACTION");
  const target = await userRepo.findById(userId);
  if (!target) throw notFound("User not found");
  await withTransaction(async (trx, fx) => {
    await blockRepo.block(actor.id, target.id, trx);
    await audit({ actorId: actor.id, action: "user.block", entityType: "user", entityId: target.id, ip: meta.ip }, trx);
    const direct = await dmRepo.findDirect(directKey(actor.id, target.id), trx);
    if (direct) fx.leave([actor.id, target.id], [rooms.thread(direct.id)]);
  });
}

export async function unblock(actor: Actor, userId: string): Promise<void> {
  await blockRepo.unblock(actor.id, userId);
}

export async function blocks(actor: Actor): Promise<UserSummary[]> {
  const ids = await blockRepo.blockedBy(actor.id);
  const users = await loadSummaries(ids);
  return ids.map((id) => users.get(id)).filter((u): u is UserSummary => !!u);
}

export async function suggestions(actor: Actor): Promise<UserSummary[]> {
  const ids = await followRepo.suggestions(actor.id, 10);
  const users = await loadSummaries(ids);
  return ids.map((id) => users.get(id)).filter((u): u is UserSummary => !!u);
}

export interface ProfilePatch {
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatarUploadId?: string | null;
  coverUploadId?: string | null;
  dmPrivacy?: "COMMUNITIES" | "FOLLOWING" | "NOBODY";
  emailDigest?: boolean;
}

/** Profile fields other people see: a change to any of them is scanned (target USER). */
const PUBLIC_PROFILE_FIELDS = ["displayName", "headline", "bio", "location", "website", "avatarUploadId"] as const;

export async function updateMe(actor: Actor, patch: ProfilePatch): Promise<Me> {
  requireActive(actor);
  const avatar = patch.avatarUploadId === undefined ? undefined : await claimSingle(actor.id, patch.avatarUploadId, "AVATAR");
  const cover = patch.coverUploadId === undefined ? undefined : await claimSingle(actor.id, patch.coverUploadId, "COVER");
  const row = await withEffects(async (fx) => {
    const updated = await userRepo.update(actor.id, {
    ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
    ...(patch.headline !== undefined ? { headline: patch.headline } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.website !== undefined ? { website: patch.website } : {}),
    ...(patch.dmPrivacy !== undefined ? { dm_privacy: patch.dmPrivacy } : {}),
    ...(avatar !== undefined ? { avatar_upload_id: avatar } : {}),
    ...(cover !== undefined ? { cover_upload_id: cover } : {}),
    ...(patch.emailDigest !== undefined ? { email_digest: patch.emailDigest } : {}),
    });
    // Profiles are user content too: a REVIEW case for a moderator, never an automatic hide.
    if (updated && PUBLIC_PROFILE_FIELDS.some((f) => patch[f] !== undefined)) fx.job("moderation.scan", { targetType: "USER", targetId: actor.id });
    return updated;
  });
  if (!row) throw notFound("User not found");
  return toMe(row);
}

/**
 * Active sessions. The access token does not name its session, so `current` marks the
 * most recently used session from this browser (same user agent).
 */
export async function sessions(actor: Actor, meta: RequestMeta) {
  const rows = await sessionRepo.listActive(actor.id);
  const currentId = rows.find((r) => r.user_agent === (meta.userAgent?.slice(0, 300) ?? null))?.id ?? null;
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at.toISOString(),
    current: r.id === currentId,
  }));
}

export async function revokeSession(actor: Actor, sessionId: string, meta: RequestMeta): Promise<void> {
  const row = await db.selectFrom("sessions").select(["id", "family_id"]).where("id", "=", sessionId).where("user_id", "=", actor.id).where("revoked_at", "is", null).executeTakeFirst();
  if (!row) throw notFound("Session not found");
  await sessionRepo.revokeFamily(row.family_id);
  await audit({ actorId: actor.id, action: "session.revoke", entityType: "session", entityId: row.id, ip: meta.ip });
}
