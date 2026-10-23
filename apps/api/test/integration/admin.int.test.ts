import { afterAll, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { as, createUser, recordRealtime } from "./harness";
import { community } from "./moderation-fixtures";

const rt = recordRealtime();

describe("settings", () => {
  afterAll(async () => {
    const admin = await createUser({ role: "ADMIN" });
    await as(admin).patch("/api/admin/settings").send({ maxCommunitiesPerUser: 10, moderation: { blockedTerms: [] } }).expect(200);
  });

  test("admins read and patch; staff and members cannot", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const mod = await createUser({ role: "MODERATOR" });
    const res = await as(admin).get("/api/admin/settings").expect(200);
    expect(res.body.moderation.thresholds.harassment).toEqual({ review: expect.any(Number), hide: expect.any(Number) });
    await as(mod).get("/api/admin/settings").expect(403);
    await as(mod).patch("/api/admin/settings").send({ maxCommunitiesPerUser: 3 }).expect(403);

    const patched = await as(admin)
      .patch("/api/admin/settings")
      .send({ maxCommunitiesPerUser: 25, moderation: { blockedTerms: ["gronkle"], thresholds: { spam: { review: 0.4, hide: 0.7 } } } })
      .expect(200);
    expect(patched.body.maxCommunitiesPerUser).toBe(25);
    expect(patched.body.moderation.thresholds.spam).toEqual({ review: 0.4, hide: 0.7 });
    // Other thresholds survive a partial patch.
    expect(patched.body.moderation.thresholds.hate).toBeDefined();
    expect((await as(admin).get("/api/admin/settings").expect(200)).body.moderation.blockedTerms).toEqual(["gronkle"]);
    const audit = await db.selectFrom("audit_log").select("action").where("actor_id", "=", admin.id).execute();
    expect(audit.map((a) => a.action)).toContain("settings.update");
  });

  test("invalid settings are rejected", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bad = [
      { moderation: { thresholds: { hate: { review: 0.9, hide: 0.5 } } } },
      { moderation: { thresholds: { hate: { review: -0.1, hide: 0.5 } } } },
      { moderation: { thresholds: { hate: { review: 0.1, hide: 1.5 } } } },
      { maxCommunitiesPerUser: 1001 },
      { maxCommunitiesPerUser: -1 },
      { moderation: { blockedTerms: Array.from({ length: 501 }, (_, i) => `t${i}`) } },
      { moderation: { provider: "something" } },
      { unknownKey: true },
    ];
    for (const body of bad) {
      const res = await as(admin).patch("/api/admin/settings").send(body).expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("stats", () => {
  test("totals and a daily series covering the requested days", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const res = await as(mod).get("/api/admin/stats?days=7").expect(200);
    expect(res.body.totals).toEqual({ users: expect.any(Number), activeUsers7d: expect.any(Number), communities: expect.any(Number), posts: expect.any(Number), messages: expect.any(Number) });
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.daily.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
    expect(res.body.daily.at(-1).signups).toBeGreaterThan(0);
    await as(await createUser()).get("/api/admin/stats").expect(403);
  });
});

describe("users", () => {
  test("search by name and filter by role, with a cursor", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const tag = `Zebrafinch${Date.now().toString(36)}`;
    const a = await createUser({ displayName: `${tag} One` });
    const b = await createUser({ displayName: `${tag} Two` });
    const first = await as(mod).get(`/api/admin/users?q=${tag}&limit=1`).expect(200);
    expect(first.body.items).toHaveLength(1);
    const second = await as(mod).get(`/api/admin/users?q=${tag}&limit=1&cursor=${first.body.nextCursor}`).expect(200);
    expect([first.body.items[0].id, second.body.items[0].id].sort()).toEqual([a.id, b.id].sort());
    expect(first.body.items[0]).toMatchObject({ email: expect.stringContaining("@"), status: "ACTIVE", createdAt: expect.any(String), lastSeenAt: null });
    const admins = await as(mod).get("/api/admin/users?role=ADMIN&limit=50").expect(200);
    expect(admins.body.items.every((u: { role: string }) => u.role === "ADMIN")).toBe(true);
    await as(await createUser()).get("/api/admin/users").expect(403);
  });

  test("role changes: admin only, never your own", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const u = await createUser();
    const res = await as(admin).patch(`/api/admin/users/${u.id}`).send({ role: "MODERATOR" }).expect(200);
    expect(res.body.role).toBe("MODERATOR");
    const own = await as(admin).patch(`/api/admin/users/${admin.id}`).send({ role: "USER" }).expect(403);
    expect(own.body.code).toBe("CANNOT_CHANGE_OWN_ROLE");
    await as(await createUser({ role: "MODERATOR" })).patch(`/api/admin/users/${u.id}`).send({ role: "ADMIN" }).expect(403);
  });

  test("suspend and unsuspend: staff, with the trail and a disconnect", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const u = await createUser();
    rt.clear();
    const res = await as(mod).post(`/api/admin/users/${u.id}/suspend`).send({ days: 3, reason: "cool off" }).expect(200);
    expect(res.body).toMatchObject({ id: u.id, status: "SUSPENDED", suspendedUntil: expect.any(String) });
    expect(rt.disconnects).toEqual([{ userIds: [u.id], reason: "SUSPENDED" }]);
    const action = await db.selectFrom("moderation_actions").selectAll().where("target_id", "=", u.id).executeTakeFirstOrThrow();
    expect(action).toMatchObject({ action: "SUSPEND", case_id: null, actor_id: mod.id, reason: "cool off" });
    expect(await db.selectFrom("notifications").select("type").where("recipient_id", "=", u.id).execute()).toEqual([{ type: "MODERATION_ACTION" }]);
    // A suspended account can read but not write.
    await as(u).get("/api/auth/me").expect(200);
    await as(u).post("/api/reports").send({ targetType: "USER", targetId: mod.id, reason: "SPAM" }).expect(403);

    await as(mod).post(`/api/admin/users/${u.id}/suspend`).send({ days: 0, reason: "x" }).expect(400);
    const lifted = await as(mod).post(`/api/admin/users/${u.id}/unsuspend`).expect(200);
    expect(lifted.body).toMatchObject({ status: "ACTIVE", suspendedUntil: null });
    await as(mod).post(`/api/admin/users/${u.id}/unsuspend`).expect(409);
  });

  test("moderators cannot act on staff or themselves", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const other = await createUser({ role: "MODERATOR" });
    const admin = await createUser({ role: "ADMIN" });
    expect((await as(mod).post(`/api/admin/users/${other.id}/suspend`).send({ days: 1, reason: "x" }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    await as(mod).post(`/api/admin/users/${admin.id}/suspend`).send({ days: 1, reason: "x" }).expect(403);
    expect((await as(mod).post(`/api/admin/users/${mod.id}/suspend`).send({ days: 1, reason: "x" }).expect(400)).body.code).toBe("CANNOT_MODERATE_SELF");
  });

  test("ban revokes every session; admin only; unban restores", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const mod = await createUser({ role: "MODERATOR" });
    const u = await createUser();
    await db.insertInto("sessions").values({ id: `S${u.id.slice(1)}`, user_id: u.id, family_id: "f", token_hash: `h-${u.id}`, expires_at: new Date(Date.now() + 86400_000) }).execute();
    await as(mod).post(`/api/admin/users/${u.id}/ban`).send({ reason: "spam ring" }).expect(403);
    rt.clear();
    const res = await as(admin).post(`/api/admin/users/${u.id}/ban`).send({ reason: "spam ring" }).expect(200);
    expect(res.body.status).toBe("BANNED");
    expect(rt.disconnects).toEqual([{ userIds: [u.id], reason: "BANNED" }]);
    const live = await db.selectFrom("sessions").select("id").where("user_id", "=", u.id).where("revoked_at", "is", null).execute();
    expect(live).toHaveLength(0);
    // The token version moved, so the old access token is dead even after an unban.
    expect([401, 403]).toContain((await as(u).get("/api/auth/me")).status);
    await as(admin).post(`/api/admin/users/${u.id}/unban`).expect(200);
    expect((await as(u).get("/api/auth/me")).status).toBe(401);
    const audit = await db.selectFrom("audit_log").select("action").where("entity_id", "=", u.id).execute();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["moderation.ban", "moderation.unban"]));
  });
});

describe("communities and audit", () => {
  test("staff list every community; admins set default or remove", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const mod = await createUser({ role: "MODERATOR" });
    const owner = await createUser();
    const cid = await community(owner);
    const list = await as(mod).get("/api/admin/communities?limit=50").expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(cid);
    expect(list.body.items[0].viewer.canModerate).toBe(true);
    await as(mod).patch(`/api/admin/communities/${cid}`).send({ isDefault: true }).expect(403);

    await as(admin).patch(`/api/admin/communities/${cid}`).send({ isDefault: true }).expect(200);
    expect((await db.selectFrom("communities").select("is_default").where("id", "=", cid).executeTakeFirstOrThrow()).is_default).toBe(true);
    const removed = await as(admin).patch(`/api/admin/communities/${cid}`).send({ status: "REMOVED" }).expect(200);
    expect(removed.body.id).toBe(cid);
    expect(await db.selectFrom("communities").select(["status", "is_default"]).where("id", "=", cid).executeTakeFirstOrThrow()).toEqual({ status: "REMOVED", is_default: false });
    const filtered = await as(mod).get("/api/admin/communities?status=REMOVED&limit=50").expect(200);
    expect(filtered.body.items.map((c: { id: string }) => c.id)).toContain(cid);
    await as(admin).patch(`/api/admin/communities/${cid}`).send({}).expect(400);
  });

  test("Community.admin (isDefault, status) is filled for platform staff only", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const mod = await createUser({ role: "MODERATOR" });
    const owner = await createUser();
    const member = await createUser();
    const cid = await community(owner);
    const slug = (await db.selectFrom("communities").select("slug").where("id", "=", cid).executeTakeFirstOrThrow()).slug;
    await as(admin).patch(`/api/admin/communities/${cid}`).send({ isDefault: true }).expect(200);
    const patched = await as(admin).patch(`/api/admin/communities/${cid}`).send({ isDefault: false }).expect(200);
    expect(patched.body.admin).toEqual({ isDefault: false, status: "PUBLISHED" });
    await as(admin).patch(`/api/admin/communities/${cid}`).send({ isDefault: true }).expect(200);
    const listed = (await as(mod).get(`/api/admin/communities?q=${encodeURIComponent((await db.selectFrom("communities").select("name").where("id", "=", cid).executeTakeFirstOrThrow()).name)}`).expect(200)).body.items;
    expect(listed.find((c: { id: string }) => c.id === cid).admin).toEqual({ isDefault: true, status: "PUBLISHED" });
    expect((await as(mod).get(`/api/communities/${slug}`).expect(200)).body.admin).toEqual({ isDefault: true, status: "PUBLISHED" });
    // Absent (not null, not false) for everyone else, the community's own owner included.
    for (const viewer of [owner, member, null]) {
      const seen = (await as(viewer).get(`/api/communities/${slug}`).expect(200)).body;
      expect(seen).not.toHaveProperty("admin");
    }
    const directory = (await as(owner).get("/api/communities?filter=managed").expect(200)).body.items;
    expect(directory.find((c: { id: string }) => c.id === cid)).not.toHaveProperty("admin");
    const removed = await as(admin).patch(`/api/admin/communities/${cid}`).send({ status: "REMOVED" }).expect(200);
    expect(removed.body.admin).toEqual({ isDefault: false, status: "REMOVED" });
  });

  test("the audit trail is admin-only and filterable", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const u = await createUser();
    await as(admin).patch(`/api/admin/users/${u.id}`).send({ role: "MODERATOR" }).expect(200);
    const res = await as(admin).get(`/api/admin/audit?actorId=${admin.id}&action=user.role_change`).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ actor: { id: admin.id }, action: "user.role_change", entityType: "user", entityId: u.id, data: { from: "USER", to: "MODERATOR" } });
    await as(await createUser({ role: "MODERATOR" })).get("/api/admin/audit").expect(403);
  });
});
