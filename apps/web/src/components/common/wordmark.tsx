"use client";

import Link from "next/link";
import { cn } from "@open-social/ui";
import { useProductName } from "@/lib/meta";

/** Split for the two-tone wordmark: all but the last word strong, the last word muted. */
export function splitName(name: string): { lead: string; tail: string } {
  const t = name.trim();
  const i = t.lastIndexOf(" ");
  return i < 0 ? { lead: t, tail: "" } : { lead: t.slice(0, i), tail: t.slice(i + 1) };
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle cx="12.5" cy="13" r="4.25" fill="white" />
      <circle cx="20.5" cy="13" r="4.25" fill="white" fillOpacity="0.68" />
      <path d="M6.5 24.5c1-3.6 3.4-5.6 6-5.6s5 2 6 5.6M14.5 24.5c1-3.6 3.4-5.6 6-5.6s4.9 2 5.9 5.6" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Wordmark({ compact, className }: { compact?: boolean; className?: string }) {
  const name = useProductName();
  const { lead, tail } = splitName(name);
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2", className)} aria-label={`${name} home`}>
      <LogoMark />
      {compact ? null : (
        <span className="truncate text-[17px] font-bold tracking-tight text-foreground">
          {lead}
          {tail ? <span className="font-semibold text-muted-foreground"> {tail}</span> : null}
        </span>
      )}
    </Link>
  );
}
