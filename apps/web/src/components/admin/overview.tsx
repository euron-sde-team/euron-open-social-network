"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, MessageSquare, Users, UsersRound } from "lucide-react";
import { Card, Segmented, Skeleton, cn } from "@open-social/ui";
import type { AdminStats } from "@open-social/api-client";
import { api } from "@/lib/api";
import { sparklinePath } from "@/lib/admin";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";

type Series = "signups" | "posts" | "messages";
const SERIES: { value: Series; label: string }[] = [
  { value: "signups", label: "Sign-ups" },
  { value: "posts", label: "Posts" },
  { value: "messages", label: "Messages" },
];

export function AdminOverview() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: qk.adminStats(days), queryFn: () => api().admin.stats(days) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data?.totals;
  const tiles = [
    { label: "People", value: t?.users, icon: Users },
    { label: "Active in 7 days", value: t?.activeUsers7d, icon: Activity },
    { label: "Communities", value: t?.communities, icon: UsersRound },
    { label: "Posts", value: t?.posts, icon: FileText },
    { label: "Messages", value: t?.messages, icon: MessageSquare },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="admin-totals">
        {tiles.map((x) => (
          <Card key={x.label} className="p-4">
            <x.icon className="size-4 text-subtle-foreground" aria-hidden />
            <p className="mt-2 text-2xl font-bold tabular-nums">{x.value === undefined ? <Skeleton className="h-7 w-16" /> : compactNumber(x.value)}</p>
            <p className="text-xs text-subtle-foreground">{x.label}</p>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Daily activity</h2>
          <Segmented aria-label="Range" value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        </div>
        {q.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {SERIES.map((s) => (
              <SeriesChart key={s.value} data={q.data.daily} series={s.value} label={s.label} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const TONE: Record<Series, string> = { signups: "text-primary", posts: "text-success", messages: "text-reaction-warm" };

export function SeriesChart({ data, series, label }: { data: AdminStats["daily"]; series: Series; label: string }) {
  const id = useId();
  const values = data.map((d) => d[series]);
  const total = values.reduce((a, b) => a + b, 0);
  const W = 320;
  const H = 96;
  const { line, area, max } = sparklinePath(values, W, H, 4);
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  return (
    <figure className="rounded-lg border border-border p-3">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-lg font-bold tabular-nums">{compactNumber(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={cn("mt-2 h-24 w-full", TONE[series])} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="none">
        <title id={`${id}-t`}>{label} per day</title>
        <desc id={`${id}-d`}>
          {total} in total from {first ?? "the start"} to {last ?? "today"}, peak {max} in a day.
        </desc>
        <line x1="0" x2={W} y1={H - 4} y2={H - 4} className="stroke-border" strokeWidth="1" />
        {area ? <path d={area} fill="currentColor" fillOpacity="0.12" /> : null}
        {line ? <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="mt-1 flex justify-between text-2xs text-subtle-foreground" aria-hidden>
        <span>{first?.slice(5)}</span>
        <span>peak {compactNumber(max)}</span>
        <span>{last?.slice(5)}</span>
      </div>
      <table className="sr-only">
        <caption>{label} per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d[series]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
