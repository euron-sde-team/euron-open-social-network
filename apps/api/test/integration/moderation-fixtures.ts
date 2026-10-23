/**
 * Content fixtures for the moderation and admin suites, inserted with SQL so these
 * tests do not depend on the posts, chat or DM endpoints. Counters follow the shared
 * rule: PUBLISHED rows only.
 */
import { sql } from "kysely";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import type { TestUser } from "./harness";

let n = 0;

export async function community(owner: TestUser, over: { visibility?: "PUBLIC" | "PRIVATE" } = {}) {
  n += 1;
  const id = newId();
  await db
    .insertInto("communities")
    .values({ id, slug: `mod-c-${id.slice(-10).toLowerCase()}`, name: `Mod community ${n}`, visibility: over.visibility ?? "PUBLIC", created_by: owner.id, member_count: 1 })
    .execute();
  await join(owner, id, "OWNER");
  return id;
}

export async function join(user: TestUser, communityId: string, role: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER" = "MEMBER") {
  await db.insertInto("community_members").values({ id: newId(), community_id: communityId, user_id: user.id, role, status: "ACTIVE", joined_at: new Date() }).execute();
}

export async function post(author: TestUser, communityId: string, body = "hello there", status: "PUBLISHED" | "PENDING_REVIEW" = "PUBLISHED") {
  const id = newId();
  await db.insertInto("posts").values({ id, community_id: communityId, author_id: author.id, body, status }).execute();
  if (status === "PUBLISHED") {
    await db.updateTable("communities").set({ post_count: sql`post_count + 1` }).where("id", "=", communityId).execute();
    await db.updateTable("users").set({ post_count: sql`post_count + 1` }).where("id", "=", author.id).execute();
  }
  return id;
}

export async function comment(author: TestUser, postId: string, body = "a comment", parentId: string | null = null) {
  const id = newId();
  await db.insertInto("comments").values({ id, post_id: postId, author_id: author.id, body, parent_id: parentId }).execute();
  await db.updateTable("posts").set({ comment_count: sql`comment_count + 1` }).where("id", "=", postId).execute();
  if (parentId) await db.updateTable("comments").set({ reply_count: sql`reply_count + 1` }).where("id", "=", parentId).execute();
  return id;
}

export async function chatMessage(sender: TestUser, communityId: string, body: string) {
  const id = newId();
  await db.insertInto("chat_messages").values({ id, community_id: communityId, sender_id: sender.id, body }).execute();
  return id;
}

export async function dmMessage(a: TestUser, b: TestUser, body: string) {
  const threadId = newId();
  await db.insertInto("dm_threads").values({ id: threadId, kind: "DIRECT", direct_key: a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`, created_by: a.id }).execute();
  await db.insertInto("dm_participants").values([{ thread_id: threadId, user_id: a.id }, { thread_id: threadId, user_id: b.id }]).execute();
  const id = newId();
  await db.insertInto("dm_messages").values({ id, thread_id: threadId, sender_id: a.id, body }).execute();
  return { threadId, messageId: id };
}

export async function imageUpload(owner: TestUser, keyHint: string) {
  const id = newId();
  await db
    .insertInto("media_uploads")
    .values({ id, owner_id: owner.id, purpose: "POST", kind: "IMAGE", mime_type: "image/png", file_name: "x.png", declared_size: 10, size_bytes: 10, storage_key: `media/post/${keyHint}-${id}.png`, status: "READY" })
    .execute();
  return id;
}

export async function counts(communityId: string, userId: string) {
  const c = await db.selectFrom("communities").select("post_count").where("id", "=", communityId).executeTakeFirstOrThrow();
  const u = await db.selectFrom("users").select("post_count").where("id", "=", userId).executeTakeFirstOrThrow();
  return { community: c.post_count, user: u.post_count };
}

export const statusOf = (table: "posts" | "comments" | "chat_messages" | "dm_messages", id: string) =>
  db.selectFrom(table as "posts").select(["status", "moderation_state"]).where("id", "=", id).executeTakeFirstOrThrow();

export const openCaseOf = (targetType: string, targetId: string) =>
  db.selectFrom("moderation_cases").selectAll().where("target_type", "=", targetType as "POST").where("target_id", "=", targetId).orderBy("opened_at", "desc").executeTakeFirst();

export const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
