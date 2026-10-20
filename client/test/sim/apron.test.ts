import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { roadFrameAt } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, activeTerrainVariant } from "../../src/sim/terrain.js";
import {
  BOWL_U_MAX, BOWL_Z_HALF,
  APRON_Z_HALF, APRON_Z_FADE, APRON_CLIFF_U, APRON_CLIFF_FADE,
} from "../../src/sim/bowl.js";
import { checkDerivatives, TOL_RATIO } from "./helpers/derivatives.js";
import { fbm2d } from "../../src/sim/field.js";
import { roadOffsetD } from "../../src/sim/road.js";
import {
  BLEND_START, BLEND_END_BAY, BLEND_END_HEADLAND,
  COAST_X, COAST_WARP_AMPLITUDE, COAST_WARP_WAVELENGTH, COAST_WARP_OCTAVES,
} from "../../src/sim/olympic.js";
import { PROBE_SEEDS } from "./apronSweep.js";

/**
 * The apron's road, derivatives and bounds. THE APRON SCAN, the 205-seed
 * sweep that says the escarpment is gone, is `apronSweep.ts`, run in parts
 * (`apronSweep.part<k>.test.ts`).
 */
setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

function roadX(seed: number, z: number): number {
  return activeTerrainVariant().roadCenterX!(seed, z);
}

describe("the apron", () => {
  /**
   * THE ROAD IS NOT PART OF THE APRON. `roadOffsetD`'s coast offset is
   * ROAD_WINDOW_FRACTION of the blend window, so pulling the window out to
   * APRON_BLEND_END inside the trail's z-window once moved THE HIGHWAY
   * ITSELF inland with it — 32–50 m at the anchor, and, worse, across the
   * window's fade at z ≈ ±660 the
   * centreline swung at |d x / d z| up to 0.999: a 45° jog in a coastal highway
   * whose worst bend anywhere else is 0.37. `coastFrame` now returns two
   * windows and only `olympicBaseFrom`'s terrain blend reads the aproned one.
   *
   * The oracle below is the PRE-APRON formula, rebuilt from the variant's own
   * exported tunables — the headland/bay blend, nothing else — so this test
   * fails if any road reader ever picks the aproned window up again.
   */
  const preApronRoadX = (seed: number, z: number): number => {
    const warp = fbm2d(0.318, z / COAST_WARP_WAVELENGTH, seed ^ 0x0cea, COAST_WARP_OCTAVES);
    const coastlineX = COAST_X + COAST_WARP_AMPLITUDE * warp.v;
    const head = 0.5 + 0.5 * warp.v;
    const blendEnd = BLEND_END_HEADLAND + (BLEND_END_BAY - BLEND_END_HEADLAND) * head;
    return coastlineX + roadOffsetD(seed, z, BLEND_START, blendEnd, 0).dr;
  };

  it("leaves the highway exactly where it was, inside the window and out", () => {
    // A dozen z inside the window (|z| < APRON_Z_HALF), across its fade, and
    // well outside it, on two seeds. BIT-identical, not close: the apron may
    // not move the road by so much as an ulp.
    const ZS = [0, 120, -250, 400, -520, 600, -650, 660, 700, -760, 1200, -2000];
    let checked = 0;
    for (const seed of [0x5eed, 4242]) {
      for (const z of ZS) {
        expect(roadX(seed, z), `seed ${seed} z ${z}`).toBe(preApronRoadX(seed, z));
        checked++;
      }
    }
    expect(checked).toBe(24);
  });

  it("keeps the centreline's drift under a coastal highway's, right through the window's fade", () => {
    // |d roadCenterX / dz| over z ∈ [−1000, 1000] at 5 m, the probe seeds,
    // central difference over ±0.5 m.
    //
    // The ceiling is 0.5, not the tighter 0.4: measured over exactly
    // this sweep the RESTORED (pre-apron) road's own worst is **0.479** — seed
    // 12345 at z = 825, on the coast warp itself, 175 m outside the apron's
    // window and nothing to do with it — so 0.4 would fail the control. With
    // the aproned window in the road the same sweep reads **1.020** (seed
    // 12345, z = −650, exactly on the window's fade), so 0.5 catches the defect
    // this test exists for with a factor of two to spare.
    let worst = 0, worstSeed = 0, worstZ = 0;
    for (const seed of PROBE_SEEDS) {
      for (let z = -1000; z <= 1000; z += 5) {
        const d = Math.abs((roadX(seed, z + 0.5) - roadX(seed, z - 0.5)) / 1);
        if (d > worst) { worst = d; worstSeed = seed; worstZ = z; }
      }
    }
    expect(worst, `worst |dx/dz| ${worst.toFixed(3)} at seed ${worstSeed}, z ${worstZ}`).toBeLessThanOrEqual(0.5);
  });

  it("returns exact analytic derivatives across the z-fade and the cliff fade", () => {
    const pts: Array<[number, number]> = [];
    const DERIV_SEED_Z = [605, 630, 650, 680, 699, -612, -655, -690, 0, 300];
    const US = [40, 60, 120, 250, 400, 455, 470, 490, 505, 520, 700];
    for (const z of DERIV_SEED_Z) for (const u of US) pts.push([roadX(0x5eed, z) + u, z]);
    // checkDerivatives samples its own DERIV_SEED; the road x above only has to
    // land the points on the apron, which every seed's road does within ±100 m.
    const { worst, steepest } = checkDerivatives("olympic", pts);
    expect(worst).toBeLessThan(TOL_RATIO * steepest);
  });

  it("keeps the flat window and the cliff-return band inside the bowl, and roadFrameAt reads u along x with unit slope", () => {
    // Structural constant relations, not a field measurement: the window's
    // flat region (where W = 1, apronWindowD) reaches at least to the
    // bowl's own z-edge, and the cliff-free band's own fade ends inside
    // BOWL_U_MAX — both describe ground the bowl's other stages actually
    // reach, rather than a window narrower than the region it is meant to
    // cover.
    // These particular values (APRON_Z_HALF 700 - APRON_Z_FADE 100
    // = 600 == BOWL_Z_HALF 600) make this an equality, not a strict
    // inequality — the flat part of the window (W = 1) reaches EXACTLY to
    // the bowl's edge, which is enough: apronWindowD's `<=` boundary keeps
    // W = 1 there too (smootherstepD returns v = 0 at x = edge0 exactly).
    expect(APRON_Z_HALF - APRON_Z_FADE).toBeGreaterThanOrEqual(BOWL_Z_HALF);
    expect(APRON_CLIFF_U + APRON_CLIFF_FADE).toBeLessThan(BOWL_U_MAX);
    // roadFrameAt's u tracks x with unit slope (∂u/∂x = 1) at any z, apron
    // or not: a road offset of 800 m reads back as u ≈ 800.
    const { u } = roadFrameAt(0x5eed, roadX(0x5eed, 0) + 800, 0);
    expect(u).toBeCloseTo(800, 6);
  });
});
