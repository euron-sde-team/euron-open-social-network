"use client";

import type { ReactNode } from "react";
import { cn } from "@open-social/ui";
import { LeftRail } from "./left-rail";
import { RightRail } from "./right-rail";

const railBox = "sticky top-header hidden h-[calc(100dvh-var(--header-height))] shrink-0 overflow-y-auto overscroll-contain pt-4 scrollbar-thin";

/** Feed layout: left rail (lg+), centred column, right rail (xl+). */
export function ThreeColumn({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className="mx-auto flex max-w-[1920px] justify-between gap-6 px-4 lg:gap-8">
      <div className={cn(railBox, "w-[280px] lg:block xl:w-[320px]")}>
        <LeftRail />
      </div>
      <main id="main" className={cn("min-w-0 flex-1 py-4 lg:max-w-[680px]", className)}>
        {children}
      </main>
      <div className={cn(railBox, "w-[300px] xl:block 2xl:w-[340px]")}>{right ?? <RightRail />}</div>
    </div>
  );
}

/** Left rail plus a wide content area (communities, events, admin). */
export function TwoColumn({ children, className, max = "max-w-[1100px]" }: { children: ReactNode; className?: string; max?: string }) {
  return (
    <div className="mx-auto flex max-w-[1920px] gap-6 px-4 lg:gap-8">
      <div className={cn(railBox, "w-[280px] lg:block xl:w-[320px]")}>
        <LeftRail />
      </div>
      <main id="main" className={cn("mx-auto min-w-0 flex-1 py-4", max, className)}>
        {children}
      </main>
    </div>
  );
}

/** No rails: full-bleed pages (community header + tabs, messages). */
export function FullWidth({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={cn("min-w-0", className)}>
      {children}
    </main>
  );
}
