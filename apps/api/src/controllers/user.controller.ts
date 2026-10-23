/** /api/users: profiles, follows, blocks, profile edits, sessions. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { notFound } from "../core/errors";
import { id, idParam, optionalText, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as account from "../services/account.service";
import * as feed from "../services/feed.service";
import * as users from "../services/user.service";

const usernameParam = z.object({ username: z.string() });

function username(req: Request): string {
  const { username } = parse(usernameParam, req.params);
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) throw notFound("User not found");
  return username;
}

const page = (req: Request) => {
  const q = parse(pageQuery, req.query);
  return { cursor: q.cursor, limit: q.limit ?? 20 };
};

const profilePatch = z.object({
  displayName: text(80, 1).optional(),
  headline: optionalText(120),
  bio: optionalText(1000),
  location: optionalText(100),
  website: z
    .string()
    .trim()
    .max(200)
    .url()
    .refine((v) => /^https?:\/\//i.test(v), "must be an http(s) URL")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  avatarUploadId: id().nullable().optional(),
  coverUploadId: id().nullable().optional(),
  dmPrivacy: z.enum(["COMMUNITIES", "FOLLOWING", "NOBODY"]).optional(),
  emailDigest: z.boolean().optional(),
})
  // partial(): an absent field stays undefined (unchanged) instead of being cleared to null.
  .partial();

export async function updateMe(req: Request, res: Response) {
  res.json(await users.updateMe(actorOf(req), parse(profilePatch, req.body)));
}

/** Delete (deactivate and anonymise) your account: { password, totp? | recoveryCode? }. 204. */
export async function deleteMe(req: Request, res: Response) {
  const body = parse(z.object({ password: z.string().min(1).max(128), totp: z.string().trim().max(10).optional(), recoveryCode: z.string().trim().min(8).max(32).optional() }), req.body);
  await account.deleteAccount(actorOf(req), body, meta(req));
  res.status(204).end();
}

/** Your data as a JSON download, streamed. */
export async function exportMe(req: Request, res: Response) {
  await account.exportAccount(actorOf(req), res);
}

export async function myBookmarks(req: Request, res: Response) {
  res.json(await feed.bookmarks(actorOf(req), page(req)));
}

export async function myBlocks(req: Request, res: Response) {
  res.json(await users.blocks(actorOf(req)));
}

export async function mySessions(req: Request, res: Response) {
  res.json(await users.sessions(actorOf(req), meta(req)));
}

export async function revokeSession(req: Request, res: Response) {
  await users.revokeSession(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

export async function suggestions(req: Request, res: Response) {
  res.json(await users.suggestions(actorOf(req)));
}

export async function profile(req: Request, res: Response) {
  res.json(await users.profile(req.actor, username(req)));
}

export async function posts(req: Request, res: Response) {
  res.json(await users.posts(req.actor, username(req), page(req)));
}

export async function media(req: Request, res: Response) {
  res.json(await users.media(req.actor, username(req), page(req)));
}

export async function communities(req: Request, res: Response) {
  res.json(await users.communities(req.actor, username(req)));
}

export async function followers(req: Request, res: Response) {
  res.json(await users.follows(req.actor, username(req), "followers", page(req)));
}

export async function following(req: Request, res: Response) {
  res.json(await users.follows(req.actor, username(req), "following", page(req)));
}

export async function follow(req: Request, res: Response) {
  await users.follow(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function unfollow(req: Request, res: Response) {
  await users.unfollow(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function block(req: Request, res: Response) {
  await users.block(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

export async function unblock(req: Request, res: Response) {
  await users.unblock(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}
