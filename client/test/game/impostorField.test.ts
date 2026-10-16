import { describe, expect, it } from "vitest";
import {
  IMPOSTOR_FIELD_CUT,
  IMPOSTOR_FIELD_INSIDE,
  IMPOSTOR_FIELD_SPREAD,
  impostorFields,
  nearestSeeds,
} from "../../src/game/impostorField.js";

/** A picture from rows of characters: `#` a tree texel (opaque, its colour
 * from its position), `.` clear. */
function picture(rows: string[]): { rgba: Uint8Array; width: number; height: number } {
  const width = rows[0]!.length;
  const height = rows.length;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const tree = row[x] === "#";
      rgba[i] = tree ? 10 + x : 0;
      rgba[i + 1] = tree ? 10 + y : 0;
      rgba[i + 2] = tree ? 200 : 0;
      rgba[i + 3] = tree ? 255 : 0;
    }
  });
  return { rgba, width, height };
}

/** The brute-force nearest seed: the exact answer the transform must match. */
function brute(seed: Uint8Array, width: number, height: number): { dist: number[]; index: number[] } {
  const dist: number[] = [];
  const index: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = Infinity;
      let at = -1;
      for (let sy = 0; sy < height; sy++) {
        for (let sx = 0; sx < width; sx++) {
          if (seed[sy * width + sx] === 0) continue;
          const d = Math.hypot(sx - x, sy - y);
          if (d < best) {
            best = d;
            at = sy * width + sx;
          }
        }
      }
      dist.push(best);
      index.push(at);
    }
  }
  return { dist, index };
}

describe("nearestSeeds", () => {
  it("finds every texel's exact distance to its nearest seed, and the seed, on a scattered picture", () => {
    const width = 23;
    const height = 17;
    const seed = new Uint8Array(width * height);
    // A fixed scatter: a few seeds, some rows and columns without one.
    for (const [x, y] of [[3, 2], [15, 2], [8, 9], [20, 12], [1, 14], [11, 15]]) seed[y! * width + x!] = 1;
    const got = nearestSeeds(seed, width, height);
    const want = brute(seed, width, height);
    for (let i = 0; i < width * height; i++) {
      expect(got.dist[i], `texel ${i}`).toBeCloseTo(want.dist[i]!, 6);
      // A tie may pick either seed: the distances agree, and the seed is one at that distance.
      const at = got.index[i]!;
      expect(seed[at], `texel ${i}`).toBe(1);
      expect(Math.hypot((at % width) - (i % width), Math.floor(at / width) - Math.floor(i / width)), `texel ${i}`).toBeCloseTo(want.dist[i]!, 6);
    }
  });

  it("answers infinity and no seed on a picture without one", () => {
    const got = nearestSeeds(new Uint8Array(12), 4, 3);
    expect([...got.dist]).toEqual(Array(12).fill(Infinity));
    expect([...got.index]).toEqual(Array(12).fill(-1));
  });

  it("is zero on a seed", () => {
    const seed = new Uint8Array(9);
    seed[4] = 1;
    const got = nearestSeeds(seed, 3, 3);
    expect(got.dist[4]).toBe(0);
    expect(got.index[4]).toBe(4);
    expect(got.dist[0]).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("impostorFields", () => {
  it("writes the rim at the cut, half a texel outside each inside texel, and the spread either way", () => {
    expect(IMPOSTOR_FIELD_CUT).toBe(0.5);
    expect(IMPOSTOR_FIELD_SPREAD).toBe(8);
    expect(IMPOSTOR_FIELD_INSIDE).toBe(128);
    // A column of tree down the middle of a 21-wide picture, one row.
    const row = ".........###########.";
    const { rgba, width, height } = picture([row, row, row]);
    const { albedo } = impostorFields(rgba, null, width, height, 4);
    const alpha = (x: number) => albedo[(1 * width + x) * 4 + 3]! / 255;
    // The inside texel at the rim is half a texel inside; its neighbour outside half a texel outside.
    expect(alpha(9)).toBeCloseTo(0.5 + 0.5 / 8, 2);
    expect(alpha(8)).toBeCloseTo(0.5 - 0.5 / 8, 2);
    // The field reaches 1 four and a half texels in (the rim is half a texel
    // outside texel 9) and 0 four and a half out, and is clamped past them.
    expect(alpha(12)).toBeCloseTo(0.5 + 3.5 / 8, 2);
    expect(alpha(13)).toBe(1);
    expect(alpha(14)).toBe(1);
    expect(alpha(5)).toBeCloseTo(0.5 - 3.5 / 8, 2);
    expect(alpha(4)).toBe(0);
    expect(alpha(0)).toBe(0);
    // Monotone across the rim.
    for (let x = 1; x < 14; x++) expect(alpha(x)).toBeGreaterThanOrEqual(alpha(x - 1));
  });

  it("fills every outside texel with the nearest inside texel's colour, on both pictures", () => {
    const { rgba, width, height } = picture([".....", "..#..", "....."]);
    const normal = new Uint8Array(width * height * 4);
    normal.set([1, 2, 3, 255], (1 * width + 2) * 4);
    const fields = impostorFields(rgba, normal, width, height);
    for (let i = 0; i < width * height; i++) {
      expect([...fields.albedo.slice(i * 4, i * 4 + 3)], `texel ${i}`).toEqual([12, 11, 200]);
      expect([...fields.normal!.slice(i * 4, i * 4 + 4)], `texel ${i}`).toEqual([1, 2, 3, 255]);
    }
    // The one inside texel is alpha above the cut; the corner, 2.24 texels out, below it.
    expect(fields.albedo[(1 * width + 2) * 4 + 3]! / 255).toBeGreaterThan(0.5);
    expect(fields.albedo[3]! / 255).toBeLessThan(0.5);
  });

  it("leaves a bake without a tree all outside: alpha zero, the colour as it was, the normal flat", () => {
    const { rgba, width, height } = picture(["...", "..."]);
    const fields = impostorFields(rgba, new Uint8Array(width * height * 4), width, height);
    for (let i = 0; i < width * height; i++) {
      expect(fields.albedo[i * 4 + 3]).toBe(0);
      expect([...fields.normal!.slice(i * 4, i * 4 + 3)]).toEqual([128, 128, 255]);
    }
  });

  it("takes a bake's size, a crown on a trunk, and keeps the rim at the cut all round", () => {
    const size = 512;
    const rgba = new Uint8Array(size * size * 4);
    const inside = (x: number, y: number) => Math.hypot(x - 256, y - 300) < 120 || (Math.abs(x - 256) < 12 && y > 300);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) rgba[(y * size + x) * 4 + 3] = inside(x, y) ? 255 : 0;
    }
    const fields = impostorFields(rgba, rgba, size, size);
    expect(fields.albedo.length).toBe(size * size * 4);
    // Every texel inside is at or above the cut, every texel outside below it.
    for (let y = 0; y < size; y += 7) {
      for (let x = 0; x < size; x += 5) {
        const alpha = fields.albedo[(y * size + x) * 4 + 3]! / 255;
        if (inside(x, y)) expect(alpha, `${x},${y}`).toBeGreaterThanOrEqual(IMPOSTOR_FIELD_CUT);
        else expect(alpha, `${x},${y}`).toBeLessThan(IMPOSTOR_FIELD_CUT);
      }
    }
  });
});
