/** /api/posts: feed, create, read, edit, delete, reactions, bookmarks, pin, lock, comments. */
import { REACTIONS } from "@open-social/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, optionalText, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as comments from "../services/comment.service";
import * as feed from "../services/feed.service";
import * as posts from "../services/post.service";
import * as reactions from "../services/reaction.service";

const reaction = z.enum(REACTIONS);
const tags = z.array(z.string().trim().max(41)).max(10);

const createBody = z.object({
  communityId: id(),
  body: z.string().max(20000).default(""),
  kind: z.enum(["POST", "ANNOUNCEMENT"]).optional(),
  feeling: optionalText(40),
  tags: tags.optional(),
  mediaIds: z.array(id()).max(10).optional(),
  poll: z
    .object({
      question: text(300, 1),
      options: z.array(text(120, 1)).min(2).max(8),
      allowMultiple: z.boolean().optional(),
      isAnonymous: z.boolean().optional(),
      closesAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .optional(),
  sharedPostId: id().optional(),
});

const patchBody = z.object({ body: z.string().max(20000), tags, feeling: optionalText(40) }).partial();

export async function homeFeed(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ sort: z.enum(["latest", "top"]).default("latest") }), req.query);
  res.json(await feed.homeFeed(actorOf(req), { sort: q.sort, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await posts.create(actorOf(req), parse(createBody, req.body)));
}

export async function get(req: Request, res: Response) {
  res.json(await posts.get(req.actor, parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  res.json(await posts.update(actorOf(req), parse(idParam, req.params).id, parse(patchBody, req.body)));
}

export async function remove(req: Request, res: Response) {
  await posts.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function react(req: Request, res: Response) {
  const { type } = parse(z.object({ type: reaction }), req.body);
  res.json(await reactions.setPostReaction(actorOf(req), parse(idParam, req.params).id, type));
}

export async function unreact(req: Request, res: Response) {
  res.json(await reactions.setPostReaction(actorOf(req), parse(idParam, req.params).id, null));
}

export async function reactionList(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ type: reaction.optional() }), req.query);
  res.json(await reactions.listPostReactions(req.actor, parse(idParam, req.params).id, { type: q.type, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function bookmark(req: Request, res: Response) {
  await posts.bookmark(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function unbookmark(req: Request, res: Response) {
  await posts.unbookmark(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function hide(req: Request, res: Response) {
  await posts.hide(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export const pin = async (req: Request, res: Response) => void res.json(await posts.pin(actorOf(req), parse(idParam, req.params).id));
export const unpin = async (req: Request, res: Response) => void res.json(await posts.unpin(actorOf(req), parse(idParam, req.params).id));
export const lock = async (req: Request, res: Response) => void res.json(await posts.lock(actorOf(req), parse(idParam, req.params).id));
export const unlock = async (req: Request, res: Response) => void res.json(await posts.unlock(actorOf(req), parse(idParam, req.params).id));

export async function listComments(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await comments.listForPost(req.actor, parse(idParam, req.params).id, { cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function createComment(req: Request, res: Response) {
  const body = parse(z.object({ body: z.string().max(10000).default(""), parentId: id().optional(), mediaId: id().optional() }), req.body);
  res.status(201).json(await comments.create(actorOf(req), parse(idParam, req.params).id, body));
}
