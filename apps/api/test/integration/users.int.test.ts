import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser } from "./harness";
import { addMember, allPages, makePost, notificationsOf, world } from "./social-fixtures";

const counts = async (id: string) => db.selectFrom("users").select(["follower_count", "following_count"]).where("id", "=", id).executeTakeFirstOrThrow();

describe("profiles", () => {
  test("a profile shows counts and the viewer relationship, including DM eligibility", async () => {
    const { community, members } = await world({ members: 2 });
    const [a, b] = members;
    await makePost(a!, community.id);
    await as(b!).post(`/api/users/${a!.id}/follow`).expect(204);
    const seen = await as(b!).get(`/api/users/${a!.username}`).expect(200);
    expect(seen.body).toMatchObject({ id: a!.id, postCount: 1, followerCount: 1, reputation: 5, level: 1 });
    expect(seen.body.viewer).toEqual({ isSelf: false, following: true, followedBy: false, blocked: false, canMessage: true, messageBlockedReason: null });
    const self = await as(a!).get(`/api/users/${a!.username}`).expect(200);
    expect(self.body.viewer).toMatchObject({ isSelf: true, canMessage: false });
    const outsider = await createUser();
    const far = await as(outsider).get(`/api/users/${a!.username}`).expect(200);
    expect(far.body.viewer).toMatchObject({ canMessage: false, messageBlockedReason: "NO_SHARED_COMMUNITY" });
    expect((await anon().get(`/api/users/${a!.username}`).expect(200)).body.viewer.canMessage).toBe(false);
    await anon().get("/api/users/nobody_here_at_all").expect(404);
    const banned = await createUser({ status: "BANNED" });
    await anon().get(`/api/users/${banned.username}`).expect(404);
  });

  test("profile edits", async () => {
    const u = await createUser();
    const me = await as(u).patch("/api/users/me").send({ displayName: "New Name", headline: "Builder", website: "https://example.com/me", dmPrivacy: "FOLLOWING" }).expect(200);
    expect(me.body).toMatchObject({ displayName: "New Name", headline: "Builder", dmPrivacy: "FOLLOWING" });
    // Omitted fields stay as they are.
    const again = await as(u).patch("/api/users/me").send({ bio: "Hello" }).expect(200);
    expect(again.body.headline).toBe("Builder");
    await as(u).patch("/api/users/me").send({ website: "javascript:alert(1)" }).expect(400);
    await as(u).patch("/api/users/me").send({ avatarUploadId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400);
  });

  test("profile communities: public ones, plus private ones you share", async () => {
    const pub = await world({ members: 1 });
    const priv = await world({ members: 0, visibility: "PRIVATE" });
    const person = pub.members[0]!;
    await addMember(priv.community.id, person);
    const stranger = await createUser();
    const seen = await as(stranger).get(`/api/users/${person.username}/communities`).expect(200);
    expect(seen.body.map((c: { id: string }) => c.id)).toEqual([pub.community.id]);
    const peer = await createUser();
    await addMember(priv.community.id, peer);
    const shared = await as(peer).get(`/api/users/${person.username}/communities`).expect(200);
    expect(shared.body.map((c: { id: string }) => c.id).sort()).toEqual([pub.community.id, priv.community.id].sort());
  });

  test("sessions are listed and revocable", async () => {
    const u = await createUser();
    const login = await anon().post("/api/auth/login").send({ login: u.email, password: "correct-horse-battery-staple" }).expect(200);
    const list = await as(u).get("/api/users/me/sessions").expect(200);
    expect(list.body).toHaveLength(1);
    await as(u).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(204);
    expect((await as(u).get("/api/users/me/sessions").expect(200)).body).toHaveLength(0);
    await as(await createUser()).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(404);
    expect(login.body.accessToken).toBeTruthy();
  });
});

describe("follows", () => {
  test("follow and unfollow keep counters and notify once", async () => {
    const a = await createUser();
    const b = await createUser();
    await as(a).post(`/api/users/${b.id}/follow`).expect(204);
    await as(a).post(`/api/users/${b.id}/follow`).expect(204);
    expect(await counts(b.id)).toMatchObject({ follower_count: 1 });
    expect(await counts(a.id)).toMatchObject({ following_count: 1 });
    const n = (await notificationsOf(b.id)).filter((x) => x.type === "FOLLOW");
    expect(n).toHaveLength(1);
    await as(a).post(`/api/users/${a.id}/follow`).expect(400);
    await as(a).delete(`/api/users/${b.id}/follow`).expect(204);
    expect(await counts(b.id)).toMatchObject({ follower_count: 0 });
  });

  test("followers and following page through every row once", async () => {
    const star = await createUser();
    const fans = [];
    for (let i = 0; i < 7; i++) {
      const f = await createUser();
      await as(f).post(`/api/users/${star.id}/follow`).expect(204);
      fans.push(f.id);
    }
    const all = await allPages(async (c) => (await anon().get(`/api/users/${star.username}/followers?limit=3${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(all.map((u: { id: string }) => u.id).sort()).toEqual(fans.sort());
    const following = await anon().get(`/api/users/${(await db.selectFrom("users").select("username").where("id", "=", fans[0]!).executeTakeFirstOrThrow()).username}/following`).expect(200);
    expect(following.body.items.map((u: { id: string }) => u.id)).toEqual([star.id]);
  });

  test("follow lists carry viewerFollows: the viewer's own follow state, false when signed out and on your own row", async () => {
    const star = await createUser();
    const [fanA, fanB, viewer] = [await createUser(), await createUser(), await createUser()];
    for (const f of [fanA, fanB, viewer]) await as(f).post(`/api/users/${star.id}/follow`).expect(204);
    await as(viewer).post(`/api/users/${fanA.id}/follow`).expect(204);
    const seen = await as(viewer).get(`/api/users/${star.username}/followers`).expect(200);
    const flag = (body: { items: { id: string; viewerFollows: boolean }[] }) => Object.fromEntries(body.items.map((u) => [u.id, u.viewerFollows]));
    expect(flag(seen.body)).toEqual({ [fanA.id]: true, [fanB.id]: false, [viewer.id]: false });
    expect(seen.body.items[0]).toMatchObject({ username: expect.any(String), displayName: expect.any(String), viewerFollows: expect.any(Boolean) });
    const signedOut = await anon().get(`/api/users/${star.username}/followers`).expect(200);
    expect(Object.values(flag(signedOut.body))).toEqual([false, false, false]);
    const following = await as(viewer).get(`/api/users/${viewer.username}/following`).expect(200);
    expect(flag(following.body)).toEqual({ [star.id]: true, [fanA.id]: true });
    expect(flag((await as(fanB).get(`/api/users/${viewer.username}/following`).expect(200)).body)).toEqual({ [star.id]: true, [fanA.id]: false });
  });

  test("suggestions are people in your communities you do not follow", async () => {
    const { community, members } = await world({ members: 3 });
    const [me, a, b] = members;
    await as(me!).post(`/api/users/${a!.id}/follow`).expect(204);
    const s = await as(me!).get("/api/users/suggestions").expect(200);
    const ids = s.body.map((u: { id: string }) => u.id);
    expect(ids).toContain(b!.id);
    expect(ids).not.toContain(a!.id);
    expect(ids).not.toContain(me!.id);
    expect(community.id).toBeTruthy();
  });
});

describe("blocks", () => {
  test("blocking removes follows both ways and hides profiles both ways (404)", async () => {
    const a = await createUser();
    const b = await createUser();
    await as(a).post(`/api/users/${b.id}/follow`).expect(204);
    await as(b).post(`/api/users/${a.id}/follow`).expect(204);
    await as(a).post(`/api/users/${b.id}/block`).expect(204);
    expect(await counts(a.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect(await counts(b.id)).toEqual({ follower_count: 0, following_count: 0 });
    await as(a).get(`/api/users/${b.username}`).expect(404);
    await as(b).get(`/api/users/${a.username}`).expect(404);
    await as(b).get(`/api/users/${a.username}/posts`).expect(404);
    await as(b).get(`/api/users/${a.username}/followers`).expect(404);
    await as(b).post(`/api/users/${a.id}/follow`).expect(404);
    const blocks = await as(a).get("/api/users/me/blocks").expect(200);
    expect(blocks.body.map((u: { id: string }) => u.id)).toEqual([b.id]);
    expect((await as(b).get("/api/users/me/blocks").expect(200)).body).toEqual([]);
    await as(a).delete(`/api/users/${b.id}/block`).expect(204);
    await as(b).get(`/api/users/${a.username}`).expect(200);
  });

  test("blocked people disappear from follower lists", async () => {
    const star = await createUser();
    const fan = await createUser();
    const viewer = await createUser();
    await as(fan).post(`/api/users/${star.id}/follow`).expect(204);
    await as(viewer).post(`/api/users/${fan.id}/block`).expect(204);
    const seen = await as(viewer).get(`/api/users/${star.username}/followers`).expect(200);
    expect(seen.body.items).toEqual([]);
    expect((await anon().get(`/api/users/${star.username}/followers`).expect(200)).body.items).toHaveLength(1);
  });
});
