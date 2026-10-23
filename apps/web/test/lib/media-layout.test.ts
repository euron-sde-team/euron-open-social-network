import { describe, expect, it } from "vitest";
import { mosaicLayout, ratio } from "@/lib/media-layout";

const land = { width: 1600, height: 900 };
const port = { width: 900, height: 1600 };

describe("mosaicLayout", () => {
  it("is empty for no media", () => {
    expect(mosaicLayout([]).tiles).toEqual([]);
  });
  it("keeps a single tile's aspect within bounds", () => {
    expect(mosaicLayout([land]).aspect).toBeCloseTo(1.7778, 3);
    expect(mosaicLayout([port]).aspect).toBe(0.8);
    expect(mosaicLayout([{ width: 5000, height: 1000 }]).aspect).toBe(1.91);
    expect(mosaicLayout([{ width: null, height: null }]).aspect).toBe(1);
  });
  it("stacks two landscapes and puts other pairs side by side", () => {
    const stacked = mosaicLayout([land, land]);
    expect(stacked.rows).toBe(2);
    expect(stacked.tiles.map((t) => t.row)).toEqual(["1", "2"]);
    const side = mosaicLayout([port, land]);
    expect(side.cols).toBe(2);
    expect(side.tiles.map((t) => t.col)).toEqual(["1", "2"]);
  });
  it("leads three with a tall tile for a portrait and a wide tile for a landscape", () => {
    expect(mosaicLayout([port, land, land]).tiles[0]).toMatchObject({ col: "1", row: "1 / span 2" });
    expect(mosaicLayout([land, port, port]).tiles[0]).toMatchObject({ col: "1 / span 2", row: "1" });
  });
  it("shows four tiles and the overflow on the last one", () => {
    const l = mosaicLayout(Array.from({ length: 7 }, () => land));
    expect(l.tiles).toHaveLength(4);
    expect(l.tiles.map((t) => t.overflow)).toEqual([0, 0, 0, 3]);
    expect(mosaicLayout([land, land, land, land]).tiles[3]!.overflow).toBe(0);
  });
  it("ratio defaults to square on bad dimensions", () => {
    expect(ratio({ width: 0, height: 10 })).toBe(1);
    expect(ratio(undefined)).toBe(1);
  });
});
