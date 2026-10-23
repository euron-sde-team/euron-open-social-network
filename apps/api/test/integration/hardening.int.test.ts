/**
 * The security hardening pass: one describe per fix, each proving the behaviour through
 * the API (or the service the CLI and jobs call). Realtime fixes (room revocation,
 * presence scope, socket limits, sign-out disconnects) are in realtime.int.test.ts, the
 * sign-in throttling and two-factor fixes in auth.int.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { sql } from "kysely";
import { config } from "../../src/core/config";
import { Effects } from "../../src/core/effects";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { clearSentMail, sentMail } from "../../src/integrations/mail/mailer";
import { GENERIC_DM_REQUEST, GENERIC_PRIVATE_COMMUNITY, sendNotificationDigests } from "../../src/jobs/messaging.jobs";
import { loadMedia } from "../../src/presenters/media.presenter";
import { verifyPassword } from "../../src/security/passwords";
import { AdminBootstrapError, createAdmin } from "../../src/services/admin-bootstrap.service";
import { HEIC_UNSUPPORTED } from "../../src/services/media.service";
import { effectiveProvider, scanTarget } from "../../src/services/moderation/scan.service";
import { notify } from "../../src/services/notification.service";
import { saveSettings } from "../../src/services/settings.service";
import { anon, as, createUser, PASSWORD, type TestUser } from "./harness";
import { follow, sharedCommunity, upload } from "./messaging-fixtures";
import { community, daysAgo, join, openCaseOf, post, statusOf } from "./moderation-fixtures";
import { makeCommunity, resetSettings, setSettings, uniq } from "./social-fixtures";

let admin: TestUser;
beforeAll(async () => {
  admin = await createUser({ role: "ADMIN" });
});
afterAll(async () => {
  await resetSettings();
});

const old = () => createUser({ createdAt: daysAgo(10) });

// ─── 1. Admin bootstrap ────────────────────────────────────────────────────

describe("admin:create", () => {
  test("an existing account is promoted, activated and verified, and its password is untouched", async () => {
    const u = await createUser({ status: "SUSPENDED" });
    await db.updateTable("users").set({ email_verified_at: null }).where("id", "=", u.id).execute();
    const res = await createAdmin({ email: u.email.toUpperCase(), printPassword: true });
    expect(res.kind).toBe("PROMOTED");
    expect(res.message).toMatch(/password was not changed/);
    expect(res).not.toHaveProperty("password");
    const row = await db.selectFrom("users").select(["role", "status", "email_verified_at", "password_hash"]).where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ role: "ADMIN", status: "ACTIVE", email_verified_at: expect.any(Date) });
    expect(await verifyPassword(PASSWORD, row.password_hash)).toBe(true);
  });

  // The matrix runs this file under every mail mode, so each mode proves its own path:
  // outbox cannot deliver (refuse, create nothing); smtp and ses deliver the link.
  test.skipIf(config.MAIL_MODE !== "outbox")("a new admin when mail cannot be sent: a clear error, no password, nothing created", async () => {
    const email = `${uniq("boot")}@example.test`;
    const err = await createAdmin({ email }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminBootstrapError);
    expect(err.message).toMatch(/MAIL_MODE=outbox/);
    expect(err.message).toMatch(/--print-password/);
    expect(await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst()).toBeUndefined();
  });

  test.skipIf(config.MAIL_MODE === "outbox")("a new admin with working mail: created, and the set-password link is delivered", async () => {
    clearSentMail();
    const email = `${uniq("boot")}@example.test`;
    const res = await createAdmin({ email });
    expect(res.kind).toBe("CREATED_LINK_SENT");
    expect(JSON.stringify(res)).not.toMatch(/password":/);
    const mail = sentMail().find((m) => m.to === email);
    expect(mail?.text).toMatch(/reset-password\?token=/);
    const row = await db.selectFrom("users").select(["role", "status"]).where("email", "=", email).executeTakeFirst();
    expect(row).toEqual({ role: "ADMIN", status: "ACTIVE" });
  });

  test("--print-password creates the admin and prints a working one-time password", async () => {
    const email = `${uniq("boot")}@example.test`;
    const res = await createAdmin({ email, printPassword: true });
    expect(res.kind).toBe("CREATED_WITH_PASSWORD");
    if (res.kind !== "CREATED_WITH_PASSWORD") return;
    const login = await anon().post("/api/auth/login").send({ login: email, password: res.password }).expect(200);
    expect(login.body.user.role).toBe("ADMIN");
  });
});

// ─── 3. Moderators acting on their own cases ───────────────────────────────

describe("case actions and appeal decisions", () => {
  async function reportedPostBy(author: TestUser, cid?: string) {
    const communityId = cid ?? (await community(author));
    const pid = await post(author, communityId);
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    return { pid, communityId, caseId: (await openCaseOf("POST", pid))!.id };
  }

  test("a moderator may not act on a case about their own content (SELF_MODERATION); an admin may", async () => {
    const owner = await createUser();
    const cmod = await createUser();
    const cid = await community(owner);
    await join(cmod, cid, "MODERATOR");
    const own = await reportedPostBy(cmod, cid);
    const res = await as(cmod).post(`/api/moderation/cases/${own.caseId}/actions`).send({ action: "DISMISS" }).expect(403);
    expect(res.body.code).toBe("SELF_MODERATION");

    const staff = await createUser({ role: "MODERATOR" });
    const staffOwn = await reportedPostBy(staff);
    expect((await as(staff).post(`/api/moderation/cases/${staffOwn.caseId}/actions`).send({ action: "DISMISS" }).expect(403)).body.code).toBe("SELF_MODERATION");

    const adminOwn = await reportedPostBy(admin);
    await as(admin).post(`/api/moderation/cases/${adminOwn.caseId}/actions`).send({ action: "DISMISS" }).expect(200);
  });

  test("a restricted (suspended) staff account can neither act nor decide appeals", async () => {
    const author = await createUser();
    const { caseId } = await reportedPostBy(author);
    const mod = await createUser({ role: "MODERATOR", status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: daysAgo(-3) }).where("id", "=", mod.id).execute();
    expect((await as(mod).post(`/api/moderation/cases/${caseId}/actions`).send({ action: "REMOVE" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");

    const active = await createUser({ role: "MODERATOR" });
    await as(active).post(`/api/moderation/cases/${caseId}/actions`).send({ action: "REMOVE" }).expect(200);
    const appeal = (await as(author).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement: "Please look at this again." }).expect(201)).body;
    expect((await as(mod).post(`/api/moderation/appeals/${appeal.id}/decide`).send({ status: "OVERTURNED" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

// ─── 5. Media metadata ─────────────────────────────────────────────────────

describe("media before processing", () => {
  async function uploadRow(owner: TestUser, kind: "IMAGE" | "VIDEO", status: "COMPLETE" | "READY") {
    const id = newId();
    await db
      .insertInto("media_uploads")
      .values({ id, owner_id: owner.id, purpose: "POST", kind, mime_type: kind === "IMAGE" ? "image/jpeg" : "video/mp4", file_name: "f", declared_size: 10, size_bytes: 10, storage_key: `media/post/test/${id}`, status })
      .execute();
    return id;
  }

  test("an image is presented only once READY (EXIF stripped); other kinds from COMPLETE", async () => {
    const u = await createUser();
    const [rawImage, readyImage, video] = [await uploadRow(u, "IMAGE", "COMPLETE"), await uploadRow(u, "IMAGE", "READY"), await uploadRow(u, "VIDEO", "COMPLETE")];
    const shown = await loadMedia([rawImage, readyImage, video]);
    expect([...shown.keys()].sort()).toEqual([readyImage, video].sort());
    await as(await createUser({ role: "MODERATOR" })).get(`/api/media/${rawImage}`).expect(404);
    await as(u).get(`/api/media/${rawImage}`).expect(200);
  });

  test("a HEIC the server cannot decode is rejected with a reason, never served", async () => {
    const u = await createUser();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(200, 7)]);
    const { uploadId, res } = await upload(u, "POST", "photo.heic", "image/heic", heic);
    expect(res.body.status).not.toBe("READY");
    const row = await db.selectFrom("media_uploads").select(["status", "rejected_reason"]).where("id", "=", uploadId).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "REJECTED", rejected_reason: HEIC_UNSUPPORTED });
    expect((await loadMedia([uploadId])).size).toBe(0);
  });
});

// ─── 6. Report threshold ───────────────────────────────────────────────────

describe("the auto-hide threshold counts the open case only, from active reporters", () => {
  test("restored content is not re-hidden by one new report", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    for (let i = 0; i < 3; i++) await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("HIDDEN");
    const kase = (await openCaseOf("POST", pid))!;
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "RESTORE" }).expect(200);
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
  });

  test("a reporter who is no longer ACTIVE does not count", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    const first = await old();
    await as(first).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    await db.updateTable("users").set({ status: "SUSPENDED", suspended_until: daysAgo(-5) }).where("id", "=", first.id).execute();
    for (let i = 0; i < 2; i++) await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    expect((await statusOf("posts", pid)).status).toBe("HIDDEN");
  });
});

// ─── 7 and 14. Appeals ─────────────────────────────────────────────────────

describe("appeal overturns", () => {
  async function suspendedByCase() {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(201);
    const kase = (await openCaseOf("POST", pid))!;
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "SUSPEND", suspendDays: 3 }).expect(200);
    const appeal = (await as(author).post(`/api/moderation/cases/${kase.id}/appeal`).send({ statement: "I was quoting someone else." }).expect(201)).body;
    return { author, appeal };
  }

  test("overturning a suspension restores the account while it is still that suspension", async () => {
    const { author, appeal } = await suspendedByCase();
    await as(admin).post(`/api/moderation/appeals/${appeal.id}/decide`).send({ status: "OVERTURNED", note: "fine" }).expect(200);
    expect((await db.selectFrom("users").select("status").where("id", "=", author.id).executeTakeFirstOrThrow()).status).toBe("ACTIVE");
  });

  test("a later ban stands: the overturn is recorded without changing the account", async () => {
    const { author, appeal } = await suspendedByCase();
    await as(admin).post(`/api/admin/users/${author.id}/ban`).send({ reason: "unrelated spam ring" }).expect(200);
    const decided = await as(await createUser({ role: "ADMIN" })).post(`/api/moderation/appeals/${appeal.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect(decided.body.status).toBe("OVERTURNED");
    expect((await db.selectFrom("users").select("status").where("id", "=", author.id).executeTakeFirstOrThrow()).status).toBe("BANNED");
    const trail = await db.selectFrom("audit_log").select("data").where("entity_id", "=", appeal.id).where("action", "=", "moderation.appeal_overturned").executeTakeFirstOrThrow();
    expect(trail.data).toMatchObject({ accountRestored: false });
  });

  test("auto-hidden content can be appealed while its case is OPEN; deciding resolves the case", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    for (let i = 0; i < 3; i++) await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    const kase = (await openCaseOf("POST", pid))!;
    expect(kase.status).toBe("OPEN");
    const appeal = (await as(author).post(`/api/moderation/cases/${kase.id}/appeal`).send({ statement: "This is a harmless post." }).expect(201)).body;
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${appeal.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect((await statusOf("posts", pid)).status).toBe("PUBLISHED");
    const after = await db.selectFrom("moderation_cases").select(["status", "resolution"]).where("id", "=", kase.id).executeTakeFirstOrThrow();
    expect(after).toEqual({ status: "RESOLVED", resolution: "RESTORE" });
  });

  test("an OPEN case nobody hid is not appealable", async () => {
    const author = await createUser();
    const cid = await community(author);
    const pid = await post(author, cid);
    await as(await old()).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(201);
    const kase = (await openCaseOf("POST", pid))!;
    expect((await as(author).post(`/api/moderation/cases/${kase.id}/appeal`).send({ statement: "Nothing happened yet." }).expect(400)).body.code).toBe("NOT_APPEALABLE");
  });
});

// ─── 8 and 9. Direct messages ──────────────────────────────────────────────

describe("message requests and group history", () => {
  test("deleting sent messages does not reset the request cap, and DM_REQUEST fires once", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const t = (await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200)).body;
    for (let i = 0; i < 3; i++) {
      const m = (await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: `hello ${i}` }).expect(201)).body;
      await as(a).delete(`/api/dms/messages/${m.id}`).expect(204);
    }
    const capped = await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "one more" }).expect(403);
    expect(capped.body.code).toBe("DM_REQUEST_PENDING");
    expect((await as(a).get(`/api/dms/threads/${t.id}`).expect(200)).body.canSend).toBe(false);
    const requests = await db.selectFrom("notifications").select("id").where("recipient_id", "=", b.id).where("type", "=", "DM_REQUEST").execute();
    expect(requests).toHaveLength(1);
  });

  test("someone added to a group sees only messages from when they joined", async () => {
    const [a, b, c, late] = [await createUser(), await createUser(), await createUser(), await createUser()];
    await sharedCommunity(a, b, c, late);
    for (const u of [b, c, late]) await follow(u, a);
    const g = (await as(a).post("/api/dms/threads/group").send({ userIds: [b.id, c.id] }).expect(201)).body;
    const early = (await as(a).post(`/api/dms/threads/${g.id}/messages`).send({ body: "secretplan before you joined" }).expect(201)).body;
    await as(a).post(`/api/dms/messages/${early.id}/pin`).expect(200);
    await new Promise((r) => setTimeout(r, 20));
    await as(a).post(`/api/dms/threads/${g.id}/participants`).send({ userIds: [late.id] }).expect(200);
    const after = (await as(b).post(`/api/dms/threads/${g.id}/messages`).send({ body: "welcome aboard", replyToId: early.id }).expect(201)).body;

    const history = (await as(late).get(`/api/dms/threads/${g.id}/messages`).expect(200)).body.items;
    expect(history.map((m: { id: string }) => m.id)).toEqual([after.id]);
    expect(history[0].replyTo).toMatchObject({ id: early.id, body: "" });
    expect((await as(late).get(`/api/dms/threads/${g.id}/search?q=secretplan`).expect(200)).body).toEqual([]);
    expect((await as(late).get(`/api/dms/threads/${g.id}/pinned`).expect(200)).body).toEqual([]);
    const thread = (await as(late).get(`/api/dms/threads/${g.id}`).expect(200)).body;
    expect(thread.unreadCount).toBe(1);
    await as(late).put(`/api/dms/messages/${early.id}/reactions/${encodeURIComponent("👍")}`).expect(404);
    // Members from the start still see everything.
    expect((await as(c).get(`/api/dms/threads/${g.id}/messages`).expect(200)).body.items).toHaveLength(2);
  });
});

// ─── 13. Premoderation ─────────────────────────────────────────────────────

describe("premoderated posts", () => {
  afterEach(() => resetSettings());

  test("the case opens with the post (moderation off), and approval sends the skipped mentions", async () => {
    await setSettings({ moderation: { enabled: false } as never });
    const owner = await createUser();
    const c = await makeCommunity(owner);
    await as(owner).patch(`/api/communities/${c.id}`).send({ premoderatePosts: true }).expect(200);
    const [author, friend] = [await createUser(), await createUser()];
    for (const u of [author, friend]) await join(u, c.id);
    const created = (await as(author).post("/api/posts").send({ communityId: c.id, body: `look at this @${friend.username}` }).expect(201)).body;
    expect(created.status).toBe("PENDING_REVIEW");
    const kase = (await openCaseOf("POST", created.id))!;
    expect(kase).toMatchObject({ source: "PREMODERATION", status: "OPEN" });
    const mention = () => db.selectFrom("notifications").select("id").where("recipient_id", "=", friend.id).where("type", "=", "MENTION").where("entity_id", "=", created.id).execute();
    expect(await mention()).toHaveLength(0);
    await as(owner).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "APPROVE" }).expect(200);
    expect(await mention()).toHaveLength(1);
  });
});

// ─── 14. Provider fallback and 15. scan coverage ───────────────────────────

describe("scanning", () => {
  afterEach(() => resetSettings());

  test("provider openai without a usable key scans with the rules provider", async () => {
    const saved = config.OPENAI_API_KEY;
    try {
      for (const key of [undefined, "set-me"]) {
        config.OPENAI_API_KEY = key;
        expect(effectiveProvider("openai")).toBe("rules");
      }
      config.OPENAI_API_KEY = "sk-something-real";
      expect(effectiveProvider("openai")).toBe("openai");
      config.OPENAI_API_KEY = "set-me";
      await saveSettings({ moderation: { provider: "openai", blockedTerms: ["zorbleflax"] } as never }, admin.id);
      const author = await createUser();
      const pid = await post(author, await community(author), "a zorbleflax post");
      expect((await scanTarget("POST", pid)).outcome).not.toBe("CLEAN");
    } finally {
      config.OPENAI_API_KEY = saved;
    }
  });

  test("an event's location and virtual link are scanned", async () => {
    await saveSettings({ moderation: { provider: "rules", blockedTerms: ["quuxword"] } as never }, admin.id);
    const organizer = await createUser();
    const cid = await community(organizer);
    for (const field of ["location", "virtual_link"] as const) {
      const id = newId();
      await db
        .insertInto("events")
        .values({ id, community_id: cid, organizer_id: organizer.id, title: "A meetup", description: "clean text", starts_at: daysAgo(-2), ends_at: daysAgo(-3), [field]: field === "location" ? "quuxword hall" : "https://example.test/quuxword" })
        .execute();
      expect((await scanTarget("EVENT", id)).outcome).not.toBe("CLEAN");
    }
  });

  test("a profile edit is scanned; a bad profile gets a REVIEW case and is never hidden", async () => {
    await saveSettings({ moderation: { provider: "rules", blockedTerms: ["blorptastic"] } as never }, admin.id);
    const u = await createUser();
    await as(u).patch("/api/users/me").send({ bio: "I am blorptastic" }).expect(200);
    const kase = await openCaseOf("USER", u.id);
    expect(kase).toMatchObject({ source: "AI", author_id: u.id });
    expect((await db.selectFrom("users").select("status").where("id", "=", u.id).executeTakeFirstOrThrow()).status).toBe("ACTIVE");
    await as(u).get(`/api/users/${u.username}`).expect(200);
  });
});

// ─── 16. Moderator deletes through the normal endpoints ────────────────────

describe("moderator removals leave a moderation trail", () => {
  test("post, comment, question and answer deleted by a moderator write REMOVE actions and audit entries", async () => {
    const owner = await createUser();
    const author = await createUser();
    const cid = await community(owner);
    await join(author, cid);
    const pid = await post(author, cid);
    const cmt = (await as(author).post(`/api/posts/${pid}/comments`).send({ body: "a comment" }).expect(201)).body.id as string;
    const q = (await as(author).post("/api/questions").send({ communityId: cid, title: "How do I do this thing?", body: "details" }).expect(201)).body.id as string;
    const ans = (await as(author).post(`/api/questions/${q}/answers`).send({ body: "an answer" }).expect(201)).body.id as string;

    await as(owner).delete(`/api/comments/${cmt}`).expect(204);
    await as(owner).delete(`/api/questions/answers/${ans}`).expect(204);
    await as(owner).delete(`/api/questions/${q}`).expect(204);
    await as(owner).delete(`/api/posts/${pid}`).expect(204);

    for (const [type, id, auditAction] of [["COMMENT", cmt, "comment.remove"], ["ANSWER", ans, "answer.remove"], ["QUESTION", q, "question.remove"], ["POST", pid, "post.remove"]] as const) {
      const action = await db.selectFrom("moderation_actions").selectAll().where("target_type", "=", type).where("target_id", "=", id).executeTakeFirst();
      expect(action, type).toMatchObject({ action: "REMOVE", case_id: null, actor_id: owner.id });
      const entry = await db.selectFrom("audit_log").select("action").where("entity_id", "=", id).where("action", "=", auditAction).executeTakeFirst();
      expect(entry, type).toBeDefined();
    }
    const hist = await as(await createUser({ role: "MODERATOR" })).get(`/api/moderation/history?targetType=POST&targetId=${pid}`).expect(200);
    expect(hist.body.map((h: { action: string }) => h.action)).toContain("REMOVE");
  });
});

// ─── 17. Notifications and digests ─────────────────────────────────────────

describe("digests and per-community notification settings", () => {
  async function aged(recipient: TestUser, over: { type: "DM_REQUEST" | "POST_COMMENT"; snippet: string; communityId?: string | null; actor?: TestUser }) {
    await db
      .insertInto("notifications")
      .values({ id: newId(), recipient_id: recipient.id, actor_id: over.actor?.id ?? null, type: over.type, entity_type: "post", entity_id: newId(), community_id: over.communityId ?? null, snippet: over.snippet, created_at: sql`now() - interval '2 hours'` })
      .execute();
  }

  test("Me.emailDigest; an opted-out user gets no digest", async () => {
    const u = await createUser();
    expect((await as(u).get("/api/auth/me").expect(200)).body.emailDigest).toBe(true);
    expect((await as(u).patch("/api/users/me").send({ emailDigest: false }).expect(200)).body.emailDigest).toBe(false);
    await aged(u, { type: "POST_COMMENT", snippet: "hello" });
    expect(await sendNotificationDigests(u.id)).toBe(0);
  });

  test("DM requests and private-community activity are generic in the email", async () => {
    const u = await createUser();
    const actor = await createUser({ displayName: "Mallory Sender" });
    const priv = await community(actor, { visibility: "PRIVATE" });
    await join(u, priv);
    await aged(u, { type: "DM_REQUEST", snippet: "my first secret words", actor });
    await aged(u, { type: "POST_COMMENT", snippet: "private community text", communityId: priv, actor });
    await aged(u, { type: "POST_COMMENT", snippet: "public words", actor });
    clearSentMail();
    expect(await sendNotificationDigests(u.id)).toBe(1);
    const mail = sentMail().at(-1)!;
    expect(mail.text).toContain(GENERIC_DM_REQUEST);
    expect(mail.text).toContain(GENERIC_PRIVATE_COMMUNITY);
    expect(mail.text).toContain("public words");
    expect(mail.text).not.toMatch(/secret words|private community text/);
  });

  test("events off silences EVENT_* for that community; posts OFF and HIGHLIGHTS silence what they say", async () => {
    const owner = await createUser();
    const c = await makeCommunity(owner);
    const u = await createUser();
    await join(u, c.id);
    const fire = async (type: "EVENT_UPDATED" | "POST_COMMENT" | "POST_REACTION") => {
      const fx = new Effects();
      await notify({ recipientId: u.id, actorId: owner.id, type, entityType: "x", entityId: newId(), communityId: c.id }, fx);
      await fx.flush();
    };
    const count = async (type: string) => (await db.selectFrom("notifications").select("id").where("recipient_id", "=", u.id).where("type", "=", type as never).execute()).length;

    await as(u).patch(`/api/communities/${c.id}/notification-settings`).send({ events: false }).expect(200);
    await fire("EVENT_UPDATED");
    expect(await count("EVENT_UPDATED")).toBe(0);

    await as(u).patch(`/api/communities/${c.id}/notification-settings`).send({ posts: "HIGHLIGHTS" }).expect(200);
    await fire("POST_REACTION");
    await fire("POST_COMMENT");
    expect([await count("POST_REACTION"), await count("POST_COMMENT")]).toEqual([0, 1]);

    await as(u).patch(`/api/communities/${c.id}/notification-settings`).send({ posts: "OFF" }).expect(200);
    await fire("POST_COMMENT");
    expect(await count("POST_COMMENT")).toBe(1);
  });
});

// ─── 19. Account deletion and export ───────────────────────────────────────

describe("account lifecycle", () => {
  test("an owner must transfer first (409 with the communities)", async () => {
    const u = await createUser();
    const c = await makeCommunity(u, { name: `Owned ${uniq()}` });
    const res = await as(u).delete("/api/users/me").send({ password: PASSWORD }).expect(409);
    expect(res.body).toMatchObject({ code: "OWNER_MUST_TRANSFER", details: { communities: [{ name: c.name, slug: c.slug }] } });
  });

  test("delete deactivates and anonymises, revokes everything, and the content stays as Deleted user", async () => {
    const [u, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    const owner = await createUser();
    const cid = await community(owner);
    await join(u, cid);
    await db.updateTable("communities").set({ member_count: 2 }).where("id", "=", cid).execute();
    await as(u).post(`/api/users/${friend.id}/follow`).expect(204);
    await as(friend).post(`/api/users/${u.id}/follow`).expect(204);
    const pid = await post(u, cid, "my old post");
    await sharedCommunity(u, stranger);
    const request = (await as(u).post("/api/dms/threads").send({ userId: stranger.id }).expect(200)).body;
    await as(u).post(`/api/dms/threads/${request.id}/messages`).send({ body: "hi there" }).expect(201);
    const login = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);

    await as(u).delete("/api/users/me").send({ password: "wrong-password" }).expect(400);
    await as(u).delete("/api/users/me").send({ password: PASSWORD }).expect(204);

    const row = await db.selectFrom("users").selectAll().where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user", bio: null, headline: null, avatar_upload_id: null, email: `deleted+${u.id.toLowerCase()}@invalid.example` });
    expect(row.username).toMatch(/^deleted_/);
    await as(u).get("/api/auth/me").expect(401);
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(401);
    expect(login.status).toBe(200);
    expect(await db.selectFrom("sessions").select("id").where("user_id", "=", u.id).where("revoked_at", "is", null).execute()).toHaveLength(0);
    expect(await db.selectFrom("follows").select("follower_id").where((eb) => eb.or([eb("follower_id", "=", u.id), eb("followee_id", "=", u.id)])).execute()).toHaveLength(0);
    expect((await db.selectFrom("users").select(["follower_count", "following_count"]).where("id", "=", friend.id).executeTakeFirstOrThrow())).toEqual({ follower_count: 0, following_count: 0 });
    expect((await db.selectFrom("community_members").select("status").where("user_id", "=", u.id).where("community_id", "=", cid).executeTakeFirstOrThrow()).status).toBe("LEFT");
    expect((await db.selectFrom("communities").select("member_count").where("id", "=", cid).executeTakeFirstOrThrow()).member_count).toBe(1);
    expect(await db.selectFrom("dm_threads").select("id").where("id", "=", request.id).executeTakeFirst()).toBeUndefined();

    const shown = (await as(owner).get(`/api/posts/${pid}`).expect(200)).body;
    expect(shown.author).toMatchObject({ id: u.id, displayName: "Deleted user" });
  });

  test("export downloads your own data as JSON, 3 times a day", async () => {
    const u = await createUser();
    const cid = await community(u);
    await post(u, cid, "exported words");
    const res = await as(u).get("/api/users/me/export").buffer(true).parse((r, cb) => {
      let data = "";
      r.on("data", (c: Buffer) => (data += c.toString()));
      r.on("end", () => cb(null, data));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const doc = JSON.parse(res.body as string);
    expect(doc.profile).toMatchObject({ id: u.id, email: u.email });
    expect(doc.posts.map((p: { body: string }) => p.body)).toEqual(["exported words"]);
    for (const k of ["comments", "chatMessages", "directMessages", "memberships", "following", "followers", "blocks", "reports", "notifications"]) expect(Array.isArray(doc[k]), k).toBe(true);
    expect(doc.memberships).toHaveLength(1);

    process.env.RATE_LIMITS = "on";
    try {
      const v = await createUser();
      for (let i = 0; i < 3; i++) await as(v).get("/api/users/me/export").expect(200);
      await as(v).get("/api/users/me/export").expect(429);
    } finally {
      delete process.env.RATE_LIMITS;
    }
  });
});

// ─── 20. Invite-only registration ──────────────────────────────────────────

describe("registration with invites", () => {
  afterEach(() => resetSettings());

  const signup = (inviteCode?: string) => {
    const username = uniq("inv_").slice(0, 30);
    return anon()
      .post("/api/auth/signup")
      .send({ email: `${username}@example.test`, username, displayName: "Invited", password: PASSWORD, ...(inviteCode ? { inviteCode } : {}) });
  };

  test("INVITE_ONLY needs a valid code; after verification the account joins that community", async () => {
    await setSettings({ registration: "INVITE_ONLY" });
    const owner = await createUser();
    const c = await makeCommunity(owner, { visibility: "PRIVATE", joinPolicy: "INVITE_ONLY" });
    const invite = (await as(owner).post(`/api/communities/${c.id}/invites`).send({ maxUses: 1 }).expect(201)).body;

    expect((await signup().expect(403)).body.code).toBe("INVITE_REQUIRED");
    expect((await signup("not-a-real-code").expect(400)).body.code).toBe("INVITE_INVALID");
    clearSentMail();
    const ok = await signup(invite.code).expect(202);
    expect((await signup(invite.code).expect(400)).body.code).toBe("INVITE_INVALID"); // exhausted
    const token = decodeURIComponent(sentMail().at(-1)!.text.match(/token=([\w-]+)/)![1]!);
    const verified = await anon().post("/api/auth/verify-email").send({ token }).expect(200);
    expect(verified.body.user.email).toBe(ok.body.email);
    const m = await db.selectFrom("community_members").select(["status", "role"]).where("community_id", "=", c.id).where("user_id", "=", verified.body.user.id).executeTakeFirstOrThrow();
    expect(m).toEqual({ status: "ACTIVE", role: "MEMBER" });
  });

  test("CLOSED refuses everyone, invite or not", async () => {
    await setSettings({ registration: "CLOSED" });
    const owner = await createUser();
    const c = await makeCommunity(owner);
    const invite = (await as(owner).post(`/api/communities/${c.id}/invites`).send({}).expect(201)).body;
    expect((await signup(invite.code).expect(403)).body.code).toBe("REGISTRATION_CLOSED");
  });
});

// ─── 22. Network name ──────────────────────────────────────────────────────

describe("settings.networkName", () => {
  afterEach(() => resetSettings());

  test("GET /api/meta and emails use the configured name", async () => {
    await setSettings({ networkName: "Harbor Club", registration: "INVITE_ONLY" });
    expect((await anon().get("/api/meta").expect(200)).body).toEqual({ networkName: "Harbor Club", registration: "INVITE_ONLY" });
    const u = await createUser();
    clearSentMail();
    await anon().post("/api/auth/forgot-password").send({ email: u.email }).expect(202);
    const mail = sentMail().at(-1)!;
    expect(mail.subject).toBe("Reset your Harbor Club password");
    expect(mail.html).toContain("Harbor Club");
  });
});
