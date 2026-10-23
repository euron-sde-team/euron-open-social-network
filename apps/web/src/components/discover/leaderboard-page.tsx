"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, Segmented, Skeleton, cn } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";

type Period = "week" | "month" | "all";

const MEDAL = ["text-reaction-warm", "text-muted-foreground", "text-reaction-angry"];

export function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const { user } = useAuth();
  const q = useQuery({ queryKey: qk.leaderboard(period), queryFn: () => api().discover.leaderboard(period) });
  return (
    <Card data-testid="leaderboard">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">Reputation earned from helpful posts, answers and accepted solutions.</p>
        </div>
        <Segmented
          aria-label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "all", label: "All time" },
          ]}
        />
      </div>
      {q.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={<Trophy />} title="No one on the board yet" description="Post, answer questions and help others to earn reputation." />
      ) : (
        <ol className="divide-y divide-border">
          {q.data.map((e) => {
            const top = e.rank <= 3;
            const me = e.user.id === user?.id;
            return (
              <li key={e.user.id} data-testid="leaderboard-row">
                <Link href={`/u/${encodeURIComponent(e.user.username)}`} className={cn("flex items-center gap-3 px-4 py-3 hover:bg-muted", top && "bg-primary/[0.04]", me && "bg-primary/10")}>
                  <span className={cn("flex w-8 shrink-0 justify-center text-sm font-bold tabular-nums", top ? MEDAL[e.rank - 1] : "text-subtle-foreground")}>
                    {top ? <Trophy className="size-5" aria-label={`Rank ${e.rank}`} /> : e.rank}
                  </span>
                  <Avatar name={e.user.displayName} seed={e.user.id} src={e.user.avatarUrl} size={top ? "lg" : "md"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{e.user.displayName}</span>
                      {me ? <Badge tone="primary">You</Badge> : null}
                    </span>
                    <span className="block truncate text-sm text-subtle-foreground">{e.user.headline ?? `@${e.user.username}`}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-bold tabular-nums">{compactNumber(e.reputation)}</span>
                    <span className="block text-xs text-subtle-foreground">Level {e.level}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
