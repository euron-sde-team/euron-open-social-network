"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Lock, MessagesSquare } from "lucide-react";
import { Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, toast } from "@open-social/ui";
import type { Community, Message } from "@open-social/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { useRoom, useSocket, useSocketEvent } from "@/lib/realtime/provider";
import { patchMessage, removeMessage, upsertMessage, type MessagePages } from "@/lib/realtime/reducers";
import { useSignals } from "@/lib/stores/signals";
import { ReportDialog } from "@/components/common/report-dialog";
import { ChatComposer } from "./composer";
import { MessageList } from "./message-list";
import { PinnedBar } from "./pinned-bar";
import { TypingIndicator } from "./typing-indicator";
import { useChatRoom } from "./use-chat-room";

/** People the viewer blocked: their messages are hidden client-side as well. */
export function useBlockedIds(): Set<string> {
  const { status } = useAuth();
  const { data } = useQuery({ queryKey: qk.blocks, queryFn: () => api().users.blocks(), enabled: status === "signed-in", staleTime: 300_000, meta: { silent: true } });
  return useMemo(() => new Set((data ?? []).map((u) => u.id)), [data]);
}

const MUTE_OPTIONS = [
  { label: "For 1 hour", ms: 3_600_000 },
  { label: "For 8 hours", ms: 8 * 3_600_000 },
  { label: "For 1 week", ms: 7 * 86_400_000 },
  { label: "Until I turn it back on", ms: 10 * 365 * 86_400_000 },
];

/** The community chat room tab. */
export function CommunityChat({ community }: { community: Community }) {
  const { user, status } = useAuth();
  const qc = useQueryClient();
  const socket = useSocket();
  const blocked = useBlockedIds();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const member = community.viewer.isMember && status === "signed-in";
  const id = community.id;
  const canModerate = community.viewer.canModerate;
  const key = qk.chatMessages(id);

  useRoom("chat", member ? id : null);

  const room = useChatRoom({
    roomId: id,
    queryKey: key,
    enabled: member,
    hiddenSenders: blocked,
    fetchPage: (cursor) => api().chat.messages(id, { cursor }),
    send: (b) => api().chat.send(id, b),
    edit: (mid, body) => api().chat.edit(mid, body),
    remove: (mid) => api().chat.remove(mid),
    pin: (mid, on) => (on ? api().chat.pin(mid) : api().chat.unpin(mid)),
    react: (mid, emoji, on) => (on ? api().chat.react(mid, emoji) : api().chat.unreact(mid, emoji)),
  });

  const pinned = useQuery({ queryKey: qk.chatPinned(id), queryFn: () => api().chat.pinned(id), enabled: member, meta: { silent: true } });

  useSocketEvent("chat:message", (p) => {
    if (p.communityId !== id) return;
    qc.setQueryData<MessagePages>(key, (d) => upsertMessage(d, p.message));
    useSignals.getState().setTyping({ roomId: id, userId: p.message.sender.id, name: p.message.sender.displayName, typing: false });
  });
  useSocketEvent("chat:message:updated", (p) => {
    if (p.communityId !== id) return;
    qc.setQueryData<MessagePages>(key, (d) => patchMessage(d, p.message.id, () => p.message));
    void qc.invalidateQueries({ queryKey: qk.chatPinned(id) });
  });
  useSocketEvent("chat:message:deleted", (p) => {
    if (p.communityId === id) qc.setQueryData<MessagePages>(key, (d) => removeMessage(d, p.messageId));
  });
  useSocketEvent("chat:typing", (p) => {
    if (p.communityId !== id || p.userId === user?.id || blocked.has(p.userId)) return;
    useSignals.getState().setTyping({ roomId: id, userId: p.userId, name: p.displayName, typing: p.typing });
  });

  // Mark read whenever a new latest message is on screen.
  const lastId = room.messages[room.messages.length - 1]?.id;
  const markRead = useMutation({
    mutationFn: () => api().chat.read(id),
    meta: { silent: true },
    onSuccess: () => qc.setQueryData<Record<string, number>>(qk.chatUnread, (u) => (u ? { ...u, [id]: 0 } : u)),
  });
  useEffect(() => {
    if (!member || !lastId || lastId.startsWith("tmp_")) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, lastId]);

  const mute = useMutation({
    mutationFn: (until: string | null) => api().chat.mute(id, until),
    onSuccess: (_r, until) => toast.success({ title: until ? "Chat muted" : "Chat unmuted" }),
  });

  if (status !== "signed-in" || !community.viewer.isMember) {
    return (
      <Card>
        <EmptyState
          icon={<Lock />}
          title="Members only"
          description={status === "signed-in" ? `Join ${community.name} to read and send messages in its chat room.` : "Sign in and join this community to chat with its members."}
        />
      </Card>
    );
  }

  const pinnedList = (pinned.data ?? []).filter((m) => !blocked.has(m.sender.id));

  return (
    <Card className="flex h-[calc(100dvh-var(--header-height)-180px)] min-h-[420px] flex-col overflow-hidden" data-testid="chat-room">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <MessagesSquare className="size-5 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate font-semibold">{community.name} chat</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Mute chat notifications" size="sm" data-testid="chat-mute">
              <BellOff />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {MUTE_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.label} onSelect={() => mute.mutate(new Date(Date.now() + o.ms).toISOString())}>
                {o.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => mute.mutate(null)}>Unmute</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <PinnedBar pinned={pinnedList} onUnpin={canModerate ? (m) => room.actions.pin(m, false) : undefined} />
      <MessageList
        messages={room.messages}
        viewerId={user?.id}
        isLoading={room.query.isPending}
        hasOlder={room.query.hasNextPage}
        loadingOlder={room.query.isFetchingNextPage}
        onLoadOlder={() => void room.query.fetchNextPage()}
        showSenderNames
        empty={<EmptyState compact icon={<MessagesSquare />} title="No messages yet" description="Say hello and start the conversation." />}
        actions={{
          onReply: setReplyTo,
          onReact: room.actions.react,
          onEdit: room.actions.edit,
          onDelete: room.actions.remove,
          onPin: (m, on) => {
            room.actions.pin(m, on);
            setTimeout(() => void qc.invalidateQueries({ queryKey: qk.chatPinned(id) }), 300);
          },
          onReport: setReporting,
          canPin: canModerate,
          canDeleteOthers: canModerate,
        }}
      />
      {room.query.isError ? (
        <div className="px-4 py-2 text-center text-sm text-danger">
          Messages did not load.{" "}
          <Button variant="link" size="sm" onClick={() => void room.query.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      <TypingIndicator roomId={id} viewerId={user?.id} />
      <ChatComposer
        purpose="CHAT"
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={room.sendMessage}
        onTyping={(typing) => socket.emit("chat:typing", { communityId: id, typing })}
        placeholder={`Message ${community.name}`}
      />
      {reporting ? <ReportDialog open onOpenChange={(o) => !o && setReporting(null)} targetType="CHAT_MESSAGE" targetId={reporting.id} /> : null}
    </Card>
  );
}
