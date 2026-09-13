import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  treeInCell,
  TREE_CELL,
  COHORT_GIANT,
  COHORT_SAPLING,
  COHORT_SNAG,
  COHORT_LOG,
  type TreeInstance,
} from "../../src/sim/vegetation.js";
import {
  collectBands,
  createBandCollector,
  bandsOrigin,
  bandForDistanceSq,
  BAND_IMPOSTOR,
  BAND_BEYOND,
  NEAR_RADIUS,
  LOD_RING_0,
  LOD_RING_1,
  UNDERSTORY_RADIUS,
  IMPOSTOR_RADIUS,
  IMPOSTOR_CELL_STRIDE,
  IMPOSTOR_FULL_RADIUS,
  IMPOSTOR_FILL_BUDGET_MAX,
  NEAR_BUDGET_MAX,
  IMPOSTOR_BUDGET_MAX,
  SEAM_PAD,
  SEAM_LOD0,
  SEAM_LOD1,
  seamNear,
  type ForestBands,
} from "../../src/game/forestField.js";

const SEED = 0x5eed;
setActiveTerrainVariant("olympic");

/** Squared distance from a band anchor to a tree's jittered position. */
function distSq(t: TreeInstance, ax: number, az: number): number {
  const dx = t.x - ax;
  const dz = t.z - az;
  return dx * dx + dz * dz;
}

function containsTree(list: TreeInstance[], t: TreeInstance): boolean {
  return list.some((u) => u.x === t.x && u.z === t.z);
}

/**
 * A real tree of the field plus a cell-lattice anchor whose distance to it
 * falls in (dLo, dHi) — the raw material for testing a ring edge from both
 * sides with real field data. `strideCellOnly` restricts the search to cells
 * the impostor band's stride sampling visits, so the pair is usable for
 * impostor-membership assertions too. Every call site below checks the tree
 * against `near` or `impostors`, both GIANT-only buckets (saplings/snags/logs
 * route elsewhere in `collectBands`), so the search is restricted to GIANT
 * trees — otherwise a found tree whose local density lands it in a different
 * cohort can never appear in the bucket the assertion checks.
 */
function findTreeAnchorPair(
  dLo: number,
  dHi: number,
  strideCellOnly: boolean,
): { tree: TreeInstance; ax: number; az: number } {
  const kMax = Math.ceil(dHi / TREE_CELL) + 1;
  for (let cz = -40; cz <= 40; cz++) {
    for (let cx = -40; cx <= 40; cx++) {
      if (strideCellOnly && (cx % IMPOSTOR_CELL_STRIDE !== 0 || cz % IMPOSTOR_CELL_STRIDE !== 0)) {
        continue;
      }
      const tree = treeInCell(SEED, cx, cz);
      if (!tree || tree.cohort !== COHORT_GIANT) continue;
      const baseX = Math.floor(tree.x / TREE_CELL);
      const baseZ = Math.floor(tree.z / TREE_CELL);
      for (let kz = -kMax; kz <= kMax; kz++) {
        for (let kx = -kMax; kx <= kMax; kx++) {
          const ax = (baseX + kx) * TREE_CELL;
          const az = (baseZ + kz) * TREE_CELL;
          const d2 = distSq(tree, ax, az);
          if (d2 > dLo * dLo && d2 < dHi * dHi) return { tree, ax, az };
        }
      }
    }
  }
  throw new Error(`no tree/anchor pair at distance (${dLo}, ${dHi})`);
}

/** All trees of the field within `radius` of (ax, az), by actual distance. */
function treesWithin(ax: number, az: number, radius: number): { t: TreeInstance; d2: number }[] {
  const out: { t: TreeInstance; d2: number }[] = [];
  const c0x = Math.floor((ax - radius) / TREE_CELL);
  const c1x = Math.floor((ax + radius) / TREE_CELL);
  const c0z = Math.floor((az - radius) / TREE_CELL);
  const c1z = Math.floor((az + radius) / TREE_CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const t = treeInCell(SEED, cx, cz);
      if (!t) continue;
      const d2 = distSq(t, ax, az);
      if (d2 < radius * radius) out.push({ t, d2 });
    }
  }
  return out;
}

describe("bandsOrigin", () => {
  it("snaps to the tree-cell lattice", () => {
    expect(bandsOrigin(1, 1)).toEqual({ x: 0, z: 0 });
    expect(bandsOrigin(5, 5)).toEqual({ x: 0, z: 0 });
    expect(bandsOrigin(13, 1)).toEqual({ x: TREE_CELL, z: 0 });
    expect(bandsOrigin(-1, -13)).toEqual({ x: -TREE_CELL, z: -2 * TREE_CELL });
  });
});

describe("collectBands origin stability", () => {
  it("two cameras in the same cell yield deeply-equal bands", () => {
    const a = collectBands(SEED, 1, 1);
    const b = collectBands(SEED, 5, 5);
    // Guard: the comparison must be over real content, not two empty results.
    expect(a.near.flat().length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("crossing a cell boundary changes the bands", () => {
    const a = collectBands(SEED, 1, 1);
    const b = collectBands(SEED, TREE_CELL + 1, 1);
    expect(bandsOrigin(1, 1)).not.toEqual(bandsOrigin(TREE_CELL + 1, 1));
    expect(a).not.toEqual(b);
  });
});

describe("ring edges (exact boundaries)", () => {
  it("assigns LOD 0 strictly inside LOD_RING_0 and LOD 1 at the edge", () => {
    expect(bandForDistanceSq(LOD_RING_0 * LOD_RING_0 - 1e-6)).toBe(0);
    expect(bandForDistanceSq(LOD_RING_0 * LOD_RING_0)).toBe(1);
  });

  it("assigns LOD 1 strictly inside LOD_RING_1 and LOD 2 at the edge", () => {
    expect(bandForDistanceSq(LOD_RING_1 * LOD_RING_1 - 1e-6)).toBe(1);
    expect(bandForDistanceSq(LOD_RING_1 * LOD_RING_1)).toBe(2);
  });

  it("assigns near strictly inside NEAR_RADIUS and impostor at the edge", () => {
    expect(bandForDistanceSq(NEAR_RADIUS * NEAR_RADIUS - 1e-6)).toBe(2);
    expect(bandForDistanceSq(NEAR_RADIUS * NEAR_RADIUS)).toBe(BAND_IMPOSTOR);
  });

  it("assigns impostor strictly inside IMPOSTOR_RADIUS and beyond at the edge", () => {
    expect(bandForDistanceSq(IMPOSTOR_RADIUS * IMPOSTOR_RADIUS - 1e-3)).toBe(BAND_IMPOSTOR);
    expect(bandForDistanceSq(IMPOSTOR_RADIUS * IMPOSTOR_RADIUS)).toBe(BAND_BEYOND);
  });

  it("honours a reduced nearRadius at its exact edge", () => {
    expect(bandForDistanceSq(140 * 140 - 1e-6, 140)).toBe(2);
    expect(bandForDistanceSq(140 * 140, 140)).toBe(BAND_IMPOSTOR);
  });
});

describe("ring edges (real field data)", () => {
  it("a real tree just inside LOD_RING_0 lands in near[0], just outside in near[1]", () => {
    const inner = findTreeAnchorPair(LOD_RING_0 - 6, LOD_RING_0, false);
    const bi = collectBands(SEED, inner.ax + 0.5, inner.az + 0.5);
    expect(containsTree(bi.near[0] as TreeInstance[], inner.tree)).toBe(true);

    const outer = findTreeAnchorPair(LOD_RING_0, LOD_RING_0 + 6, false);
    const bo = collectBands(SEED, outer.ax + 0.5, outer.az + 0.5);
    expect(containsTree(bo.near[1] as TreeInstance[], outer.tree)).toBe(true);
  });

  it("a real tree just inside NEAR_RADIUS lands in near[2], just outside in impostors", () => {
    // Stride cells only, so the outer pair is one the impostor sampling visits.
    const inner = findTreeAnchorPair(NEAR_RADIUS - 6, NEAR_RADIUS, true);
    const bi = collectBands(SEED, inner.ax + 0.5, inner.az + 0.5);
    expect(containsTree(bi.near[2] as TreeInstance[], inner.tree)).toBe(true);

    const outer = findTreeAnchorPair(NEAR_RADIUS, NEAR_RADIUS + 6, true);
    const bo = collectBands(SEED, outer.ax + 0.5, outer.az + 0.5);
    expect(containsTree(bo.impostors, outer.tree)).toBe(true);
  });

  it("every returned tree's distance lands inside its claimed ring", () => {
    const { x: ax, z: az } = bandsOrigin(1, 1);
    const b = collectBands(SEED, 1, 1);
    const bounds: [number, number][] = [
      [0, LOD_RING_0],
      [LOD_RING_0, LOD_RING_1],
      [LOD_RING_1, NEAR_RADIUS],
    ];
    // Relaxed by SEAM_PAD at the padded-seams change: a
    // ring may hold trees up to SEAM_PAD past its outer edge, and a
    // duplicate from the ring inward of it as far in as the seam's own
    // (narrower) low edge minus SEAM_PAD — `ringSplit` keys the inward
    // duplicate off SEAM_LOD0/SEAM_LOD1's low value, not the ring boundary
    // itself, so the floor per ring is that seam's low edge, not `lo`.
    const seamFloor = [0, SEAM_LOD0[0], SEAM_LOD1[0]];
    bounds.forEach(([, hi], ring) => {
      const trees = b.near[ring] ?? [];
      expect(trees.length).toBeGreaterThan(0);
      for (const t of trees) {
        const d2 = distSq(t, ax, az);
        expect(d2).toBeGreaterThanOrEqual(Math.max(0, seamFloor[ring]! - SEAM_PAD) ** 2);
        expect(d2).toBeLessThan((hi + SEAM_PAD) ** 2);
      }
    });
    expect(b.impostors.length).toBeGreaterThan(0);
    for (const t of b.impostors) {
      const d2 = distSq(t, ax, az);
      // Same relaxation: the near/impostor seam's inner edge is
      // seamNear(NEAR_RADIUS), and the far out-band pads IMPOSTOR_RADIUS.
      expect(d2).toBeGreaterThanOrEqual((seamNear(NEAR_RADIUS)[0] - SEAM_PAD) ** 2);
      expect(d2).toBeLessThan((IMPOSTOR_RADIUS + SEAM_PAD) ** 2);
      // Impostors come only from stride-sampled cells (abs: -0 !== 0 to toBe).
      expect(Math.abs(Math.floor(t.x / TREE_CELL) % IMPOSTOR_CELL_STRIDE)).toBe(0);
      expect(Math.abs(Math.floor(t.z / TREE_CELL) % IMPOSTOR_CELL_STRIDE)).toBe(0);
    }
    expect(b.understory.length).toBeGreaterThan(0);
    // Relaxed by SEAM_PAD too: understory
    // membership pads UNDERSTORY_RADIUS the same way every other edge does —
    // see "understory membership is padded by SEAM_PAD" below for why.
    for (const t of b.understory) {
      expect(distSq(t, ax, az)).toBeLessThan((UNDERSTORY_RADIUS + SEAM_PAD) ** 2);
    }
  });

  it("respects a reduced nearRadius = 80 parameter", () => {
    // NEAR_RADIUS shrank 200→120 at one point, which put the old 140 m
    // override ABOVE the new default — no longer a reduction, so it could no
    // longer exercise "an annulus moves from near to impostor". 80 m sits
    // below the current NEAR_RADIUS again, restoring the original intent
    // (this is a generic
    // test of the `nearRadius` parameter, not tied to any specific quality
    // tier's own constant — renderer.ts's own "low" tier value is untouched
    // here).
    const { x: ax, z: az } = bandsOrigin(1, 1);
    const b = collectBands(SEED, 1, 1, 80);
    const near = b.near.flat() as TreeInstance[];
    expect(near.length).toBeGreaterThan(0);
    // Relaxed by SEAM_PAD at the padded-seams change: near
    // may reach 80 + SEAM_PAD; impostors may start at seamNear(80)[0] − SEAM_PAD.
    for (const t of near) expect(distSq(t, ax, az)).toBeLessThan((80 + SEAM_PAD) ** 2);
    // The annulus 80..NEAR_RADIUS moved to the impostor band.
    expect(
      b.impostors.some((t) => distSq(t, ax, az) < NEAR_RADIUS * NEAR_RADIUS),
    ).toBe(true);
    for (const t of b.impostors) {
      expect(distSq(t, ax, az)).toBeGreaterThanOrEqual((seamNear(80)[0] - SEAM_PAD) ** 2);
    }
  });
});

describe("budgets", () => {
  /** The densest camera spot found by scanning real inland ground: the
   * candidate grid covers the forested belt east of the coast, and each
   * candidate is scored by its actual near-disc tree count. */
  function worstCaseCamera(): { x: number; z: number; count: number } {
    let best = { x: 0, z: 0, count: -1 };
    for (let x = -100; x <= 2800; x += 240) {
      for (let z = -3400; z <= 3400; z += 240) {
        const count = treesWithin(x, z, NEAR_RADIUS).length;
        if (count > best.count) best = { x, z, count };
      }
    }
    return best;
  }

  it("holds both ceilings on the worst-case ground found by scanning", () => {
    // NEAR_RADIUS shrank 200→120 at one point, so the same scan covers a
    // much smaller disc. Measured
    // worst.count = 377 (was >400 at radius 200) and nearCount = 339 (was
    // >400) — both floors dropped to 300, still comfortably nonzero ("the
    // scan found real forest") without being tight enough to flake on a
    // future sub-metre retune.
    const worst = worstCaseCamera();
    expect(worst.count).toBeGreaterThan(300); // the scan found real forest
    const b = collectBands(SEED, worst.x, worst.z);
    const nearCount = b.near.flat().length;
    expect(nearCount).toBeGreaterThan(300);
    // NEAR_BUDGET_MAX stays 460 as a unique-pick ceiling: the clamp does NOT
    // bind at this worst-case camera — 419 unique giants are kept against the
    // 460 budget, well under it. The original assertion still
    // failed because `near.flat().length` (625, measured) counts the padded
    // seam duplicates on top of those 419 uniques; the ceiling was never
    // about the flat count in the first place, so it now holds on the UNIQUE
    // tree count instead.
    const uniqueNear = new Set(b.near.flat().map((t) => `${t.x}:${t.z}`));
    expect(uniqueNear.size).toBeLessThanOrEqual(NEAR_BUDGET_MAX);
    expect(b.impostors.length).toBeGreaterThan(0);
    expect(b.impostors.length).toBeLessThanOrEqual(IMPOSTOR_BUDGET_MAX);
  });

  it("clamps nearest-first, dropping the far tail", () => {
    // An oversized nearRadius pulls the whole impostor disc into the near
    // band (~20k trees), forcing the clamp to actually bind.
    const worst = worstCaseCamera();
    const b = collectBands(SEED, worst.x, worst.z, IMPOSTOR_RADIUS);
    const near = b.near.flat() as TreeInstance[];
    // NEAR_BUDGET_MAX bounds UNIQUE near picks —
    // the clamp runs on `nearPicks` before `ringSplit` duplicates a pick
    // across a padded seam — so assert on the unique tree count, not the
    // padded (possibly-duplicated) flat length, which can only be >= it.
    const uniqueNear = new Set(near.map((t) => `${t.x}:${t.z}`));
    expect(uniqueNear.size).toBe(NEAR_BUDGET_MAX);
    expect(near.length).toBeGreaterThanOrEqual(NEAR_BUDGET_MAX);

    const { x: ax, z: az } = bandsOrigin(worst.x, worst.z);
    // nearRadius = IMPOSTOR_RADIUS leaves no ordinary annulus, but the
    // near/impostor seam still pads: an on-lattice tree within SEAM_PAD of
    // seamNear(IMPOSTOR_RADIUS)'s inner edge qualifies for `impostors` too
    // (measured minimum 1965.89 m against a floor of 1965.86 m).
    for (const t of b.impostors) {
      expect(distSq(t, ax, az)).toBeGreaterThanOrEqual((seamNear(IMPOSTOR_RADIUS)[0] - SEAM_PAD) ** 2);
    }
    // `near` is GIANT-only: filter the raw field scan the same way
    // so the "nearest N" comparison below is over the same population.
    const all = treesWithin(ax, az, IMPOSTOR_RADIUS).filter((e) => e.t.cohort === COHORT_GIANT);
    expect(all.length).toBeGreaterThan(NEAR_BUDGET_MAX);
    const sorted = all.map((e) => e.d2).sort((p, q) => p - q);
    const maxKept = Math.max(...near.map((t) => distSq(t, ax, az)));
    // The kept set is exactly the NEAR_BUDGET_MAX nearest unique trees.
    expect(maxKept).toBe(sorted[NEAR_BUDGET_MAX - 1]);
  });
});

describe("ocean camera", () => {
  it("yields empty bands over open water", () => {
    const b: ForestBands = collectBands(SEED, -6000, 0);
    expect(b.near).toEqual([[], [], []]);
    expect(b.understory).toEqual([]);
    expect(b.impostors).toEqual([]);
  });
});

describe("createBandCollector", () => {
  it("deep-equals the pure collectBands at every camera, including after moves", () => {
    const c = createBandCollector(SEED);
    const cams: [number, number][] = [
      [1, 1], // cold
      [TREE_CELL + 1, 1], // one-cell move east (warm)
      [TREE_CELL + 1, TREE_CELL + 1], // one-cell move south
      [301.7, -299.2], // long jump: fresh leading cells plus eviction churn
      [1, 1], // back to the start, after that churn
    ];
    for (const [x, z] of cams) {
      const got = c.collect(x, z);
      expect(got.near.flat().length + got.impostors.length).toBeGreaterThan(0); // real content
      expect(got).toEqual(collectBands(SEED, x, z));
    }
    // The nearRadius knob flows through identically too.
    expect(c.collect(1, 1, 140)).toEqual(collectBands(SEED, 1, 1, 140));
  });

  it("bounds its memory: a disjoint disc evicts the old one wholesale", () => {
    const c = createBandCollector(SEED);
    c.collect(1, 1);
    const homeSize = c.size;
    expect(homeSize).toBeGreaterThan(0);
    // 30 km east: the two impostor discs share no cells, so without eviction
    // the cache would hold both (~2× homeSize).
    c.collect(30000, 1);
    expect(c.size).toBeLessThan(homeSize * 1.5);
  });

  it("keeps a warm one-cell-move collect fast — the 25-33 ms rescan must not return", () => {
    const c = createBandCollector(SEED);
    c.collect(1, 1); // cold pass pays the full-disc terrain sampling once
    let best = Infinity;
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      c.collect(1 + i * TREE_CELL, 1);
      best = Math.min(best, performance.now() - t0);
    }
    // Warm collects re-sample only the disc's leading edge, but since the
    // padded-seams change the off-lattice loop also walks every cell inside
    // IMPOSTOR_FULL_RADIUS + SEAM_PAD each time — ~41k cell iterations and
    // ~24k extra cache lookups versus the pre-padding ~120 m near square,
    // even though only the leading edge is freshly *sampled*. That walk cost
    // is intrinsic to fully sampling a 1 km fill and is accepted for now;
    // IMPOSTOR_FULL_RADIUS 1000 → 600 is the recorded fallback if it ever
    // reads as a walking hitch. Paired A/B measurement against the
    // pre-padding module, same process, 3 rounds both orders: old best
    // 3.30-3.32 ms isolated / 3.97-4.04 ms under full-suite contention; new
    // best 9.05-9.88 ms isolated / 12.1-15.3 ms under full-suite contention
    // — roughly 3x the old cost either way, consistent with the wider walk.
    // 30 ms keeps ~2x headroom over the worst contended reading so a
    // slower/shared CI runner doesn't flake, while still catching a further
    // regression (e.g. another walk-radius widening) on top of this one.
    expect(best).toBeLessThan(30);
  });
});

describe("cohort banding", () => {
  it("routes each cohort to its own bucket", () => {
    const bands = collectBands(SEED, 2500, 2500);
    // Padded seams: impostors/impostorsFill now carry
    // GIANT, SAPLING and SNAG (never LOG) — only near/saplings stay
    // cohort-pure.
    for (const t of bands.near.flat()) expect(t.cohort).toBe(COHORT_GIANT);
    for (const t of bands.impostors) expect(t.cohort).not.toBe(COHORT_LOG);
    for (const t of bands.impostorsFill) expect(t.cohort).not.toBe(COHORT_LOG);
    for (const t of bands.saplings.flat()) expect(t.cohort).toBe(COHORT_SAPLING);
    for (const t of bands.deadwood) {
      expect([COHORT_SNAG, COHORT_LOG]).toContain(t.cohort);
    }
    expect(bands.near.flat().length).toBeGreaterThan(0);
    expect(bands.saplings.flat().length).toBeGreaterThan(0);
    expect(bands.deadwood.length).toBeGreaterThan(0);
  });

  it("splits saplings into the same three LOD rings as giants", () => {
    // Regression test for the production framerate fix: the
    // sapling cohort shipped as one LOD0-only bucket, which rendered every
    // regeneration tree inside NEAR_RADIUS at full 2,171/2,163-triangle
    // detail — measured at 1.7-2.5 ms/frame of pure GPU cost at a deep
    // old-growth camera. Saplings must ring-split exactly as `near` does.
    const { x: ax, z: az } = bandsOrigin(2500, 2500);
    const bands = collectBands(SEED, 2500, 2500);
    const bounds: [number, number][] = [
      [0, LOD_RING_0],
      [LOD_RING_0, LOD_RING_1],
      [LOD_RING_1, NEAR_RADIUS],
    ];
    expect(bands.saplings.length).toBe(3);
    // Relaxed by SEAM_PAD at the padded-seams change: a
    // ring may hold trees up to SEAM_PAD past its outer edge, and a
    // duplicate from the ring inward of it as far in as the seam's own
    // (narrower) low edge minus SEAM_PAD — see the identical comment on
    // "every returned tree's distance lands inside its claimed ring".
    const seamFloor = [0, SEAM_LOD0[0], SEAM_LOD1[0]];
    bounds.forEach(([, hi], ring) => {
      const trees = bands.saplings[ring] ?? [];
      // All three rings populated at a dense-forest camera — an empty outer
      // ring would mean the split silently regressed to near-field-only.
      expect(trees.length).toBeGreaterThan(0);
      for (const t of trees) {
        const d2 = distSq(t, ax, az);
        expect(d2).toBeGreaterThanOrEqual(Math.max(0, seamFloor[ring]! - SEAM_PAD) ** 2);
        expect(d2).toBeLessThan((hi + SEAM_PAD) ** 2);
      }
    });
  });

  it("collects understory beneath sapling and deadwood cohorts too, not just giants", () => {
    // Regression test: understory (ferns/shrubs) must be collected for EVERY
    // cohort within UNDERSTORY_RADIUS, exactly as it was before cohorts
    // existed — the cohort routing above must not gate it to giants only.
    function findTreeOfCohort(
      cohort: number,
      centerCx: number,
      centerCz: number,
      half: number,
    ): { tree: TreeInstance; cx: number; cz: number } {
      for (let cz = centerCz - half; cz <= centerCz + half; cz++) {
        for (let cx = centerCx - half; cx <= centerCx + half; cx++) {
          const t = treeInCell(SEED, cx, cz);
          if (t && t.cohort === cohort) return { tree: t, cx, cz };
        }
      }
      throw new Error(`no cohort ${cohort} tree found within ${half} cells of (${centerCx}, ${centerCz})`);
    }

    // (2500, 2500) is real forest per the "cohort banding" tests above, so
    // search a generous cell neighbourhood around it for each cohort.
    const centerCx = Math.round(2500 / TREE_CELL);
    const centerCz = Math.round(2500 / TREE_CELL);
    for (const cohort of [COHORT_SAPLING, COHORT_SNAG, COHORT_LOG]) {
      const { tree, cx, cz } = findTreeOfCohort(cohort, centerCx, centerCz, 120);
      // Camera stands inside the same cell as the tree, well inside
      // UNDERSTORY_RADIUS (50 m) regardless of jitter.
      const camX = cx * TREE_CELL + 0.5;
      const camZ = cz * TREE_CELL + 0.5;
      const b = collectBands(SEED, camX, camZ);
      expect(containsTree(b.understory, tree)).toBe(true);
    }
  });

  it("keeps saplings and deadwood inside the near radius", () => {
    const bands = collectBands(SEED, 2500, 2500);
    // Membership is decided against the cell-snapped bandsOrigin (see
    // `collectBandsWith`), not the raw camera position, so the boundary
    // check below must use the same reference point — exactly like every
    // other exact-edge assertion in this file (e.g. "ring edges (real field
    // data)"). Measuring from the raw camera position instead would fail
    // spuriously: it can differ from the snapped origin by close to
    // TREE_CELL in each axis, which pushes some boundary-adjacent trees
    // just past NEAR_RADIUS when measured from the wrong point.
    const { x: ax, z: az } = bandsOrigin(2500, 2500);
    // Relaxed by SEAM_PAD at the padded-seams change: the
    // near-radius seam admits picks up to SEAM_PAD past NEAR_RADIUS.
    for (const t of [...bands.saplings.flat(), ...bands.deadwood]) {
      const d2 = (t.x - ax) ** 2 + (t.z - az) ** 2;
      expect(d2).toBeLessThan((NEAR_RADIUS + SEAM_PAD) ** 2);
    }
  });
});

describe("padded seams", () => {
  const cam = { x: 2500, z: 2500 };
  const { x: ax, z: az } = bandsOrigin(cam.x, cam.z);
  const treeKey = (t: TreeInstance) => `${t.x}:${t.z}`;
  const dist = (t: TreeInstance) => Math.hypot(t.x - ax, t.z - az);

  it("a giant inside a padded LOD seam is in both rings; outside, in exactly one", () => {
    const bands = collectBands(SEED, cam.x, cam.z);
    const rings = bands.near.map((ring) => new Set(ring.map(treeKey)));
    const seams: [readonly [number, number], number][] = [[SEAM_LOD0, 0], [SEAM_LOD1, 1], [seamNear(NEAR_RADIUS), 2]];
    for (const [[lo, hi], inner] of seams) {
      const outer = inner === 2 ? null : rings[inner + 1]!;
      for (const t of bands.near[inner]!) {
        const d = dist(t);
        if (outer !== null && d >= lo - SEAM_PAD && d < hi + SEAM_PAD) expect(outer.has(treeKey(t)), `${d}`).toBe(true);
        if (outer !== null && d < lo - SEAM_PAD) expect(outer.has(treeKey(t)), `${d}`).toBe(false);
      }
    }
    // A LOD2 tree near the outer seam is also an impostor (on- or off-lattice).
    const imps = new Set([...bands.impostors, ...bands.impostorsFill].map(treeKey));
    const [lo] = seamNear(NEAR_RADIUS);
    for (const t of bands.near[2]!) {
      if (dist(t) >= lo - SEAM_PAD) expect(imps.has(treeKey(t))).toBe(true);
    }
  });

  it("fills every cell inside IMPOSTOR_FULL_RADIUS and only the lattice beyond it", () => {
    const bands = collectBands(SEED, cam.x, cam.z);
    const s = IMPOSTOR_CELL_STRIDE;
    for (const t of bands.impostorsFill) {
      const cx = Math.floor(t.x / TREE_CELL);
      const cz = Math.floor(t.z / TREE_CELL);
      expect(cx % s === 0 && cz % s === 0, "fill holds off-lattice cells only").toBe(false);
      expect(dist(t)).toBeLessThan(IMPOSTOR_FULL_RADIUS + SEAM_PAD);
      expect(dist(t)).toBeGreaterThanOrEqual(seamNear(NEAR_RADIUS)[0] - SEAM_PAD);
    }
    for (const t of bands.impostors) {
      const cx = Math.floor(t.x / TREE_CELL);
      const cz = Math.floor(t.z / TREE_CELL);
      expect(cx % s === 0 && cz % s === 0, "lattice impostors sit on the lattice").toBe(true);
    }
    expect(bands.impostorsFill.length).toBeGreaterThan(bands.impostors.length / 2);
  });

  it("routes saplings and snags beyond the near radius into the impostor lists; logs never", () => {
    const bands = collectBands(SEED, cam.x, cam.z);
    const all = [...bands.impostors, ...bands.impostorsFill];
    const cohorts = new Set(all.map((t) => t.cohort));
    expect(cohorts.has(COHORT_GIANT)).toBe(true);
    expect(cohorts.has(COHORT_SAPLING)).toBe(true);
    expect(cohorts.has(COHORT_SNAG)).toBe(true);
    expect(cohorts.has(COHORT_LOG)).toBe(false);
    for (const t of bands.deadwood) expect(dist(t)).toBeLessThan(NEAR_RADIUS + SEAM_PAD);
    for (const t of bands.saplings.flat()) expect(dist(t)).toBeLessThan(NEAR_RADIUS + SEAM_PAD);
  });

  it("holds the fill budget nearest-first", () => {
    const bands = collectBands(SEED, cam.x, cam.z);
    expect(bands.impostorsFill.length).toBeLessThanOrEqual(IMPOSTOR_FILL_BUDGET_MAX);
    for (let i = 1; i < bands.impostorsFill.length; i++) {
      expect(dist(bands.impostorsFill[i]!)).toBeGreaterThanOrEqual(dist(bands.impostorsFill[i - 1]!) - 1e-9);
    }
  });
});

describe("understory membership is padded by SEAM_PAD", () => {
  it("reaches up to UNDERSTORY_RADIUS + SEAM_PAD from the snapped origin, never beyond, and at least one instance exceeds UNDERSTORY_RADIUS at a dense camera", () => {
    // Membership used to be the one edge not padded by SEAM_PAD, while the
    // understory out-band [52, 65] (13 m) is narrower than SEAM_PAD itself
    // (≈14.14 m) — a fern could join the list already well inside its
    // visible band, appearing already partly dithered-in instead of fading
    // from zero. Padding admits ferns up to SEAM_PAD past UNDERSTORY_RADIUS
    // (measured against the snapped origin, not the true eye), which is
    // exactly what this test pins.
    const cam = { x: 2500, z: 2500 };
    const { x: ax, z: az } = bandsOrigin(cam.x, cam.z);
    const bands = collectBands(SEED, cam.x, cam.z);
    expect(bands.understory.length).toBeGreaterThan(0);
    let sawBeyondRadius = false;
    for (const t of bands.understory) {
      const d = Math.hypot(t.x - ax, t.z - az);
      expect(d, `${d}`).toBeLessThanOrEqual(UNDERSTORY_RADIUS + SEAM_PAD);
      if (d > UNDERSTORY_RADIUS) sawBeyondRadius = true;
    }
    expect(sawBeyondRadius).toBe(true);
  });
});
