"use client";

import { useEffect, useReducer, useRef } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "@open-social/ui";
import type { ReactionCounts, ReactionType } from "@open-social/types";
import {
  LONG_PRESS_MS,
  PICKER_CLOSE_DELAY,
  PICKER_OPEN_DELAY,
  REACTION_LIST,
  REACTION_META,
  pickerReducer,
  toggleTarget,
  topReactions,
} from "@/lib/reactions";
import { compactNumber } from "@/lib/time";

/**
 * The Like button: a click toggles LIKE (or clears any reaction); hovering,
 * long-pressing or pressing ArrowUp opens the seven-reaction picker.
 */
export function ReactionButton({
  value,
  onChange,
  disabled,
  size = "md",
  testId = "reaction-button",
}: {
  value: ReactionType | null;
  onChange: (next: ReactionType | null) => void;
  disabled?: boolean;
  size?: "md" | "sm";
  testId?: string;
}) {
  const [state, dispatch] = useReducer(pickerReducer, { open: false, pending: null });
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const meta = value ? REACTION_META[value] : null;

  useEffect(() => {
    if (!state.pending) return;
    const t = setTimeout(() => dispatch(state.pending === "open" ? "open-timer" : "close-timer"), state.pending === "open" ? PICKER_OPEN_DELAY : PICKER_CLOSE_DELAY);
    return () => clearTimeout(t);
  }, [state.pending]);

  const pick = (r: ReactionType) => {
    dispatch("pick");
    onChange(r === value ? null : r);
  };

  return (
    <div
      className="relative flex-1"
      onPointerEnter={(e) => e.pointerType === "mouse" && !disabled && dispatch("pointer-enter")}
      onPointerLeave={(e) => e.pointerType === "mouse" && dispatch("pointer-leave")}
    >
      {state.open ? (
        <div
          role="menu"
          aria-label="Reactions"
          data-testid="reaction-picker"
          className="absolute bottom-full left-0 z-30 mb-2 flex items-center gap-0.5 rounded-full border border-border bg-popover px-1.5 py-1 shadow-popover animate-pop-in"
          onKeyDown={(e) => {
            if (e.key === "Escape") dispatch("escape");
          }}
        >
          {REACTION_LIST.map((r, i) => (
            <button
              key={r.type}
              type="button"
              role="menuitem"
              aria-label={r.label}
              title={r.label}
              data-testid={`reaction-${r.type.toLowerCase()}`}
              autoFocus={i === 0}
              onClick={() => pick(r.type)}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-[26px] leading-none transition-transform hover:-translate-y-1 hover:scale-125 focus-visible:scale-125 focus-visible:outline-none motion-reduce:transform-none",
                value === r.type && "bg-muted",
              )}
            >
              <span aria-hidden>{r.emoji}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        aria-pressed={!!value}
        aria-haspopup="menu"
        aria-label={value ? `${meta!.label}. Click to remove your reaction` : "Like"}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          longPressed.current = false;
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            dispatch("long-press");
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onPointerCancel={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onContextMenu={(e) => longPressed.current && e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          dispatch("pick");
          onChange(toggleTarget(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            dispatch("toggle-key");
          }
        }}
        className={cn(
          "flex w-full select-none items-center justify-center gap-2 rounded-md font-semibold transition-colors hover:bg-muted disabled:opacity-50 [-webkit-touch-callout:none]",
          size === "md" ? "h-9 text-[15px]" : "h-7 px-1 text-xs",
          meta ? meta.tone : "text-muted-foreground",
        )}
      >
        {meta && value !== "LIKE" ? (
          <span aria-hidden className={size === "md" ? "text-lg leading-none" : "text-sm leading-none"}>
            {meta.emoji}
          </span>
        ) : (
          <ThumbsUp className={size === "md" ? "size-[18px]" : "size-3.5"} fill={value === "LIKE" ? "currentColor" : "none"} />
        )}
        <span>{meta ? meta.label : "Like"}</span>
      </button>
    </div>
  );
}

/** Stacked emoji of the top reactions plus the total. */
export function ReactionSummary({ counts, total, onClick, className }: { counts: ReactionCounts; total: number; onClick?: () => void; className?: string }) {
  if (!total) return null;
  const top = topReactions(counts, 3);
  const body = (
    <>
      <span className="flex -space-x-1" aria-hidden>
        {top.map((t) => (
          <span key={t} className="flex size-[18px] items-center justify-center rounded-full bg-card text-[13px] leading-none ring-2 ring-card">
            {REACTION_META[t].emoji}
          </span>
        ))}
      </span>
      <span>{compactNumber(total)}</span>
    </>
  );
  const label = `${total} ${total === 1 ? "reaction" : "reactions"}`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`${label}, see who reacted`} className={cn("flex items-center gap-1.5 hover:underline", className)}>
      {body}
    </button>
  ) : (
    <span aria-label={label} className={cn("flex items-center gap-1.5", className)}>
      {body}
    </span>
  );
}
