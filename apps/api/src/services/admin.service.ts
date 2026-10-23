/**
 * The admin console: platform settings, growth numbers, the account directory, role
 * changes, account actions and community oversight, and the audit trail.
 *
 * Account actions go through moderation/actions.service.ts so the console and the
 * moderation queue leave the same trail and disconnect sockets the same way.
 */
import type { AdminStats, AdminUserRow, AuditEntry, Community, Page, PlatformSettings, UserRole, UserStatus } from "@open-social/types";
import { sql } from "kysely";
import { requireAdmin, requireStaff, type Actor } from "../core/context";
import { decodeCursor, toPage } from "../core/cursor";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { presentCommunities } from "../presenters/community.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { msOf } from "../repositories/moderation.repository";
import { audit } from "./audit.service";
import { applyAccountAction, type AccountAction } from "./moderation/actions.service";
import { getSettings, saveSettings } from "./settings.service";

// ─── Settings ───────────────────────────────────────────────────────────────

export async function readSettings(actor: Actor): Promise<PlatformSettings> {
  requireAdmin(actor);
  return getSettings();
}

export async function updateSettings(actor: Actor, patch: Partial<PlatformSettings>, ip: string | null): Promise<PlatformSettings> {
  requireAdmin(actor);
  return withTransaction(async (trx) => {
    const next = await saveSettings(patch, actor.id, trx);
    await audit({ actorId: actor.id, action: "settings.update", entityType: "settings", entityId: "platform", ip, data: { keys: Object.keys(patch) } }, trx);
    return next;
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function stats(actor: Actor, days: number): Promise<AdminStats> {
  requireStaff(actor);
  const totals = await sql<{ users: number; active: number; communities: number; posts: number; messages: number }>`
    SELECT
      (SELECT count(*) FROM users WHERE status <> 'DEACTIVATED')::int AS users,
      (SELECT count(*) FROM users WHERE last_seen_at > now() - interval '7 days')::int AS active,
      (SELECT count(*) FROM communities WHERE status = 'PUBLISHED')::int AS communities,
      (SELECT count(*) FROM posts WHERE status = 'PUBLISHED')::int AS posts,
      ((SELECT count(*) FROM chat_messages WHERE status = 'PUBLISHED') + (SELECT count(*) FROM dm_messages WHERE status = 'PUBLISHED'))::int AS messages`.execute(db);
  const daily = await sql<{ date: string; signups: number; posts: number; messages: number }>`
    WITH d AS (
      SELECT generate_series(date_trunc('day', now()) - make_interval(days => ${days - 1}), date_trunc('day', now()), interval '1 day') AS day
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
      (SELECT count(*) FROM users u WHERE u.created_at >= d.day AND u.created_at < d.day + interval '1 day')::int AS signups,
      (SELECT count(*) FROM posts p WHERE p.created_at >= d.day AND p.created_at < d.day + interval '1 day')::int AS posts,
      ((SELECT count(*) FROM chat_messages c WHERE c.created_at >= d.day AND c.created_at < d.day + interval '1 day')
        + (SELECT count(*) FROM dm_messages m WHERE m.created_at >= d.day AND m.created_at < d.day + interval '1 day'))::int AS messages
    FROM d ORDER BY d.day`.execute(db);
  const t = totals.rows[0]!;
  return {
    totals: { users: Number(t.users), activeUsers7d: Number(t.active), communities: Number(t.communities), posts: Number(t.posts), messages: Number(t.messages) },
    daily: daily.rows.map((r) => ({ date: r.date, signups: Number(r.signups), posts: Number(r.posts), messages: Number(r.messages) })),
  };
}

// ─── Users ──────────────────────────────────────────────────────────────────

async function userRows(ids: string[], exec: Executor = db): Promise<AdminUserRow[]> {
  if (!ids.length) return [];
  const rows = await exec.selectFrom("users").select(["id", "email", "status", "created_at", "last_seen_at", "suspended_until"]).where("id", "in", ids).execute();
  const summaries = await loadSummaries(ids, exec);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    const s = summaries.get(id);
    if (!r || !s) return [];
    return [{ ...s, email: r.email, status: r.status, createdAt: r.created_at.toISOString(), lastSeenAt: r.last_seen_at?.toISOString() ?? null, suspendedUntil: r.suspended_until?.toISOString() ?? null }];
  });
}

export async function listUsers(actor: Actor, q: { q?: string; status?: UserStatus; role?: UserRole; cursor?: string; limit: number }): Promise<Page<AdminUserRow>> {
  requireStaff(actor);
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("users").select(["id", "created_at"]);
  // Same expression as users_name_trgm_idx, so ILIKE uses the trigram index.
  if (q.q) query = query.where((eb) => eb.or([eb(sql`display_name || ' ' || username::text`, "ilike", `%${q.q!.replace(/[\\%_]/g, "\\$&")}%`), eb("email", "=", q.q!)]));
  if (q.status) query = query.where("status", "=", q.status);
  if (q.role) query = query.where("role", "=", q.role);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await userRows(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
}

export async function changeRole(actor: Actor, userId: string, role: UserRole, ip: string | null): Promise<AdminUserRow> {
  requireAdmin(actor);
  if (userId === actor.id) throw forbidden("You cannot change your own role", "CANNOT_CHANGE_OWN_ROLE");
  await withTransaction(async (trx) => {
    // Lock every admin row so two concurrent demotions cannot both pass the last-admin check.
    const admins = await trx.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").forUpdate().execute();
    const user = await trx.selectFrom("users").select(["id", "role"]).where("id", "=", userId).forUpdate().executeTakeFirst();
    if (!user) throw notFound("User not found", "USER_NOT_FOUND");
    if (user.role === "ADMIN" && role !== "ADMIN" && admins.filter((a) => a.id !== userId).length === 0) throw conflict("The network needs at least one admin", "LAST_ADMIN");
    await trx.updateTable("users").set({ role, updated_at: new Date() }).where("id", "=", userId).execute();
    await audit({ actorId: actor.id, action: "user.role_change", entityType: "user", entityId: userId, ip, data: { from: user.role, to: role } }, trx);
  });
  return (await userRows([userId]))[0]!;
}

export async function accountAction(actor: Actor, userId: string, kind: AccountAction, opts: { days?: number; reason?: string | null }, ip: string | null): Promise<AdminUserRow> {
  requireStaff(actor);
  await withTransaction((trx, fx) => applyAccountAction(actor, userId, kind, { ...opts, ip }, trx, fx));
  const row = (await userRows([userId]))[0];
  if (!row) throw notFound("User not found", "USER_NOT_FOUND");
  return row;
}

// ─── Communities ────────────────────────────────────────────────────────────

/** Community DTOs in the order of `ids`, through the communities module's presenter. */
async function communitiesById(actor: Actor, ids: string[], exec: Executor = db): Promise<Community[]> {
  if (!ids.length) return [];
  const rows = await exec.selectFrom("communities").selectAll().where("id", "in", ids).execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return presentCommunities(actor, ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), exec);
}

export async function listCommunities(actor: Actor, q: { q?: string; status?: "PUBLISHED" | "REMOVED" | "HIDDEN"; cursor?: string; limit: number }): Promise<Page<Community>> {
  requireStaff(actor);
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("communities").select(["id", "created_at"]);
  if (q.q) query = query.where((eb) => eb.or([eb("name", "ilike", `%${q.q!.replace(/[\\%_]/g, "\\$&")}%`), eb("slug", "=", q.q!)]));
  if (q.status) query = query.where("status", "=", q.status);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await communitiesById(actor, page.items.map((r) => r.id)), nextCursor: page.nextCursor };
}

export async function updateCommunity(actor: Actor, id: string, patch: { isDefault?: boolean; status?: "PUBLISHED" | "REMOVED" }, ip: string | null): Promise<Community> {
  requireAdmin(actor);
  if (patch.isDefault === undefined && patch.status === undefined) throw badRequest("Nothing to change", "VALIDATION_FAILED");
  await withTransaction(async (trx) => {
    const row = await trx.selectFrom("communities").select(["id", "is_default", "status"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!row) throw notFound("Community not found", "COMMUNITY_NOT_FOUND");
    if (patch.isDefault && (patch.status ?? row.status) !== "PUBLISHED") throw badRequest("Only a published community can be a default", "COMMUNITY_NOT_PUBLISHED");
    await trx
      .updateTable("communities")
      .set({ ...(patch.isDefault !== undefined ? { is_default: patch.isDefault } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.status === "REMOVED" ? { is_default: false } : {}), updated_at: new Date() })
      .where("id", "=", id)
      .execute();
    await audit({ actorId: actor.id, action: "community.admin_update", entityType: "community", entityId: id, ip, data: { from: { isDefault: row.is_default, status: row.status }, to: patch } }, trx);
  });
  return (await communitiesById(actor, [id]))[0]!;
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export async function listAudit(actor: Actor, q: { action?: string; actorId?: string; cursor?: string; limit: number }): Promise<Page<AuditEntry>> {
  requireAdmin(actor);
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("audit_log").select(["id", "actor_id", "action", "entity_type", "entity_id", "data", "created_at"]);
  if (q.action) query = query.where("action", "=", q.action);
  if (q.actorId) query = query.where("actor_id", "=", q.actorId);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  const people = await loadSummaries(page.items.map((r) => r.actor_id));
  return {
    items: page.items.map((r) => ({
      id: r.id,
      actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      data: (r.data as Record<string, unknown>) ?? {},
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
