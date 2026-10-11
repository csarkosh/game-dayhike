import { describe, it, expect } from "vitest";
import { lakeOf } from "../sim/helpers/lakes.js";
import {
  SAPLING_MODEL_HEIGHT, SKYLINE_CROWN, SKYLINE_EYE_UP, SKYLINE_REACH, SKYLINE_RIM_DIRECTIONS, SKYLINE_RIM_MARGIN, SKYLINE_RIM_STEP,
  SKYLINE_SHADE, SKYLINE_STEP, SKYLINE_TEXELS, SNAG_MODEL_HEIGHT,
  cylinderHit, lakeRimRadii, rimAt, skylineElevations, skylineTrees,
} from "../../src/game/lakeSkyline.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** Room-12's world: its murky lake, level 32.26 at (−118.0, −243.1), its mean radius 34.9 m. */
const SEED = -1458473702;

describe("the skyline's constants", () => {
  it("are the design's literals", () => {
    expect(SKYLINE_TEXELS).toBe(512);
    expect(SKYLINE_RIM_MARGIN).toBe(8);
    expect(SKYLINE_REACH).toBe(60);
    expect(SKYLINE_EYE_UP).toBe(0.4);
    expect(SKYLINE_STEP).toBe(2);
    expect(SKYLINE_CROWN).toBe(0.25);
    expect(SKYLINE_SHADE).toBe(0.15);
    expect(SKYLINE_RIM_DIRECTIONS).toBe(64);
    expect(SKYLINE_RIM_STEP).toBe(2);
    expect(SAPLING_MODEL_HEIGHT).toEqual([8.86, 10.51, 4.72]);
    expect(SNAG_MODEL_HEIGHT).toBe(4.05);
  });
});

describe("the lake's rim by azimuth (lakeRimRadii)", () => {
  it("is the stadium's own shore in each direction, to the outline's 2 m march", () => {
    // 15 m about a spine from z = −10 to 10: 25 m along it, 15 m across, and
    // on the diagonal the cap of 15 m about (0, 10) at t² − 10√2 t − 125 = 0, t = 20.2998.
    const r = lakeRimRadii(stadiumShape({ cx: 0, cz: 0, halfLen: 10, w: 15 }));
    expect(r).toHaveLength(64);
    expect(r[0]).toBeCloseTo(25, 1);
    expect(r[8]).toBeCloseTo(20.2998, 1);
    expect(r[16]).toBeCloseTo(15, 9);
    expect(r[32]).toBeCloseTo(25, 1);
    expect(r[48]).toBeCloseTo(15, 9);
  });

  it("takes the farthest crossing on a ray, and 0 where a ray meets no shore", () => {
    // A V of 5 m half-width, its arms from (0, 0) to (±20, 20), seen from
    // (0, 10) between them: due +x the ray enters the east arm near x = 2.9
    // and leaves it where 5 − smin(d₁, d₂, 2.5) = 0 with d₂ = (x − 10)/√2 and
    // d₁ = √(x² + 100), x = 17.219; due +z it runs up between the arms.
    const v = { ...stadiumShape({ cx: 0, cz: 10, halfLen: 0.5, w: 5 }), px: [-20, 0, 20], pz: [20, 0, 20], width: [5, 5, 5], shoreMax: 28 };
    const r = lakeRimRadii(v);
    expect(r[16]).toBeCloseTo(17.219, 2);
    expect(r[48]).toBeCloseTo(17.219, 2);
    expect(r[0]).toBe(0);
  });

  it("reads between two directions linearly, round the turn", () => {
    const ramp = Float64Array.from({ length: 64 }, (_, k) => k);
    expect(rimAt(ramp, (2 * Math.PI * 10.25) / 64)).toBeCloseTo(10.25, 9);
    expect(rimAt(ramp, (2 * Math.PI * 63.5) / 64)).toBeCloseTo(31.5, 9);
    expect(rimAt(ramp, (-2 * Math.PI * 0.5) / 64)).toBeCloseTo(31.5, 9);
  });
});

describe("the murky lake's skyline", { timeout: timeLimit(60_000) }, () => {
  it("collects the standing trees between the rim and the reach past it from the forest's placement", () => {
    const lake = lakeOf(SEED);
    const trees = skylineTrees(lake, SEED);
    expect(trees.length).toBe(85);
    const rims = lakeRimRadii(lake.shape);
    for (const t of trees) {
      const d = Math.hypot(t.x - lake.x, t.z - lake.z);
      const rim = rimAt(rims, Math.atan2(t.x - lake.x, t.z - lake.z));
      expect(d).toBeLessThanOrEqual(rim + SKYLINE_RIM_MARGIN + SKYLINE_REACH);
      // No tree stands within 8 m of the shore, so none within 8 m past the rim.
      expect(d).toBeGreaterThan(rim + 8);
      expect(t.height).toBeGreaterThan(0);
    }
    expect(Math.max(...trees.map((t) => t.height))).toBeCloseTo(86.33568609272481, 9);
    expect(Math.min(...trees.map((t) => t.height))).toBeCloseTo(8.163505300609927, 9);
  });

  it("is 512 texels, every one finite and within 0..π/2", () => {
    const lake = lakeOf(SEED);
    const e = skylineElevations(lake, SEED, skylineTrees(lake, SEED));
    expect(e).toBeInstanceOf(Float32Array);
    expect(e.length).toBe(512);
    for (let i = 0; i < e.length; i++) {
      expect(Number.isFinite(e[i]!), `texel ${i}`).toBe(true);
      expect(e[i]!).toBeGreaterThanOrEqual(0);
      expect(e[i]!).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it("is the terrain's alone with no trees, and the trees' over it with them, at the four quarters", () => {
    const lake = lakeOf(SEED);
    const bare = skylineElevations(lake, SEED, []);
    expect(bare[0]!).toBeCloseTo(0.1316964328289032, 6);
    expect(bare[128]!).toBeCloseTo(0.3035212755203247, 6);
    expect(bare[256]!).toBeCloseTo(0.011715839616954327, 6);
    expect(bare[384]!).toBeCloseTo(0.001810892135836184, 6);
    const full = skylineElevations(lake, SEED, skylineTrees(lake, SEED));
    expect(full[0]!).toBeCloseTo(0.7352286577224731, 6);
    expect(full[128]!).toBeCloseTo(0.5406519770622253, 6);
    expect(full[256]!).toBeCloseTo(0.4832390546798706, 6);
    expect(full[384]!).toBeCloseTo(0.7403349280357361, 6);
    for (let i = 0; i < 512; i++) expect(full[i]!).toBeGreaterThanOrEqual(bare[i]!);
  });

  it("stands one tree as a cone about its azimuth, wrapping past texel 0", () => {
    const lake = lakeOf(SEED);
    // A 40 m tree 30 m past the rim on texel 0's azimuth.
    const a0 = (2 * Math.PI * 0.5) / 512;
    const d = rimAt(lakeRimRadii(lake.shape), a0) + 30;
    const tree = { x: lake.x + Math.sin(a0) * d, z: lake.z + Math.cos(a0) * d, height: 40 };
    const bare = skylineElevations(lake, SEED, []);
    const one = skylineElevations(lake, SEED, [tree]);
    // Its top: the ground under it (40.62) + 40 over the eye (32.66), 69.66 m out.
    expect(one[0]!).toBeCloseTo(0.6029474139213562, 6);
    expect(one[1]!).toBeCloseTo(0.5688751339912415, 6);
    expect(one[8]!).toBeCloseTo(0.2864096462726593, 6);
    expect(one[511]!).toBeCloseTo(0.5688751339912415, 6);
    // Past its crown's half-width the terrain shows again.
    expect(one[16]!).toBe(bare[16]!);
    expect(one[490]!).toBe(bare[490]!);
  });

  it("leaves out a tree inside the rim or past the reach", () => {
    const lake = lakeOf(SEED);
    const bare = skylineElevations(lake, SEED, []);
    const rim = lakeRimRadii(lake.shape)[0]!;
    const inside = { x: lake.x, z: lake.z + rim - 1, height: 80 };
    const beyond = { x: lake.x, z: lake.z + rim + SKYLINE_RIM_MARGIN + SKYLINE_REACH + 1, height: 80 };
    expect(Array.from(skylineElevations(lake, SEED, [inside, beyond]))).toEqual(Array.from(bare));
  });
});

describe("cylinderHit", () => {
  /** The murky lake, rounded. */
  const CX = -97.4, CZ = 324, R = 26.1, LEVEL = 50.79;

  it("meets the shore at the level for a ray straight out from the centre, its u by azimuth", () => {
    const o = [CX, LEVEL, CZ] as const;
    const cases: [readonly [number, number, number], number][] = [
      [[0, 0, 1], 0], [[1, 0, 0], 0.25], [[0, 0, -1], 0.5], [[-1, 0, 0], 0.75],
    ];
    for (const [dir, u] of cases) {
      const hit = cylinderHit(o, dir, CX, CZ, R, LEVEL)!;
      expect(hit.u, `${dir}`).toBeCloseTo(u, 12);
      expect(hit.height).toBeCloseTo(0, 12);
    }
  });

  it("meets it a radius up for a ray at 45° from the centre", () => {
    const s = Math.SQRT1_2;
    const hit = cylinderHit([CX, LEVEL, CZ], [0, s, s], CX, CZ, R, LEVEL)!;
    expect(hit.u).toBeCloseTo(0, 12);
    expect(hit.height).toBeCloseTo(26.1, 9);
    const up30 = cylinderHit([CX, LEVEL, CZ], [Math.cos(Math.PI / 6), 0.5, 0], CX, CZ, R, LEVEL)!;
    expect(up30.u).toBeCloseTo(0.25, 12);
    expect(up30.height).toBeCloseTo(15.06884202584923, 9);
  });

  it("from off the centre, meets the far shore where the ray leaves the cylinder", () => {
    const hit = cylinderHit([CX + 10, LEVEL, CZ], [0, 0, 1], CX, CZ, R, LEVEL)!;
    expect(hit.u).toBeCloseTo(0.06257896375621569, 12);
    expect(hit.height).toBeCloseTo(0, 12);
    // From the disc's margin past the rim, pointing inward and up: across to the far side.
    const d = [-Math.cos(0.1), Math.sin(0.1), 0] as const;
    const across = cylinderHit([CX + R + 0.5, LEVEL, CZ], d, CX, CZ, R, LEVEL)!;
    expect(across.u).toBeCloseTo(0.75, 12);
    expect(across.height).toBeCloseTo(5.287637218903244, 9);
  });

  it("is null for a ray that never leaves the cylinder ahead", () => {
    // Straight up from the centre.
    expect(cylinderHit([CX, LEVEL, CZ], [0, 1, 0], CX, CZ, R, LEVEL)).toBeNull();
    // From the margin past the rim, pointing outward and up.
    expect(cylinderHit([CX + R + 0.5, LEVEL, CZ], [Math.cos(0.3), Math.sin(0.3), 0], CX, CZ, R, LEVEL)).toBeNull();
    // From the margin past the rim, pointing along it and passing it by.
    expect(cylinderHit([CX + R + 0.5, LEVEL, CZ], [0, 0.6, 0.8], CX, CZ, R, LEVEL)).toBeNull();
  });
});
