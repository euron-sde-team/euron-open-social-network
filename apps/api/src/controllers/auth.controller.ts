/**
 * Auth endpoints. The refresh token travels only in an httpOnly cookie scoped to
 * /api/auth; the access token is returned in the body and kept in memory by the web app.
 */
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { cookieSecure } from "../core/config";
import { parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as auth from "../services/auth.service";
import type { IssuedSession } from "../services/auth.service";

export const REFRESH_COOKIE = "os_refresh";

function cookieOptions(expires?: Date): CookieOptions {
  return { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/api/auth", ...(expires ? { expires } : {}) };
}

function sendSession(res: Response, session: IssuedSession, status = 200): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt));
  const { refreshToken: _r, refreshExpiresAt: _e, ...body } = session;
  res.status(status).json(body);
}

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(128);

const signupBody = z.object({
  email,
  username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,30}$/, "3 to 30 letters, digits or underscores"),
  displayName: z.string().trim().min(1).max(80),
  password,
  /** A community invite code: required when registration is INVITE_ONLY. */
  inviteCode: z.string().trim().min(1).max(100).optional(),
});

const totpCode = z.string().trim().max(10);
const recoveryCode = z.string().trim().min(8).max(32);

export async function signup(req: Request, res: Response) {
  const result = await auth.signup(parse(signupBody, req.body), meta(req));
  if ("verificationRequired" in result) {
    res.status(202).json(result);
    return;
  }
  sendSession(res, result, 201);
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  sendSession(res, await auth.verifyEmail(token, meta(req)));
}

export async function resendVerification(req: Request, res: Response) {
  const body = parse(z.object({ email }), req.body);
  await auth.resendVerification(body.email);
  res.status(202).json({ ok: true });
}

export async function login(req: Request, res: Response) {
  const body = parse(z.object({ login: z.string().trim().min(3).max(254), password, totp: totpCode.optional(), recoveryCode: recoveryCode.optional() }), req.body);
  const result = await auth.login({ ...body, login: body.login.toLowerCase() }, meta(req));
  if ("totpRequired" in result) {
    res.status(200).json(result);
    return;
  }
  sendSession(res, result);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Session expired", code: "SESSION_EXPIRED", requestId: req.requestId });
    return;
  }
  try {
    sendSession(res, await auth.refresh(token, meta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function logoutEverywhere(req: Request, res: Response) {
  await auth.logoutEverywhere(actorOf(req), meta(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function forgotPassword(req: Request, res: Response) {
  await auth.forgotPassword(parse(z.object({ email }), req.body).email);
  res.status(202).json({ ok: true });
}

export async function resetPassword(req: Request, res: Response) {
  const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  await auth.resetPassword(body.token, body.password, meta(req));
  res.status(204).end();
}

export async function changePassword(req: Request, res: Response) {
  const body = parse(z.object({ currentPassword: password, newPassword: password }), req.body);
  await auth.changePassword(actorOf(req), body.currentPassword, body.newPassword, meta(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json(await auth.me(actorOf(req)));
}

export async function startTotp(req: Request, res: Response) {
  res.json(await auth.startTotp(actorOf(req)));
}

/** 200 { recoveryCodes }: the only time the codes are shown. */
export async function enableTotp(req: Request, res: Response) {
  res.json(await auth.enableTotp(actorOf(req), parse(z.object({ code: totpCode }), req.body).code, meta(req)));
}

/** { password, code } (a current TOTP code), or { password, recoveryCode } when the device is lost. */
export async function disableTotp(req: Request, res: Response) {
  const body = parse(
    z.object({ password, code: totpCode.optional(), recoveryCode: recoveryCode.optional() }).refine((b) => b.code || b.recoveryCode, { message: "code is required", path: ["code"] }),
    req.body,
  );
  await auth.disableTotp(actorOf(req), body, meta(req));
  res.status(204).end();
}

export async function regenerateRecoveryCodes(req: Request, res: Response) {
  res.json(await auth.regenerateRecoveryCodes(actorOf(req), parse(z.object({ password, code: totpCode }), req.body), meta(req)));
}
