"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, BellOff, Info, MessageCircle, ShieldAlert } from "lucide-react";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
  toast,
} from "@open-social/ui";
import type { Message, Thread } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useContacts } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { useRoom, useSocket, useSocketEvent } from "@/lib/realtime/provider";
import { bumpThread, removeThread, type ThreadPages } from "@/lib/realtime/reducers";
import { useDock } from "@/lib/stores/dock";
import { useSignals } from "@/lib/stores/signals";
import { relativeTime } from "@/lib/time";
import { ReportDialog } from "@/components/common/report-dialog";
import { ErrorState } from "@/components/common/states";
import { ChatComposer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { PinnedBar } from "@/components/chat/pinned-bar";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { useBlockedIds } from "@/components/chat/community-chat";
import { useChatRoom } from "@/components/chat/use-chat-room";
import { GroupInfoDialog } from "./group-info-dialog";
import { ThreadAvatar } from "./thread-avatar";
import { clearUnread, counterpart, isMuted, onlineOf, receiptFor, threadTitle } from "./thread-utils";

const MUTE_OPTIONS = [
  { label: "For 1 hour", ms: 3_600_000 },
  { label: "For 8 hours", ms: 8 * 3_600_000 },
  { label: "For 1 week", ms: 7 * 86_400_000 },
  { label: "Until I turn it back on", ms: 10 * 365 * 86_400_000 },
];

export function useThread(threadId: string) {
  return useQuery({ queryKey: qk.thread(threadId), queryFn: () => api().dms.thread(threadId), staleTime: 30_000 });
}

/**
 * One DM conversation: header, request banner, timeline with receipts,
 * typing and the composer. Used by the full page and by dock windows.
 */
export function Conversation({
  threadId,
  variant = "page",
  headerActions,
  onBack,
  onClosed,
}: {
  threadId: string;
  variant?: "page" | "dock";
  /** Extra controls on the right of the header (dock: minimise, close). */
  headerActions?: ReactNode;
  onBack?: () => void;
  /** The thread went away for the viewer (declined, left). */
  onClosed?: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const socket = useSocket();
  const blocked = useBlockedIds();
  const contacts = useContacts().data;
  const thread = useThread(threadId);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const compact = variant === "dock";
  const t = thread.data;

  useRoom("thread", threadId);
  useEffect(() => useSignals.getState().showThread(threadId), [threadId]);

  const room = useChatRoom({
    roomId: threadId,
    queryKey: qk.threadMessages(threadId),
    hiddenSenders: blocked,
    fetchPage: (cursor) => api().dms.messages(threadId, { cursor }),
    send: (b) => api().dms.send(threadId, b),
    edit: (id, body) => api().dms.edit(id, body),
    remove: (id) => api().dms.remove(id),
    pin: async (id, on) => {
      const m = await (on ? api().dms.pin(id) : api().dms.unpin(id));
      void qc.invalidateQueries({ queryKey: qk.dmPinned(threadId) });
      return m;
    },
    react: (id, emoji, on) => (on ? api().dms.react(id, emoji) : api().dms.unreact(id, emoji)),
    onSent: (m) => {
      for (const folder of ["inbox", "requests"]) qc.setQueryData<ThreadPages>(qk.threads(folder), (d) => bumpThread(d, threadId, m, { viewerId: user?.id ?? null, isOpen: true }).data);
    },
  });

  // Pins come from their own endpoint, so a pin on a message older than the loaded pages still shows.
  const pinnedQuery = useQuery({ queryKey: qk.dmPinned(threadId), queryFn: () => api().dms.pinned(threadId), meta: { silent: true } });
  const refreshPinned = (p: { threadId: string }) => {
    if (p.threadId === threadId) void qc.invalidateQueries({ queryKey: qk.dmPinned(threadId) });
  };
  useSocketEvent("dm:message:updated", refreshPinned);
  useSocketEvent("dm:message:deleted", refreshPinned);

  // Mark read when a newer message from someone else is on screen.
  const lastId = room.messages[room.messages.length - 1]?.id;
  const read = useMutation({
    mutationFn: () => api().dms.read(threadId),
    meta: { silent: true },
    onSuccess: () => {
      qc.setQueryData<Thread>(qk.thread(threadId), (x) =>
        x && user ? { ...x, unreadCount: 0, participants: x.participants.map((p) => (p.user.id === user.id ? { ...p, lastReadAt: new Date().toISOString() } : p)) } : x,
      );
      for (const folder of ["inbox", "requests"]) qc.setQueryData<ThreadPages>(qk.threads(folder), (d) => clearUnread(d, threadId));
      void qc.invalidateQueries({ queryKey: qk.dmUnread });
    },
  });
  useEffect(() => {
    if (!lastId || lastId.startsWith("tmp_") || !t || t.viewerState !== "ACTIVE") return;
    if (document.visibilityState !== "visible") return;
    read.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, t?.viewerState]);

  const accept = useMutation({
    mutationFn: () => api().dms.accept(threadId),
    onSuccess: (x) => {
      qc.setQueryData(qk.thread(threadId), x);
      void qc.invalidateQueries({ queryKey: qk.threadsAll });
      void qc.invalidateQueries({ queryKey: qk.dmUnread });
      toast.success({ title: "Request accepted" });
    },
  });
  const decline = useMutation({
    mutationFn: () => api().dms.decline(threadId),
    onSuccess: () => {
      qc.setQueryData<ThreadPages>(qk.threads("requests"), (d) => removeThread(d, threadId));
      void qc.invalidateQueries({ queryKey: qk.dmUnread });
      toast.info({ title: "Request declined" });
      onClosed?.();
    },
  });
  const mute = useMutation({
    mutationFn: (until: string | null) => api().dms.updateThread(threadId, { mutedUntil: until }),
    onSuccess: (x) => {
      qc.setQueryData(qk.thread(threadId), x);
      toast.success({ title: x.mutedUntil ? "Conversation muted" : "Conversation unmuted" });
    },
  });

  const receipts = useMemo(() => (t ? receiptFor(t, room.messages, user?.id) : {}), [t, room.messages, user?.id]);

  if (thread.isPending) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border p-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1" />
      </div>
    );
  }
  if (thread.isError || !t) return <ErrorState error={thread.error} onRetry={() => void thread.refetch()} compact={compact} />;

  const other = counterpart(t, user?.id);
  const presence = onlineOf(contacts, other?.id);
  const title = threadTitle(t, user?.id);
  const muted = isMuted(t);
  const requested = t.viewerState === "REQUESTED";
  const subtitle = other
    ? presence?.online
      ? "Active now"
      : presence?.lastSeenAt
        ? `Active ${relativeTime(presence.lastSeenAt)}`
        : `@${other.username}`
    : `${t.participants.filter((p) => p.state === "ACTIVE").length} people`;
  const pinned = (pinnedQuery.data ?? []).filter((m) => !blocked.has(m.sender.id));

  return (
    <div className="flex h-full min-h-0 flex-col bg-card" data-testid="conversation" data-thread-id={threadId}>
      <header className={cn("flex shrink-0 items-center gap-2 border-b border-border", compact ? "px-2 py-1.5" : "px-3 py-2.5")}>
        {onBack ? (
          <IconButton label="Back to conversations" onClick={onBack} className="lg:hidden">
            <ArrowLeft />
          </IconButton>
        ) : null}
        {other ? (
          <Link href={`/u/${encodeURIComponent(other.username)}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 hover:bg-muted">
            <Avatar name={other.displayName} seed={other.id} src={other.avatarUrl} size={compact ? "sm" : "md"} online={presence?.online} />
            <span className="min-w-0">
              <span className={cn("block truncate font-semibold", compact ? "text-sm" : "text-[15px]")}>{title}</span>
              <span className="block truncate text-xs text-subtle-foreground">{subtitle}</span>
            </span>
          </Link>
        ) : (
          <button type="button" onClick={() => setInfoOpen(true)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left hover:bg-muted">
            <ThreadAvatar thread={t} viewerId={user?.id} size={compact ? "sm" : "md"} />
            <span className="min-w-0">
              <span className={cn("block truncate font-semibold", compact ? "text-sm" : "text-[15px]")}>{title}</span>
              <span className="block truncate text-xs text-subtle-foreground">{subtitle}</span>
            </span>
          </button>
        )}
        {!compact ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={muted ? "Conversation muted, change" : "Mute conversation"} data-testid="mute-toggle">
                  {muted ? <BellOff /> : <Bell />}
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {muted ? (
                  <DropdownMenuItem onSelect={() => mute.mutate(null)}>Unmute</DropdownMenuItem>
                ) : (
                  MUTE_OPTIONS.map((o) => (
                    <DropdownMenuItem key={o.label} onSelect={() => mute.mutate(new Date(Date.now() + o.ms).toISOString())}>
                      {o.label}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {t.kind === "GROUP" ? (
              <IconButton label="Conversation info" onClick={() => setInfoOpen(true)} data-testid="group-info">
                <Info />
              </IconButton>
            ) : null}
          </>
        ) : null}
        {headerActions}
      </header>

      {pinned.length ? <PinnedBar pinned={pinned} onUnpin={(m) => room.actions.pin(m, false)} /> : null}

      <MessageList
        messages={room.messages}
        viewerId={user?.id}
        isLoading={room.query.isPending}
        hasOlder={room.query.hasNextPage}
        loadingOlder={room.query.isFetchingNextPage}
        onLoadOlder={() => void room.query.fetchNextPage()}
        showSenderNames={t.kind === "GROUP"}
        receipts={receipts}
        empty={
          <EmptyState
            compact
            icon={<MessageCircle />}
            title={other ? `Say hi to ${other.displayName.split(" ")[0]}` : "Start the conversation"}
            description={requested ? undefined : "Messages are private to the people in this conversation."}
          />
        }
        actions={{
          onReply: t.canSend && !requested ? setReplyTo : undefined,
          onReact: t.canSend ? room.actions.react : undefined,
          onEdit: room.actions.edit,
          onDelete: room.actions.remove,
          onPin: room.actions.pin,
          onReport: setReporting,
          canPin: t.canSend,
          canDeleteOthers: false,
        }}
      />
      <TypingIndicator roomId={threadId} viewerId={user?.id} />

      {requested ? (
        <div className="shrink-0 border-t border-border bg-muted/40 p-3 text-center" data-testid="request-banner">
          <p className="text-sm font-semibold">{other ? `${other.displayName} wants to message you` : "You were added to this conversation"}</p>
          <p className="mx-auto mt-0.5 max-w-sm text-xs text-muted-foreground">They will not know you have seen this until you accept. Declining moves it out of your requests.</p>
          <div className="mt-2 flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => decline.mutate()} loading={decline.isPending} data-testid="request-decline">
              Decline
            </Button>
            <Button size="sm" onClick={() => accept.mutate()} loading={accept.isPending} data-testid="request-accept">
              Accept
            </Button>
          </div>
        </div>
      ) : !t.canSend ? (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border p-3 text-sm text-muted-foreground" data-testid="cannot-reply">
          <ShieldAlert className="size-4" aria-hidden /> You can not reply to this conversation.
        </div>
      ) : (
        <ChatComposer
          purpose="DM"
          compact={compact}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={room.sendMessage}
          onTyping={(typing) => socket.emit("dm:typing", { threadId, typing })}
        />
      )}

      {reporting ? <ReportDialog open onOpenChange={(o) => !o && setReporting(null)} targetType="DM_MESSAGE" targetId={reporting.id} /> : null}
      {infoOpen && t.kind === "GROUP" ? <GroupInfoDialog thread={t} open={infoOpen} onOpenChange={setInfoOpen} onLeft={onClosed} /> : null}
    </div>
  );
}

/** Close the dock window (dock) or go back to the list (page) when a thread is gone. */
export function useThreadExit(variant: "page" | "dock", threadId: string) {
  const router = useRouter();
  const close = useDock((s) => s.close);
  return () => (variant === "dock" ? close(threadId) : router.push("/messages"));
}
