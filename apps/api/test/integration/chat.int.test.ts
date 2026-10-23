import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { rooms } from "../../src/realtime/port";
import { as, createUser } from "./harness";
import { recordRealtime } from "./harness";
import { block, createCommunity, join, TINY_PNG, upload } from "./messaging-fixtures";

const rt = recordRealtime();

async function room() {
  const c = await createCommunity();
  const [owner, mod, member, other] = [await createUser(), await createUser(), await createUser(), await createUser()];
  await join(owner, c.id, "OWNER");
  await join(mod, c.id, "MODERATOR");
  await join(member, c.id);
  await join(other, c.id);
  return { c, owner, mod, member, other };
}
const post = (u: Parameters<typeof as>[0], cid: string, body: object) => as(u).post(`/api/chat/${cid}/messages`).send(body);

describe("access", () => {
  test("members only: non-members, pending and suspended members get 403; unknown and removed communities 404", async () => {
    const { c } = await room();
    const [outsider, pending, suspended] = [await createUser(), await createUser(), await createUser()];
    await join(pending, c.id, "MEMBER", "PENDING");
    await join(suspended, c.id, "MEMBER", "SUSPENDED");
    for (const u of [outsider, pending, suspended]) {
      expect((await as(u).get(`/api/chat/${c.id}/messages`).expect(403)).body.code).toBe("NOT_A_MEMBER");
      await post(u, c.id, { body: "hi" }).expect(403);
    }
    const removed = await createCommunity({ status: "REMOVED" });
    const m = await createUser();
    await join(m, removed.id);
    await as(m).get(`/api/chat/${removed.id}/messages`).expect(404);
  });
});

describe("messages", () => {
  test("send emits chat:message to the room; history newest first with paging", async () => {
    const { c, member, other } = await room();
    rt.clear();
    const first = await post(member, c.id, { body: "first" }).expect(201);
    expect(first.body).toMatchObject({ roomId: c.id, body: "first", sender: { id: member.id } });
    expect(rt.to(rooms.chat(c.id), "chat:message")[0]).toMatchObject({ communityId: c.id, message: { id: first.body.id } });
    await post(other, c.id, { body: "second", replyToId: first.body.id }).expect(201);
    await post(member, c.id, { body: "third" }).expect(201);
    const p1 = await as(other).get(`/api/chat/${c.id}/messages?limit=2`).expect(200);
    expect(p1.body.items.map((m: { body: string }) => m.body)).toEqual(["third", "second"]);
    expect(p1.body.items[1].replyTo).toMatchObject({ id: first.body.id, body: "first" });
    const p2 = await as(other).get(`/api/chat/${c.id}/messages?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items.map((m: { body: string }) => m.body)).toEqual(["first"]);
  });

  test("history leaves out people the viewer blocked or was blocked by", async () => {
    const { c, member, other } = await room();
    await post(member, c.id, { body: "from member" }).expect(201);
    await post(other, c.id, { body: "from other" }).expect(201);
    await block(other, member);
    const seenByOther = await as(other).get(`/api/chat/${c.id}/messages`).expect(200);
    expect(seenByOther.body.items.map((m: { body: string }) => m.body)).toEqual(["from other"]);
    const seenByMember = await as(member).get(`/api/chat/${c.id}/messages`).expect(200);
    expect(seenByMember.body.items.map((m: { body: string }) => m.body)).toEqual(["from member"]);
  });

  test("attachments must be CHAT uploads of the sender; reply must be in the same room", async () => {
    const { c, member } = await room();
    const elsewhere = await room();
    const foreign = (await post(elsewhere.member, elsewhere.c.id, { body: "x" }).expect(201)).body;
    expect((await post(member, c.id, { body: "re", replyToId: foreign.id }).expect(400)).body.code).toBe("REPLY_INVALID");
    const dmUpload = await upload(member, "DM", "a.png", "image/png", TINY_PNG);
    expect((await post(member, c.id, { mediaIds: [dmUpload.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const ok = await upload(member, "CHAT", "a.png", "image/png", TINY_PNG);
    expect((await post(member, c.id, { mediaIds: [ok.uploadId] }).expect(201)).body.media).toHaveLength(1);
  });

  test("edit is sender only; delete by sender tombstones; a mod can delete anyone's (recorded) and pin", async () => {
    const { c, mod, member, other } = await room();
    const m = (await post(member, c.id, { body: "hello" }).expect(201)).body;
    await as(other).patch(`/api/chat/messages/${m.id}`).send({ body: "x" }).expect(403);
    await as(other).delete(`/api/chat/messages/${m.id}`).expect(403);
    await as(other).post(`/api/chat/messages/${m.id}/pin`).expect(403);
    expect((await as(member).patch(`/api/chat/messages/${m.id}`).send({ body: "hello!" }).expect(200)).body.body).toBe("hello!");

    rt.clear();
    const pinned = await as(mod).post(`/api/chat/messages/${m.id}/pin`).expect(200);
    expect(pinned.body.isPinned).toBe(true);
    expect((await as(other).get(`/api/chat/${c.id}/pinned`).expect(200)).body.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect(rt.to(rooms.chat(c.id), "chat:message:updated")).toHaveLength(1);

    await as(mod).delete(`/api/chat/messages/${m.id}`).expect(204);
    expect(rt.to(rooms.chat(c.id), "chat:message:deleted")[0]).toEqual({ communityId: c.id, messageId: m.id });
    const row = await db.selectFrom("chat_messages").select("status").where("id", "=", m.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("REMOVED");
    const action = await db.selectFrom("moderation_actions").selectAll().where("target_id", "=", m.id).executeTakeFirstOrThrow();
    expect(action).toMatchObject({ actor_id: mod.id, action: "REMOVE", target_type: "CHAT_MESSAGE" });
    // The sender still sees their removed words; others see a tombstone.
    const own = await as(member).get(`/api/chat/${c.id}/messages`).expect(200);
    expect(own.body.items[0]).toMatchObject({ status: "REMOVED", body: "hello!" });
    const theirs = await as(other).get(`/api/chat/${c.id}/messages`).expect(200);
    expect(theirs.body.items.find((x: { id: string }) => x.id === m.id)).toBeUndefined();

    const mine = (await post(member, c.id, { body: "oops" }).expect(201)).body;
    await as(member).delete(`/api/chat/messages/${mine.id}`).expect(204);
    const after = await as(other).get(`/api/chat/${c.id}/messages`).expect(200);
    expect(after.body.items[0]).toMatchObject({ id: mine.id, status: "DELETED", body: "" });
  });

  test("platform staff can moderate without being members", async () => {
    const { c, member } = await room();
    const staff = await createUser({ role: "MODERATOR" });
    const m = (await post(member, c.id, { body: "hello" }).expect(201)).body;
    await as(staff).post(`/api/chat/messages/${m.id}/pin`).expect(200);
    await as(staff).delete(`/api/chat/messages/${m.id}`).expect(204);
  });

  test("reactions are one row per emoji per user", async () => {
    const { c, member, other } = await room();
    const m = (await post(member, c.id, { body: "react to me" }).expect(201)).body;
    await as(other).put(`/api/chat/messages/${m.id}/reactions/${encodeURIComponent("🎉")}`).expect(200);
    await as(other).put(`/api/chat/messages/${m.id}/reactions/${encodeURIComponent("🎉")}`).expect(200);
    const res = await as(member).put(`/api/chat/messages/${m.id}/reactions/${encodeURIComponent("🎉")}`).expect(200);
    expect(res.body.reactions).toEqual([{ emoji: "🎉", count: 2, reactedByViewer: true }]);
    await as(other).put(`/api/chat/messages/${m.id}/reactions/${"x".repeat(17)}`).expect(400);
  });
});

describe("unread and mute", () => {
  test("unread per community: after the read cursor, not mine, not deleted, not blocked", async () => {
    const { c, member, other, mod } = await room();
    await as(member).post(`/api/chat/${c.id}/read`).expect(204);
    // Posting in the room counts as having read it, so "mine" goes first.
    await post(member, c.id, { body: "mine" }).expect(201);
    await post(other, c.id, { body: "1" }).expect(201);
    const two = (await post(other, c.id, { body: "2" }).expect(201)).body;
    await post(mod, c.id, { body: "3" }).expect(201);
    expect((await as(member).get("/api/chat/unread").expect(200)).body[c.id]).toBe(3);
    await as(other).delete(`/api/chat/messages/${two.id}`).expect(204);
    await block(member, mod);
    expect((await as(member).get("/api/chat/unread").expect(200)).body[c.id]).toBe(1);
    await as(member).post(`/api/chat/${c.id}/read`).expect(204);
    expect((await as(member).get("/api/chat/unread").expect(200)).body[c.id]).toBe(0);

    await as(member).patch(`/api/chat/${c.id}/mute`).send({ until: new Date(Date.now() + 3600_000).toISOString() }).expect(204);
    const read = await db.selectFrom("chat_reads").select("muted_until").where("community_id", "=", c.id).where("user_id", "=", member.id).executeTakeFirstOrThrow();
    expect(read.muted_until).toBeInstanceOf(Date);
    await as(member).patch(`/api/chat/${c.id}/mute`).send({ until: null }).expect(204);
  });
});
