"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarDays, Globe, ImageOff, Link2, MapPin, Play, Users } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, cn } from "@open-social/ui";
import type { Media, Profile } from "@open-social/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { safeHref } from "@/lib/text";
import { compactNumber } from "@/lib/time";
import { ErrorState, LoadMore, NotFoundState } from "@/components/common/states";
import { CommunityAvatar } from "@/components/common/user-bits";
import { Lightbox } from "@/components/media/lightbox";
import { PostFeed } from "@/components/posts/post-feed";
import { ProfileHeader, useBlockActions } from "./profile-header";

export const PROFILE_TABS = [
  { value: "posts", label: "Posts" },
  { value: "about", label: "About" },
  { value: "communities", label: "Communities" },
  { value: "media", label: "Media" },
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

export function parseProfileTab(v: string | null): ProfileTab {
  return PROFILE_TABS.some((t) => t.value === v) ? (v as ProfileTab) : "posts";
}

/** Display form of a website: host plus path, no scheme or trailing slash. */
export function displayUrl(href: string): string {
  try {
    const u = new URL(href);
    return (u.host + (u.pathname === "/" ? "" : u.pathname)).replace(/\/$/, "");
  } catch {
    return href;
  }
}

export function ProfilePage({ username }: { username: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseProfileTab(params.get("tab"));
  const q = useQuery({ queryKey: qk.profile(username), queryFn: () => api().users.profile(username) });

  if (q.isPending) return <ProfileSkeleton />;
  // A background refetch (window focus) of a profile you just blocked is a 404; keep
  // showing the cached "You blocked ..." state, which offers Unblock.
  if (q.isError && !q.data?.viewer.blocked) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const profile = q.data;
  if (!profile) return <ProfileSkeleton />;

  const setTab = (t: ProfileTab) => router.replace(t === "posts" ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  return (
    <div className="space-y-4">
      <ProfileHeader profile={profile} />
      {profile.viewer.blocked ? (
        <BlockedNotice profile={profile} />
      ) : (
        <>
          <nav aria-label="Profile sections" className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card px-2 shadow-card no-scrollbar" role="tablist">
            {PROFILE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                data-testid={`profile-tab-${t.value}`}
                onClick={() => setTab(t.value)}
                className={cn(
                  "-mb-px h-12 shrink-0 border-b-[3px] px-4 text-[15px] font-semibold transition-colors",
                  tab === t.value ? "border-primary text-primary-soft-foreground" : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === "posts" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <div className="space-y-4 lg:sticky lg:top-[calc(var(--header-height)+16px)] lg:self-start">
                <IntroCard profile={profile} />
              </div>
              <PostFeed
                queryKey={qk.userPosts(username)}
                fetchPage={(cursor) => api().users.posts(username, { cursor })}
                empty={
                  <Card>
                    <EmptyState title="No posts yet" description={profile.viewer.isSelf ? "Share something with one of your communities." : `${profile.displayName} has not posted anything you can see.`} />
                  </Card>
                }
              />
            </div>
          ) : tab === "about" ? (
            <AboutCard profile={profile} />
          ) : tab === "communities" ? (
            <CommunitiesGrid username={username} />
          ) : (
            <MediaGrid username={username} />
          )}
        </>
      )}
    </div>
  );
}

function BlockedNotice({ profile }: { profile: Profile }) {
  const { unblock } = useBlockActions(profile);
  return (
    <Card data-testid="blocked-notice">
      <EmptyState
        icon={<Ban />}
        title={`You blocked ${profile.displayName}`}
        description="You will not see each other's posts or messages. Unblock to see their profile again."
        action={
          <Button variant="outline" loading={unblock.isPending} onClick={() => unblock.mutate()}>
            Unblock
          </Button>
        }
      />
    </Card>
  );
}

function Facts({ profile }: { profile: Profile }) {
  const site = profile.website ? safeHref(profile.website) : null;
  return (
    <ul className="space-y-2.5 text-[15px]">
      {profile.location ? (
        <li className="flex items-center gap-3">
          <MapPin className="size-5 shrink-0 text-subtle-foreground" /> Lives in <span className="font-semibold">{profile.location}</span>
        </li>
      ) : null}
      {site ? (
        <li className="flex items-center gap-3">
          <Link2 className="size-5 shrink-0 text-subtle-foreground" />
          <a href={site} target="_blank" rel="noopener noreferrer nofollow ugc" className="truncate font-medium text-link hover:underline">
            {displayUrl(site)}
          </a>
        </li>
      ) : null}
      <li className="flex items-center gap-3">
        <CalendarDays className="size-5 shrink-0 text-subtle-foreground" /> Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
      </li>
      <li className="flex items-center gap-3">
        <Globe className="size-5 shrink-0 text-subtle-foreground" /> Level {profile.level}, {compactNumber(profile.reputation)} reputation
      </li>
    </ul>
  );
}

function IntroCard({ profile }: { profile: Profile }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Intro</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.bio ? <p className="whitespace-pre-wrap text-center text-[15px]">{profile.bio}</p> : null}
        <Facts profile={profile} />
        {profile.viewer.isSelf ? (
          <Button asChild variant="secondary" block>
            <Link href="/settings">Edit details</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AboutCard({ profile }: { profile: Profile }) {
  return (
    <Card data-testid="profile-about">
      <CardHeader>
        <CardTitle className="text-lg">About</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Bio</h3>
          <p className="whitespace-pre-wrap text-[15px]">{profile.bio || (profile.viewer.isSelf ? "Add a short bio in settings so people know who you are." : "No bio yet.")}</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Details</h3>
          <Facts profile={profile} />
        </div>
      </CardContent>
    </Card>
  );
}

function CommunitiesGrid({ username }: { username: string }) {
  const q = useQuery({ queryKey: qk.userCommunities(username), queryFn: () => api().users.communities(username) });
  if (q.isPending)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return (
      <Card>
        <EmptyState icon={<Users />} title="No communities to show" description="Public communities and the ones you share appear here." />
      </Card>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="profile-communities">
      {q.data.map((c) => (
        <Link key={c.id} href={`/c/${encodeURIComponent(c.slug)}`} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-card transition-colors hover:bg-muted">
          <CommunityAvatar community={c} size="lg" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="block text-sm text-subtle-foreground">
              {c.visibility === "PRIVATE" ? "Private" : "Public"}, {compactNumber(c.memberCount)} {c.memberCount === 1 ? "member" : "members"}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function MediaGrid({ username }: { username: string }) {
  const list = usePagedList<Media>({ queryKey: qk.userMedia(username), fetchPage: (cursor) => api().users.media(username, { cursor }) });
  const [open, setOpen] = useState<number | null>(null);
  const images = list.items.filter((m) => m.kind === "IMAGE");
  if (list.isPending)
    return (
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-none" />
        ))}
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.items.length)
    return (
      <Card>
        <EmptyState icon={<ImageOff />} title="No photos or videos yet" />
      </Card>
    );
  return (
    <Card className="p-2" data-testid="profile-media">
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-md">
        {list.items
          .filter((m) => m.kind === "IMAGE" || m.kind === "VIDEO")
          .map((m) =>
            m.kind === "IMAGE" ? (
              <button key={m.id} type="button" onClick={() => setOpen(images.indexOf(m))} className="aspect-square overflow-hidden bg-muted" aria-label={`Open ${m.fileName}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" className="size-full object-cover transition-opacity hover:opacity-90" />
              </button>
            ) : (
              <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="relative aspect-square overflow-hidden bg-black" aria-label={`Play ${m.fileName}`}>
                {m.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbUrl} alt="" className="size-full object-cover opacity-80" />
                ) : null}
                <Play className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white" />
              </a>
            ),
          )}
      </div>
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      {open !== null && images.length ? <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Skeleton className="aspect-[3/1] max-h-[340px] w-full rounded-none" />
        <div className="flex items-end gap-4 px-6 pb-6">
          <Skeleton className="-mt-14 size-32 rounded-full ring-4 ring-card" />
          <div className="flex-1 space-y-2 pb-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </div>
      <Skeleton className="h-12 rounded-lg" />
    </div>
  );
}

export { NotFoundState };
