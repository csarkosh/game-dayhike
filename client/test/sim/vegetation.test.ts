import { describe, it, expect, afterEach } from "vitest";
import "../../src/sim/olympic.js";
import {
  forestDensity,
  forestDensityUnmasked,
  treeInCell,
  treesInRect,
  TREELINE_HI,
  TREELINE_LO,
  SLOPE_HI,
  SHORE_ALT,
  TREE_CELL,
  TREE_SCALE_MIN,
  VALLEY_SCALE_BOOST,
  VEGETATION_TUNABLES,
  COHORT_GIANT,
  COHORT_SAPLING,
  COHORT_SNAG,
  COHORT_LOG,
  GIANT_SCALE_MIN,
  GIANT_SCALE_MAX,
  SNAG_SHARE,
  LOG_SHARE,
  ROAD_CLEAR,
  ROAD_CLEAR_FADE,
} from "../../src/sim/vegetation.js";
import {
  DEFAULT_TERRAIN_VARIANT,
  activeTerrainVariant,
  elevationAt,
  setActiveTerrainVariant,
  terrainVariant,
} from "../../src/sim/terrain.js";
import { TRAIL_CLEAR } from "../../src/sim/trail.js";
import type { TerrainSample } from "../../src/sim/terrain.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { MEADOW_RIM } from "../../src/sim/features.js";

const SEED = 0x5eed;
const flat = (h: number, g = 0.1): TerrainSample => ({ h, dx: g, dz: 0 });
afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

describe("forestDensity gates (synthetic samples, both sides of every edge)", () => {
  it("is bounded in [0,1] across a sweep", () => {
    for (let i = 0; i < 200; i++) {
      const rho = forestDensity(SEED, i * 137.3, i * -91.7, flat(30 + (i % 150), (i % 10) / 12));
      expect(rho).toBeGreaterThanOrEqual(0);
      expect(rho).toBeLessThanOrEqual(1);
    }
  });
  it("full below the treeline band, zero above it", () => {
    expect(forestDensity(SEED, 3000, 10.5, flat(TREELINE_LO - 30))).toBeGreaterThan(0);
    expect(forestDensity(SEED, 3000, 10.5, flat(TREELINE_HI + 5))).toBe(0);
  });
  it("zero past the slope cap, positive on gentle ground", () => {
    expect(forestDensity(SEED, 3000, 10.5, flat(60, SLOPE_HI + 0.05))).toBe(0);
    expect(forestDensity(SEED, 3000, 10.5, flat(60, 0.2))).toBeGreaterThan(0);
  });
  it("zero on the beach and at the coast, positive inland at the same altitude", () => {
    expect(forestDensity(SEED, 3000, 10.5, flat(SHORE_ALT - 1))).toBe(0);
    // a point genuinely near the coast: x = -350 is within SHORE_D of some warps;
    // use the field's own report — d < SHORE_D must force 0 regardless of sample
    expect(forestDensity(SEED, -395, 10.5, flat(60))).toBe(0);
  });
  it("is deterministic at large and negative coordinates", () => {
    const a = forestDensity(SEED, -91237.4, 88411.9);
    expect(a).toBe(forestDensity(SEED, -91237.4, 88411.9));
    expect(Number.isFinite(a)).toBe(true);
  });
});

describe("tree field", () => {
  it("yields at most one tree per cell, deterministically, inside the cell", () => {
    for (let cx = -20; cx <= 20; cx++) {
      const a = treeInCell(SEED, cx, 7);
      expect(a).toEqual(treeInCell(SEED, cx, 7));
      if (a) {
        expect(a.x).toBeGreaterThanOrEqual(cx * TREE_CELL);
        expect(a.x).toBeLessThan((cx + 1) * TREE_CELL);
        expect(a.scale).toBeGreaterThanOrEqual(TREE_SCALE_MIN);
        expect(a.species === 0 || a.species === 1).toBe(true);
      }
    }
  });
  it("census on friendly inland ground lands in the derived band", () => {
    // 1 km² east of the coast, low altitude. Re-anchored 2026-08-27:
    // TREE_CELL 12→10 and D 0.006→0.01 raise the cell-cap
    // density 1.67×, and the widened RAG window fills stand interiors.
    // Re-anchored AGAIN 2026-08-27 at a frame-time gate: D pulled back
    // 0.01→0.008 (TREE_CELL stays 10) to hold the
    // gate; measured 6958 here (was 8656 at D=0.01). Floor/ceiling reset per
    // the same rule: floor = max(round(1.1·4064), round(0.85·6958)) =
    // max(4470, 5914) = 5914 (still above the ORIGINAL pre-retune count of
    // 4064, so a silent full revert still fails low); ceiling =
    // round(1.25·6958) = 8698. Mutation check: reverting BOTH TREE_CELL→12
    // and D→0.006 (the pre-retune pair) measures 5196 — below the 5914
    // floor, so that silent revert still fails this test, as required.
    const trees = treesInRect(SEED, 2000, 2000, 3000, 3000);
    expect(trees.length).toBeGreaterThan(5914);
    expect(trees.length).toBeLessThan(8698);
  });
  it("census is zero where the gates say zero", () => {
    expect(treesInRect(SEED, -2400, -500, -1600, 500).length).toBe(0); // open ocean
  });
  it("groundH matches the active variant's field at the tree position", () => {
    const t = treesInRect(SEED, 2000, 2000, 2200, 2200)[0]!;
    expect(t.groundH).toBe(elevationAt(SEED, t.x, t.z));
  });
});

describe("cohorts", () => {
  /** Every tree in a large inland sweep, which spans dense stand hearts and
   * ragged edges alike. */
  function sweep(): ReturnType<typeof treesInRect> {
    return treesInRect(SEED, 2000, 2000, 3200, 3200);
  }

  it("assigns every tree exactly one known cohort", () => {
    const trees = sweep();
    expect(trees.length).toBeGreaterThan(500); // teeth: an empty sweep proves nothing
    for (const t of trees) {
      expect([COHORT_GIANT, COHORT_SAPLING, COHORT_SNAG, COHORT_LOG]).toContain(t.cohort);
    }
  });

  it("is deterministic", () => {
    const a = treeInCell(SEED, 173, -91);
    expect(a).toEqual(treeInCell(SEED, 173, -91));
  });

  it("produces all four cohorts, giants dominant", () => {
    const trees = sweep();
    const share = (c: number) => trees.filter((t) => t.cohort === c).length / trees.length;
    expect(share(COHORT_GIANT)).toBeGreaterThan(0.4);
    expect(share(COHORT_SAPLING)).toBeGreaterThan(0.05);
    expect(share(COHORT_SNAG)).toBeGreaterThan(0);
    expect(share(COHORT_LOG)).toBeGreaterThan(0);
    // Deadwood is a minority of the stand, as SNAG_SHARE + LOG_SHARE intends.
    expect(share(COHORT_SNAG) + share(COHORT_LOG)).toBeLessThan(2 * (SNAG_SHARE + LOG_SHARE));
  });

  it("scales giants into the old-growth band and saplings out of it", () => {
    const trees = sweep();
    const giants = trees.filter((t) => t.cohort === COHORT_GIANT);
    const saplings = trees.filter((t) => t.cohort === COHORT_SAPLING);
    expect(giants.length).toBeGreaterThan(0);
    expect(saplings.length).toBeGreaterThan(0);
    // VALLEY_SCALE_BOOST multiplies on top, so the upper bound carries it.
    for (const g of giants) {
      expect(g.scale).toBeGreaterThanOrEqual(GIANT_SCALE_MIN);
      expect(g.scale).toBeLessThanOrEqual(GIANT_SCALE_MAX * VALLEY_SCALE_BOOST);
    }
    // Every giant out-scales every sapling — the cohorts never overlap in size.
    expect(Math.min(...giants.map((g) => g.scale)))
      .toBeGreaterThan(Math.max(...saplings.map((s) => s.scale)));
  });

  it("keeps species independent of cohort", () => {
    const trees = sweep();
    for (const c of [COHORT_GIANT, COHORT_SAPLING]) {
      const of = trees.filter((t) => t.cohort === c);
      expect(new Set(of.map((t) => t.species)).size).toBe(2);
    }
  });

  it("declares every new tunable in the level-id record", () => {
    for (const k of [
      "GIANT_RHO_LO", "GIANT_RHO_HI", "COHORT_JITTER", "SNAG_SHARE", "LOG_SHARE",
      "GIANT_SCALE_MIN", "GIANT_SCALE_MAX", "DEADWOOD_SCALE_MIN", "DEADWOOD_SCALE_MAX",
    ]) {
      expect(VEGETATION_TUNABLES[k]).toBeTypeOf("number");
    }
  });
});

describe("road clearing", () => {
  it("declares the clearing tunables on pass 6", () => {
    expect(VEGETATION_TUNABLES.ROAD_CLEAR).toBe(12);
    expect(VEGETATION_TUNABLES.ROAD_CLEAR_FADE).toBe(15);
  });

  it("zeroes density on the road and ramps back past the fade", () => {
    // Walk straight east from a centerline point found via the hook.
    const v = activeTerrainVariant();
    const z = 730.5;
    // bisect x for roadDistance minimum near spawn longitude
    let xr = 0, best = Infinity;
    for (let x = -450; x < 50; x += 0.25) {
      const r = v.roadDistance!(SEED, x, z);
      if (r < best) { best = r; xr = x; }
    }
    expect(best).toBeLessThan(0.5);
    expect(forestDensity(SEED, xr, z)).toBe(0);
    expect(forestDensity(SEED, xr + ROAD_CLEAR - 0.5, z)).toBe(0);
    // Recovery: SOME forest stands within the first 53 m past the fade edge,
    // measured at a z where the ROAD gate is the binding constraint (at
    // z = 200.5 the forest onset sits 29 m east of the centerline — 2 m past
    // the fade edge; at this test's z above, shore/altitude gates keep the
    // flat coastal ground bare for ~95 m regardless of the road). Not a
    // fitted value — just "the clearing does not extend beyond its
    // constants": if ROAD_CLEAR/ROAD_CLEAR_FADE ever over-widen (typo,
    // retune slip), everything in this scan stays gated and this fails.
    // Exact recovered VALUES stay unasserted on purpose: forestDensity
    // composes five gates, and pinning numbers here would couple this test
    // to treeline/slope/shore/raggedness behaviour unrelated to the road.
    const zR = 200.5;
    let xrR = 0, bestR = Infinity;
    for (let x = -450; x < 50; x += 0.25) {
      const r = v.roadDistance!(SEED, x, zR);
      if (r < bestR) { bestR = r; xrR = x; }
    }
    expect(bestR).toBeLessThan(0.5);
    let recovered = 0;
    for (let e = ROAD_CLEAR + ROAD_CLEAR_FADE; e <= ROAD_CLEAR + ROAD_CLEAR_FADE + 53; e += 1) {
      recovered = Math.max(recovered, forestDensity(SEED, xrR + e, zR));
    }
    expect(recovered).toBeGreaterThan(0);
  });

  it("keeps every emitted tree off the road", () => {
    const v = activeTerrainVariant();
    // Scan a corridor of cells wide enough to be GUARANTEED to contain the
    // road: the centerline x = coastline(z) + d_r(z) with coastline in
    // [−620, −180] and d_r in [55, 135], so x ∈ [−565, −45]. TREE_CELL is
    // 12 m: cx ∈ [−60, 10) covers x ∈ [−720, 120] ⊇ the whole range. Assert
    // the scan actually saw road-adjacent ground so the test cannot pass by
    // scanning the wrong place.
    let sawCorridor = false;
    for (let cz = 0; cz < 120; cz++) {
      for (let cx = -60; cx < 10; cx++) {
        const centre = v.roadDistance!(SEED, (cx + 0.5) * TREE_CELL, (cz + 0.5) * TREE_CELL);
        if (centre < ROAD_CLEAR) sawCorridor = true;
        const t = treeInCell(SEED, cx, cz);
        if (t === null) continue;
        expect(v.roadDistance!(SEED, t.x, t.z)).toBeGreaterThanOrEqual(ROAD_CLEAR);
      }
    }
    expect(sawCorridor).toBe(true);
  });

  it("declares no road hook on montane, and the fallback stays finite", () => {
    // Mirrors the coastDistance "montane declares none" test: the gate's
    // Infinity fallback shares its code shape with the proven coast
    // fallback, so hook absence plus a finite call is the honest assertion —
    // a specific density value here would couple this test to treeline and
    // slope gates that have nothing to do with the road.
    expect(terrainVariant("montane")!.roadDistance).toBeUndefined();
    setActiveTerrainVariant("montane");
    try {
      expect(Number.isFinite(forestDensity(SEED, 2500, 2500))).toBe(true);
    } finally {
      setActiveTerrainVariant("olympic");
    }
  });
});

describe("the terrain feature mask", () => {
  // Seed 12345 is a PROBE_SEED whose world carries BOTH a meadow and a pond
  // loop feature (found by a quick scan of PROBE_SEEDS, 2026-09-11): meadow
  // centre (495.52, 84) radius 84.36, pond centre (207.33, 316) radius 25.80.
  const MASK_SEED = 12345;

  it("carries no trees at a made meadow's centre", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const meadow = features.find((f) => f.kind === "meadow")!;
    expect(forestDensity(MASK_SEED, meadow.x, meadow.z)).toBe(0);
  });

  it("carries no trees on a pond's shore band", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const { features } = bowlFor(MASK_SEED);
    const pond = features.find((f) => f.kind === "pond")!;
    // 1 m onto the shore band (radius, radius + POND_SHORE]: well inside the
    // tree margin the mask thins to zero (POND_TREE_MARGIN = 8).
    const x = pond.x + pond.radius + 1;
    expect(forestDensity(MASK_SEED, x, pond.z)).toBe(0);
  });

  it("recovers the unmasked*landmark density 60 m past the meadow's apron", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const v = activeTerrainVariant();
    const { features } = bowlFor(MASK_SEED);
    const peak = features.find((f) => f.kind === "peak")!;
    const meadow = features.find((f) => f.kind === "meadow")!;
    // 60 m past the apron, in the direction AWAY from the peak — this seed's
    // meadow sits inside the peak's own 300 m dome radius on its near side,
    // so a plain +x offset can land inside a SECOND feature's reach and no
    // longer read NO_FEATURE_MASK, which is what this case means to isolate.
    const awayX = meadow.x - peak.x, awayZ = meadow.z - peak.z;
    const awayLen = Math.hypot(awayX, awayZ);
    const dist = meadow.radius + MEADOW_RIM + 60;
    const x = meadow.x + (awayX / awayLen) * dist;
    const z = meadow.z + (awayZ / awayLen) * dist;
    const s = v.sample(MASK_SEED, x, z);
    const rho = forestDensityUnmasked(MASK_SEED, x, z, s);
    const landmarkMask = v.landmarkMask?.(MASK_SEED, x, z);
    const expected = landmarkMask === undefined ? rho : Math.min(1, Math.max(rho * landmarkMask.tree, landmarkMask.treeFloor));
    expect(forestDensity(MASK_SEED, x, z)).toBeCloseTo(expected, 9);
  });
});

describe("trees keep off the trail", () => {
  it("places no tree instance within TRAIL_CLEAR of any edge, five seeds", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const v = terrainVariant("olympic")!;
    for (const seed of [0x5eed, 1, 12345, 777, 4242]) {
      const g = v.trailGraph!(seed);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const n of g.nodes) {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
      }
      let offenders = 0;
      let total = 0;
      for (const t of treesInRect(seed, minX - 20, minZ - 20, maxX + 20, maxZ + 20)) {
        total++;
        if (v.trailDistance!(seed, t.x, t.z) < TRAIL_CLEAR) offenders++;
      }
      expect(total, `seed ${seed} grew trees near the graph`).toBeGreaterThan(50);
      expect(offenders, `seed ${seed}`).toBe(0);
    }
  });
});
