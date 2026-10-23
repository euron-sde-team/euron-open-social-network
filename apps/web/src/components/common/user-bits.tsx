"use client";

import Link from "next/link";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { Avatar, Tooltip, cn, type AvatarSize } from "@open-social/ui";
import type { Community, UserSummary } from "@open-social/types";

export function UserAvatar({ user, size = "md", online, className, link = true }: { user: Pick<UserSummary, "id" | "displayName" | "avatarUrl" | "username">; size?: AvatarSize; online?: boolean; className?: string; link?: boolean }) {
  const av = <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size={size} online={online} className={className} />;
  if (!link) return av;
  return (
    <Link href={`/u/${encodeURIComponent(user.username)}`} className="shrink-0 rounded-full focus-visible:ring-2" tabIndex={-1} aria-hidden>
      {av}
    </Link>
  );
}

export function RoleMark({ role }: { role: UserSummary["role"] }) {
  if (role === "USER") return null;
  return (
    <Tooltip content={role === "ADMIN" ? "Network admin" : "Network moderator"}>
      <span className="inline-flex text-primary" aria-label={role === "ADMIN" ? "Admin" : "Moderator"}>
        {role === "ADMIN" ? <BadgeCheck className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
      </span>
    </Tooltip>
  );
}

export function UserName({ user, className }: { user: Pick<UserSummary, "username" | "displayName" | "role">; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Link href={`/u/${encodeURIComponent(user.username)}`} className="truncate font-semibold text-foreground hover:underline">
        {user.displayName}
      </Link>
      <RoleMark role={user.role} />
    </span>
  );
}

export function CommunityAvatar({ community, size = "md", className }: { community: Pick<Community, "id" | "name" | "iconUrl">; size?: AvatarSize; className?: string }) {
  return <Avatar name={community.name} seed={community.id} src={community.iconUrl} size={size} shape="square" className={className} />;
}

/** A row with avatar, name and a secondary line (people lists). */
export function PersonRow({ user, meta, action, online }: { user: UserSummary; meta?: React.ReactNode; action?: React.ReactNode; online?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <UserAvatar user={user} online={online} />
      <div className="min-w-0 flex-1">
        <UserName user={user} className="text-sm" />
        <p className="truncate text-xs text-subtle-foreground">{meta ?? user.headline ?? `@${user.username}`}</p>
      </div>
      {action}
    </div>
  );
}
