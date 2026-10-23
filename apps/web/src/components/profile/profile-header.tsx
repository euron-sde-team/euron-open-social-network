"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, MessageCircle, MoreHorizontal, Pencil, ShieldCheck } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  toast,
} from "@open-social/ui";
import type { Profile } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dmDenialCopy } from "@/lib/errors";
import { useOpenConversation } from "@/lib/hooks/use-open-conversation";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { RoleMark } from "@/components/common/user-bits";
import { FollowButton } from "./follow-button";

export function useBlockActions(profile: Profile) {
  const qc = useQueryClient();
  const settle = (refetchProfile: boolean) => {
    // After a block the API answers 404 for this profile (blocks hide profiles both
    // ways), so refetching would swap the "You blocked ..." notice for "not available".
    if (refetchProfile) void qc.invalidateQueries({ queryKey: qk.profile(profile.username) });
    void qc.invalidateQueries({ queryKey: qk.userPosts(profile.username) });
    void qc.invalidateQueries({ queryKey: qk.blocks });
    void qc.invalidateQueries({ queryKey: qk.contacts });
    void qc.invalidateQueries({ queryKey: qk.feedAll });
  };
  const block = useMutation({
    mutationFn: () => api().users.block(profile.id),
    onSuccess: () => {
      qc.setQueryData<Profile>(qk.profile(profile.username), (p) => (p ? { ...p, viewer: { ...p.viewer, blocked: true, following: false, followedBy: false, canMessage: false } } : p));
      toast.success({ title: `You blocked ${profile.displayName}`, description: "They can no longer see your profile or message you." });
      settle(false);
    },
  });
  const unblock = useMutation({
    mutationFn: () => api().users.unblock(profile.id),
    onSuccess: () => {
      qc.setQueryData<Profile>(qk.profile(profile.username), (p) => (p ? { ...p, viewer: { ...p.viewer, blocked: false } } : p));
      toast.success({ title: `You unblocked ${profile.displayName}` });
      settle(true);
    },
  });
  return { block, unblock };
}

/** The follow / message / more row. Exported separately for tests. */
export function ProfileActions({ profile }: { profile: Profile }) {
  const { status } = useAuth();
  const open = useOpenConversation();
  const { block, unblock } = useBlockActions(profile);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [report, setReport] = useState(false);
  const v = profile.viewer;

  if (v.isSelf) {
    return (
      <Button asChild variant="secondary" data-testid="edit-profile">
        <Link href="/settings">
          <Pencil /> Edit profile
        </Link>
      </Button>
    );
  }
  if (status !== "signed-in") {
    return (
      <Button asChild>
        <Link href="/login">Sign in to follow</Link>
      </Button>
    );
  }

  const deniedCopy = v.canMessage ? null : dmDenialCopy(v.messageBlockedReason, profile.displayName);
  const messageBtn = (
    <Button
      variant="secondary"
      data-testid="message-button"
      disabled={!v.canMessage}
      loading={open.isPending}
      aria-describedby={deniedCopy ? "message-denied" : undefined}
      onClick={() => open.mutate(profile)}
    >
      <MessageCircle /> Message
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="profile-actions">
      {v.blocked ? (
        <Button variant="outline" onClick={() => setConfirmUnblock(true)} data-testid="unblock-button">
          Unblock
        </Button>
      ) : (
        <>
          <FollowButton userId={profile.id} username={profile.username} following={v.following} />
          {deniedCopy ? (
            <Tooltip content={deniedCopy}>
              {/* A disabled button gets no pointer events; the wrapper carries the tooltip. */}
              <span tabIndex={0} className="inline-flex rounded-md">
                {messageBtn}
              </span>
            </Tooltip>
          ) : (
            messageBtn
          )}
          {deniedCopy ? (
            <span id="message-denied" className="sr-only">
              {deniedCopy}
            </span>
          ) : null}
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More options" variant="muted" data-testid="profile-menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {v.blocked ? (
            <DropdownMenuItem onSelect={() => setConfirmUnblock(true)}>
              <Ban /> Unblock
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem destructive onSelect={() => setConfirmBlock(true)} data-testid="block-user">
              <Ban /> Block {profile.displayName}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setReport(true)} data-testid="report-user">
            <Flag /> Report profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title={`Block ${profile.displayName}?`}
        description="They will not be able to see your profile or posts, message you, or find you in search. Follows between you are removed. They are not told."
        confirmLabel="Block"
        destructive
        testId="block-confirm"
        onConfirm={() => block.mutateAsync()}
      />
      <ConfirmDialog
        open={confirmUnblock}
        onOpenChange={setConfirmUnblock}
        title={`Unblock ${profile.displayName}?`}
        description="They will be able to see your public posts and profile again. Follows are not restored."
        confirmLabel="Unblock"
        onConfirm={() => unblock.mutateAsync()}
      />
      {report ? <ReportDialog open={report} onOpenChange={setReport} targetType="USER" targetId={profile.id} /> : null}
    </div>
  );
}

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="font-bold text-foreground">{compactNumber(value)}</span> <span className="text-muted-foreground">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="hover:underline">
      {body}
    </Link>
  ) : (
    <span>{body}</span>
  );
}

export function ProfileHeader({ profile }: { profile: Profile }) {
  const base = `/u/${encodeURIComponent(profile.username)}`;
  return (
    <section className="overflow-hidden rounded-b-lg border-x border-b border-border bg-card shadow-card sm:rounded-lg sm:border" data-testid="profile-header">
      <div className="relative aspect-[3/1] max-h-[340px] w-full bg-muted">
        {profile.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.coverUrl} alt="" className="size-full object-cover" />
        ) : null}
      </div>
      <div className="px-4 pb-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="-mt-12 shrink-0 sm:-mt-16">
            <Avatar name={profile.displayName} seed={profile.id} src={profile.avatarUrl} size="2xl" className="rounded-full ring-4 ring-card" />
          </div>
          <div className="min-w-0 flex-1 sm:pb-2">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="truncate">{profile.displayName}</span>
              <RoleMark role={profile.role} />
            </h1>
            <p className="text-sm text-subtle-foreground">@{profile.username}</p>
            {profile.headline ? <p className="mt-1 text-[15px] text-muted-foreground">{profile.headline}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="profile-stats">
              <Stat value={profile.postCount} label={profile.postCount === 1 ? "post" : "posts"} />
              <Stat value={profile.followerCount} label={profile.followerCount === 1 ? "follower" : "followers"} href={`${base}/followers`} />
              <Stat value={profile.followingCount} label="following" href={`${base}/following`} />
              <Tooltip content={`${compactNumber(profile.reputation)} reputation`}>
                <span>
                  <Badge tone="primary" size="md">
                    <ShieldCheck /> Level {profile.level}
                  </Badge>
                </span>
              </Tooltip>
              {profile.viewer.followedBy && !profile.viewer.isSelf ? <Badge tone="neutral">Follows you</Badge> : null}
            </div>
          </div>
          <div className="sm:pb-2">
            <ProfileActions profile={profile} />
          </div>
        </div>
      </div>
    </section>
  );
}
