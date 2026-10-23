/** Direct-message endpoints: parse and validate, call the service, send the DTO. */
import type { Request, Response } from "express";
import { z } from "zod";
import { parseLimit } from "../core/cursor";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as dms from "../services/dm.service";

const emojiParam = z.object({ id: id(), emoji: z.string().min(1).max(16) });
const messageBody = z.object({
  body: z.string().max(8000).optional().default(""),
  replyToId: id().nullable().optional(),
  mediaIds: z.array(id()).max(10).optional(),
});
const isoOrNull = z.string().datetime({ offset: true }).nullable();

export async function listThreads(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ folder: z.enum(["inbox", "requests"]).default("inbox") }), req.query);
  res.json(await dms.listThreads(actorOf(req), q.folder, q.cursor, parseLimit(q.limit)));
}

export async function openDirect(req: Request, res: Response) {
  const { userId } = parse(z.object({ userId: id() }), req.body);
  res.json(await dms.openDirect(actorOf(req), userId));
}

export async function createGroup(req: Request, res: Response) {
  const body = parse(z.object({ userIds: z.array(id()).min(2).max(49), title: z.string().trim().max(100).nullable().optional() }), req.body);
  res.status(201).json(await dms.createGroup(actorOf(req), { userIds: body.userIds, title: body.title || null }));
}

export async function getThread(req: Request, res: Response) {
  res.json(await dms.getThread(actorOf(req), parse(idParam, req.params).id));
}

export async function updateThread(req: Request, res: Response) {
  const body = parse(z.object({ title: z.string().trim().max(100).nullable().optional(), mutedUntil: isoOrNull.optional() }), req.body);
  res.json(await dms.updateThread(actorOf(req), parse(idParam, req.params).id, { ...(body.title !== undefined ? { title: body.title || null } : {}), ...(body.mutedUntil !== undefined ? { mutedUntil: body.mutedUntil } : {}) }));
}

export async function listMessages(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await dms.listMessages(actorOf(req), parse(idParam, req.params).id, q.cursor, parseLimit(q.limit)));
}

export async function sendMessage(req: Request, res: Response) {
  res.status(201).json(await dms.sendMessage(actorOf(req), parse(idParam, req.params).id, parse(messageBody, req.body)));
}

export async function markRead(req: Request, res: Response) {
  await dms.markRead(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function accept(req: Request, res: Response) {
  res.json(await dms.acceptRequest(actorOf(req), parse(idParam, req.params).id));
}

export async function decline(req: Request, res: Response) {
  await dms.declineRequest(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function leave(req: Request, res: Response) {
  await dms.leaveGroup(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function addParticipants(req: Request, res: Response) {
  const { userIds } = parse(z.object({ userIds: z.array(id()).min(1).max(49) }), req.body);
  res.json(await dms.addParticipants(actorOf(req), parse(idParam, req.params).id, userIds));
}

export async function threadMedia(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await dms.threadMedia(actorOf(req), parse(idParam, req.params).id, q.cursor, parseLimit(q.limit)));
}

export async function pinned(req: Request, res: Response) {
  res.json(await dms.pinnedMessages(actorOf(req), parse(idParam, req.params).id));
}

export async function search(req: Request, res: Response) {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  res.json(await dms.searchMessages(actorOf(req), parse(idParam, req.params).id, q));
}

export async function editMessage(req: Request, res: Response) {
  const { body } = parse(z.object({ body: z.string().max(8000) }), req.body);
  res.json(await dms.editMessage(actorOf(req), parse(idParam, req.params).id, body));
}

export async function deleteMessage(req: Request, res: Response) {
  await dms.deleteMessage(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function pin(req: Request, res: Response) {
  res.json(await dms.setPinned(actorOf(req), parse(idParam, req.params).id, true));
}

export async function unpin(req: Request, res: Response) {
  res.json(await dms.setPinned(actorOf(req), parse(idParam, req.params).id, false));
}

export async function addReaction(req: Request, res: Response) {
  const p = parse(emojiParam, req.params);
  res.json(await dms.react(actorOf(req), p.id, p.emoji, true));
}

export async function removeReaction(req: Request, res: Response) {
  const p = parse(emojiParam, req.params);
  res.json(await dms.react(actorOf(req), p.id, p.emoji, false));
}

export async function unread(req: Request, res: Response) {
  res.json(await dms.unreadSummary(actorOf(req)));
}

export async function eligibility(req: Request, res: Response) {
  const { userId } = parse(z.object({ userId: id() }), req.params);
  res.json(await dms.getEligibility(actorOf(req), userId));
}

export async function contacts(req: Request, res: Response) {
  res.json(await dms.contacts(actorOf(req)));
}
