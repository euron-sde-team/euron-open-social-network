/**
 * Media mosaic layout math. Returns grid placement for up to four tiles plus
 * an overflow count ("+3") on the last visible tile.
 *
 *  1: one tile, aspect kept within [0.8, 1.91] (tall images are letterboxed).
 *  2: side by side (two portraits) or stacked (two landscapes).
 *  3: one large tile and two small (large on the left for a portrait lead,
 *     on top for a landscape lead).
 *  4+: a 2x2 grid; the fourth tile shows "+N" for the rest.
 */
export interface Dim {
  width: number | null;
  height: number | null;
}

export interface Tile {
  index: number;
  /** CSS grid placement on a 2x2 grid. */
  col: string;
  row: string;
  overflow: number;
}

export interface MosaicLayout {
  /** aspect ratio (width / height) of the whole mosaic. */
  aspect: number;
  rows: number;
  cols: number;
  tiles: Tile[];
}

export function ratio(d: Dim | undefined): number {
  if (!d || !d.width || !d.height || d.width <= 0 || d.height <= 0) return 1;
  return d.width / d.height;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mosaicLayout(items: Dim[]): MosaicLayout {
  const n = items.length;
  if (n === 0) return { aspect: 1, rows: 0, cols: 0, tiles: [] };
  if (n === 1) {
    return { aspect: clamp(ratio(items[0]), 0.8, 1.91), rows: 1, cols: 1, tiles: [{ index: 0, col: "1 / span 2", row: "1 / span 2", overflow: 0 }] };
  }
  if (n === 2) {
    const bothLandscape = ratio(items[0]) > 1.2 && ratio(items[1]) > 1.2;
    return bothLandscape
      ? {
          aspect: 1,
          rows: 2,
          cols: 1,
          tiles: [
            { index: 0, col: "1 / span 2", row: "1", overflow: 0 },
            { index: 1, col: "1 / span 2", row: "2", overflow: 0 },
          ],
        }
      : {
          aspect: 2 / 1.25,
          rows: 1,
          cols: 2,
          tiles: [
            { index: 0, col: "1", row: "1 / span 2", overflow: 0 },
            { index: 1, col: "2", row: "1 / span 2", overflow: 0 },
          ],
        };
  }
  if (n === 3) {
    const leadPortrait = ratio(items[0]) < 0.9;
    return leadPortrait
      ? {
          aspect: 1,
          rows: 2,
          cols: 2,
          tiles: [
            { index: 0, col: "1", row: "1 / span 2", overflow: 0 },
            { index: 1, col: "2", row: "1", overflow: 0 },
            { index: 2, col: "2", row: "2", overflow: 0 },
          ],
        }
      : {
          aspect: 1,
          rows: 2,
          cols: 2,
          tiles: [
            { index: 0, col: "1 / span 2", row: "1", overflow: 0 },
            { index: 1, col: "1", row: "2", overflow: 0 },
            { index: 2, col: "2", row: "2", overflow: 0 },
          ],
        };
  }
  return {
    aspect: 1,
    rows: 2,
    cols: 2,
    tiles: [0, 1, 2, 3].map((i) => ({
      index: i,
      col: String((i % 2) + 1),
      row: String(Math.floor(i / 2) + 1),
      overflow: i === 3 ? n - 4 : 0,
    })),
  };
}
