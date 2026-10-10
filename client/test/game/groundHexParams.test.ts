import { describe, it, expect } from "vitest";
import {
  HEX_LATTICE, HEX_SHARPNESS, DETAIL_TILING, DETAIL_FADE, DETAIL_NORMAL, DETAIL_AO, DETAIL_AO_RANGE,
  MACRO_WAVE, MACRO_WEIGHT, MACRO_SLOPE, MACRO_LUSH, MACRO_DRY, TUFT_ALBEDO, HORIZON, HORIZON_MAX,
  SWARD_FLOOR, SWARD_MAX, SWARD_COVER, SWARD_FADE,
  HEX_SKEW, HEX_UNSKEW,
  latticeHash, hexTriangle, hexWeights, macroNoise, macroTint, horizonWeight, swardWeight,
  FAR_COVER_BAND, FAR_COVER_BAND_LOW, FAR_SWARD_COVER, FAR_SWARD_MAX, FAR_SWARD, FAR_LITTER, FAR_CANOPY_SHADE,
  FAR_CLUMP_CELL, FAR_CLUMP_WEIGHT, FAR_CLUMP_SALT, FAR_CLUMP_WRAP, FAR_CLUMP_AO, FAR_CLUMP_TILT,
  FAR_COVER_TILT, FAR_SELF_SHADOW, FAR_SUN_GAIN_MAX, FAR_SPEC_CUT,
  farCoverWeight, farClumpOctave, farClump, farCoverTarget, farSunFactor, farSpecWeight,
} from "../../src/game/groundHexParams.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("constants are the spec's", () => {
  it("carries the spec values", () => {
    expect(HEX_LATTICE).toBe(1);
    expect(HEX_SHARPNESS).toBe(8);
    expect(DETAIL_TILING).toBe(1.0);
    expect(DETAIL_FADE).toEqual([8, 20]);
    expect(DETAIL_NORMAL).toBe(0.5);
    expect(DETAIL_AO).toBe(0.7);
    expect(DETAIL_AO_RANGE).toEqual([0.3, 0.7]);
    expect(MACRO_WAVE).toEqual([18, 6]);
    expect(MACRO_WEIGHT).toEqual([0.65, 0.35]);
    expect(MACRO_SLOPE).toBe(0.6);
    expect(MACRO_LUSH).toEqual({ r: 0.82, g: 1.06, b: 0.84 });
    expect(MACRO_DRY).toEqual({ r: 1.18, g: 0.98, b: 0.7 });
    expect(TUFT_ALBEDO).toEqual({ r: 0.18, g: 0.22, b: 0.11 });
    expect(HORIZON).toEqual([35, 90]);
    expect(HORIZON_MAX).toBe(0.5);
    expect(HEX_SKEW).toEqual([1, 0, -0.57735027, 1.15470054]);
    expect(HEX_UNSKEW).toEqual([1, 0, 0.5, 0.8660254]);
  });
});

describe("latticeHash", () => {
  it("is in [0, 1) and differs between neighbouring cells", () => {
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) {
      const h = latticeHash(i, j);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(Math.abs(h - latticeHash(i + 1, j))).toBeGreaterThan(0.01);
      expect(Math.abs(h - latticeHash(i, j + 1))).toBeGreaterThan(0.01);
    }
  });
});

describe("hex lattice", () => {
  it("barycentric weights are non-negative and sum to one everywhere; sharpened weights too", () => {
    for (let y = -3; y < 3; y += 0.093) for (let x = -3; x < 3; x += 0.097) {
      const t = hexTriangle(x, y);
      expect(t.w[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.w[0] + t.w[1] + t.w[2]).toBeCloseTo(1, 9);
      const s = hexWeights(t.w);
      expect(s[0] + s[1] + s[2]).toBeCloseTo(1, 9);
    }
  });
  it("the three vertices are distinct lattice points and the point lies in their triangle (both branches)", () => {
    // Test both the fx + fy < 1 branch (lower half) and fx + fy >= 1 branch (upper half).
    const testPoints = [
      { uv: [0.3, 0.2] as const, expectedFirstVertex: [0, 0] as const },
      { uv: [0.8, 0.8] as const, expectedFirstVertex: [1, 1] as const },
    ];
    for (const test of testPoints) {
      const t = hexTriangle(test.uv[0], test.uv[1]);
      const keys = new Set(t.v.map(([a, b]) => `${a},${b}`));
      expect(keys.size).toBe(3);
      // Reconstruct the skewed point from the vertices and weights.
      const sx = t.v[0][0] * t.w[0] + t.v[1][0] * t.w[1] + t.v[2][0] * t.w[2];
      const sy = t.v[0][1] * t.w[0] + t.v[1][1] * t.w[1] + t.v[2][1] * t.w[2];
      expect(sx).toBeCloseTo(t.skewed[0], 9);
      expect(sy).toBeCloseTo(t.skewed[1], 9);
      // Explicitly assert which branch this point falls into by checking the first vertex.
      expect(t.v[0]).toEqual(test.expectedFirstVertex);
    }
  });
  it("sharpening keeps two samples dominant: the smallest weight vanishes away from a vertex", () => {
    const s = hexWeights([0.5, 0.4, 0.1]);
    expect(s[2]).toBeLessThan(0.001);
    expect(s[0]).toBeGreaterThan(s[1]);
  });
});

describe("macroNoise and macroTint", () => {
  it("is bounded in [0, 1] and continuous", () => {
    let last = macroNoise(0, 37.3);
    for (let x = 0; x < 200; x += 0.1) {
      const v = macroNoise(x, 37.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - last)).toBeLessThan(0.05);
      last = v;
    }
  });
  it("varies across a meadow: not constant over 100 m", () => {
    let lo = 1, hi = 0;
    for (let x = 0; x < 100; x += 2) for (let z = 0; z < 100; z += 2) {
      const v = macroNoise(x, z);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.4);
  });
  it("tint is exactly lush at 0 and dry at 1 on flat ground, and slope pushes toward dry", () => {
    expect(macroTint(0, 0)).toEqual(MACRO_LUSH);
    expect(macroTint(1, 0)).toEqual(MACRO_DRY);
    const flat = macroTint(0.3, 0);
    const steep = macroTint(0.3, 0.5);
    expect(steep.r).toBeGreaterThan(flat.r);
    expect(steep.b).toBeLessThan(flat.b);
  });
});

describe("horizonWeight", () => {
  it("is 0 inside HORIZON[0], HORIZON_MAX at and beyond HORIZON[1], smooth between", () => {
    expect(horizonWeight(10)).toBe(0);
    expect(horizonWeight(90)).toBeCloseTo(HORIZON_MAX, 10);
    expect(horizonWeight(200)).toBeCloseTo(HORIZON_MAX, 10);
    const mid = horizonWeight(62.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.3);
  });
});

describe("the sward floor", () => {
  it("pins the thatch colour, the pull and its bands", () => {
    expect(SWARD_FLOOR).toEqual({ r: 0.05, g: 0.065, b: 0.03 });
    expect(SWARD_MAX).toBe(0.6);
    expect(SWARD_COVER).toEqual([0.05, 0.5]);
    // Gone by the blade field's 18 m reach, so the open floor beyond is unchanged.
    expect(SWARD_FADE).toEqual([12, 18]);
  });

  it("pulls by the cover inside the reach and not at all past it", () => {
    expect(swardWeight(1, 5)).toBeCloseTo(0.6, 10);
    expect(swardWeight(0.5, 5)).toBeCloseTo(0.6, 10); // half cover is already full pull
    expect(swardWeight(0.275, 5)).toBeCloseTo(0.3, 10);
    expect(swardWeight(0.05, 5)).toBe(0); // where the blade field stops growing
    expect(swardWeight(0, 5)).toBe(0);
    expect(swardWeight(1, 15)).toBeCloseTo(0.3, 10);
    expect(swardWeight(1, 18)).toBe(0);
    expect(swardWeight(1, 40)).toBe(0);
  });
});

describe("the far cover", () => {
  it("carries the constants as literals", () => {
    expect(FAR_COVER_BAND).toEqual([24, 30]);
    expect(FAR_COVER_BAND_LOW).toEqual([14.4, 18]);
    expect(FAR_SWARD_COVER).toEqual([0.05, 0.5]);
    expect(FAR_SWARD_MAX).toBe(0.8);
    expect(FAR_CLUMP_CELL).toEqual([0.8, 3]);
    expect(FAR_CLUMP_WEIGHT).toEqual([0.6, 0.4]);
    expect(FAR_CLUMP_SALT).toEqual([41, 17]);
    expect(FAR_CLUMP_WRAP).toBe(97);
    expect(FAR_CLUMP_AO).toBe(0.65);
    expect(FAR_CLUMP_TILT).toBe(0.67);
    expect(FAR_COVER_TILT).toBe(0.3);
    expect(FAR_SUN_GAIN_MAX).toBe(2);
  }, timeLimit(5_000));

  it("carries the fitted values as literals", () => {
    expect(FAR_SWARD).toEqual({ r: 0.049, g: 0.081, b: 0.032 });
    expect(FAR_LITTER).toEqual({ r: 0.081, g: 0.057, b: 0.032 });
    expect(FAR_CANOPY_SHADE).toBe(0.5);
    expect(FAR_SELF_SHADOW).toBe(0.5);
    expect(FAR_SPEC_CUT).toBe(0.5);
  }, timeLimit(5_000));

  it("weighs any cover, grass or litter, over the band of eye distance", () => {
    expect(farCoverWeight(1, 0, 30)).toBe(1);
    expect(farCoverWeight(1, 0, 24)).toBe(0);
    expect(farCoverWeight(1, 0, 27)).toBeCloseTo(0.5, 10);
    expect(farCoverWeight(1, 0, 26)).toBe(0.25925925925925924);
    expect(farCoverWeight(0.275, 0, 40)).toBeCloseTo(0.5, 12);
    // Litter counts as cover.
    expect(farCoverWeight(0.2, 0.075, 40)).toBeCloseTo(0.5, 12);
    expect(farCoverWeight(0.03, 0.01, 40)).toBe(0);
    expect(farCoverWeight(1, 0, 18)).toBe(0);
  }, timeLimit(5_000));

  it("takes the low tier's band, at 0.6 of the distance", () => {
    expect(farCoverWeight(1, 0, 14.4, true)).toBe(0);
    expect(farCoverWeight(1, 0, 16.2, true)).toBeCloseTo(0.5, 12);
    expect(farCoverWeight(1, 0, 18, true)).toBe(1);
  }, timeLimit(5_000));

  it("leaves bare ground exactly as it was at every distance, and gives the reflection back as the ground wets", () => {
    // Rock, sand, pebbles, snow and a lake's bare shore carry neither grass
    // nor litter: no weight, so the sun's factor and the specular weight are
    // exactly 1 there and the wet line keeps its gloss.
    for (let d = 0; d <= 2000; d += 0.5) expect(farCoverWeight(0, 0, d), `${d} m`).toBe(0);
    expect(farSunFactor(0.3, 0.2, 0.1, 0)).toBe(1);
    expect(farSunFactor(0.716, 0.485, -0.848, 0)).toBe(1);
    expect(farSpecWeight(0, 0)).toBe(1);
    expect(farSpecWeight(0, 0.5)).toBe(1);
    expect(farSpecWeight(1, 1)).toBe(1);
  }, timeLimit(5_000));

  it("gives one octave's value and its gradient on the wrapped lattice", () => {
    // A lattice corner: the value is the hash of the salted cell, the gradient 0.
    const corner = farClumpOctave(0, 0, 0.8, [41, 17]);
    expect(corner.n).toBeCloseTo(0.708916, 9);
    expect(corner.gx).toBeCloseTo(0, 12);
    expect(corner.gz).toBeCloseTo(0, 12);
    const inside = farClumpOctave(1.0, 0.3, 0.8, [0, 0]);
    expect(inside.n).toBeCloseTo(0.41637451416015636, 12);
    expect(inside.gx).toBeCloseTo(-0.06973240429687515, 12);
    expect(inside.gz).toBeCloseTo(-0.6310102148437498, 12);
    // One repeat on: 97 cells of 0.8 m.
    const wrapped = farClumpOctave(1.0 + 97 * 0.8, 0.3, 0.8, [0, 0]);
    expect(wrapped.n).toBeCloseTo(0.41637451416015636, 12);
    expect(wrapped.gx).toBeCloseTo(-0.06973240429687515, 12);
    expect(wrapped.gz).toBeCloseTo(-0.6310102148437498, 12);
  }, timeLimit(5_000));

  it("has the gradient of its own value, in cell units", () => {
    const points: readonly [number, number, number, readonly [number, number]][] = [
      [1.0, 0.3, 0.8, [0, 0]],
      [-3.7, 12.2, 0.8, [0, 0]],
      [5.3, -8.1, 3, [41, 17]],
      [40.1, -77.7, 3, [41, 17]],
      [-123.4, 456.7, 0.8, [0, 0]],
    ];
    const h = 1e-6;
    for (const [x, z, cell, salt] of points) {
      const o = farClumpOctave(x, z, cell, salt);
      const gx = ((farClumpOctave(x + h, z, cell, salt).n - farClumpOctave(x - h, z, cell, salt).n) / (2 * h)) * cell;
      const gz = ((farClumpOctave(x, z + h, cell, salt).n - farClumpOctave(x, z - h, cell, salt).n) / (2 * h)) * cell;
      expect(Math.abs(o.gx - gx), `gx at ${x}, ${z}`).toBeLessThan(1e-4);
      expect(Math.abs(o.gz - gz), `gz at ${x}, ${z}`).toBeLessThan(1e-4);
    }
  }, timeLimit(5_000));

  it("agrees with float32 on every wrapped cell, which unwrapped cells far out do not, and repeats on negative ground", () => {
    // The GPU's latticeHash in float32, each product and sum rounded as it goes.
    const f = Math.fround;
    const hash32 = (ci: number, cj: number): number => {
      const s = f(f(f(f(0.618034) * f(ci)) + f(f(0.381966) * f(cj))) + f(f(f(0.0113) * f(ci)) * f(cj)));
      return s - Math.floor(s);
    };
    const apart = (ci: number, cj: number): number => {
      const d = Math.abs(hash32(ci, cj) - latticeHash(ci, cj));
      return Math.min(d, 1 - d);
    };
    let wrapped = 0;
    for (let i = 0; i < 97; i++) for (let j = 0; j < 97; j++) wrapped = Math.max(wrapped, apart(i, j));
    expect(wrapped).toBeLessThan(1e-4);
    let unwrapped = 0;
    for (let i = 900; i < 1000; i++) for (let j = 900; j < 1000; j++) unwrapped = Math.max(unwrapped, apart(i, j));
    expect(unwrapped).toBeGreaterThan(1e-3);
    // GLSL's mod on negative cells: the 0.8 m octave repeats every 77.6 m and
    // the 3 m octave every 291 m, on either side of the origin.
    const a = farClumpOctave(-1234.5, 2345.6, 0.8, [0, 0]);
    const b = farClumpOctave(-1234.5 + 20 * 97 * 0.8, 2345.6 - 30 * 97 * 0.8, 0.8, [0, 0]);
    expect(a.n).toBeCloseTo(0.20868857031249888, 9);
    expect(b.n).toBeCloseTo(0.20868857031249888, 9);
    expect(b.gx).toBeCloseTo(a.gx, 9);
    expect(b.gz).toBeCloseTo(a.gz, 9);
    const c = farClumpOctave(-5000.25, -7000.75, 3, [41, 17]);
    const d = farClumpOctave(-5000.25 + 20 * 291, -7000.75 + 25 * 291, 3, [41, 17]);
    expect(c.n).toBeCloseTo(0.4771544908854203, 9);
    expect(d.n).toBeCloseTo(0.4771544908854203, 9);
    expect(d.gx).toBeCloseTo(c.gx, 9);
    expect(d.gz).toBeCloseTo(c.gz, 9);
  }, timeLimit(5_000));

  it("fades both octaves to their mean under two pixels a cell, and keeps both whole above", () => {
    for (const [x, z] of [[1.0, 0.3], [-55.5, 12.25], [812.4, -97.1]] as const) {
      const gone = farClump(x, z, 3.0);
      expect(gone.n).toBe(0.5);
      expect(gone.gx).toBeCloseTo(0, 12);
      expect(gone.gz).toBeCloseTo(0, 12);
    }
    // At a 0.4 m footprint both cells span two pixels or more: the full weighted sum.
    const whole = farClump(1.0, 0.3, 0.4);
    expect(whole.n).toBeCloseTo(0.5120010921405388, 12);
    expect(whole.gx).toBeCloseTo(-0.14293256257812612, 12);
    expect(whole.gz).toBeCloseTo(-0.41139587290625057, 12);
  }, timeLimit(5_000));

  it("mixes the target from the sward and the litter, shaded by the canopy and darkened in the clumps' troughs", () => {
    const white = { r: 1, g: 1, b: 1 };
    const sward = farCoverTarget(0, 0, white, 1);
    expect(sward.r).toBeCloseTo(0.049, 12);
    expect(sward.g).toBeCloseTo(0.081, 12);
    expect(sward.b).toBeCloseTo(0.032, 12);
    // FAR_LITTER × (1 − FAR_CANOPY_SHADE).
    const litter = farCoverTarget(1, 1, white, 1);
    expect(litter.r).toBeCloseTo(0.0405, 12);
    expect(litter.g).toBeCloseTo(0.0285, 12);
    expect(litter.b).toBeCloseTo(0.016, 12);
    // FAR_SWARD × FAR_CLUMP_AO.
    const trough = farCoverTarget(0, 0, white, 0);
    expect(trough.r).toBeCloseTo(0.03185, 12);
    expect(trough.g).toBeCloseTo(0.05265, 12);
    expect(trough.b).toBeCloseTo(0.0208, 12);
    // Litter and canopy beyond 1 are clamped.
    const over = farCoverTarget(2, 2, white, 1);
    expect(over.r).toBeCloseTo(0.0405, 12);
    expect(over.g).toBeCloseTo(0.0285, 12);
    expect(over.b).toBeCloseTo(0.016, 12);
  }, timeLimit(5_000));

  it("answers the sun as the cards do: brighter with the sun behind the eye, darker with it ahead, capped where it grazes", () => {
    // The 29° sun behind the eye: gain 1.476, near-full hot spot.
    expect(farSunFactor(0.716, 0.485, 0.899, 1)).toBeCloseTo(1.4017360824742269, 9);
    // Ahead of the eye: the self-shadow alone.
    expect(farSunFactor(0.716, 0.485, -0.848, 1)).toBeCloseTo(0.7381443298969073, 9);
    // Grazing the ground: the gain capped at FAR_SUN_GAIN_MAX.
    expect(farSunFactor(0.37, 0.087, 0.9, 1)).toBeCloseTo(1.9, 12);
  }, timeLimit(5_000));

  it("cuts the specular weight by FAR_SPEC_CUT on dry ground and gives it back as the ground wets", () => {
    expect(farSpecWeight(1, 0)).toBeCloseTo(0.5, 12);
    // The mist preset's wetness, 0.5.
    expect(farSpecWeight(1, 0.5)).toBeCloseTo(0.75, 12);
    expect(farSpecWeight(0.5, 0.5)).toBeCloseTo(0.875, 12);
  }, timeLimit(5_000));
});
