import { describe, expect, it } from "vitest";
import { MAX_HEADS, MAX_OPEN, dock, emptyDock, maxOpenForViewport } from "@/lib/stores/dock";

describe("dock transitions", () => {
  it("opens up to MAX_OPEN windows and bumps the oldest to a head", () => {
    let s = emptyDock;
    for (const id of ["a", "b", "c"]) s = dock.openThread(s, id);
    expect(s.open).toEqual(["a", "b", "c"]);
    s = dock.openThread(s, "d");
    expect(s.open).toHaveLength(MAX_OPEN);
    expect(s.open).toEqual(["b", "c", "d"]);
    expect(s.minimized).toEqual(["a"]);
  });

  it("re-opening an open thread focuses it without duplicating", () => {
    let s = dock.openThread(dock.openThread(emptyDock, "a"), "b");
    s = dock.openThread(s, "a");
    expect(s.open).toEqual(["b", "a"]);
  });

  it("restores a minimised head into a window", () => {
    let s = dock.openThread(emptyDock, "a");
    s = dock.minimize(s, "a");
    expect(s).toEqual({ open: [], minimized: ["a"] });
    s = dock.openThread(s, "a");
    expect(s).toEqual({ open: ["a"], minimized: [] });
  });

  it("minimise puts the newest head first and ignores unknown ids", () => {
    let s = dock.openThread(dock.openThread(emptyDock, "a"), "b");
    s = dock.minimize(dock.minimize(s, "a"), "b");
    expect(s.minimized).toEqual(["b", "a"]);
    expect(dock.minimize(s, "zzz")).toBe(s);
  });

  it("close removes from both lists", () => {
    let s = dock.minimize(dock.openThread(dock.openThread(emptyDock, "a"), "b"), "a");
    s = dock.close(dock.close(s, "a"), "b");
    expect(s).toEqual(emptyDock);
  });

  it("caps the heads at MAX_HEADS", () => {
    let s = emptyDock;
    for (let i = 0; i < 12; i++) s = dock.openThread(s, `t${i}`, 1);
    expect(s.open).toEqual(["t11"]);
    expect(s.minimized.length).toBe(MAX_HEADS);
  });

  it("honours a smaller maxOpen and fits fewer windows on narrow screens", () => {
    const s = dock.openThread(dock.openThread(emptyDock, "a", 1), "b", 1);
    expect(s).toEqual({ open: ["b"], minimized: ["a"] });
    expect(maxOpenForViewport(900)).toBe(1);
    expect(maxOpenForViewport(1200)).toBe(2);
    expect(maxOpenForViewport(1600)).toBe(3);
  });
});
