import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { community, counts, join, openCaseOf, post, statusOf } from "./moderation-fixtures";

async function removedPost(by: TestUser, action: "REMOVE" | "HIDE" | "DISMISS" | "SUSPEND" = "REMOVE") {
  const author = await createUser();
  const cid = await community(author);
  const pid = await post(author, cid);
  await as(await createUser()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(201);
  const kase = (await openCaseOf("POST", pid))!;
  await as(by).post(`/api/moderation/cases/${kase.id}/actions`).send({ action, ...(action === "SUSPEND" ? { suspendDays: 2 } : {}) }).expect(200);
  return { author, cid, pid, caseId: kase.id };
}

describe("appeals", () => {
  test("once per case, decided by someone else, and overturning restores the post", async () => {
    const mod1 = await createUser({ role: "MODERATOR" });
    const mod2 = await createUser({ role: "MODERATOR" });
    const { author, cid, pid, caseId } = await removedPost(mod1);
    const before = await counts(cid, author.id);

    const appeal = await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "This was a quote, not my opinion." }).expect(201);
    expect(appeal.body).toMatchObject({ caseId, status: "PENDING", appellant: { id: author.id } });
    const again = await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "Please look again at this one." }).expect(409);
    expect(again.body.code).toBe("ALREADY_APPEALED");

    const pending = await as(mod2).get("/api/moderation/appeals?status=PENDING&limit=50").expect(200);
    expect(pending.body.items.map((a: { id: string }) => a.id)).toContain(appeal.body.id);
    await as(author).get("/api/moderation/appeals").expect(403);

    const conflict = await as(mod1).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "OVERTURNED" }).expect(403);
    expect(conflict.body.code).toBe("APPEAL_CONFLICT");

    const decided = await as(mod2).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "OVERTURNED", note: "Context makes it fine." }).expect(200);
    expect(decided.body).toMatchObject({ status: "OVERTURNED", decisionNote: "Context makes it fine.", decidedAt: expect.any(String) });
    expect(await statusOf("posts", pid)).toEqual({ status: "PUBLISHED", moderation_state: "CLEAN" });
    expect(await counts(cid, author.id)).toEqual({ community: before.community + 1, user: before.user + 1 });
    const note = await db.selectFrom("notifications").select("type").where("recipient_id", "=", author.id).where("type", "=", "APPEAL_DECIDED").execute();
    expect(note).toHaveLength(1);

    await as(mod2).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "UPHELD" }).expect(409);
    const kase = await as(author).get("/api/moderation/me").expect(200);
    expect(kase.body.items.find((c: { id: string }) => c.id === caseId).appeal).toMatchObject({ status: "OVERTURNED" });
  });

  test("upheld leaves the decision in place", async () => {
    const mod1 = await createUser({ role: "MODERATOR" });
    const { author, pid, caseId } = await removedPost(mod1, "HIDE");
    const appeal = await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "I think this is a mistake." }).expect(201);
    await as(await createUser({ role: "ADMIN" })).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "UPHELD" }).expect(200);
    expect((await statusOf("posts", pid)).status).toBe("HIDDEN");
  });

  test("an admin may decide their own case only with a note", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { author, caseId } = await removedPost(admin);
    const appeal = await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "Please reconsider this one." }).expect(201);
    await as(admin).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "UPHELD" }).expect(403);
    await as(admin).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "UPHELD", note: "Only admin on duty; reviewed twice." }).expect(200);
  });

  test("only the author, only appealable resolutions, only within 30 days", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const dismissed = await removedPost(mod, "DISMISS");
    const res = await as(dismissed.author).post(`/api/moderation/cases/${dismissed.caseId}/appeal`).send({ statement: "Nothing happened but still." }).expect(400);
    expect(res.body.code).toBe("NOT_APPEALABLE");

    const removed = await removedPost(mod);
    await as(await createUser()).post(`/api/moderation/cases/${removed.caseId}/appeal`).send({ statement: "Not my post at all though." }).expect(404);
    await as(removed.author).post(`/api/moderation/cases/${removed.caseId}/appeal`).send({ statement: "short" }).expect(400);
    await db.updateTable("moderation_cases").set({ resolved_at: new Date(Date.now() - 31 * 86400_000) }).where("id", "=", removed.caseId).execute();
    const late = await as(removed.author).post(`/api/moderation/cases/${removed.caseId}/appeal`).send({ statement: "Sorry, I was away for a while." }).expect(400);
    expect(late.body.code).toBe("APPEAL_WINDOW_CLOSED");
  });

  test("a suspended author can appeal, and overturning lifts the suspension", async () => {
    const staff = await createUser({ role: "MODERATOR" });
    const { author, caseId } = await removedPost(staff, "SUSPEND");
    expect((await db.selectFrom("users").select("status").where("id", "=", author.id).executeTakeFirstOrThrow()).status).toBe("SUSPENDED");
    const appeal = await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "I was hacked that evening." }).expect(201);
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${appeal.body.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect(await db.selectFrom("users").select(["status", "suspended_until"]).where("id", "=", author.id).executeTakeFirstOrThrow()).toEqual({ status: "ACTIVE", suspended_until: null });
  });

  test("community moderators cannot decide appeals", async () => {
    const owner = await createUser();
    const cid = await community(owner);
    const cmod = await createUser();
    await join(cmod, cid, "MODERATOR");
    await as(cmod).get("/api/moderation/appeals").expect(403);
  });
});
