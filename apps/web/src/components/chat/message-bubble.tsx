"use client";

import { useState } from "react";
import { Copy, Flag, MoreHorizontal, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  toast,
} from "@open-social/ui";
import type { Message } from "@open-social/types";
import { clockTime, fullTimestamp } from "@/lib/time";
import { isTempId } from "@/lib/realtime/reducers";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { RichText } from "@/components/posts/rich-text";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { QUICK_REACTIONS } from "./grouping";

export interface BubbleActions {
  onReply?: (m: Message) => void;
  onReact?: (m: Message, emoji: string) => void;
  onEdit?: (m: Message, body: string) => Promise<unknown>;
  onDelete?: (m: Message) => Promise<unknown>;
  onPin?: (m: Message, on: boolean) => void;
  onReport?: (m: Message) => void;
  /** Viewer may pin/unpin any message (community mods, DM participants). */
  canPin?: boolean;
  /** Viewer may delete other people's messages (community mods). */
  canDeleteOthers?: boolean;
}

export function ReactionPicker({ onPick, label = "Add a reaction" }: { onPick: (emoji: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label={label} size="sm" data-testid="message-react">
          <SmilePlus />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" className="flex gap-0.5 rounded-full p-1">
        {QUICK_REACTIONS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`React with ${e}`}
            onClick={() => {
              onPick(e);
              setOpen(false);
            }}
            className="flex size-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-110 hover:bg-muted motion-reduce:transform-none"
          >
            {e}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function MessageBubble({
  message,
  own,
  firstInGroup = true,
  lastInGroup = true,
  showSender = false,
  actions = {},
  receipt,
}: {
  message: Message;
  own: boolean;
  firstInGroup?: boolean;
  lastInGroup?: boolean;
  /** Show the sender's name on the first bubble of a group (community chat, group DMs). */
  showSender?: boolean;
  actions?: BubbleActions;
  /** "Seen" / "Sent" line under the bubble. */
  receipt?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirm, setConfirm] = useState(false);
  const pending = isTempId(message.id);
  const gone = message.status === "DELETED" || message.status === "REMOVED";
  const hidden = message.status === "HIDDEN";
  const review = message.status === "PENDING_REVIEW";
  const canDelete = !!actions.onDelete && (own || actions.canDeleteOthers);
  const interactive = !pending && !gone;

  const saveEdit = async () => {
    const body = draft.trim();
    if (!body || body === message.body) return setEditing(false);
    try {
      await actions.onEdit?.(message, body);
      setEditing(false);
    } catch {
      /* toast from the mutation cache */
    }
  };

  const radius = own
    ? cn("rounded-2xl", !firstInGroup && "rounded-tr-md", !lastInGroup && "rounded-br-md")
    : cn("rounded-2xl", !firstInGroup && "rounded-tl-md", !lastInGroup && "rounded-bl-md");

  return (
    <div
      className={cn("group flex items-end gap-2 px-3", own ? "flex-row-reverse" : "flex-row", firstInGroup ? "mt-2" : "mt-0.5")}
      data-testid="message-bubble"
      data-message-id={message.id}
      data-own={own || undefined}
    >
      {!own ? (
        <span className="w-6 shrink-0">{lastInGroup ? <Avatar name={message.sender.displayName} seed={message.sender.id} src={message.sender.avatarUrl} size="xs" /> : null}</span>
      ) : null}
      <div className={cn("flex min-w-0 max-w-[78%] flex-col", own ? "items-end" : "items-start")}>
        {showSender && !own && firstInGroup ? <span className="mb-0.5 px-3 text-xs font-medium text-subtle-foreground">{message.sender.displayName}</span> : null}
        {message.replyTo ? (
          <div className={cn("mb-0.5 max-w-full rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground", own ? "mr-1" : "ml-1")}>
            <span className="flex items-center gap-1 font-semibold">
              <Reply className="size-3" aria-hidden /> {message.replyTo.senderName}
            </span>
            <span className="line-clamp-2">{message.replyTo.body || "Attachment"}</span>
          </div>
        ) : null}
        <div className={cn("flex items-center gap-1", own ? "flex-row-reverse" : "flex-row")}>
          {editing ? (
            <div className="w-72 max-w-full rounded-2xl border border-ring bg-card p-2">
              <textarea
                value={draft}
                autoFocus
                aria-label="Edit message"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                rows={2}
                className="block w-full resize-none bg-transparent text-sm focus:outline-none"
              />
              <div className="mt-1 flex justify-end gap-3 text-xs">
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="button" className="font-semibold text-link hover:underline" onClick={() => void saveEdit()}>
                  Save
                </button>
              </div>
            </div>
          ) : gone || hidden ? (
            <p className={cn("border border-border px-3 py-2 text-sm italic text-subtle-foreground", radius)}>{gone ? "This message was removed" : "Hidden by a moderator"}</p>
          ) : (
            <div className={cn("min-w-0 max-w-full", pending && "opacity-60")} title={fullTimestamp(message.createdAt)}>
              {message.media.length ? <MediaMosaic media={message.media} rounded className={cn("mb-0.5 w-64 max-w-full overflow-hidden", radius)} /> : null}
              {message.body ? (
                <div className={cn("px-3 py-2 text-[15px] leading-snug", radius, own ? "bg-primary text-primary-foreground [&_a]:text-primary-foreground [&_a]:underline" : "bg-muted text-foreground")}>
                  <RichText text={message.body} />
                </div>
              ) : null}
            </div>
          )}
          {interactive && !editing ? (
            <div className="flex items-center opacity-100 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100" data-testid="message-actions">
              {actions.onReact ? <ReactionPicker onPick={(e) => actions.onReact!(message, e)} /> : null}
              {actions.onReply ? (
                <IconButton label="Reply" size="sm" onClick={() => actions.onReply!(message)} data-testid="message-reply">
                  <Reply />
                </IconButton>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More message actions" size="sm">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={own ? "end" : "start"}>
                  {message.body ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        void navigator.clipboard
                          ?.writeText(message.body)
                          .then(() => toast.success({ title: "Copied" }))
                          .catch(() => undefined)
                      }
                    >
                      <Copy /> Copy text
                    </DropdownMenuItem>
                  ) : null}
                  {own && actions.onEdit && message.body ? (
                    <DropdownMenuItem onSelect={() => { setDraft(message.body); setEditing(true); }} data-testid="message-edit">
                      <Pencil /> Edit
                    </DropdownMenuItem>
                  ) : null}
                  {actions.canPin && actions.onPin ? (
                    <DropdownMenuItem onSelect={() => actions.onPin!(message, !message.isPinned)} data-testid="message-pin">
                      {message.isPinned ? <PinOff /> : <Pin />} {message.isPinned ? "Unpin" : "Pin"}
                    </DropdownMenuItem>
                  ) : null}
                  {!own && actions.onReport ? (
                    <DropdownMenuItem onSelect={() => actions.onReport!(message)} data-testid="message-report">
                      <Flag /> Report
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setConfirm(true)} data-testid="message-delete">
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        {message.reactions.length ? (
          <div className={cn("-mt-1 flex flex-wrap gap-1", own ? "justify-end pr-2" : "pl-2")}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={!actions.onReact || pending}
                onClick={() => actions.onReact?.(message, r.emoji)}
                aria-pressed={r.reactedByViewer}
                aria-label={`${r.emoji} ${r.count}${r.reactedByViewer ? ", you reacted" : ""}`}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border bg-card px-1.5 text-xs shadow-card transition-colors hover:bg-muted",
                  r.reactedByViewer ? "border-primary text-primary-soft-foreground" : "border-border text-muted-foreground",
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                {r.count > 1 ? <span>{r.count}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {lastInGroup || receipt || pending || message.isPinned || message.editedAt || review ? (
          <span className={cn("mt-0.5 flex items-center gap-1.5 px-2 text-[11px] text-subtle-foreground", own && "justify-end")}>
            {pending ? <span>Sending...</span> : lastInGroup ? <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time> : null}
            {message.editedAt && !gone ? <span>Edited</span> : null}
            {message.isPinned ? (
              <span className="inline-flex items-center gap-0.5">
                <Pin className="size-3" /> Pinned
              </span>
            ) : null}
            {review ? <span className="text-warning-soft-foreground">Under review</span> : null}
            {receipt ? (
              <span data-testid="dm-seen" className="font-medium">
                {receipt}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this message?"
        description={own ? "It will be removed for everyone in the conversation." : "It will be removed for everyone in this room."}
        confirmLabel="Delete"
        destructive
        onConfirm={() => actions.onDelete?.(message)}
      />
    </div>
  );
}
