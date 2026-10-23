"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { CountBadge, cn } from "@open-social/ui";
import { useNotificationCount } from "@/lib/hooks/queries";
import { useAuth } from "@/lib/auth";
import { PRIMARY_NAV } from "./nav-items";
import { useNavBadges } from "./header";

/** Mobile tab bar (below md). */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const { status } = useAuth();
  const badges = useNavBadges();
  const notif = useNotificationCount().data?.unread ?? 0;
  if (status !== "signed-in") return null;
  const items = [...PRIMARY_NAV, { href: "/notifications", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/notifications") }];
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = item.match(pathname);
          const count = item.href === "/notifications" ? notif : (badges[item.href] ?? 0);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-primary-soft-foreground" : "text-muted-foreground")}
              >
                <item.icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
                {item.label}
                <CountBadge count={count} className="absolute left-1/2 top-1.5 ml-1.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
