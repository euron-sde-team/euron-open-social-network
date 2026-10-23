/** Polls to DTOs, batched by poll id: options and the viewer's own votes in two queries. */
import type { Poll } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { pollRepo, type PollRow } from "../repositories/poll.repository";

export function pollIsClosed(p: Pick<PollRow, "closed_at" | "closes_at">, now = new Date()): boolean {
  return !!p.closed_at || (!!p.closes_at && p.closes_at <= now);
}

export async function presentPolls(viewer: Actor | null, polls: readonly PollRow[], exec: Executor = db): Promise<Map<string, Poll>> {
  if (!polls.length) return new Map();
  const ids = polls.map((p) => p.id);
  const [options, votes] = await Promise.all([pollRepo.options(ids, exec), pollRepo.viewerVotes(viewer?.id, ids, exec)]);
  const mine = new Set(votes.map((v) => v.option_id));
  const now = new Date();
  return new Map(
    polls.map((p) => [
      p.id,
      {
        id: p.id,
        question: p.question,
        allowMultiple: p.allow_multiple,
        isAnonymous: p.is_anonymous,
        closesAt: p.closes_at?.toISOString() ?? null,
        isClosed: pollIsClosed(p, now),
        totalVotes: p.total_votes,
        voterCount: p.voter_count,
        options: options
          .filter((o) => o.poll_id === p.id)
          .map((o) => ({ id: o.id, label: o.label, voteCount: o.vote_count, votedByViewer: mine.has(o.id) })),
      },
    ]),
  );
}

export async function presentPoll(viewer: Actor | null, poll: PollRow, exec: Executor = db): Promise<Poll> {
  return (await presentPolls(viewer, [poll], exec)).get(poll.id) as Poll;
}
