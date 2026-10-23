"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Flag, Link2, Lock, MoreHorizontal, Settings, Users } from "lucide-react";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
} from "@open-social/ui";
import type { Community } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COMMUNITY_TABS, canManageSettings, normaliseTab, type CommunityTab } from "@/lib/communities";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { CommunityChat } from "@/components/chat/community-chat";
import { EventList } from "@/components/events/event-list";
import { ReportDialog } from "@/components/common/report-dialog";
import { ErrorState } from "@/components/common/states";
import { CommunityAvatar } from "@/components/common/user-bits";
import { QaTab } from "@/components/questions/qa-tab";
import { AboutCard, AboutTab } from "./about-tab";
import { CoverImage, VisibilityBadge } from "./community-card";
import { DiscussionTab } from "./discussion-tab";
import { copyText, InviteLinkButton } from "./invite-link";
import { JoinButton } from "./join-button";
import { MediaTab } from "./media-tab";
import { MembersTab } from "./members-tab";

export function CommunityPage({ slug }: { slug: string }) {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <CommunityPageInner slug={slug} />
    </Suspense>
  );
}

function HeaderSkeleton() {
  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto max-w-[1100px] px-4">
        <Skeleton className="h-40 rounded-none rounded-b-lg md:h-56" />
        <div className="flex items-end gap-4 py-4">
          <Skeleton className="-mt-12 size-24 rounded-[22%]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CommunityPageInner({ slug }: { slug: string }) {
  const { isStaff, status } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = normaliseTab(params.get("tab"));
  const q = useQuery({ queryKey: qk.community(slug), queryFn: () => api().communities.get(slug) });

  useEffect(() => {
    if (q.data) document.title = q.data.name;
  }, [q.data]);

  if (q.isPending) return <HeaderSkeleton />;
  if (q.isError)
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const c = q.data;
  const locked = c.visibility === "PRIVATE" && !c.viewer.isMember && !isStaff;
  const tabs = COMMUNITY_TABS.filter((t) => !t.membersOnly || c.viewer.isMember);
  const setTab = (t: CommunityTab) => {
    const sp = new URLSearchParams(params.toString());
    if (t === "discussion") sp.delete("tab");
    else sp.set("tab", t);
    const qs = sp.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <div>
      <CommunityHeader community={c} tab={tab} tabs={locked ? [] : tabs} onTab={setTab} signedIn={status === "signed-in"} />
      <div className="mx-auto max-w-[1100px] px-4 py-4">
        {locked ? (
          <PrivateGate community={c} />
        ) : (
          <TabBody community={c} tab={tab} />
        )}
      </div>
    </div>
  );
}

function CommunityHeader({ community: c, tab, tabs, onTab, signedIn }: { community: Community; tab: CommunityTab; tabs: typeof COMMUNITY_TABS; onTab: (t: CommunityTab) => void; signedIn: boolean }) {
  const [report, setReport] = useState(false);
  return (
    <div className="border-b border-border bg-card shadow-card" data-testid="community-header">
      <div className="mx-auto max-w-[1100px] md:px-4">
        <CoverImage community={c} className="h-36 w-full md:h-60 md:rounded-b-lg" />
        <div className="flex flex-col gap-3 px-4 pb-3 md:flex-row md:items-end md:px-0">
          <CommunityAvatar community={c} size="2xl" className="-mt-14 size-24 rounded-[22%] ring-4 ring-card md:-mt-12 md:size-32" />
          <div className="min-w-0 flex-1 md:pb-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-[28px]" data-testid="community-name">
              {c.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <VisibilityBadge visibility={c.visibility} />
              <span className="inline-flex items-center gap-1">
                <Users className="size-4" /> {compactNumber(c.memberCount)} {c.memberCount === 1 ? "member" : "members"}
              </span>
              <span aria-hidden>.</span>
              <span>{compactNumber(c.postCount)} posts</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:pb-1">
            <JoinButton community={c} />
            {c.viewer.canModerate ? <InviteLinkButton community={c} /> : null}
            {canManageSettings(c) ? (
              <Button asChild variant="secondary" data-testid="community-settings-link">
                <Link href={`/c/${encodeURIComponent(c.slug)}/settings`}>
                  <Settings /> Settings
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More options" variant="muted">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => void copyText(`${window.location.origin}/c/${c.slug}`, "Link copied")}>
                  <Link2 /> Copy link
                </DropdownMenuItem>
                {signedIn && !c.viewer.canModerate ? (
                  <DropdownMenuItem onSelect={() => setReport(true)}>
                    <Flag /> Report community
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {tabs.length ? (
          <div role="tablist" aria-label="Community sections" className="flex gap-1 overflow-x-auto border-t border-border px-2 no-scrollbar md:px-0">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                data-testid={`community-tab-${t.value}`}
                onClick={() => onTab(t.value)}
                className={cn(
                  "relative h-12 shrink-0 rounded-md px-4 text-[15px] font-semibold transition-colors",
                  tab === t.value ? "text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
                {tab === t.value ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-primary" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="COMMUNITY" targetId={c.id} /> : null}
    </div>
  );
}

function PrivateGate({ community }: { community: Community }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[1fr_300px]" data-testid="private-gate">
      <Card>
        <EmptyState
          icon={<Lock />}
          title="This community is private"
          description={
            community.viewer.status === "PENDING"
              ? "Your request to join is waiting for a moderator. You will be notified when it is approved."
              : "Only members can see its posts, members and chat. Ask to join to take part."
          }
          action={<JoinButton community={community} />}
        />
      </Card>
      <AboutCard community={community} />
    </div>
  );
}

function TabBody({ community: c, tab }: { community: Community; tab: CommunityTab }) {
  switch (tab) {
    case "chat":
      return c.viewer.isMember ? (
        <CommunityChat community={c} />
      ) : (
        <Card>
          <EmptyState icon={<Lock />} title="Chat is for members" description="Join the community to chat with its members." action={<JoinButton community={c} />} />
        </Card>
      );
    case "qa":
      return <QaTab community={c} />;
    case "events":
      return (
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Upcoming events</h2>
            {c.viewer.isMember ? (
              <Button asChild size="sm" data-testid="community-create-event">
                <Link href={`/events/new?communityId=${encodeURIComponent(c.id)}`}>
                  <CalendarPlus /> Create event
                </Link>
              </Button>
            ) : null}
          </div>
          <EventList communityId={c.id} scope="upcoming" emptyText="No upcoming events in this community." />
        </div>
      );
    case "members":
      return <MembersTab community={c} />;
    case "media":
      return <MediaTab community={c} />;
    case "about":
      return <AboutTab community={c} />;
    default:
      return <DiscussionTab community={c} />;
  }
}
