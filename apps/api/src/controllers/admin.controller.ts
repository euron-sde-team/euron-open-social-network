/** The admin console endpoints. Settings are validated strictly: a bad threshold must never reach the scanner. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as admin from "../services/admin.service";

const threshold = z
  .object({ review: z.number().min(0).max(1), hide: z.number().min(0).max(1) })
  .refine((t) => t.review <= t.hide, { message: "review must be at most hide" });

const settingsPatch = z
  .object({
    networkName: z.string().trim().min(1).max(80),
    communityCreation: z.enum(["EVERYONE", "STAFF"]),
    maxCommunitiesPerUser: z.number().int().min(0).max(1000),
    networkWideEvents: z.enum(["EVERYONE", "STAFF"]),
    registration: z.enum(["OPEN", "INVITE_ONLY", "CLOSED"]),
    moderation: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(["rules", "openai", "stub"]),
        thresholds: z.record(z.string().min(1).max(60), threshold).refine((t) => Object.keys(t).length <= 50, { message: "at most 50 categories" }),
        premoderateNewAccounts: z
          .object({ enabled: z.boolean(), firstPosts: z.number().int().min(0).max(100), accountAgeDays: z.number().int().min(0).max(365) })
          .partial()
          .strict(),
        blockedTerms: z.array(z.string().trim().min(1).max(100)).max(500),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export async function getSettings(req: Request, res: Response) {
  res.json(await admin.readSettings(actorOf(req)));
}

export async function patchSettings(req: Request, res: Response) {
  const patch = parse(settingsPatch, req.body);
  res.json(await admin.updateSettings(actorOf(req), patch as Parameters<typeof admin.updateSettings>[1], meta(req).ip));
}

export async function stats(req: Request, res: Response) {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  res.json(await admin.stats(actorOf(req), days));
}

const userQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"]).optional(),
  role: z.enum(["USER", "MODERATOR", "ADMIN"]).optional(),
});

export async function users(req: Request, res: Response) {
  const q = parse(userQuery, req.query);
  res.json(await admin.listUsers(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function patchUser(req: Request, res: Response) {
  const { id: userId } = parse(idParam, req.params);
  const { role } = parse(z.object({ role: z.enum(["USER", "MODERATOR", "ADMIN"]) }), req.body);
  res.json(await admin.changeRole(actorOf(req), userId, role, meta(req).ip));
}

const reason = z.string().trim().min(1).max(1000);

export async function suspend(req: Request, res: Response) {
  const { id: userId } = parse(idParam, req.params);
  const body = parse(z.object({ days: z.number().int().min(1).max(3650), reason }), req.body);
  res.json(await admin.accountAction(actorOf(req), userId, "SUSPEND", body, meta(req).ip));
}

export async function unsuspend(req: Request, res: Response) {
  const { id: userId } = parse(idParam, req.params);
  res.json(await admin.accountAction(actorOf(req), userId, "UNSUSPEND", {}, meta(req).ip));
}

export async function ban(req: Request, res: Response) {
  const { id: userId } = parse(idParam, req.params);
  const body = parse(z.object({ reason }), req.body);
  res.json(await admin.accountAction(actorOf(req), userId, "BAN", body, meta(req).ip));
}

export async function unban(req: Request, res: Response) {
  const { id: userId } = parse(idParam, req.params);
  res.json(await admin.accountAction(actorOf(req), userId, "UNBAN", {}, meta(req).ip));
}

export async function communities(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ q: z.string().trim().min(1).max(100).optional(), status: z.enum(["PUBLISHED", "HIDDEN", "REMOVED"]).optional() }), req.query);
  res.json(await admin.listCommunities(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function patchCommunity(req: Request, res: Response) {
  const { id: communityId } = parse(idParam, req.params);
  const body = parse(z.object({ isDefault: z.boolean().optional(), status: z.enum(["PUBLISHED", "REMOVED"]).optional() }).strict(), req.body);
  res.json(await admin.updateCommunity(actorOf(req), communityId, body, meta(req).ip));
}

export async function auditLog(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ action: z.string().trim().max(80).optional(), actorId: id().optional() }), req.query);
  res.json(await admin.listAudit(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}
