/** /api/polls: read, vote (replaces the previous vote), withdraw, close, voters. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as polls from "../services/poll.service";

export async function get(req: Request, res: Response) {
  res.json(await polls.get(req.actor, parse(idParam, req.params).id));
}

export async function vote(req: Request, res: Response) {
  const { optionIds } = parse(z.object({ optionIds: z.array(id()).min(1).max(8) }), req.body);
  res.json(await polls.vote(actorOf(req), parse(idParam, req.params).id, optionIds));
}

export async function unvote(req: Request, res: Response) {
  res.json(await polls.unvote(actorOf(req), parse(idParam, req.params).id));
}

export async function close(req: Request, res: Response) {
  res.json(await polls.close(actorOf(req), parse(idParam, req.params).id));
}

export async function voters(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ optionId: id().optional() }), req.query);
  res.json(await polls.voters(actorOf(req), parse(idParam, req.params).id, { optionId: q.optionId, cursor: q.cursor, limit: q.limit ?? 20 }));
}
