import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser } from "./harness";
import { addMember, allPages, makeCommunity, makePost, notificationsOf, resetSettings, setSettings, uniq, world } from "./social-fixtures";

const status = async (communityId: string, userId: string) =>
  (await db.selectFrom("community_members").select(["status", "role"]).where("community_id", "=", communityId).where("user_id", "=", userId).executeTakeFirst()) ?? null;
const memberCount = async (id: string) => (await db.selectFrom("communities").select("member_count").where("id", "=", id).executeTakeFirstOrThrow()).member_count;

describe("creating communities", () => {
  test("the creator is the OWNER; the slug comes from the name and stays unique", async () => {
    const owner = await createUser();
    const name = `Design Guild ${uniq()}`;
    const a = await makeCommunity(owner, { name });
    const b = await makeCommunity(owner, { name });
    expect(a.slug).not.toBe(b.slug);
    expect(a.viewer).toEqual({ role: "OWNER", status: "ACTIVE", isMember: true, canPost: true, canModerate: true });
    expect(a.memberCount).toBe(1);
    const taken = await as(owner).post("/api/communities").send({ name: "Another", slug: a.slug, visibility: "PUBLIC", joinPolicy: "OPEN" }).expect(409);
    expect(taken.body.code).toBe("SLUG_TAKEN");
    expect((await anon().get(`/api/communities/${a.slug}`).expect(200)).body.viewer.isMember).toBe(false);
  });

  test("communityCreation=STAFF limits creation to staff", async () => {
    try {
      await setSettings({ communityCreation: "STAFF" });
      const user = await createUser();
      const res = await as(user).post("/api/communities").send({ name: "Nope", visibility: "PUBLIC", joinPolicy: "OPEN" }).expect(403);
      expect(res.body.code).toBe("COMMUNITY_CREATION_RESTRICTED");
      await makeCommunity(await createUser({ role: "MODERATOR" }));
    } finally {
      await resetSettings();
    }
  });

  test("maxCommunitiesPerUser is enforced", async () => {
    try {
      await setSettings({ maxCommunitiesPerUser: 2 });
      const user = await createUser();
      await makeCommunity(user);
      await makeCommunity(user);
      const res = await as(user).post("/api/communities").send({ name: "Third one", visibility: "PUBLIC", joinPolicy: "OPEN" }).expect(403);
      expect(res.body.code).toBe("COMMUNITY_LIMIT_REACHED");
    } finally {
      await resetSettings();
    }
  });

  test("moderators edit presentation; settings need OWNER or ADMIN; delete needs OWNER", async () => {
    const { owner, community } = await world({ members: 0 });
    const mod = await createUser();
    await addMember(community.id, mod, "MODERATOR");
    await as(mod).patch(`/api/communities/${community.id}`).send({ description: "Updated by a mod" }).expect(200);
    expect((await as(mod).patch(`/api/communities/${community.id}`).send({ visibility: "PRIVATE" }).expect(403)).body.code).toBe("NOT_COMMUNITY_ADMIN");
    const res = await as(owner).patch(`/api/communities/${community.id}`).send({ visibility: "PRIVATE", rules: [{ title: "Be kind", body: "Always." }] }).expect(200);
    expect(res.body.visibility).toBe("PRIVATE");
    expect(res.body.description).toBe("Updated by a mod");
    await as(mod).delete(`/api/communities/${community.id}`).expect(403);
    await as(owner).delete(`/api/communities/${community.id}`).expect(204);
    await anon().get(`/api/communities/${community.slug}`).expect(404);
  });

  test("directory lists public communities and the private ones you belong to", async () => {
    const owner = await createUser();
    const pub = await makeCommunity(owner, { name: `Findable ${uniq()}` });
    const priv = await makeCommunity(owner, { name: `Hidden ${uniq()}`, visibility: "PRIVATE" });
    const stranger = await createUser();
    const seen = await allPages(async (c) => (await as(stranger).get(`/api/communities?limit=50${c ? `&cursor=${c}` : ""}`).expect(200)).body, 200);
    const ids = seen.map((x: { id: string }) => x.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
    const mine = await as(owner).get("/api/communities?filter=managed&limit=50").expect(200);
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([pub.id, priv.id]));
    const search = await anon().get(`/api/communities?q=${encodeURIComponent(pub.name.split(" ")[1]!)}`).expect(200);
    expect(search.body.items.map((x: { id: string }) => x.id)).toEqual([pub.id]);
    // A private community you are not in is a limited card.
    const card = await as(stranger).get(`/api/communities/${priv.slug}`).expect(200);
    expect(card.body.rules).toEqual([]);
    expect(card.body.viewer.isMember).toBe(false);
  });
});

describe("join policies", () => {
  test("OPEN joins at once", async () => {
    const { community } = await world({ members: 0 });
    const u = await createUser();
    expect((await as(u).post(`/api/communities/${community.id}/join`).send({}).expect(200)).body).toEqual({ status: "ACTIVE" });
    expect(await memberCount(community.id)).toBe(2);
    // Joining twice is idempotent.
    await as(u).post(`/api/communities/${community.id}/join`).send({}).expect(200);
    expect(await memberCount(community.id)).toBe(2);
  });

  test("APPROVAL queues a request that moderators approve or reject", async () => {
    const { owner, community } = await world({ members: 0, joinPolicy: "APPROVAL" });
    const u = await createUser();
    expect((await as(u).post(`/api/communities/${community.id}/join`).send({}).expect(200)).body).toEqual({ status: "PENDING" });
    const n = (await notificationsOf(owner.id)).find((x) => x.type === "JOIN_REQUEST");
    expect(n?.entity_id).toBe(community.id);
    const pending = await as(owner).get(`/api/communities/${community.id}/members?status=PENDING`).expect(200);
    expect(pending.body.items.map((m: { user: { id: string } }) => m.user.id)).toEqual([u.id]);
    await as(u).get(`/api/communities/${community.id}/members?status=PENDING`).expect(403);
    const approved = await as(owner).post(`/api/communities/${community.id}/members/${u.id}/approve`).expect(200);
    expect(approved.body.status).toBe("ACTIVE");
    expect((await notificationsOf(u.id)).some((x) => x.type === "MEMBERSHIP_APPROVED")).toBe(true);

    const v = await createUser();
    await as(v).post(`/api/communities/${community.id}/join`).send({}).expect(200);
    await as(owner).post(`/api/communities/${community.id}/members/${v.id}/reject`).expect(204);
    expect((await status(community.id, v.id))?.status).toBe("LEFT");

    const w = await createUser();
    await as(w).post(`/api/communities/${community.id}/join`).send({}).expect(200);
    await as(w).delete(`/api/communities/${community.id}/join`).expect(204);
    expect((await status(community.id, w.id))?.status).toBe("LEFT");
  });

  test("INVITE_ONLY needs a code; invites honour max uses, expiry and revocation", async () => {
    const { owner, community } = await world({ members: 0, joinPolicy: "INVITE_ONLY", visibility: "PRIVATE" });
    const a = await createUser();
    expect((await as(a).post(`/api/communities/${community.id}/join`).send({}).expect(403)).body.code).toBe("INVITE_REQUIRED");
    const invite = (await as(owner).post(`/api/communities/${community.id}/invites`).send({ maxUses: 1 }).expect(201)).body;
    expect(invite.url).toContain(invite.code);
    const card = await as(a).get(`/api/communities/invites/${invite.code}`).expect(200);
    expect(card.body.community.id).toBe(community.id);
    expect((await as(a).post(`/api/communities/${community.id}/join`).send({ inviteCode: invite.code }).expect(200)).body.status).toBe("ACTIVE");
    const b = await createUser();
    expect((await as(b).post(`/api/communities/${community.id}/join`).send({ inviteCode: invite.code }).expect(400)).body.code).toBe("INVITE_INVALID");
    await as(b).get(`/api/communities/invites/${invite.code}`).expect(404);

    const expiring = (await as(owner).post(`/api/communities/${community.id}/invites`).send({ expiresInDays: 1 }).expect(201)).body;
    await db.updateTable("community_invites").set({ expires_at: new Date(Date.now() - 1000) }).where("id", "=", expiring.id).execute();
    await as(b).post(`/api/communities/${community.id}/join`).send({ inviteCode: expiring.code }).expect(400);

    const revoked = (await as(owner).post(`/api/communities/${community.id}/invites`).send({}).expect(201)).body;
    await as(a).delete(`/api/communities/${community.id}/invites/${revoked.id}`).expect(403);
    await as(owner).delete(`/api/communities/${community.id}/invites/${revoked.id}`).expect(204);
    await as(b).post(`/api/communities/${community.id}/join`).send({ inviteCode: revoked.code }).expect(400);
    const listed = await as(owner).get(`/api/communities/${community.id}/invites`).expect(200);
    expect(listed.body.map((i: { id: string }) => i.id)).not.toContain(revoked.id);

    // An invite also skips an APPROVAL queue.
    await as(owner).patch(`/api/communities/${community.id}`).send({ joinPolicy: "APPROVAL" }).expect(200);
    const fresh = (await as(owner).post(`/api/communities/${community.id}/invites`).send({}).expect(201)).body;
    expect((await as(b).post(`/api/communities/${community.id}/join`).send({ inviteCode: fresh.code }).expect(200)).body.status).toBe("ACTIVE");
  });
});

describe("leaving, roles and ownership", () => {
  test("the owner must transfer before leaving; transfer makes the old owner an ADMIN", async () => {
    const { owner, community, members } = await world({ members: 1 });
    expect((await as(owner).post(`/api/communities/${community.id}/leave`).expect(409)).body.code).toBe("OWNER_MUST_TRANSFER");
    await as(members[0]!).post(`/api/communities/${community.id}/transfer`).send({ userId: owner.id }).expect(403);
    await as(owner).post(`/api/communities/${community.id}/transfer`).send({ userId: members[0]!.id }).expect(204);
    expect(await status(community.id, members[0]!.id)).toEqual({ status: "ACTIVE", role: "OWNER" });
    expect(await status(community.id, owner.id)).toEqual({ status: "ACTIVE", role: "ADMIN" });
    await as(owner).post(`/api/communities/${community.id}/leave`).expect(204);
    expect(await memberCount(community.id)).toBe(1);
  });

  test("roles: OWNER/ADMIN set them; nobody acts on equal or higher rank", async () => {
    const { owner, community, members } = await world({ members: 3 });
    const [a, b, c] = members;
    await as(a!).patch(`/api/communities/${community.id}/members/${b!.id}`).send({ role: "MODERATOR" }).expect(403);
    expect((await as(owner).patch(`/api/communities/${community.id}/members/${a!.id}`).send({ role: "MODERATOR" }).expect(200)).body.role).toBe("MODERATOR");
    await as(owner).patch(`/api/communities/${community.id}/members/${b!.id}`).send({ role: "MODERATOR" }).expect(200);
    // A moderator cannot suspend another moderator, nor the owner.
    expect((await as(a!).post(`/api/communities/${community.id}/members/${b!.id}/suspend`).send({ days: 1 }).expect(403)).body.code).toBe("INSUFFICIENT_RANK");
    expect((await as(a!).post(`/api/communities/${community.id}/members/${owner.id}/ban`).send({}).expect(403)).body.code).toBe("TARGET_IS_OWNER");
    await as(a!).post(`/api/communities/${community.id}/members/${c!.id}/suspend`).send({ days: 1 }).expect(200);
  });
});

describe("suspensions and bans", () => {
  test("suspended members cannot post, comment or react; rejoining does not lift it", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const [target, other] = members;
    const post = await makePost(other!, community.id);
    const res = await as(owner).post(`/api/communities/${community.id}/members/${target!.id}/suspend`).send({ days: 3, reason: "cool off" }).expect(200);
    expect(res.body.status).toBe("SUSPENDED");
    expect(await memberCount(community.id)).toBe(2);
    expect((await as(target!).post("/api/posts").send({ communityId: community.id, body: "x" }).expect(403)).body.code).toBe("MEMBERSHIP_SUSPENDED");
    expect((await as(target!).post(`/api/posts/${post.id}/comments`).send({ body: "x" }).expect(403)).body.code).toBe("MEMBERSHIP_SUSPENDED");
    expect((await as(target!).put(`/api/posts/${post.id}/reaction`).send({ type: "LIKE" }).expect(403)).body.code).toBe("MEMBERSHIP_SUSPENDED");
    await as(target!).post(`/api/communities/${community.id}/leave`).expect(404);
    expect((await as(target!).post(`/api/communities/${community.id}/join`).send({}).expect(403)).body.code).toBe("MEMBERSHIP_SUSPENDED");
    await as(owner).post(`/api/communities/${community.id}/members/${target!.id}/unsuspend`).expect(200);
    await makePost(target!, community.id);
  });

  test("an expired community suspension lifts itself", async () => {
    const { owner, community, members } = await world({ members: 1 });
    await as(owner).post(`/api/communities/${community.id}/members/${members[0]!.id}/suspend`).send({ days: 1 }).expect(200);
    await db.updateTable("community_members").set({ suspended_until: new Date(Date.now() - 1000) }).where("user_id", "=", members[0]!.id).where("community_id", "=", community.id).execute();
    await makePost(members[0]!, community.id);
    expect(await memberCount(community.id)).toBe(2);
  });

  test("a suspended moderator loses moderation powers", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const [mod, member] = members;
    await as(owner).patch(`/api/communities/${community.id}/members/${mod!.id}`).send({ role: "MODERATOR" }).expect(200);
    const post = await makePost(member!, community.id);
    await as(owner).post(`/api/communities/${community.id}/members/${mod!.id}/suspend`).send({ days: 2 }).expect(200);
    expect((await as(mod!).post(`/api/posts/${post.id}/pin`).expect(403)).body.code).toBe("NOT_A_MODERATOR");
    await as(mod!).delete(`/api/posts/${post.id}`).expect(403);
    await as(mod!).post(`/api/communities/${community.id}/members/${member!.id}/ban`).send({}).expect(403);
    await as(mod!).get(`/api/communities/${community.id}/members?status=SUSPENDED`).expect(403);
    const card = await as(mod!).get(`/api/communities/${community.slug}`).expect(200);
    expect(card.body.viewer.canModerate).toBe(false);
  });

  test("banned members cannot rejoin; removing them lifts the ban", async () => {
    const { owner, community, members } = await world({ members: 1 });
    const target = members[0]!;
    await as(owner).post(`/api/communities/${community.id}/members/${target.id}/ban`).send({ reason: "spam" }).expect(200);
    expect(await memberCount(community.id)).toBe(1);
    expect((await as(target).post(`/api/communities/${community.id}/join`).send({}).expect(403)).body.code).toBe("BANNED_FROM_COMMUNITY");
    const invite = (await as(owner).post(`/api/communities/${community.id}/invites`).send({}).expect(201)).body;
    await as(target).post(`/api/communities/${community.id}/join`).send({ inviteCode: invite.code }).expect(403);
    const banned = await as(owner).get(`/api/communities/${community.id}/members?status=BANNED`).expect(200);
    expect(banned.body.items.map((m: { user: { id: string } }) => m.user.id)).toEqual([target.id]);
    await as(owner).delete(`/api/communities/${community.id}/members/${target.id}`).expect(204);
    await as(target).post(`/api/communities/${community.id}/join`).send({}).expect(200);
  });

  test("POST /unban: mods only, BANNED becomes LEFT (not ACTIVE), audited, and they may rejoin", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const [target, member] = members;
    const mod = await createUser();
    await addMember(community.id, mod, "MODERATOR");
    const url = `/api/communities/${community.id}/members/${target!.id}/unban`;
    // Not banned yet: 409.
    expect((await as(mod).post(url).expect(409)).body.code).toBe("NOT_BANNED");
    await as(owner).post(`/api/communities/${community.id}/members/${target!.id}/ban`).send({}).expect(200);
    const before = await memberCount(community.id);
    // Members, the banned person themselves and outsiders cannot unban.
    expect((await as(member!).post(url).expect(403)).body.code).toBe("NOT_A_MODERATOR");
    expect((await as(target!).post(url).expect(403)).body.code).toBe("NOT_A_MODERATOR");
    await anon().post(url).expect(401);
    expect(await status(community.id, target!.id)).toEqual({ status: "BANNED", role: "MEMBER" });

    const res = await as(mod).post(url).expect(200);
    expect(res.body).toMatchObject({ user: { id: target!.id }, status: "LEFT", role: "MEMBER" });
    expect(await status(community.id, target!.id)).toEqual({ status: "LEFT", role: "MEMBER" });
    expect(await memberCount(community.id)).toBe(before);
    const audits = await db.selectFrom("audit_log").select(["actor_id", "data"]).where("action", "=", "community.member.unban").where("entity_id", "=", community.id).execute();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: mod.id, data: { userId: target!.id } });
    // Once LEFT there is no membership to act on (404), and the person can rejoin.
    await as(mod).post(url).expect(404);
    expect((await as(target!).post(`/api/communities/${community.id}/join`).send({}).expect(200)).body.status).toBe("ACTIVE");
    expect((await as(owner).get(`/api/communities/${community.id}/members?status=BANNED`).expect(200)).body.items).toEqual([]);
  });

  test("DELETE /members/:userId: any non-LEFT membership becomes LEFT (a ban included); LEFT or unknown is 404", async () => {
    const { owner, community, members } = await world({ members: 1, joinPolicy: "APPROVAL" });
    const active = members[0]!;
    const pending = await createUser();
    await as(pending).post(`/api/communities/${community.id}/join`).send({}).expect(200);
    const count = await memberCount(community.id);
    await as(owner).delete(`/api/communities/${community.id}/members/${pending.id}`).expect(204);
    expect(await status(community.id, pending.id)).toMatchObject({ status: "LEFT" });
    await as(owner).delete(`/api/communities/${community.id}/members/${active.id}`).expect(204);
    expect(await memberCount(community.id)).toBe(count - 1);
    await as(owner).delete(`/api/communities/${community.id}/members/${active.id}`).expect(404);
    await as(owner).delete(`/api/communities/${community.id}/members/${(await createUser()).id}`).expect(404);
  });
});

describe("members list and notification settings", () => {
  test("members list pages once each and filters by role and name", async () => {
    const { owner, community, members } = await world({ members: 5 });
    const all = await allPages(async (c) => (await anon().get(`/api/communities/${community.id}/members?limit=2${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(all.map((m: { user: { id: string } }) => m.user.id).sort()).toEqual([owner.id, ...members.map((m) => m.id)].sort());
    const owners = await anon().get(`/api/communities/${community.id}/members?role=OWNER`).expect(200);
    expect(owners.body.items).toHaveLength(1);
    const named = await anon().get(`/api/communities/${community.id}/members?q=${members[2]!.username}`).expect(200);
    expect(named.body.items.map((m: { user: { id: string } }) => m.user.id)).toEqual([members[2]!.id]);
  });

  test("members read and change their notification settings", async () => {
    const { community, members } = await world({ members: 1 });
    expect((await as(members[0]!).get(`/api/communities/${community.id}/notification-settings`).expect(200)).body).toEqual({ posts: "ALL", events: true, chat: true });
    expect((await as(members[0]!).patch(`/api/communities/${community.id}/notification-settings`).send({ posts: "OFF" }).expect(200)).body).toEqual({ posts: "OFF", events: true, chat: true });
    await as(await createUser()).get(`/api/communities/${community.id}/notification-settings`).expect(403);
  });

  test("suggested communities exclude ones you joined", async () => {
    const { community, members } = await world({ members: 1 });
    const s = await as(members[0]!).get("/api/communities/suggested").expect(200);
    expect(s.body.map((c: { id: string }) => c.id)).not.toContain(community.id);
  });
});
