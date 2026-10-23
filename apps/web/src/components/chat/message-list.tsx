"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Skeleton, Spinner, cn } from "@open-social/ui";
import type { Message } from "@open-social/types";
import { useInfiniteScroll } from "@/lib/hooks/use-infinite-scroll";
import { anchorAfterPrepend, buildRows, isNearBottom } from "./grouping";
import { MessageBubble, type BubbleActions } from "./message-bubble";

interface Snap {
  scrollTop: number;
  scrollHeight: number;
  firstId: string | undefined;
  lastId: string | undefined;
}

/**
 * A chat timeline. `messages` are OLDEST FIRST. Older history loads when the
 * top sentinel scrolls into view, keeping the reading position; new messages
 * stick to the bottom when the reader is already there (or sent them).
 */
export function MessageList({
  messages,
  viewerId,
  isLoading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  showSenderNames,
  actions,
  receipts,
  empty,
  className,
}: {
  messages: Message[];
  viewerId: string | undefined;
  isLoading?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  showSenderNames?: boolean;
  actions?: BubbleActions;
  /** message id -> receipt text ("Seen", "Sent"). */
  receipts?: Record<string, string>;
  empty?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const snap = useRef<Snap | null>(null);
  const nearBottom = useRef(true);
  const rows = useMemo(() => buildRows(messages), [messages]);

  const remember = () => {
    const el = ref.current;
    if (!el) return;
    nearBottom.current = isNearBottom(el);
    if (snap.current) {
      snap.current.scrollTop = el.scrollTop;
      snap.current.scrollHeight = el.scrollHeight;
    }
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const lastId = messages[messages.length - 1]?.id;
    const prev = snap.current;
    if (!prev || !prev.lastId) {
      el.scrollTop = el.scrollHeight;
      nearBottom.current = true;
    } else if (firstId !== prev.firstId && lastId === prev.lastId) {
      el.scrollTop = anchorAfterPrepend(prev, el.scrollHeight);
    } else if (lastId !== prev.lastId) {
      const own = messages[messages.length - 1]?.sender.id === viewerId;
      if (nearBottom.current || own) el.scrollTop = el.scrollHeight;
    }
    snap.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, firstId, lastId };
  }, [messages, viewerId]);

  // Images and videos load after layout: keep the bottom pinned while the reader is there.
  useEffect(() => {
    const el = ref.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
      if (snap.current) snap.current.scrollHeight = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const topRef = useInfiniteScroll<HTMLDivElement>(() => onLoadOlder?.(), { enabled: !!hasOlder && !loadingOlder && !!root, root, rootMargin: "240px 0px 0px 0px" });

  return (
    <div
      ref={(el) => {
        ref.current = el;
        setRoot(el);
      }}
      onScroll={remember}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin", className)}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Messages"
    >
      <div ref={contentRef} className="flex min-h-full flex-col justify-end pb-2">
        <div ref={topRef} className="flex h-8 items-center justify-center">
          {loadingOlder ? <Spinner size="sm" /> : null}
        </div>
        {isLoading ? (
          <div className="space-y-3 px-3" aria-hidden>
            {[60, 40, 70, 30, 55].map((w, i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <Skeleton className="h-9 rounded-2xl" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          (empty ?? null)
        ) : (
          rows.map((r) =>
            r.type === "day" ? (
              <div key={r.key} className="my-3 flex items-center justify-center" role="separator">
                <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-semibold text-muted-foreground">{r.label}</span>
              </div>
            ) : (
              <MessageBubble
                key={r.key}
                message={r.message}
                own={r.message.sender.id === viewerId}
                firstInGroup={r.firstInGroup}
                lastInGroup={r.lastInGroup}
                showSender={showSenderNames}
                actions={actions}
                receipt={receipts?.[r.message.id] ?? null}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
