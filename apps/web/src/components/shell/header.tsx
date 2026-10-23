"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Button, CountBadge, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, cn } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { useChatUnread, useDmUnread } from "@/lib/hooks/queries";
import { Wordmark } from "@/components/common/wordmark";
import { AvatarMenu } from "./avatar-menu";
import { NotificationsBell } from "./notifications-bell";
import { PRIMARY_NAV } from "./nav-items";
import { SearchBox } from "./search-box";

export function useNavBadges() {
  const dm = useDmUnread().data;
  const chat = useChatUnread().data;
  const chatTotal = chat ? Object.values(chat).reduce((a, b) => a + b, 0) : 0;
  return { "/messages": (dm?.inbox ?? 0) + (dm?.requests ?? 0), "/communities": chatTotal } as Record<string, number>;
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const { status } = useAuth();
  const badges = useNavBadges();
  const [searchOpen, setSearchOpen] = useState(false);
  const signedIn = status === "signed-in";
  return (
    <header className="sticky top-0 z-50 h-header border-b border-border bg-card/95 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex h-full max-w-[1920px] items-center gap-2 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:basis-[320px] xl:basis-[360px]">
          <Wordmark className="shrink-0" compact={false} />
          <SearchBox className="hidden w-full max-w-[260px] md:block" />
        </div>

        <nav aria-label="Primary" className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {PRIMARY_NAV.map((item) => {
            const active = item.match(pathname);
            const count = badges[item.href] ?? 0;
            return (
              <Tooltip key={item.href} content={item.label} side="bottom">
                <Link
                  href={item.href}
                  aria-label={count ? `${item.label}, ${count} unread` : item.label}
                  aria-current={active ? "page" : undefined}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  className={cn(
                    "relative flex h-[calc(var(--header-height)-8px)] w-[clamp(64px,8vw,112px)] items-center justify-center rounded-md transition-colors",
                    active ? "text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <item.icon className="size-6" strokeWidth={active ? 2.4 : 2} />
                  <CountBadge count={count} className="absolute left-1/2 top-1.5 ml-1" />
                  {active ? <span className="absolute inset-x-2 -bottom-1 h-[3px] rounded-full bg-primary" /> : null}
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex flex-none items-center justify-end gap-2 lg:basis-[320px] xl:basis-[360px]">
          <IconButton label="Search" variant="muted" size="lg" className="md:hidden" onClick={() => setSearchOpen(true)}>
            <Search />
          </IconButton>
          {signedIn ? (
            <>
              <NotificationsBell />
              <AvatarMenu />
            </>
          ) : status === "signed-out" ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Join</Link>
              </Button>
            </>
          ) : (
            <span className="size-10 animate-shimmer rounded-full bg-muted" aria-hidden />
          )}
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-4 translate-y-0 p-4" hideClose>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <SearchBox autoFocus onNavigate={() => setSearchOpen(false)} />
        </DialogContent>
      </Dialog>
    </header>
  );
}
