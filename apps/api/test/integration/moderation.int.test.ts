import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { liftSuspensionsJob } from "../../src/jobs/moderation.jobs";
import { rooms } from "../../src/realtime/port";
import { scanTarget } from "../../src/services/moderation/scan.service";
import { saveSettings } from "../../src/services/settings.service";
import { startStub } from "../../../moderation-stub/server.mjs";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { chatMessage, comment, community, counts, dmMessage, imageUpload, join, openCaseOf, post, statusOf } from "./moderation-fixtures";

let stub: { url: string; close(): Promise<void> };
let admin: TestUser;
const rt = recordRealtime();

async function useProvider(provider: "stub" | "rules", extra: { blockedTerms?: string[]; enabled?: boolean } = {}) {
  await saveSettings({ moderation: { provider, blockedTerms: extra.blockedTerms ?? [], enabled: extra.enabled ?? true } as never }, admin.id);
}

beforeAll(async () => {
  stub = await startStub(0);
  config.MODERATION_STUB_URL = stub.url;
  admin = await createUser({ role: "ADMIN" });
  await useProvider("stub");
});

afterAll(async () => {
  await useProvider("rules");
  await stub.close();
});

describe("automatic scan with the stub provider", () => {
  test("over the hide threshold: hidden, counted out, case + action + notification + live signals", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "you are awful [[mod:harassment/threatening=0.97]]");
    const before = await counts(cid, author.id);
    rt.clear();

    const res = await scanTarget("POST", pid);
    expect(res.outcome).toBe("HIDE");
    expect(await statusOf("posts", pid)).toEqual({ status: "HIDDEN", moderation_state: "FLAGGED" });
    expect(await counts(cid, author.id)).toEqual({ community: before.community - 1, user: before.user - 1 });

    const kase = await openCaseOf("POST", pid);
    expect(kase).toMatchObject({ source: "AI", status: "OPEN", ai_provider: "stub", community_id: cid, author_id: author.id });
    expect(kase!.ai_categories).toContain("harassment");
    expect((kase!.ai_scores as Record<string, number>).harassment).toBe(0.97);

    const action = await db.selectFrom("moderation_actions").selectAll().where("target_id", "=", pid).executeTakeFirstOrThrow();
    expect(action).toMatchObject({ action: "HIDE", actor_id: null, case_id: kase!.id });
    expect(action.reason).toMatch(/^Automatic: .*harassment/);

    const note = await db.selectFrom("notifications").selectAll().where("recipient_id", "=", author.id).where("type", "=", "MODERATION_ACTION").executeTakeFirstOrThrow();
    expect((note.data as { caseId: string }).caseId).toBe(kase!.id);
    expect(rt.to(rooms.post(pid), "post:removed")).toEqual([{ postId: pid }]);
    expect(rt.to(rooms.staff, "moderation:queue").at(-1)?.openCases).toBeGreaterThan(0);

    // The author sees their case; the target status is current.
    const mine = await as(author).get("/api/moderation/me").expect(200);
    expect(mine.body.items[0]).toMatchObject({ id: kase!.id, targetStatus: "HIDDEN", snapshot: { body: expect.stringContaining("awful") } });
  });

  test("between review and hide: stays visible, AI case enters the queue", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "borderline [[mod:hate=0.5]]");
    expect((await scanTarget("POST", pid)).outcome).toBe("REVIEW");
    expect(await statusOf("posts", pid)).toEqual({ status: "PUBLISHED", moderation_state: "REVIEW" });
    expect(await openCaseOf("POST", pid)).toMatchObject({ source: "AI", status: "OPEN", priority: 50 });
  });

  test("clean content is marked CLEAN with no case", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "a perfectly nice post");
    expect((await scanTarget("POST", pid)).outcome).toBe("CLEAN");
    expect((await statusOf("posts", pid)).moderation_state).toBe("CLEAN");
    expect(await openCaseOf("POST", pid)).toBeUndefined();
  });

  test("premoderated post: clean scan opens a PREMODERATION case, approval publishes it", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "first post from a new account", "PENDING_REVIEW");
    const before = await counts(cid, author.id);
    const res = await scanTarget("POST", pid);
    expect(res.outcome).toBe("CLEAN");
    const kase = await openCaseOf("POST", pid);
    expect(kase).toMatchObject({ source: "PREMODERATION", status: "OPEN" });

    const mod = await createUser({ role: "MODERATOR" });
    const out = await as(mod).post(`/api/moderation/cases/${kase!.id}/actions`).send({ action: "APPROVE" }).expect(200);
    expect(out.body).toMatchObject({ status: "RESOLVED", resolution: "APPROVE", targetStatus: "PUBLISHED", resolvedBy: { id: mod.id } });
    expect(await counts(cid, author.id)).toEqual({ community: before.community + 1, user: before.user + 1 });
  });

  test("approving a held post awards the +5 post points exactly once", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "held for review, then approved", "PENDING_REVIEW");
    const rep = async () => (await db.selectFrom("users").select("reputation").where("id", "=", author.id).executeTakeFirstOrThrow()).reputation;
    const ledger = () => db.selectFrom("points_ledger").select(["amount", "reason"]).where("entity_type", "=", "post").where("entity_id", "=", pid).execute();
    await scanTarget("POST", pid);
    expect(await rep()).toBe(0);
    const kase = (await openCaseOf("POST", pid))!;
    const mod = await createUser({ role: "MODERATOR" });
    await as(mod).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "APPROVE" }).expect(200);
    expect(await rep()).toBe(5);
    expect(await ledger()).toEqual([{ amount: 5, reason: "post_created" }]);
    // The same case cannot be approved twice, and approving an already published post (a later case) adds nothing.
    await as(mod).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "APPROVE" }).expect(409);
    const reporter = await createUser({ createdAt: new Date(Date.now() - 30 * 86400_000) });
    await join(reporter, cid);
    await as(reporter).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    await as(mod).post(`/api/moderation/cases/${(await openCaseOf("POST", pid))!.id}/actions`).send({ action: "APPROVE" }).expect(200);
    expect(await rep()).toBe(5);
    expect(await ledger()).toHaveLength(1);
  });

  test("a flagged image hides the post", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "look at this");
    const upload = await imageUpload(author, "flag-image");
    await db.insertInto("post_media").values({ post_id: pid, upload_id: upload, position: 0 }).execute();
    const res = await scanTarget("POST", pid);
    expect(res.outcome).toBe("HIDE");
    const kase = await openCaseOf("POST", pid);
    expect(kase!.ai_categories).toContain("sexual");
    expect((await db.selectFrom("media_uploads").select("moderation_state").where("id", "=", upload).executeTakeFirstOrThrow()).moderation_state).toBe("FLAGGED");
    const detail = await as(admin).get(`/api/moderation/cases/${kase!.id}`).expect(200);
    expect(detail.body.snapshot.media.map((m: { id: string }) => m.id)).toEqual([upload]);
    expect(detail.body.snapshot.mediaIds).toBeUndefined();
  });

  test("a hidden comment drops out of the post's comment count", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    const parent = await comment(author, pid, "parent");
    const reply = await comment(author, pid, "reply [[mod:violence=0.99]]", parent);
    expect((await scanTarget("COMMENT", reply)).outcome).toBe("HIDE");
    expect((await db.selectFrom("posts").select("comment_count").where("id", "=", pid).executeTakeFirstOrThrow()).comment_count).toBe(1);
    expect((await db.selectFrom("comments").select("reply_count").where("id", "=", parent).executeTakeFirstOrThrow()).reply_count).toBe(0);
  });

  test("hidden DM messages are pulled from both participants", async () => {
    const a = await createUser();
    const b = await createUser();
    const { threadId, messageId } = await dmMessage(a, b, "threat [[mod:harassment=0.99]]");
    rt.clear();
    expect((await scanTarget("DM_MESSAGE", messageId)).outcome).toBe("HIDE");
    for (const u of [a, b]) expect(rt.to(rooms.user(u.id), "dm:message:deleted")).toEqual([{ threadId, messageId }]);
    expect((await openCaseOf("DM_MESSAGE", messageId))!.community_id).toBeNull();
  });

  test("staff content is never auto-hidden, only queued", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const cid = await community(mod);
    const pid = await post(mod, cid, "quoting abuse [[mod:hate=0.95]]");
    expect((await scanTarget("POST", pid)).outcome).toBe("REVIEW");
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
  });

  test("a provider failure leaves the item UNCHECKED and throws (the queue retries)", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "anything");
    config.MODERATION_STUB_URL = "http://127.0.0.1:1";
    try {
      await expect(scanTarget("POST", pid)).rejects.toThrow();
    } finally {
      config.MODERATION_STUB_URL = stub.url;
    }
    expect((await statusOf("posts", pid)).moderation_state).toBe("UNCHECKED");
  });

  test("with moderation switched off nothing is touched", async () => {
    await useProvider("stub", { enabled: false });
    try {
      const author = await createUser();
      const cid = await community(author);
      const pid = await post(author, cid, "[[mod:hate=0.99]]");
      expect((await scanTarget("POST", pid)).outcome).toBe("SKIPPED");
      expect(await statusOf("posts", pid)).toEqual({ status: "PUBLISHED", moderation_state: "UNCHECKED" });
    } finally {
      await useProvider("stub");
    }
  });
});

describe("rules provider", () => {
  beforeAll(() => useProvider("rules", { blockedTerms: ["gronkle"] }));
  afterAll(() => useProvider("stub"));

  test("a blocked term hides a chat message and tells the room", async () => {
    const author = await createUser();
    const cid = await community(author);
    const mid = await chatMessage(author, cid, "you GRONKLE");
    rt.clear();
    expect((await scanTarget("CHAT_MESSAGE", mid)).outcome).toBe("HIDE");
    expect(rt.to(rooms.chat(cid), "chat:message:deleted")).toEqual([{ communityId: cid, messageId: mid }]);
  });

  test("the third identical message in ten minutes is spam", async () => {
    const author = await createUser();
    const cid = await community(author);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await chatMessage(author, cid, "join my channel now"));
    expect((await scanTarget("CHAT_MESSAGE", ids[0]!)).outcome).toBe("HIDE");
    const other = await chatMessage(author, cid, "a different message");
    expect((await scanTarget("CHAT_MESSAGE", other)).outcome).toBe("CLEAN");
  });

  test("link spam", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, Array.from({ length: 6 }, (_, i) => `https://spam${i}.example/x`).join(" "));
    expect((await scanTarget("POST", pid)).outcome).toBe("HIDE");
    expect((await openCaseOf("POST", pid))!.ai_categories).toEqual(["spam"]);
  });
});

describe("case scope and actions", () => {
  test("a community moderator sees only their communities and only content actions", async () => {
    const owner = await createUser();
    const mod = await createUser();
    const author = await createUser();
    const mine = await community(owner);
    const other = await community(owner);
    await join(mod, mine, "MODERATOR");
    await join(author, mine);
    await join(author, other);
    const p1 = await post(author, mine, "x [[mod:hate=0.6]]");
    const p2 = await post(author, other, "y [[mod:hate=0.6]]");
    await scanTarget("POST", p1);
    await scanTarget("POST", p2);
    const c1 = (await openCaseOf("POST", p1))!;
    const c2 = (await openCaseOf("POST", p2))!;

    const list = await as(mod).get("/api/moderation/cases?limit=50").expect(200);
    const ids = list.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(c1.id);
    expect(ids).not.toContain(c2.id);
    expect(list.body.items.every((c: { community: { id: string } }) => c.community.id === mine)).toBe(true);
    await as(mod).get(`/api/moderation/cases/${c2.id}`).expect(404);
    await as(mod).post(`/api/moderation/cases/${c2.id}/actions`).send({ action: "HIDE" }).expect(404);

    const suspend = await as(mod).post(`/api/moderation/cases/${c1.id}/actions`).send({ action: "SUSPEND", suspendDays: 3 }).expect(403);
    expect(suspend.body.code).toBe("STAFF_ONLY");
    // Stats are open to community moderators now, scoped to their communities (see "stats for community moderators").
    await as(mod).get("/api/moderation/stats").expect(200);

    const hidden = await as(mod).post(`/api/moderation/cases/${c1.id}/actions`).send({ action: "REMOVE", reason: "rule 2" }).expect(200);
    expect(hidden.body).toMatchObject({ status: "RESOLVED", resolution: "REMOVE", targetStatus: "REMOVED" });
    const again = await as(mod).post(`/api/moderation/cases/${c1.id}/actions`).send({ action: "RESTORE" }).expect(409);
    expect(again.body.code).toBe("CASE_RESOLVED");

    const audit = await db.selectFrom("audit_log").select("action").where("actor_id", "=", mod.id).execute();
    expect(audit.map((a) => a.action)).toContain("moderation.remove");
  });

  test("plain members cannot use the queue", async () => {
    const u = await createUser();
    await as(u).get("/api/moderation/cases").expect(403);
  });

  test("open queue orders by priority then age, and the cursor walks it", async () => {
    const author = await createUser();
    const cid = await community(author);
    for (const s of ["0.55", "0.7", "0.6"]) await scanTarget("POST", await post(author, cid, `p [[mod:hate=${s}]]`));
    const seen: { priority: number; openedAt: string }[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: { priority: number; openedAt: string }[]; nextCursor: string | null } } = await as(admin).get(`/api/moderation/cases?communityId=${cid}&limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen.map((c) => c.priority)).toEqual([70, 60, 55]);
  });

  test("a ban from a case revokes sessions, invalidates tokens and disconnects", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "z [[mod:hate=0.6]]");
    await scanTarget("POST", pid);
    const kase = (await openCaseOf("POST", pid))!;
    const mod = await createUser({ role: "MODERATOR" });
    await as(mod).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "BAN" }).expect(403);
    rt.clear();
    const res = await as(admin).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "BAN", reason: "repeat abuse" }).expect(200);
    expect(res.body).toMatchObject({ resolution: "BAN" });
    expect(rt.disconnects).toEqual([{ userIds: [author.id], reason: "BANNED" }]);
    const me = await as(author).get("/api/auth/me");
    expect([401, 403]).toContain(me.status);
    const hist = await as(admin).get(`/api/moderation/history?targetType=USER&targetId=${author.id}`).expect(200);
    expect(hist.body[0]).toMatchObject({ action: "BAN", caseId: kase.id, actor: { id: admin.id } });
  });

  test("assignment is staff-only and only to staff", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid, "q [[mod:hate=0.6]]");
    await scanTarget("POST", pid);
    const kase = (await openCaseOf("POST", pid))!;
    const mod = await createUser({ role: "MODERATOR" });
    await as(admin).post(`/api/moderation/cases/${kase.id}/assign`).send({ userId: author.id }).expect(400);
    await as(admin).post(`/api/moderation/cases/${kase.id}/assign`).send({ userId: mod.id }).expect(200);
    expect((await openCaseOf("POST", pid))!.assigned_to).toBe(mod.id);
  });

  test("stats count today's work", async () => {
    const res = await as(admin).get("/api/moderation/stats").expect(200);
    expect(res.body.openCases).toBeGreaterThan(0);
    expect(res.body.autoHiddenToday).toBeGreaterThan(0);
    expect(res.body.actionsToday).toBeGreaterThanOrEqual(res.body.autoHiddenToday);
  });

  test("stats for community moderators count only the communities they moderate; members get 403", async () => {
    const owner = await createUser();
    const mod = await createUser();
    const author = await createUser();
    const mine = await community(owner);
    const other = await community(owner);
    await join(mod, mine, "MODERATOR");
    for (const cid of [mine, other]) await join(author, cid);
    const a1 = await post(author, mine, "a [[mod:hate=0.6]]");
    await scanTarget("POST", a1);
    await scanTarget("POST", await post(author, mine, "b [[mod:hate=0.97]]"));
    for (let i = 0; i < 3; i++) await scanTarget("POST", await post(author, other, `c${i} [[mod:hate=0.6]]`));
    const before = (await as(mod).get("/api/moderation/stats").expect(200)).body;
    // Exactly this community's cases and actions: one REVIEW case plus one auto-hidden case, one automatic HIDE.
    expect(before).toEqual({ openCases: 2, openAppeals: 0, actionsToday: 1, autoHiddenToday: 1 });
    await as(mod).post(`/api/moderation/cases/${(await openCaseOf("POST", a1))!.id}/actions`).send({ action: "REMOVE" }).expect(200);
    expect((await as(mod).get("/api/moderation/stats").expect(200)).body).toEqual({ openCases: 1, openAppeals: 0, actionsToday: 2, autoHiddenToday: 1 });
    // The owner moderates both communities; staff see the network.
    expect((await as(owner).get("/api/moderation/stats").expect(200)).body.openCases).toBe(4);
    expect((await as(admin).get("/api/moderation/stats").expect(200)).body.openCases).toBeGreaterThanOrEqual(4);
    await as(author).get("/api/moderation/stats").expect(403);
    // A suspended moderator has no scope.
    await db.updateTable("community_members").set({ status: "SUSPENDED" }).where("community_id", "=", mine).where("user_id", "=", mod.id).execute();
    await as(mod).get("/api/moderation/stats").expect(403);
  });

  test("the author reads their own case: categories and reasons, but no raw scores, reporters, details or moderator; others 404", async () => {
    const owner = await createUser();
    const author = await createUser();
    const cid = await community(owner);
    await join(author, cid);
    const pid = await post(author, cid, "edgy [[mod:hate=0.6]]");
    await scanTarget("POST", pid);
    const reporters = [await createUser({ createdAt: new Date(Date.now() - 30 * 86400_000) }), await createUser({ createdAt: new Date(Date.now() - 30 * 86400_000) })];
    for (const r of reporters) await join(r, cid);
    for (const r of reporters) await as(r).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE", details: "PRIVATE-REPORT-DETAIL-TEXT" }).expect(201);
    const kase = (await openCaseOf("POST", pid))!;
    const staffMod = await createUser({ role: "MODERATOR" });
    await as(admin).post(`/api/moderation/cases/${kase.id}/assign`).send({ userId: staffMod.id }).expect(200);
    await as(staffMod).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "HIDE", reason: "MODERATOR-REASON" }).expect(200);

    const full = (await as(admin).get(`/api/moderation/cases/${kase.id}`).expect(200)).body;
    expect(full.aiScores).toMatchObject({ hate: 0.6 });
    expect(full.resolvedBy).toMatchObject({ id: staffMod.id });

    const seen = await as(author).get(`/api/moderation/cases/${kase.id}`).expect(200);
    expect(Object.keys(seen.body).sort()).toEqual(Object.keys(full).sort());
    expect(seen.body).toMatchObject({ id: kase.id, status: "RESOLVED", resolution: "HIDE", targetStatus: "HIDDEN", aiScores: null, resolvedBy: null, reportCount: 2, reasons: [{ reason: "HATE", count: 2 }] });
    expect(seen.body.aiCategories).toContain("hate");
    const text = JSON.stringify(seen.body);
    for (const id of [...reporters.map((r) => r.id), staffMod.id, admin.id]) expect(text).not.toContain(id);
    expect(text).not.toContain("PRIVATE-REPORT-DETAIL-TEXT");
    // /moderation/me gives the same author view.
    const listed = (await as(author).get("/api/moderation/me").expect(200)).body.items.find((c: { id: string }) => c.id === kase.id);
    expect(listed).toEqual(seen.body);

    // Anyone else, a reporter included, gets a 404.
    await as(reporters[0]!).get(`/api/moderation/cases/${kase.id}`).expect(404);
    await as(await createUser()).get(`/api/moderation/cases/${kase.id}`).expect(404);
  });

  test("the subject of a USER case reads it in the author view", async () => {
    const subject = await createUser();
    const reporter = await createUser({ createdAt: new Date(Date.now() - 30 * 86400_000) });
    await as(reporter).post("/api/reports").send({ targetType: "USER", targetId: subject.id, reason: "IMPERSONATION", details: "who they really are" }).expect(201);
    const kase = (await openCaseOf("USER", subject.id))!;
    const seen = await as(subject).get(`/api/moderation/cases/${kase.id}`).expect(200);
    expect(seen.body).toMatchObject({ targetType: "USER", targetId: subject.id, aiScores: null, resolvedBy: null, reasons: [{ reason: "IMPERSONATION", count: 1 }] });
    expect(JSON.stringify(seen.body)).not.toContain(reporter.id);
    expect(JSON.stringify(seen.body)).not.toContain("who they really are");
    await as(reporter).get(`/api/moderation/cases/${kase.id}`).expect(404);
  });

  test("timed suspensions are lifted by the sweep", async () => {
    const u = await createUser({ status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() - 1000) }).where("id", "=", u.id).execute();
    await liftSuspensionsJob();
    expect((await db.selectFrom("users").select(["status", "suspended_until"]).where("id", "=", u.id).executeTakeFirstOrThrow())).toEqual({ status: "ACTIVE", suspended_until: null });
  });
});
