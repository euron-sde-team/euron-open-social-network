/**
 * Fixtures for the messaging, media and realtime suites: communities, memberships,
 * follows and blocks inserted directly (so these suites do not depend on the social-core
 * endpoints), and a full upload round trip through the real media API.
 */
import request from "supertest";
import { newId } from "../../src/core/ids";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { app, as, type TestUser } from "./harness";

let n = 0;

export async function createCommunity(over: { visibility?: "PUBLIC" | "PRIVATE"; status?: "PUBLISHED" | "REMOVED"; createdBy?: string } = {}) {
  n += 1;
  const slug = `c-${Date.now().toString(36)}-${n}`;
  return db
    .insertInto("communities")
    .values({ id: newId(), slug, name: `Community ${slug}`, visibility: over.visibility ?? "PUBLIC", status: over.status ?? "PUBLISHED", created_by: over.createdBy ?? null })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function join(user: TestUser | string, communityId: string, role: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER" = "MEMBER", status: "ACTIVE" | "PENDING" | "SUSPENDED" | "BANNED" | "LEFT" = "ACTIVE") {
  const userId = typeof user === "string" ? user : user.id;
  await db
    .insertInto("community_members")
    .values({ id: newId(), community_id: communityId, user_id: userId, role, status, joined_at: new Date(Date.now() - 1000) })
    .onConflict((oc) => oc.columns(["community_id", "user_id"]).doUpdateSet({ role, status }))
    .execute();
}

/** A fresh community with every given user as an ACTIVE member. */
export async function sharedCommunity(...users: TestUser[]) {
  const c = await createCommunity();
  for (const u of users) await join(u, c.id);
  return c;
}

export async function follow(follower: TestUser, followee: TestUser) {
  await db.insertInto("follows").values({ follower_id: follower.id, followee_id: followee.id }).onConflict((oc) => oc.doNothing()).execute();
}

export async function block(blocker: TestUser, blocked: TestUser) {
  await db.insertInto("blocks").values({ blocker_id: blocker.id, blocked_id: blocked.id }).onConflict((oc) => oc.doNothing()).execute();
}

/** PUT bytes to a presigned URL: in-process for local storage, over HTTP for S3. */
export async function putBytes(put: { url: string; headers: Record<string, string> }, body: Buffer) {
  const origin = config.PUBLIC_API_URL.replace(/\/$/, "");
  if (put.url.startsWith(origin)) {
    let r = request(app).put(put.url.slice(origin.length));
    for (const [k, v] of Object.entries(put.headers)) r = r.set(k, v);
    return r.send(body);
  }
  const res = await fetch(put.url, { method: "PUT", headers: put.headers, body });
  return { status: res.status };
}

/** GET a signed media URL (local or S3) and return status, headers and bytes. */
export async function getUrl(url: string): Promise<{ status: number; type: string | null; body: Buffer; headers: Record<string, string> }> {
  const origin = config.PUBLIC_API_URL.replace(/\/$/, "");
  if (url.startsWith(origin)) {
    const res = await request(app).get(url.slice(origin.length)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    return { status: res.status, type: res.headers["content-type"] ?? null, body: res.body as Buffer, headers: res.headers as Record<string, string> };
  }
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()), headers: Object.fromEntries(res.headers.entries()) };
}

/** Create, upload and complete. Returns the completed Media (or the failing response). */
export async function upload(user: TestUser, purpose: string, fileName: string, mimeType: string, bytes: Buffer, expectStatus = 200) {
  const created = await as(user).post("/api/media/uploads").send({ purpose, fileName, mimeType, sizeBytes: bytes.length }).expect(201);
  const put = await putBytes(created.body.put, bytes);
  if (put.status !== 204 && put.status !== 200) throw new Error(`upload PUT failed with ${put.status}`);
  const done = await as(user).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(expectStatus);
  return { uploadId: created.body.uploadId as string, res: done };
}

export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
