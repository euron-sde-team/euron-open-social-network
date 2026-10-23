import type { Poll } from "@open-social/types";

/** Percent of voters for an option (multi-choice polls can exceed 100 in total). */
export function optionPercent(poll: Poll, voteCount: number): number {
  const base = poll.allowMultiple ? poll.voterCount : poll.totalVotes;
  return base > 0 ? Math.round((voteCount / base) * 100) : 0;
}

export const hasVoted = (poll: Poll) => poll.options.some((o) => o.votedByViewer);

/** Optimistic poll after the viewer votes for `optionIds` (replacing any previous vote). */
export function applyVote(poll: Poll, optionIds: string[]): Poll {
  const had = hasVoted(poll);
  const prevVotes = poll.options.filter((o) => o.votedByViewer).length;
  const options = poll.options.map((o) => {
    const was = o.votedByViewer;
    const now = optionIds.includes(o.id);
    return { ...o, votedByViewer: now, voteCount: Math.max(0, o.voteCount - (was ? 1 : 0) + (now ? 1 : 0)) };
  });
  const voting = optionIds.length > 0;
  return {
    ...poll,
    options,
    totalVotes: Math.max(0, poll.totalVotes - prevVotes + optionIds.length),
    voterCount: Math.max(0, poll.voterCount + (voting && !had ? 1 : 0) - (!voting && had ? 1 : 0)),
  };
}
