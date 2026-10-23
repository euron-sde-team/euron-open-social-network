"use client";

import { Pin, X } from "lucide-react";
import { IconButton } from "@open-social/ui";
import type { Message } from "@open-social/types";

/** The latest pinned message above a conversation; moderators can unpin it here. */
export function PinnedBar({ pinned, onUnpin, onJump }: { pinned: Message[]; onUnpin?: (m: Message) => void; onJump?: (m: Message) => void }) {
  const latest = pinned[0];
  if (!latest) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2" data-testid="pinned-bar">
      <Pin className="size-4 shrink-0 text-primary" aria-hidden />
      <button type="button" onClick={() => onJump?.(latest)} className="min-w-0 flex-1 text-left">
        <span className="block text-xs font-semibold text-primary-soft-foreground">
          Pinned{pinned.length > 1 ? ` (${pinned.length})` : ""}, from {latest.sender.displayName}
        </span>
        <span className="block truncate text-sm text-muted-foreground">{latest.body || "Attachment"}</span>
      </button>
      {onUnpin ? (
        <IconButton label="Unpin message" size="sm" onClick={() => onUnpin(latest)}>
          <X />
        </IconButton>
      ) : null}
    </div>
  );
}
