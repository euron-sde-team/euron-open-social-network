/**
 * Fixtures shared by the social integration tests: communities, memberships, posts and
 * platform settings, built through the public API wherever the API can do it.
 */
import { expect } from "vitest";
import type { Community, Post } from "@open-social/types";
import { db } from "../../src/db/kysely";
import { clearSettingsCache, saveSettings, DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { as, createUser, type TestUser } from "./harness";

let n = 0;
export function uniq(prefix = "c"): string {
  n += 1;
  return `${prefix}${Date.now().toString(36)}${n}`;
}

export async function makeCommunity(owner: TestUser, over: Partial<{ visibility: "PUBLIC" | "PRIVATE"; joinPolicy: "OPEN" | "APPROVAL" | "INVITE_ONLY"; allowMemberPosts: boolean; name: string }> = {}): Promise<Community> {
  const res = await as(owner)
    .post("/api/communities")
    .send({ name: over.name ?? `Group ${uniq()}`, visibility: over.visibility ?? "PUBLIC", joinPolicy: over.joinPolicy ?? "OPEN", ...(over.allowMemberPosts !== undefined ? { allowMemberPosts: over.allowMemberPosts } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Community;
}

/** Make `user` an ACTIVE member directly (works for any join policy). */
export async function addMember(communityId: string, user: TestUser, role: "MEMBER" | "MODERATOR" | "ADMIN" = "MEMBER"): Promise<void> {
  const { newId } = await import("../../src/core/ids");
  await db
    .insertInto("community_members")
    .values({ id: newId(), community_id: communityId, user_id: user.id, role, status: "ACTIVE", joined_at: new Date() })
    .onConflict((oc) => oc.columns(["community_id", "user_id"]).doUpdateSet({ role, status: "ACTIVE" }))
    .execute();
  await db.updateTable("communities").set((eb) => ({ member_count: eb("member_count", "+", 1) })).where("id", "=", communityId).execute();
}

/** A community with an owner and N members. */
export async function world(opts: { members?: number; visibility?: "PUBLIC" | "PRIVATE"; joinPolicy?: "OPEN" | "APPROVAL" | "INVITE_ONLY" } = {}) {
  const owner = await createUser();
  const community = await makeCommunity(owner, { visibility: opts.visibility, joinPolicy: opts.joinPolicy });
  const members: TestUser[] = [];
  for (let i = 0; i < (opts.members ?? 2); i++) {
    const u = await createUser();
    await addMember(community.id, u);
    members.push(u);
  }
  return { owner, community, members };
}

export async function makePost(user: TestUser, communityId: string, body = `hello ${uniq("p")}`, extra: Record<string, unknown> = {}): Promise<Post> {
  const res = await as(user).post("/api/posts").send({ communityId, body, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Post;
}

export async function setSettings(patch: Partial<typeof DEFAULT_SETTINGS>): Promise<void> {
  const admin = await createUser({ role: "ADMIN" });
  await saveSettings({ ...DEFAULT_SETTINGS, ...patch, moderation: { ...DEFAULT_SETTINGS.moderation, ...(patch.moderation ?? {}) } }, admin.id);
  clearSettingsCache();
}

export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "platform").execute();
  clearSettingsCache();
}

/** Walk every page of a list endpoint and return all items. */
export async function allPages<T = any>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null } | any>, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = (await fetchPage(cursor)) as { items: T[]; nextCursor: string | null };
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("too many pages");
}

export async function notificationsOf(userId: string) {
  return db.selectFrom("notifications").selectAll().where("recipient_id", "=", userId).orderBy("created_at", "desc").execute();
}
