"use client";

import Link from "next/link";
import { Globe2, Lock, Users } from "lucide-react";
import { Badge, Card, Skeleton } from "@open-social/ui";
import type { Community } from "@open-social/types";
import { compactNumber } from "@/lib/time";
import { CommunityAvatar } from "@/components/common/user-bits";
import { JoinButton } from "./join-button";

export function VisibilityBadge({ visibility }: { visibility: Community["visibility"] }) {
  return visibility === "PRIVATE" ? (
    <Badge tone="neutral">
      <Lock /> Private
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Globe2 /> Public
    </Badge>
  );
}

/** Cover band: the uploaded cover, or a flat tint of the community colour. */
export function CoverImage({ community, className }: { community: Pick<Community, "coverUrl" | "color">; className?: string }) {
  return community.coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={community.coverUrl} alt="" className={`object-cover ${className ?? ""}`} />
  ) : (
    <div className={className} style={{ backgroundColor: community.color ?? "hsl(var(--primary))", opacity: 0.85 }} aria-hidden />
  );
}

export function CommunityCard({ community }: { community: Community }) {
  return (
    <Card className="flex flex-col overflow-hidden" data-testid="community-card">
      <Link href={`/c/${encodeURIComponent(community.slug)}`} className="relative block" tabIndex={-1} aria-hidden>
        <CoverImage community={community} className="h-24 w-full" />
      </Link>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <CommunityAvatar community={community} size="lg" className="-mt-7 rounded-[22%] ring-4 ring-card" />
        <Link href={`/c/${encodeURIComponent(community.slug)}`} className="mt-2 line-clamp-1 text-base font-semibold hover:underline">
          {community.name}
        </Link>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-subtle-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> {compactNumber(community.memberCount)} {community.memberCount === 1 ? "member" : "members"}
          </span>
          <VisibilityBadge visibility={community.visibility} />
        </p>
        <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">{community.description || "No description yet."}</p>
        <div className="mt-auto pt-3">
          <JoinButton community={community} size="sm" block />
        </div>
      </div>
    </Card>
  );
}

export function CommunityCardSkeleton() {
  return (
    <Card className="overflow-hidden" aria-hidden>
      <Skeleton className="h-24 rounded-none" />
      <div className="space-y-2 px-4 pb-4">
        <Skeleton className="-mt-7 size-12 rounded-[22%]" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </Card>
  );
}
