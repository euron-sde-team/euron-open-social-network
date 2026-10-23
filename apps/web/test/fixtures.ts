import type { Me, Message, Post, Thread, UserSummary } from "@open-social/types";

export const user = (id: string, name = `User ${id}`): UserSummary => ({ id, username: `user_${id}`, displayName: name, avatarUrl: null, headline: null, role: "USER" });

export const me: Me = { ...user("me", "Ada Lovelace"), email: "ada@example.org", status: "ACTIVE", emailVerified: true, totpEnabled: false, dmPrivacy: "COMMUNITIES", emailDigest: false, suspendedUntil: null, reputation: 10, level: 2 };

export function message(id: string, over: Partial<Message> = {}): Message {
  return { id, roomId: "t1", sender: user("u1"), body: `m ${id}`, media: [], replyTo: null, reactions: [], status: "PUBLISHED", isPinned: false, createdAt: "2026-01-01T10:00:00.000Z", editedAt: null, ...over };
}

export function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    kind: "DIRECT",
    title: null,
    participants: [
      { user: user("me"), state: "ACTIVE", lastReadAt: null },
      { user: user("u1"), state: "ACTIVE", lastReadAt: null },
    ],
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
    viewerState: "ACTIVE",
    canSend: true,
    mutedUntil: null,
    ...over,
  };
}

export function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    kind: "POST",
    community: { id: "c1", slug: "c1", name: "Community", iconUrl: null, visibility: "PUBLIC" },
    author: user("u1"),
    body: "hello",
    feeling: null,
    tags: [],
    mentions: [],
    media: [],
    poll: null,
    sharedPost: null,
    status: "PUBLISHED",
    isPinned: false,
    isLocked: false,
    reactionCount: 0,
    reactionCounts: {},
    commentCount: 0,
    shareCount: 0,
    createdAt: "2026-01-01T10:00:00.000Z",
    editedAt: null,
    viewer: { reaction: null, bookmarked: false, canEdit: false, canDelete: false, canModerate: false },
    ...over,
  };
}
