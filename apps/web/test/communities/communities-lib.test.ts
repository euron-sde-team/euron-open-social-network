import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, assignableRoles, joinState, nextVote, normaliseTab, parseTags, slugify } from "@/lib/communities";

const viewer = (status: null | "ACTIVE" | "PENDING" | "BANNED" | "SUSPENDED", role: null | "OWNER" | "MEMBER" = null) => ({ status, role, isMember: status === "ACTIVE" });

describe("slugify", () => {
  it("derives a url-safe slug", () => {
    expect(slugify("Rust & WebAssembly Builders")).toBe("rust-and-webassembly-builders");
    expect(slugify("  Cafe Owners  ")).toBe("cafe-owners");
    expect(slugify("Café crème!!")).toBe("cafe-creme");
    expect(slugify("---")).toBe("");
  });
  it("caps the length without a trailing hyphen and matches the slug pattern", () => {
    const s = slugify("a".repeat(30) + " " + "b".repeat(30));
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
    expect(SLUG_PATTERN.test(s)).toBe(true);
    expect(SLUG_PATTERN.test("Bad Slug")).toBe(false);
  });
});

describe("joinState", () => {
  it("maps membership and policy to the button state", () => {
    expect(joinState(viewer(null), "OPEN")).toBe("join");
    expect(joinState(viewer(null), "APPROVAL")).toBe("request");
    expect(joinState(viewer(null), "INVITE_ONLY")).toBe("invite-only");
    expect(joinState(viewer("PENDING"), "APPROVAL")).toBe("requested");
    expect(joinState(viewer("ACTIVE", "MEMBER"), "OPEN")).toBe("joined");
    expect(joinState(viewer("ACTIVE", "OWNER"), "OPEN")).toBe("owner");
    expect(joinState(viewer("BANNED"), "OPEN")).toBe("banned");
    expect(joinState(viewer("SUSPENDED"), "OPEN")).toBe("suspended");
  });
});

describe("nextVote", () => {
  it("votes, switches and clears with the right score", () => {
    expect(nextVote(0, 1, 5)).toEqual({ vote: 1, score: 6 });
    expect(nextVote(1, 1, 6)).toEqual({ vote: 0, score: 5 });
    expect(nextVote(1, -1, 6)).toEqual({ vote: -1, score: 4 });
  });
});

describe("helpers", () => {
  it("parses tags", () => {
    expect(parseTags("#Setup, billing  setup, a b c d e f")).toEqual(["setup", "billing", "a", "b", "c"]);
  });
  it("limits assignable roles by the actor's role", () => {
    expect(assignableRoles("OWNER")).toContain("ADMIN");
    expect(assignableRoles("ADMIN")).not.toContain("ADMIN");
    expect(assignableRoles("MODERATOR")).toEqual([]);
  });
  it("normalises unknown tabs to discussion", () => {
    expect(normaliseTab("members")).toBe("members");
    expect(normaliseTab("nope")).toBe("discussion");
    expect(normaliseTab(null)).toBe("discussion");
  });
});
