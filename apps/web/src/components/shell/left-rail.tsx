"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Shield } from "lucide-react";
import { Avatar, CountBadge, Skeleton, cn } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { useChatUnread, useMyCommunities } from "@/lib/hooks/queries";
import { CommunityAvatar } from "@/components/common/user-bits";
import { PRIMARY_NAV, SECONDARY_NAV } from "./nav-items";
import { useNavBadges } from "./header";

function RailLink({ href, icon, label, active, count, testId }: { href: string; icon: React.ReactNode; label: string; active?: boolean; count?: number; testId?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "flex h-11 items-center gap-3 rounded-md px-2 text-[15px] font-medium transition-colors",
        active ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <CountBadge count={count} className="ring-0" /> : null}
    </Link>
  );
}

export function LeftRail() {
  const pathname = usePathname() ?? "/";
  const { user, isStaff, status } = useAuth();
  const communities = useMyCommunities();
  const chatUnread = useChatUnread().data ?? {};
  const badges = useNavBadges();
  if (status !== "signed-in" || !user) return null;
  const mods = (communities.data ?? []).some((c) => c.viewer.canModerate);
  return (
    <nav aria-label="Shortcuts" className="space-y-1 pb-8">
      <Link href={`/u/${encodeURIComponent(user.username)}`} className="flex h-12 items-center gap-3 rounded-md px-2 hover:bg-muted">
        <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size="sm" />
        <span className="truncate text-[15px] font-semibold">{user.displayName}</span>
      </Link>
      {PRIMARY_NAV.map((n) => (
        <RailLink
          key={n.href}
          href={n.href}
          label={n.href === "/" ? "Feed" : n.label}
          active={n.match(pathname)}
          count={badges[n.href]}
          icon={<n.icon className="size-[22px] text-primary" />}
        />
      ))}
      {SECONDARY_NAV.map((n) => (
        <RailLink key={n.href} href={n.href} label={n.label} active={pathname.startsWith(n.href)} icon={<n.icon className="size-[22px] text-primary" />} />
      ))}
      {isStaff || mods ? <RailLink href="/moderation" label="Moderation desk" active={pathname.startsWith("/moderation")} icon={<Shield className="size-[22px] text-primary" />} /> : null}

      <div className="mx-2 my-3 h-px bg-border" />
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-[15px] font-semibold text-muted-foreground">Your communities</h2>
        <Link href="/communities/new" aria-label="Create a community" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="size-4" />
        </Link>
      </div>
      {communities.isPending ? (
        Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-3 px-2">
            <Skeleton className="size-8 rounded-[22%]" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))
      ) : (communities.data ?? []).length === 0 ? (
        <p className="px-2 text-sm text-subtle-foreground">
          You have not joined any communities yet.{" "}
          <Link href="/communities" className="font-medium text-link hover:underline">
            Discover some
          </Link>
        </p>
      ) : (
        (communities.data ?? []).slice(0, 12).map((c) => (
          <RailLink
            key={c.id}
            href={`/c/${encodeURIComponent(c.slug)}`}
            label={c.name}
            active={pathname === `/c/${c.slug}` || pathname.startsWith(`/c/${c.slug}/`)}
            count={chatUnread[c.id]}
            icon={<CommunityAvatar community={c} size="sm" />}
          />
        ))
      )}
    </nav>
  );
}
