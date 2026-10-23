/**
 * Q&A. Questions live in a community and follow its visibility. Votes are idempotent
 * (the same vote twice changes nothing; 0 withdraws it) and nobody votes on their own
 * content. Only the question's author accepts an answer; accepting resolves the
 * question and the accepted answer is listed first.
 *
 * Views count once per viewer per hour (a Redis key with a one hour TTL).
 */
import type { Answer, Question } from "@open-social/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { collectTags, normalizeTag } from "../domain/tags";
import { redis } from "../integrations/redis";
import { presentAnswers, presentQuestion, presentQuestions } from "../presenters/question.presenter";
import { decodeScore, decodeTime, encodeScore, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { questionRepo, type QuestionRow } from "../repositories/question.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { recordModeratorRemoval } from "./moderation/removal";
import { loadContext, memberError, requireReadable, type CommunityContext } from "./membership.service";
import { notify } from "./notification.service";

async function loadQuestion(viewer: Actor | null, id: string, exec: Executor = db, lock = false): Promise<{ question: QuestionRow; ctx: CommunityContext }> {
  const question = lock ? await questionRepo.findByIdForUpdate(id, exec) : await questionRepo.findById(id, exec);
  if (!question || question.content_status !== "PUBLISHED") throw notFound("Question not found");
  const ctx = await loadContext(viewer, question.community_id, exec).catch(() => {
    throw notFound("Question not found");
  });
  if (!ctx.access.canRead) throw notFound("Question not found");
  if (viewer && viewer.id !== question.author_id && (await isBlockedEitherWay(viewer.id, question.author_id, exec))) throw notFound("Question not found");
  return { question, ctx };
}

async function loadAnswer(viewer: Actor | null, answerId: string, exec: Executor = db, lock = false) {
  const answer = lock ? await questionRepo.findAnswerForUpdate(answerId, exec) : await questionRepo.findAnswer(answerId, exec);
  if (!answer || answer.status !== "PUBLISHED") throw notFound("Answer not found");
  const { question, ctx } = await loadQuestion(viewer, answer.question_id, exec, lock).catch(() => {
    throw notFound("Answer not found");
  });
  if (viewer && viewer.id !== answer.author_id && (await isBlockedEitherWay(viewer.id, answer.author_id, exec))) throw notFound("Answer not found");
  return { answer, question, ctx };
}

export async function list(
  viewer: Actor | null,
  q: { communityId: string; status?: "OPEN" | "RESOLVED" | "CLOSED"; sort: "new" | "top" | "unanswered"; tag?: string; cursor?: string; limit: number },
): Promise<Paged<Question>> {
  await requireReadable(viewer, q.communityId);
  const tag = q.tag ? (normalizeTag(q.tag) ?? undefined) : undefined;
  if (q.tag && !tag) return { items: [], nextCursor: null };
  const top = q.sort === "top";
  const rows = await questionRepo.list(viewer, q.communityId, { status: q.status, sort: q.sort, tag, time: top ? null : decodeTime(q.cursor), score: top ? decodeScore(q.cursor) : null, limit: q.limit });
  const page = top ? pageBy(rows, q.limit, (r) => encodeScore(Number((r as { _score?: number })._score ?? 0), r.id)) : pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentQuestions(viewer, page.items), nextCursor: page.nextCursor };
}

export async function create(actor: Actor, input: { communityId: string; title: string; body: string; tags?: string[] }): Promise<Question> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const ctx = await loadContext(actor, input.communityId, trx);
    if (!ctx.access.canRead) throw notFound("Community not found");
    if (!ctx.access.canInteract) throw memberError(ctx);
    const q = await questionRepo.insert({ id: newId(), community_id: ctx.community.id, author_id: actor.id, title: input.title, body: input.body, created_at: new Date() }, trx);
    await questionRepo.setTags(q.id, collectTags(input.tags, `${input.title} ${input.body}`), trx);
    fx.job("moderation.scan", { targetType: "QUESTION", targetId: q.id });
    return q;
  });
  return presentQuestion(actor, row);
}

async function countView(question: QuestionRow, viewerKey: string): Promise<void> {
  try {
    const fresh = await redis().set(`qa:view:${question.id}:${viewerKey}`, "1", "EX", 3600, "NX");
    if (fresh === "OK") {
      await questionRepo.viewIncrement(question.id);
      question.view_count += 1;
    }
  } catch (err) {
    captureError(err, { where: "question.view" });
  }
}

export async function get(viewer: Actor | null, id: string, viewerKey: string): Promise<Question> {
  const { question } = await loadQuestion(viewer, id);
  await countView(question, viewer ? `u:${viewer.id}` : `ip:${viewerKey}`);
  return presentQuestion(viewer, question);
}

export async function update(actor: Actor, id: string, patch: { title?: string; body?: string; tags?: string[] }): Promise<Question> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { question, ctx } = await loadQuestion(actor, id, trx, true);
    if (question.author_id !== actor.id) throw forbidden("Only the author can edit this question", "NOT_AUTHOR");
    if (!ctx.access.canInteract) throw memberError(ctx);
    const updated = await questionRepo.update(question.id, { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.body !== undefined ? { body: patch.body } : {}) }, trx);
    if (patch.tags !== undefined) await questionRepo.setTags(question.id, collectTags(patch.tags, `${updated.title} ${updated.body}`), trx);
    if (patch.title !== undefined || patch.body !== undefined) fx.job("moderation.scan", { targetType: "QUESTION", targetId: question.id });
    return updated;
  });
  return presentQuestion(actor, row);
}

export async function remove(actor: Actor, id: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const { question, ctx } = await loadQuestion(actor, id, trx, true);
    const isAuthor = question.author_id === actor.id;
    if (!isAuthor && !ctx.access.canModerate) throw forbidden("You cannot delete this question", "NOT_AUTHOR");
    await questionRepo.update(question.id, { content_status: isAuthor ? "DELETED" : "REMOVED" }, trx);
    if (!isAuthor) await recordModeratorRemoval(actor.id, { type: "QUESTION", id: question.id, communityId: question.community_id, reason: "Removed by a moderator", auditAction: "question.remove" }, trx);
  });
}

export async function voteQuestion(actor: Actor, id: string, value: -1 | 0 | 1): Promise<{ score: number; vote: -1 | 0 | 1 }> {
  requireActive(actor);
  return withTransaction(async (trx) => {
    const { question, ctx } = await loadQuestion(actor, id, trx, true);
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (question.author_id === actor.id) throw forbidden("You cannot vote on your own question", "SELF_VOTE");
    const delta = await questionRepo.vote("question", question.id, actor.id, value, trx);
    const score = delta ? (await questionRepo.adjust(question.id, { score: delta }, trx)).score : question.score;
    return { score, vote: value };
  });
}

export async function setStatus(actor: Actor, id: string, status: "OPEN" | "CLOSED"): Promise<Question> {
  requireActive(actor);
  const row = await withTransaction(async (trx) => {
    const { question, ctx } = await loadQuestion(actor, id, trx, true);
    if (question.author_id !== actor.id && !ctx.access.canModerate) throw forbidden("Only the author or a moderator can do that", "NOT_AUTHOR");
    const next = status === "OPEN" && question.accepted_answer_id ? "RESOLVED" : status;
    return questionRepo.update(question.id, { status: next }, trx);
  });
  return presentQuestion(actor, row);
}

export async function accept(actor: Actor, id: string, answerId: string | null): Promise<Question> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { question } = await loadQuestion(actor, id, trx, true);
    if (question.author_id !== actor.id) throw forbidden("Only the person who asked can accept an answer", "NOT_QUESTION_AUTHOR");
    if (answerId === null) return questionRepo.update(question.id, { accepted_answer_id: null, status: question.status === "RESOLVED" ? "OPEN" : question.status }, trx);
    const answer = await questionRepo.findAnswer(answerId, trx);
    if (!answer || answer.question_id !== question.id || answer.status !== "PUBLISHED") throw notFound("Answer not found");
    const updated = await questionRepo.update(question.id, { accepted_answer_id: answer.id, status: question.status === "CLOSED" ? "CLOSED" : "RESOLVED" }, trx);
    if (question.accepted_answer_id !== answer.id) {
      await notify(
        { recipientId: answer.author_id, actorId: actor.id, type: "ANSWER_ACCEPTED", entityType: "answer", entityId: answer.id, communityId: question.community_id, snippet: question.title, data: { questionId: question.id } },
        fx,
        trx,
      );
    }
    return updated;
  });
  return presentQuestion(actor, row);
}

export async function listAnswers(viewer: Actor | null, id: string, q: { sort: "top" | "new"; cursor?: string; limit: number }): Promise<Paged<Answer>> {
  const { question } = await loadQuestion(viewer, id);
  const top = q.sort === "top";
  let accepted: Awaited<ReturnType<typeof questionRepo.findAnswer>> | null = null;
  if (!q.cursor && question.accepted_answer_id) {
    const a = await questionRepo.findAnswer(question.accepted_answer_id);
    if (a && a.status === "PUBLISHED" && !(viewer && viewer.id !== a.author_id && (await isBlockedEitherWay(viewer.id, a.author_id)))) accepted = a;
  }
  const rows = await questionRepo.answers(question.id, viewer?.id ?? null, {
    sort: q.sort,
    excludeId: question.accepted_answer_id,
    time: top ? null : decodeTime(q.cursor),
    score: top ? decodeScore(q.cursor) : null,
    limit: q.limit,
  });
  const page = top ? pageBy(rows, q.limit, (r) => encodeScore(Number((r as { _score?: number })._score ?? 0), r.id)) : pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const items = accepted ? [accepted, ...page.items] : page.items;
  return { items: await presentAnswers(viewer, items, question), nextCursor: page.nextCursor };
}

export async function createAnswer(actor: Actor, id: string, body: string): Promise<Answer> {
  requireActive(actor);
  const { row, question } = await withTransaction(async (trx, fx) => {
    const { question, ctx } = await loadQuestion(actor, id, trx, true);
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (question.status === "CLOSED") throw conflict("This question is closed", "QUESTION_CLOSED");
    const answer = await questionRepo.insertAnswer({ id: newId(), question_id: question.id, author_id: actor.id, body, created_at: new Date() }, trx);
    await questionRepo.adjust(question.id, { answers: 1 }, trx);
    await notify(
      { recipientId: question.author_id, actorId: actor.id, type: "ANSWER_POSTED", entityType: "answer", entityId: answer.id, communityId: question.community_id, snippet: body, data: { questionId: question.id } },
      fx,
      trx,
    );
    fx.job("moderation.scan", { targetType: "ANSWER", targetId: answer.id });
    return { row: answer, question };
  });
  return (await presentAnswers(actor, [row], question))[0] as Answer;
}

export async function updateAnswer(actor: Actor, answerId: string, body: string): Promise<Answer> {
  requireActive(actor);
  const { row, question } = await withTransaction(async (trx, fx) => {
    const { answer, question, ctx } = await loadAnswer(actor, answerId, trx, true);
    if (answer.author_id !== actor.id) throw forbidden("Only the author can edit this answer", "NOT_AUTHOR");
    if (!ctx.access.canInteract) throw memberError(ctx);
    const updated = await questionRepo.updateAnswer(answer.id, { body }, trx);
    fx.job("moderation.scan", { targetType: "ANSWER", targetId: answer.id });
    return { row: updated, question };
  });
  return (await presentAnswers(actor, [row], question))[0] as Answer;
}

export async function removeAnswer(actor: Actor, answerId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const { answer, question, ctx } = await loadAnswer(actor, answerId, trx, true);
    const isAuthor = answer.author_id === actor.id;
    if (!isAuthor && !ctx.access.canModerate) throw forbidden("You cannot delete this answer", "NOT_AUTHOR");
    await questionRepo.updateAnswer(answer.id, { status: isAuthor ? "DELETED" : "REMOVED" }, trx);
    await questionRepo.adjust(question.id, { answers: -1 }, trx);
    if (question.accepted_answer_id === answer.id) {
      await questionRepo.update(question.id, { accepted_answer_id: null, status: question.status === "RESOLVED" ? "OPEN" : question.status }, trx);
    }
    if (!isAuthor) await recordModeratorRemoval(actor.id, { type: "ANSWER", id: answer.id, communityId: question.community_id, reason: "Removed by a moderator", auditAction: "answer.remove", data: { questionId: question.id } }, trx);
  });
}

export async function voteAnswer(actor: Actor, answerId: string, value: -1 | 0 | 1): Promise<{ score: number; vote: -1 | 0 | 1 }> {
  requireActive(actor);
  return withTransaction(async (trx) => {
    const { answer, ctx } = await loadAnswer(actor, answerId, trx, true);
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (answer.author_id === actor.id) throw forbidden("You cannot vote on your own answer", "SELF_VOTE");
    const delta = await questionRepo.vote("answer", answer.id, actor.id, value, trx);
    const score = delta ? (await questionRepo.adjustAnswerScore(answer.id, delta, trx)).score : answer.score;
    return { score, vote: value };
  });
}
