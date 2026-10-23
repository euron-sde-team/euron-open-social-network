/** /api/comments: replies, edit, delete, reactions. */
import { REACTIONS } from "@open-social/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as comments from "../services/comment.service";
import * as reactions from "../services/reaction.service";

export async function replies(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await comments.listReplies(req.actor, parse(idParam, req.params).id, { cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function update(req: Request, res: Response) {
  const { body } = parse(z.object({ body: z.string().max(10000) }), req.body);
  res.json(await comments.update(actorOf(req), parse(idParam, req.params).id, body));
}

export async function remove(req: Request, res: Response) {
  await comments.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function react(req: Request, res: Response) {
  const { type } = parse(z.object({ type: z.enum(REACTIONS) }), req.body);
  res.json(await reactions.setCommentReaction(actorOf(req), parse(idParam, req.params).id, type));
}

export async function unreact(req: Request, res: Response) {
  res.json(await reactions.setCommentReaction(actorOf(req), parse(idParam, req.params).id, null));
}
