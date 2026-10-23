"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommunityNotificationSettings } from "@open-social/api-client";
import { Bell, Check, ChevronDown, Clock, LogOut, Plus } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
  type ButtonProps,
} from "@open-social/ui";
import type { Community } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { JOIN_LABEL, joinState } from "@/lib/communities";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

/** Updates the community in every cache that holds it (detail by slug, discover lists). */
export function usePatchCommunity() {
  const qc = useQueryClient();
  return (c: Pick<Community, "id" | "slug">, fn: (c: Community) => Community) => {
    qc.setQueryData<Community>(qk.community(c.slug), (old) => (old ? fn(old) : old));
    qc.setQueriesData({ queryKey: qk.communitiesAll }, (data: unknown) => {
      const d = data as { pages?: { items: Community[] }[] } | Community[] | undefined;
      if (!d) return d;
      if (Array.isArray(d)) return d.map((x) => (x.id === c.id ? fn(x) : x));
      if (d.pages) return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === c.id ? fn(x) : x)) })) };
      return d;
    });
  };
}

export function JoinButton({
  community,
  size = "md",
  inviteCode,
  block,
  onJoined,
}: {
  community: Community;
  size?: ButtonProps["size"];
  inviteCode?: string;
  block?: boolean;
  onJoined?: (status: "ACTIVE" | "PENDING") => void;
}) {
  const { status } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const patch = usePatchCommunity();
  const state = joinState(community.viewer, community.joinPolicy);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const join = useMutation({
    mutationFn: () => api().communities.join(community.id, inviteCode),
    meta: { silent: true },
    onSuccess: (r) => {
      patch(community, (c) => ({
        ...c,
        memberCount: r.status === "ACTIVE" ? c.memberCount + 1 : c.memberCount,
        viewer: { ...c.viewer, status: r.status, role: r.status === "ACTIVE" ? "MEMBER" : c.viewer.role, isMember: r.status === "ACTIVE", canPost: r.status === "ACTIVE" && c.allowMemberPosts },
      }));
      toast.success(r.status === "ACTIVE" ? { title: `You joined ${community.name}` } : { title: "Request sent", description: "A moderator will review it." });
      void qc.invalidateQueries({ queryKey: qk.myCommunities });
      if (r.status === "ACTIVE") void qc.invalidateQueries({ queryKey: qk.community(community.slug) });
      onJoined?.(r.status);
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  const cancel = useMutation({
    mutationFn: () => api().communities.cancelRequest(community.id),
    onSuccess: () => patch(community, (c) => ({ ...c, viewer: { ...c.viewer, status: null } })),
  });
  const leave = useMutation({
    mutationFn: () => api().communities.leave(community.id),
    meta: { silent: true },
    onSuccess: () => {
      patch(community, (c) => ({ ...c, memberCount: Math.max(0, c.memberCount - 1), viewer: { role: null, status: null, isMember: false, canPost: false, canModerate: false } }));
      void qc.invalidateQueries({ queryKey: qk.myCommunities });
      void qc.invalidateQueries({ queryKey: qk.community(community.slug) });
      toast.info({ title: `You left ${community.name}` });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });

  if (status === "signed-out") {
    return (
      <Button size={size} block={block} data-testid="join-button" onClick={() => router.push(`/login?next=${encodeURIComponent(`/c/${community.slug}`)}`)}>
        <Plus /> Join
      </Button>
    );
  }

  if (state === "joined" || state === "owner") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size={size} block={block} data-testid="join-button" data-state-join={state}>
              <Check /> {JOIN_LABEL[state]} <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <NotificationSettingsItems community={community} />
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmLeave(true)} data-testid="leave-community">
              <LogOut /> Leave community
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDialog
          open={confirmLeave}
          onOpenChange={setConfirmLeave}
          title={`Leave ${community.name}?`}
          description={
            state === "owner"
              ? "You own this community. Transfer ownership in settings before you leave."
              : community.visibility === "PRIVATE"
                ? "You will lose access to its posts and chat. You may need approval to rejoin."
                : "You will stop seeing its posts in your feed."
          }
          confirmLabel="Leave"
          destructive
          onConfirm={() => leave.mutateAsync()}
        />
      </>
    );
  }

  if (state === "requested") {
    return (
      <Button variant="secondary" size={size} block={block} data-testid="join-button" data-state-join={state} loading={cancel.isPending} onClick={() => cancel.mutate()} title="Cancel your request">
        <Clock /> Requested
      </Button>
    );
  }

  const disabled = state === "banned" || state === "suspended" || (state === "invite-only" && !inviteCode);
  return (
    <Button size={size} block={block} data-testid="join-button" data-state-join={state} disabled={disabled} loading={join.isPending} onClick={() => join.mutate()}>
      {disabled ? null : <Plus />}
      {state === "invite-only" && inviteCode ? "Join with invite" : JOIN_LABEL[state]}
    </Button>
  );
}

function NotificationSettingsItems({ community }: { community: Community }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.communityNotifications(community.id), queryFn: () => api().communities.notificationSettings(community.id), meta: { silent: true } });
  const update = useMutation({
    mutationFn: (b: Partial<CommunityNotificationSettings>) => api().communities.updateNotificationSettings(community.id, b),
    onMutate: (b) => qc.setQueryData<CommunityNotificationSettings>(qk.communityNotifications(community.id), (o) => (o ? { ...o, ...b } : o)),
    onSuccess: (s) => qc.setQueryData(qk.communityNotifications(community.id), s),
  });
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <Bell className="size-3" /> Post notifications
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={q.data?.posts ?? ""} onValueChange={(v) => update.mutate({ posts: v as CommunityNotificationSettings["posts"] })}>
        <DropdownMenuRadioItem value="ALL">All posts</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="HIGHLIGHTS">Highlights only</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="OFF">Off</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {q.data ? (
        <>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); update.mutate({ events: !q.data!.events }); }}>
            {q.data.events ? <Check /> : <span className="size-4" />} Event notifications
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); update.mutate({ chat: !q.data!.chat }); }}>
            {q.data.chat ? <Check /> : <span className="size-4" />} Chat notifications
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}
