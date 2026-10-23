/**
 * Shared helpers for the end-to-end suite. Setup goes through the real REST API (never
 * the database) so each test spends browser time only on the behaviour under test.
 *
 * Every simulated person gets their own client address (X-Forwarded-For, honoured by the
 * local stack's single trusted proxy hop), on API calls and on their browser's auth calls, so
 * the per-IP sign-in budgets apply per person the way they would for real visitors
 * instead of every test sharing one loopback budget.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const WEB = (process.env.E2E_BASE_URL || "http://localhost:3510").replace(/\/+$/, "");
export const API = (process.env.E2E_API_URL || "http://localhost:5006/api").replace(/\/+$/, "");
export const MAILPIT = (process.env.E2E_MAILPIT_URL || "http://localhost:8026").replace(/\/+$/, "");

/** The demo password `make env` generated (E2E_DEMO_PASSWORD overrides). Never hardcoded. */
export function demoPassword(): string {
  if (process.env.E2E_DEMO_PASSWORD) return process.env.E2E_DEMO_PASSWORD;
  const file = path.join(__dirname, "..", "deploy", "compose", ".env");
  const line = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("SOCIAL_DEMO_PASSWORD=")) : undefined;
  if (!line) throw new Error("No demo password: run `make env && make demo`, or set E2E_DEMO_PASSWORD");
  return line.slice("SOCIAL_DEMO_PASSWORD=".length).trim();
}

export const DEMO = {
  admin: "admin@example.com",
  moderator: "quinn.lantern@example.com",
  member: "juniper.vale@example.com",
};

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  password: string;
  accessToken: string;
  /** The simulated client address this person uses. */
  ip: string;
}

const run = randomBytes(3).toString("hex");
let seq = 0;

/** A unique suffix for names, slugs and addresses. */
export function uniq(prefix = "e2e"): string {
  seq += 1;
  return `${prefix}${run}${seq}${randomBytes(2).toString("hex")}`;
}

// Addresses in 10.0.0.0/8: a random starting point per run, then sequential, so no two
// simulated people in a run (or, in practice, in back-to-back runs) share a budget.
let nextIp = randomBytes(3).readUIntBE(0, 3) & 0x7fffff;

/** A fresh client address for one simulated person. */
export function clientIp(): string {
  nextIp = (nextIp + 1) & 0xffffff;
  return `10.${(nextIp >> 16) & 255}.${(nextIp >> 8) & 255}.${nextIp & 255}`;
}

type Json = Record<string, unknown>;

/** Calls the API as `who` (a token, or nobody), failing the test on an unexpected status. */
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function call<T = Json>(
  request: APIRequestContext,
  method: Method,
  route: string,
  opts: { token?: string; ip?: string; data?: unknown; expect?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { "X-Forwarded-For": opts.ip ?? clientIp() };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await request.fetch(`${API}${route}`, { method, headers, data: opts.data as never });
  const text = await r.text();
  if (opts.expect !== undefined) expect(r.status(), `${method} ${route}: ${text}`).toBe(opts.expect);
  else expect(r.ok(), `${method} ${route} -> ${r.status()}: ${text}`).toBe(true);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Calls the API as a test user. */
export function as<T = Json>(request: APIRequestContext, user: Pick<TestUser, "accessToken" | "ip">, method: Method, route: string, data?: unknown, status?: number) {
  return call<T>(request, method, route, { token: user.accessToken, ip: user.ip, data, expect: status });
}

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

/** The newest mail to `to` matching `subject`, polling Mailpit until it arrives. */
export async function waitForMail(request: APIRequestContext, to: string, subject: RegExp = /./, timeoutMs = 30_000): Promise<{ html: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  const addr = to.toLowerCase();
  while (Date.now() < deadline) {
    const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}&limit=20`);
    if (r.ok()) {
      const list = ((await r.json()).messages ?? []) as MailSummary[];
      const hit = list.find((m) => m.To.some((t) => t.Address.toLowerCase() === addr) && subject.test(m.Subject));
      if (hit) {
        const full = await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
        return { html: full.HTML || "", text: full.Text || "" };
      }
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`No mail to ${to} matching ${subject} within ${timeoutMs} ms`);
}

/** The first link in a mail matching `pattern`, with HTML entities undone. */
export function linkIn(mail: { html: string; text: string }, pattern: RegExp): string {
  const m = `${mail.text}\n${mail.html}`.replace(/&amp;/g, "&").match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in the mail`);
  return m[0];
}

/** The verification link the API mailed to `email`. */
export async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
  return linkIn(await waitForMail(request, email, /confirm|verify/i), /https?:\/\/[^\s"'<>]+\/verify-email\?token=[^\s"'<>]+/);
}

/** A fresh, verified account: signs up through the API and confirms the mailed link. */
export async function newUser(request: APIRequestContext, opts: { displayName?: string } = {}): Promise<TestUser> {
  const username = uniq("u");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;
  const displayName = opts.displayName ?? `Tester ${username.slice(-6)}`;
  const ip = clientIp();
  const signup = await call<{ verificationRequired?: boolean }>(request, "POST", "/auth/signup", { ip, data: { email, username, displayName, password }, expect: 202 });
  expect(signup.verificationRequired).toBe(true);
  const token = decodeURIComponent(new URL(await verificationLink(request, email)).searchParams.get("token") ?? "");
  const auth = await call<{ accessToken: string; user: { id: string } }>(request, "POST", "/auth/verify-email", { ip, data: { token } });
  return { id: auth.user.id, email, username, displayName, password, accessToken: auth.accessToken, ip };
}

/** Signs an existing account in through the API (demo users, or a fresh token). */
export async function apiLogin(request: APIRequestContext, login: string, password = demoPassword()): Promise<TestUser> {
  const ip = clientIp();
  const r = await call<{ accessToken: string; user: { id: string; email: string; username: string; displayName: string } }>(request, "POST", "/auth/login", { ip, data: { login, password } });
  return { id: r.user.id, email: r.user.email, username: r.user.username, displayName: r.user.displayName, password, accessToken: r.accessToken, ip };
}

/**
 * A browser context that presents itself from `ip` to the auth endpoints (the only ones
 * with per-IP budgets). Routed per request rather than set as an extra header on every
 * request: an extra header would also go to the presigned S3 uploads, whose CORS
 * preflight rightly refuses it.
 */
export async function newContext(browser: Browser, ip: string = clientIp()): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.route(`${WEB}/api/auth/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  return ctx;
}

/** Signs in through the UI login form and waits for the signed-in shell. */
export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">, opts: { next?: string } = {}) {
  await page.goto(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  await page.locator("#login").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("avatar-menu")).toBeVisible();
}

/** A new browser context (a device with its own address) for `user`, signed in through the UI. */
export async function pageFor(browser: Browser, user: TestUser, next?: string): Promise<Page> {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await signIn(page, user, { next });
  return page;
}

export async function signOut(page: Page) {
  await page.getByTestId("avatar-menu").click();
  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("avatar-menu")).toBeHidden();
}

// ─── Setup through the API ───────────────────────────────────────────────────

export interface TestCommunity {
  id: string;
  slug: string;
  name: string;
}

export async function createCommunity(
  request: APIRequestContext,
  owner: TestUser,
  opts: { visibility?: "PUBLIC" | "PRIVATE"; joinPolicy?: "OPEN" | "APPROVAL" | "INVITE_ONLY"; name?: string } = {},
): Promise<TestCommunity> {
  const name = opts.name ?? `E2E ${uniq("c")}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const c = await as<TestCommunity>(request, owner, "POST", "/communities", { name, slug, description: "Created by the end-to-end suite.", visibility: opts.visibility ?? "PUBLIC", joinPolicy: opts.joinPolicy ?? "OPEN" }, 201);
  return { id: c.id, slug: c.slug, name: c.name };
}

export async function join(request: APIRequestContext, user: TestUser, community: TestCommunity): Promise<string> {
  return (await as<{ status: string }>(request, user, "POST", `/communities/${community.id}/join`, {})).status;
}

export interface TestPost {
  id: string;
  body: string;
  status: string;
  poll?: { id: string; options: { id: string; label: string }[] } | null;
}

export async function createPost(request: APIRequestContext, author: TestUser, community: TestCommunity, body: string, extra: Json = {}): Promise<TestPost> {
  return as<TestPost>(request, author, "POST", "/posts", { communityId: community.id, body, ...extra }, 201);
}

/** The post card in the page with this id. */
export function postCard(page: Page, postId: string) {
  return page.locator(`[data-testid="post-card"][data-post-id="${postId}"]`);
}

/** Current TOTP code for a base32 secret. */
export async function totpCode(secret: string, offsetSteps = 0): Promise<string> {
  const { TOTP, Secret } = await import("otpauth");
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

/** A small, valid PNG (a solid colour square), built in memory: no binary fixture to commit. */
export function pngBytes(size = 16, rgb: [number, number, number] = [37, 99, 235]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Leaves every community the user is in (new accounts join the network's default ones). */
export async function leaveAll(request: APIRequestContext, user: TestUser) {
  const joined = await as<{ items: { id: string; viewer: { role: string | null } }[] }>(request, user, "GET", "/communities?filter=joined&limit=50");
  for (const c of joined.items) if (c.viewer.role !== "OWNER") await as(request, user, "POST", `/communities/${c.id}/leave`, {}, 204);
}
