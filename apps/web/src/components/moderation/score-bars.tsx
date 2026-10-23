"use client";

import { cn } from "@open-social/ui";
import { humanize, severity, sortedScores } from "@/lib/moderation";

const TONE = { low: "bg-success", medium: "bg-warning", high: "bg-danger" } as const;

/** One bar per AI category, highest first. */
export function ScoreBars({ scores, max = 3, compact }: { scores: Record<string, number> | null; max?: number; compact?: boolean }) {
  const rows = sortedScores(scores).slice(0, max);
  if (!rows.length) return <span className="text-xs text-subtle-foreground">No AI scores</span>;
  return (
    <ul className={cn("space-y-1", compact ? "w-40" : "w-full")} aria-label="AI scores">
      {rows.map(([cat, v]) => {
        const pct = Math.round(Math.min(1, Math.max(0, v)) * 100);
        return (
          <li key={cat} className="flex items-center gap-2 text-xs">
            <span className={cn("shrink-0 truncate text-muted-foreground", compact ? "w-16" : "w-28")}>{humanize(cat)}</span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={humanize(cat)}>
              <span className={cn("absolute inset-y-0 left-0 rounded-full", TONE[severity(v)])} style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{pct}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function PriorityBar({ value }: { value: number }) {
  // Priority is an unbounded integer from the API; show it on a 0..100 scale capped visually.
  const pct = Math.max(4, Math.min(100, value));
  const tone = value >= 70 ? "bg-danger" : value >= 40 ? "bg-warning" : "bg-primary";
  return (
    <span className="flex items-center gap-2" aria-label={`Priority ${value}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
    </span>
  );
}
