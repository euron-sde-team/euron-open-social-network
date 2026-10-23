/**
 * Community chat: one room per community, messages, reactions and per-member read and
 * mute state (chat_reads).
 */
import { sql, type Insertable, type Updateable } from "kysely";
import type { Cursor } from "../core/cursor";
import { db, type Executor } from "../db/kysely";
import type { ChatMessages } from "../db/types";
import type { MessageRow } from "../presenters/message.presenter";
import { notBlocked } from "./visibility";

const MESSAGE_COLUMNS = ["m.id", "m.community_id as room_id", "m.sender_id", "m.body", "m.reply_to_id", "m.status", "m.pinned_at", "m.edited_at", "m.created_at"] as const;
/** Unread counts stop at this many per room: the badge shows "99+" past it anyway. */
const UNREAD_CAP = 100;

export class ChatRepository {
  /** The community and the actor's membership, in one round trip. */
  membership(communityId: string, userId: string, exec: Executor = db) {
    return exec
      .selectFrom("communities as c")
      .leftJoin("community_members as m", (j) => j.onRef("m.community_id", "=", "c.id").on("m.user_id", "=", userId))
      .select(["c.id", "c.status as community_status", "m.role", "m.status as member_status", "m.joined_at"])
      .where("c.id", "=", communityId)
      .executeTakeFirst();
  }

  findMessage(id: string, exec: Executor = db) {
    return exec.selectFrom("chat_messages").selectAll().where("id", "=", id).executeTakeFirst();
  }

  insertMessage(row: Insertable<ChatMessages>, exec: Executor = db) {
    return exec.insertInto("chat_messages").values(row).returningAll().executeTakeFirstOrThrow();
  }

  insertMessageMedia(messageId: string, uploadIds: string[], exec: Executor = db) {
    if (!uploadIds.length) return Promise.resolve();
    return exec
      .insertInto("chat_message_media")
      .values(uploadIds.map((upload_id, position) => ({ message_id: messageId, upload_id, position })))
      .execute()
      .then(() => undefined);
  }

  hasMedia(messageId: string, exec: Executor = db) {
    return exec.selectFrom("chat_message_media").select("upload_id").where("message_id", "=", messageId).executeTakeFirst().then((r) => !!r);
  }

  updateMessage(id: string, patch: Updateable<ChatMessages>, exec: Executor = db) {
    return exec.updateTable("chat_messages").set(patch).where("id", "=", id).returningAll().executeTakeFirst();
  }

  /**
   * History newest first. Messages by people the viewer blocked (or who blocked them) are
   * left out for this viewer only; the room itself is shared, so they still exist.
   */
  listMessages(communityId: string, viewerId: string, cursor: Cursor | null, limit: number, exec: Executor = db): Promise<MessageRow[]> {
    let q = exec
      .selectFrom("chat_messages as m")
      .select(MESSAGE_COLUMNS)
      .where("m.community_id", "=", communityId)
      .where(sql<boolean>`(m.status IN ('PUBLISHED', 'DELETED') OR m.sender_id = ${viewerId})`)
      .where(notBlocked(viewerId, "m.sender_id"));
    if (cursor) q = q.where(sql<boolean>`(m.created_at, m.id) < (${cursor.at}, ${cursor.id})`);
    return q.orderBy("m.created_at", "desc").orderBy("m.id", "desc").limit(limit + 1).execute();
  }

  pinned(communityId: string, viewerId: string, exec: Executor = db): Promise<MessageRow[]> {
    return exec
      .selectFrom("chat_messages as m")
      .select(MESSAGE_COLUMNS)
      .where("m.community_id", "=", communityId)
      .where("m.pinned_at", "is not", null)
      .where("m.status", "=", "PUBLISHED")
      .where(notBlocked(viewerId, "m.sender_id"))
      .orderBy("m.pinned_at", "desc")
      .limit(50)
      .execute();
  }

  touchRead(communityId: string, userId: string, at: Date, exec: Executor = db) {
    return exec
      .insertInto("chat_reads")
      .values({ community_id: communityId, user_id: userId, last_read_at: at })
      .onConflict((oc) => oc.columns(["community_id", "user_id"]).doUpdateSet({ last_read_at: at }))
      .execute();
  }

  setMute(communityId: string, userId: string, until: Date | null, exec: Executor = db) {
    return exec
      .insertInto("chat_reads")
      .values({ community_id: communityId, user_id: userId, muted_until: until, last_read_at: sql<Date>`now()` })
      .onConflict((oc) => oc.columns(["community_id", "user_id"]).doUpdateSet({ muted_until: until }))
      .execute();
  }

  /**
   * Unread messages per community the user is an ACTIVE member of: newer than their read
   * cursor (or their join date), not theirs, published, not from a blocked user. Capped
   * per room with a LATERAL LIMIT so a busy room never scans its whole history.
   */
  async unread(userId: string, exec: Executor = db): Promise<{ community_id: string; n: number }[]> {
    const res = await sql<{ community_id: string; n: number }>`
      SELECT mem.community_id, u.n
        FROM community_members mem
        JOIN communities c ON c.id = mem.community_id AND c.status = 'PUBLISHED'
        LEFT JOIN chat_reads r ON r.community_id = mem.community_id AND r.user_id = mem.user_id
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS n FROM (
            SELECT 1 FROM chat_messages m
             WHERE m.community_id = mem.community_id
               AND m.created_at > coalesce(r.last_read_at, mem.joined_at, mem.created_at)
               AND m.sender_id <> mem.user_id
               AND m.status = 'PUBLISHED'
               AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = mem.user_id AND b.blocked_id = m.sender_id) OR (b.blocked_id = mem.user_id AND b.blocker_id = m.sender_id))
             LIMIT ${UNREAD_CAP}
          ) x
        ) u
       WHERE mem.user_id = ${userId} AND mem.status = 'ACTIVE'`.execute(exec);
    return res.rows;
  }

  addReaction(messageId: string, userId: string, emoji: string, exec: Executor = db) {
    return exec
      .insertInto("chat_reactions")
      .values({ message_id: messageId, user_id: userId, emoji })
      .onConflict((oc) => oc.columns(["message_id", "user_id", "emoji"]).doNothing())
      .execute();
  }

  removeReaction(messageId: string, userId: string, emoji: string, exec: Executor = db) {
    return exec.deleteFrom("chat_reactions").where("message_id", "=", messageId).where("user_id", "=", userId).where("emoji", "=", emoji).execute();
  }
}

export const chatRepo = new ChatRepository();
