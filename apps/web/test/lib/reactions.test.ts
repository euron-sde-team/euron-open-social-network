import { describe, expect, it } from "vitest";
import { applyReaction, pickerReducer, toggleTarget, topReactions, type PickerState } from "@/lib/reactions";

describe("reaction counts", () => {
  it("adds, switches and removes the viewer's reaction", () => {
    const base = { reactionCount: 3, reactionCounts: { LIKE: 2, LOVE: 1 } };
    expect(applyReaction(base, null, "WOW")).toEqual({ reactionCount: 4, reactionCounts: { LIKE: 2, LOVE: 1, WOW: 1 } });
    expect(applyReaction(base, "LOVE", "LIKE")).toEqual({ reactionCount: 3, reactionCounts: { LIKE: 3 } });
    expect(applyReaction(base, "LIKE", null)).toEqual({ reactionCount: 2, reactionCounts: { LIKE: 1, LOVE: 1 } });
    expect(applyReaction(base, "LIKE", "LIKE")).toBe(base);
  });
  it("never goes negative on stale counts", () => {
    expect(applyReaction({ reactionCount: 0, reactionCounts: {} }, "SAD", null)).toEqual({ reactionCount: 0, reactionCounts: {} });
  });
  it("click toggles LIKE or clears any reaction", () => {
    expect(toggleTarget(null)).toBe("LIKE");
    expect(toggleTarget("LIKE")).toBeNull();
    expect(toggleTarget("ANGRY")).toBeNull();
  });
  it("orders the top reactions by count then canonical order", () => {
    expect(topReactions({ HAHA: 2, LIKE: 2, LOVE: 5, SAD: 0 })).toEqual(["LOVE", "LIKE", "HAHA"]);
  });
});

describe("reaction picker state", () => {
  const closed: PickerState = { open: false, pending: null };
  it("opens after hover intent, not immediately", () => {
    const s1 = pickerReducer(closed, "pointer-enter");
    expect(s1).toEqual({ open: false, pending: "open" });
    expect(pickerReducer(s1, "open-timer")).toEqual({ open: true, pending: null });
  });
  it("cancels a pending open when the pointer leaves first", () => {
    const s = pickerReducer(pickerReducer(closed, "pointer-enter"), "pointer-leave");
    expect(pickerReducer(s, "open-timer")).toEqual(closed);
  });
  it("keeps the picker open when the pointer comes back before the close timer", () => {
    const open: PickerState = { open: true, pending: null };
    const leaving = pickerReducer(open, "pointer-leave");
    expect(leaving.pending).toBe("close");
    const back = pickerReducer(leaving, "pointer-enter");
    expect(pickerReducer(back, "close-timer")).toEqual(open);
  });
  it("long-press opens, pick and escape close, keyboard toggles", () => {
    expect(pickerReducer(closed, "long-press").open).toBe(true);
    expect(pickerReducer({ open: true, pending: null }, "pick")).toEqual(closed);
    expect(pickerReducer({ open: true, pending: "close" }, "escape")).toEqual(closed);
    expect(pickerReducer(closed, "toggle-key").open).toBe(true);
  });
});
