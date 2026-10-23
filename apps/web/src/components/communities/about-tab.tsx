"use client";

import Link from "next/link";
import { CalendarDays, DoorOpen, Globe2, Lock, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@open-social/ui";
import type { Community } from "@open-social/types";
import { JOIN_POLICY_COPY } from "@/lib/communities";

const created = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(iso));

export function AboutCard({ community: c }: { community: Community }) {
  return (
    <Card data-testid="community-about">
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {c.description ? <p className="whitespace-pre-wrap text-foreground">{c.description}</p> : <p className="text-subtle-foreground">No description yet.</p>}
        <ul className="space-y-2.5 text-muted-foreground">
          <li className="flex gap-2.5">
            {c.visibility === "PRIVATE" ? <Lock className="mt-0.5 size-4 shrink-0" /> : <Globe2 className="mt-0.5 size-4 shrink-0" />}
            <span>
              <span className="block font-semibold text-foreground">{c.visibility === "PRIVATE" ? "Private" : "Public"}</span>
              {c.visibility === "PRIVATE" ? "Only members can see who is in it and what they post." : "Anyone can see who is in it and what they post."}
            </span>
          </li>
          <li className="flex gap-2.5">
            <DoorOpen className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-semibold text-foreground">{JOIN_POLICY_COPY[c.joinPolicy].label}</span>
              {JOIN_POLICY_COPY[c.joinPolicy].hint}
            </span>
          </li>
          <li className="flex gap-2.5">
            <CalendarDays className="mt-0.5 size-4 shrink-0" />
            <span>
              Created {created(c.createdAt)}
              {c.createdBy ? (
                <>
                  {" "}
                  by{" "}
                  <Link href={`/u/${encodeURIComponent(c.createdBy.username)}`} className="font-semibold text-foreground hover:underline">
                    {c.createdBy.displayName}
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function RulesCard({ community: c, compact }: { community: Community; compact?: boolean }) {
  if (!c.rules.length) return compact ? null : (
    <Card>
      <EmptyState compact icon={<ScrollText />} title="No rules yet" description="Moderators have not added any rules." />
    </Card>
  );
  return (
    <Card data-testid="community-rules">
      <CardHeader>
        <CardTitle>Community rules</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {c.rules.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{r.title}</p>
                {r.body && !compact ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{r.body}</p> : null}
                {r.body && compact ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{r.body}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function AboutTab({ community }: { community: Community }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <AboutCard community={community} />
      <RulesCard community={community} />
    </div>
  );
}
