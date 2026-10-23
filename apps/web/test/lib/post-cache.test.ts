import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Page, Post } from "@open-social/types";
import { prependPost, removePostEverywhere, restoreSnapshot, updatePostEverywhere } from "@/lib/post-cache";
import { applyVote, optionPercent } from "@/lib/poll";
import { post } from "../fixtures";

const inf = (...items: Post[]): InfiniteData<Page<Post>> => ({ pages: [{ items, nextCursor: null }], pageParams: [undefined] });

describe("post cache", () => {
  it("updates a post in every list and the detail cache, including shared embeds", () => {
    const qc = new QueryClient();
    qc.setQueryData(["feed", "latest"], inf(post("p1"), post("p2", { sharedPost: post("p1") })));
    qc.setQueryData(["community-posts", "c1", "new", ""], inf(post("p1")));
    qc.setQueryData(["post", "p1"], post("p1"));
    qc.setQueryData(["search", "q", "all"], { people: [], communities: [], questions: [], posts: [post("p1")] });
    qc.setQueryData(["unrelated"], { id: "p1", author: {} });
    const snap = updatePostEverywhere(qc, "p1", (p) => ({ ...p, reactionCount: 9 }));
    const feed = qc.getQueryData<InfiniteData<Page<Post>>>(["feed", "latest"])!;
    expect(feed.pages[0]!.items[0]!.reactionCount).toBe(9);
    expect(feed.pages[0]!.items[1]!.sharedPost!.reactionCount).toBe(9);
    expect(qc.getQueryData<Post>(["post", "p1"])!.reactionCount).toBe(9);
    expect(qc.getQueryData<{ posts: Post[] }>(["search", "q", "all"])!.posts[0]!.reactionCount).toBe(9);
    expect(qc.getQueryData<{ id: string }>(["unrelated"])).toEqual({ id: "p1", author: {} });
    restoreSnapshot(qc, snap);
    expect(qc.getQueryData<Post>(["post", "p1"])!.reactionCount).toBe(0);
  });
  it("removes a post from lists and prepends new ones without duplicates", () => {
    const qc = new QueryClient();
    qc.setQueryData(["feed", "latest"], inf(post("p1"), post("p2")));
    removePostEverywhere(qc, "p1");
    expect(qc.getQueryData<InfiniteData<Page<Post>>>(["feed", "latest"])!.pages[0]!.items.map((p) => p.id)).toEqual(["p2"]);
    prependPost(qc, post("p3"));
    prependPost(qc, post("p3"));
    expect(qc.getQueryData<InfiniteData<Page<Post>>>(["feed", "latest"])!.pages[0]!.items.map((p) => p.id)).toEqual(["p3", "p2"]);
  });
});

describe("poll math", () => {
  const poll = {
    id: "poll",
    question: "?",
    allowMultiple: false,
    isAnonymous: false,
    closesAt: null,
    isClosed: false,
    totalVotes: 4,
    voterCount: 4,
    options: [
      { id: "a", label: "A", voteCount: 3, votedByViewer: false },
      { id: "b", label: "B", voteCount: 1, votedByViewer: false },
    ],
  };
  it("computes percentages", () => {
    expect(optionPercent(poll, 3)).toBe(75);
    expect(optionPercent({ ...poll, totalVotes: 0 }, 0)).toBe(0);
  });
  it("applies, changes and removes a vote optimistically", () => {
    const voted = applyVote(poll, ["b"]);
    expect(voted.options.map((o) => o.voteCount)).toEqual([3, 2]);
    expect(voted.voterCount).toBe(5);
    const changed = applyVote(voted, ["a"]);
    expect(changed.options.map((o) => o.voteCount)).toEqual([4, 1]);
    expect(changed.voterCount).toBe(5);
    const removed = applyVote(changed, []);
    expect(removed.options.map((o) => o.voteCount)).toEqual([3, 1]);
    expect(removed.voterCount).toBe(4);
  });
});
