/**
 * Direct messages: 1:1 threads, groups of up to 50, message requests, reactions, pins,
 * read cursors, search and the media drawer.
 *
 * Who may talk to whom is decided by domain/dm-eligibility.ts (starting a conversation)
 * and domain/dm-send.ts (sending into one), always from facts loaded fresh inside the
 * request. The source system had no shared-community rule, no blocks and no requests,
 * trusted client-supplied file URLs, and polled; here attachments are upload ids only and
 * delivery is a socket emit after commit.
 *
 * Message requests: a first contact from someone the recipient does not follow puts the
 * recipient in state REQUESTED. They see it under folder=requests, get one DM_REQUEST
 * notification and a "dm:request" socket event, and "dm:message" still reaches them so an
 * open requests view updates (the web app renders it quietly). Replying accepts.
 *
 * Group history: someone added to a group sees only messages from their joined_at on,
 * in every read (history, last message, unread, search, media, pins, reply previews)
 * and in later live events about older messages.
 */
import type { DmDenialReason, Media, Message, Thread, UserSummary } from "@open-social/types";
import { sql } from "kysely";
import { type Actor, requireActive } from "../core/context";
import { decodeCursor, toPage, type Page } from "../core/cursor";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { canMessage, directKey, type DmDecision } from "../domain/dm-eligibility";
import { directSendDecision, groupSendDecision, type ParticipantState, type SendDecision } from "../domain/dm-send";
import { inboxTotals } from "../domain/unread";
import { consume } from "../middleware/rate-limit";
import { loadMedia } from "../presenters/media.presenter";
import { loadMessage, presentMessages } from "../presenters/message.presenter";
import { followersAmong, presentThread, presentThreads, sharedCommunityWith } from "../presenters/thread.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { dmRepo, type Folder } from "../repositories/dm.repository";
import { blockedSet, isBlockedEitherWay, shareActiveCommunity } from "../repositories/visibility";
import { claimUploads } from "./media-attach.service";
import { notify } from "./notification.service";
import { onlineMap } from "../realtime/presence";
import { realtime, rooms } from "../realtime/port";

export const MAX_GROUP_SIZE = 50;
const MAX_MEDIA_PER_MESSAGE = 10;

function denied(reason: DmDenialReason): HttpError {
  return new HttpError(403, "You cannot message this person", "DM_NOT_ALLOWED", { reason });
}

function refuse(d: Exclude<SendDecision, { allowed: true }>): HttpError {
  if (d.code === "DM_REQUEST_PENDING") return forbidden("Wait for them to accept your message request", "DM_REQUEST_PENDING");
  return denied(d.reason);
}

// ─── Eligibility ────────────────────────────────────────────────────────────

/** Fresh facts for canMessage(): read inside the caller's transaction when there is one. */
export async function eligibility(sender: Actor, recipientId: string, exec: Executor = db): Promise<DmDecision> {
  const recipient = await exec.selectFrom("users").select(["id", "status", "dm_privacy"]).where("id", "=", recipientId).executeTakeFirst();
  if (!recipient) return { allowed: false, reason: "RECIPIENT_UNAVAILABLE" };
  const [blocked, sharedCommunity, follows] = await Promise.all([
    isBlockedEitherWay(sender.id, recipientId, exec),
    shareActiveCommunity(sender.id, recipientId, exec),
    exec.selectFrom("follows").select("follower_id").where("follower_id", "=", recipientId).where("followee_id", "=", sender.id).executeTakeFirst(),
  ]);
  return canMessage({
    sender: { id: sender.id, status: sender.status, role: sender.role },
    recipient: { id: recipient.id, status: recipient.status, dmPrivacy: recipient.dm_privacy },
    blocked,
    sharedCommunity,
    recipientFollowsSender: !!follows,
  });
}

export async function getEligibility(actor: Actor, userId: string): Promise<{ allowed: boolean; reason: DmDenialReason | null; asRequest: boolean }> {
  const d = await eligibility(actor, userId);
  return d.allowed ? { allowed: true, reason: null, asRequest: d.asRequest } : { allowed: false, reason: d.reason, asRequest: false };
}

// ─── Threads ────────────────────────────────────────────────────────────────

/** A thread the actor participates in (any state), else 404 so ids cannot be probed. */
async function participantThread(actor: Actor, threadId: string, exec: Executor = db, states: ParticipantState[] = ["ACTIVE", "REQUESTED"]) {
  const thread = await dmRepo.findThread(threadId, exec);
  const me = thread ? await dmRepo.participant(threadId, actor.id, exec) : undefined;
  if (!thread || !me || !states.includes(me.state)) throw notFound("Conversation not found", "THREAD_NOT_FOUND");
  return { thread, me };
}

/** Open (find or create) the 1:1 thread with `userId`. */
export async function openDirect(actor: Actor, userId: string): Promise<Thread> {
  requireActive(actor);
  if (userId === actor.id) throw denied("SELF");
  const existing = await dmRepo.findDirect(directKey(actor.id, userId));
  if (existing) {
    const me = await dmRepo.participant(existing.id, actor.id);
    if (me && (await isBlockedEitherWay(actor.id, userId))) throw denied("BLOCKED");
    if (me) return presentThread(actor, existing);
  }

  const decision = await eligibility(actor, userId);
  if (!decision.allowed) throw denied(decision.reason);
  await consume("dm-thread", `u:${actor.id}`, 20, 3600);

  const thread = await withTransaction(async (trx) => {
    const now = new Date();
    const inserted = await dmRepo.insertThread({ id: newId(), kind: "DIRECT", direct_key: directKey(actor.id, userId), created_by: actor.id }, trx);
    if (!inserted) return (await dmRepo.findDirect(directKey(actor.id, userId), trx))!;
    await dmRepo.upsertParticipants(
      [
        { thread_id: inserted.id, user_id: actor.id, state: "ACTIVE", joined_at: now },
        { thread_id: inserted.id, user_id: userId, state: decision.asRequest ? "REQUESTED" : "ACTIVE", joined_at: now },
      ],
      trx,
    );
    return inserted;
  });
  return presentThread(actor, thread);
}

/** Group threads: every invitee must be messageable by the creator, and no two members may have a block between them. */
async function assertGroupMembersAllowed(actor: Actor, memberIds: string[], newIds: string[], exec: Executor): Promise<void> {
  for (const id of newIds) {
    const d = await eligibility(actor, id, exec);
    if (!d.allowed) throw denied(d.reason);
  }
  const blockPair = await exec
    .selectFrom("blocks")
    .select("blocker_id")
    .where("blocker_id", "in", memberIds)
    .where("blocked_id", "in", memberIds)
    .executeTakeFirst();
  // Which pair is never said: that would reveal someone else's block list.
  if (blockPair) throw denied("BLOCKED");
}

export async function createGroup(actor: Actor, input: { userIds: string[]; title?: string | null }): Promise<Thread> {
  requireActive(actor);
  const invitees = [...new Set(input.userIds)].filter((id) => id !== actor.id);
  if (invitees.length < 2) throw badRequest("A group needs at least two other people", "GROUP_TOO_SMALL");
  if (invitees.length + 1 > MAX_GROUP_SIZE) throw badRequest(`Groups can have at most ${MAX_GROUP_SIZE} people`, "GROUP_TOO_LARGE");
  await consume("dm-thread", `u:${actor.id}`, 20, 3600);

  const { thread, requested, active } = await withTransaction(async (trx, fx) => {
    await assertGroupMembersAllowed(actor, [actor.id, ...invitees], invitees, trx);
    const followers = await followersAmong(actor.id, invitees, trx);
    const thread = (await dmRepo.insertThread({ id: newId(), kind: "GROUP", title: input.title ?? null, created_by: actor.id }, trx))!;
    // joined_at comes from the database clock (column default), the same clock that
    // stamps messages, so "history since you joined" never drifts with the app's clock.
    await dmRepo.upsertParticipants(
      [
        { thread_id: thread.id, user_id: actor.id, state: "ACTIVE", is_admin: true },
        ...invitees.map((id) => ({ thread_id: thread.id, user_id: id, state: (followers.has(id) ? "ACTIVE" : "REQUESTED") as ParticipantState })),
      ],
      trx,
    );
    const requested = invitees.filter((id) => !followers.has(id));
    for (const id of requested) await notify({ recipientId: id, actorId: actor.id, type: "DM_REQUEST", entityType: "dm_thread", entityId: thread.id, snippet: input.title ?? null, data: { threadId: thread.id } }, fx, trx);
    return { thread, requested, active: invitees.filter((id) => followers.has(id)) };
  });
  await pushThread(thread.id, requested, "dm:request");
  await pushThread(thread.id, active, "dm:thread:updated");
  return presentThread(actor, thread);
}

/** Send each user their own view of a thread (viewer-specific fields differ). */
async function pushThread(threadId: string, userIds: string[], event: "dm:request" | "dm:thread:updated"): Promise<void> {
  if (!userIds.length) return;
  const thread = await dmRepo.findThread(threadId);
  if (!thread) return;
  const users = await db.selectFrom("users").select(["id", "username", "display_name", "role", "status"]).where("id", "in", userIds).execute();
  for (const u of users) {
    const view = await presentThread({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status }, thread);
    realtime.emit([rooms.user(u.id)], event, { thread: view });
  }
}

export async function addParticipants(actor: Actor, threadId: string, userIds: string[]): Promise<Thread> {
  requireActive(actor);
  const { thread } = await participantThread(actor, threadId, db, ["ACTIVE"]);
  if (thread.kind !== "GROUP") throw badRequest("Only group conversations can add people", "NOT_A_GROUP");
  const { added, everyone } = await withTransaction(async (trx, fx) => {
    await dmRepo.lockThread(thread.id, trx);
    const current = (await dmRepo.participants([thread.id], trx)).filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED");
    const currentIds = new Set(current.map((p) => p.user_id));
    const added = [...new Set(userIds)].filter((id) => !currentIds.has(id) && id !== actor.id);
    if (!added.length) return { added, everyone: [...currentIds] };
    if (currentIds.size + added.length > MAX_GROUP_SIZE) throw badRequest(`Groups can have at most ${MAX_GROUP_SIZE} people`, "GROUP_TOO_LARGE");
    await assertGroupMembersAllowed(actor, [...currentIds, ...added], added, trx);
    const followers = await followersAmong(actor.id, added, trx);
    await dmRepo.upsertParticipants(
      added.map((id) => ({ thread_id: thread.id, user_id: id, state: (followers.has(id) ? "ACTIVE" : "REQUESTED") as ParticipantState })),
      trx,
    );
    for (const id of added.filter((x) => !followers.has(x))) {
      await notify({ recipientId: id, actorId: actor.id, type: "DM_REQUEST", entityType: "dm_thread", entityId: thread.id, snippet: thread.title, data: { threadId: thread.id } }, fx, trx);
    }
    return { added, everyone: [...currentIds, ...added] };
  });
  if (added.length) await pushThread(thread.id, everyone.filter((id) => id !== actor.id), "dm:thread:updated");
  return presentThread(actor, (await dmRepo.findThread(thread.id))!);
}

export async function leaveGroup(actor: Actor, threadId: string): Promise<void> {
  const { thread } = await participantThread(actor, threadId);
  if (thread.kind !== "GROUP") throw badRequest("You can only leave group conversations", "NOT_A_GROUP");
  await dmRepo.updateParticipant(thread.id, actor.id, { state: "LEFT", muted_until: null });
  realtime.leaveRooms([actor.id], [rooms.thread(thread.id)]);
  const others = (await dmRepo.participants([thread.id])).filter((p) => p.user_id !== actor.id && (p.state === "ACTIVE" || p.state === "REQUESTED")).map((p) => p.user_id);
  await pushThread(thread.id, others, "dm:thread:updated");
}

export async function acceptRequest(actor: Actor, threadId: string): Promise<Thread> {
  const { thread, me } = await participantThread(actor, threadId);
  if (me.state !== "REQUESTED") throw badRequest("There is no pending request in this conversation", "NOT_REQUESTED");
  await dmRepo.updateParticipant(thread.id, actor.id, { state: "ACTIVE" });
  const others = (await dmRepo.participants([thread.id])).filter((p) => p.user_id !== actor.id && p.state === "ACTIVE").map((p) => p.user_id);
  await pushThread(thread.id, others, "dm:thread:updated");
  return presentThread(actor, thread);
}

/** Decline: the requester is not told; their next send gets the generic RECIPIENT_DISABLED_DMS. */
export async function declineRequest(actor: Actor, threadId: string): Promise<void> {
  const { thread, me } = await participantThread(actor, threadId);
  if (me.state !== "REQUESTED") throw badRequest("There is no pending request in this conversation", "NOT_REQUESTED");
  await dmRepo.updateParticipant(thread.id, actor.id, { state: "DECLINED" });
}

export async function getThread(actor: Actor, threadId: string): Promise<Thread> {
  const { thread } = await participantThread(actor, threadId);
  return presentThread(actor, thread);
}

export async function updateThread(actor: Actor, threadId: string, patch: { title?: string | null; mutedUntil?: string | null }): Promise<Thread> {
  const { thread } = await participantThread(actor, threadId);
  if (patch.title !== undefined) {
    if (thread.kind !== "GROUP") throw badRequest("Only group conversations have a title", "NOT_A_GROUP");
    requireActive(actor);
    await dmRepo.updateThread(thread.id, { title: patch.title });
  }
  if (patch.mutedUntil !== undefined) {
    await dmRepo.updateParticipant(thread.id, actor.id, { muted_until: patch.mutedUntil ? new Date(patch.mutedUntil) : null });
  }
  const fresh = (await dmRepo.findThread(thread.id))!;
  if (patch.title !== undefined) {
    const others = (await dmRepo.participants([thread.id])).filter((p) => p.user_id !== actor.id && (p.state === "ACTIVE" || p.state === "REQUESTED")).map((p) => p.user_id);
    await pushThread(thread.id, others, "dm:thread:updated");
  }
  return presentThread(actor, fresh);
}

export async function listThreads(actor: Actor, folder: Folder, rawCursor: unknown, limit: number): Promise<Page<Thread>> {
  const rows = await dmRepo.listThreads(actor.id, folder, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.sort_at, id: r.id }));
  return { items: await presentThreads(actor, page.items), nextCursor: page.nextCursor };
}

export async function unreadSummary(actor: Actor): Promise<{ inbox: number; requests: number }> {
  const rows = await dmRepo.unreadCounts(actor.id, null);
  return inboxTotals(rows.map((r) => ({ state: r.state, unread: Number(r.unread), mutedUntil: r.muted_until })));
}

// ─── Messages ───────────────────────────────────────────────────────────────

/** Re-evaluate, inside the send transaction, whether the actor may post into this thread. */
async function sendDecision(actor: Actor, threadId: string, kind: "DIRECT" | "GROUP", exec: Executor): Promise<SendDecision> {
  const members = await dmRepo.participants([threadId], exec);
  const others = members.filter((p) => p.user_id !== actor.id);
  if (kind === "GROUP") {
    const live = others.filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED").map((p) => p.user_id);
    const blocked = live.length ? await blockedSet(actor.id, exec) : new Set<string>();
    return groupSendDecision({ senderActive: actor.status === "ACTIVE", blockedWithAnyMember: live.some((id) => blocked.has(id)) });
  }
  const other = others[0];
  if (!other) return { allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_UNAVAILABLE" };
  const sentWhilePending = other.state === "REQUESTED" ? await dmRepo.countBySender(threadId, actor.id, exec) : 0;
  return directSendDecision({ eligibility: await eligibility(actor, other.user_id, exec), counterpartState: other.state, sentWhilePending });
}

function cleanBody(body: string | undefined | null): string {
  return (body ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * Rooms that get a thread's message events: everyone still in it (including the sender's
 * other tabs). For an event about an existing message (`messageAt`), group members who
 * joined after it was written are left out: that message is not part of their history.
 */
async function deliveryRooms(threadId: string, exec: Executor = db, messageAt?: Date): Promise<string[]> {
  const [members, thread] = await Promise.all([dmRepo.participants([threadId], exec), messageAt ? dmRepo.findThread(threadId, exec) : undefined]);
  return members
    .filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED")
    .filter((p) => !messageAt || thread?.kind !== "GROUP" || messageAt >= p.joined_at)
    .map((p) => rooms.user(p.user_id));
}

export async function sendMessage(actor: Actor, threadId: string, input: { body?: string; replyToId?: string | null; mediaIds?: string[] }): Promise<Message> {
  requireActive(actor);
  const body = cleanBody(input.body);
  const mediaIds = [...new Set(input.mediaIds ?? [])];
  if (!body && !mediaIds.length) throw badRequest("Write something or attach a file", "MESSAGE_EMPTY");
  if (body.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  if (mediaIds.length > MAX_MEDIA_PER_MESSAGE) throw badRequest(`At most ${MAX_MEDIA_PER_MESSAGE} attachments per message`, "TOO_MANY_ATTACHMENTS");

  const { message, firstRequest, recipients } = await withTransaction(async (trx, fx) => {
    const { thread, me } = await participantThread(actor, threadId, trx);
    await dmRepo.lockThread(thread.id, trx);
    const decision = await sendDecision(actor, thread.id, thread.kind, trx);
    if (!decision.allowed) throw refuse(decision);

    if (input.replyToId) {
      const parent = await dmRepo.findMessage(input.replyToId, trx);
      if (!parent || parent.thread_id !== thread.id || (thread.kind === "GROUP" && parent.created_at < me.joined_at)) throw badRequest("You can only reply to a message in this conversation", "REPLY_INVALID");
    }
    const uploads = await claimUploads(actor.id, mediaIds, "DM", trx);
    const row = await dmRepo.insertMessage({ id: newId(), thread_id: thread.id, sender_id: actor.id, body, reply_to_id: input.replyToId ?? null }, trx);
    await dmRepo.insertMessageMedia(row.id, uploads.map((u) => u.id), trx);
    await dmRepo.updateThread(thread.id, { last_message_at: row.created_at }, trx);
    // Replying to a request accepts it; your own message is read by definition.
    await dmRepo.updateParticipant(thread.id, actor.id, { last_read_at: row.created_at, ...(me.state === "REQUESTED" ? { state: "ACTIVE" as const } : {}) }, trx);

    const members = await dmRepo.participants([thread.id], trx);
    const requestedIds = members.filter((p) => p.user_id !== actor.id && p.state === "REQUESTED").map((p) => p.user_id);
    let firstRequest: string[] = [];
    if (thread.kind === "DIRECT" && requestedIds.length && (await dmRepo.countBySender(thread.id, actor.id, trx)) === 1) {
      firstRequest = requestedIds;
      for (const id of requestedIds) {
        await notify({ recipientId: id, actorId: actor.id, type: "DM_REQUEST", entityType: "dm_thread", entityId: thread.id, snippet: body || null, data: { threadId: thread.id } }, fx, trx);
      }
    }
    fx.job("moderation.scan", { targetType: "DM_MESSAGE", targetId: row.id });
    const recipients = members.filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED" || p.user_id === actor.id).map((p) => p.user_id);
    return { message: row, firstRequest, recipients };
  });

  // Each recipient sees reactions/visibility from their own side; for a new message the
  // DTO is the same for everyone except `reactedByViewer`, which is empty anyway.
  const dto = (await loadMessage("dm", message.id, actor.id))!;
  realtime.emit(recipients.map(rooms.user), "dm:message", { threadId, message: dto });
  if (firstRequest.length) await pushThread(threadId, firstRequest, "dm:request");
  return dto;
}

export async function listMessages(actor: Actor, threadId: string, rawCursor: unknown, limit: number): Promise<Page<Message>> {
  await participantThread(actor, threadId);
  const rows = await dmRepo.listMessages(threadId, actor.id, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await presentMessages("dm", page.items, actor.id), nextCursor: page.nextCursor };
}

export async function markRead(actor: Actor, threadId: string): Promise<void> {
  const { thread } = await participantThread(actor, threadId);
  const at = new Date();
  await dmRepo.updateParticipant(thread.id, actor.id, { last_read_at: at });
  const others = (await deliveryRooms(thread.id)).filter((r) => r !== rooms.user(actor.id));
  realtime.emit(others, "dm:read", { threadId: thread.id, userId: actor.id, lastReadAt: at.toISOString() });
  realtime.emit([rooms.user(actor.id)], "dm:read", { threadId: thread.id, userId: actor.id, lastReadAt: at.toISOString() });
}

/** Load a message whose thread the actor is in. */
async function participantMessage(actor: Actor, messageId: string, exec: Executor = db) {
  const msg = await dmRepo.findMessage(messageId, exec);
  if (!msg) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  const { thread, me } = await participantThread(actor, msg.thread_id, exec);
  // Group history before you joined is not yours to react to, pin or reply to.
  if (thread.kind === "GROUP" && msg.created_at < me.joined_at) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  if (msg.sender_id !== actor.id && (await isBlockedEitherWay(actor.id, msg.sender_id, exec))) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  return { msg, thread };
}

async function emitUpdated(fx: Effects, threadId: string, messageId: string, viewerId: string, exec: Executor): Promise<Message> {
  const dto = (await loadMessage("dm", messageId, viewerId, exec))!;
  fx.emit(await deliveryRooms(threadId, exec, new Date(dto.createdAt)), "dm:message:updated", { threadId, message: dto });
  return dto;
}

export async function editMessage(actor: Actor, messageId: string, body: string): Promise<Message> {
  requireActive(actor);
  const text = cleanBody(body);
  if (text.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  return withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.sender_id !== actor.id) throw forbidden("You can only edit your own messages");
    if (msg.status === "DELETED") throw badRequest("This message was deleted", "MESSAGE_DELETED");
    if (!text && !(await dmRepo.hasMedia(msg.id, trx))) throw badRequest("Write something or delete the message", "MESSAGE_EMPTY");
    if (text === msg.body) return (await loadMessage("dm", msg.id, actor.id, trx))!;
    await dmRepo.updateMessage(msg.id, { body: text, edited_at: new Date(), moderation_state: "UNCHECKED" }, trx);
    fx.job("moderation.scan", { targetType: "DM_MESSAGE", targetId: msg.id });
    return emitUpdated(fx, msg.thread_id, msg.id, actor.id, trx);
  });
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  await withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.sender_id !== actor.id) throw forbidden("You can only delete your own messages");
    if (msg.status === "DELETED") return;
    await dmRepo.updateMessage(msg.id, { status: "DELETED", pinned_at: null }, trx);
    fx.emit(await deliveryRooms(msg.thread_id, trx, msg.created_at), "dm:message:deleted", { threadId: msg.thread_id, messageId: msg.id });
  });
}

export async function setPinned(actor: Actor, messageId: string, pinned: boolean): Promise<Message> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.status !== "PUBLISHED") throw badRequest("Only visible messages can be pinned", "MESSAGE_NOT_PINNABLE");
    if (!!msg.pinned_at !== pinned) await dmRepo.updateMessage(msg.id, { pinned_at: pinned ? new Date() : null }, trx);
    return emitUpdated(fx, msg.thread_id, msg.id, actor.id, trx);
  });
}

export async function react(actor: Actor, messageId: string, emoji: string, on: boolean): Promise<Message> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.status !== "PUBLISHED") throw badRequest("You cannot react to this message", "MESSAGE_NOT_REACTABLE");
    if (on) await dmRepo.addReaction(msg.id, actor.id, emoji, trx);
    else await dmRepo.removeReaction(msg.id, actor.id, emoji, trx);
    return emitUpdated(fx, msg.thread_id, msg.id, actor.id, trx);
  });
}

/** Pinned messages, newest pin first. Participants only (404 otherwise, like every thread read). */
export async function pinnedMessages(actor: Actor, threadId: string): Promise<Message[]> {
  await participantThread(actor, threadId);
  return presentMessages("dm", await dmRepo.pinned(threadId, actor.id), actor.id);
}

export async function searchMessages(actor: Actor, threadId: string, q: string): Promise<Message[]> {
  await participantThread(actor, threadId);
  return presentMessages("dm", await dmRepo.search(threadId, actor.id, q), actor.id);
}

export async function threadMedia(actor: Actor, threadId: string, rawCursor: unknown, limit: number): Promise<Page<Media>> {
  await participantThread(actor, threadId);
  const rows = await dmRepo.media(threadId, actor.id, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.upload_id }));
  const media = await loadMedia(page.items.map((r) => r.upload_id));
  return { items: page.items.map((r) => media.get(r.upload_id)).filter((m): m is Media => !!m), nextCursor: page.nextCursor };
}

// ─── Contacts ───────────────────────────────────────────────────────────────

const CONTACT_CANDIDATES = 500;
const CONTACT_LIMIT = 50;

/**
 * People the viewer could message right now: they share an ACTIVE community or the
 * viewer follows them, no block either way, and canMessage() agrees. Online first.
 */
export async function contacts(actor: Actor): Promise<{ user: UserSummary; online: boolean; lastSeenAt: string | null }[]> {
  const candidates = await sql<{ id: string; status: Actor["status"]; dm_privacy: "COMMUNITIES" | "FOLLOWING" | "NOBODY"; last_seen_at: Date | null; followed: boolean }>`
    WITH pool AS (
      SELECT f.followee_id AS id, true AS followed FROM follows f WHERE f.follower_id = ${actor.id}
      UNION ALL
      SELECT mb.user_id, false FROM community_members ma
        JOIN community_members mb ON mb.community_id = ma.community_id AND mb.status = 'ACTIVE'
        JOIN communities c ON c.id = ma.community_id AND c.status = 'PUBLISHED'
       WHERE ma.user_id = ${actor.id} AND ma.status = 'ACTIVE'
    ), ranked AS (
      SELECT id, bool_or(followed) AS followed FROM pool WHERE id <> ${actor.id} GROUP BY id
    )
    SELECT u.id, u.status, u.dm_privacy, u.last_seen_at, r.followed
      FROM ranked r JOIN users u ON u.id = r.id
     WHERE u.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${actor.id} AND b.blocked_id = u.id) OR (b.blocked_id = ${actor.id} AND b.blocker_id = u.id))
     ORDER BY r.followed DESC, u.last_seen_at DESC NULLS LAST, u.id
     LIMIT ${CONTACT_CANDIDATES}`.execute(db);
  const ids = candidates.rows.map((r) => r.id);
  const [shared, followers, online] = await Promise.all([sharedCommunityWith(actor.id, ids), followersAmong(actor.id, ids), onlineMap(ids)]);

  const allowed = candidates.rows.filter(
    (r) =>
      canMessage({
        sender: { id: actor.id, status: actor.status, role: actor.role },
        recipient: { id: r.id, status: r.status, dmPrivacy: r.dm_privacy },
        blocked: false,
        sharedCommunity: shared.has(r.id),
        recipientFollowsSender: followers.has(r.id),
      }).allowed,
  );
  allowed.sort((a, b) => Number(!!online.get(b.id)) - Number(!!online.get(a.id)));
  const top = allowed.slice(0, CONTACT_LIMIT);
  const summaries = await loadSummaries(top.map((r) => r.id));
  return top
    .filter((r) => summaries.has(r.id))
    .map((r) => ({ user: summaries.get(r.id)!, online: !!online.get(r.id), lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null }));
}
