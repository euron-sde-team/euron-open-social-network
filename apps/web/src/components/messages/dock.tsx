"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, Minus, SquarePen, X } from "lucide-react";
import { Avatar, CountBadge, IconButton, Tooltip, cn } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { useContacts } from "@/lib/hooks/queries";
import { useDock } from "@/lib/stores/dock";
import { Conversation, useThread } from "./conversation";
import { NewMessageDialog } from "./new-message-dialog";
import { ThreadAvatar } from "./thread-avatar";
import { counterpart, onlineOf, threadTitle } from "./thread-utils";

function DockWindow({ threadId }: { threadId: string }) {
  const { minimize, close } = useDock();
  return (
    <div className="flex h-[min(480px,calc(100dvh-var(--header-height)-24px))] w-[336px] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-card shadow-popover animate-slide-up" data-testid="dock-window" data-thread-id={threadId}>
      <Conversation
        threadId={threadId}
        variant="dock"
        onClosed={() => close(threadId)}
        headerActions={
          <div className="flex shrink-0 items-center">
            <IconButton asChild label="Open in Messages" size="sm">
              <Link href={`/messages/${threadId}`} onClick={() => close(threadId)}>
                <Maximize2 />
              </Link>
            </IconButton>
            <IconButton label="Minimise" size="sm" onClick={() => minimize(threadId)} data-testid="dock-minimize">
              <Minus />
            </IconButton>
            <IconButton label="Close conversation" size="sm" onClick={() => close(threadId)} data-testid="dock-close">
              <X />
            </IconButton>
          </div>
        }
      />
    </div>
  );
}

function DockHead({ threadId }: { threadId: string }) {
  const { user } = useAuth();
  const { openThread, close } = useDock();
  const contacts = useContacts().data;
  const { data: t } = useThread(threadId);
  const other = t ? counterpart(t, user?.id) : null;
  const title = t ? threadTitle(t, user?.id) : "Conversation";
  return (
    <div className="group relative" data-testid="dock-head">
      <Tooltip content={title} side="left">
        <button type="button" onClick={() => openThread(threadId)} aria-label={`Open conversation with ${title}`} className="block rounded-full shadow-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t ? (
            other ? (
              <Avatar name={other.displayName} seed={other.id} src={other.avatarUrl} size="lg" online={onlineOf(contacts, other.id)?.online} />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-card">
                <ThreadAvatar thread={t} viewerId={user?.id} size="md" />
              </span>
            )
          ) : (
            <span className="block size-12 animate-shimmer rounded-full bg-muted" />
          )}
        </button>
      </Tooltip>
      <CountBadge count={t?.unreadCount ?? 0} className="absolute -right-0.5 -top-0.5" />
      <button
        type="button"
        aria-label={`Close conversation with ${title}`}
        onClick={() => close(threadId)}
        className="absolute -left-1 -top-1 hidden size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-card hover:bg-muted group-focus-within:flex group-hover:flex"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** Messenger dock: open conversation windows and minimised heads, bottom right, on every page but Messages. */
export function MessengerDock() {
  const { status } = useAuth();
  const pathname = usePathname() ?? "";
  const { open, minimized, composerOpen, setComposerOpen, openThread } = useDock();
  if (status !== "signed-in" || pathname.startsWith("/messages")) return null;
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-40 hidden items-end gap-3 pr-4 lg:flex" data-testid="dm-dock">
      <div className="pointer-events-auto flex items-end gap-3">
        {open.map((id) => (
          <DockWindow key={id} threadId={id} />
        ))}
      </div>
      <div className={cn("pointer-events-auto flex flex-col items-center gap-3 pb-4")}>
        {minimized.map((id) => (
          <DockHead key={id} threadId={id} />
        ))}
        <Tooltip content="New message" side="left">
          <IconButton label="New message" size="lg" variant="outline" className="size-12 shadow-popover [&_svg]:size-5" onClick={() => setComposerOpen(true)} data-testid="new-message-button">
            <SquarePen />
          </IconButton>
        </Tooltip>
      </div>
      <NewMessageDialog open={composerOpen} onOpenChange={setComposerOpen} onOpened={(t) => openThread(t.id)} />
    </div>
  );
}
