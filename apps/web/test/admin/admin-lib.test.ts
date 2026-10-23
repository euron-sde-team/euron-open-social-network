import { describe, expect, it } from "vitest";
import { daysSince, sparklinePath, summarizeUserAgent, thresholdErrors } from "@/lib/admin";
import { settingsSchema } from "@/components/admin/settings-form";

describe("thresholdErrors", () => {
  it("accepts review at or below hide", () => {
    expect(thresholdErrors({ hate: { review: 0.5, hide: 0.8 }, spam: { review: 0.7, hide: 0.7 } })).toEqual({});
  });
  it("flags review above hide and out-of-range values", () => {
    const e = thresholdErrors({ hate: { review: 0.9, hide: 0.5 }, spam: { review: -0.1, hide: 0.5 }, sexual: { review: 0.2, hide: 1.2 } });
    expect(Object.keys(e).sort()).toEqual(["hate", "sexual", "spam"]);
    expect(e.hate).toMatch(/at or below/);
  });
});

describe("settingsSchema", () => {
  const base = {
    networkName: "Net",
    communityCreation: "EVERYONE",
    maxCommunitiesPerUser: "5",
    networkWideEvents: "STAFF",
    registration: "OPEN",
    moderation: { enabled: true, provider: "rules", thresholds: { hate: { review: 0.4, hide: 0.8 } }, premoderateNewAccounts: { enabled: false, firstPosts: 3, accountAgeDays: 7 }, blockedTerms: [] },
  };
  it("parses valid settings and coerces numbers", () => {
    const r = settingsSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxCommunitiesPerUser).toBe(5);
  });
  it("reports a threshold error on the category path", () => {
    const r = settingsSchema.safeParse({ ...base, moderation: { ...base.moderation, thresholds: { hate: { review: 0.9, hide: 0.2 } } } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["moderation", "thresholds", "hate"]);
  });
});

describe("sparklinePath", () => {
  it("maps values into the box, max at the top and zero at the bottom", () => {
    const { line, area, max } = sparklinePath([0, 5, 10], 100, 50, 0);
    expect(max).toBe(10);
    expect(line).toBe("M0 50 L50 25 L100 0");
    expect(area).toBe("M0 50 L50 25 L100 0 L100 50 L0 50 Z");
  });
  it("handles empty, single and all-zero series", () => {
    expect(sparklinePath([], 100, 50).line).toBe("");
    expect(sparklinePath([3], 100, 50, 0).line).toBe("M0 0");
    expect(sparklinePath([0, 0], 100, 50, 2).line).toBe("M2 48 L98 48");
  });
});

describe("summarizeUserAgent", () => {
  it("names browser and OS", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15")).toBe("Safari on macOS");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge on Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iOS");
    expect(summarizeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe("Firefox on Linux");
  });
  it("falls back for missing or unusual agents", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
    expect(summarizeUserAgent("curl/8.4.0")).toBe("App or script");
  });
});

describe("daysSince", () => {
  it("counts whole days and never goes negative", () => {
    const now = Date.parse("2026-03-10T12:00:00Z");
    expect(daysSince("2026-03-01T12:00:00Z", now)).toBe(9);
    expect(daysSince("2026-04-01T00:00:00Z", now)).toBe(0);
  });
});
