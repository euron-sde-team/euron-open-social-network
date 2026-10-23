import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime } from "./harness";
import { allPages, makePost, notificationsOf, world } from "./social-fixtures";

const postCounts = async (id: string) => db.selectFrom("posts").select(["comment_count"]).where("id", "=", id).executeTakeFirstOrThrow();

describe("comments", () => {
  test("comment and reply: counters, points, notifications with hrefs, realtime after commit", async () => {
    const { community, members } = await world({ members: 3 });
    const [author, commenter, replier] = members;
    const post = await makePost(author!, community.id);
    const rt = recordRealtime();
    const c = (await as(commenter!).post(`/api/posts/${post.id}/comments`).send({ body: "Great point" }).expect(201)).body;
    expect(c).toMatchObject({ postId: post.id, parentId: null, replyCount: 0, status: "PUBLISHED" });
    expect(rt.to(`post:${post.id}`, "post:comment").map((e) => e.comment.id)).toEqual([c.id]);
    expect(rt.to(`post:${post.id}`, "post:updated").at(-1)).toMatchObject({ commentCount: 1 });
    const r = (await as(replier!).post(`/api/posts/${post.id}/comments`).send({ body: "Agreed", parentId: c.id }).expect(201)).body;
    expect(r.parentId).toBe(c.id);
    // Replying to a reply attaches to the same top-level comment.
    const rr = (await as(author!).post(`/api/posts/${post.id}/comments`).send({ body: "Thanks both", parentId: r.id }).expect(201)).body;
    expect(rr.parentId).toBe(c.id);

    expect(await postCounts(post.id)).toEqual({ comment_count: 3 });
    expect((await db.selectFrom("comments").select("reply_count").where("id", "=", c.id).executeTakeFirstOrThrow()).reply_count).toBe(2);
    expect((await db.selectFrom("users").select("reputation").where("id", "=", commenter!.id).executeTakeFirstOrThrow()).reputation).toBe(2);

    const toAuthor = rt.to(`user:${author!.id}`, "notification:new");
    expect(toAuthor.map((n) => n.type)).toEqual(["POST_COMMENT", "POST_COMMENT"]);
    expect(toAuthor[0]!.href).toBe(`/posts/${post.id}?comment=${c.id}`);
    const toCommenter = rt.to(`user:${commenter!.id}`, "notification:new");
    expect(toCommenter.map((n) => n.type)).toEqual(["COMMENT_REPLY"]);
    const toReplier = rt.to(`user:${replier!.id}`, "notification:new");
    expect(toReplier.map((n) => n.type)).toEqual(["COMMENT_REPLY"]);
    // Nobody is notified about their own comment.
    expect(rt.to(`user:${author!.id}`, "notification:new").some((n) => n.actor?.id === author!.id)).toBe(false);

    const top = await anon().get(`/api/posts/${post.id}/comments`).expect(200);
    expect(top.body.items.map((x: { id: string }) => x.id)).toEqual([c.id]);
    const replies = await anon().get(`/api/comments/${c.id}/replies`).expect(200);
    expect(replies.body.items.map((x: { id: string }) => x.id)).toEqual([r.id, rr.id]);
  });

  test("comment pages are oldest first and complete", async () => {
    const { community, members } = await world({ members: 1 });
    const post = await makePost(members[0]!, community.id);
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push((await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: `c${i}` }).expect(201)).body.id);
    const all = await allPages(async (c) => (await anon().get(`/api/posts/${post.id}/comments?limit=3${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(all.map((x: { id: string }) => x.id)).toEqual(ids);
  });

  test("edit by the author only; delete by author or mod adjusts counts", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const post = await makePost(members[0]!, community.id);
    const c = (await as(members[1]!).post(`/api/posts/${post.id}/comments`).send({ body: "typo" }).expect(201)).body;
    const reply = (await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: "reply", parentId: c.id }).expect(201)).body;
    await as(members[0]!).patch(`/api/comments/${c.id}`).send({ body: "nope" }).expect(403);
    const edited = await as(members[1]!).patch(`/api/comments/${c.id}`).send({ body: "fixed" }).expect(200);
    expect(edited.body.editedAt).not.toBeNull();
    await as(members[0]!).delete(`/api/comments/${c.id}`).expect(403);
    await as(owner).delete(`/api/comments/${reply.id}`).expect(204);
    expect((await db.selectFrom("comments").select("reply_count").where("id", "=", c.id).executeTakeFirstOrThrow()).reply_count).toBe(0);
    await as(members[1]!).delete(`/api/comments/${c.id}`).expect(204);
    expect(await postCounts(post.id)).toEqual({ comment_count: 0 });
    expect((await db.selectFrom("users").select("reputation").where("id", "=", members[1]!.id).executeTakeFirstOrThrow()).reputation).toBe(0);
    await anon().get(`/api/comments/${c.id}/replies`).expect(404);
  });

  test("a comment hidden by moderation drops out of lists and counts after reconcile", async () => {
    const { community, members } = await world({ members: 1 });
    const post = await makePost(members[0]!, community.id);
    const c = (await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: "hidden soon" }).expect(201)).body;
    await db.updateTable("comments").set({ status: "HIDDEN" }).where("id", "=", c.id).execute();
    expect((await anon().get(`/api/posts/${post.id}/comments`).expect(200)).body.items).toEqual([]);
    const { reconcileCounters } = await import("../../src/services/counters.service");
    await reconcileCounters();
    expect(await postCounts(post.id)).toEqual({ comment_count: 0 });
  });

  test("comment reactions: +1 point to the author and a COMMENT_REACTION notification", async () => {
    const { community, members } = await world({ members: 2 });
    const post = await makePost(members[0]!, community.id);
    const c = (await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: "react to me" }).expect(201)).body;
    const res = await as(members[1]!).put(`/api/comments/${c.id}/reaction`).send({ type: "CARE" }).expect(200);
    expect(res.body).toEqual({ reactionCount: 1, reactionCounts: { CARE: 1 }, viewerReaction: "CARE" });
    expect((await db.selectFrom("users").select("reputation").where("id", "=", members[0]!.id).executeTakeFirstOrThrow()).reputation).toBe(5 + 2 + 1);
    const n = (await notificationsOf(members[0]!.id)).find((x) => x.type === "COMMENT_REACTION");
    expect(n?.entity_id).toBe(c.id);
    await as(members[1]!).delete(`/api/comments/${c.id}/reaction`).expect(200);
    expect((await db.selectFrom("users").select("reputation").where("id", "=", members[0]!.id).executeTakeFirstOrThrow()).reputation).toBe(7);
  });

  test("mentions in comments notify readers only", async () => {
    const { community, members } = await world({ members: 2, visibility: "PRIVATE" });
    const outsider = await createUser();
    const post = await makePost(members[0]!, community.id);
    await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: `@${members[1]!.username} and @${outsider.username} look` }).expect(201);
    expect((await notificationsOf(members[1]!.id)).some((n) => n.type === "MENTION")).toBe(true);
    expect((await notificationsOf(outsider.id)).some((n) => n.type === "MENTION")).toBe(false);
  });
});
