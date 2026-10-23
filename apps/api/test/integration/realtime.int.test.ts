import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { io as connectClient, type Socket } from "socket.io-client";
import { db } from "../../src/db/kysely";
import { listenWithGateway } from "../../src/realtime/gateway";
import { app, as, createUser, type TestUser } from "./harness";
import { block, createCommunity, follow, join, sharedCommunity, waitFor } from "./messaging-fixtures";

type Server = Awaited<ReturnType<typeof listenWithGateway>>;
let main: Server;
let second: Server;
const sockets: Socket[] = [];

beforeAll(async () => {
  main = await listenWithGateway(app, { revalidateMs: 300 });
  // A second API task sharing Redis; it does not install itself as the emit transport, so
  // anything it delivers must have crossed the Redis adapter.
  second = await listenWithGateway(app, { installTransport: false });
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await second.close();
  await main.close();
});

function connect(user: TestUser | { token: string } | null, url = main.url): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connectClient(url, { path: "/socket.io", transports: ["websocket"], reconnection: false, forceNew: true, auth: user ? { token: user.token } : {} });
    sockets.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (err) => reject(err));
  });
}

/** Collect every event of one name a socket receives. */
function collect<T = any>(s: Socket, event: string): T[] {
  const got: T[] = [];
  s.on(event, (p: T) => got.push(p));
  return got;
}

function ack<T = any>(s: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function friends() {
  const [a, b] = [await createUser(), await createUser()];
  await sharedCommunity(a, b);
  await follow(b, a);
  await follow(a, b);
  const t = (await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200)).body;
  return { a, b, t };
}

describe("authentication", () => {
  test("a missing or bad token is rejected with the failure code", async () => {
    await expect(connect(null)).rejects.toThrow("MISSING");
    await expect(connect({ token: "garbage" })).rejects.toThrow("INVALID");
    const banned = await createUser({ status: "BANNED" });
    await expect(connect(banned)).rejects.toThrow("BANNED");
  });
});

describe("handshake path", () => {
  test("answers /socket.io with and without the trailing slash (the web dev proxy drops it)", async () => {
    for (const path of ["/socket.io/", "/socket.io"]) {
      const res = await fetch(`${main.url}${path}?EIO=4&transport=polling`);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toMatch(/^0\{"sid":/);
    }
  });
});

describe("DM delivery", () => {
  test("dm:message reaches the recipient's sockets and the sender's other tabs, nobody else", async () => {
    const { a, b, t } = await friends();
    const outsider = await createUser();
    const [aTab, bTab1, bTab2, out] = [await connect(a), await connect(b), await connect(b), await connect(outsider)];
    const got = { a: collect(aTab, "dm:message"), b1: collect(bTab1, "dm:message"), b2: collect(bTab2, "dm:message"), out: collect(out, "dm:message") };
    const msg = (await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "ping" }).expect(201)).body;
    await waitFor(() => got.b1.length && got.b2.length && got.a.length);
    expect(got.b1[0]).toMatchObject({ threadId: t.id, message: { id: msg.id, body: "ping" } });
    await pause(100);
    expect(got.out).toHaveLength(0);
  });

  test("nothing crosses a block: no delivery, no typing, and presence is not disclosed", async () => {
    const { a, b, t } = await friends();
    const [sa, sb] = [await connect(a), await connect(b)];
    const msgs = collect(sb, "dm:message");
    const typing = collect(sb, "dm:typing");
    await block(b, a);
    await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "hello?" }).expect(403);
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    await pause(150);
    expect(msgs).toHaveLength(0);
    expect(typing).toHaveLength(0);
    const p = await ack(sb, "presence:query", { userIds: [a.id] });
    expect(p).toEqual({ ok: true, data: {} });
  });

  test("delivered through a second API task over the Redis adapter", async () => {
    const { a, b, t } = await friends();
    const onSecond = await connect(b, second.url);
    const got = collect(onSecond, "dm:message");
    await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "cross-task" }).expect(201);
    await waitFor(() => got.length);
    expect(got[0].message.body).toBe("cross-task");
  });
});

describe("subscriptions", () => {
  test("chat:subscribe: members yes; non-members and private communities no", async () => {
    const pub = await createCommunity();
    const priv = await createCommunity({ visibility: "PRIVATE" });
    const [member, outsider] = [await createUser(), await createUser()];
    await join(member, pub.id);
    const [sm, so] = [await connect(member), await connect(outsider)];
    expect(await ack(sm, "chat:subscribe", { communityId: pub.id })).toEqual({ ok: true });
    expect(await ack(so, "chat:subscribe", { communityId: pub.id })).toMatchObject({ ok: false, code: "NOT_A_MEMBER" });
    expect(await ack(so, "chat:subscribe", { communityId: priv.id })).toMatchObject({ ok: false, code: "NOT_A_MEMBER" });
    expect(await ack(so, "community:subscribe", { communityId: priv.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await ack(so, "community:subscribe", { communityId: pub.id })).toEqual({ ok: true });
    expect(await ack(so, "chat:subscribe", { communityId: "not-an-id" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

    const live = collect(sm, "chat:message");
    const leaked = collect(so, "chat:message");
    await as(member).post(`/api/chat/${pub.id}/messages`).send({ body: "room message" }).expect(201);
    await waitFor(() => live.length);
    await pause(50);
    expect(leaked).toHaveLength(0);
  });

  test("thread:subscribe is for participants only", async () => {
    const { a, t } = await friends();
    const outsider = await createUser();
    expect(await ack(await connect(a), "thread:subscribe", { threadId: t.id })).toEqual({ ok: true });
    expect(await ack(await connect(outsider), "thread:subscribe", { threadId: t.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("typing", () => {
  test("dm:typing reaches the other participant; repeats inside the throttle window are dropped", async () => {
    const { a, b, t } = await friends();
    const [sa, sb] = [await connect(a), await connect(b)];
    const got = collect(sb, "dm:typing");
    const self = collect(sa, "dm:typing");
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    sa.emit("dm:typing", { threadId: t.id, typing: false });
    await waitFor(() => got.length >= 2);
    await pause(100);
    expect(got).toEqual([
      { threadId: t.id, userId: a.id, typing: true },
      { threadId: t.id, userId: a.id, typing: false },
    ]);
    expect(self).toHaveLength(0);
  });

  test("chat:typing goes to the room with the display name, only after subscribing", async () => {
    const c = await createCommunity();
    const [a, b] = [await createUser({ displayName: "Typing Tester" }), await createUser()];
    await join(a, c.id);
    await join(b, c.id);
    const [sa, sb] = [await connect(a), await connect(b)];
    const got = collect(sb, "chat:typing");
    sa.emit("chat:typing", { communityId: c.id, typing: true });
    await pause(100);
    expect(got).toHaveLength(0);
    await ack(sa, "chat:subscribe", { communityId: c.id });
    await ack(sb, "chat:subscribe", { communityId: c.id });
    sa.emit("chat:typing", { communityId: c.id, typing: true });
    await waitFor(() => got.length);
    expect(got[0]).toEqual({ communityId: c.id, userId: a.id, displayName: "Typing Tester", typing: true });
  });
});

describe("presence", () => {
  test("online and offline flips reach followers; presence:query answers; last_seen_at is recorded", async () => {
    const [a, watcher] = [await createUser(), await createUser()];
    await follow(watcher, a);
    const sw = await connect(watcher);
    const updates = collect(sw, "presence:update");
    const sa = await connect(a);
    await waitFor(() => updates.some((u) => u.userId === a.id && u.online));
    expect(await ack(sw, "presence:query", { userIds: [a.id] })).toEqual({ ok: true, data: { [a.id]: true } });
    // A second tab does not flip anything.
    const sa2 = await connect(a);
    sa2.disconnect();
    await pause(150);
    expect(updates.filter((u) => u.userId === a.id)).toHaveLength(1);
    sa.disconnect();
    await waitFor(() => updates.some((u) => u.userId === a.id && !u.online));
    expect(updates.at(-1)).toMatchObject({ userId: a.id, online: false, lastSeenAt: expect.any(String) });
    const row = await db.selectFrom("users").select("last_seen_at").where("id", "=", a.id).executeTakeFirstOrThrow();
    expect(row.last_seen_at).toBeInstanceOf(Date);
    expect(await ack(sw, "presence:query", { userIds: [a.id] })).toEqual({ ok: true, data: { [a.id]: false } });
  });

  test("contacts report who is online", async () => {
    const [me, friend] = [await createUser(), await createUser()];
    await sharedCommunity(me, friend);
    await connect(friend);
    const res = await as(me).get("/api/dms/contacts").expect(200);
    expect(res.body.find((c: { user: { id: string } }) => c.user.id === friend.id)).toMatchObject({ online: true });
  });
});

describe("revocation", () => {
  test("a ban sends session:revoked and disconnects every socket of the user", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const target = await createUser();
    const [s1, s2] = [await connect(target), await connect(target)];
    const revoked = collect(s1, "session:revoked");
    const closed = new Promise<void>((r) => s2.once("disconnect", () => r()));
    await as(admin).post(`/api/admin/users/${target.id}/ban`).send({ reason: "spam ring" }).expect(200);
    await closed;
    await waitFor(() => !s1.connected);
    expect(revoked).toEqual([{ reason: "BANNED" }]);
    const sessions = await db.selectFrom("sessions").select("id").where("user_id", "=", target.id).where("revoked_at", "is", null).execute();
    expect(sessions).toHaveLength(0);
    await expect(connect(target)).rejects.toThrow();
  });

  test("periodic re-validation drops a socket whose token version was bumped", async () => {
    const u = await createUser();
    const s = await connect(u);
    const revoked = collect(s, "session:revoked");
    await db.updateTable("users").set((eb) => ({ token_version: eb("token_version", "+", 1) })).where("id", "=", u.id).execute();
    await waitFor(() => !s.connected, 3000);
    expect(revoked[0]).toEqual({ reason: "SIGNED_OUT" });
  });
});

describe("room revocation", () => {
  /** Rooms a user's sockets are in right now, across both tasks. */
  async function roomsOf(user: TestUser): Promise<Set<string>> {
    const sockets = await main.gateway.io.in(`user:${user.id}`).fetchSockets();
    return new Set(sockets.flatMap((s) => [...s.rooms]));
  }

  async function chatMember() {
    const c = await createCommunity();
    const [owner, member] = [await createUser(), await createUser()];
    await join(owner, c.id, "OWNER");
    await join(member, c.id);
    const s = await connect(member);
    expect(await ack(s, "chat:subscribe", { communityId: c.id })).toEqual({ ok: true });
    expect(await ack(s, "community:subscribe", { communityId: c.id })).toEqual({ ok: true });
    return { c, owner, member, s };
  }

  test("leaving a community takes the sockets out of its chat and community rooms at once", async () => {
    const { c, owner, member, s } = await chatMember();
    const live = collect(s, "chat:message");
    await as(member).post(`/api/communities/${c.id}/leave`).expect(204);
    await waitFor(async () => !(await roomsOf(member)).has(`chat:${c.id}`));
    expect((await roomsOf(member)).has(`community:${c.id}`)).toBe(false);
    await as(owner).post(`/api/chat/${c.id}/messages`).send({ body: "after you left" }).expect(201);
    await pause(150);
    expect(live).toHaveLength(0);
    // And the subscribe rule keeps them out.
    expect(await ack(s, "chat:subscribe", { communityId: c.id })).toMatchObject({ ok: false, code: "NOT_A_MEMBER" });
  });

  test("a community ban, a suspension or a removal does the same", async () => {
    for (const how of ["ban", "suspend", "remove"] as const) {
      const { c, owner, member } = await chatMember();
      if (how === "ban") await as(owner).post(`/api/communities/${c.id}/members/${member.id}/ban`).send({}).expect(200);
      if (how === "suspend") await as(owner).post(`/api/communities/${c.id}/members/${member.id}/suspend`).send({ days: 3 }).expect(200);
      if (how === "remove") await as(owner).delete(`/api/communities/${c.id}/members/${member.id}`).expect(204);
      await waitFor(async () => !(await roomsOf(member)).has(`chat:${c.id}`));
      expect((await roomsOf(member)).has(`community:${c.id}`)).toBe(false);
    }
  });

  test("leaving a group thread leaves its room; a block closes the 1:1 thread room for both", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await sharedCommunity(a, b, c);
    await follow(b, a);
    await follow(c, a);
    const group = (await as(a).post("/api/dms/threads/group").send({ userIds: [b.id, c.id] }).expect(201)).body;
    const sb = await connect(b);
    expect(await ack(sb, "thread:subscribe", { threadId: group.id })).toEqual({ ok: true });
    await as(b).post(`/api/dms/threads/${group.id}/leave`).expect(204);
    await waitFor(async () => !(await roomsOf(b)).has(`thread:${group.id}`));

    const { a: x, b: y, t } = await friends();
    const [sx, sy] = [await connect(x), await connect(y)];
    await ack(sx, "thread:subscribe", { threadId: t.id });
    await ack(sy, "thread:subscribe", { threadId: t.id });
    await as(y).post(`/api/users/${x.id}/block`).expect(204);
    await waitFor(async () => !(await roomsOf(x)).has(`thread:${t.id}`) && !(await roomsOf(y)).has(`thread:${t.id}`));
  });
});

describe("sign-out disconnects sockets", () => {
  test("sign out everywhere and a password change end every socket with SIGNED_OUT", async () => {
    for (const how of ["logout-all", "change-password"] as const) {
      const u = await createUser();
      const s = await connect(u);
      const revoked = collect(s, "session:revoked");
      if (how === "logout-all") await as(u).post("/api/auth/logout-all").expect(204);
      else await as(u).post("/api/auth/change-password").send({ currentPassword: "correct-horse-battery-staple", newPassword: "an-even-better-passphrase" }).expect(204);
      await waitFor(() => !s.connected);
      expect(revoked).toEqual([{ reason: "SIGNED_OUT" }]);
    }
  });
});

describe("presence scope", () => {
  test("presence:query answers only for people the viewer could know about", async () => {
    const [viewer, member, followed, follower, stranger] = [await createUser(), await createUser(), await createUser(), await createUser(), await createUser()];
    await sharedCommunity(viewer, member);
    await follow(viewer, followed);
    await follow(follower, viewer);
    for (const u of [member, followed, follower, stranger]) await connect(u);
    const sv = await connect(viewer);
    await waitFor(async () => {
      const res = await ack(sv, "presence:query", { userIds: [member.id] });
      return res.data?.[member.id] === true;
    });
    const res = await ack(sv, "presence:query", { userIds: [member.id, followed.id, follower.id, stranger.id] });
    expect(res).toEqual({ ok: true, data: { [member.id]: true, [followed.id]: true, [follower.id]: true } });
  });
});

describe("socket abuse limits", () => {
  test("more than 30 subscribe or presence requests in 10 seconds answer RATE_LIMITED", async () => {
    const u = await createUser();
    const s = await connect(u);
    const answers = [];
    for (let i = 0; i < 31; i++) answers.push(await ack(s, "community:subscribe", { communityId: "not-an-id" }));
    expect(answers[29]).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(answers[30]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(await ack(s, "presence:query", { userIds: [] })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  test("the 21st live socket of one user is refused with TOO_MANY_CONNECTIONS", async () => {
    const u = await createUser();
    const opened: Socket[] = [];
    for (let i = 0; i < 20; i++) opened.push(await connect(u));
    const { liveSocketCount } = await import("../../src/realtime/presence");
    await waitFor(async () => (await liveSocketCount(u.id)) === 20);
    await expect(connect(u)).rejects.toThrow("TOO_MANY_CONNECTIONS");
    opened[0]!.disconnect();
    await waitFor(async () => (await liveSocketCount(u.id)) === 19);
    await connect(u);
  });
});
