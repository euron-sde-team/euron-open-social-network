import { describe, expect, test } from "vitest";
import { containsTerm, rulesProvider, rulesScores } from "../../src/services/moderation/providers";

describe("rules provider", () => {
  test("blocked terms match whole words, case-insensitively", () => {
    expect(containsTerm("You are a Gronk!", "gronk")).toBe(true);
    expect(containsTerm("gronkish behaviour", "gronk")).toBe(false);
    expect(containsTerm("a c++ fan", "c++")).toBe(true);
    expect(containsTerm("anything", "  ")).toBe(false);
    expect(rulesScores({ text: "total GRONK move", blockedTerms: ["gronk"] })).toEqual({ harassment: 0.9 });
  });

  test("regex characters in terms are literal", () => {
    expect(containsTerm("price is 5", "a.b")).toBe(false);
    expect(containsTerm("see a.b now", "a.b")).toBe(true);
  });

  test("more than five links is spam", () => {
    const five = Array.from({ length: 5 }, (_, i) => `https://l${i}.example/x`).join(" ");
    expect(rulesScores({ text: five })).toEqual({});
    expect(rulesScores({ text: `${five} www.six.example` })).toEqual({ spam: 0.95 });
  });

  test("the third identical message in ten minutes is spam", () => {
    expect(rulesScores({ text: "buy now", recentDuplicates: 2 })).toEqual({});
    expect(rulesScores({ text: "buy now", recentDuplicates: 3 })).toEqual({ spam: 0.95 });
  });

  test("flagged mirrors whether anything scored", async () => {
    expect(await rulesProvider.moderate({ text: "hello there" })).toEqual({ scores: {}, flagged: false });
    expect((await rulesProvider.moderate({ text: "bad", blockedTerms: ["bad"] })).flagged).toBe(true);
  });
});
