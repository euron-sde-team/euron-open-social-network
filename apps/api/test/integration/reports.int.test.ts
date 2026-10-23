import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { rooms } from "../../src/realtime/port";
import { as, createUser, recordRealtime } from "./harness";
import { chatMessage, community, counts, daysAgo, dmMessage, join, openCaseOf, post, statusOf } from "./moderation-fixtures";

const rt = recordRealtime();
const old = () => createUser({ createdAt: daysAgo(30) });

describe("filing reports", () => {
  test("a report opens a REPORT case; the same reporter twice is 409", async () => {
    const author = await createUser();
    const reporter = await old();
    const cid = await community(author);
    const pid = await post(author, cid);
    const res = await as(reporter).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM", details: "selling things" }).expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    const kase = await openCaseOf("POST", pid);
    expect(kase).toMatchObject({ source: "REPORT", report_count: 1, priority: 10, community_id: cid, author_id: author.id });

    const dup = await as(reporter).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(409);
    expect(dup.body.code).toBe("ALREADY_REPORTED");
  });

  test("reports from different people join one case and raise its priority", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    await as(await createUser()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    await as(await createUser()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HARASSMENT" }).expect(201);
    const cases = await db.selectFrom("moderation_cases").selectAll().where("target_id", "=", pid).execute();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ report_count: 2, priority: 20 });
    const admin = await createUser({ role: "ADMIN" });
    const detail = await as(admin).get(`/api/moderation/cases/${cases[0]!.id}`).expect(200);
    expect(detail.body.reasons).toEqual(expect.arrayContaining([{ reason: "SPAM", count: 1 }, { reason: "HARASSMENT", count: 1 }]));
  });

  test("you cannot report yourself or your own content", async () => {
    const u = await createUser();
    const cid = await community(u);
    const pid = await post(u, cid);
    expect((await as(u).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_SELF");
    expect((await as(u).post("/api/reports").send({ targetType: "USER", targetId: u.id, reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_SELF");
  });

  test("invisible targets are 404: private community, a block, someone else's DM, a missing id", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const priv = await community(owner, { visibility: "PRIVATE" });
    const hidden = await post(owner, priv);
    await as(outsider).post("/api/reports").send({ targetType: "POST", targetId: hidden, reason: "SPAM" }).expect(404);
    await as(outsider).post("/api/reports").send({ targetType: "CHAT_MESSAGE", targetId: await chatMessage(owner, priv, "hi"), reason: "SPAM" }).expect(404);

    const pub = await community(owner);
    const visible = await post(owner, pub);
    await db.insertInto("blocks").values({ blocker_id: owner.id, blocked_id: outsider.id }).execute();
    await as(outsider).post("/api/reports").send({ targetType: "POST", targetId: visible, reason: "SPAM" }).expect(404);
    await as(outsider).post("/api/reports").send({ targetType: "USER", targetId: owner.id, reason: "SPAM" }).expect(404);

    const { messageId } = await dmMessage(owner, await createUser(), "private words");
    await as(outsider).post("/api/reports").send({ targetType: "DM_MESSAGE", targetId: messageId, reason: "HARASSMENT" }).expect(404);
    await as(outsider).post("/api/reports").send({ targetType: "POST", targetId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "SPAM" }).expect(404);
  });

  test("participants can report a DM; members can report chat", async () => {
    const a = await createUser();
    const b = await createUser();
    const { messageId } = await dmMessage(a, b, "nasty");
    await as(b).post("/api/reports").send({ targetType: "DM_MESSAGE", targetId: messageId, reason: "HARASSMENT" }).expect(201);
    expect((await openCaseOf("DM_MESSAGE", messageId))!.community_id).toBeNull();

    const cid = await community(a);
    await join(b, cid);
    await as(b).post("/api/reports").send({ targetType: "CHAT_MESSAGE", targetId: await chatMessage(a, cid, "spam spam"), reason: "SPAM" }).expect(201);
  });

  test("bad input is a 400", async () => {
    const u = await createUser();
    await as(u).post("/api/reports").send({ targetType: "POST", targetId: "nope", reason: "SPAM" }).expect(400);
    await as(u).post("/api/reports").send({ targetType: "WHAT", targetId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "SPAM" }).expect(400);
    await as(null).post("/api/reports").send({}).expect(401);
  });

  test("suspended accounts cannot report", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    const res = await as(await createUser({ status: "SUSPENDED" })).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("report auto-hide", () => {
  test("three established reporters hide the post pending review", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    const before = await counts(cid, author.id);
    for (let i = 0; i < 2; i++) await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
    rt.clear();
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("HIDDEN");
    expect(await counts(cid, author.id)).toEqual({ community: before.community - 1, user: before.user - 1 });
    expect(rt.to(rooms.post(pid), "post:removed")).toHaveLength(1);
    const kase = (await openCaseOf("POST", pid))!;
    expect(kase.status).toBe("OPEN");
    const action = await db.selectFrom("moderation_actions").selectAll().where("case_id", "=", kase.id).executeTakeFirstOrThrow();
    expect(action).toMatchObject({ action: "HIDE", actor_id: null });

    // The author is told, and their case view shows reasons but nobody's identity.
    const mine = await as(author).get("/api/moderation/me").expect(200);
    const text = JSON.stringify(mine.body);
    expect(mine.body.items[0]).toMatchObject({ id: kase.id, reportCount: 3, targetStatus: "HIDDEN" });
    const reporters = await db.selectFrom("reports").select("reporter_id").where("case_id", "=", kase.id).execute();
    for (const r of reporters) expect(text).not.toContain(r.reporter_id);
  });

  test("brand-new accounts do not count toward the threshold", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    for (let i = 0; i < 4; i++) await as(await createUser()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
  });

  test("staff content and accounts are never auto-hidden", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const cid = await community(mod);
    const pid = await post(mod, cid);
    for (let i = 0; i < 3; i++) await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");

    const target = await createUser();
    for (let i = 0; i < 3; i++) await as(await old()).post("/api/reports").send({ targetType: "USER", targetId: target.id, reason: "IMPERSONATION" }).expect(201);
    expect((await db.selectFrom("users").select("status").where("id", "=", target.id).executeTakeFirstOrThrow()).status).toBe("ACTIVE");
    expect((await openCaseOf("USER", target.id))).toMatchObject({ community_id: null, author_id: target.id, report_count: 3 });
  });
});
