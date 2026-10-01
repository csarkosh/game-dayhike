import { describe, it, expect } from "vitest";
import {
  LENS, LENS_TRAIL, lensDrops, lensDropletMap, lensSmooth, lensStrengthUnder, smoothstep,
} from "../../src/game/lensParams.js";

describe("the lens's numbers", () => {
  it("is a 128-texel map of 40 drops of 2 to 5 percent, tiled twice, refracting by 0.03, smoothed over a second, floored at 0.02", () => {
    expect(LENS).toEqual({ size: 128, drops: 40, radius: [0.02, 0.05], tiles: 2, offset: 0.03, columns: 8, smoothS: 1, floor: 0.02 });
  });
});

describe("lensDropletMap", () => {
  const size = 128;
  const map = lensDropletMap();
  const drops = lensDrops();
  const texel = (x: number, y: number) => Array.from(map.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));

  it("is 128 by 128 RGBA, the same every time, and another map for another seed", () => {
    expect(map.length).toBe(65536);
    expect(lensDropletMap()).toEqual(map);
    expect(lensDropletMap(1)).toEqual(map);
    expect(lensDropletMap(2)).not.toEqual(map);
  });

  it("packs the normal around 128 within the cap's slope, and leaves a flat texel outside every drop", () => {
    let full = 0;
    let trailed = 0;
    let empty = 0;
    for (let i = 0; i < size * size; i++) {
      const [r, g, b, a] = [map[i * 4], map[i * 4 + 1], map[i * 4 + 2], map[i * 4 + 3]] as [number, number, number, number];
      expect(r).toBeGreaterThanOrEqual(26);
      expect(r).toBeLessThanOrEqual(230);
      expect(g).toBeGreaterThanOrEqual(26);
      expect(g).toBeLessThanOrEqual(230);
      if (b === 255) full++;
      if (a > 0) trailed++;
      if (b === 0 && a === 0) {
        empty++;
        expect([r, g]).toEqual([128, 128]);
      }
    }
    expect(full).toBe(1930);
    expect(trailed).toBe(1080);
    expect(empty).toBe(12649);
  });

  it("places 40 drops of radius 0.02 to 0.05 on texel centres, clear of the edges by their radius and their trail", () => {
    expect(drops).toHaveLength(40);
    expect(lensDrops(1)).toEqual(drops);
    for (const d of drops) {
      expect(Number.isInteger(d.x)).toBe(true);
      expect(Number.isInteger(d.y)).toBe(true);
      expect(d.r).toBeGreaterThanOrEqual(0.02);
      expect(d.r).toBeLessThanOrEqual(0.05);
      expect(d.x - d.r * size).toBeGreaterThanOrEqual(0);
      expect(d.x + d.r * size).toBeLessThanOrEqual(127);
      expect(d.y - d.r * (1 + LENS_TRAIL) * size).toBeGreaterThanOrEqual(0);
      expect(d.y + d.r * size).toBeLessThanOrEqual(127);
    }
  });

  it("writes a flat normal and full cover at a drop's centre", () => {
    // Where another drop's cover reaches the centre, that drop's normal may
    // stand there instead: only the centres clear of every other drop.
    const clear = drops.filter((a, i) => drops.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > b.r * size + 1));
    expect(clear).toHaveLength(34);
    for (const d of clear) expect(texel(d.x, d.y).slice(0, 3)).toEqual([128, 128, 255]);
  });

  it("slopes the normal away from the centre, and trails straight down from every drop", () => {
    const first = drops[0] as { x: number; y: number; r: number };
    const right = Math.round(first.r * size * 0.5);
    expect(texel(first.x + right, first.y)[0]).toBeGreaterThan(128);
    expect(texel(first.x - right, first.y)[0]).toBeLessThan(128);
    expect(texel(first.x, first.y + right)[1]).toBeGreaterThan(128);
    expect(texel(first.x, first.y - right)[1]).toBeLessThan(128);
    for (const d of drops) {
      const [, , b, a] = texel(d.x, d.y - Math.round(d.r * size) - 2) as [number, number, number, number];
      expect(b > 0 || a > 0).toBe(true);
    }
    // A drop centred at (40, 29) with radius 0.0275 (3.5 texels): seven rows
    // under it the trail is still strong, six rows over it there is none.
    expect(drops.some((d) => d.x === 40 && d.y === 29)).toBe(true);
    expect(texel(40, 22)[3]).toBe(154);
    expect(texel(40, 35)[3]).toBe(0);
  });
});

describe("smoothstep", () => {
  it("steps between its edges in either order", () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0.1, -0.5, 0.1)).toBe(0);
    expect(smoothstep(0.1, -0.5, -0.5)).toBe(1);
    expect(smoothstep(0.1, -0.5, 1)).toBe(0);
    expect(smoothstep(0.1, -0.5, -1)).toBe(1);
  });
});

describe("lensStrengthUnder", () => {
  it("is nothing without rain", () => {
    expect(lensStrengthUnder(0, -1, 0)).toBe(0);
    expect(lensStrengthUnder(0, 0, 0)).toBe(0);
  });

  it("is full looking up into the rain, a quarter looking down, and 11/36 looking ahead", () => {
    expect(lensStrengthUnder(1, -0.5, 0)).toBe(1);
    expect(lensStrengthUnder(1, -1.5, 0)).toBe(1);
    expect(lensStrengthUnder(1, 0.1, 0)).toBe(0.25);
    expect(lensStrengthUnder(1, 1.5, 0)).toBe(0.25);
    expect(lensStrengthUnder(1, 0, 0)).toBeCloseTo(0.3055555555555556, 12);
  });

  it("scales with the rain, clamped, and the canopy keeps 65 percent off the glass", () => {
    expect(lensStrengthUnder(0.5, -0.5, 0)).toBe(0.5);
    expect(lensStrengthUnder(2, -0.5, 0)).toBe(1);
    expect(lensStrengthUnder(1, -0.5, 1)).toBeCloseTo(0.35, 12);
    expect(lensStrengthUnder(1, -0.5, 2)).toBeCloseTo(0.35, 12);
    expect(lensStrengthUnder(1, -0.5, 0.5)).toBeCloseTo(0.675, 12);
    expect(lensStrengthUnder(1, 0, 1)).toBeCloseTo(0.10694444444444445, 12);
  });
});

describe("lensSmooth", () => {
  it("covers 1 - 1/e of the gap in one time constant, in either direction", () => {
    expect(lensSmooth(0, 1, 1)).toBeCloseTo(0.6321205588285577, 12);
    expect(lensSmooth(1, 0, 1)).toBeCloseTo(0.36787944117144233, 12);
    expect(lensSmooth(0.2, 0.2, 1)).toBeCloseTo(0.2, 12);
  });

  it("stands still over no time and is within a percent after five seconds", () => {
    expect(lensSmooth(0.3, 1, 0)).toBe(0.3);
    expect(lensSmooth(0, 1, 5)).toBeCloseTo(0.9932620530009145, 12);
    let s = 0;
    for (let i = 0; i < 300; i++) s = lensSmooth(s, 1, 1 / 60);
    expect(s).toBeCloseTo(0.9932620530009145, 6);
  });
});
