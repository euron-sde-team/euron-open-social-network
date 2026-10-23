import { describe, expect, test } from "vitest";
import { bumpPriority, MAX_PRIORITY, shouldAutoHideFromReports } from "../../src/domain/report-threshold";

const base = { targetType: "POST" as const, reporterAgesDays: [5, 10, 30], authorIsStaff: false, targetStatus: "PUBLISHED" };

describe("auto-hide from reports", () => {
  test("three established reporters hide published content", () => {
    expect(shouldAutoHideFromReports(base)).toBe(true);
  });

  test("two are not enough, and day-old accounts do not count", () => {
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 0.5, 0.2] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 0.5, 2] })).toBe(true);
  });

  test("never for staff, accounts, communities or content that is not published", () => {
    expect(shouldAutoHideFromReports({ ...base, authorIsStaff: true })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, targetType: "USER" })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, targetType: "COMMUNITY" })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, targetStatus: "HIDDEN" })).toBe(false);
  });

  test("priority rises per report up to a cap", () => {
    expect(bumpPriority(0)).toBe(10);
    expect(bumpPriority(MAX_PRIORITY - 3)).toBe(MAX_PRIORITY);
  });
});
