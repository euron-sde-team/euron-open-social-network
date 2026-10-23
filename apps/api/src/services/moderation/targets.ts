/**
 * One adapter per moderation target type, so the scan pipeline, reports, case actions
 * and appeals treat a post, a chat message or an event the same way:
 *
 *   load        text, attached images, author, community and current status
 *   visibleTo   may this person see it (reports answer 404 otherwise)
 *   setStatus   change the status and, in the same transaction, the denormalised
 *               counters ("counts include PUBLISHED only") and the realtime signals
 *
 * USER and COMMUNITY targets are loaded and checked here too; account actions (warn,
 * suspend, ban) live in actions.service.ts.
 */
import type { ContentStatus, ModerationState, ModerationTarget, UserStatus } from "@open-social/types";
import { sql } from "kysely";
import type { Actor } from "../../core/context";
import type { Effects } from "../../core/effects";
import { db, type Executor } from "../../db/kysely";
import { loadMessages } from "../../presenters/message.presenter";
import { realtime, rooms } from "../../realtime/port";
import { canReadCommunity, notBlocked } from "../../repositories/visibility";
import * as counters from "../counters.service";
import { notifySkippedMentions } from "../post-mentions.service";

export const CONTENT_TARGETS = ["POST", "COMMENT", "CHAT_MESSAGE", "DM_MESSAGE", "QUESTION", "ANSWER", "EVENT"] as const;
export type ContentTarget = (typeof CONTENT_TARGETS)[number];

export function isContentTarget(t: ModerationTarget): t is ContentTarget {
  return (CONTENT_TARGETS as readonly string[]).includes(t);
}

export interface TargetInfo {
  type: ModerationTarget;
  id: string;
  authorId: string | null;
  communityId: string | null;
  status: ContentStatus | UserStatus;
  title?: string;
  text: string;
  /** Every attached upload (snapshot) and the image subset (scanned). */
  mediaIds: string[];
  imageIds: string[];
  createdAt: Date;
  /** Parent pointers needed for counters and events. */
  postId?: string;
  parentId?: string | null;
  threadId?: string;
  questionId?: string;
}

const TABLE: Record<ContentTarget, { table: string; status: string }> = {
  POST: { table: "posts", status: "status" },
  COMMENT: { table: "comments", status: "status" },
  CHAT_MESSAGE: { table: "chat_messages", status: "status" },
  DM_MESSAGE: { table: "dm_messages", status: "status" },
  QUESTION: { table: "questions", status: "content_status" },
  ANSWER: { table: "answers", status: "status" },
  EVENT: { table: "events", status: "content_status" },
};

async function attached(table: "post_media" | "chat_message_media" | "dm_message_media", key: "post_id" | "message_id", id: string, exec: Executor) {
  const { rows } = await sql<{ id: string; kind: string }>`
    SELECT mu.id, mu.kind FROM ${sql.table(table)} am JOIN media_uploads mu ON mu.id = am.upload_id
    WHERE ${sql.ref(`am.${key}`)} = ${id} ORDER BY am.position`.execute(exec);
  return { mediaIds: rows.map((r) => r.id), imageIds: rows.filter((r) => r.kind === "IMAGE").map((r) => r.id) };
}

async function single(uploadId: string | null, exec: Executor) {
  if (!uploadId) return { mediaIds: [], imageIds: [] };
  const row = await exec.selectFrom("media_uploads").select(["id", "kind"]).where("id", "=", uploadId).executeTakeFirst();
  return { mediaIds: row ? [row.id] : [], imageIds: row?.kind === "IMAGE" ? [row.id] : [] };
}

export async function loadTarget(type: ModerationTarget, id: string, exec: Executor = db): Promise<TargetInfo | null> {
  switch (type) {
    case "POST": {
      const r = await exec.selectFrom("posts").select(["id", "author_id", "community_id", "status", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, communityId: r.community_id, status: r.status, text: r.body, createdAt: r.created_at, ...(await attached("post_media", "post_id", id, exec)) };
    }
    case "COMMENT": {
      const r = await exec
        .selectFrom("comments")
        .innerJoin("posts", "posts.id", "comments.post_id")
        .select(["comments.id", "comments.author_id", "posts.community_id", "comments.status", "comments.body", "comments.created_at", "comments.post_id", "comments.parent_id", "comments.upload_id"])
        .where("comments.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, communityId: r.community_id, status: r.status, text: r.body, createdAt: r.created_at, postId: r.post_id, parentId: r.parent_id, ...(await single(r.upload_id, exec)) };
    }
    case "CHAT_MESSAGE": {
      const r = await exec.selectFrom("chat_messages").select(["id", "sender_id", "community_id", "status", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.sender_id, communityId: r.community_id, status: r.status, text: r.body, createdAt: r.created_at, ...(await attached("chat_message_media", "message_id", id, exec)) };
    }
    case "DM_MESSAGE": {
      const r = await exec.selectFrom("dm_messages").select(["id", "sender_id", "thread_id", "status", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.sender_id, communityId: null, status: r.status, text: r.body, createdAt: r.created_at, threadId: r.thread_id, ...(await attached("dm_message_media", "message_id", id, exec)) };
    }
    case "QUESTION": {
      const r = await exec.selectFrom("questions").select(["id", "author_id", "community_id", "content_status", "title", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, communityId: r.community_id, status: r.content_status, title: r.title, text: `${r.title}\n\n${r.body}`, createdAt: r.created_at, mediaIds: [], imageIds: [] };
    }
    case "ANSWER": {
      const r = await exec
        .selectFrom("answers")
        .innerJoin("questions", "questions.id", "answers.question_id")
        .select(["answers.id", "answers.author_id", "questions.community_id", "answers.status", "answers.body", "answers.created_at", "answers.question_id"])
        .where("answers.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, communityId: r.community_id, status: r.status, text: r.body, createdAt: r.created_at, questionId: r.question_id, mediaIds: [], imageIds: [] };
    }
    case "EVENT": {
      const r = await exec.selectFrom("events").select(["id", "organizer_id", "community_id", "content_status", "title", "description", "location", "virtual_link", "created_at", "cover_upload_id"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      // Location and the virtual link are user text too: both are scanned.
      const text = [`${r.title}\n\n${r.description}`, r.location, r.virtual_link].filter(Boolean).join("\n");
      return { type, id, authorId: r.organizer_id, communityId: r.community_id, status: r.content_status, title: r.title, text, createdAt: r.created_at, ...(await single(r.cover_upload_id, exec)) };
    }
    case "USER": {
      const r = await exec.selectFrom("users").select(["id", "status", "display_name", "headline", "bio", "location", "website", "created_at", "avatar_upload_id"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      const text = [r.display_name, r.headline, r.bio, r.location, r.website].filter(Boolean).join("\n");
      return { type, id, authorId: r.id, communityId: null, status: r.status, title: r.display_name, text, createdAt: r.created_at, ...(await single(r.avatar_upload_id, exec)) };
    }
    case "COMMUNITY": {
      const r = await exec.selectFrom("communities").select(["id", "created_by", "status", "name", "description", "created_at", "icon_upload_id"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.created_by, communityId: r.id, status: r.status, title: r.name, text: `${r.name}\n\n${r.description ?? ""}`, createdAt: r.created_at, ...(await single(r.icon_upload_id, exec)) };
    }
  }
}

/** Whether `viewer` can currently see the target. Reports on anything else are a 404. */
export async function visibleTo(viewer: Actor, info: TargetInfo, exec: Executor = db): Promise<boolean> {
  const one = async (q: { executeTakeFirst(): Promise<unknown> }) => !!(await q.executeTakeFirst());
  switch (info.type) {
    case "POST":
      return one(exec.selectFrom("posts").select("id").where("id", "=", info.id).where("status", "=", "PUBLISHED").where(canReadCommunity(viewer, "posts.community_id")).where(notBlocked(viewer.id, "posts.author_id")));
    case "COMMENT":
      return one(
        exec
          .selectFrom("comments")
          .innerJoin("posts", "posts.id", "comments.post_id")
          .select("comments.id")
          .where("comments.id", "=", info.id)
          .where("comments.status", "=", "PUBLISHED")
          .where("posts.status", "=", "PUBLISHED")
          .where(canReadCommunity(viewer, "posts.community_id"))
          .where(notBlocked(viewer.id, "comments.author_id")),
      );
    case "CHAT_MESSAGE":
      return one(
        exec
          .selectFrom("chat_messages")
          .innerJoin("community_members as cm", (j) => j.onRef("cm.community_id", "=", "chat_messages.community_id").on("cm.user_id", "=", viewer.id).on("cm.status", "=", "ACTIVE"))
          .select("chat_messages.id")
          .where("chat_messages.id", "=", info.id)
          .where("chat_messages.status", "=", "PUBLISHED")
          .where(notBlocked(viewer.id, "chat_messages.sender_id")),
      );
    case "DM_MESSAGE":
      return one(
        exec
          .selectFrom("dm_messages")
          .innerJoin("dm_participants as p", (j) => j.onRef("p.thread_id", "=", "dm_messages.thread_id").on("p.user_id", "=", viewer.id))
          .select("dm_messages.id")
          .where("dm_messages.id", "=", info.id)
          .where("dm_messages.status", "=", "PUBLISHED"),
      );
    case "QUESTION":
      return one(exec.selectFrom("questions").select("id").where("id", "=", info.id).where("content_status", "=", "PUBLISHED").where(canReadCommunity(viewer, "questions.community_id")).where(notBlocked(viewer.id, "questions.author_id")));
    case "ANSWER":
      return one(
        exec
          .selectFrom("answers")
          .innerJoin("questions", "questions.id", "answers.question_id")
          .select("answers.id")
          .where("answers.id", "=", info.id)
          .where("answers.status", "=", "PUBLISHED")
          .where(canReadCommunity(viewer, "questions.community_id"))
          .where(notBlocked(viewer.id, "answers.author_id")),
      );
    case "EVENT":
      return one(
        exec
          .selectFrom("events")
          .select("id")
          .where("id", "=", info.id)
          .where("content_status", "=", "PUBLISHED")
          .where((eb) => eb.or([eb("events.community_id", "is", null), canReadCommunity(viewer, "events.community_id")(eb)]))
          .where(notBlocked(viewer.id, "events.organizer_id")),
      );
    case "USER":
      return info.status !== "DEACTIVATED" && info.status !== "PENDING_VERIFICATION" && one(exec.selectFrom("users").select("id").where("id", "=", info.id).where(notBlocked(viewer.id, "users.id")));
    case "COMMUNITY":
      return info.status === "PUBLISHED";
  }
}

/** Record the classifier outcome on the content row (and its scanned images). */
export async function setModerationState(info: TargetInfo, state: ModerationState, exec: Executor = db): Promise<void> {
  if (!isContentTarget(info.type)) return;
  await sql`UPDATE ${sql.table(TABLE[info.type].table)} SET moderation_state = ${state}::moderation_state WHERE id = ${info.id}`.execute(exec);
  if (info.imageIds.length) await exec.updateTable("media_uploads").set({ moderation_state: state }).where("id", "in", info.imageIds).execute();
}

/** Identical bodies by the same author in the same table in the last 10 minutes, this one included. */
export async function recentDuplicates(info: TargetInfo, exec: Executor = db): Promise<number> {
  if (!isContentTarget(info.type) || info.type === "QUESTION" || info.type === "EVENT" || !info.authorId || !info.text.trim()) return 0;
  const author = info.type === "CHAT_MESSAGE" || info.type === "DM_MESSAGE" ? "sender_id" : "author_id";
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM ${sql.table(TABLE[info.type].table)}
    WHERE ${sql.ref(author)} = ${info.authorId} AND body = ${info.text} AND created_at > now() - interval '10 minutes'`.execute(exec);
  return Number(r.rows[0]?.n ?? 0);
}

const dec = (col: string) => sql<number>`GREATEST(${sql.ref(col)} - 1, 0)`;

/**
 * Move content to `next`. Returns false when the status was already different from
 * what the caller loaded (a concurrent change), so nothing is double-counted.
 */
export async function setContentStatus(info: TargetInfo, next: ContentStatus, exec: Executor, fx: Effects): Promise<boolean> {
  if (info.type === "COMMUNITY") {
    const res = await exec.updateTable("communities").set({ status: next, updated_at: new Date() }).where("id", "=", info.id).where("status", "=", info.status as ContentStatus).executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) return false;
    info.status = next;
    return true;
  }
  if (!isContentTarget(info.type)) return false;
  const prev = info.status as ContentStatus;
  if (prev === next) return true;
  const { table, status } = TABLE[info.type];
  const res = await sql`UPDATE ${sql.table(table)} SET ${sql.ref(status)} = ${next}::content_status WHERE id = ${info.id} AND ${sql.ref(status)} = ${prev}::content_status`.execute(exec);
  if (Number(res.numAffectedRows ?? 0) !== 1) return false;
  info.status = next;

  const delta = prev === "PUBLISHED" ? -1 : next === "PUBLISHED" ? 1 : 0;
  const bump = (col: string) => (delta < 0 ? dec(col) : sql<number>`${sql.ref(col)} + 1`);
  if (delta !== 0) {
    switch (info.type) {
      case "POST": {
        // The posts module owns post counters and points; reuse its transitions.
        const post = { id: info.id, community_id: info.communityId as string, author_id: info.authorId as string };
        await (delta > 0 ? counters.postPublished(post, exec) : counters.postUnpublished(post, exec));
        break;
      }
      case "COMMENT":
        await exec.updateTable("posts").set({ comment_count: bump("comment_count") }).where("id", "=", info.postId as string).execute();
        if (info.parentId) await exec.updateTable("comments").set({ reply_count: bump("reply_count") }).where("id", "=", info.parentId).execute();
        break;
      case "ANSWER":
        await exec.updateTable("questions").set({ answer_count: bump("answer_count") }).where("id", "=", info.questionId as string).execute();
        break;
      default:
        break;
    }
  }

  const leaving = prev === "PUBLISHED" && next !== "PUBLISHED";
  const returning = next === "PUBLISHED" && prev !== "PUBLISHED";
  switch (info.type) {
    case "POST":
      if (leaving) fx.emit([rooms.post(info.id), ...(info.communityId ? [rooms.community(info.communityId)] : [])], "post:removed", { postId: info.id });
      // An approved pre-moderated post (or one restored) tells the people it mentions now.
      if (returning) await notifySkippedMentions(info.id, exec, fx);
      break;
    case "CHAT_MESSAGE": {
      const communityId = info.communityId as string;
      if (leaving) fx.emit([rooms.chat(communityId)], "chat:message:deleted", { communityId, messageId: info.id });
      if (returning)
        fx.after(async () => {
          const [message] = await loadMessages("chat", [info.id], null);
          if (message) realtime.emit([rooms.chat(communityId)], "chat:message:updated", { communityId, message });
        });
      break;
    }
    case "DM_MESSAGE": {
      const threadId = info.threadId as string;
      const participants = await exec.selectFrom("dm_participants").select("user_id").where("thread_id", "=", threadId).where("state", "in", ["ACTIVE", "REQUESTED"]).execute();
      const targets = participants.map((p) => rooms.user(p.user_id));
      if (leaving) fx.emit(targets, "dm:message:deleted", { threadId, messageId: info.id });
      if (returning)
        fx.after(async () => {
          const [message] = await loadMessages("dm", [info.id], null);
          if (message) realtime.emit(targets, "dm:message:updated", { threadId, message });
        });
      break;
    }
    default:
      break;
  }
  return true;
}
