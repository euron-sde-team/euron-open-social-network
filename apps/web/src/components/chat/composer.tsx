"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Reply, SendHorizontal, X } from "lucide-react";
import { IconButton, cn } from "@open-social/ui";
import type { Media, Message } from "@open-social/types";
import { useRestricted } from "@/lib/auth";
import { useUploads } from "@/lib/hooks/use-uploads";
import { MentionTextarea } from "@/components/common/mention-textarea";
import { UploadPreviews } from "@/components/media/upload-previews";

const TYPING_REFRESH_MS = 3000;
const TYPING_IDLE_MS = 4000;

/**
 * Emits typing=true at most every few seconds while keys are pressed, and
 * typing=false after a pause, on send, and on unmount.
 */
export function useTypingEmitter(onTyping?: (typing: boolean) => void) {
  const state = useRef<{ active: boolean; last: number; timer: ReturnType<typeof setTimeout> | null }>({ active: false, last: 0, timer: null });
  const cb = useRef(onTyping);
  cb.current = onTyping;
  const stop = () => {
    const s = state.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (s.active) {
      s.active = false;
      cb.current?.(false);
    }
  };
  const ping = (now = Date.now()) => {
    const s = state.current;
    if (!cb.current) return;
    if (!s.active || now - s.last > TYPING_REFRESH_MS) {
      s.active = true;
      s.last = now;
      cb.current(true);
    }
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(stop, TYPING_IDLE_MS);
  };
  useEffect(() => stop, []);
  return { ping, stop };
}

export interface ComposerSend {
  body: string;
  mediaIds: string[];
  media: Media[];
  replyTo: Message | null;
}

/** Message composer shared by community chat, DM pages and dock windows. */
export function ChatComposer({
  purpose,
  onSend,
  replyTo,
  onCancelReply,
  onTyping,
  placeholder: placeholderProp = "Aa",
  disabled: disabledProp,
  compact,
}: {
  purpose: "CHAT" | "DM";
  onSend: (v: ComposerSend) => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  onTyping?: (typing: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const restricted = useRestricted();
  const disabled = disabledProp || restricted;
  const placeholder = restricted ? "Your account is restricted" : placeholderProp;
  const [text, setText] = useState("");
  const uploads = useUploads(purpose, { max: 10 });
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typing = useTypingEmitter(onTyping);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const canSend = !disabled && (text.trim().length > 0 || uploads.mediaIds.length > 0) && !uploads.busy && !uploads.failed;

  const submit = () => {
    if (!canSend) return;
    onSend({
      body: text.trim(),
      mediaIds: uploads.mediaIds,
      media: uploads.items.filter((i) => i.media).map((i) => i.media!),
      replyTo: replyTo ?? null,
    });
    setText("");
    uploads.reset();
    typing.stop();
    onCancelReply?.();
    inputRef.current?.focus();
  };

  return (
    <div className={cn("border-t border-border bg-card", compact ? "p-2" : "p-3")}>
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs" data-testid="reply-banner">
          <Reply className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Replying to {replyTo.sender.displayName}</p>
            <p className="truncate text-muted-foreground">{replyTo.body || "Attachment"}</p>
          </div>
          <IconButton label="Cancel reply" size="sm" className="-my-1" onClick={onCancelReply}>
            <X />
          </IconButton>
        </div>
      ) : null}
      <UploadPreviews uploads={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} className={cn("mb-2", compact ? "max-w-[200px]" : "max-w-xs")} />
      <div className="flex items-end gap-1">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="image/*,video/mp4,video/webm,video/quicktime,audio/*,application/pdf,.docx,.xlsx,.pptx,.csv,.txt"
          onChange={(e) => {
            if (e.target.files) uploads.add(e.target.files);
            e.target.value = "";
          }}
        />
        <IconButton label="Attach files" onClick={() => fileRef.current?.click()} disabled={disabled} className="text-primary" data-testid="attach-button">
          <Paperclip />
        </IconButton>
        <div className="min-w-0 flex-1 rounded-2xl bg-muted px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <MentionTextarea
            ref={inputRef}
            value={text}
            onValueChange={(v) => {
              setText(v);
              if (v) typing.ping();
              else typing.stop();
            }}
            onSubmit={submit}
            placeholder={placeholder}
            aria-label="Message"
            data-testid="message-input"
            disabled={disabled}
            maxLength={5000}
            maxHeight={compact ? 96 : 160}
            placement="above"
            className="py-1 text-[15px]"
          />
        </div>
        <IconButton label="Send" onClick={submit} disabled={!canSend} className="text-primary disabled:text-subtle-foreground" data-testid="message-send">
          <SendHorizontal />
        </IconButton>
      </div>
    </div>
  );
}
