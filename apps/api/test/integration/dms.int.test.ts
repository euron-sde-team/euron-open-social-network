import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { rooms } from "../../src/realtime/port";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { block, follow, join, sharedCommunity, TINY_PNG, upload } from "./messaging-fixtures";

const rt = recordRealtime();

async function open(a: TestUser, b: TestUser) {
  return (await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200)).body;
}
const send = (u: TestUser, threadId: string, body: string | Record<string, unknown>) =>
  as(u)
    .post(`/api/dms/threads/${threadId}/messages`)
    .send(typeof body === "string" ? { body } : body);

describe("eligibility through the API", () => {
  test("no shared community: 403 NO_SHARED_COMMUNITY, and the eligibility endpoint agrees", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const res = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(403);
    expect(res.body).toMatchObject({ code: "DM_NOT_ALLOWED", details: { reason: "NO_SHARED_COMMUNITY" } });
    const e = await as(a).get(`/api/dms/eligibility/${b.id}`).expect(200);
    expect(e.body).toEqual({ allowed: false, reason: "NO_SHARED_COMMUNITY", asRequest: false });
  });

  test("after joining a shared community: allowed as a request", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    expect((await as(a).get(`/api/dms/eligibility/${b.id}`)).body).toEqual({ allowed: true, reason: null, asRequest: true });
    const t = await open(a, b);
    expect(t.kind).toBe("DIRECT");
    expect(t.participants.find((p: { user: { id: string } }) => p.user.id === b.id).state).toBe("REQUESTED");
    // Opening again finds the same thread, from either side.
    expect((await open(a, b)).id).toBe(t.id);
    expect((await as(b).post("/api/dms/threads").send({ userId: a.id }).expect(200)).body.id).toBe(t.id);
  });

  test("privacy NOBODY and FOLLOWING", async () => {
    const [a, nobody, picky] = [await createUser(), await createUser({ dmPrivacy: "NOBODY" }), await createUser({ dmPrivacy: "FOLLOWING" })];
    await sharedCommunity(a, nobody, picky);
    expect((await as(a).post("/api/dms/threads").send({ userId: nobody.id }).expect(403)).body.details.reason).toBe("RECIPIENT_DISABLED_DMS");
    expect((await as(a).post("/api/dms/threads").send({ userId: picky.id }).expect(403)).body.details.reason).toBe("RECIPIENT_NOT_FOLLOWING");
    await follow(picky, a);
    const t = await open(a, picky);
    // Followed by the recipient: not a request.
    expect(t.participants.every((p: { state: string }) => p.state === "ACTIVE")).toBe(true);
  });

  test("staff can message anyone without a shared community, but not across a block", async () => {
    const [mod, u, blocker] = [await createUser({ role: "MODERATOR" }), await createUser({ dmPrivacy: "NOBODY" }), await createUser()];
    const t = await open(mod, u);
    expect(t.participants.every((p: { state: string }) => p.state === "ACTIVE")).toBe(true);
    await block(blocker, mod);
    expect((await as(mod).post("/api/dms/threads").send({ userId: blocker.id }).expect(403)).body.details.reason).toBe("BLOCKED");
  });

  test("yourself is refused", async () => {
    const a = await createUser();
    expect((await as(a).post("/api/dms/threads").send({ userId: a.id }).expect(403)).body.details.reason).toBe("SELF");
  });
});

describe("message requests", () => {
  test("first message: request folder, one DM_REQUEST notification, dm:request + dm:message; cap of 3 until accepted", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const t = await open(a, b);
    rt.clear();

    await send(a, t.id, "hello there").expect(201);
    expect(rt.to(rooms.user(b.id), "dm:request")).toHaveLength(1);
    expect(rt.to(rooms.user(b.id), "dm:message")).toHaveLength(1);
    expect(rt.to(rooms.user(a.id), "dm:message")).toHaveLength(1);

    await send(a, t.id, "second").expect(201);
    await send(a, t.id, "third").expect(201);
    const capped = await send(a, t.id, "fourth").expect(403);
    expect(capped.body.code).toBe("DM_REQUEST_PENDING");
    const sent = await as(a).get(`/api/dms/threads/${t.id}`).expect(200);
    expect(sent.body.canSend).toBe(false);

    const notes = await db.selectFrom("notifications").select("id").where("recipient_id", "=", b.id).where("type", "=", "DM_REQUEST").execute();
    expect(notes).toHaveLength(1);
    expect(rt.to(rooms.user(b.id), "dm:request")).toHaveLength(1);

    const requests = await as(b).get("/api/dms/threads?folder=requests").expect(200);
    expect(requests.body.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(requests.body.items[0].viewerState).toBe("REQUESTED");
    expect((await as(b).get("/api/dms/threads?folder=inbox").expect(200)).body.items).toHaveLength(0);
    expect((await as(b).get("/api/dms/unread").expect(200)).body).toEqual({ inbox: 0, requests: 1 });

    const accepted = await as(b).post(`/api/dms/threads/${t.id}/accept`).expect(200);
    expect(accepted.body.viewerState).toBe("ACTIVE");
    expect((await as(b).get("/api/dms/unread").expect(200)).body).toEqual({ inbox: 3, requests: 0 });
    await send(a, t.id, "fourth, now accepted").expect(201);
    expect((await as(b).get("/api/dms/threads?folder=inbox").expect(200)).body.items[0].id).toBe(t.id);
  });

  test("replying to a request accepts it", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const t = await open(a, b);
    await send(a, t.id, "hi").expect(201);
    await send(b, t.id, "hi back").expect(201);
    expect((await as(b).get(`/api/dms/threads/${t.id}`).expect(200)).body.viewerState).toBe("ACTIVE");
  });

  test("declined: the sender can no longer send and only sees the generic reason", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const t = await open(a, b);
    await send(a, t.id, "hi").expect(201);
    await as(b).post(`/api/dms/threads/${t.id}/decline`).expect(204);
    const res = await send(a, t.id, "hello?").expect(403);
    expect(res.body).toMatchObject({ code: "DM_NOT_ALLOWED", details: { reason: "RECIPIENT_DISABLED_DMS" } });
    expect((await as(a).get(`/api/dms/threads/${t.id}`).expect(200)).body.canSend).toBe(false);
    await as(b).get(`/api/dms/threads/${t.id}`).expect(404);
  });
});

describe("blocks", () => {
  test("a block mid-conversation: canSend false and 403 BLOCKED both ways", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    await follow(b, a);
    const t = await open(a, b);
    await send(a, t.id, "hi").expect(201);
    await block(b, a);
    expect((await as(a).get(`/api/dms/threads/${t.id}`).expect(200)).body.canSend).toBe(false);
    expect((await send(a, t.id, "still there?").expect(403)).body.details.reason).toBe("BLOCKED");
    expect((await send(b, t.id, "go away").expect(403)).body.details.reason).toBe("BLOCKED");
    // The blocked sender's history disappears for the blocker.
    expect((await as(b).get(`/api/dms/threads/${t.id}/messages`).expect(200)).body.items).toHaveLength(0);
  });

  test("a group with a blocked pair anywhere is refused without saying who", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await sharedCommunity(a, b, c);
    await block(b, c);
    const res = await as(a).post("/api/dms/threads/group").send({ userIds: [b.id, c.id] }).expect(403);
    expect(res.body).toEqual(expect.objectContaining({ code: "DM_NOT_ALLOWED", details: { reason: "BLOCKED" } }));
  });
});

describe("groups", () => {
  test("followers join ACTIVE, others as a request; adding applies the same rules", async () => {
    const [a, b, c, d, stranger] = [await createUser(), await createUser(), await createUser(), await createUser(), await createUser()];
    await sharedCommunity(a, b, c, d);
    await follow(b, a);
    rt.clear();
    const g = await as(a).post("/api/dms/threads/group").send({ userIds: [b.id, c.id], title: "Planning" }).expect(201);
    const state = (id: string) => g.body.participants.find((p: { user: { id: string } }) => p.user.id === id).state;
    expect(state(a.id)).toBe("ACTIVE");
    expect(state(b.id)).toBe("ACTIVE");
    expect(state(c.id)).toBe("REQUESTED");
    expect(rt.to(rooms.user(c.id), "dm:request")).toHaveLength(1);

    const notAllowed = await as(a).post(`/api/dms/threads/${g.body.id}/participants`).send({ userIds: [stranger.id] }).expect(403);
    expect(notAllowed.body.details.reason).toBe("NO_SHARED_COMMUNITY");
    const added = await as(b).post(`/api/dms/threads/${g.body.id}/participants`).send({ userIds: [d.id] }).expect(200);
    expect(added.body.participants).toHaveLength(4);

    await send(a, g.body.id, "welcome").expect(201);
    await as(c).post(`/api/dms/threads/${g.body.id}/leave`).expect(204);
    await as(c).get(`/api/dms/threads/${g.body.id}`).expect(404);
    await as(a).post(`/api/dms/threads/${g.body.id}/participants`).send({ userIds: [] }).expect(400);
  });

  test("a group needs two other people", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    await as(a).post("/api/dms/threads/group").send({ userIds: [b.id] }).expect(400);
  });
});

describe("messages", () => {
  async function accepted() {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    await follow(b, a);
    const t = await open(a, b);
    return { a, b, t };
  }

  test("unread math: per thread and inbox total, read cursor, deleted excluded, muted excluded from the badge", async () => {
    const { a, b, t } = await accepted();
    const ids: string[] = [];
    for (const body of ["one", "two", "three"]) ids.push((await send(a, t.id, body).expect(201)).body.id);
    await send(b, t.id, "mine do not count").expect(201);
    // b replied, so b has read up to its own message; a's three are older.
    expect((await as(b).get(`/api/dms/threads/${t.id}`)).body.unreadCount).toBe(0);
    for (const body of ["four", "five"]) ids.push((await send(a, t.id, body).expect(201)).body.id);
    expect((await as(b).get(`/api/dms/threads/${t.id}`)).body.unreadCount).toBe(2);
    await as(a).delete(`/api/dms/messages/${ids[4]}`).expect(204);
    expect((await as(b).get(`/api/dms/threads/${t.id}`)).body.unreadCount).toBe(1);
    expect((await as(b).get("/api/dms/unread")).body).toEqual({ inbox: 1, requests: 0 });

    await as(b).patch(`/api/dms/threads/${t.id}`).send({ mutedUntil: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    expect((await as(b).get("/api/dms/unread")).body).toEqual({ inbox: 0, requests: 0 });
    expect((await as(b).get(`/api/dms/threads/${t.id}`)).body.mutedUntil).toEqual(expect.any(String));
    await as(b).patch(`/api/dms/threads/${t.id}`).send({ mutedUntil: null }).expect(200);

    rt.clear();
    await as(b).post(`/api/dms/threads/${t.id}/read`).expect(204);
    expect((await as(b).get("/api/dms/unread")).body).toEqual({ inbox: 0, requests: 0 });
    expect(rt.to(rooms.user(a.id), "dm:read")[0]).toMatchObject({ threadId: t.id, userId: b.id });
  });

  test("attachments are upload ids only: another user's upload and an unfinished upload are refused", async () => {
    const { a, b, t } = await accepted();
    const theirs = await upload(b, "DM", "b.png", "image/png", TINY_PNG);
    expect((await send(a, t.id, { body: "x", mediaIds: [theirs.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const pending = await as(a).post("/api/media/uploads").send({ purpose: "DM", fileName: "p.png", mimeType: "image/png", sizeBytes: 10 }).expect(201);
    expect((await send(a, t.id, { body: "x", mediaIds: [pending.body.uploadId] }).expect(400)).body.code).toBe("MEDIA_NOT_READY");
    const chatUpload = await upload(a, "CHAT", "c.png", "image/png", TINY_PNG);
    expect((await send(a, t.id, { mediaIds: [chatUpload.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");

    const mine = await upload(a, "DM", "a.png", "image/png", TINY_PNG);
    const msg = await send(a, t.id, { mediaIds: [mine.uploadId] }).expect(201);
    expect(msg.body.media).toHaveLength(1);
    expect((await as(b).get(`/api/dms/threads/${t.id}/media`).expect(200)).body.items[0].id).toBe(mine.uploadId);
    // Already attached: cannot be reused.
    expect((await send(a, t.id, { mediaIds: [mine.uploadId] }).expect(400)).body.code).toBe("MEDIA_IN_USE");
  });

  test("validation: empty, too long, reply from another thread", async () => {
    const { a, b, t } = await accepted();
    expect((await send(a, t.id, "   ").expect(400)).body.code).toBe("MESSAGE_EMPTY");
    await send(a, t.id, "x".repeat(8001)).expect(400);
    const c = await createUser();
    await sharedCommunity(a, c);
    await follow(c, a);
    const other = await open(a, c);
    const foreign = (await send(a, other.id, "elsewhere").expect(201)).body;
    expect((await send(a, t.id, { body: "re", replyToId: foreign.id }).expect(400)).body.code).toBe("REPLY_INVALID");
    const parent = (await send(b, t.id, "question?").expect(201)).body;
    const reply = await send(a, t.id, { body: "answer", replyToId: parent.id }).expect(201);
    expect(reply.body.replyTo).toMatchObject({ id: parent.id, body: "question?" });
  });

  test("edit and delete are sender only; delete leaves a tombstone; non-participants get 404", async () => {
    const { a, b, t } = await accepted();
    const m = (await send(a, t.id, "original").expect(201)).body;
    await as(b).patch(`/api/dms/messages/${m.id}`).send({ body: "hijack" }).expect(403);
    rt.clear();
    const edited = await as(a).patch(`/api/dms/messages/${m.id}`).send({ body: "edited" }).expect(200);
    expect(edited.body).toMatchObject({ body: "edited", editedAt: expect.any(String) });
    expect(rt.to(rooms.user(b.id), "dm:message:updated")).toHaveLength(1);
    await as(b).delete(`/api/dms/messages/${m.id}`).expect(403);
    await as(a).delete(`/api/dms/messages/${m.id}`).expect(204);
    expect(rt.to(rooms.user(b.id), "dm:message:deleted")[0]).toEqual({ threadId: t.id, messageId: m.id });
    const list = await as(b).get(`/api/dms/threads/${t.id}/messages`).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: m.id, status: "DELETED", body: "", media: [] });
    const outsider = await createUser();
    await as(outsider).get(`/api/dms/threads/${t.id}/messages`).expect(404);
    await as(outsider).patch(`/api/dms/messages/${m.id}`).send({ body: "x" }).expect(404);
  });

  test("reactions, pins, search and keyset paging", async () => {
    const { a, b, t } = await accepted();
    const m = (await send(a, t.id, "the quarterly roadmap draft").expect(201)).body;
    await as(b).put(`/api/dms/messages/${m.id}/reactions/${encodeURIComponent("👍")}`).expect(200);
    const twice = await as(b).put(`/api/dms/messages/${m.id}/reactions/${encodeURIComponent("👍")}`).expect(200);
    expect(twice.body.reactions).toEqual([{ emoji: "👍", count: 1, reactedByViewer: true }]);
    const removed = await as(b).delete(`/api/dms/messages/${m.id}/reactions/${encodeURIComponent("👍")}`).expect(200);
    expect(removed.body.reactions).toEqual([]);
    expect((await as(b).post(`/api/dms/messages/${m.id}/pin`).expect(200)).body.isPinned).toBe(true);
    expect((await as(a).delete(`/api/dms/messages/${m.id}/pin`).expect(200)).body.isPinned).toBe(false);

    for (let i = 0; i < 4; i++) await send(b, t.id, `filler ${i}`).expect(201);
    const found = await as(b).get(`/api/dms/threads/${t.id}/search?q=roadmap`).expect(200);
    expect(found.body.map((x: { id: string }) => x.id)).toEqual([m.id]);

    const p1 = await as(a).get(`/api/dms/threads/${t.id}/messages?limit=3`).expect(200);
    expect(p1.body.items).toHaveLength(3);
    const p2 = await as(a).get(`/api/dms/threads/${t.id}/messages?limit=3&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
    expect(p2.body.items.at(-1).id).toBe(m.id);
  });

  test("GET /threads/:id/pinned: participants only, newest pin first, deleted and unpinned messages drop out", async () => {
    const { a, b, t } = await accepted();
    const first = (await send(a, t.id, "pin me first").expect(201)).body;
    const second = (await send(b, t.id, "pin me second").expect(201)).body;
    const third = (await send(a, t.id, "pinned then deleted").expect(201)).body;
    await send(b, t.id, "never pinned").expect(201);
    expect((await as(a).get(`/api/dms/threads/${t.id}/pinned`).expect(200)).body).toEqual([]);
    await as(b).post(`/api/dms/messages/${first.id}/pin`).expect(200);
    await db.updateTable("dm_messages").set({ pinned_at: new Date(Date.now() - 60_000) }).where("id", "=", first.id).execute();
    await as(a).post(`/api/dms/messages/${second.id}/pin`).expect(200);
    await as(a).post(`/api/dms/messages/${third.id}/pin`).expect(200);
    await as(a).delete(`/api/dms/messages/${third.id}`).expect(204);
    const pinned = await as(b).get(`/api/dms/threads/${t.id}/pinned`).expect(200);
    expect(pinned.body.map((m: { id: string }) => m.id)).toEqual([second.id, first.id]);
    expect(pinned.body[0]).toMatchObject({ roomId: t.id, isPinned: true, body: "pin me second", sender: { id: b.id } });
    await as(a).delete(`/api/dms/messages/${second.id}/pin`).expect(200);
    expect((await as(a).get(`/api/dms/threads/${t.id}/pinned`).expect(200)).body.map((m: { id: string }) => m.id)).toEqual([first.id]);

    // Outsiders and signed-out callers learn nothing.
    const outsider = await createUser();
    expect((await as(outsider).get(`/api/dms/threads/${t.id}/pinned`).expect(404)).body.code).toBe("THREAD_NOT_FOUND");
    await as(null).get(`/api/dms/threads/${t.id}/pinned`).expect(401);
  });

  test("a suspended account cannot send", async () => {
    const { b, t } = await accepted();
    const s = await createUser({ status: "SUSPENDED" });
    await join(s, (await sharedCommunity(b)).id);
    expect((await send(s, t.id, "x").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("thread list and contacts", () => {
  test("inbox is ordered by latest activity and pages with a cursor; last message and participants are filled", async () => {
    const me = await createUser();
    const others = [await createUser(), await createUser(), await createUser()];
    await sharedCommunity(me, ...others);
    for (const o of others) await follow(o, me);
    const threads = [];
    for (const o of others) threads.push(await open(me, o));
    await send(me, threads[0].id, "latest").expect(201);
    const p1 = await as(me).get("/api/dms/threads?limit=2").expect(200);
    expect(p1.body.items[0]).toMatchObject({ id: threads[0].id, lastMessage: { body: "latest" } });
    expect(p1.body.items[0].participants).toHaveLength(2);
    const p2 = await as(me).get(`/api/dms/threads?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect([...p1.body.items, ...p2.body.items].map((x: { id: string }) => x.id).sort()).toEqual(threads.map((x) => x.id).sort());
  });

  test("contacts: people you can message now, never blocked ones or strangers", async () => {
    const [me, friend, blocked, nobody, stranger] = [await createUser(), await createUser(), await createUser(), await createUser({ dmPrivacy: "NOBODY" }), await createUser()];
    await sharedCommunity(me, friend, blocked, nobody);
    await block(me, blocked);
    void stranger;
    const res = await as(me).get("/api/dms/contacts").expect(200);
    const ids = res.body.map((c: { user: { id: string } }) => c.user.id);
    expect(ids).toContain(friend.id);
    expect(ids).not.toContain(blocked.id);
    expect(ids).not.toContain(nobody.id);
    expect(ids).not.toContain(stranger.id);
    expect(res.body[0]).toMatchObject({ online: false });
  });
});
