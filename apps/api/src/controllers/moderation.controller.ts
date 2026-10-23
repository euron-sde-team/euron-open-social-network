/** The moderation queue, case actions, history, the author's own cases and appeals. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import { actOnCase } from "../services/moderation/actions.service";
import { createAppeal, decideAppeal, listAppeals } from "../services/moderation/appeals.service";
import * as cases from "../services/moderation/cases.service";

const TARGETS = ["POST", "COMMENT", "CHAT_MESSAGE", "DM_MESSAGE", "QUESTION", "ANSWER", "EVENT", "USER", "COMMUNITY"] as const;
const ACTIONS = ["APPROVE", "HIDE", "REMOVE", "RESTORE", "WARN", "SUSPEND", "BAN", "UNBAN", "DISMISS"] as const;

const listQuery = pageQuery.extend({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  source: z.enum(["AI", "REPORT", "PREMODERATION"]).optional(),
  communityId: id().optional(),
  targetType: z.enum(TARGETS).optional(),
});

export async function list(req: Request, res: Response) {
  const q = parse(listQuery, req.query);
  res.json(await cases.listCases(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function detail(req: Request, res: Response) {
  const { id: caseId } = parse(idParam, req.params);
  res.json(await cases.getCase(actorOf(req), caseId));
}

const actionBody = z.object({
  action: z.enum(ACTIONS),
  reason: z.string().trim().max(1000).optional().nullable(),
  suspendDays: z.number().int().min(1).max(3650).optional(),
});

export async function act(req: Request, res: Response) {
  const { id: caseId } = parse(idParam, req.params);
  const body = parse(actionBody, req.body);
  res.json(await actOnCase(actorOf(req), caseId, { ...body, reason: body.reason || null }, meta(req).ip));
}

export async function assign(req: Request, res: Response) {
  const { id: caseId } = parse(idParam, req.params);
  const { userId } = parse(z.object({ userId: id().nullable() }), req.body);
  res.json(await cases.assignCase(actorOf(req), caseId, userId));
}

export async function history(req: Request, res: Response) {
  const q = parse(z.object({ targetType: z.enum(TARGETS), targetId: id() }), req.query);
  res.json(await cases.history(actorOf(req), q.targetType, q.targetId));
}

export async function mine(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await cases.myCases(actorOf(req), q.cursor, q.limit ?? 20));
}

export async function appeal(req: Request, res: Response) {
  const { id: caseId } = parse(idParam, req.params);
  const { statement } = parse(z.object({ statement: z.string().trim().min(10).max(2000) }), req.body);
  res.status(201).json(await createAppeal(actorOf(req), caseId, statement));
}

export async function appeals(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["PENDING", "UPHELD", "OVERTURNED"]).optional() }), req.query);
  res.json(await listAppeals(actorOf(req), q.status, q.cursor, q.limit ?? 20));
}

export async function decide(req: Request, res: Response) {
  const { id: appealId } = parse(idParam, req.params);
  const body = parse(z.object({ status: z.enum(["UPHELD", "OVERTURNED"]), note: z.string().trim().max(1000).optional().nullable() }), req.body);
  res.json(await decideAppeal(actorOf(req), appealId, body.status, body.note || null));
}

export async function stats(req: Request, res: Response) {
  res.json(await cases.stats(actorOf(req)));
}
