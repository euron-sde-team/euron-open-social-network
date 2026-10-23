"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Hash, Trophy } from "lucide-react";
import { Avatar, Skeleton } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useContacts } from "@/lib/hooks/queries";
import { useOpenConversation } from "@/lib/hooks/use-open-conversation";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";

function RailSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-border pb-3 pt-1 last:border-b-0">
      <div className="flex items-center justify-between px-2 py-2">
        <h2 className="text-[15px] font-semibold text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function RowSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-1 px-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  );
}

function Contacts() {
  const { data, isPending } = useContacts();
  const open = useOpenConversation();
  return (
    <RailSection title="Contacts">
      {isPending ? (
        <RowSkeleton n={5} />
      ) : !data?.length ? (
        <p className="px-2 text-sm text-subtle-foreground">People you can message show up here.</p>
      ) : (
        <ul data-testid="contacts-list">
          {data.slice(0, 20).map((c) => (
            <li key={c.user.id}>
              <button
                type="button"
                onClick={() => open.mutate(c.user)}
                className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-muted"
                aria-label={`Message ${c.user.displayName}${c.online ? ", online" : ""}`}
              >
                <Avatar name={c.user.displayName} seed={c.user.id} src={c.user.avatarUrl} size="sm" online={c.online} />
                <span className="truncate text-sm font-medium">{c.user.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </RailSection>
  );
}

function UpcomingEvents() {
  const { data, isPending } = useQuery({
    queryKey: [...qk.events("upcoming"), "rail"],
    queryFn: async () => (await api().events.list({ scope: "upcoming", limit: 3 })).items,
    staleTime: 120_000,
    meta: { silent: true },
  });
  if (!isPending && !data?.length) return null;
  return (
    <RailSection
      title="Upcoming events"
      action={
        <Link href="/events" className="text-sm font-medium text-link hover:underline">
          See all
        </Link>
      }
    >
      {isPending ? (
        <RowSkeleton />
      ) : (
        <ul>
          {data!.map((e) => {
            const d = new Date(e.startsAt);
            return (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-card leading-none">
                    <span className="text-[10px] font-bold uppercase text-danger">{d.toLocaleString(undefined, { month: "short" })}</span>
                    <span className="text-base font-bold">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{e.title}</span>
                    <span className="block truncate text-xs text-subtle-foreground">
                      {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      {e.goingCount ? `, ${compactNumber(e.goingCount)} going` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

function TrendingTags() {
  const { data, isPending } = useQuery({ queryKey: qk.trending, queryFn: () => api().discover.trendingTags(), staleTime: 300_000, meta: { silent: true } });
  if (!isPending && !data?.length) return null;
  return (
    <RailSection title="Trending">
      {isPending ? (
        <RowSkeleton />
      ) : (
        <ul className="px-1">
          {data!.slice(0, 6).map((t) => (
            <li key={t.tag}>
              <Link href={`/tags/${encodeURIComponent(t.tag)}`} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted">
                <Hash className="size-4 text-subtle-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.tag}</span>
                <span className="text-xs text-subtle-foreground">{compactNumber(t.postCount)} posts</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailSection>
  );
}

function TopContributors() {
  const { data, isPending } = useQuery({ queryKey: qk.leaderboard("week"), queryFn: () => api().discover.leaderboard("week"), staleTime: 300_000, meta: { silent: true } });
  if (!isPending && !data?.length) return null;
  return (
    <RailSection
      title="Top contributors"
      action={
        <Link href="/leaderboard" className="text-sm font-medium text-link hover:underline">
          Leaderboard
        </Link>
      }
    >
      {isPending ? (
        <RowSkeleton />
      ) : (
        <ol>
          {data!.slice(0, 5).map((e) => (
            <li key={e.user.id}>
              <Link href={`/u/${encodeURIComponent(e.user.username)}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                <span className="w-4 text-center text-xs font-bold text-subtle-foreground">{e.rank}</span>
                <Avatar name={e.user.displayName} seed={e.user.id} src={e.user.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.user.displayName}</span>
                <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
                  <Trophy className="size-3" /> {compactNumber(e.reputation)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </RailSection>
  );
}

export function RightRail() {
  const { status } = useAuth();
  return (
    <aside aria-label="Sidebar" className="space-y-1 pb-8">
      {status === "signed-in" ? <Contacts /> : null}
      <UpcomingEvents />
      <TrendingTags />
      <TopContributors />
    </aside>
  );
}
