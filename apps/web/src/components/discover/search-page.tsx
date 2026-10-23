"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareText, Search, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from "@open-social/ui";
import type { Community, Question, SearchResults } from "@open-social/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { CommunityAvatar, PersonRow } from "@/components/common/user-bits";
import { PostCard } from "@/components/posts/post-card";

export const SEARCH_TABS = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "communities", label: "Communities" },
  { value: "posts", label: "Posts" },
  { value: "questions", label: "Questions" },
] as const;
export type SearchType = (typeof SEARCH_TABS)[number]["value"];

export function parseSearchType(v: string | null): SearchType {
  return SEARCH_TABS.some((t) => t.value === v) ? (v as SearchType) : "all";
}

export function isEmptyResults(r: SearchResults | undefined): boolean {
  return !r || (!r.people.length && !r.communities.length && !r.posts.length && !r.questions.length);
}

export function CommunityRow({ c }: { c: Community }) {
  return (
    <Link href={`/c/${encodeURIComponent(c.slug)}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted" data-testid="search-community">
      <CommunityAvatar community={c} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{c.name}</span>
        <span className="block truncate text-sm text-subtle-foreground">
          {c.visibility === "PRIVATE" ? "Private" : "Public"}, {compactNumber(c.memberCount)} {c.memberCount === 1 ? "member" : "members"}
          {c.description ? `. ${c.description}` : ""}
        </span>
      </span>
      {c.viewer.isMember ? <span className="text-xs font-semibold text-success">Joined</span> : null}
    </Link>
  );
}

export function QuestionRow({ q }: { q: Question }) {
  return (
    <Link href={`/questions/${q.id}`} className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted" data-testid="search-question">
      <span className="mt-0.5 flex w-12 shrink-0 flex-col items-center rounded-md border border-border py-1 text-xs">
        <span className="font-bold">{q.answerCount}</span>
        <span className="text-subtle-foreground">{q.answerCount === 1 ? "answer" : "answers"}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          {q.acceptedAnswerId ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Answered" /> : null}
          <span className="line-clamp-2">{q.title}</span>
        </span>
        <span className="block truncate text-sm text-subtle-foreground">
          {q.author.displayName}, {q.score} votes{q.tags.length ? `, #${q.tags.join(" #")}` : ""}
        </span>
      </span>
    </Link>
  );
}

function Section({ title, children, more }: { title: string; children: React.ReactNode; more?: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {more ? (
          <button type="button" onClick={more} className="text-sm font-medium text-link hover:underline">
            See all
          </button>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function SearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = (params.get("q") ?? "").trim();
  const type = parseSearchType(params.get("type"));
  const setType = (t: string) => router.replace(`${pathname}?q=${encodeURIComponent(q)}${t === "all" ? "" : `&type=${t}`}`, { scroll: false });
  const enabled = q.length >= 2;
  const res = useQuery({ queryKey: qk.search(q, type), queryFn: ({ signal }) => api().discover.search(q, type, signal), enabled });

  return (
    <div className="space-y-4" data-testid="search-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{q ? <>Results for &ldquo;{q}&rdquo;</> : "Search"}</h1>
      </div>
      <Tabs value={type} onValueChange={setType}>
        <TabsList aria-label="Result types">
          {SEARCH_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`search-tab-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!enabled ? (
        <Card>
          <EmptyState icon={<Search />} title="Search the network" description="Type at least two characters in the search box to find people, communities, posts and questions." />
        </Card>
      ) : res.isPending ? (
        <Card className="space-y-3 p-4" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </Card>
      ) : res.isError ? (
        <ErrorState error={res.error} onRetry={() => void res.refetch()} />
      ) : isEmptyResults(res.data) ? (
        <Card>
          <EmptyState icon={<Search />} title="No results" description="Try different words, or check the spelling." />
        </Card>
      ) : (
        <Results r={res.data} type={type} onMore={setType} />
      )}
    </div>
  );
}

function Results({ r, type, onMore }: { r: SearchResults; type: SearchType; onMore: (t: SearchType) => void }) {
  const all = type === "all";
  const cap = <T,>(xs: T[]) => (all ? xs.slice(0, 5) : xs);
  return (
    <div className="space-y-4">
      {r.people.length && (all || type === "people") ? (
        <Section title="People" more={all && r.people.length > 5 ? () => onMore("people") : undefined}>
          <div className="divide-y divide-border">
            {cap(r.people).map((p) => (
              <PersonRow key={p.id} user={p} />
            ))}
          </div>
        </Section>
      ) : null}
      {r.communities.length && (all || type === "communities") ? (
        <Section title="Communities" more={all && r.communities.length > 5 ? () => onMore("communities") : undefined}>
          {cap(r.communities).map((c) => (
            <CommunityRow key={c.id} c={c} />
          ))}
        </Section>
      ) : null}
      {r.questions.length && (all || type === "questions") ? (
        <Section title="Questions" more={all && r.questions.length > 5 ? () => onMore("questions") : undefined}>
          {cap(r.questions).map((q) => (
            <QuestionRow key={q.id} q={q} />
          ))}
        </Section>
      ) : null}
      {r.posts.length && (all || type === "posts") ? (
        <div className="space-y-4">
          {all ? <h2 className="flex items-center gap-2 px-1 text-lg font-semibold"><MessageSquareText className="size-5 text-subtle-foreground" /> Posts</h2> : null}
          {cap(r.posts).map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
          {all && r.posts.length > 5 ? (
            <button type="button" onClick={() => onMore("posts")} className="w-full rounded-lg border border-border bg-card py-2 text-sm font-semibold hover:bg-muted">
              See all posts
            </button>
          ) : null}
        </div>
      ) : null}
      {!all && type === "people" && !r.people.length ? <EmptyNote icon={<Users />} /> : null}
    </div>
  );
}

function EmptyNote({ icon }: { icon: React.ReactNode }) {
  return (
    <Card>
      <EmptyState icon={icon} title="No matches in this section" />
    </Card>
  );
}
