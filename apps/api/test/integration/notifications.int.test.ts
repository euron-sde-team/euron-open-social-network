import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { as, createUser, recordRealtime } from "./harness";
import { allPages, makePost, world } from "./social-fixtures";

describe("notifications", () => {
  test("inbox, unread badge, mark read, read all; badge pushed over realtime", async () => {
    const { community, members } = await world({ members: 2 });
    const [author, fan] = members;
    const post = await makePost(author!, community.id);
    await as(fan!).post(`/api/posts/${post.id}/comments`).send({ body: "first!" }).expect(201);
    await as(fan!).post(`/api/users/${author!.id}/follow`).expect(204);
    const list = await as(author!).get("/api/notifications").expect(200);
    expect(list.body.items.map((n: { type: string }) => n.type)).toEqual(["FOLLOW", "POST_COMMENT"]);
    const follow = list.body.items[0];
    expect(follow.href).toBe(`/u/${fan!.username}`);
    expect(follow.actor.id).toBe(fan!.id);
    expect((await as(author!).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 2 });

    const rt = recordRealtime();
    await as(author!).post(`/api/notifications/${follow.id}/read`).expect(204);
    expect(rt.to(`user:${author!.id}`, "notification:count")).toEqual([{ unread: 1 }]);
    const unread = await as(author!).get("/api/notifications?unread=true").expect(200);
    expect(unread.body.items.map((n: { type: string }) => n.type)).toEqual(["POST_COMMENT"]);
    await as(fan!).post(`/api/notifications/${follow.id}/read`).expect(404);
    await as(author!).post("/api/notifications/read-all").expect(204);
    expect((await as(author!).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 0 });
  });

  test("never to yourself, never across a block, and hidden after a later block", async () => {
    const { community, members } = await world({ members: 3 });
    const [a, b, c] = members;
    const post = await makePost(a!, community.id);
    await as(a!).post(`/api/posts/${post.id}/comments`).send({ body: "self" }).expect(201);
    expect((await as(a!).get("/api/notifications").expect(200)).body.items).toEqual([]);
    await as(a!).post(`/api/users/${b!.id}/block`).expect(204);
    await as(b!).post(`/api/users/${a!.id}/follow`).expect(404);
    await as(c!).post(`/api/users/${a!.id}/follow`).expect(204);
    expect((await as(a!).get("/api/notifications").expect(200)).body.items).toHaveLength(1);
    await as(a!).post(`/api/users/${c!.id}/block`).expect(204);
    expect((await as(a!).get("/api/notifications").expect(200)).body.items).toEqual([]);
  });

  test("snippets from a private community are withheld once you leave it", async () => {
    const { community, members } = await world({ members: 2, visibility: "PRIVATE" });
    const [a, b] = members;
    const post = await makePost(a!, community.id);
    await as(b!).post(`/api/posts/${post.id}/comments`).send({ body: "secret plans for the launch" }).expect(201);
    let items = (await as(a!).get("/api/notifications").expect(200)).body.items;
    expect(items[0].snippet).toBe("secret plans for the launch");
    expect(items[0].href).toContain(`/posts/${post.id}`);
    await as(a!).post(`/api/communities/${community.id}/leave`).expect(204);
    items = (await as(a!).get("/api/notifications").expect(200)).body.items;
    expect(items[0].snippet).toBeNull();
  });

  test("the inbox pages through every row once", async () => {
    const target = await createUser();
    for (let i = 0; i < 7; i++) await as(await createUser()).post(`/api/users/${target.id}/follow`).expect(204);
    // Same-millisecond timestamps must not lose rows.
    await db.updateTable("notifications").set({ created_at: new Date("2026-02-02T00:00:00.000Z") }).where("recipient_id", "=", target.id).execute();
    const all = await allPages(async (c) => (await as(target).get(`/api/notifications?limit=3${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(new Set(all.map((n: { id: string }) => n.id)).size).toBe(7);
    expect(all).toHaveLength(7);
  });
});
