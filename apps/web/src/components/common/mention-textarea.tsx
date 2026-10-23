"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, cn } from "@open-social/ui";
import type { UserSummary } from "@open-social/types";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";
import { activeMention, insertMention } from "@/lib/text";

export interface MentionTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (v: string) => void;
  /** Enter submits (Shift+Enter for a new line), as in comments and chat. */
  onSubmit?: () => void;
  autoGrow?: boolean;
  maxHeight?: number;
  /** Where the suggestion list opens. */
  placement?: "below" | "above";
}

/**
 * A textarea with an @mention typeahead (people from /discover/typeahead).
 * Arrow keys move through suggestions; Enter or Tab inserts the username.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
  { value, onValueChange, onSubmit, autoGrow = true, maxHeight = 320, placement = "below", className, onKeyDown, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!, []);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = useDebounced(mention?.query ?? "", 120);

  const { data } = useQuery({
    queryKey: qk.typeahead(`@${q}`),
    queryFn: ({ signal }) => api().discover.typeahead(q || "a", signal),
    enabled: mention !== null && q.length >= 1,
    staleTime: 60_000,
    meta: { silent: true },
  });
  const people: UserSummary[] = mention && q.length >= 1 ? (data?.people ?? []).slice(0, 6) : [];
  const open = people.length > 0;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, autoGrow, maxHeight]);

  useEffect(() => setActive(0), [q]);

  const sync = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length));
  }, []);

  const choose = (u: UserSummary) => {
    const el = inner.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const next = insertMention(value, mention.start, caret, u.username);
    onValueChange(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={inner}
        value={value}
        rows={1}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          setMention(activeMention(e.target.value, e.target.selectionStart ?? e.target.value.length));
        }}
        onSelect={sync}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % people.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + people.length) % people.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const u = people[active];
              if (u) choose(u);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMention(null);
              return;
            }
          }
          if (onSubmit && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
            return;
          }
          onKeyDown?.(e);
        }}
        className={cn("block w-full resize-none bg-transparent text-foreground placeholder:text-subtle-foreground focus:outline-none", className)}
        {...rest}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className={cn("absolute left-0 z-[75] w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-popover animate-pop-in", placement === "below" ? "top-full mt-1" : "bottom-full mb-1")}
        >
          {people.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(u);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5", i === active && "bg-muted")}
            >
              <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{u.displayName}</span>
                <span className="block truncate text-xs text-subtle-foreground">@{u.username}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
