import { afterEach, beforeEach, describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { groundSpawn, ringSample, spiralSpawn } from "../../src/sim/spawn.js";
import {
  DEFAULT_TERRAIN_VARIANT,
  elevationSampleAt,
  setActiveTerrainVariant,
  terrainVariant,
} from "../../src/sim/terrain.js";
import "../../src/sim/olympic.js";
import { depenetrate } from "../../src/sim/collision.js";
import { ENEMY_MIN_SPAWN_DISTANCE, PLAYER_HALF } from "../../src/sim/constants.js";
import type { BoxProvider } from "../../src/sim/boxSource.js";
import type { Vec3 } from "../../src/sim/types.js";

const SEED = 0x5a4a7;

/** Nothing about a spawn is valid if the first tick has to shove it somewhere. */
function needsNoDepenetration(p: Vec3, provider: BoxProvider): boolean {
  const fixed = depenetrate(p, PLAYER_HALF, provider);
  return (
    Math.abs(fixed.x - p.x) < 1e-9 &&
    Math.abs(fixed.y - p.y) < 1e-9 &&
    Math.abs(fixed.z - p.z) < 1e-9
  );
}

describe("groundSpawn", () => {
  afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  it("places a hull that the movement code will not have to move", () => {
    const grid = createChunkGrid(SEED);
    const p = groundSpawn(grid, SEED, 3.5, -7.5, PLAYER_HALF);
    expect(p).not.toBeNull();
    expect(needsNoDepenetration(p as Vec3, grid)).toBe(true);
  });

  it("rejects a point occupied by geometry", () => {
    // This used to hunt for a trunk to stand inside. Pass 6 emits trunk props
    // again, but the obstacle is still supplied here instead of found — the code
    // path under test is `groundSpawn` returning null, which the director and
    // `pickRespawn` both depend on, and a stubbed slab pins that behaviour
    // regardless of where the tree field happens to put trunks. Validation is by
    // depenetrate rather than by inspecting geometry, because that is the exact
    // test the first movement tick applies.
    const grid = createChunkGrid(SEED);
    const X = 3.5;
    const Z = -7.5;

    const clear = groundSpawn(grid, SEED, X, Z, PLAYER_HALF);
    expect(clear).not.toBeNull();

    // A slab straddling the hull the spawn would place, and nothing else — so a
    // rejection can only have come from this box.
    const y = (clear as Vec3).y;
    const blocked: BoxProvider = {
      near: (min, max) => {
        const box = {
          min: { x: X - 2, y: y - PLAYER_HALF.y, z: Z - 2 },
          max: { x: X + 2, y: y + PLAYER_HALF.y, z: Z + 2 },
        };
        const overlaps =
          box.min.x < max.x &&
          box.max.x > min.x &&
          box.min.y < max.y &&
          box.max.y > min.y &&
          box.min.z < max.z &&
          box.max.z > min.z;
        return overlaps ? [box] : [];
      },
    };
    expect(groundSpawn(blocked, SEED, X, Z, PLAYER_HALF)).toBeNull();
  });

  it("places the hull exactly on the field, at any slope", () => {
    // This replaces the old `fieldToColumnMargin` test. That margin existed
    // only to lift a spawn clear of the quantized collision columns, which
    // could sit up to HEIGHT_QUANTUM/2 + slope*TERRAIN_CELL/2 above the field —
    // enough that placing a hull at the field height buried it about half the
    // time and `depenetrate` rejected roughly 65% of otherwise-valid points.
    // With the ground now the field itself there is nothing to clear, and the
    // weaker "somewhere within a margin" property becomes an exact one.
    //
    // Pinned to montane, and to points hunted down on montane: the default
    // olympic variant is too gentle at these coordinates to exercise slope.
    setActiveTerrainVariant("montane");
    const seed = 0xf1;
    const grid = createChunkGrid(seed);

    // Gentle, moderate and genuinely steep, so a slope-dependent regression
    // cannot hide in samples that are all nearly flat.
    const samples: Array<[number, number]> = [
      [3.5, -7.5],
      [142.5, 180],
      [-172.5, -75],
      [285, -67.5],
      [-1882.5, -3037],
      [-2919, -3204],
    ];

    let checked = 0;
    let steepest = 0;
    for (const [x, z] of samples) {
      const p = groundSpawn(grid, seed, x, z, PLAYER_HALF);
      if (p === null) continue;
      checked++;

      const s = elevationSampleAt(seed, x, z);
      steepest = Math.max(steepest, Math.sqrt(s.dx * s.dx + s.dz * s.dz));
      expect(Math.abs(p.y - PLAYER_HALF.y - s.h)).toBeLessThan(1e-9);
    }

    // Without these the loop above could skip every sample and prove nothing,
    // and a set of uniformly gentle points would never exercise slope at all.
    expect(checked).toBeGreaterThan(0);
    expect(steepest).toBeGreaterThan(1);
  });
});

describe("spawn freeboard", () => {
  afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  it("rejects underwater columns on the olympic variant and allows dry ones", () => {
    setActiveTerrainVariant("olympic");
    // x = −2000 is open ocean for every warp value: seabed ≈ −25 m.
    expect(groundSpawn([], 0x5eed, -2000, 0.5, PLAYER_HALF)).toBeNull();
    // x = +2000 is deep inland: montane ground, min measured +12 m.
    expect(groundSpawn([], 0x5eed, 2000, 0.5, PLAYER_HALF)).not.toBeNull();
  });

  it("skips the check when the variant declares no water", () => {
    // montane has no waterLevel; a below-zero surface would still be legal.
    // Pinned explicitly — this used to inherit montane from the default and
    // then from the previous test's cleanup, both of which are gone.
    setActiveTerrainVariant("montane");
    expect(groundSpawn([], 0x5eed, 2000, 0.5, PLAYER_HALF)).not.toBeNull();
  });
});

describe("spiralSpawn", () => {
  // Pins the default variant explicitly rather than inheriting the neighbouring describes' cleanup.
  beforeEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

  // An explicit timeout (2026-09-11): each of
  // these five grids builds its world, and `bowlFor` costs 433 ms a seed now
  // that loops actually route (230 ms before, 190 before that) —
  // over vitest's 5 s default once the whole suite is competing for the CPU.
  it("always finds somewhere valid", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const grid = createChunkGrid(seed);
      const p = spiralSpawn(grid, seed, PLAYER_HALF);
      expect(needsNoDepenetration(p, grid)).toBe(true);
    }
  }, 30000);

  it("is identical for identical seeds, so every peer agrees without a message", () => {
    const a = spiralSpawn(createChunkGrid(SEED), SEED, PLAYER_HALF);
    const b = spiralSpawn(createChunkGrid(SEED), SEED, PLAYER_HALF);
    expect(a).toEqual(b);
  });

  it("stays near the origin", () => {
    const p = spiralSpawn(createChunkGrid(SEED), SEED, PLAYER_HALF);
    expect(Math.sqrt(p.x * p.x + p.z * p.z)).toBeLessThan(64);
  });
});

describe("ringSample", () => {
  it("returns points inside the annulus", () => {
    const rng = { rngSeed: 12345 };
    const around = { x: 10, y: 0, z: -4 };
    let found = 0;
    for (let i = 0; i < 200; i++) {
      const p = ringSample(rng, around, 15, 25);
      if (p === null) continue;
      found++;
      const d = Math.sqrt((p.x - around.x) ** 2 + (p.z - around.z) ** 2);
      expect(d).toBeGreaterThanOrEqual(15);
      expect(d).toBeLessThanOrEqual(25);
    }
    // Rejection sampling a square for an annulus accepts about half the time per
    // attempt, and each call gets eight attempts, so nearly every call succeeds.
    expect(found).toBeGreaterThan(180);
  });

  it("can reach outside ENEMY_DETECT_RANGE for the director's use", () => {
    const rng = { rngSeed: 777 };
    let beyondDetect = 0;
    for (let i = 0; i < 200; i++) {
      const p = ringSample(rng, { x: 0, y: 0, z: 0 }, ENEMY_MIN_SPAWN_DISTANCE, 35);
      if (p === null) continue;
      if (Math.sqrt(p.x * p.x + p.z * p.z) >= ENEMY_MIN_SPAWN_DISTANCE) beyondDetect++;
    }
    expect(beyondDetect).toBeGreaterThan(150);
  });

  it("advances the shared stream deterministically", () => {
    // No trigonometry: a random bearing would need Math.cos/sin, which are
    // implementation-defined and would place enemies differently per browser.
    const a = { rngSeed: 99 };
    const b = { rngSeed: 99 };
    expect(ringSample(a, { x: 0, y: 0, z: 0 }, 5, 10)).toEqual(
      ringSample(b, { x: 0, y: 0, z: 0 }, 5, 10),
    );
    expect(a.rngSeed).toBe(b.rngSeed);
  });

  it("consumes the stream even when it fails, so callers cannot livelock", () => {
    // An impossible annulus must still terminate and still advance the seed, or a
    // director retrying every tick would draw the same rejected point forever.
    const rng = { rngSeed: 5 };
    const before = rng.rngSeed;
    expect(ringSample(rng, { x: 0, y: 0, z: 0 }, 100, 100.0001)).toBeNull();
    expect(rng.rngSeed).not.toBe(before);
  });
});

describe("spiralSpawn with a centre (trailhead)", () => {
  it("lands on the trailhead flat, above the freeboard", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const v = terrainVariant("olympic")!;
    for (const seed of [0x5eed, 1, 12345]) {
      const th = v.trailGraph!(seed).trailhead;
      const grid = createChunkGrid(seed);
      const p = spiralSpawn(grid, seed, PLAYER_HALF, { x: th.x, z: th.z });
      expect(Math.abs(p.x - th.x)).toBeLessThan(12);
      expect(Math.abs(p.z - th.z)).toBeLessThan(12);
      const s = elevationSampleAt(seed, p.x, p.z);
      expect(Math.abs(s.dx) + Math.abs(s.dz)).toBeLessThan(0.05); // on the flat
      expect(needsNoDepenetration(p, grid)).toBe(true);
    }
  });
});
