"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@open-social/ui";
import { isLong, tokenize } from "@/lib/text";

/** User text with linkified URLs, @mentions and #tags. Rendered as React nodes only. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => tokenize(text), [text]);
  return (
    <span className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}>
      {segments.map((s, i) => {
        switch (s.type) {
          case "url":
            return (
              <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium text-link hover:underline">
                {s.text.length > 60 ? `${s.text.slice(0, 57)}...` : s.text}
              </a>
            );
          case "mention":
            return (
              <Link key={i} href={`/u/${encodeURIComponent(s.username)}`} className="font-semibold text-link hover:underline">
                {s.text}
              </Link>
            );
          case "tag":
            return (
              <Link key={i} href={`/tags/${encodeURIComponent(s.tag)}`} className="font-medium text-link hover:underline">
                {s.text}
              </Link>
            );
          default:
            return <Fragment key={i}>{s.text}</Fragment>;
        }
      })}
    </span>
  );
}

/** Clamp long text to ~6 lines with a "See more" toggle. */
export function ExpandableText({ text, className, large }: { text: string; className?: string; large?: boolean }) {
  const long = isLong(text);
  const [open, setOpen] = useState(false);
  // Short posts read bigger, like a status update.
  const big = large && text.length < 85 && !text.includes("\n");
  return (
    <div className={cn(big ? "text-2xl leading-snug" : "text-[15px] leading-relaxed", className)}>
      <div className={cn(long && !open && "line-clamp-6")}>
        <RichText text={text} />
      </div>
      {long ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[15px] font-semibold text-foreground hover:underline">
          {open ? "See less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}
