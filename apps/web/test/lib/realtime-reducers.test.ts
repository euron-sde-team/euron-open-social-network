import { describe, expect, it } from "vitest";
import {
  activeTypers,
  applyPresence,
  applyRead,
  bumpThread,
  markNotificationsRead,
  patchMessage,
  prependNotification,
  removeMessage,
  replaceTemp,
  seenBy,
  toggleReaction,
  typingLabel,
  typingReducer,
  upsertMessage,
  type MessagePages,
  type ThreadPages,
} from "@/lib/realtime/reducers";
import type { Notification } from "@open-social/types";
import { message, thread, user } from "../fixtures";

const pages = (...ids: string[][]): MessagePages => ({ pages: ids.map((p, i) => ({ items: p.map((id) => message(id)), nextCursor: i < ids.length - 1 ? `c${i}` : null })), pageParams: ids.map((_, i) => (i ? `c${i - 1}` : undefined)) });
const ids = (d: MessagePages | undefined) => d!.pages.map((p) => p.items.map((m) => m.id));

describe("message cache merging", () => {
  it("adds a new message at the newest end of page 0", () => {
    expect(ids(upsertMessage(pages(["b", "a"]), message("c")))).toEqual([["c", "b", "a"]]);
  });
  it("replaces an existing message instead of duplicating it", () => {
    const d = upsertMessage(pages(["b", "a"], ["z"]), message("z", { body: "edited" }));
    expect(ids(d)).toEqual([["b", "a"], ["z"]]);
    expect(d!.pages[1]!.items[0]!.body).toBe("edited");
  });
  it("leaves an unloaded cache alone", () => {
    expect(upsertMessage(undefined, message("x"))).toBeUndefined();
  });
  it("swaps the optimistic temp for the server copy", () => {
    const d = replaceTemp(pages(["tmp_1", "a"]), "tmp_1", message("real"));
    expect(ids(d)).toEqual([["real", "a"]]);
  });
  it("drops the temp when the socket echo arrived first", () => {
    const withEcho = upsertMessage(pages(["tmp_1", "a"]), message("real"));
    expect(ids(replaceTemp(withEcho, "tmp_1", message("real")))).toEqual([["real", "a"]]);
  });
  it("patches and removes by id", () => {
    expect(patchMessage(pages(["a"]), "a", (m) => ({ ...m, isPinned: true }))!.pages[0]!.items[0]!.isPinned).toBe(true);
    expect(ids(removeMessage(pages(["a", "b"]), "a"))).toEqual([["b"]]);
  });
  it("toggles the viewer's emoji reaction", () => {
    const m = message("a", { reactions: [{ emoji: "\u{1F44D}", count: 2, reactedByViewer: false }] });
    const on = toggleReaction(m, "\u{1F44D}");
    expect(on.reactions[0]).toEqual({ emoji: "\u{1F44D}", count: 3, reactedByViewer: true });
    const off = toggleReaction(on, "\u{1F44D}");
    expect(off.reactions[0]!.count).toBe(2);
    expect(toggleReaction(message("b"), "x").reactions).toEqual([{ emoji: "x", count: 1, reactedByViewer: true }]);
    expect(toggleReaction(toggleReaction(message("b"), "x"), "x").reactions).toEqual([]);
  });
});

describe("typing", () => {
  it("adds, refreshes, removes and expires typers per room", () => {
    let s = typingReducer({}, { roomId: "r", userId: "u1", name: "Ada", typing: true }, 0);
    s = typingReducer(s, { roomId: "r", userId: "u2", name: "Lin", typing: true }, 1000);
    expect(typingLabel(activeTypers(s, "r", 2000))).toBe("Ada and Lin are typing");
    expect(activeTypers(s, "r", 2000, "u1").map((t) => t.name)).toEqual(["Lin"]);
    expect(activeTypers(s, "r", 6500).map((t) => t.name)).toEqual(["Lin"]);
    s = typingReducer(s, { roomId: "r", userId: "u2", name: "Lin", typing: false }, 3000);
    s = typingReducer(s, { roomId: "r", userId: "u1", name: "Ada", typing: false }, 3000);
    expect(s).toEqual({});
  });
  it("labels one and many", () => {
    expect(typingLabel([])).toBeNull();
    expect(typingLabel([{ userId: "a", name: "Ada", expiresAt: 1 }])).toBe("Ada is typing");
    expect(typingLabel([1, 2, 3].map((i) => ({ userId: `${i}`, name: `${i}`, expiresAt: 1 })))).toBe("Several people are typing");
  });
});

describe("presence", () => {
  it("updates a contact and re-sorts online first", () => {
    const contacts = [
      { user: user("a"), online: true, lastSeenAt: null },
      { user: user("b"), online: false, lastSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const next = applyPresence(contacts, { userId: "b", online: true, lastSeenAt: null })!;
    expect(next.every((c) => c.online)).toBe(true);
    const off = applyPresence(next, { userId: "a", online: false, lastSeenAt: "2026-02-01T00:00:00Z" })!;
    expect(off.map((c) => c.user.id)).toEqual(["b", "a"]);
    expect(applyPresence(contacts, { userId: "zz", online: true, lastSeenAt: null })).toBe(contacts);
  });
});

describe("threads", () => {
  const list = (): ThreadPages => ({ pages: [{ items: [thread("t1"), thread("t2")], nextCursor: null }], pageParams: [undefined] });
  it("moves the thread to the top and counts unread for others' messages", () => {
    const r = bumpThread(list(), "t2", message("m", { sender: user("u1") }), { viewerId: "me", isOpen: false });
    expect(r.found).toBe(true);
    expect(r.data!.pages[0]!.items.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(r.data!.pages[0]!.items[0]!.unreadCount).toBe(1);
  });
  it("does not count own messages or messages in an open thread", () => {
    expect(bumpThread(list(), "t2", message("m", { sender: user("me") }), { viewerId: "me", isOpen: false }).data!.pages[0]!.items[0]!.unreadCount).toBe(0);
    expect(bumpThread(list(), "t2", message("m"), { viewerId: "me", isOpen: true }).data!.pages[0]!.items[0]!.unreadCount).toBe(0);
  });
  it("reports a thread that is not loaded", () => {
    expect(bumpThread(list(), "nope", message("m"), { viewerId: "me", isOpen: false }).found).toBe(false);
  });
  it("computes Seen from participants' read positions", () => {
    const t = applyRead(thread("t1"), "u1", "2026-01-01T10:05:00.000Z")!;
    const mine = message("m", { sender: user("me"), createdAt: "2026-01-01T10:00:00.000Z" });
    expect(seenBy(t, mine, "me").map((p) => p.user.id)).toEqual(["u1"]);
    const later = message("m2", { sender: user("me"), createdAt: "2026-01-01T10:10:00.000Z" });
    expect(seenBy(t, later, "me")).toEqual([]);
  });
});

describe("notifications", () => {
  const n = (id: string): Notification => ({ id, type: "FOLLOW", actor: user("u1"), entityType: "user", entityId: "u1", communityId: null, snippet: null, href: "/u/u1", readAt: null, createdAt: "2026-01-01T00:00:00Z" });
  it("prepends once and marks read", () => {
    const d = { pages: [{ items: [n("a")], nextCursor: null }], pageParams: [undefined] };
    const added = prependNotification(d, n("b"))!;
    expect(added.pages[0]!.items.map((x) => x.id)).toEqual(["b", "a"]);
    expect(prependNotification(added, n("b"))).toBe(added);
    const read = markNotificationsRead(added, "all", "now")!;
    expect(read.pages[0]!.items.every((x) => x.readAt === "now")).toBe(true);
    expect(markNotificationsRead(added, "a", "t")!.pages[0]!.items.map((x) => x.readAt)).toEqual([null, "t"]);
  });
});
