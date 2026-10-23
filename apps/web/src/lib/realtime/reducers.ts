/**
 * Pure cache reducers for realtime events. The socket provider applies them
 * through queryClient.setQueryData; tests exercise them directly.
 *
 * Message lists are infinite queries of Page<Message>, NEWEST FIRST (page 0,
 * item 0 is the latest), matching the API's cursor order.
 */
import type { InfiniteData } from "@tanstack/react-query";
import type { Contact } from "@open-social/api-client";
import type { Message, Notification, Page, ServerToClientEvents, Thread } from "@open-social/types";

export type MessagePages = InfiniteData<Page<Message>, string | undefined>;

export const isTempId = (id: string) => id.startsWith("tmp_");

/** Add a message at the newest end, unless it is already present (the sender's own echo). */
export function upsertMessage(data: MessagePages | undefined, message: Message): MessagePages | undefined {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.map((m) => {
      if (m.id === message.id) {
        found = true;
        return message;
      }
      return m;
    }),
  }));
  if (found) return { ...data, pages };
  const [first, ...rest] = pages;
  if (!first) return { ...data, pages: [{ items: [message], nextCursor: null }] };
  return { ...data, pages: [{ ...first, items: [message, ...first.items] }, ...rest] };
}

/** Swap an optimistic temp message for the server's copy, dropping a duplicate if the socket echo already landed. */
export function replaceTemp(data: MessagePages | undefined, tempId: string, message: Message): MessagePages | undefined {
  if (!data) return data;
  const already = data.pages.some((p) => p.items.some((m) => m.id === message.id));
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: already ? p.items.filter((m) => m.id !== tempId) : p.items.map((m) => (m.id === tempId ? message : m)),
    })),
  };
}

export function patchMessage(data: MessagePages | undefined, id: string, fn: (m: Message) => Message): MessagePages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === id ? fn(m) : m)) })) };
}

export function removeMessage(data: MessagePages | undefined, id: string): MessagePages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== id) })) };
}

/** Toggle the viewer's reaction locally (optimistic). */
export function toggleReaction(m: Message, emoji: string): Message {
  const existing = m.reactions.find((r) => r.emoji === emoji);
  let reactions;
  if (existing?.reactedByViewer) {
    reactions = m.reactions
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, reactedByViewer: false } : r))
      .filter((r) => r.count > 0);
  } else if (existing) {
    reactions = m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, reactedByViewer: true } : r));
  } else {
    reactions = [...m.reactions, { emoji, count: 1, reactedByViewer: true }];
  }
  return { ...m, reactions };
}

// ─── Typing ─────────────────────────────────────────────────────────────────

export interface Typer {
  userId: string;
  name: string;
  expiresAt: number;
}

/** room id -> typers. A typer expires after TYPING_TTL without a refresh. */
export type TypingState = Record<string, Typer[]>;
export const TYPING_TTL = 6_000;

export function typingReducer(
  state: TypingState,
  e: { roomId: string; userId: string; name: string; typing: boolean },
  now: number,
): TypingState {
  const current = (state[e.roomId] ?? []).filter((t) => t.userId !== e.userId && t.expiresAt > now);
  const next = e.typing ? [...current, { userId: e.userId, name: e.name, expiresAt: now + TYPING_TTL }] : current;
  if (next.length === 0) {
    if (!(e.roomId in state)) return state;
    const { [e.roomId]: _gone, ...rest } = state;
    return rest;
  }
  return { ...state, [e.roomId]: next };
}

export function activeTypers(state: TypingState, roomId: string, now: number, excludeUserId?: string): Typer[] {
  return (state[roomId] ?? []).filter((t) => t.expiresAt > now && t.userId !== excludeUserId);
}

/** "Ada is typing", "Ada and Lin are typing", "Several people are typing". */
export function typingLabel(typers: Typer[]): string | null {
  if (typers.length === 0) return null;
  if (typers.length === 1) return `${typers[0]!.name} is typing`;
  if (typers.length === 2) return `${typers[0]!.name} and ${typers[1]!.name} are typing`;
  return "Several people are typing";
}

// ─── Presence ───────────────────────────────────────────────────────────────

export function applyPresence(contacts: Contact[] | undefined, p: { userId: string; online: boolean; lastSeenAt: string | null }): Contact[] | undefined {
  if (!contacts) return contacts;
  let changed = false;
  const next = contacts.map((c) => {
    if (c.user.id !== p.userId) return c;
    changed = true;
    return { ...c, online: p.online, lastSeenAt: p.lastSeenAt ?? c.lastSeenAt };
  });
  if (!changed) return contacts;
  // Online first, then most recently seen, as the API orders them.
  return [...next].sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
}

// ─── Threads ────────────────────────────────────────────────────────────────

export type ThreadPages = InfiniteData<Page<Thread>, string | undefined>;

/**
 * A new DM: move its thread to the top with the new last message. Unread goes
 * up unless the viewer sent it or has the thread open.
 */
export function bumpThread(
  data: ThreadPages | undefined,
  threadId: string,
  message: Message,
  opts: { viewerId: string | null; isOpen: boolean },
): { data: ThreadPages | undefined; found: boolean } {
  if (!data) return { data, found: false };
  let thread: Thread | undefined;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.filter((t) => {
      if (t.id === threadId) {
        thread = t;
        return false;
      }
      return true;
    }),
  }));
  if (!thread) return { data, found: false };
  const own = message.sender.id === opts.viewerId;
  const updated: Thread = {
    ...thread,
    lastMessage: message,
    lastMessageAt: message.createdAt,
    unreadCount: own || opts.isOpen ? (opts.isOpen ? 0 : thread.unreadCount) : thread.unreadCount + 1,
  };
  const [first, ...rest] = pages;
  return { data: { ...data, pages: [{ ...(first ?? { nextCursor: null, items: [] }), items: [updated, ...(first?.items ?? [])] }, ...rest] }, found: true };
}

export function replaceThread(data: ThreadPages | undefined, thread: Thread): ThreadPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === thread.id ? thread : t)) })) };
}

export function removeThread(data: ThreadPages | undefined, threadId: string): ThreadPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== threadId) })) };
}

/** Record a participant's read position (drives "Seen"). */
export function applyRead(thread: Thread | undefined, userId: string, lastReadAt: string): Thread | undefined {
  if (!thread) return thread;
  return { ...thread, participants: thread.participants.map((p) => (p.user.id === userId ? { ...p, lastReadAt } : p)) };
}

/**
 * Who has seen the viewer's latest message: participants (not the viewer)
 * whose lastReadAt is at or after it.
 */
export function seenBy(thread: Thread, message: Message, viewerId: string): Thread["participants"] {
  const at = new Date(message.createdAt).getTime();
  return thread.participants.filter((p) => p.user.id !== viewerId && p.state === "ACTIVE" && p.lastReadAt !== null && new Date(p.lastReadAt).getTime() >= at);
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationPages = InfiniteData<Page<Notification>, string | undefined>;

export function prependNotification(data: NotificationPages | undefined, n: Notification): NotificationPages | undefined {
  if (!data) return data;
  if (data.pages.some((p) => p.items.some((x) => x.id === n.id))) return data;
  const [first, ...rest] = data.pages;
  return { ...data, pages: [{ ...(first ?? { nextCursor: null, items: [] }), items: [n, ...(first?.items ?? [])] }, ...rest] };
}

export function markNotificationsRead(data: NotificationPages | undefined, id: string | "all", at: string): NotificationPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((n) => (id === "all" || n.id === id ? { ...n, readAt: n.readAt ?? at } : n)) })) };
}

export type RevokeReason = Parameters<ServerToClientEvents["session:revoked"]>[0]["reason"];

/**
 * What a `session:revoked` event does. A suspension is read-only: the user
 * stays signed in and the app switches to its restricted mode. A ban or a
 * server-side sign-out ends the session.
 */
export function revocationEffect(reason: RevokeReason): { signOut: boolean; title: string } {
  switch (reason) {
    case "SUSPENDED":
      return { signOut: false, title: "Your account has been restricted. You can still read, but not post or message." };
    case "BANNED":
      return { signOut: true, title: "This account has been banned." };
    default:
      return { signOut: true, title: "You were signed out." };
  }
}

/** The user after a suspension notice, before /auth/me answers (or if it can not be reached). */
export function markSuspended<U extends { status: string }>(user: U | null): U | null {
  return user ? { ...user, status: "SUSPENDED" } : user;
}
