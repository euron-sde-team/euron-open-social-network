"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Lock } from "lucide-react";
import { Badge, Button, Checkbox, cn } from "@open-social/ui";
import type { Poll, Post } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyVote, hasVoted, optionPercent } from "@/lib/poll";
import { updatePostEverywhere } from "@/lib/post-cache";
import { relativeTime } from "@/lib/time";

export function PollWidget({ poll, postId, canClose, canVote = true }: { poll: Poll; postId: string; canClose?: boolean; canVote?: boolean }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const voted = hasVoted(poll);
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const showResults = poll.isClosed || (voted && !changing) || !canVote || status !== "signed-in";

  const setPoll = (p: Poll) => updatePostEverywhere(qc, postId, (post: Post) => ({ ...post, poll: p }));

  const vote = useMutation({
    mutationFn: (ids: string[]) => (ids.length ? api().polls.vote(poll.id, ids) : api().polls.unvote(poll.id)),
    onMutate: (ids) => {
      const snapshot = setPoll(applyVote(poll, ids));
      setChanging(false);
      setSelected([]);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx && ctx.snapshot.forEach(([k, d]) => qc.setQueryData(k, d)),
    onSuccess: (p) => setPoll(p),
  });
  const close = useMutation({ mutationFn: () => api().polls.close(poll.id), onSuccess: (p) => setPoll(p) });

  const closesText = poll.isClosed ? "Final results" : poll.closesAt ? `Closes ${relativeTime(poll.closesAt)}` : null;

  return (
    <div className="mx-4 rounded-lg border border-border p-3" data-testid="poll">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-semibold">{poll.question}</p>
        {poll.isAnonymous ? (
          <Badge tone="neutral">
            <EyeOff /> Anonymous
          </Badge>
        ) : null}
        {poll.isClosed ? (
          <Badge tone="warning">
            <Lock /> Closed
          </Badge>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-subtle-foreground">{poll.allowMultiple ? "Choose one or more" : "Choose one"}</p>

      <ul className="space-y-2">
        {poll.options.map((o) => {
          const pct = optionPercent(poll, o.voteCount);
          if (showResults) {
            return (
              <li key={o.id} className="relative overflow-hidden rounded-md border border-border" data-testid="poll-result">
                <div className={cn("absolute inset-y-0 left-0 transition-[width] duration-500", o.votedByViewer ? "bg-primary/20" : "bg-muted")} style={{ width: `${pct}%` }} aria-hidden />
                <div className="relative flex items-center gap-2 px-3 py-2 text-sm">
                  {o.votedByViewer ? <Check className="size-4 shrink-0 text-primary" aria-label="Your vote" /> : null}
                  <span className={cn("min-w-0 flex-1", o.votedByViewer && "font-semibold")}>{o.label}</span>
                  <span className="font-semibold tabular-nums">{pct}%</span>
                </div>
              </li>
            );
          }
          const isSel = selected.includes(o.id);
          return (
            <li key={o.id}>
              {poll.allowMultiple ? (
                <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors", isSel ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                  <Checkbox checked={isSel} onCheckedChange={(c) => setSelected((s) => (c ? [...s, o.id] : s.filter((x) => x !== o.id)))} />
                  {o.label}
                </label>
              ) : (
                <button
                  type="button"
                  data-testid="poll-option"
                  onClick={() => vote.mutate([o.id])}
                  className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/10"
                >
                  <span className="size-4 shrink-0 rounded-full border-2 border-input" aria-hidden />
                  {o.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
        <span>
          {poll.voterCount} {poll.voterCount === 1 ? "person" : "people"} voted
        </span>
        {closesText ? <span>{closesText}</span> : null}
        <span className="flex-1" />
        {!showResults && poll.allowMultiple ? (
          <Button size="sm" disabled={!selected.length} onClick={() => vote.mutate(selected)} data-testid="poll-vote">
            Vote
          </Button>
        ) : null}
        {!poll.isClosed && voted && !changing && canVote ? (
          <>
            <Button variant="link" size="sm" onClick={() => setChanging(true)} data-testid="poll-change">
              Change vote
            </Button>
            <Button variant="link" size="sm" onClick={() => vote.mutate([])}>
              Remove vote
            </Button>
          </>
        ) : null}
        {changing ? (
          <Button variant="link" size="sm" onClick={() => setChanging(false)}>
            Cancel
          </Button>
        ) : null}
        {canClose && !poll.isClosed ? (
          <Button variant="link" size="sm" onClick={() => close.mutate()} loading={close.isPending}>
            Close poll
          </Button>
        ) : null}
      </div>
    </div>
  );
}
