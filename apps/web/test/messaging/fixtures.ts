import type { Message, Thread, UserSummary } from "@open-social/types";

export const user = (id: string, name = `User ${id}`): UserSummary => ({ id, username: `u${id}`, displayName: name, avatarUrl: null, headline: null, role: "USER" });

export const msg = (id: string, senderId: string, createdAt: string, extra: Partial<Message> = {}): Message => ({
  id,
  roomId: "room",
  sender: user(senderId),
  body: `message ${id}`,
  media: [],
  replyTo: null,
  reactions: [],
  status: "PUBLISHED",
  isPinned: false,
  createdAt,
  editedAt: null,
  ...extra,
});

export const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  kind: "DIRECT",
  title: null,
  participants: [
    { user: user("me", "Me Myself"), state: "ACTIVE", lastReadAt: null },
    { user: user("ada", "Ada Lovelace"), state: "ACTIVE", lastReadAt: null },
  ],
  lastMessage: null,
  lastMessageAt: null,
  unreadCount: 0,
  viewerState: "ACTIVE",
  canSend: true,
  mutedUntil: null,
  ...extra,
});
