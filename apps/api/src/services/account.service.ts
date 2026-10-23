/**
 * Account lifecycle: deleting your own account, and exporting your own data.
 *
 * Delete (DELETE /api/users/me) deactivates and anonymises in one transaction. The row
 * stays, because posts, comments and messages reference it and threads and discussions
 * would otherwise lose their shape; what identified the person goes:
 *   status DEACTIVATED, email deleted+<id>@invalid.example, username deleted_<id tail>,
 *   display name "Deleted user", headline, bio, location, website, avatar and cover
 *   cleared, two-factor and recovery codes removed, digests off, password replaced
 *   with an unknown one; every session revoked, token_version bumped and every socket
 *   disconnected; memberships LEFT (member counts move), follows in both directions
 *   removed (counts move), group and DM participation LEFT, and message requests they
 *   sent that were never accepted deleted.
 * Content stays and is shown under "Deleted user". Owning a live community blocks
 * deletion (409 OWNER_MUST_TRANSFER, details.communities), and so does being the last
 * active admin (409 LAST_ADMIN).
 *
 * Export (GET /api/users/me/export) streams one JSON document of the caller's own data,
 * read in pages of EXPORT_PAGE rows so a large account never sits in memory at once.
 */
import type { Response } from "express";
import { sql } from "kysely";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict } from "../core/errors";
import { db } from "../db/kysely";
import { toMe } from "../presenters/user.presenter";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken } from "../security/tokens";
import { audit } from "./audit.service";
import { confirmIdentity } from "./auth.service";

export const DELETED_DISPLAY_NAME = "Deleted user";

export async function deleteAccount(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }, meta: RequestMeta): Promise<void> {
  const user = await confirmIdentity(actor, input);
  const owned = await db
    .selectFrom("community_members as m")
    .innerJoin("communities as c", "c.id", "m.community_id")
    .select(["c.name", "c.slug"])
    .where("m.user_id", "=", user.id)
    .where("m.role", "=", "OWNER")
    .where("m.status", "=", "ACTIVE")
    .where("c.status", "<>", "DELETED")
    .orderBy("c.name")
    .execute();
  if (owned.length) {
    throw conflict("Transfer ownership of your communities (or delete them) before deleting your account", "OWNER_MUST_TRANSFER", { communities: owned.map((c) => ({ name: c.name, slug: String(c.slug) })) });
  }
  if (user.role === "ADMIN") {
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", user.id).executeTakeFirst();
    if (!others) throw conflict("You are the last administrator; make someone else an admin first", "LAST_ADMIN");
  }
  const unusable = await hashPassword(randomToken());

  await withTransaction(async (trx, fx) => {
    const id = user.id;
    await trx
      .updateTable("users")
      .set({
        status: "DEACTIVATED",
        role: "USER",
        email: `deleted+${id.toLowerCase()}@invalid.example`,
        username: `deleted_${id.slice(-12).toLowerCase()}`,
        display_name: DELETED_DISPLAY_NAME,
        headline: null,
        bio: null,
        location: null,
        website: null,
        avatar_upload_id: null,
        cover_upload_id: null,
        password_hash: unusable,
        totp_enabled: false,
        totp_secret: null,
        totp_last_step: null,
        email_digest: false,
        suspended_until: null,
        signup_invite_id: null,
        follower_count: 0,
        following_count: 0,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
    await recoveryCodeRepo.deleteAll(id, trx);
    await trx.deleteFrom("auth_tokens").where("user_id", "=", id).execute();
    await sessionRepo.revokeAllForUser(id, trx);
    await userRepo.bumpTokenVersion(id, trx);

    // Memberships: active ones leave (and stop counting); bans stay on record.
    await sql`UPDATE communities SET member_count = GREATEST(member_count - 1, 0)
               WHERE id IN (SELECT community_id FROM community_members WHERE user_id = ${id} AND status = 'ACTIVE')`.execute(trx);
    await trx.updateTable("community_members").set({ status: "LEFT", role: "MEMBER", suspended_until: null, requested_at: null, updated_at: new Date() }).where("user_id", "=", id).where("status", "<>", "BANNED").execute();

    // Follows both ways, with the other side's counters.
    await sql`UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id IN (SELECT followee_id FROM follows WHERE follower_id = ${id})`.execute(trx);
    await sql`UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id IN (SELECT follower_id FROM follows WHERE followee_id = ${id})`.execute(trx);
    await trx.deleteFrom("follows").where((eb) => eb.or([eb("follower_id", "=", id), eb("followee_id", "=", id)])).execute();

    // Message requests they sent that nobody accepted disappear from the recipients' requests.
    await sql`DELETE FROM dm_threads t WHERE t.kind = 'DIRECT' AND t.created_by = ${id}
               AND EXISTS (SELECT 1 FROM dm_participants p WHERE p.thread_id = t.id AND p.user_id <> ${id} AND p.state = 'REQUESTED')`.execute(trx);
    await trx.updateTable("dm_participants").set({ state: "LEFT", muted_until: null }).where("user_id", "=", id).execute();

    await audit({ actorId: id, action: "user.deleted", entityType: "user", entityId: id, ip: meta.ip }, trx);
    fx.disconnect([id], "SIGNED_OUT");
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

const EXPORT_PAGE = 500;

type Section = { name: string; query: (after: string | null) => Promise<{ id: string }[]> };

function sections(userId: string): Section[] {
  return [
    {
      name: "posts",
      query: (after) => {
        let q = db.selectFrom("posts").select(["id", "community_id", "kind", "body", "feeling", "status", "shared_post_id", "created_at", "edited_at"]).where("author_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "comments",
      query: (after) => {
        let q = db.selectFrom("comments").select(["id", "post_id", "parent_id", "body", "status", "created_at", "edited_at"]).where("author_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "chatMessages",
      query: (after) => {
        let q = db.selectFrom("chat_messages").select(["id", "community_id", "body", "status", "created_at", "edited_at"]).where("sender_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "directMessages",
      query: (after) => {
        let q = db.selectFrom("dm_messages").select(["id", "thread_id", "body", "status", "created_at", "edited_at"]).where("sender_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "memberships",
      query: (after) => {
        let q = db
          .selectFrom("community_members as m")
          .innerJoin("communities as c", "c.id", "m.community_id")
          .select(["m.id", "m.community_id", "c.name as community_name", "c.slug as community_slug", "m.role", "m.status", "m.joined_at", "m.notification_settings"])
          .where("m.user_id", "=", userId);
        if (after) q = q.where("m.id", ">", after);
        return q.orderBy("m.id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "following",
      query: (after) => {
        let q = db.selectFrom("follows as f").innerJoin("users as u", "u.id", "f.followee_id").select(["u.id", "u.username", "f.created_at"]).where("f.follower_id", "=", userId);
        if (after) q = q.where("u.id", ">", after);
        return q.orderBy("u.id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "followers",
      query: (after) => {
        let q = db.selectFrom("follows as f").innerJoin("users as u", "u.id", "f.follower_id").select(["u.id", "u.username", "f.created_at"]).where("f.followee_id", "=", userId);
        if (after) q = q.where("u.id", ">", after);
        return q.orderBy("u.id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "blocks",
      query: (after) => {
        let q = db.selectFrom("blocks as b").innerJoin("users as u", "u.id", "b.blocked_id").select(["u.id", "u.username", "b.created_at"]).where("b.blocker_id", "=", userId);
        if (after) q = q.where("u.id", ">", after);
        return q.orderBy("u.id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "reports",
      query: (after) => {
        let q = db.selectFrom("reports").select(["id", "target_type", "target_id", "reason", "details", "created_at"]).where("reporter_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
    {
      name: "notifications",
      query: (after) => {
        let q = db.selectFrom("notifications").select(["id", "type", "entity_type", "entity_id", "community_id", "snippet", "read_at", "created_at"]).where("recipient_id", "=", userId);
        if (after) q = q.where("id", ">", after);
        return q.orderBy("id").limit(EXPORT_PAGE).execute();
      },
    },
  ];
}

/** Stream the caller's data as one JSON document: { exportedAt, profile, posts: [...], ... }. */
export async function exportAccount(actor: Actor, res: Response): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user) return void res.status(404).end();
  const profile = {
    ...(await toMe(user)),
    bio: user.bio,
    location: user.location,
    website: user.website,
    createdAt: user.created_at.toISOString(),
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${user.username}-export.json"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (chunk: string) => new Promise<void>((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve)));
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"profile":${JSON.stringify(profile)}`);
  for (const section of sections(user.id)) {
    await write(`,${JSON.stringify(section.name)}:[`);
    let after: string | null = null;
    let first = true;
    for (;;) {
      const rows = await section.query(after);
      for (const row of rows) {
        await write(`${first ? "" : ","}${JSON.stringify(row)}`);
        first = false;
      }
      if (rows.length < EXPORT_PAGE) break;
      after = rows[rows.length - 1]!.id;
    }
    await write("]");
  }
  await write("}");
  res.end();
  await audit({ actorId: user.id, action: "user.export", entityType: "user", entityId: user.id });
}
