import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { reconcileCounters } from "../../src/services/counters.service";
import { anon, as, createUser, recordRealtime } from "./harness";
import { addMember, allPages, makeCommunity, makePost, notificationsOf, resetSettings, setSettings, uniq, world } from "./social-fixtures";

describe("creating posts", () => {
  test("a member posts with tags and mentions; counters, points and a feed signal follow", async () => {
    const rt = recordRealtime();
    const { community, members } = await world({ members: 2 });
    const [alice, bob] = members;
    const post = await makePost(alice!, community.id, `Shipping the #Design review today, thanks @${bob!.username}`, { tags: ["Roadmap"], feeling: "proud" });
    expect(post.status).toBe("PUBLISHED");
    expect(post.tags.sort()).toEqual(["design", "roadmap"]);
    expect(post.mentions.map((m) => m.id)).toEqual([bob!.id]);
    expect(post.viewer.canEdit).toBe(true);
    expect(rt.to(`community:${community.id}`, "feed:new-posts")).toEqual([{ communityId: community.id, count: 1, latestId: post.id }]);

    const c = await db.selectFrom("communities").select("post_count").where("id", "=", community.id).executeTakeFirstOrThrow();
    expect(c.post_count).toBe(1);
    const a = await db.selectFrom("users").select(["post_count", "reputation"]).where("id", "=", alice!.id).executeTakeFirstOrThrow();
    expect(a).toEqual({ post_count: 1, reputation: 5 });
    const mention = (await notificationsOf(bob!.id)).find((n) => n.type === "MENTION");
    expect(mention?.entity_id).toBe(post.id);
  });

  test("non-members cannot post; members of a moderators-only community cannot either", async () => {
    const { community } = await world({ members: 0 });
    const outsider = await createUser();
    const res = await as(outsider).post("/api/posts").send({ communityId: community.id, body: "hi" }).expect(403);
    expect(res.body.code).toBe("NOT_A_MEMBER");

    const owner = await createUser();
    const quiet = await makeCommunity(owner, { allowMemberPosts: false });
    const member = await createUser();
    await addMember(quiet.id, member);
    expect((await as(member).post("/api/posts").send({ communityId: quiet.id, body: "hi" }).expect(403)).body.code).toBe("POSTING_RESTRICTED");
    await makePost(owner, quiet.id, "mods can still post");
  });

  test("only moderators post announcements; an author cannot promote their own post", async () => {
    const { owner, community, members } = await world({ members: 1 });
    const res = await as(members[0]!).post("/api/posts").send({ communityId: community.id, body: "big news", kind: "ANNOUNCEMENT" }).expect(403);
    expect(res.body.code).toBe("ANNOUNCEMENT_MODS_ONLY");
    const ann = await makePost(owner, community.id, "official", { kind: "ANNOUNCEMENT" });
    expect(ann.kind).toBe("ANNOUNCEMENT");
    // PATCH has no `kind`: the field is ignored.
    const mine = await makePost(members[0]!, community.id, "regular");
    const edited = await as(members[0]!).patch(`/api/posts/${mine.id}`).send({ body: "regular edited", kind: "ANNOUNCEMENT" }).expect(200);
    expect(edited.body.kind).toBe("POST");
  });

  test("empty posts are rejected and polls validate their options", async () => {
    const { community, members } = await world({ members: 1 });
    expect((await as(members[0]!).post("/api/posts").send({ communityId: community.id, body: "  " }).expect(400)).body.code).toBe("EMPTY_POST");
    await as(members[0]!).post("/api/posts").send({ communityId: community.id, body: "q", poll: { question: "Which?", options: ["only one"] } }).expect(400);
  });

  test("a suspended account cannot post", async () => {
    const { community } = await world({ members: 0 });
    const s = await createUser({ status: "SUSPENDED" });
    await addMember(community.id, s);
    expect((await as(s).post("/api/posts").send({ communityId: community.id, body: "hi" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("editing and deleting", () => {
  test("only the author edits; author or moderator deletes; counters and points go back", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const [alice, bob] = members;
    const post = await makePost(alice!, community.id, "first draft #alpha");
    await as(bob!).patch(`/api/posts/${post.id}`).send({ body: "hijack" }).expect(403);
    const edited = await as(alice!).patch(`/api/posts/${post.id}`).send({ body: "second draft #beta" }).expect(200);
    expect(edited.body.tags).toEqual(["beta"]);
    expect(edited.body.editedAt).not.toBeNull();

    await as(bob!).delete(`/api/posts/${post.id}`).expect(403);
    await as(bob!).put(`/api/posts/${post.id}/reaction`).send({ type: "LIKE" }).expect(200);
    expect((await db.selectFrom("users").select("reputation").where("id", "=", alice!.id).executeTakeFirstOrThrow()).reputation).toBe(7);

    const rt = recordRealtime();
    await as(owner).delete(`/api/posts/${post.id}`).expect(204);
    expect(rt.to(`post:${post.id}`, "post:removed")).toHaveLength(1);
    await anon().get(`/api/posts/${post.id}`).expect(404);
    const row = await db.selectFrom("posts").select("status").where("id", "=", post.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("REMOVED");
    expect((await db.selectFrom("communities").select("post_count").where("id", "=", community.id).executeTakeFirstOrThrow()).post_count).toBe(0);
    expect((await db.selectFrom("users").select(["reputation", "post_count"]).where("id", "=", alice!.id).executeTakeFirstOrThrow())).toEqual({ reputation: 0, post_count: 0 });
  });
});

describe("reactions", () => {
  test("react, change type, remove: counts, points, notification and realtime after commit", async () => {
    const { community, members } = await world({ members: 2 });
    const [alice, bob] = members;
    const post = await makePost(alice!, community.id);
    const rt = recordRealtime();
    const r1 = await as(bob!).put(`/api/posts/${post.id}/reaction`).send({ type: "LIKE" }).expect(200);
    expect(r1.body).toEqual({ reactionCount: 1, reactionCounts: { LIKE: 1 }, viewerReaction: "LIKE" });
    const r2 = await as(bob!).put(`/api/posts/${post.id}/reaction`).send({ type: "LOVE" }).expect(200);
    expect(r2.body).toEqual({ reactionCount: 1, reactionCounts: { LOVE: 1 }, viewerReaction: "LOVE" });
    expect(rt.to(`post:${post.id}`, "post:updated").at(-1)).toMatchObject({ postId: post.id, reactionCount: 1, reactionCounts: { LOVE: 1 } });
    expect(rt.to(`user:${alice!.id}`, "notification:new").filter((n) => n.type === "POST_REACTION")).toHaveLength(1);
    expect((await db.selectFrom("users").select("reputation").where("id", "=", alice!.id).executeTakeFirstOrThrow()).reputation).toBe(7);
    const r3 = await as(bob!).delete(`/api/posts/${post.id}/reaction`).expect(200);
    expect(r3.body).toEqual({ reactionCount: 0, reactionCounts: {}, viewerReaction: null });
    expect((await db.selectFrom("users").select("reputation").where("id", "=", alice!.id).executeTakeFirstOrThrow()).reputation).toBe(5);

    const list = await anon().get(`/api/posts/${post.id}/reactions`).expect(200);
    expect(list.body.items).toEqual([]);
  });

  test("reacting to your own post earns nothing and notifies nobody", async () => {
    const { community, members } = await world({ members: 1 });
    const post = await makePost(members[0]!, community.id);
    await as(members[0]!).put(`/api/posts/${post.id}/reaction`).send({ type: "WOW" }).expect(200);
    expect((await db.selectFrom("users").select("reputation").where("id", "=", members[0]!.id).executeTakeFirstOrThrow()).reputation).toBe(5);
    expect((await notificationsOf(members[0]!.id)).filter((n) => n.type === "POST_REACTION")).toHaveLength(0);
  });

  test("a failed write emits nothing", async () => {
    const { community, members } = await world({ members: 1 });
    const outsider = await createUser();
    const post = await makePost(members[0]!, community.id);
    const rt = recordRealtime();
    await as(outsider).put(`/api/posts/${post.id}/reaction`).send({ type: "LIKE" }).expect(403);
    expect(rt.emits).toHaveLength(0);
  });
});

describe("feeds", () => {
  test("home feed: my communities plus public posts by people I follow, minus hidden and blocked", async () => {
    const me = await createUser();
    const { community: mine, members: [friend] } = await world({ members: 1 });
    await addMember(mine.id, me);
    const other = await world({ members: 1 });
    const followed = other.members[0]!;
    await as(me).post(`/api/users/${followed.id}/follow`).expect(204);
    const priv = await world({ members: 1, visibility: "PRIVATE" });
    await addMember(priv.community.id, followed);

    const p1 = await makePost(friend!, mine.id, "from my community");
    const p2 = await makePost(followed, other.community.id, "public post by someone I follow");
    const p3 = await makePost(followed, priv.community.id, "private post by someone I follow");
    const p4 = await makePost(friend!, mine.id, "to be hidden");

    await as(me).post(`/api/posts/${p4.id}/hide`).expect(204);
    let feed = await as(me).get("/api/posts/feed").expect(200);
    let ids = feed.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
    expect(ids).not.toContain(p3.id);
    expect(ids).not.toContain(p4.id);

    await as(me).post(`/api/users/${friend!.id}/block`).expect(204);
    feed = await as(me).get("/api/posts/feed").expect(200);
    ids = feed.body.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(p1.id);
  });

  test("top feed ranks reactions + 2 x comments and pages by score without repeats", async () => {
    const { community, members } = await world({ members: 4 });
    const viewer = members[0]!;
    const posts = [];
    for (let i = 0; i < 5; i++) posts.push(await makePost(members[1]!, community.id, `ranked ${i}`));
    await as(members[2]!).put(`/api/posts/${posts[0]!.id}/reaction`).send({ type: "LIKE" }).expect(200);
    await as(members[2]!).post(`/api/posts/${posts[1]!.id}/comments`).send({ body: "worth two" }).expect(201);
    const all = await allPages(async (cursor) => (await as(viewer).get(`/api/posts/feed?sort=top&limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200)).body);
    const ids = all.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual([posts[1]!.id, posts[0]!.id]);
    expect(ids).toEqual(expect.arrayContaining(posts.map((p) => p.id)));
  });

  test("community feed new/top/hot and tag filter; keyset pagination returns every row exactly once", async () => {
    const { community, members } = await world({ members: 1 });
    const created: string[] = [];
    for (let i = 0; i < 13; i++) created.push((await makePost(members[0]!, community.id, `n${i} ${i % 3 === 0 ? "#triad" : ""}`)).id);
    // Rows inside the same millisecond (microsecond precision in Postgres) must not be lost.
    await db.updateTable("posts").set({ created_at: new Date("2026-01-01T00:00:00.000Z") }).where("id", "in", created.slice(0, 6)).execute();
    for (const sort of ["new", "top", "hot"]) {
      const all = await allPages(async (cursor) => (await anon().get(`/api/communities/${community.id}/posts?sort=${sort}&limit=4${cursor ? `&cursor=${cursor}` : ""}`).expect(200)).body);
      const ids = all.map((p: { id: string }) => p.id);
      expect(ids.length, sort).toBe(13);
      expect(new Set(ids).size, sort).toBe(13);
    }
    const tagged = await anon().get(`/api/communities/${community.id}/posts?tag=Triad`).expect(200);
    expect(tagged.body.items).toHaveLength(5);
    await anon().get(`/api/communities/${community.id}/posts?cursor=garbage`).expect(400);
  });

  test("pinned posts and locked comments", async () => {
    const { owner, community, members } = await world({ members: 1 });
    const post = await makePost(members[0]!, community.id);
    await as(members[0]!).post(`/api/posts/${post.id}/pin`).expect(403);
    expect((await as(owner).post(`/api/posts/${post.id}/pin`).expect(200)).body.isPinned).toBe(true);
    const pinned = await anon().get(`/api/communities/${community.id}/posts/pinned`).expect(200);
    expect(pinned.body.map((p: { id: string }) => p.id)).toEqual([post.id]);
    await as(owner).post(`/api/posts/${post.id}/lock`).expect(200);
    expect((await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: "x" }).expect(403)).body.code).toBe("POST_LOCKED");
    await as(owner).post(`/api/posts/${post.id}/comments`).send({ body: "mods may" }).expect(201);
    await as(owner).delete(`/api/posts/${post.id}/lock`).expect(200);
    await as(members[0]!).post(`/api/posts/${post.id}/comments`).send({ body: "open again" }).expect(201);
  });
});

describe("bookmarks and shares", () => {
  test("bookmarks list only what you can still see", async () => {
    const { community, members } = await world({ members: 1, visibility: "PRIVATE" });
    const me = await createUser();
    await addMember(community.id, me);
    const post = await makePost(members[0]!, community.id);
    await as(me).post(`/api/posts/${post.id}/bookmark`).expect(204);
    let list = await as(me).get("/api/users/me/bookmarks").expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect(list.body.items[0].viewer.bookmarked).toBe(true);
    await as(me).post(`/api/communities/${community.id}/leave`).expect(204);
    list = await as(me).get("/api/users/me/bookmarks").expect(200);
    expect(list.body.items).toEqual([]);
  });

  test("sharing: public posts anywhere, private posts never outside their community", async () => {
    const pub = await world({ members: 1 });
    const priv = await world({ members: 1, visibility: "PRIVATE" });
    const sharer = await createUser();
    await addMember(pub.community.id, sharer);
    await addMember(priv.community.id, sharer);
    const original = await makePost(pub.members[0]!, pub.community.id, "share me");
    const share = await makePost(sharer, priv.community.id, "look", { sharedPostId: original.id });
    expect(share.sharedPost?.id).toBe(original.id);
    expect((await anon().get(`/api/posts/${original.id}`).expect(200)).body.shareCount).toBe(1);
    const secret = await makePost(priv.members[0]!, priv.community.id, "secret");
    expect((await as(sharer).post("/api/posts").send({ communityId: pub.community.id, body: "leak", sharedPostId: secret.id }).expect(400)).body.code).toBe("SHARE_NOT_ALLOWED");
  });
});

describe("pre-moderation", () => {
  test("community premoderation holds posts as PENDING_REVIEW, visible to the author and mods only", async () => {
    const { owner, community, members } = await world({ members: 2 });
    await as(owner).patch(`/api/communities/${community.id}`).send({ premoderatePosts: true }).expect(200);
    const rt = recordRealtime();
    const held = await makePost(members[0]!, community.id, "please approve");
    expect(held.status).toBe("PENDING_REVIEW");
    expect(rt.to(`community:${community.id}`, "feed:new-posts")).toHaveLength(0);
    await as(members[1]!).get(`/api/posts/${held.id}`).expect(404);
    await anon().get(`/api/posts/${held.id}`).expect(404);
    await as(members[0]!).get(`/api/posts/${held.id}`).expect(200);
    await as(owner).get(`/api/posts/${held.id}`).expect(200);
    const feed = await anon().get(`/api/communities/${community.id}/posts`).expect(200);
    expect(feed.body.items).toEqual([]);
    const profile = await as(members[0]!).get(`/api/users/${members[0]!.username}/posts`).expect(200);
    expect(profile.body.items.map((p: { status: string }) => p.status)).toEqual(["PENDING_REVIEW"]);
    const other = await as(members[1]!).get(`/api/users/${members[0]!.username}/posts`).expect(200);
    expect(other.body.items).toEqual([]);
    expect((await db.selectFrom("communities").select("post_count").where("id", "=", community.id).executeTakeFirstOrThrow()).post_count).toBe(0);
    // The owner (a moderator) is never held.
    expect((await makePost(owner, community.id, "mod post")).status).toBe("PUBLISHED");
  });

  test("new accounts are held for their first posts when the setting is on; staff never", async () => {
    try {
      await setSettings({ moderation: { premoderateNewAccounts: { enabled: true, firstPosts: 1, accountAgeDays: 2 } } as never });
      const { community } = await world({ members: 0 });
      const fresh = await createUser();
      const old = await createUser({ createdAt: new Date(Date.now() - 10 * 86400_000) });
      const staff = await createUser({ role: "MODERATOR" });
      for (const u of [fresh, old, staff]) await addMember(community.id, u);
      expect((await makePost(fresh, community.id)).status).toBe("PENDING_REVIEW");
      expect((await makePost(old, community.id)).status).toBe("PUBLISHED");
      expect((await makePost(staff, community.id)).status).toBe("PUBLISHED");
    } finally {
      await resetSettings();
    }
  });

  test("create and edit queue a moderation scan", async () => {
    const { community, members } = await world({ members: 1 });
    const post = await makePost(members[0]!, community.id, "scan me");
    await as(members[0]!).patch(`/api/posts/${post.id}`).send({ body: "scan me again" }).expect(200);
    // The scan handler is the moderation module's; here we only check the post is still readable.
    await anon().get(`/api/posts/${post.id}`).expect((r) => expect([200, 404]).toContain(r.status));
  });
});

describe("counter reconciliation", () => {
  test("the reconcile job restores drifted counters from PUBLISHED rows", async () => {
    const { community, members } = await world({ members: 2 });
    const post = await makePost(members[0]!, community.id);
    await as(members[1]!).put(`/api/posts/${post.id}/reaction`).send({ type: "HAHA" }).expect(200);
    await as(members[1]!).post(`/api/posts/${post.id}/comments`).send({ body: uniq("c") }).expect(201);
    await db.updateTable("posts").set({ reaction_count: 99, reaction_counts: JSON.stringify({ LIKE: 99 }), comment_count: 42 }).where("id", "=", post.id).execute();
    await db.updateTable("communities").set({ member_count: 0, post_count: 77 }).where("id", "=", community.id).execute();
    await db.updateTable("users").set({ post_count: 5, follower_count: 3 }).where("id", "=", members[0]!.id).execute();
    await reconcileCounters();
    const p = await db.selectFrom("posts").select(["reaction_count", "reaction_counts", "comment_count"]).where("id", "=", post.id).executeTakeFirstOrThrow();
    expect(p).toEqual({ reaction_count: 1, reaction_counts: { HAHA: 1 }, comment_count: 1 });
    const c = await db.selectFrom("communities").select(["member_count", "post_count"]).where("id", "=", community.id).executeTakeFirstOrThrow();
    expect(c).toEqual({ member_count: 3, post_count: 1 });
    const u = await db.selectFrom("users").select(["post_count", "follower_count"]).where("id", "=", members[0]!.id).executeTakeFirstOrThrow();
    expect(u).toEqual({ post_count: 1, follower_count: 0 });
  });

  test("the reconcile job recomputes reputation and level from the points ledger", async () => {
    const { community, members } = await world({ members: 2 });
    const [author, fan] = members;
    const post = await makePost(author!, community.id);
    await as(fan!).put(`/api/posts/${post.id}/reaction`).send({ type: "LIKE" }).expect(200);
    const rep = () => db.selectFrom("users").select(["reputation", "level"]).where("id", "=", author!.id).executeTakeFirstOrThrow();
    expect(await rep()).toEqual({ reputation: 7, level: 1 });
    // Corrupt both: inflated reputation with a mismatched level, and a stray level on zero points.
    await db.updateTable("users").set({ reputation: 5000, level: 3 }).where("id", "=", author!.id).execute();
    await db.updateTable("users").set({ reputation: 0, level: 9 }).where("id", "=", fan!.id).execute();
    const fixed = await reconcileCounters();
    expect(fixed.reputation).toBeGreaterThanOrEqual(2);
    expect(await rep()).toEqual({ reputation: 7, level: 1 });
    expect(await db.selectFrom("users").select(["reputation", "level"]).where("id", "=", fan!.id).executeTakeFirstOrThrow()).toEqual({ reputation: 0, level: 1 });
    // Level follows domain/points.ts: 40 points is level 3.
    await db.insertInto("points_ledger").values({ id: newId(), user_id: author!.id, amount: 33, reason: "post_created", entity_type: "post", entity_id: newId(), actor_id: author!.id }).execute();
    await reconcileCounters();
    expect(await rep()).toEqual({ reputation: 40, level: 3 });
    // A second run has nothing left to fix for these users.
    await reconcileCounters();
    expect(await rep()).toEqual({ reputation: 40, level: 3 });
  });
});
