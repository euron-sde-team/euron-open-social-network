"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@open-social/ui";

export function VoteControl({
  score,
  vote,
  onVote,
  disabled,
  testId = "vote",
  orientation = "vertical",
}: {
  score: number;
  vote: -1 | 0 | 1;
  onVote: (dir: -1 | 1) => void;
  disabled?: boolean;
  testId?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const btn = "flex size-9 items-center justify-center rounded-full transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className={cn("flex items-center", orientation === "vertical" ? "flex-col" : "gap-1")} data-testid={testId}>
      <button type="button" aria-label="Upvote" aria-pressed={vote === 1} disabled={disabled} onClick={() => onVote(1)} className={cn(btn, vote === 1 ? "text-primary" : "text-muted-foreground")} data-testid={`${testId}-up`}>
        <ChevronUp className="size-6" strokeWidth={2.5} />
      </button>
      <span className={cn("min-w-6 text-center text-base font-bold tabular-nums", vote === 1 ? "text-primary" : vote === -1 ? "text-danger" : "text-foreground")} aria-label={`Score ${score}`} data-testid={`${testId}-score`}>
        {score}
      </span>
      <button type="button" aria-label="Downvote" aria-pressed={vote === -1} disabled={disabled} onClick={() => onVote(-1)} className={cn(btn, vote === -1 ? "text-danger" : "text-muted-foreground")} data-testid={`${testId}-down`}>
        <ChevronDown className="size-6" strokeWidth={2.5} />
      </button>
    </div>
  );
}
