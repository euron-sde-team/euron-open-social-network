import { describe, expect, test } from "vitest";
import { MAX_MENTIONS, newMentions, parseMentions } from "../../src/domain/mentions";
import { collectTags, likeContains, normalizeTag, parseHashtags, prefixTsQuery, searchTerms } from "../../src/domain/tags";

describe("mentions", () => {
  test("parses unique lower-cased usernames in order", () => {
    expect(parseMentions("Hi @Alice_1 and @bob, also @alice_1 again")).toEqual(["alice_1", "bob"]);
  });

  test("ignores emails, too-short names and glued text", () => {
    expect(parseMentions("mail someone@example.com or @ab or x@carol")).toEqual([]);
    expect(parseMentions("(@dave) @erin! @frank.")).toEqual(["dave", "erin", "frank"]);
    expect(parseMentions(null)).toEqual([]);
  });

  test("caps the number of mentions", () => {
    const body = Array.from({ length: 30 }, (_, i) => `@user${i}x`).join(" ");
    expect(parseMentions(body)).toHaveLength(MAX_MENTIONS);
  });

  test("newMentions only reports names added by an edit", () => {
    expect(newMentions("hi @alice", "hi @alice and @bob")).toEqual(["bob"]);
    expect(newMentions("hi @alice", "bye")).toEqual([]);
  });
});

describe("tags", () => {
  test("hashtags: lower-cased, unique, at least one letter, not URL fragments or entities", () => {
    expect(parseHashtags("#Design and #design, #2026 #v2 see https://x.example/#anchor &#39;")).toEqual(["design", "v2"]);
  });

  test("normalizeTag", () => {
    expect(normalizeTag(" #Roadmap ")).toBe("roadmap");
    expect(normalizeTag("has space")).toBeNull();
    expect(normalizeTag("x".repeat(41))).toBeNull();
    expect(normalizeTag("123")).toBeNull();
  });

  test("collectTags merges explicit tags and hashtags, capped at 10", () => {
    expect(collectTags(["Roadmap", "bad tag", "design"], "#design #ux")).toEqual(["roadmap", "design", "ux"]);
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    expect(collectTags(many, "")).toHaveLength(10);
  });

  test("search text becomes a safe prefix tsquery", () => {
    expect(prefixTsQuery("Data sci")).toBe("data:* & sci:*");
    expect(prefixTsQuery("a & b | !c:*")).toBe("a:* & b:* & c:*");
    expect(prefixTsQuery("!!! ***")).toBeNull();
    expect(searchTerms("Ünïcode words")).toEqual(["ünïcode", "words"]);
  });

  test("LIKE patterns escape wildcards", () => {
    expect(likeContains("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
