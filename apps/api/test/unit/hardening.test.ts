import { Redis } from "ioredis";
import { afterAll, describe, expect, test } from "vitest";
import { assertProductionConfig, DEV_DEFAULTS, loadConfig } from "../../src/core/config";
import { LOCAL_DATABASE_URL, resolveConnectionConfig } from "../../src/db/connection-config";
import { readCommunityNotificationSettings, silencedBy } from "../../src/domain/notification-prefs";
import { digestLine, GENERIC_DM_REQUEST, GENERIC_PRIVATE_COMMUNITY } from "../../src/jobs/messaging.jobs";
import { redisLimiter } from "../../src/middleware/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, hashRecoveryCode, newRecoveryCodes } from "../../src/security/totp";

const prodBase = {
  NODE_ENV: "test",
  JWT_SECRET: "a".repeat(40),
  REFRESH_SECRET: "b".repeat(40),
  CORS_ORIGINS: "https://social.example.org",
  APP_WEB_URL: "https://social.example.org",
  STORAGE: "s3",
  S3_BUCKET: "bucket",
  MAIL_MODE: "ses",
  MAIL_FROM: "Social <no-reply@example.org>",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};

describe("production guard", () => {
  test("a complete production config has no problems", () => {
    expect(assertProductionConfig(loadConfig(prodBase))).toEqual([]);
  });

  test("TOTP_ENCRYPTION_KEY is required: the derived development default is refused; a wrong length does not parse", () => {
    const { TOTP_ENCRYPTION_KEY: _k, ...rest } = prodBase;
    const c = loadConfig(rest);
    expect(c.TOTP_ENCRYPTION_KEY).toBe(DEV_DEFAULTS.TOTP_ENCRYPTION_KEY);
    expect(assertProductionConfig(c).join("\n")).toMatch(/TOTP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prodBase, TOTP_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  test("MODERATION_PROVIDER=openai with the placeholder key set-me is refused", () => {
    expect(assertProductionConfig(loadConfig({ ...prodBase, MODERATION_PROVIDER: "openai", OPENAI_API_KEY: "set-me" })).join("\n")).toMatch(/OPENAI_API_KEY/);
    expect(assertProductionConfig(loadConfig({ ...prodBase, MODERATION_PROVIDER: "openai", OPENAI_API_KEY: "sk-real" }))).toEqual([]);
  });

  test("the env vars the API reads outside config.ts are declared in it", () => {
    const c = loadConfig({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
    expect(c).toMatchObject({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
  });
});

describe("database connection default", () => {
  test("with nothing set it falls back to the local compose Postgres, nothing else", () => {
    expect(resolveConnectionConfig({})).toEqual({ connectionString: LOCAL_DATABASE_URL });
    expect(LOCAL_DATABASE_URL).toBe("postgres://social:social@localhost:5452/social");
  });
});

describe("TOTP at rest", () => {
  test("ciphertext round-trips only for the same user, and tampering is rejected", () => {
    const enc = encryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a");
    expect(enc).toMatch(/^v1:/);
    expect(decryptTotpSecret(enc, "user-a")).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(enc, "user-b")).toBeNull();
    expect(decryptTotpSecret(`${enc.slice(0, -2)}AA`, "user-a")).toBeNull();
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a")).toBeNull();
  });

  test("recovery codes: ten distinct codes, hashes ignore case and dashes and differ per user", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const c = codes[0]!;
    expect(hashRecoveryCode(c.toUpperCase().replace("-", " "), "u1")).toBe(hashRecoveryCode(c, "u1"));
    expect(hashRecoveryCode(c, "u2")).not.toBe(hashRecoveryCode(c, "u1"));
  });
});

describe("rate limiter during a Redis outage", () => {
  const dead = new Redis("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null });
  afterAll(() => dead.disconnect());

  test("falls back to the in-memory insurance limiter: still limits, never throws a store error", async () => {
    const l = redisLimiter(dead, `outage-${Date.now()}`, 2, 60);
    await expect(l.consume("k")).resolves.toBeDefined();
    await expect(l.consume("k")).resolves.toBeDefined();
    const third = await l.consume("k").catch((e) => e);
    expect(third).not.toBeInstanceOf(Error);
    expect(third.remainingPoints).toBe(0);
  });
});

describe("per-community notification settings", () => {
  test("what each setting silences", () => {
    const s = (over: object) => readCommunityNotificationSettings(over);
    expect(silencedBy("EVENT_REMINDER", s({ events: false }))).toBe(true);
    expect(silencedBy("EVENT_REMINDER", s({}))).toBe(false);
    expect(silencedBy("POST_REACTION", s({ posts: "HIGHLIGHTS" }))).toBe(true);
    expect(silencedBy("COMMENT_REPLY", s({ posts: "HIGHLIGHTS" }))).toBe(false);
    for (const t of ["POST_COMMENT", "COMMENT_REPLY", "MENTION", "ANSWER_POSTED"] as const) expect(silencedBy(t, s({ posts: "OFF" }))).toBe(true);
    for (const t of ["MODERATION_ACTION", "APPEAL_DECIDED", "JOIN_REQUEST", "DM_REQUEST", "FOLLOW"] as const) expect(silencedBy(t, s({ posts: "OFF", events: false, chat: false }))).toBe(false);
    expect(s({ posts: "LOUD", events: "no" })).toEqual({ posts: "ALL", events: true, chat: true });
  });
});

describe("digest lines", () => {
  test("DM requests and private communities never carry a snippet or a name", () => {
    expect(digestLine({ type: "DM_REQUEST", snippet: "secret", actor_name: "Eve", private_community: false })).toBe(GENERIC_DM_REQUEST);
    expect(digestLine({ type: "MENTION", snippet: "secret", actor_name: "Eve", private_community: true })).toBe(GENERIC_PRIVATE_COMMUNITY);
    expect(digestLine({ type: "MENTION", snippet: "hello", actor_name: "Eve", private_community: false })).toBe("Eve mentioned you: hello");
  });
});
