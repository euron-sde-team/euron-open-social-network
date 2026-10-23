"use client";

import { Fragment, useMemo } from "react";
import { cn } from "@open-social/ui";
import { parseMarkdownLite, type Inline } from "@/lib/text";

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, k) =>
        i.type === "code" ? (
          <code key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em]">
            {i.text}
          </code>
        ) : i.type === "link" ? (
          <a key={k} href={i.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium text-link underline-offset-2 hover:underline">
            {i.text}
          </a>
        ) : (
          <Fragment key={k}>{i.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Paragraphs, fenced code blocks, inline code and links. Rendered as React nodes only. */
export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text]);
  return (
    <div className={cn("space-y-3 text-[15px] leading-relaxed", className)} data-testid="markdown-lite">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <pre key={i} className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-[13px] leading-relaxed" data-lang={b.lang ?? undefined}>
            <code>{b.text}</code>
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            <Inlines items={b.inlines} />
          </p>
        ),
      )}
    </div>
  );
}
