/** /api/communities: directory, settings, membership, moderation of members, invites, community feeds. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, optionalText, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as communities from "../services/community.service";
import * as feed from "../services/feed.service";
import * as membership from "../services/membership.service";

const page = (req: Request) => {
  const q = parse(pageQuery, req.query);
  return { cursor: q.cursor, limit: q.limit ?? 20 };
};

const rule = z.object({ title: text(100, 1), body: text(1000) });
const base = {
  name: text(100, 3),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/, "3 to 80 lower-case letters, digits or dashes").optional(),
  description: optionalText(2000),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  joinPolicy: z.enum(["OPEN", "APPROVAL", "INVITE_ONLY"]),
  allowMemberPosts: z.boolean().optional(),
  rules: z.array(rule).max(20).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "a hex colour like #3366ff").nullable().optional(),
  iconUploadId: id().nullable().optional(),
  coverUploadId: id().nullable().optional(),
};
const createBody = z.object(base);
const patchBody = z.object({ ...base, premoderatePosts: z.boolean().optional() }).partial();
const memberParams = z.object({ id: id(), userId: id() });

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ q: z.string().trim().max(100).optional(), filter: z.enum(["all", "joined", "managed"]).default("all") }), req.query);
  res.json(await communities.list(req.actor, { filter: q.filter, q: q.q || undefined, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function suggested(req: Request, res: Response) {
  res.json(await communities.suggested(actorOf(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await communities.create(actorOf(req), parse(createBody, req.body)));
}

export async function invite(req: Request, res: Response) {
  const { code } = parse(z.object({ code: z.string().regex(/^[\w-]{6,40}$/) }), req.params);
  res.json(await membership.getInvite(actorOf(req), code));
}

export async function get(req: Request, res: Response) {
  const { slug } = parse(z.object({ slug: z.string().max(80) }), req.params);
  res.json(await communities.getBySlug(req.actor, slug.toLowerCase()));
}

export async function update(req: Request, res: Response) {
  res.json(await communities.update(actorOf(req), parse(idParam, req.params).id, parse(patchBody, req.body)));
}

export async function remove(req: Request, res: Response) {
  await communities.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function join(req: Request, res: Response) {
  const body = parse(z.object({ inviteCode: z.string().regex(/^[\w-]{6,40}$/).optional() }), req.body);
  res.json(await membership.join(actorOf(req), parse(idParam, req.params).id, body.inviteCode));
}

export async function cancelJoin(req: Request, res: Response) {
  await membership.cancelRequest(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function leave(req: Request, res: Response) {
  await membership.leave(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function transfer(req: Request, res: Response) {
  const { userId } = parse(z.object({ userId: id() }), req.body);
  await membership.transferOwnership(actorOf(req), parse(idParam, req.params).id, userId);
  res.status(204).end();
}

export async function members(req: Request, res: Response) {
  const q = parse(
    pageQuery.extend({
      status: z.enum(["ACTIVE", "PENDING", "SUSPENDED", "BANNED"]).optional(),
      role: z.enum(["OWNER", "ADMIN", "MODERATOR", "MEMBER"]).optional(),
      q: z.string().trim().max(100).optional(),
    }),
    req.query,
  );
  res.json(await membership.listMembers(req.actor, parse(idParam, req.params).id, { status: q.status, role: q.role, q: q.q || undefined, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function approve(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  res.json(await membership.approve(actorOf(req), p.id, p.userId));
}

export async function reject(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  await membership.reject(actorOf(req), p.id, p.userId);
  res.status(204).end();
}

export async function setRole(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  const { role } = parse(z.object({ role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]) }), req.body);
  res.json(await membership.setRole(actorOf(req), p.id, p.userId, role));
}

export async function suspend(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  const body = parse(z.object({ days: z.number().int().min(1).max(365), reason: optionalText(500) }), req.body);
  res.json(await membership.suspend(actorOf(req), p.id, p.userId, body.days, body.reason));
}

export async function unsuspend(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  res.json(await membership.unsuspend(actorOf(req), p.id, p.userId));
}

export async function ban(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  const body = parse(z.object({ reason: optionalText(500) }), req.body);
  res.json(await membership.ban(actorOf(req), p.id, p.userId, body.reason));
}

export async function unban(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  res.json(await membership.unban(actorOf(req), p.id, p.userId));
}

export async function removeMember(req: Request, res: Response) {
  const p = parse(memberParams, req.params);
  await membership.removeMember(actorOf(req), p.id, p.userId);
  res.status(204).end();
}

export async function invites(req: Request, res: Response) {
  res.json(await membership.listInvites(actorOf(req), parse(idParam, req.params).id));
}

export async function createInvite(req: Request, res: Response) {
  const body = parse(z.object({ maxUses: z.number().int().min(1).max(10000).nullable().optional(), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }), req.body);
  res.status(201).json(await membership.createInvite(actorOf(req), parse(idParam, req.params).id, body));
}

export async function revokeInvite(req: Request, res: Response) {
  const p = parse(z.object({ id: id(), inviteId: id() }), req.params);
  await membership.revokeInvite(actorOf(req), p.id, p.inviteId);
  res.status(204).end();
}

export async function posts(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ sort: z.enum(["new", "top", "hot"]).default("new"), tag: z.string().max(41).optional() }), req.query);
  res.json(await feed.communityPosts(req.actor, parse(idParam, req.params).id, { sort: q.sort, tag: q.tag, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function pinned(req: Request, res: Response) {
  res.json(await feed.pinned(req.actor, parse(idParam, req.params).id));
}

export async function media(req: Request, res: Response) {
  res.json(await feed.media(req.actor, { communityId: parse(idParam, req.params).id }, page(req)));
}

const settingsBody = z.object({ posts: z.enum(["ALL", "HIGHLIGHTS", "OFF"]).optional(), events: z.boolean().optional(), chat: z.boolean().optional() });

export async function notificationSettings(req: Request, res: Response) {
  res.json(await membership.getNotificationSettings(actorOf(req), parse(idParam, req.params).id));
}

export async function updateNotificationSettings(req: Request, res: Response) {
  res.json(await membership.updateNotificationSettings(actorOf(req), parse(idParam, req.params).id, parse(settingsBody, req.body)));
}
