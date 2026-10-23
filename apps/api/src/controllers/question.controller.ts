/** /api/questions: Q&A questions, answers, votes and accepted answers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as qa from "../services/question.service";

const voteValue = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });
const tags = z.array(z.string().trim().max(41)).max(10);
const answerParam = z.object({ answerId: id() });

export async function list(req: Request, res: Response) {
  const q = parse(
    pageQuery.extend({
      communityId: id(),
      status: z.enum(["OPEN", "RESOLVED", "CLOSED"]).optional(),
      sort: z.enum(["new", "top", "unanswered"]).default("new"),
      tag: z.string().max(41).optional(),
    }),
    req.query,
  );
  res.json(await qa.list(req.actor, { ...q, limit: q.limit ?? 20 }));
}

export async function create(req: Request, res: Response) {
  const body = parse(z.object({ communityId: id(), title: text(300, 10), body: z.string().trim().max(20000).default(""), tags: tags.optional() }), req.body);
  res.status(201).json(await qa.create(actorOf(req), body));
}

export async function get(req: Request, res: Response) {
  res.json(await qa.get(req.actor, parse(idParam, req.params).id, req.ip ?? "unknown"));
}

export async function update(req: Request, res: Response) {
  const body = parse(z.object({ title: text(300, 10).optional(), body: z.string().trim().max(20000).optional(), tags: tags.optional() }), req.body);
  res.json(await qa.update(actorOf(req), parse(idParam, req.params).id, body));
}

export async function remove(req: Request, res: Response) {
  await qa.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function vote(req: Request, res: Response) {
  res.json(await qa.voteQuestion(actorOf(req), parse(idParam, req.params).id, parse(voteValue, req.body).value));
}

export async function setStatus(req: Request, res: Response) {
  const { status } = parse(z.object({ status: z.enum(["OPEN", "CLOSED"]) }), req.body);
  res.json(await qa.setStatus(actorOf(req), parse(idParam, req.params).id, status));
}

export async function accept(req: Request, res: Response) {
  const { answerId } = parse(z.object({ answerId: id().nullable() }), req.body);
  res.json(await qa.accept(actorOf(req), parse(idParam, req.params).id, answerId));
}

export async function answers(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ sort: z.enum(["top", "new"]).default("top") }), req.query);
  res.json(await qa.listAnswers(req.actor, parse(idParam, req.params).id, { sort: q.sort, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function createAnswer(req: Request, res: Response) {
  const { body } = parse(z.object({ body: text(20000, 1) }), req.body);
  res.status(201).json(await qa.createAnswer(actorOf(req), parse(idParam, req.params).id, body));
}

export async function updateAnswer(req: Request, res: Response) {
  const { body } = parse(z.object({ body: text(20000, 1) }), req.body);
  res.json(await qa.updateAnswer(actorOf(req), parse(answerParam, req.params).answerId, body));
}

export async function removeAnswer(req: Request, res: Response) {
  await qa.removeAnswer(actorOf(req), parse(answerParam, req.params).answerId);
  res.status(204).end();
}

export async function voteAnswer(req: Request, res: Response) {
  res.json(await qa.voteAnswer(actorOf(req), parse(answerParam, req.params).answerId, parse(voteValue, req.body).value));
}
