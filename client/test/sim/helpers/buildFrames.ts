/**
 * The builder's synthetic worlds, shared by the tests that drive `buildTrail`
 * on ground whose shape is known (`trailBuild.test.ts`, `trailBraid.test.ts`).
 *
 * Moved out of `trailBuild.test.ts` unchanged (2026-09-16) so the braid's own
 * test could build on the same flat frame.
 */
import { type BuildFrame } from "../../../src/sim/trailBuild.js";
import type { TerrainSample } from "../../../src/sim/terrain.js";

export const ROAD_X = -250;
/**
 * A synthetic world: a gentle plane rising inland (grade 0.1) with a steep
 * ridge across it at u ∈ [400, 440] (grade 2) broken by a gap at z ∈ [−60, −20],
 * and a knoll 40 m high at (u 700, z 300).
 */
function frame(seed: number): BuildFrame {
  void seed;
  const sample = (x: number, z: number): TerrainSample => {
    const u = x - ROAD_X;
    let h = 20 + 0.1 * u, dx = 0.1, dz = 0;
    if (u >= 400 && u <= 440 && !(z >= -60 && z <= -20)) { h += 2 * (u - 400); dx += 2; }
    const kx = u - 700, kz = z - 300, k2 = kx * kx + kz * kz;
    // A knoll: h += 40·s², s = 1 − k²/R²; ∂h/∂kx = 80·s·(−2kx/R²).
    if (k2 < 150 * 150) { const s = 1 - k2 / (150 * 150); h += 40 * s * s; dx += -160 * s * kx / (150 * 150); dz += -160 * s * kz / (150 * 150); }
    return { h, dx, dz };
  };
  return {
    roadCenterX: () => ROAD_X,
    sample,
    treeDensity: (x, z) => (x - ROAD_X > 600 && z > 100 && Math.hypot(x - ROAD_X - 700, z - 300) > 160 ? 1 : 0.5),
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    // This world's boulders do not come from a slope gate, so no disc may be
    // skipped on the grid's gradients: 0 claims nothing is ever exactly zero.
    boulderSlopeMin: 0,
  };
}
/** The ridge world: `frame(1)`, unchanged. */
export function ridgeFrame(): BuildFrame {
  return frame(1);
}
/** A gentle ripple superimposed on the base grade: amplitude and period small
 * enough to stay well clear of every slope cap this fixture must satisfy, but
 * with real curvature — unlike a bare incline (an exact plane, zero
 * deviation from any chord), `simplify`'s Douglas-Peucker pass has a reason
 * to KEEP an intermediate stem node roughly every quarter period. Used only
 * by `flatFrame` (2026-09-11 — see its own comment). */
const RIPPLE_AMP = 8;
const RIPPLE_PERIOD = 250;
function ripple(u: number): { dh: number; ddx: number } {
  const w = (2 * Math.PI) / RIPPLE_PERIOD;
  return { dh: RIPPLE_AMP * Math.sin(w * u), ddx: RIPPLE_AMP * w * Math.cos(w * u) };
}
/** The plain plane, no ridge and no knoll: grade 0.05 alone, uniform tree
 * cover, the same boulder field at (500, 200), with the ripple above added
 * to the base incline.
 *
 * Grade lowered from 0.1 to 0.05 here, and the ripple added (2026-09-11):
 * this fixture's grade was pinned at 0.1, flat, before the loop feature
 * stage existed.
 *
 * Bug 3: POND_SLOPE_MAX is 0.08 — a uniform 0.1 grade admits no pond
 * candidate at all (every disc cell reads exactly 0.1 > 0.08), so seed
 * 0x5eed's plan (which draws a pond first) could never build its full plan
 * here, no matter how the routing itself is written. 0.05 clears
 * POND_SLOPE_MAX with margin and stays well under MEADOW_SLOPE_MAX (0.12).
 *
 * Bug 4: a bare incline is an exact PLANE — every stem node between two
 * bends collapses into one edge under `simplify`'s tolerance, because there
 * is truly zero deviation from any chord. On this fixture the routed stem
 * needed no turn for ~760 m (measured: `stemAcc` read `[0, 763, 817, ...]`),
 * so a loop's junction search — which only ever REUSES an existing stem
 * node — had exactly two nodes to choose from across most of
 * the stem's length, snapping A and B hundreds of metres from the feature
 * itself; both half-loops then routed through the same direct corridor and
 * were rejected as 100% overlapping (measured directly: seed 0x5eed, loops 0
 * and 2, every candidate's h2 was rejected at `shared/total = 4/4`). Real
 * terrain never collapses this way — the 227-seed sweep's stems carry 6 to
 * ~90 nodes because real ground always has some curvature the simplifier has
 * to respect — so this is a defect of an unrealistically perfect plane, not
 * of the loop algorithm; the ripple (amplitude 8 m, period 250 m) restores
 * the kind of curvature real terrain always has. Its own worst-case slope
 * contribution is RIPPLE_AMP · 2π / RIPPLE_PERIOD ≈ 0.201, but that peaks
 * only very close to the ripple's zero-crossings — a candidate disc centred
 * near a crest or trough (where a real loop candidate's flattest-first score
 * pulls it) reads close to the 0.05 base grade alone; measured directly
 * after this change: every one of the four new loop tests passes, with
 * candidate counts in the dozens at every band. Nothing else this fixture's
 * pre-existing tests check depends on the exact grade or on the
 * plane being exact — the peak's band is a fixed u-range, the stem-length
 * floor (STEM_LEN_MIN * 0.8) has slack either way, and the crest still reads
 * as the highest node (the peak's 50–80 m of rise dwarfs an 8 m ripple). */
export function flatFrame(): BuildFrame {
  return {
    roadCenterX: () => ROAD_X,
    sample: (x) => {
      const u = x - ROAD_X;
      const r = ripple(u);
      return { h: 20 + 0.05 * u + r.dh, dx: 0.05 + r.ddx, dz: 0 };
    },
    treeDensity: () => 0.5,
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    boulderSlopeMin: 0,
  };
}
/** The flat frame walled off at |z| >= 59: a strip narrower than two
 * LOOP_LATERAL_MIN (60 + 60 = 120 total), so no loop candidate's lateral
 * offset ever fits on either side of the pad→crest axis — every loop kind is
 * dropped, and the stem (which runs close to z = 0) still gets through.
 *
 * 50 -> 59 (2026-09-11): at 50 the scenery pass (the
 * stand/talus, unrelated to loops, still real code this fixture also drives)
 * could find no candidate at all and threw — the usable band clear of the
 * trail is [sceneryClear, WALL_Z] = [37, WALL_Z] (LANDMARK_DISC_RADIUS +
 * TRAIL_CORRIDOR_HALF), only 13 m wide at 50, narrower than
 * LANDMARK_CANDIDATE_STRIDE's own 32 m step (4 grid cells) — no sampled
 * candidate cell could ever land in it. 59 still blocks every loop (< 60)
 * and widens the band to 22 m, enough in practice (measured: the loop test
 * now finds a stand and a talus and every loop is still dropped). */
export function narrowFrame(): BuildFrame {
  const WALL_Z = 59;
  return {
    roadCenterX: () => ROAD_X,
    sample: (x, z) => {
      const az = Math.abs(z);
      if (az <= WALL_Z) return { h: 20 + 0.1 * (x - ROAD_X), dx: 0.1, dz: 0 };
      const over = az - WALL_Z;
      return { h: 20 + 0.1 * (x - ROAD_X) + 5 * over, dx: 0.1, dz: z >= 0 ? 5 : -5 };
    },
    treeDensity: () => 0.5,
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    boulderSlopeMin: 0,
  };
}
