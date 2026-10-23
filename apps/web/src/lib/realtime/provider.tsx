"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "@open-social/ui";
import type { Contact, SocialSocket } from "@open-social/api-client";
import type { ServerToClientEvents, Thread } from "@open-social/types";
import { socketController } from "../api";
import { useAuth } from "../auth";
import { qk } from "../query-keys";
import { removePostEverywhere } from "../post-cache";
import { session } from "../session";
import { HOME_FEED, useSignals } from "../stores/signals";
import {
  applyPresence,
  applyRead,
  bumpThread,
  markSuspended,
  patchMessage,
  prependNotification,
  removeMessage,
  replaceThread,
  revocationEffect,
  upsertMessage,
  type MessagePages,
  type NotificationPages,
  type ThreadPages,
} from "./reducers";

const SocketContext = createContext<SocialSocket | null>(null);

/** Connects while signed in; reconnects with a fresh token after each refresh. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, user, logout, reloadMe, setUser } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const ctl = socketController();
  const socket = ctl.socket;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (status !== "signed-in") return;
    ctl.connect();
    const off = session.onToken(() => ctl.reconnectWithFreshToken());
    return () => {
      off();
    };
  }, [status, ctl]);

  useEffect(() => {
    if (status === "signed-out") ctl.disconnect();
  }, [status, ctl]);

  useEffect(() => {
    const handlers: Partial<ServerToClientEvents> = {
      "notification:new": (n) => {
        qc.setQueryData<NotificationPages>(qk.notifications(false), (d) => prependNotification(d, n));
        qc.setQueryData<NotificationPages>(qk.notifications(true), (d) => prependNotification(d, n));
      },
      "notification:count": ({ unread }) => qc.setQueryData(qk.notificationCount, { unread }),

      "dm:message": ({ threadId, message }) => {
        const isOpen = !!useSignals.getState().visibleThreads[threadId];
        qc.setQueryData<MessagePages>(qk.threadMessages(threadId), (d) => upsertMessage(d, message));
        let found = false;
        for (const folder of ["inbox", "requests"]) {
          qc.setQueryData<ThreadPages>(qk.threads(folder), (d) => {
            const r = bumpThread(d, threadId, message, { viewerId: userRef.current?.id ?? null, isOpen });
            found ||= r.found;
            return r.data;
          });
        }
        qc.setQueryData<Thread>(qk.thread(threadId), (t) => (t ? { ...t, lastMessage: message, lastMessageAt: message.createdAt } : t));
        if (!found) void qc.invalidateQueries({ queryKey: qk.threadsAll });
        if (!isOpen && message.sender.id !== userRef.current?.id) void qc.invalidateQueries({ queryKey: qk.dmUnread });
        // A message ends that sender's typing indicator.
        useSignals.getState().setTyping({ roomId: threadId, userId: message.sender.id, name: message.sender.displayName, typing: false });
      },
      "dm:message:updated": ({ threadId, message }) =>
        qc.setQueryData<MessagePages>(qk.threadMessages(threadId), (d) => patchMessage(d, message.id, () => message)),
      "dm:message:deleted": ({ threadId, messageId }) => qc.setQueryData<MessagePages>(qk.threadMessages(threadId), (d) => removeMessage(d, messageId)),
      "dm:read": ({ threadId, userId, lastReadAt }) => {
        qc.setQueryData<Thread>(qk.thread(threadId), (t) => applyRead(t, userId, lastReadAt));
        for (const folder of ["inbox", "requests"]) {
          qc.setQueryData<ThreadPages>(qk.threads(folder), (d) => {
            if (!d) return d;
            return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === threadId ? (applyRead(t, userId, lastReadAt) ?? t) : t)) })) };
          });
        }
      },
      "dm:typing": ({ threadId, userId, typing }) => {
        const thread = qc.getQueryData<Thread>(qk.thread(threadId));
        const name = thread?.participants.find((p) => p.user.id === userId)?.user.displayName ?? "Someone";
        useSignals.getState().setTyping({ roomId: threadId, userId, name, typing });
      },
      "dm:request": () => {
        void qc.invalidateQueries({ queryKey: qk.threads("requests") });
        void qc.invalidateQueries({ queryKey: qk.dmUnread });
      },
      "dm:thread:updated": ({ thread }) => {
        qc.setQueryData(qk.thread(thread.id), thread);
        for (const folder of ["inbox", "requests"]) qc.setQueryData<ThreadPages>(qk.threads(folder), (d) => replaceThread(d, thread));
      },

      "chat:message": ({ communityId, message }) => {
        if (message.sender.id === userRef.current?.id) return;
        const watching = qc.getQueryCache().find({ queryKey: qk.chatMessages(communityId) })?.getObserversCount() ?? 0;
        if (!watching) qc.setQueryData<Record<string, number>>(qk.chatUnread, (u) => (u ? { ...u, [communityId]: (u[communityId] ?? 0) + 1 } : u));
      },

      "feed:new-posts": ({ communityId, count }) => {
        const add = useSignals.getState().addNewPosts;
        add(HOME_FEED, count);
        if (communityId) add(communityId, count);
      },
      "post:removed": ({ postId }) => {
        removePostEverywhere(qc, postId);
      },
      "presence:update": (p) => qc.setQueryData<Contact[]>(qk.contacts, (c) => applyPresence(c, p)),
      "moderation:queue": ({ openCases }) => {
        useSignals.getState().setModOpenCases(openCases);
        qc.setQueryData(qk.modStats, (s: object | undefined) => (s ? { ...s, openCases } : s));
      },
      "session:revoked": ({ reason }) => {
        const effect = revocationEffect(reason);
        if (!effect.signOut) {
          // Suspension is read-only: stay signed in, re-read the account (status and end date)
          // and reconnect after the server drops this socket, so notifications keep arriving.
          const restricted = markSuspended(userRef.current);
          if (restricted) setUser(restricted);
          void reloadMe().catch(() => undefined);
          socket.once("disconnect", () => setTimeout(() => ctl.connect(), 1_000));
          toast.info({ title: effect.title });
          return;
        }
        toast.error({ title: effect.title });
        void logout({ silent: true }).then(() => router.replace("/login"));
      },
    };
    const entries = Object.entries(handlers) as [keyof ServerToClientEvents, (...args: unknown[]) => void][];
    for (const [event, h] of entries) socket.on(event, h as never);
    return () => {
      for (const [event, h] of entries) socket.off(event, h as never);
    };
  }, [socket, ctl, qc, logout, reloadMe, setUser, router]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocialSocket {
  const s = useContext(SocketContext);
  if (!s) throw new Error("useSocket must be used within RealtimeProvider");
  return s;
}

/** Subscribe to one server event for the lifetime of the component. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const socket = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = ((...args: Parameters<ServerToClientEvents[E]>) => (ref.current as (...a: unknown[]) => void)(...args)) as never;
    socket.on(event, h);
    return () => {
      socket.off(event, h);
    };
  }, [socket, event]);
}

/**
 * Join a server room for the component's lifetime (chat, community, post,
 * thread), and re-join after every reconnect (rooms do not survive one).
 */
export function useRoom(kind: "chat" | "community" | "post" | "thread", id: string | null | undefined) {
  const socket = useSocket();
  useEffect(() => {
    if (!id) return;
    const join = () => {
      if (kind === "chat") socket.emit("chat:subscribe", { communityId: id }, () => undefined);
      else if (kind === "community") socket.emit("community:subscribe", { communityId: id }, () => undefined);
      else if (kind === "post") socket.emit("post:subscribe", { postId: id }, () => undefined);
      else socket.emit("thread:subscribe", { threadId: id }, () => undefined);
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      if (kind === "chat") socket.emit("chat:unsubscribe", { communityId: id });
      else if (kind === "community") socket.emit("community:unsubscribe", { communityId: id });
      else if (kind === "post") socket.emit("post:unsubscribe", { postId: id });
      else socket.emit("thread:unsubscribe", { threadId: id });
    };
  }, [socket, kind, id]);
}
