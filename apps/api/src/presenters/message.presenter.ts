/**
 * Message rows (community chat and DMs share one DTO) to `Message`. Batched: one query
 * each for media, reactions, reply previews and senders, whatever the page size.
 *
 * What a viewer sees of a message depends on its status:
 *   PUBLISHED        everything
 *   DELETED          a tombstone: empty body, no media, no reactions
 *   HIDDEN, REMOVED  the sender still sees their own words (so they can appeal);
 *                    everyone else gets the tombstone
 */
import type { ContentStatus, Media, Message, MessageReactionSummary } from "@open-social/types";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { loadMedia } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export type MessageKind = "dm" | "chat";

export interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  reply_to_id: string | null;
  status: ContentStatus;
  pinned_at: Date | null;
  edited_at: Date | null;
  created_at: Date;
}

const TABLES = {
  dm: { messages: "dm_messages", media: "dm_message_media", reactions: "dm_reactions", room: "thread_id" },
  chat: { messages: "chat_messages", media: "chat_message_media", reactions: "chat_reactions", room: "community_id" },
} as const;

function visibleTo(row: { status: ContentStatus; sender_id: string }, viewerId: string | null): boolean {
  if (row.status === "PUBLISHED") return true;
  if (row.status === "DELETED") return false;
  return row.sender_id === viewerId;
}

/** Select message rows by id in the given order. */
export async function findMessageRows(kind: MessageKind, ids: readonly string[], exec: Executor = db): Promise<MessageRow[]> {
  if (!ids.length) return [];
  const t = TABLES[kind];
  const res = await sql<MessageRow>`
    SELECT id, ${sql.ref(t.room)} AS room_id, sender_id, body, reply_to_id, status, pinned_at, edited_at, created_at
    FROM ${sql.table(t.messages)} WHERE id = ANY(${[...ids]}::text[])`.execute(exec);
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is MessageRow => !!r);
}

export async function presentMessages(kind: MessageKind, rows: readonly MessageRow[], viewerId: string | null, exec: Executor = db): Promise<Message[]> {
  if (!rows.length) return [];
  const t = TABLES[kind];
  const ids = rows.map((r) => r.id);

  const mediaLinks = await sql<{ message_id: string; upload_id: string }>`
    SELECT message_id, upload_id FROM ${sql.table(t.media)} WHERE message_id = ANY(${ids}::text[]) ORDER BY message_id, position`.execute(exec);
  const reactionRows = await sql<{ message_id: string; emoji: string; n: number; mine: boolean }>`
    SELECT message_id, emoji, count(*)::int AS n, bool_or(user_id = ${viewerId ?? ""}) AS mine
    FROM ${sql.table(t.reactions)} WHERE message_id = ANY(${ids}::text[])
    GROUP BY message_id, emoji ORDER BY message_id, min(created_at)`.execute(exec);
  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((x): x is string => !!x))];
  const replies = await findMessageRows(kind, replyIds, exec);
  // A group member's history starts at joined_at: a reply quoting an older message shows no text.
  const joinedAt = new Map<string, Date>();
  if (kind === "dm" && viewerId && replies.length) {
    const { rows: mine } = await sql<{ thread_id: string; joined_at: Date }>`
      SELECT p.thread_id, p.joined_at FROM dm_participants p JOIN dm_threads t ON t.id = p.thread_id
       WHERE p.user_id = ${viewerId} AND t.kind = 'GROUP' AND p.thread_id = ANY(${[...new Set(rows.map((r) => r.room_id))]}::text[])`.execute(exec);
    for (const r of mine) joinedAt.set(r.thread_id, r.joined_at);
  }
  const beforeJoin = (r: MessageRow) => {
    const j = joinedAt.get(r.room_id);
    return !!j && r.created_at < j;
  };

  const [media, senders] = await Promise.all([
    loadMedia(mediaLinks.rows.map((l) => l.upload_id), exec),
    loadSummaries([...rows.map((r) => r.sender_id), ...replies.map((r) => r.sender_id)], exec),
  ]);

  const mediaByMessage = new Map<string, Media[]>();
  for (const l of mediaLinks.rows) {
    const m = media.get(l.upload_id);
    if (!m) continue;
    const list = mediaByMessage.get(l.message_id) ?? [];
    list.push(m);
    mediaByMessage.set(l.message_id, list);
  }
  const reactionsByMessage = new Map<string, MessageReactionSummary[]>();
  for (const r of reactionRows.rows) {
    const list = reactionsByMessage.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.n), reactedByViewer: !!r.mine });
    reactionsByMessage.set(r.message_id, list);
  }
  const replyById = new Map(replies.map((r) => [r.id, r]));

  return rows.map((row): Message => {
    const sender = senders.get(row.sender_id);
    const shown = visibleTo(row, viewerId);
    const reply = row.reply_to_id ? replyById.get(row.reply_to_id) : undefined;
    return {
      id: row.id,
      roomId: row.room_id,
      sender: sender ?? { id: row.sender_id, username: "deleted", displayName: "Deleted account", avatarUrl: null, headline: null, role: "USER" },
      body: shown ? row.body : "",
      media: shown ? (mediaByMessage.get(row.id) ?? []) : [],
      replyTo: reply
        ? { id: reply.id, body: visibleTo(reply, viewerId) && !beforeJoin(reply) ? reply.body.slice(0, 200) : "", senderName: senders.get(reply.sender_id)?.displayName ?? "Deleted account" }
        : null,
      reactions: row.status === "PUBLISHED" ? (reactionsByMessage.get(row.id) ?? []) : [],
      status: row.status,
      isPinned: !!row.pinned_at && row.status === "PUBLISHED",
      createdAt: row.created_at.toISOString(),
      editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    };
  });
}

/** Load and present messages by id, preserving the order given. */
export async function loadMessages(kind: MessageKind, ids: string[], viewerId: string | null, exec: Executor = db): Promise<Message[]> {
  return presentMessages(kind, await findMessageRows(kind, ids, exec), viewerId, exec);
}

export async function loadMessage(kind: MessageKind, id: string, viewerId: string | null, exec: Executor = db): Promise<Message | null> {
  return (await loadMessages(kind, [id], viewerId, exec))[0] ?? null;
}
