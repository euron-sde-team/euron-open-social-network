"use client";

import Link from "next/link";
import { LogOut, Monitor, Moon, Settings, Shield, Sun, UserRound, Wrench } from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-social/ui";
import { useAuth, useMe } from "@/lib/auth";
import { useMyCommunities } from "@/lib/hooks/queries";
import { useTheme, type ThemePref } from "@/lib/stores/theme";

export function AvatarMenu() {
  const me = useMe();
  const { logout, isStaff, isAdmin } = useAuth();
  const { pref, setPref } = useTheme();
  const communities = useMyCommunities().data ?? [];
  const modsSomething = communities.some((c) => c.viewer.canModerate);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" data-testid="avatar-menu" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuItem asChild>
          <Link href={`/u/${encodeURIComponent(me.username)}`} className="py-2.5">
            <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{me.displayName}</span>
              <span className="block truncate text-xs text-subtle-foreground">See your profile</span>
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings and privacy
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/moderation">
            <UserRound /> Your content reviews
          </Link>
        </DropdownMenuItem>
        {isStaff || modsSomething ? (
          <DropdownMenuItem asChild>
            <Link href="/moderation" data-testid="nav-moderation">
              <Shield /> Moderation desk
            </Link>
          </DropdownMenuItem>
        ) : null}
        {isStaff ? (
          <DropdownMenuItem asChild>
            <Link href="/admin" data-testid="nav-admin">
              <Wrench /> {isAdmin ? "Administration" : "Network overview"}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <DropdownMenuRadioItem value="system" data-testid="theme-system">
            <Monitor /> Match device
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" data-testid="theme-light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" data-testid="theme-dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} data-testid="sign-out">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
