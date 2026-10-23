"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-social/api-client";
import type { Media, Message, Page } from "@open-social/types";
import { useAuth } from "@/lib/auth";
import { patchMessage, removeMessage, replaceTemp, toggleReaction, upsertMessage, type MessagePages } from "@/lib/realtime/reducers";

/** What differs between community chat and DMs: the endpoints. Everything else is shared. */
export interface RoomAdapter {
  roomId: string;
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<Page<Message>>;
  send: (body: { body: string; replyToId?: string; mediaIds?: string[] }) => Promise<Message>;
  edit: (id: string, body: string) => Promise<Message>;
  remove: (id: string) => Promise<void>;
  pin: (id: string, on: boolean) => Promise<Message>;
  react: (id: string, emoji: string, on: boolean) => Promise<Message>;
  enabled?: boolean;
  /** Sender ids to hide (people the viewer blocked). */
  hiddenSenders?: Set<string>;
  onSent?: (m: Message) => void;
}

export interface SendInput {
  body: string;
  mediaIds: string[];
  media: Media[];
  replyTo: Message | null;
}

let tempSeq = 0;

/** History (infinite, newest first from the API), optimistic send and message actions for one room. */
export function useChatRoom(a: RoomAdapter) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = a.queryKey;

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => a.fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: a.enabled ?? true,
    staleTime: 15_000,
  });

  const messages = useMemo(() => {
    const newestFirst = flattenPages(query.data?.pages);
    const visible = a.hiddenSenders?.size ? newestFirst.filter((m) => !a.hiddenSenders!.has(m.sender.id)) : newestFirst;
    return [...visible].reverse();
  }, [query.data, a.hiddenSenders]);

  const set = (fn: (d: MessagePages | undefined) => MessagePages | undefined) => qc.setQueryData<MessagePages>(key, fn);

  const send = useMutation({
    mutationFn: (v: SendInput & { tempId: string }) => a.send({ body: v.body, replyToId: v.replyTo?.id, mediaIds: v.mediaIds.length ? v.mediaIds : undefined }),
    onMutate: (v) => {
      if (!user) return;
      const temp: Message = {
        id: v.tempId,
        roomId: a.roomId,
        sender: user,
        body: v.body,
        media: v.media,
        replyTo: v.replyTo ? { id: v.replyTo.id, body: v.replyTo.body, senderName: v.replyTo.sender.displayName } : null,
        reactions: [],
        status: "PUBLISHED",
        isPinned: false,
        createdAt: new Date().toISOString(),
        editedAt: null,
      };
      set((d) => upsertMessage(d ?? { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] }, temp));
    },
    onError: (_e, v) => set((d) => removeMessage(d, v.tempId)),
    onSuccess: (m, v) => {
      set((d) => replaceTemp(d, v.tempId, m));
      a.onSent?.(m);
    },
  });

  const replace = (m: Message) => set((d) => patchMessage(d, m.id, () => m));

  const edit = useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => a.edit(id, body), onSuccess: replace });
  const remove = useMutation({
    mutationFn: (id: string) => a.remove(id),
    onSuccess: (_r, id) => set((d) => removeMessage(d, id)),
  });
  const pin = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => a.pin(id, on), onSuccess: replace });
  const react = useMutation({
    mutationFn: ({ message, emoji }: { message: Message; emoji: string }) => {
      const on = !message.reactions.find((r) => r.emoji === emoji)?.reactedByViewer;
      return a.react(message.id, emoji, on);
    },
    onMutate: ({ message, emoji }) => {
      const prev = qc.getQueryData<MessagePages>(key);
      set((d) => patchMessage(d, message.id, (m) => toggleReaction(m, emoji)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSuccess: replace,
  });

  return {
    query,
    messages,
    sendMessage: (v: SendInput) => send.mutate({ ...v, tempId: `tmp_${Date.now()}_${++tempSeq}` }),
    sending: send.isPending,
    actions: {
      edit: (m: Message, body: string) => edit.mutateAsync({ id: m.id, body }),
      remove: (m: Message) => remove.mutateAsync(m.id),
      pin: (m: Message, on: boolean) => pin.mutate({ id: m.id, on }),
      react: (m: Message, emoji: string) => react.mutate({ message: m, emoji }),
    },
  };
}
