import { describe, expect, it } from "vitest";
import { activeTypers, applyPresence, bumpThread, replaceTemp, seenBy, toggleReaction, typingLabel, typingReducer, upsertMessage } from "@/lib/realtime/reducers";
import { msg, thread, user } from "./fixtures";

const pages = (...ids: string[][]) => ({ pages: ids.map((p, i) => ({ items: p.map((id) => msg(id, "x", "2026-01-01T00:00:00Z")), nextCursor: i < ids.length - 1 ? `c${i}` : null })), pageParams: ids.map(() => undefined) });

describe("message cache reducers", () => {
  it("adds new messages at the newest end and ignores echoes", () => {
    const d = upsertMessage(pages(["2", "1"]), msg("3", "x", "2026-01-01T00:00:00Z"))!;
    expect(d.pages[0]!.items.map((m) => m.id)).toEqual(["3", "2", "1"]);
    const again = upsertMessage(d, msg("3", "x", "2026-01-01T00:00:00Z", { body: "edited" }))!;
    expect(again.pages[0]!.items.filter((m) => m.id === "3")).toHaveLength(1);
    expect(again.pages[0]!.items[0]!.body).toBe("edited");
  });

  it("swaps a temp message for the real one, or drops it when the echo already arrived", () => {
    const withTemp = pages(["tmp_1", "1"]);
    expect(replaceTemp(withTemp, "tmp_1", msg("9", "x", "2026-01-01T00:00:00Z"))!.pages[0]!.items.map((m) => m.id)).toEqual(["9", "1"]);
    const echoed = pages(["9", "tmp_1", "1"]);
    expect(replaceTemp(echoed, "tmp_1", msg("9", "x", "2026-01-01T00:00:00Z"))!.pages[0]!.items.map((m) => m.id)).toEqual(["9", "1"]);
  });

  it("toggles the viewer's reaction counts", () => {
    let m = msg("1", "x", "2026-01-01T00:00:00Z", { reactions: [{ emoji: "A", count: 2, reactedByViewer: false }] });
    m = toggleReaction(m, "A");
    expect(m.reactions[0]).toEqual({ emoji: "A", count: 3, reactedByViewer: true });
    m = toggleReaction(toggleReaction(m, "A"), "B");
    expect(m.reactions).toEqual([
      { emoji: "A", count: 2, reactedByViewer: false },
      { emoji: "B", count: 1, reactedByViewer: true },
    ]);
  });
});

describe("typing", () => {
  it("tracks typers per room and expires them", () => {
    let s = typingReducer({}, { roomId: "r", userId: "a", name: "Ada", typing: true }, 0);
    s = typingReducer(s, { roomId: "r", userId: "b", name: "Lin", typing: true }, 1000);
    expect(typingLabel(activeTypers(s, "r", 2000))).toBe("Ada and Lin are typing");
    expect(typingLabel(activeTypers(s, "r", 6500))).toBe("Lin is typing");
    expect(activeTypers(s, "r", 2000, "a").map((t) => t.userId)).toEqual(["b"]);
    s = typingReducer(typingReducer(s, { roomId: "r", userId: "a", name: "Ada", typing: false }, 2000), { roomId: "r", userId: "b", name: "Lin", typing: false }, 2000);
    expect(s).toEqual({});
  });
});

describe("presence and threads", () => {
  it("updates presence and re-sorts online first", () => {
    const contacts = [
      { user: user("a"), online: true, lastSeenAt: null },
      { user: user("b"), online: false, lastSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const next = applyPresence(contacts, { userId: "b", online: true, lastSeenAt: null })!;
    expect(next.every((c) => c.online)).toBe(true);
    expect(applyPresence(contacts, { userId: "zz", online: true, lastSeenAt: null })).toBe(contacts);
  });

  it("bumps a thread to the top and counts unread unless open or own", () => {
    const data = { pages: [{ items: [thread("a"), thread("b")], nextCursor: null }], pageParams: [undefined] };
    const m = msg("m", "ada", "2026-01-01T00:00:00Z");
    const r = bumpThread(data, "b", m, { viewerId: "me", isOpen: false });
    expect(r.found).toBe(true);
    expect(r.data!.pages[0]!.items.map((t) => [t.id, t.unreadCount])).toEqual([
      ["b", 1],
      ["a", 0],
    ]);
    expect(bumpThread(data, "b", m, { viewerId: "me", isOpen: true }).data!.pages[0]!.items[0]!.unreadCount).toBe(0);
    expect(bumpThread(data, "zz", m, { viewerId: "me", isOpen: false }).found).toBe(false);
  });

  it("seenBy lists participants whose read time is at or after the message", () => {
    const t = thread("t", { participants: [
      { user: user("me"), state: "ACTIVE", lastReadAt: null },
      { user: user("a"), state: "ACTIVE", lastReadAt: "2026-01-01T00:00:10Z" },
      { user: user("b"), state: "ACTIVE", lastReadAt: "2026-01-01T00:00:01Z" },
    ] });
    expect(seenBy(t, msg("m", "me", "2026-01-01T00:00:05Z"), "me").map((p) => p.user.id)).toEqual(["a"]);
  });
});
