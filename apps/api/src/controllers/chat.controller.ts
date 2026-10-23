/** Community chat endpoints: parse and validate, call the service, send the DTO. */
import type { Request, Response } from "express";
import { z } from "zod";
import { parseLimit } from "../core/cursor";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as chat from "../services/chat.service";

const communityParam = z.object({ communityId: id() });
const emojiParam = z.object({ id: id(), emoji: z.string().min(1).max(16) });

export async function unread(req: Request, res: Response) {
  res.json(await chat.unread(actorOf(req)));
}

export async function listMessages(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await chat.listMessages(actorOf(req), parse(communityParam, req.params).communityId, q.cursor, parseLimit(q.limit)));
}

export async function sendMessage(req: Request, res: Response) {
  const body = parse(z.object({ body: z.string().max(8000).optional().default(""), replyToId: id().nullable().optional(), mediaIds: z.array(id()).max(10).optional() }), req.body);
  res.status(201).json(await chat.sendMessage(actorOf(req), parse(communityParam, req.params).communityId, body));
}

export async function pinned(req: Request, res: Response) {
  res.json(await chat.pinned(actorOf(req), parse(communityParam, req.params).communityId));
}

export async function markRead(req: Request, res: Response) {
  await chat.markRead(actorOf(req), parse(communityParam, req.params).communityId);
  res.status(204).end();
}

export async function mute(req: Request, res: Response) {
  const { until } = parse(z.object({ until: z.string().datetime({ offset: true }).nullable() }), req.body);
  await chat.setMute(actorOf(req), parse(communityParam, req.params).communityId, until);
  res.status(204).end();
}

export async function editMessage(req: Request, res: Response) {
  const { body } = parse(z.object({ body: z.string().max(8000) }), req.body);
  res.json(await chat.editMessage(actorOf(req), parse(idParam, req.params).id, body));
}

export async function deleteMessage(req: Request, res: Response) {
  await chat.deleteMessage(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function pin(req: Request, res: Response) {
  res.json(await chat.setPinned(actorOf(req), parse(idParam, req.params).id, true));
}

export async function unpin(req: Request, res: Response) {
  res.json(await chat.setPinned(actorOf(req), parse(idParam, req.params).id, false));
}

export async function addReaction(req: Request, res: Response) {
  const p = parse(emojiParam, req.params);
  res.json(await chat.react(actorOf(req), p.id, p.emoji, true));
}

export async function removeReaction(req: Request, res: Response) {
  const p = parse(emojiParam, req.params);
  res.json(await chat.react(actorOf(req), p.id, p.emoji, false));
}
