/**
 * Direct-message threads, participants and messages.
 *
 * Fixes over the source system: the last message per thread comes from one DISTINCT ON
 * query (it ran a sub-select per thread per row), unread counts are a single grouped
 * join, and every list is keyset-paginated.
 */
import { sql, type Insertable, type Updateable } from "kysely";
import type { Cursor } from "../core/cursor";
import { db, type Executor } from "../db/kysely";
import type { DmMessages, DmParticipants, DmThreads } from "../db/types";
import type { MessageRow } from "../presenters/message.presenter";
import { notBlocked } from "./visibility";

export type Folder = "inbox" | "requests";

const MESSAGE_COLUMNS = ["m.id", "m.thread_id as room_id", "m.sender_id", "m.body", "m.reply_to_id", "m.status", "m.pinned_at", "m.edited_at", "m.created_at"] as const;

/** Messages a viewer may see listed: published or tombstoned ones, plus their own held ones; never a blocked sender's. */
function listable(viewerId: string) {
  return sql<boolean>`(m.status IN ('PUBLISHED', 'DELETED') OR m.sender_id = ${viewerId})`;
}

/**
 * Group history starts when you joined: in a GROUP thread a participant sees only
 * messages created at or after their joined_at (re-adding someone resets it). DIRECT
 * threads have no "later" member, so the rule does not apply there.
 */
export function sinceJoined(viewerId: string) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM dm_participants vp JOIN dm_threads vt ON vt.id = vp.thread_id
     WHERE vp.thread_id = m.thread_id AND vp.user_id = ${viewerId}
       AND (vt.kind = 'DIRECT' OR m.created_at >= vp.joined_at))`;
}

export class DmRepository {
  findThread(id: string, exec: Executor = db) {
    return exec.selectFrom("dm_threads").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findThreads(ids: readonly string[], exec: Executor = db) {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("dm_threads").selectAll().where("id", "in", [...ids]).execute();
  }

  findDirect(key: string, exec: Executor = db) {
    return exec.selectFrom("dm_threads").selectAll().where("direct_key", "=", key).executeTakeFirst();
  }

  /** Insert a thread; for DIRECT threads a concurrent insert of the same pair returns undefined. */
  insertThread(row: Insertable<DmThreads>, exec: Executor = db) {
    return exec
      .insertInto("dm_threads")
      .values(row)
      .onConflict((oc) => oc.column("direct_key").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  updateThread(id: string, patch: Updateable<DmThreads>, exec: Executor = db) {
    return exec.updateTable("dm_threads").set(patch).where("id", "=", id).returningAll().executeTakeFirst();
  }

  /** Upsert participants: re-adding someone who LEFT or DECLINED resets their state and joined_at (database clock when omitted). */
  upsertParticipants(rows: Insertable<DmParticipants>[], exec: Executor = db) {
    if (!rows.length) return Promise.resolve();
    return exec
      .insertInto("dm_participants")
      .values(rows)
      .onConflict((oc) =>
        oc.columns(["thread_id", "user_id"]).doUpdateSet((eb) => ({ state: eb.ref("excluded.state"), joined_at: eb.ref("excluded.joined_at"), last_read_at: null })),
      )
      .execute()
      .then(() => undefined);
  }

  participants(threadIds: readonly string[], exec: Executor = db) {
    if (!threadIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("dm_participants as p")
      .innerJoin("users as u", "u.id", "p.user_id")
      .select(["p.thread_id", "p.user_id", "p.state", "p.is_admin", "p.last_read_at", "p.muted_until", "p.joined_at", "u.status as user_status", "u.role as user_role", "u.dm_privacy"])
      .where("p.thread_id", "in", [...threadIds])
      .orderBy("p.joined_at")
      .execute();
  }

  participant(threadId: string, userId: string, exec: Executor = db) {
    return exec.selectFrom("dm_participants").selectAll().where("thread_id", "=", threadId).where("user_id", "=", userId).executeTakeFirst();
  }

  updateParticipant(threadId: string, userId: string, patch: Updateable<DmParticipants>, exec: Executor = db) {
    return exec.updateTable("dm_participants").set(patch).where("thread_id", "=", threadId).where("user_id", "=", userId).returningAll().executeTakeFirst();
  }

  /** Lock the thread row so concurrent sends evaluate the request cap one at a time. */
  lockThread(id: string, exec: Executor) {
    return exec.selectFrom("dm_threads").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
  }

  /**
   * The viewer's threads in one folder, most recent activity first. Inbox shows accepted
   * threads (plus empty ones the viewer started); requests shows pending ones with at
   * least one message.
   */
  async listThreads(userId: string, folder: Folder, cursor: Cursor | null, limit: number, exec: Executor = db) {
    const sortAt = sql<Date>`coalesce(t.last_message_at, t.created_at)`;
    let q = exec
      .selectFrom("dm_participants as p")
      .innerJoin("dm_threads as t", "t.id", "p.thread_id")
      .selectAll("t")
      .select(sortAt.as("sort_at"))
      .where("p.user_id", "=", userId);
    q =
      folder === "inbox"
        ? q.where("p.state", "=", "ACTIVE").where((eb) => eb.or([eb("t.last_message_at", "is not", null), eb("t.created_by", "=", userId)]))
        : q.where("p.state", "=", "REQUESTED").where("t.last_message_at", "is not", null);
    if (cursor) q = q.where(sql<boolean>`(${sortAt}, t.id) < (${cursor.at}, ${cursor.id})`);
    return q.orderBy(sortAt, "desc").orderBy("t.id", "desc").limit(limit + 1).execute();
  }

  /** The newest message per thread the viewer may see: one DISTINCT ON scan of the thread index. */
  async lastMessages(threadIds: readonly string[], viewerId: string, exec: Executor = db): Promise<MessageRow[]> {
    if (!threadIds.length) return [];
    return exec
      .selectFrom("dm_messages as m")
      .distinctOn("m.thread_id")
      .select(MESSAGE_COLUMNS)
      .where("m.thread_id", "in", [...threadIds])
      .where(listable(viewerId))
      .where(sinceJoined(viewerId))
      .where(notBlocked(viewerId, "m.sender_id"))
      .orderBy("m.thread_id")
      .orderBy("m.created_at", "desc")
      .orderBy("m.id", "desc")
      .execute();
  }

  /** Unread messages per thread for one user (see domain/unread.ts for the definition). */
  async unreadCounts(userId: string, threadIds: readonly string[] | null, exec: Executor = db) {
    let q = exec
      .selectFrom("dm_participants as p")
      .leftJoin("dm_messages as m", (j) =>
        j
          .onRef("m.thread_id", "=", "p.thread_id")
          // Unread starts after your read cursor, and never before you joined (groups).
          .on(sql<boolean>`m.created_at > coalesce(p.last_read_at, p.joined_at) AND m.created_at >= p.joined_at`)
          .on("m.sender_id", "<>", userId)
          .on("m.status", "=", "PUBLISHED")
          .on(notBlocked(userId, "m.sender_id")),
      )
      .select(["p.thread_id", "p.state", "p.muted_until"])
      .select((eb) => eb.fn.count<number>("m.id").as("unread"))
      .where("p.user_id", "=", userId)
      .where("p.state", "in", ["ACTIVE", "REQUESTED"])
      .groupBy(["p.thread_id", "p.state", "p.muted_until"]);
    if (threadIds) {
      if (!threadIds.length) return [];
      q = q.where("p.thread_id", "in", [...threadIds]);
    }
    return q.execute();
  }

  insertMessage(row: Insertable<DmMessages>, exec: Executor = db) {
    return exec.insertInto("dm_messages").values(row).returningAll().executeTakeFirstOrThrow();
  }

  insertMessageMedia(messageId: string, uploadIds: string[], exec: Executor = db) {
    if (!uploadIds.length) return Promise.resolve();
    return exec
      .insertInto("dm_message_media")
      .values(uploadIds.map((upload_id, position) => ({ message_id: messageId, upload_id, position })))
      .execute()
      .then(() => undefined);
  }

  findMessage(id: string, exec: Executor = db) {
    return exec.selectFrom("dm_messages").selectAll().where("id", "=", id).executeTakeFirst();
  }

  updateMessage(id: string, patch: Updateable<DmMessages>, exec: Executor = db) {
    return exec.updateTable("dm_messages").set(patch).where("id", "=", id).returningAll().executeTakeFirst();
  }

  hasMedia(messageId: string, exec: Executor = db) {
    return exec.selectFrom("dm_message_media").select("upload_id").where("message_id", "=", messageId).executeTakeFirst().then((r) => !!r);
  }

  /**
   * Every message the sender has put into the thread, deleted ones included: the
   * message-request cap counts sends, so deleting and resending cannot get past it (and
   * the first-message DM_REQUEST notification cannot fire twice).
   */
  countBySender(threadId: string, senderId: string, exec: Executor = db) {
    return exec
      .selectFrom("dm_messages")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("thread_id", "=", threadId)
      .where("sender_id", "=", senderId)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));
  }

  /** Messages each viewer has sent per thread (deleted included), for the request cap shown in Thread.canSend. */
  async sentCounts(threadIds: readonly string[], senderId: string, exec: Executor = db): Promise<Map<string, number>> {
    if (!threadIds.length) return new Map();
    const rows = await exec
      .selectFrom("dm_messages")
      .select(["thread_id"])
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("thread_id", "in", [...threadIds])
      .where("sender_id", "=", senderId)
      .groupBy("thread_id")
      .execute();
    return new Map(rows.map((r) => [r.thread_id, Number(r.n)]));
  }

  listMessages(threadId: string, viewerId: string, cursor: Cursor | null, limit: number, exec: Executor = db): Promise<MessageRow[]> {
    let q = exec
      .selectFrom("dm_messages as m")
      .select(MESSAGE_COLUMNS)
      .where("m.thread_id", "=", threadId)
      .where(listable(viewerId))
      .where(sinceJoined(viewerId))
      .where(notBlocked(viewerId, "m.sender_id"));
    if (cursor) q = q.where(sql<boolean>`(m.created_at, m.id) < (${cursor.at}, ${cursor.id})`);
    return q.orderBy("m.created_at", "desc").orderBy("m.id", "desc").limit(limit + 1).execute();
  }

  /** Pinned, visible messages of a thread, newest pin first (at most 50). */
  pinned(threadId: string, viewerId: string, exec: Executor = db): Promise<MessageRow[]> {
    return exec
      .selectFrom("dm_messages as m")
      .select(MESSAGE_COLUMNS)
      .where("m.thread_id", "=", threadId)
      .where("m.pinned_at", "is not", null)
      .where("m.status", "=", "PUBLISHED")
      .where(sinceJoined(viewerId))
      .where(notBlocked(viewerId, "m.sender_id"))
      .orderBy("m.pinned_at", "desc")
      .orderBy("m.id", "desc")
      .limit(50)
      .execute();
  }

  search(threadId: string, viewerId: string, q: string, exec: Executor = db): Promise<MessageRow[]> {
    return exec
      .selectFrom("dm_messages as m")
      .select(MESSAGE_COLUMNS)
      .where("m.thread_id", "=", threadId)
      .where("m.status", "=", "PUBLISHED")
      .where(sinceJoined(viewerId))
      .where(notBlocked(viewerId, "m.sender_id"))
      .where(sql<boolean>`to_tsvector('simple', m.body) @@ websearch_to_tsquery('simple', ${q})`)
      .orderBy("m.created_at", "desc")
      .limit(50)
      .execute();
  }

  media(threadId: string, viewerId: string, cursor: Cursor | null, limit: number, exec: Executor = db) {
    let q = exec
      .selectFrom("dm_message_media as mm")
      .innerJoin("dm_messages as m", "m.id", "mm.message_id")
      .innerJoin("media_uploads as u", "u.id", "mm.upload_id")
      .select(["mm.upload_id", "m.created_at"])
      .where("m.thread_id", "=", threadId)
      .where("m.status", "=", "PUBLISHED")
      .where("u.status", "in", ["COMPLETE", "READY"])
      .where(sinceJoined(viewerId))
      .where(notBlocked(viewerId, "m.sender_id"));
    if (cursor) q = q.where(sql<boolean>`(m.created_at, mm.upload_id) < (${cursor.at}, ${cursor.id})`);
    return q.orderBy("m.created_at", "desc").orderBy("mm.upload_id", "desc").limit(limit + 1).execute();
  }

  addReaction(messageId: string, userId: string, emoji: string, exec: Executor = db) {
    return exec
      .insertInto("dm_reactions")
      .values({ message_id: messageId, user_id: userId, emoji })
      .onConflict((oc) => oc.columns(["message_id", "user_id", "emoji"]).doNothing())
      .execute();
  }

  removeReaction(messageId: string, userId: string, emoji: string, exec: Executor = db) {
    return exec.deleteFrom("dm_reactions").where("message_id", "=", messageId).where("user_id", "=", userId).where("emoji", "=", emoji).execute();
  }

  /** People who share a DM thread with the user (for presence fan-out). */
  async threadContacts(userId: string, limit: number, exec: Executor = db): Promise<string[]> {
    const rows = await exec
      .selectFrom("dm_participants as me")
      .innerJoin("dm_participants as other", "other.thread_id", "me.thread_id")
      .innerJoin("dm_threads as t", "t.id", "me.thread_id")
      .select("other.user_id")
      .distinct()
      .where("me.user_id", "=", userId)
      .where("me.state", "=", "ACTIVE")
      .where("other.state", "=", "ACTIVE")
      .where("other.user_id", "<>", userId)
      .limit(limit)
      .execute();
    return rows.map((r) => r.user_id);
  }
}

export const dmRepo = new DmRepository();
