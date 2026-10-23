/**
 * Community chat: one live room per published community, for its ACTIVE members.
 *
 * Moderators (community OWNER, ADMIN or MODERATOR with an ACTIVE membership, or platform
 * staff) can delete anyone's message and pin. A moderator removal is recorded as a
 * moderation action, unlike a sender deleting their own message.
 *
 * Blocks in a shared room: the room is shared, so a blocked user's messages still exist.
 * History (GET) leaves them out for the viewer; live "chat:message" events go to the
 * whole room and the web app drops ones from people in the viewer's block list (it
 * already has that list from /users/me/blocks). Nothing new is exposed either way.
 */
import type { Message } from "@open-social/types";
import { type Actor, isStaff, requireActive } from "../core/context";
import { decodeCursor, toPage, type Page } from "../core/cursor";
import { withTransaction } from "../core/effects";
import { badRequest, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { loadMessage, presentMessages } from "../presenters/message.presenter";
import { rooms } from "../realtime/port";
import { chatRepo } from "../repositories/chat.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { claimUploads } from "./media-attach.service";
import { recordModeratorRemoval } from "./moderation/removal";

const MAX_MEDIA_PER_MESSAGE = 10;
const MOD_ROLES = new Set(["OWNER", "ADMIN", "MODERATOR"]);

interface Access {
  communityId: string;
  isMember: boolean;
  isMod: boolean;
}

/** Resolve the actor's standing in a community's chat. Unknown or unpublished communities are 404. */
async function access(actor: Actor, communityId: string, exec: Executor = db): Promise<Access> {
  const row = await chatRepo.membership(communityId, actor.id, exec);
  if (!row || row.community_status !== "PUBLISHED") throw notFound("Community not found", "COMMUNITY_NOT_FOUND");
  const isMember = row.member_status === "ACTIVE";
  return { communityId, isMember, isMod: isStaff(actor) || (isMember && !!row.role && MOD_ROLES.has(row.role)) };
}

async function requireMember(actor: Actor, communityId: string, exec: Executor = db): Promise<Access> {
  const a = await access(actor, communityId, exec);
  if (!a.isMember) throw forbidden("Join the community to use its chat", "NOT_A_MEMBER");
  return a;
}

/** Same check, exported for the socket gateway's chat:subscribe. */
export async function canUseChat(actor: Actor, communityId: string): Promise<boolean> {
  try {
    return (await access(actor, communityId)).isMember;
  } catch {
    return false;
  }
}

function cleanBody(body: string | undefined | null): string {
  return (body ?? "").replace(/\r\n/g, "\n").trim();
}

export async function listMessages(actor: Actor, communityId: string, rawCursor: unknown, limit: number): Promise<Page<Message>> {
  await requireMember(actor, communityId);
  const rows = await chatRepo.listMessages(communityId, actor.id, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await presentMessages("chat", page.items, actor.id), nextCursor: page.nextCursor };
}

export async function pinned(actor: Actor, communityId: string): Promise<Message[]> {
  await requireMember(actor, communityId);
  return presentMessages("chat", await chatRepo.pinned(communityId, actor.id), actor.id);
}

export async function sendMessage(actor: Actor, communityId: string, input: { body?: string; replyToId?: string | null; mediaIds?: string[] }): Promise<Message> {
  requireActive(actor);
  const body = cleanBody(input.body);
  const mediaIds = [...new Set(input.mediaIds ?? [])];
  if (!body && !mediaIds.length) throw badRequest("Write something or attach a file", "MESSAGE_EMPTY");
  if (body.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  if (mediaIds.length > MAX_MEDIA_PER_MESSAGE) throw badRequest(`At most ${MAX_MEDIA_PER_MESSAGE} attachments per message`, "TOO_MANY_ATTACHMENTS");

  return withTransaction(async (trx, fx) => {
    await requireMember(actor, communityId, trx);
    if (input.replyToId) {
      const parent = await chatRepo.findMessage(input.replyToId, trx);
      if (!parent || parent.community_id !== communityId) throw badRequest("You can only reply to a message in this chat", "REPLY_INVALID");
    }
    const uploads = await claimUploads(actor.id, mediaIds, "CHAT", trx);
    const row = await chatRepo.insertMessage({ id: newId(), community_id: communityId, sender_id: actor.id, body, reply_to_id: input.replyToId ?? null }, trx);
    await chatRepo.insertMessageMedia(row.id, uploads.map((u) => u.id), trx);
    await chatRepo.touchRead(communityId, actor.id, row.created_at, trx);
    const dto = (await loadMessage("chat", row.id, actor.id, trx))!;
    fx.emit([rooms.chat(communityId)], "chat:message", { communityId, message: dto });
    fx.job("moderation.scan", { targetType: "CHAT_MESSAGE", targetId: row.id });
    return dto;
  });
}

export async function markRead(actor: Actor, communityId: string): Promise<void> {
  await requireMember(actor, communityId);
  await chatRepo.touchRead(communityId, actor.id, new Date());
}

export async function setMute(actor: Actor, communityId: string, until: string | null): Promise<void> {
  await requireMember(actor, communityId);
  await chatRepo.setMute(communityId, actor.id, until ? new Date(until) : null);
}

export async function unread(actor: Actor): Promise<Record<string, number>> {
  const rows = await chatRepo.unread(actor.id);
  return Object.fromEntries(rows.map((r) => [r.community_id, Number(r.n)]));
}

/** A message plus the actor's standing in its room; blocked senders' messages are 404 to the viewer. */
async function messageAccess(actor: Actor, messageId: string, exec: Executor) {
  const msg = await chatRepo.findMessage(messageId, exec);
  if (!msg) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  const a = await access(actor, msg.community_id, exec);
  if (!a.isMember && !a.isMod) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  if (!a.isMod && msg.sender_id !== actor.id && (await isBlockedEitherWay(actor.id, msg.sender_id, exec))) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  return { msg, access: a };
}

export async function editMessage(actor: Actor, messageId: string, body: string): Promise<Message> {
  requireActive(actor);
  const text = cleanBody(body);
  if (text.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  return withTransaction(async (trx, fx) => {
    const { msg, access: a } = await messageAccess(actor, messageId, trx);
    if (msg.sender_id !== actor.id || !a.isMember) throw forbidden("You can only edit your own messages");
    if (msg.status === "DELETED") throw badRequest("This message was deleted", "MESSAGE_DELETED");
    if (!text && !(await chatRepo.hasMedia(msg.id, trx))) throw badRequest("Write something or delete the message", "MESSAGE_EMPTY");
    if (text !== msg.body) {
      await chatRepo.updateMessage(msg.id, { body: text, edited_at: new Date(), moderation_state: "UNCHECKED" }, trx);
      fx.job("moderation.scan", { targetType: "CHAT_MESSAGE", targetId: msg.id });
    }
    const dto = (await loadMessage("chat", msg.id, actor.id, trx))!;
    fx.emit([rooms.chat(msg.community_id)], "chat:message:updated", { communityId: msg.community_id, message: dto });
    return dto;
  });
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  await withTransaction(async (trx, fx) => {
    const { msg, access: a } = await messageAccess(actor, messageId, trx);
    const own = msg.sender_id === actor.id;
    if (!own && !a.isMod) throw forbidden("You can only delete your own messages");
    if (msg.status === "DELETED" || msg.status === "REMOVED") return;
    if (own) {
      await chatRepo.updateMessage(msg.id, { status: "DELETED", pinned_at: null, pinned_by: null }, trx);
    } else {
      await chatRepo.updateMessage(msg.id, { status: "REMOVED", pinned_at: null, pinned_by: null }, trx);
      await recordModeratorRemoval(actor.id, { type: "CHAT_MESSAGE", id: msg.id, communityId: msg.community_id, reason: "Removed from chat by a moderator", auditAction: "chat.message.remove" }, trx);
    }
    fx.emit([rooms.chat(msg.community_id)], "chat:message:deleted", { communityId: msg.community_id, messageId: msg.id });
  });
}

export async function setPinned(actor: Actor, messageId: string, pin: boolean): Promise<Message> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { msg, access: a } = await messageAccess(actor, messageId, trx);
    if (!a.isMod) throw forbidden("Only moderators can pin messages");
    if (msg.status !== "PUBLISHED") throw badRequest("Only visible messages can be pinned", "MESSAGE_NOT_PINNABLE");
    if (!!msg.pinned_at !== pin) await chatRepo.updateMessage(msg.id, pin ? { pinned_at: new Date(), pinned_by: actor.id } : { pinned_at: null, pinned_by: null }, trx);
    const dto = (await loadMessage("chat", msg.id, actor.id, trx))!;
    fx.emit([rooms.chat(msg.community_id)], "chat:message:updated", { communityId: msg.community_id, message: dto });
    return dto;
  });
}

export async function react(actor: Actor, messageId: string, emoji: string, on: boolean): Promise<Message> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { msg, access: a } = await messageAccess(actor, messageId, trx);
    if (!a.isMember) throw forbidden("Join the community to react", "NOT_A_MEMBER");
    if (msg.status !== "PUBLISHED") throw badRequest("You cannot react to this message", "MESSAGE_NOT_REACTABLE");
    if (on) await chatRepo.addReaction(msg.id, actor.id, emoji, trx);
    else await chatRepo.removeReaction(msg.id, actor.id, emoji, trx);
    const dto = (await loadMessage("chat", msg.id, actor.id, trx))!;
    fx.emit([rooms.chat(msg.community_id)], "chat:message:updated", { communityId: msg.community_id, message: dto });
    return dto;
  });
}
