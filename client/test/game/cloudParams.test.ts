import { describe, it, expect } from "vitest";
import {
  CLOUD_CHASE_DENSITY, CLOUD_GROUND_SIZE, CLOUD_GROUND_SPAN, CLOUD_HAUNT_HEIGHT_M, CLOUD_HEIGHT_M, CLOUD_NIGHT_DENSITY, CLOUD_NOISE_SIZE, cloudColourUnder,
  cloudDensityUnder, cloudGroundMap, cloudHeightUnder, cloudNoiseMap,
} from "../../src/game/cloudParams.js";

describe("the ground cloud's density", () => {
  it("is the night's with no haunt on, lifted by the haunt, the chase's by its cast, and nothing by day", () => {
    expect(cloudDensityUnder(0, 1, 1)).toBe(0);
    expect(cloudDensityUnder(1, 0, 0)).toBeCloseTo(CLOUD_NIGHT_DENSITY, 9);
    expect(cloudDensityUnder(1, 1, 0)).toBeGreaterThan(CLOUD_NIGHT_DENSITY);
    expect(cloudDensityUnder(1, 1, 0)).toBeLessThan(CLOUD_CHASE_DENSITY);
    expect(cloudDensityUnder(1, 0, 1)).toBeCloseTo(CLOUD_CHASE_DENSITY, 9);
    expect(cloudDensityUnder(0.5, 0, 0)).toBeCloseTo(CLOUD_NIGHT_DENSITY * 0.5, 9);
  });
});

describe("the cloud's height", () => {
  it("stands taller with the haunt, from its own height to that plus the haunt's", () => {
    expect(cloudHeightUnder(0)).toBe(CLOUD_HEIGHT_M);
    expect(cloudHeightUnder(1)).toBe(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M);
    expect(cloudHeightUnder(0.5)).toBeCloseTo(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M / 2, 9);
    expect(cloudHeightUnder(3)).toBe(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M);
  });
});

describe("the cloud's colour", () => {
  it("is the air's near colour pulled toward grey and lifted", () => {
    const c = cloudColourUnder({ r: 0.1, g: 0.2, b: 0.4 });
    // Less saturated than the air, and brighter in sum.
    expect(c.b - c.r).toBeLessThan(0.3 * 1.35);
    expect(c.r + c.g + c.b).toBeGreaterThan(0.7);
    const grey = cloudColourUnder({ r: 0.2, g: 0.2, b: 0.2 });
    expect(grey.r).toBeCloseTo(grey.g, 9);
    expect(grey.g).toBeCloseTo(grey.b, 9);
  });
});

describe("the cloud's noise", () => {
  it("is RGBA8 of its size, each channel spanning 0 to 255, tiling at its edges, and the two channels differ", () => {
    const n = cloudNoiseMap();
    expect(n.length).toBe(CLOUD_NOISE_SIZE * CLOUD_NOISE_SIZE * 4);
    for (const ch of [0, 1]) {
      let lo = 255, hi = 0;
      for (let i = 0; i < CLOUD_NOISE_SIZE * CLOUD_NOISE_SIZE; i++) {
        lo = Math.min(lo, n[i * 4 + ch]!);
        hi = Math.max(hi, n[i * 4 + ch]!);
      }
      expect(lo).toBe(0);
      expect(hi).toBe(255);
    }
    // Tiling: the last column is close to the first (the lattice wraps), never a seam.
    const S = CLOUD_NOISE_SIZE;
    let seam = 0;
    for (let y = 0; y < S; y++) seam += Math.abs(n[(y * S + S - 1) * 4]! - n[(y * S) * 4]!);
    expect(seam / S).toBeLessThan(24);
    let differ = 0;
    for (let i = 0; i < S * S; i++) if (Math.abs(n[i * 4]! - n[i * 4 + 1]!) > 8) differ++;
    expect(differ).toBeGreaterThan((S * S) / 2);
    for (let i = 0; i < S * S; i++) expect(n[i * 4 + 3]).toBe(255);
  });
});

describe("the ground map", () => {
  it("samples the ground over its span round a centre, the lowest at 0 and the highest at 255, with its base and range", () => {
    const ground = (x: number, z: number) => 0.1 * x + 0.05 * z + 3;
    const g = cloudGroundMap(ground, 100, -50);
    expect(g.data.length).toBe(CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE * 4);
    expect(g.centreX).toBe(100);
    expect(g.centreZ).toBe(-50);
    const half = CLOUD_GROUND_SPAN / 2, cell = CLOUD_GROUND_SPAN / CLOUD_GROUND_SIZE;
    const lo = ground(100 - half + cell / 2, -50 - half + cell / 2);
    const hi = ground(100 + half - cell / 2, -50 + half - cell / 2);
    expect(g.base).toBeCloseTo(lo, 9);
    expect(g.range).toBeCloseTo(hi - lo, 9);
    expect(g.data[0]).toBe(0);
    expect(g.data[(CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE - 1) * 4]).toBe(255);
    // The middle of the map is the centre's height, to the byte.
    const mid = (CLOUD_GROUND_SIZE / 2) * CLOUD_GROUND_SIZE + CLOUD_GROUND_SIZE / 2;
    const expected = ((ground(100 + cell / 2, -50 + cell / 2) - lo) / (hi - lo)) * 255;
    expect(Math.abs(g.data[mid * 4]! - expected)).toBeLessThanOrEqual(1);
    // Flat ground: a range of at least 1 m, so the shader never divides a step by nothing.
    expect(cloudGroundMap(() => 7, 0, 0).range).toBe(1);
    // With no trail, every place is off it (A 255); with one, the alpha is 0 on it and rises to 255 beyond its edge's fade.
    expect(g.data[3]).toBe(255);
    const t = cloudGroundMap(() => 0, 0, 0, (x) => Math.abs(x));
    const col = (x: number) => Math.round(((x + CLOUD_GROUND_SPAN / 2) / CLOUD_GROUND_SPAN) * CLOUD_GROUND_SIZE - 0.5);
    const row = CLOUD_GROUND_SIZE / 2;
    const alphaAt = (x: number) => t.data[(row * CLOUD_GROUND_SIZE + col(x)) * 4 + 3]!;
    expect(alphaAt(0)).toBeLessThan(5);
    expect(alphaAt(2)).toBeGreaterThan(0);
    expect(alphaAt(2)).toBeLessThan(255);
    expect(alphaAt(20)).toBe(255);
  });
});
