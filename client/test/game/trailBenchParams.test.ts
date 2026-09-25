import { describe, expect, it } from "vitest";
import { valueNoise2, macroNoise, MACRO_WAVE, MACRO_WEIGHT } from "../../src/game/groundHexParams.js";
import { luma } from "../../src/game/colour.js";
import { NEEDLE_BED } from "../../src/game/terrainSurface.js";
import {
  TRAIL_JUNCTION_W, TRAIL_WEAR_WAVE, TRAIL_WEAR_WEIGHT, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1,
  TRAIL_EDGE_NOISE, TRAIL_EDGE_WAVE, TRAIL_EDGE_WEIGHT, TRAIL_HEIGHT_SHIFT,
  TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE,
  TRAIL_CORE_GAIN, TRAIL_CORE_TINT, TRAIL_MARGIN_GAIN, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT, TRAIL_BENCH_SHADE,
  TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE,
  TRAMPLE_HEIGHT, TRAMPLE_LEAN, TRAMPLE_TINT, TRAMPLE_BAND,
  TRAIL_DRIFT_BAND, TRAIL_DRIFT_TINT, TRAIL_DRIFT_LUM, TRAIL_WASH_WAVE, TRAIL_WASH_BAND, TRAIL_WASH_ROUGH, TRAIL_BED_EARTH,
  TRAIL_WASH_DARK_OPEN, TRAIL_WASH_DARK_LITTER, TRAIL_BED_FLOOR,
  valueNoise1, trailWear, trailEdgeNoise, trailBands, trampleAt,
  trailDriftWeight, trailWashoutNoise, trailWashoutWeight, trailPatches,
} from "../../src/game/trailBenchParams.js";

function smoothstepT(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

describe("constants", () => {
  it("are the spec's values", () => {
    expect(TRAIL_JUNCTION_W).toBe(1.35);
    expect(TRAIL_WEAR_WAVE).toEqual([12, 3]); expect(TRAIL_WEAR_WEIGHT).toEqual([0.6, 0.4]);
    expect([TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1]).toEqual([0.8, 1.25, 0.85, 1.1]);
    expect(TRAIL_EDGE_NOISE).toBe(0.25); expect(TRAIL_EDGE_WAVE).toEqual([1.5, 0.4]); expect(TRAIL_EDGE_WEIGHT).toEqual([0.6, 0.4]);
    expect(TRAIL_HEIGHT_SHIFT).toBe(0.3);
    expect([TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE]).toEqual([0.45, 0.75, 1.35, 0.08]);
    expect(TRAIL_CORE_GAIN).toBe(0.24); expect(TRAIL_CORE_TINT).toEqual({ r: 0.3, g: 0.26, b: 0.21 });
    expect(TRAIL_MARGIN_GAIN).toBe(0.47); expect(TRAIL_MARGIN_TINT).toEqual({ r: 0.4, g: 0.36, b: 0.3 });
    expect(TRAIL_TRAMPLE_TINT).toEqual({ r: 0.9, g: 0.88, b: 0.8 });
    expect(TRAIL_BENCH_SHADE).toBe(0.8);
    expect(TRAIL_BED_EARTH).toBe(0.7);
    expect(TRAIL_BED_FLOOR).toBe(0.75);
    expect([TRAIL_WET_DARK, TRAIL_WET_GLOSS]).toEqual([0.35, 0.5]);
    expect(TRAIL_PUDDLE_WET).toEqual([0.55, 0.8]); expect(TRAIL_PUDDLE_LOW).toEqual([0.62, 0.75]); expect(TRAIL_PUDDLE_WAVE).toBe(6);
    expect([TRAMPLE_HEIGHT, TRAMPLE_LEAN]).toEqual([0.73, 0.21]);
    // Weakened to 0.6 of its former strength { r: 0.85, g: 0.8, b: 0.65 }, the
    // same 0.6 TRAMPLE_HEIGHT and TRAMPLE_LEAN are already at: a tint's
    // strength is its distance from white, so 1 − 0.6 × (1 − c) per channel.
    expect(TRAMPLE_TINT).toEqual({ r: 0.91, g: 0.88, b: 0.79 });
    expect(TRAMPLE_BAND).toEqual([0.75, 1.6]);
  });
});

describe("the drift tint", () => {
  it("is NEEDLE_BED's own hue, scaled to the brightness the drift was tuned at", () => {
    // The drift rises with the floor paint, but not by the floor's full 1.5×:
    // at 0.77 the drifted bed measured 1.35× the litter floor beside it, and a
    // drift is the same litter as that floor. 0.66 measures 1.14×.
    expect(TRAIL_DRIFT_LUM).toBe(0.66);
    // The assertion that would have caught the drift tint carrying the
    // forest floor's hue instead of the needle bed's: same ratios, not just
    // the same brightness.
    expect(TRAIL_DRIFT_TINT.g / TRAIL_DRIFT_TINT.r).toBeCloseTo(NEEDLE_BED.g / NEEDLE_BED.r, 9);
    expect(TRAIL_DRIFT_TINT.b / TRAIL_DRIFT_TINT.r).toBeCloseTo(NEEDLE_BED.b / NEEDLE_BED.r, 9);
    const k = TRAIL_DRIFT_LUM / luma(NEEDLE_BED);
    expect(TRAIL_DRIFT_TINT.r).toBeCloseTo(NEEDLE_BED.r * k, 9);
    expect(TRAIL_DRIFT_TINT.g).toBeCloseTo(NEEDLE_BED.g * k, 9);
    expect(TRAIL_DRIFT_TINT.b).toBeCloseTo(NEEDLE_BED.b * k, 9);
    // The scale moves the tint back to the brightness it was judged at.
    expect(luma(TRAIL_DRIFT_TINT)).toBeCloseTo(TRAIL_DRIFT_LUM, 9);
  });
});

describe("noise", () => {
  it("macroNoise is the two-octave sum of valueNoise2", () => {
    for (const [x, z] of [[0, 0], [12.3, -45.6], [1000.5, 2000.25]] as const) {
      const expected = MACRO_WEIGHT[0] * valueNoise2(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise2(x, z, MACRO_WAVE[1]);
      expect(macroNoise(x, z)).toBeCloseTo(expected, 12);
    }
  });
  it("valueNoise1 and trailWear stay in [0, 1] and continuous", () => {
    let prev = trailWear(0);
    for (let u = 0; u <= 600; u += 0.1) {
      const w = trailWear(u);
      expect(w).toBeGreaterThanOrEqual(0); expect(w).toBeLessThanOrEqual(1);
      expect(Math.abs(w - prev)).toBeLessThan(0.05);
      prev = w;
      const n = valueNoise1(u, 3);
      expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1);
    }
  });
  it("the edge noise is bounded by TRAIL_EDGE_NOISE", () => {
    for (let i = 0; i < 400; i++) {
      const e = trailEdgeNoise(i * 0.37 - 70, i * 0.91 + 3);
      expect(Math.abs(e)).toBeLessThanOrEqual(TRAIL_EDGE_NOISE);
    }
  });
});

describe("bands and trampling", () => {
  it("partitions the shifted distance into core, margin and trampled with soft edges", () => {
    for (const d of [0, 0.3, 0.45, 0.6, 0.75, 1.0, 1.35, 1.5, 3]) {
      const b = trailBands(d);
      expect(b.core + b.margin + b.trample).toBeLessThanOrEqual(1 + 1e-9);
      for (const v of Object.values(b)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    expect(trailBands(0)).toEqual({ core: 1, margin: 0, trample: 0 });
    expect(trailBands(0.6)).toEqual({ core: 0, margin: 1, trample: 0 });
    expect(trailBands(1.0).trample).toBeGreaterThan(0.4);
    expect(trailBands(1.5)).toEqual({ core: 0, margin: 0, trample: 0 });
  });
  it("trampleAt reaches the constants at the bench edge and is the identity past the band", () => {
    expect(trampleAt(0)).toEqual({ height: 0.73, lean: 0.21, tint: TRAMPLE_TINT });
    const at = trampleAt(0.75);
    expect(at.height).toBeCloseTo(TRAMPLE_HEIGHT, 9); expect(at.lean).toBeCloseTo(TRAMPLE_LEAN, 9);
    expect(at.tint).toEqual(TRAMPLE_TINT);
    const far = trampleAt(1.6);
    expect(far).toEqual({ height: 1, lean: 0, tint: { r: 1, g: 1, b: 1 } });
    expect(trampleAt(Infinity)).toEqual(far);
    const mid = trampleAt(1.0);
    expect(mid.height).toBeGreaterThan(TRAMPLE_HEIGHT); expect(mid.height).toBeLessThan(1);
  });
});

describe("the neglect patches", () => {
  it("match the spec and rise only through their smoothsteps", () => {
    expect(TRAIL_DRIFT_BAND).toEqual([0.25, 0.7]);
    expect(TRAIL_WASH_WAVE).toBe(4);
    expect(TRAIL_WASH_BAND).toEqual([0.55, 0.8]);
    expect(TRAIL_WASH_DARK_OPEN).toBe(0.4);
    expect(TRAIL_WASH_DARK_LITTER).toBe(0.75);
    expect(TRAIL_WASH_ROUGH).toBe(1.15);
    expect(TRAIL_CORE_GAIN).toBe(0.24);
    expect(trailDriftWeight(0)).toBe(0);
    expect(trailDriftWeight(0.25)).toBe(0);
    expect(trailDriftWeight(0.7)).toBe(1);
    expect(trailDriftWeight(1)).toBe(1);
    let prev = 0;
    for (let d = 0; d <= 1; d += 0.01) { const w = trailDriftWeight(d); expect(w).toBeGreaterThanOrEqual(prev); expect(w - prev).toBeLessThan(0.05); prev = w; }
    for (const [x, z] of [[0, 0], [12.3, -7.7], [301, 118]] as const) {
      const n = trailWashoutNoise(x, z);
      expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1);
      expect(trailWashoutWeight(x, z)).toBe(smoothstepT(TRAIL_WASH_BAND[0], TRAIL_WASH_BAND[1], n));
    }
  });
  it("lets the wash-out win where both are high, and never sums past one", () => {
    // Find a point whose wash-out weight is high, then feed full duff.
    let found = false;
    for (let x = 0; x < 400 && !found; x += 0.5) {
      if (trailWashoutWeight(x, 3) > 0.9) {
        const p = trailPatches(1, x, 3);
        expect(p.wash).toBeGreaterThan(0.9);
        expect(p.drift).toBeLessThan(0.1);
        expect(p.drift + p.wash).toBeLessThanOrEqual(1 + 1e-12);
        found = true;
      }
    }
    expect(found).toBe(true);
    for (let x = 0; x < 100; x += 0.7) { const p = trailPatches(0.6, x, 9); expect(p.drift + p.wash).toBeLessThanOrEqual(1 + 1e-12); }
  });
});
