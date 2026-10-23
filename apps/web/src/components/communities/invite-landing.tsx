"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card, Skeleton } from "@open-social/ui";
import { api } from "@/lib/api";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { CommunityAvatar } from "@/components/common/user-bits";
import { CoverImage, VisibilityBadge } from "./community-card";
import { JoinButton } from "./join-button";

export function InviteLanding({ code }: { code: string }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ["invite", code], queryFn: () => api().communities.invite(code) });
  const c = q.data?.community;
  useEffect(() => {
    if (c?.viewer.isMember) router.replace(`/c/${encodeURIComponent(c.slug)}`);
  }, [c, router]);
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { community, invite } = q.data;
  const expired = invite.expiresAt ? new Date(invite.expiresAt).getTime() < Date.now() : false;
  return (
    <Card className="overflow-hidden text-center" data-testid="invite-landing">
      <CoverImage community={community} className="h-28 w-full" />
      <div className="px-6 pb-6">
        <CommunityAvatar community={community} size="xl" className="-mt-10 rounded-[22%] ring-4 ring-card" />
        <p className="mt-2 text-sm text-muted-foreground">You have been invited to join</p>
        <h1 className="text-2xl font-bold">{community.name}</h1>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm text-subtle-foreground">
          <Users className="size-4" /> {compactNumber(community.memberCount)} members <VisibilityBadge visibility={community.visibility} />
        </p>
        {community.description ? <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{community.description}</p> : null}
        <div className="mx-auto mt-5 max-w-xs">
          {expired ? <p className="text-sm font-medium text-danger">This invite has expired. Ask for a new link.</p> : <JoinButton community={community} inviteCode={code} block size="lg" onJoined={() => router.push(`/c/${encodeURIComponent(community.slug)}`)} />}
        </div>
      </div>
    </Card>
  );
}
