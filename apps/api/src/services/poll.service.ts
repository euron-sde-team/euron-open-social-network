/**
 * Polls. A vote replaces the voter's previous vote (single choice takes exactly one
 * option). The poll row is locked while votes change so totals stay exact. Voter lists
 * are for members only and never for anonymous polls.
 */
import type { Poll, UserSummary } from "@open-social/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { pollIsClosed, presentPoll } from "../presenters/poll.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { pollRepo } from "../repositories/poll.repository";
import { memberError } from "./membership.service";
import { loadReadablePost } from "./post.service";

async function loadPoll(viewer: Actor | null, pollId: string, exec: Executor = db, lock = false) {
  const poll = lock ? await pollRepo.findByIdForUpdate(pollId, exec) : await pollRepo.findById(pollId, exec);
  if (!poll) throw notFound("Poll not found");
  const { post, ctx } = await loadReadablePost(viewer, poll.post_id, exec).catch(() => {
    throw notFound("Poll not found");
  });
  return { poll, post, ctx };
}

export async function get(viewer: Actor | null, pollId: string): Promise<Poll> {
  const { poll } = await loadPoll(viewer, pollId);
  return presentPoll(viewer, poll);
}

export async function vote(actor: Actor, pollId: string, optionIds: string[]): Promise<Poll> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const { poll, post, ctx } = await loadPoll(actor, pollId, trx, true);
    if (post.status !== "PUBLISHED") throw notFound("Poll not found");
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (pollIsClosed(poll)) throw conflict("This poll is closed", "POLL_CLOSED");
    const ids = [...new Set(optionIds)];
    if (!ids.length) throw badRequest("Choose an option", "VALIDATION_FAILED");
    if (!poll.allow_multiple && ids.length !== 1) throw badRequest("Choose one option", "SINGLE_CHOICE");
    const valid = new Set((await pollRepo.options([poll.id], trx)).map((o) => o.id));
    if (ids.some((id) => !valid.has(id))) throw badRequest("That option is not part of this poll", "INVALID_OPTION");
    await pollRepo.clearVotes(poll.id, actor.id, trx);
    await pollRepo.addVotes(poll.id, actor.id, ids, trx);
  });
  return get(actor, pollId);
}

export async function unvote(actor: Actor, pollId: string): Promise<Poll> {
  requireActive(actor);
  await withTransaction(async (trx) => {
    const { poll, ctx } = await loadPoll(actor, pollId, trx, true);
    if (!ctx.access.canInteract) throw memberError(ctx);
    if (pollIsClosed(poll)) throw conflict("This poll is closed", "POLL_CLOSED");
    await pollRepo.clearVotes(poll.id, actor.id, trx);
  });
  return get(actor, pollId);
}

export async function close(actor: Actor, pollId: string): Promise<Poll> {
  requireActive(actor);
  const { poll, post, ctx } = await loadPoll(actor, pollId);
  if (post.author_id !== actor.id && !ctx.access.canModerate) throw forbidden("Only the author or a moderator can close this poll", "NOT_AUTHOR");
  await pollRepo.close(poll.id);
  return get(actor, pollId);
}

export async function voters(viewer: Actor, pollId: string, q: { optionId?: string; cursor?: string; limit: number }): Promise<Paged<UserSummary>> {
  const { poll, ctx } = await loadPoll(viewer, pollId);
  if (!ctx.access.isMember && !(viewer.role === "ADMIN" || viewer.role === "MODERATOR")) throw memberError(ctx);
  if (poll.is_anonymous) throw forbidden("Votes in this poll are anonymous", "POLL_ANONYMOUS");
  const rows = await pollRepo.voters(poll.id, q.optionId, viewer.id, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const users = await loadSummaries(page.items.map((r) => r.id));
  return { items: page.items.map((r) => users.get(r.id)).filter((u): u is UserSummary => !!u), nextCursor: page.nextCursor };
}
