import type { Contact } from "@open-social/api-client";
import type { InfiniteData } from "@tanstack/react-query";
import type { Message, Page, Thread, UserSummary } from "@open-social/types";
import { seenBy } from "@/lib/realtime/reducers";

/** Other active people in the thread (not the viewer). */
export function others(thread: Thread, viewerId: string | undefined): UserSummary[] {
  return thread.participants.filter((p) => p.user.id !== viewerId && p.state !== "LEFT").map((p) => p.user);
}

/** The other person in a direct thread. */
export function counterpart(thread: Thread, viewerId: string | undefined): UserSummary | null {
  if (thread.kind !== "DIRECT") return null;
  return thread.participants.find((p) => p.user.id !== viewerId)?.user ?? null;
}

export function threadTitle(thread: Thread, viewerId: string | undefined): string {
  if (thread.title) return thread.title;
  const people = others(thread, viewerId);
  if (thread.kind === "DIRECT") return people[0]?.displayName ?? "Conversation";
  if (!people.length) return "Group conversation";
  const names = people.slice(0, 3).map((p) => p.displayName.split(" ")[0]);
  return people.length > 3 ? `${names.join(", ")} and ${people.length - 3} more` : names.join(", ");
}

/** One-line preview of the last message: "You: see you there". */
export function lastMessagePreview(thread: Thread, viewerId: string | undefined): string {
  const m = thread.lastMessage;
  if (!m) return "No messages yet";
  const who = m.sender.id === viewerId ? "You: " : thread.kind === "GROUP" ? `${m.sender.displayName.split(" ")[0]}: ` : "";
  if (m.status === "DELETED" || m.status === "REMOVED") return `${who}Message removed`;
  const body = m.body || (m.media.length ? (m.media.length === 1 ? "Sent an attachment" : `Sent ${m.media.length} attachments`) : "");
  return `${who}${body}`;
}

export const isMuted = (thread: Thread, now = Date.now()) => !!thread.mutedUntil && new Date(thread.mutedUntil).getTime() > now;

export function onlineOf(contacts: Contact[] | undefined, userId: string | undefined): Contact | undefined {
  return userId ? contacts?.find((c) => c.user.id === userId) : undefined;
}

/**
 * Receipt under the viewer's latest message: "Seen" in a direct thread,
 * "Seen by Ada, Lin" in a group, otherwise "Sent".
 */
export function receiptFor(thread: Thread, messages: Message[], viewerId: string | undefined): Record<string, string> {
  if (!viewerId) return {};
  const last = [...messages].reverse().find((m) => !m.id.startsWith("tmp_"));
  if (!last || last.sender.id !== viewerId) return {};
  const seen = seenBy(thread, last, viewerId);
  if (!seen.length) return { [last.id]: "Sent" };
  if (thread.kind === "DIRECT") return { [last.id]: "Seen" };
  const names = seen.slice(0, 3).map((p) => p.user.displayName.split(" ")[0]);
  return { [last.id]: `Seen by ${names.join(", ")}${seen.length > 3 ? ` and ${seen.length - 3} more` : ""}` };
}

type ThreadPages = InfiniteData<Page<Thread>, string | undefined>;

/** Zero a thread's unread count in every list cache. */
export function clearUnread(data: ThreadPages | undefined, threadId: string): ThreadPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === threadId ? { ...t, unreadCount: 0 } : t)) })) };
}
