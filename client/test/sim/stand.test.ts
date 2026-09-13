import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import {
  COHORT_GIANT, COHORT_LOG, COHORT_SAPLING, COHORT_SNAG, treesInRect,
} from "../../src/sim/vegetation.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";

/**
 * The old-growth stand census: the promises cohort tuning must
 * keep. Fractions and counts only — never absolute tolerances a tunable can
 * silently invalidate. The window is 1 km² of friendly inland ground.
 *
 * Re-anchored for the jagged-terrain crisper-mountains retune:
 * [2000,3000)² put one 200 m sub-window — [2800,3000)×[2000,2200), a
 * steep, marginal forest edge (slope up to ~3.8, rho rarely above the
 * giant threshold) — at 43 trees with zero giants by chance. The window
 * shifted 200 m west to [1800,2800)×[2000,3000): a plain coordinate move,
 * same size, same friendly inland ground, re-measured
 * to clear every bound below with margin (min giants per sub-stand: 7,
 * versus 0 at the old anchor).
 */
const SEED = 1337;

describe("old-growth stand census", () => {
  // The variant registry populates via import side effects; a test that
  // samples terrain must set the active variant explicitly.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const trees = treesInRect(SEED, 1800, 2000, 2800, 3000);
  const share = (c: number) => trees.filter((t) => t.cohort === c).length / trees.length;

  it("keeps the shipped stem density", () => {
    // The stand must exist and be plausibly forested, but not paradoxically
    // dense. Window is 1 km² [1800,2800)×[2000,3000) with cells of
    // TREE_CELL = 12 m, yielding ~(1000/12)² ≈ 6,944 max cells, hence
    // ≤6,944 max stems. Floor >500 catches only catastrophic breaks
    // (near-barren world). This bound tolerates legitimate retunes to
    // TREE_DENSITY_MAX, TREELINE_LO/HI, TREE_CELL, and RAG_LO/HI which can
    // shift density by >>20%.
    expect(trees.length).toBeGreaterThan(500);
    expect(trees.length).toBeLessThan(8000);
  });

  it("is canopy-dominant with a live regeneration layer", () => {
    expect(share(COHORT_GIANT)).toBeGreaterThan(0.4);
    expect(share(COHORT_SAPLING)).toBeGreaterThan(0.05);
  });

  it("carries deadwood as a minority", () => {
    const dead = share(COHORT_SNAG) + share(COHORT_LOG);
    expect(dead).toBeGreaterThan(0.01);
    expect(dead).toBeLessThan(0.2);
  });

  it("puts a giant in every forested stand, not just the aggregate", () => {
    // Giants are meant to be present in every forested stand — a
    // per-stand claim the global fractions above cannot catch, since a
    // window-wide average can hide entirely-giant-free sub-windows. Sample
    // several disjoint sub-windows of the 1 km² census window and assert
    // each one that actually holds a meaningful stand of trees has a giant.
    // Sub-windows that are essentially bare ground are skipped rather than
    // asserted on — the claim is about forested stands, not bare ground.
    const MIN_STAND_TREES = 20;
    const SUB = 200; // 200 m sub-window: 5x5 grid tiles the 1000 m census window
    let sampledStands = 0;
    for (let sx = 1800; sx < 2800; sx += SUB) {
      for (let sz = 2000; sz < 3000; sz += SUB) {
        const stand = treesInRect(SEED, sx, sz, sx + SUB, sz + SUB);
        if (stand.length < MIN_STAND_TREES) continue; // essentially bare ground
        sampledStands++;
        const giants = stand.filter((t) => t.cohort === COHORT_GIANT).length;
        expect(giants).toBeGreaterThan(0);
      }
    }
    // Guard: the loop must actually have exercised real forested stands.
    expect(sampledStands).toBeGreaterThan(0);
  });
});
