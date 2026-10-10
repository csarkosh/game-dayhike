import { describe, expect, it } from "vitest";
import {
  SHORE_ATLAS_FAR, SHORE_ATLAS_LAKES, SHORE_ATLAS_SIZE, SHORE_ATLAS_TILE, bakeShoreAtlas, shoreAtlasRead,
} from "../../src/game/shoreAtlas.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";

// Lake A: 15 m in half-width about a 20 m spine along z at the origin, its
// bound 10 + 15 + 47 = 72 m, so a texel is 2 · 72 / 128 = 1.125 m across and
// texel k's centre stands at −72 + (k + ½) · 1.125. Lake B sits 500 m east,
// 20 m in half-width: its bound 77 m, a texel 154 / 128 = 1.203125 m.
const A = stadiumShape({ cx: 0, cz: 0, halfLen: 10, w: 15 });
const B = stadiumShape({ cx: 500, cz: 0, halfLen: 10, w: 20 });

describe("the shore atlas", { timeout: timeLimit(30_000) }, () => {
  const atlas = bakeShoreAtlas([A, B]);

  it("is 256 texels square, four tiles of 128, a float a texel", () => {
    expect([SHORE_ATLAS_SIZE, SHORE_ATLAS_TILE, SHORE_ATLAS_LAKES, SHORE_ATLAS_FAR]).toEqual([256, 128, 4, -1000]);
    expect(atlas.values).toHaveLength(65536);
  });

  it("holds each lake's shore distance at its texels' centres, tile 0 the first lake's", () => {
    // Texel (64, 64): x = z = 0.5625, on the flank, 15 − 0.5625 in from the shore.
    expect(atlas.values[64 * 256 + 64]).toBe(14.4375);
    // Texel (127, 64): x = 71.4375, 56.4375 outside it.
    expect(atlas.values[64 * 256 + 127]).toBe(-56.4375);
    // Lake B's own texel (64, 64) in tile 1, columns 128 on: x = 500.6015625, 19.3984375 in.
    expect(atlas.values[64 * 256 + 128 + 64]).toBe(19.3984375);
  });

  it("holds SHORE_ATLAS_FAR past a lake's bound and in every tile no lake has", () => {
    expect(atlas.values[0]).toBe(SHORE_ATLAS_FAR); // tile 0's corner: 101 m from the centre
    for (let v = 128; v < 256; v++) {
      for (let u = 0; u < 256; u++) expect(atlas.values[v * 256 + u]).toBe(SHORE_ATLAS_FAR);
    }
  });

  it("reads bilinearly as the shader does: a texel's centre exactly, halfway between two their mean", () => {
    expect(shoreAtlasRead(atlas.values, 0, 0, 0, A.bound, 0.5625, 0.5625)).toBe(14.4375);
    expect(shoreAtlasRead(atlas.values, 0, 0, 0, A.bound, 1.125, 0.5625)).toBeCloseTo((14.4375 + 13.3125) / 2, 12);
  });

  it("reads its own tile to the square's edge, never the neighbour's, and SHORE_ATLAS_FAR past it", () => {
    // At the square's east edge lake A's own last texel, not lake B's first
    // (x = 423.6015625, 56.3984375 outside its shore).
    expect(shoreAtlasRead(atlas.values, 0, 0, 0, A.bound, 72, 0.5625)).toBe(-56.4375);
    expect(atlas.values[64 * 256 + 128]).toBe(-56.3984375);
    expect(shoreAtlasRead(atlas.values, 0, 0, 0, A.bound, 72.01, 0.5625)).toBe(SHORE_ATLAS_FAR);
    expect(shoreAtlasRead(atlas.values, 0, 0, 0, A.bound, 0, -72.01)).toBe(SHORE_ATLAS_FAR);
    // The last tile's far corner reads inside the texture.
    expect(Number.isFinite(shoreAtlasRead(atlas.values, 3, 0, 0, A.bound, 72, 72))).toBe(true);
  });

  it("bakes no more than four lakes", () => {
    const five = bakeShoreAtlas([A, A, A, A, A]);
    expect(five.values[64 * 256 + 64]).toBe(14.4375);
    expect(five.values[(128 + 64) * 256 + 128 + 64]).toBe(14.4375);
  });
});
