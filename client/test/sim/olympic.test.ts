import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import "../../src/sim/olympic.js";
import { denseSample } from "../../src/sim/montane.js";
import { fbm2d } from "../../src/sim/field.js";
import { roadOffsetD, gradeSplineD, ROAD_CORRIDOR_HALF, ROAD_BED_HALF, ROAD_LATTICE } from "../../src/sim/road.js";
import {
  olympicBaseSample, roadGradeAt, duneD, DUNE_AMPLITUDE, DUNE_ROAD_NEAR, DUNE_ROAD_FAR, SEA_LEVEL,
  DUNE_ALT_IN_LO, DUNE_ALT_OUT_HI,
} from "../../src/sim/olympic.js";
import {
  checkDerivatives, DERIV_SEED as SEED, sweepPoints, TOL_RATIO, variantOrThrow, H,
} from "./helpers/derivatives.js";
import { centerlineX } from "./helpers/roadLine.js";
import {
  CLIFF_ALT_LO, CLIFF_ROAD_FAR, CLIFF_OUT_ALT_LO, cliffD, cliffMaskD,
} from "../../src/sim/cliffs.js";
import { SPAWN_FREEBOARD } from "../../src/sim/spawn.js";
import { POND_APRON, MEADOW_RIM } from "../../src/sim/features.js";
import {
  inBowl, TRAILHEAD_U, TRAILHEAD_RADIUS, TRAILHEAD_FADE, TRAIL_Z_ANCHOR, apronKeepD,
} from "../../src/sim/bowl.js";
import { roadFrameAt, olympicPreTrailSample, bowlFor } from "../../src/sim/olympic.js";
import { TRAIL_CORRIDOR_HALF } from "../../src/sim/trail.js";

// Floors set to roughly half the measured counts (generous margin), per
// SEED = 0x5eed against the sweeps below.
/** Measured identical/cliffed split of the 60-point inland sweep: 32/27
 * (one point excluded from both — see the loop's trailing comment). */
const FLOOR_IDENTICAL = 16;
const FLOOR_CLIFFED = 13;
/** Measured `hot` count (mask.v > 0.05) of the cliff-hot derivative sweep,
 * out of up to 150 qualifying points: 10. */
const FLOOR_HOT = 5;
/** Measured `hot` count (mask.v > 0.05) of the 30–90 m suppression-annulus
 * sweep below (15 positive-offset points across 3 z's): 12. */
const FLOOR_ANNULUS_HOT = 6;
/** Measured point count of the dune road-annulus sweep below (61 z's × 42
 * inland offsets = 2562 candidates, filtered to |u| strictly inside
 * (DUNE_ROAD_NEAR, DUNE_ROAD_FAR)): 305. */
const FLOOR_DUNE_ANNULUS = 150;
/** Measured point count of the dune-delta beach sweep below (121 z's × 24
 * inland offsets, filtered to points outside the road corridor whose
 * pre-dune height is below CLIFF_OUT_ALT_LO): 2545. */
const FLOOR_DUNE_DELTA = 1200;

/** Dense points across the shore, surf and (later) stack bands. */
function coastalSweep(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = -12; i <= 12; i++) {
    pts.push([-400 + i * 61.7 + 0.29, i * 517.3 - 0.83]);
    pts.push([-560 + i * 23.9 + 0.11, i * 231.9 + 0.47]);
  }
  return pts;
}

describe("variant olympic", () => {
  it("is registered and declares sea level", () => {
    expect(variantOrThrow("olympic").waterLevel).toBe(0);
  });

  it("declares coastal tunables on top of dense's", () => {
    const t = variantOrThrow("olympic").tunables;
    expect(t.COAST_X).toBe(-400);
    expect(t.PEAK_HEIGHT).toBe(1100); // dense raises the peak ceiling
    expect(t.UPLIFT_WAVELENGTH).toBe(1792);
    expect(t.UPLIFT_FLOOR).toBe(0);
    for (const k of [
      "ROAD_WINDOW_FRACTION", "ROAD_WOBBLE", "ROAD_WOBBLE_WAVELENGTH",
      "ROAD_WOBBLE_OCTAVES", "ROAD_SALT", "ROAD_LATTICE",
      "ROAD_BED_HALF", "ROAD_CORRIDOR_HALF",
    ]) expect(t[k], k).toBeTypeOf("number");
    for (const k of [
      "CLIFF_PERIOD", "CLIFF_BENCH", "CLIFF_RISER_HALF",
      "CLIFF_PHASE_AMP", "CLIFF_PHASE_WAVELENGTH", "CLIFF_PHASE_OCTAVES", "CLIFF_PHASE_SALT",
      "CLIFF_ALT_LO", "CLIFF_ALT_HI",
      "CLIFF_MTN_STRENGTH", "CLIFF_MTN_WAVELENGTH", "CLIFF_MTN_OCTAVES",
      "CLIFF_MTN_LO", "CLIFF_MTN_HI", "CLIFF_MTN_SALT",
      "CLIFF_OUT_STRENGTH", "CLIFF_OUT_WAVELENGTH", "CLIFF_OUT_OCTAVES",
      "CLIFF_OUT_LO", "CLIFF_OUT_HI", "CLIFF_OUT_ALT_LO", "CLIFF_OUT_ALT_HI", "CLIFF_OUT_SALT",
      "CLIFF_ROAD_NEAR", "CLIFF_ROAD_FAR",
    ]) expect(t[k], k).toBeTypeOf("number");
  });

  it("returns exact analytic derivatives across wide and coastal sweeps", () => {
    const { worst, steepest } = checkDerivatives("olympic", [...sweepPoints(), ...coastalSweep()]);
    expect(steepest).toBeGreaterThan(0.3);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });

  it("is deterministic and finite over large and negative coordinates", () => {
    const v = variantOrThrow("olympic");
    for (const [x, z] of [[91237.4, -88411.9], [-64203.1, 71911.7], [-95001.3, -93777.1]] as const) {
      const a = v.sample(SEED, x, z);
      const b = v.sample(SEED, x, z);
      expect(Number.isFinite(a.h)).toBe(true);
      expect(a.h).toBe(b.h);
      expect(a.dx).toBe(b.dx);
      expect(a.dz).toBe(b.dz);
    }
  });

  it("is bit-identical to dense inland wherever the cliff mask is cold", () => {
    // COAST_X −400 + warp ≤ 220 + blend ≤ 500 ⇒ x ≥ 400 is always inland.
    // The mask oracle reuses the same dense sample the identity is checked
    // against — the mask reads the BASE height, which inland IS dense.
    // roadDistance = |u|, and u only enters the mask through u², so the
    // unsigned distance is exact here.
    const v = variantOrThrow("olympic");
    let identical = 0;
    let cliffed = 0;
    const total = 60;
    for (let i = 0; i < total; i++) {
      const x = 400 + i * 151.7 + 0.37;
      const z = (i - 30) * 313.9 - 0.61;
      const dist = v.roadDistance!(SEED, x, z);
      if (dist < ROAD_CORRIDOR_HALF + 1) continue;
      const m = denseSample(SEED, x, z);
      const o = v.sample(SEED, x, z);
      if (cliffMaskD(SEED, x, z, dist, 0, m).v === 0) {
        identical++;
        expect(o.h).toBe(m.h);
        expect(o.dx).toBe(m.dx);
        expect(o.dz).toBe(m.dz);
      } else if (o.h !== m.h) {
        cliffed++;
      }
      // Else: the mask is nonzero but so small (the saturating clamp's cubic
      // falloff near mV + oV = 0) that m.v · Δ falls below the ULP of h and
      // the sum rounds back to h exactly — neither a clean identity nor a
      // measurable cliff. Excluded from both counts; measured once at
      // (6013.27, 2196.69): mask.v = 9.5e-17, perturbation 2.3e-16 against
      // h ≈ 127 (ULP ≈ 2.8e-14). Not a correctness bug.
    }
    // Teeth both ways: the sweep must exercise the identity AND the cliff
    // stage, or it proves nothing about one of them. Floors set from the
    // measured split with generous margin.
    expect(identical).toBeGreaterThanOrEqual(FLOOR_IDENTICAL);
    expect(cliffed).toBeGreaterThanOrEqual(FLOOR_CLIFFED);
  });

  it("crosses the waterline near the nominal coast for every sampled z", () => {
    const v = variantOrThrow("olympic");
    for (let zi = -5; zi <= 5; zi++) {
      const z = zi * 613.3 + 0.41;
      let crossed = false;
      let prev = v.sample(SEED, -900, z).h;
      for (let x = -899; x <= -100; x++) {
        const h = v.sample(SEED, x, z).h;
        if (prev < 0 && h >= 0) crossed = true;
        prev = h;
      }
      expect(crossed).toBe(true); // warp amplitude 220 keeps it inside [−900, −100]
    }
  });

  it("reaches open-water depth far offshore", () => {
    const v = variantOrThrow("olympic");
    let lo = Infinity;
    for (let zi = -10; zi <= 10; zi++) {
      lo = Math.min(lo, v.sample(SEED, -2000, zi * 400.7 + 0.19).h);
    }
    expect(lo).toBeLessThan(-20); // the −25 m floor, minus slack for the blend tails
  });

  it("keeps the inland floor above the sand bands", () => {
    // Beyond the widest blend window: dense's own floor, measured +13.6 m.
    const v = variantOrThrow("olympic");
    let lo = Infinity;
    for (let xi = 0; xi <= 12; xi++) {
      for (let zi = -12; zi <= 12; zi++) {
        lo = Math.min(lo, v.sample(SEED, 400 + xi * 500.3, zi * 500.9 + 0.23).h);
      }
    }
    expect(lo).toBeGreaterThan(10);
  });

  it("declares dune tunables", () => {
    const t = variantOrThrow("olympic").tunables;
    for (const k of [
      "DUNE_AMPLITUDE", "DUNE_WAVELENGTH_X", "DUNE_WAVELENGTH_Z", "DUNE_OCTAVES",
      "DUNE_ALT_IN_LO", "DUNE_ALT_IN_HI", "DUNE_ALT_OUT_LO", "DUNE_ALT_OUT_HI",
      "DUNE_ROAD_NEAR", "DUNE_ROAD_FAR",
      // The salt belongs here for the same reason CLIFF_PHASE_SALT,
      // CLIFF_OUT_SALT and ROAD_SALT do: changing it moves the field, so it
      // must move the level id.
      "DUNE_SALT",
    ]) expect(t[k], k).toBeTypeOf("number");
    // The window must close below the altitude where cliffD wakes up
    // (CLIFF_OUT_ALT_LO = 12), or dunes could push ground into the cliff band.
    expect(t.DUNE_ALT_OUT_HI as number).toBeLessThan(CLIFF_OUT_ALT_LO);
    // And it must open above the waterline, so no dune sits in the surf.
    expect(t.DUNE_ALT_IN_LO as number).toBeGreaterThan(0);
  });
});

describe("sea stacks", () => {
  /** Strict local maxima above +8 m on a 10 m grid over a rectangle of the
   * offshore band. */
  function stackMaxima(x0: number, x1: number): number {
    const v = variantOrThrow("olympic");
    const step = 10;
    const nx = Math.round((x1 - x0) / step);
    const nz = 600;
    const h: number[][] = [];
    for (let iz = 0; iz <= nz; iz++) {
      const row: number[] = [];
      for (let ix = 0; ix <= nx; ix++) {
        row.push(v.sample(SEED, x0 + ix * step, -3000 + iz * step).h);
      }
      h.push(row);
    }
    let count = 0;
    for (let iz = 1; iz < nz; iz++) {
      for (let ix = 1; ix < nx; ix++) {
        const c = h[iz]![ix]!;
        if (c <= 8) continue;
        if (
          c > h[iz]![ix - 1]! && c > h[iz]![ix + 1]! &&
          c > h[iz - 1]![ix]! && c > h[iz + 1]![ix]!
        ) count++;
      }
    }
    return count;
  }

  it("raises stacks above the water inside the band", () => {
    // West edge −1100 clears the band's far edge for every possible warp
    // (COAST_X − 220 − 280 = −900). The east edge stops at −400 rather than
    // the band's nearest possible edge (−220): east of ≈ −330 headland-blend
    // bluffs legitimately exceed +8 m (228 such maxima measured with stacks
    // off) and would swamp the stack count. Measured with stacks off, this
    // rectangle holds zero maxima, so everything counted here is a stack.
    const n = stackMaxima(-1100, -400);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(80);
  });

  it("grows nothing above water west of the band", () => {
    // Westmost possible band edge: COAST_X − 220 − 280 = −900; sweep beyond it.
    // "Zero outside the band" is tested seaward only, deliberately:
    // EAST of the band is beach and blend, where montane bluffs legitimately
    // exceed +8 m, so a symmetric assertion would be false by design.
    expect(stackMaxima(-2400, -1400)).toBe(0);
  });

  /** Points where a stack column crosses the band's fade ramps, so the
   * window-gradient term (bandDd·st.v) is live in dx/dz. Found by scanning
   * the band for analytic-vs-numeric divergence under the mutant that drops
   * that term; without them no sweep point exercises it and the mutant
   * survives. */
  function stackEdgeSweep(): Array<[number, number]> {
    return [
      [-493.87, -1865.71],
      [-487.87, -1872.71],
      [-595.87, 409.29],
      [-598.87, 409.29],
    ];
  }

  it("still returns exact analytic derivatives with stacks on", () => {
    const { worst, steepest } = checkDerivatives("olympic", [
      ...sweepPoints(), ...coastalSweep(), ...stackEdgeSweep(),
    ]);
    expect(steepest).toBeGreaterThan(0.3);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});

describe("coastDistance", () => {
  it("matches the sample's own waterline: d crosses 0 where h crosses 0", () => {
    const v = variantOrThrow("olympic");
    const cd = v.coastDistance;
    expect(cd).toBeDefined();
    for (let zi = -4; zi <= 4; zi++) {
      const z = zi * 731.7 + 0.21;
      // march x east; the first h>=0 crossing must sit within one step of d=0
      let crossed = false;
      let prevD = cd!(SEED, -900, z);
      for (let x = -899; x <= -100; x++) {
        const d = cd!(SEED, x, z);
        expect(d - prevD).toBeCloseTo(1, 6); // ∂d/∂x = 1 exactly
        if (prevD < 0 && d >= 0) {
          crossed = true;
          expect(Math.abs(v.sample(SEED, x, z).h)).toBeLessThan(0.2);
        }
        prevD = d;
      }
      expect(crossed).toBe(true); // warp amplitude 220 keeps d=0 inside the scan
    }
  });

  it("is deep-inland-positive and open-ocean-negative", () => {
    const cd = variantOrThrow("olympic").coastDistance!;
    expect(cd(SEED, 2000, 0.5)).toBeGreaterThan(1000);
    expect(cd(SEED, -2000, 0.5)).toBeLessThan(-1000);
  });

  it("montane declares none", () => {
    expect(variantOrThrow("montane").coastDistance).toBeUndefined();
  });

  it("montane declares no road centerline either", () => {
    expect(variantOrThrow("montane").roadCenterX).toBeUndefined();
  });
});

describe("the endless highway", () => {
  const v = () => variantOrThrow("olympic");
  /** |u| via the public hook — the test's only road-position oracle. */
  const roadDist = (x: number, z: number) => v().roadDistance!(SEED, x, z);

  it("declares the road tunables on the variant record", () => {
    const t = v().tunables;
    for (const k of [
      "ROAD_WINDOW_FRACTION", "ROAD_WOBBLE", "ROAD_WOBBLE_WAVELENGTH",
      "ROAD_WOBBLE_OCTAVES", "ROAD_SALT", "ROAD_LATTICE",
      "ROAD_BED_HALF", "ROAD_CORRIDOR_HALF",
    ]) expect(t[k], k).toBeTypeOf("number");
  });

  it("exposes the centerline x where roadDistance is zero", () => {
    const centre = v().roadCenterX;
    expect(centre).toBeTypeOf("function");
    for (let z = -3000; z <= 3000; z += 37) {
      const x = centre!(SEED, z);
      expect(Number.isFinite(x)).toBe(true);
      // The relationship, not a number: the hook is where |u| vanishes …
      expect(roadDist(x, z)).toBeLessThan(1e-9);
      // … and u is measured along x with unit slope (∂u/∂x = 1), so a metre
      // east is a metre away. This is what a hook returning coastlineX alone
      // (dropping the road offset) cannot pass.
      expect(roadDist(x + 1, z)).toBeCloseTo(1, 9);
    }
  });

  it("outside the corridor AND the bowl is exactly the cliff stage over the pre-road field", () => {
    let cold = 0;
    let checked = 0;
    for (const [x, z] of sweepPoints()) {
      const dist = roadDist(x, z);
      if (dist < CLIFF_ROAD_FAR + 1) continue;
      const { u, uDz } = roadFrameAt(SEED, x, z);
      if (inBowl(u, z)) continue; // the bowl's stages own this ground now
      const b = olympicBaseSample(SEED, x, z);
      // 2026-09-09: cliffD now takes the
      // apron's keep, and the composed field passes the SIGNED road frame
      // (u, uDz), not the absolute distance with a zero derivative — the old
      // call (`dist, 0`) only agreed because this loop excludes |u| <
      // CLIFF_ROAD_FAR and the mask depends on u² alone; the signed frame is
      // what olympicSample actually passes.
      const c = cliffD(SEED, x, z, u, uDz, b, apronKeepD(u, uDz, z));
      const a = v().sample(SEED, x, z);
      expect(a.h).toBe(c.h);
      expect(a.dx).toBe(c.dx);
      expect(a.dz).toBe(c.dz);
      checked++;
      if (c === b) cold++;
    }
    // Measured at SEED = 0x5eed against sweepPoints() with the bowl excluded:
    // checked 233, cold 185. Floor set to roughly half the measured checked.
    expect(checked).toBeGreaterThanOrEqual(116);
    expect(cold).toBeGreaterThanOrEqual(3);
  });

  it("lays a flat bed at exactly the grade height", () => {
    for (const z of [-4800.5, -160, 0.25, 999.9, 12345.6]) {
      const xr = centerlineX(z);
      const g = roadGradeAt(SEED, z);
      for (const off of [0, 2.5, -2.5, ROAD_BED_HALF - 0.01, -(ROAD_BED_HALF - 0.01)]) {
        const s = v().sample(SEED, xr + off, z);
        expect(s.h).toBe(g.h);
        expect(s.dx).toBe(0);
        expect(s.dz).toBe(g.dz);
      }
    }
  });

  it("returns exact analytic derivatives across the corridor and lattice edges", () => {
    const pts: Array<[number, number]> = [];
    for (const z of [-1600.3, -37.9, 159.98, 160.02, 481.7, 7013.4]) {
      const xr = centerlineX(z);
      for (const off of [0, 4.1, ROAD_BED_HALF + 0.6, 14.9, ROAD_CORRIDOR_HALF - 0.4, -9.3, -(ROAD_CORRIDOR_HALF - 0.4)]) {
        pts.push([xr + off, z]);
      }
    }
    const { worst, steepest } = checkDerivatives("olympic", pts);
    expect(worst).toBeLessThan(TOL_RATIO * steepest);
  });

  it("returns exact analytic derivatives across cliff-hot and annulus sweeps", () => {
    const v = variantOrThrow("olympic");
    const pts: Array<[number, number]> = [];
    let hot = 0;
    for (let i = 0; i < 400 && pts.length < 150; i++) {
      const x = 900 + (i % 20) * 173.3 + 0.318;
      const z = (Math.floor(i / 20) - 10) * 487.9 - 0.947;
      const b = olympicBaseSample(SEED, x, z);
      if (b.h < CLIFF_ALT_LO) continue;
      const dist = v.roadDistance!(SEED, x, z);
      if (dist < CLIFF_ROAD_FAR) continue;
      if (cliffMaskD(SEED, x, z, dist, 0, b).v > 0.05) hot++;
      // Bracket each qualifying point so the sweep crosses risers and edges.
      pts.push([x, z], [x + 3.1, z - 2.7], [x - 5.3, z + 4.9]);
    }
    expect(hot).toBeGreaterThanOrEqual(FLOOR_HOT); // measured 10; the sweep has teeth
    // The 30–90 m suppression annulus at these three z's: R (road factor)
    // is nonzero here (r.v > 0), but the altitude gate (aM, aO) is zero at
    // every one of these 12 points — measured mask.v = 0 throughout — so
    // cliffMaskD takes the early return before ever touching rDx/rDz. These
    // points exercise the road-suppression early-return path, not the dR
    // chain rule; see the hot annulus sweep below for that.
    for (const z of [-3000.5, 200.5, 4400.5]) {
      const cx = centerlineX(z);
      pts.push([cx + 45, z], [cx + 75, z], [cx - 45, z], [cx - 75, z]);
    }
    // Hot annulus points, where s.v > 0 and the dR chain rule (cliffs.ts's
    // cliffMaskD `+ s.v * rDx` / `+ s.v * rDz` terms) is actually live.
    // Cliffs are an inland (mountain-side) feature: only the
    // positive (east) offset direction reaches the mask's altitude floor
    // within the annulus. Measured max base.h on the negative (west,
    // ocean-side) offset direction across a wide scan (10,001 z's, offsets
    // −31..−89 step 4, z step 91.13 m) is 8.17 m — under the outcrop gate's
    // 12 m floor — so no negative-offset point in this annulus can ever
    // exercise the term here; "both signs of the centerline" isn't
    // reachable in this annulus by the field's own geometry, not a gap in
    // the sweep.
    // mask.v measured at these (z, offset) pairs (SEED = 0x5eed):
    //   z=-43641.5: 45→0.030 55→0.157 70→0.597 75→0.765 85→0.977
    //   z=-42768.5: 45→0.030 55→0.157 70→0.603 75→0.775 85→0.985
    //   z=-42089.5: 45→0.030 55→0.157 70→0.603 75→0.775 85→0.985
    let annulusHot = 0;
    for (const z of [-43641.5, -42768.5, -42089.5]) {
      const cx = centerlineX(z);
      for (const off of [45, 55, 70, 75, 85]) {
        const x = cx + off;
        const b = olympicBaseSample(SEED, x, z);
        if (cliffMaskD(SEED, x, z, off, 0, b).v > 0.05) annulusHot++;
        pts.push([x, z]);
      }
    }
    expect(annulusHot).toBeGreaterThanOrEqual(FLOOR_ANNULUS_HOT); // measured 12; teeth
    const { worst, steepest } = checkDerivatives("olympic", pts);
    expect(worst).toBeLessThan(TOL_RATIO * steepest);
  });

  it("is query-order independent (the lattice memo is pure caching)", () => {
    // Two widely separated queries in both orders must agree bit-for-bit.
    const zA = 88_000.5, zB = -71_003.25;
    const xA = centerlineX(zA) + 3, xB = centerlineX(zB) - 7;
    const first = [v().sample(SEED, xA, zA), v().sample(SEED, xB, zB)];
    const second = [v().sample(SEED, xB, zB), v().sample(SEED, xA, zA)];
    expect(first[0]).toEqual(second[1]);
    expect(first[1]).toEqual(second[0]);
  });

  it("computes the grade line from the pre-road field at the centerline (independent oracle)", () => {
    // Rebuild the lattice from PUBLIC exports only — any slip in
    // latticeHFor's sampling position or field diverges immediately.
    // 2026-09-09: the ROAD's own
    // blend window is the headland/bay value again — this oracle once
    // pulled it out to APRON_BLEND_END inside the trail's z-window because the
    // variant did, and that is exactly the defect this fixed (the apron
    // was moving the highway). The terrain the oracle then samples,
    // `olympicBaseSample`, still sees the APRONED window inside it, which is
    // the point of the two-window split in `coastFrame`.
    const indep = (i: number): number => {
      const z = i * ROAD_LATTICE;
      const t = v().tunables;
      const warp = fbm2d(0.318, z / t.COAST_WARP_WAVELENGTH!, SEED ^ 0x0cea, t.COAST_WARP_OCTAVES!);
      const coastlineX = t.COAST_X! + t.COAST_WARP_AMPLITUDE! * warp.v;
      const b0 = t.BLEND_END_HEADLAND! + (t.BLEND_END_BAY! - t.BLEND_END_HEADLAND!) * (0.5 + 0.5 * warp.v);
      const { dr } = roadOffsetD(SEED, z, t.BLEND_START!, b0, 0);
      return olympicBaseSample(SEED, coastlineX + dr, z).h;
    };
    // Tolerance, not bit-exactness: latticeHFor passes d = dr while the
    // oracle's x − coastlineX re-derives it, differing by ~1 ulp (measured
    // agreement 4.3e-14; 1e-9 is a 20,000× margin, not a fudge).
    for (const z of [-7000.25, -480, 3.7, 1234.5, 44_000.9]) {
      expect(Math.abs(roadGradeAt(SEED, z).h - gradeSplineD(indep, z).h)).toBeLessThan(1e-9);
    }
  });

  it("keeps duneD out of olympicBaseFrom (guards the road grade spline from dune noise)", () => {
    // A numeric "roadGradeAt(SEED, z).h === olympicBaseSample(SEED, x, z).h"
    // comparison (the guard's originally-specified form) cannot work on this
    // codebase: road.ts's own doc comment says gradeSplineD "APPROXIMATES
    // rather than interpolates — deliberate" (a uniform cubic B-spline over
    // 4 lattice points, exact at a knot only when the 3 surrounding lattice
    // heights are collinear). Measured at the required i·ROAD_LATTICE sweep
    // (SEED = DERIV_SEED, i = −4..4): the spline-vs-point gap is already
    // 0.14–4.47 m from terrain curvature ALONE, no dunes involved — past
    // both a 1e-9 tolerance and the ~0.6 m of dune noise this guard exists
    // to catch, by orders of magnitude either way. No tolerance threads that
    // needle: loose enough to absorb the curvature gap is loose enough to
    // absorb the dune signal too.
    //
    // Independently, AT THOSE NINE POINTS the road's own pre-dune elevation
    // is 10.41–27.04 m — above DUNE_ALT_OUT_HI = 8 — so duneD is a
    // structural no-op there even under the exact mutation this guard is
    // meant to catch (verified by performing that mutation: the 9 measured
    // diffs above did not change at all). That is a fact about these nine
    // points and nothing more. It does NOT generalise along the coast:
    // sampling the pre-dune centerline height every 10 m over 30 km gives
    // min 5.07 m, p10 7.85 m, and 10.5% of it below DUNE_ALT_OUT_HI, so on
    // roughly a tenth of the coastline the altitude window IS open at the
    // centerline. What keeps duneD off the grade spline everywhere, not
    // just here, is the ROAD window: DUNE_ROAD_NEAR == ROAD_CORRIDOR_HALF,
    // so road.v is 0 at u = 0 whatever the elevation (see the duneD call
    // site's comment in olympic.ts). A numeric guard sited at points where
    // the altitude window is open would therefore still measure nothing —
    // but the reason is the road window, not the terrain being tall.
    //
    // So the guard here is structural: it reads olympic.ts's own source and
    // asserts olympicBaseFrom's body never calls duneD. That is exactly the
    // textual shape of the feared regression ("if someone later moves the
    // duneD call from olympicSample into olympicBaseFrom") — only
    // olympicSample may call duneD, gated by the true road-offset u/uDz, not
    // olympicBaseFrom gated by d/dDz. Verified to go RED under that precise
    // mutation.
    const src = readFileSync(new URL("../../src/sim/olympic.ts", import.meta.url), "utf8");
    const start = src.indexOf("function olympicBaseFrom(");
    const end = src.indexOf("function coastFrame(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain("duneD(");
  });
});

describe("beach dunes", () => {
  const FLAT = { h: 3, dx: 0.025, dz: 0 };

  it("is the identity below the window, inside it, and above it", () => {
    // Below the waterline: untouched.
    const low = duneD(SEED, -430.7, 88.3, 500, 0, { h: -2, dx: 0.015, dz: 0 });
    expect(low.h).toBe(-2);
    expect(low.dx).toBe(0.015);
    // Well inland (above DUNE_ALT_OUT_HI): untouched.
    const high = duneD(SEED, 812.3, -140.9, 500, 0, { h: 40, dx: 0.3, dz: 0.2 });
    expect(high.h).toBe(40);
    expect(high.dx).toBe(0.3);
    // Inside the window: perturbed.
    const mid = duneD(SEED, -390.1, 211.7, 500, 0, FLAT);
    expect(mid.h).not.toBe(FLAT.h);
    expect(Math.abs(mid.h - FLAT.h)).toBeLessThanOrEqual(DUNE_AMPLITUDE);
  });

  it("is the identity inside the road corridor", () => {
    const on = duneD(SEED, -390.1, 211.7, 0, 0, FLAT);
    expect(on.h).toBe(FLAT.h);
    expect(on.dx).toBe(FLAT.dx);
    expect(on.dz).toBe(FLAT.dz);
  });

  /**
   * A beach sweep whose points are chosen so that `olympicBaseSample` is an
   * EXACT pre-dune oracle for the composed field, making `sample().h −
   * olympicBaseSample().h` the dune's own contribution to the metre rather
   * than an approximation of it. Three facts make that exact:
   *   - `olympicSample` builds `base` with `olympicBaseFrom`, which is what
   *     `olympicBaseSample` returns;
   *   - `cliffD` returns `base` bit-exactly when `base.h < CLIFF_OUT_ALT_LO`
   *     (cliffs.ts:193), which every kept point satisfies;
   *   - outside `|u| >= ROAD_CORRIDOR_HALF` `olympicSample` returns `duned`
   *     without calling `corridorD` at all.
   * So on these points composed = base + dune, exactly, with no other stage
   * contributing a single ulp.
   */
  function duneDeltaSweep(): Array<{ dh: number; ddx: number; ddz: number }> {
    const v = variantOrThrow("olympic");
    const out: Array<{ dh: number; ddx: number; ddz: number }> = [];
    for (let i = -60; i <= 60; i++) {
      const z = i * 41.3 + 0.29;
      const d = v.coastDistance!(SEED, 0, z);
      for (let inland = 10; inland <= 56; inland += 2) {
        const x = 0 - d + inland;
        if (v.roadDistance!(SEED, x, z) < ROAD_CORRIDOR_HALF) continue;
        const b = olympicBaseSample(SEED, x, z);
        if (b.h >= CLIFF_OUT_ALT_LO) continue;
        const c = v.sample(SEED, x, z);
        out.push({ dh: c.h - b.h, ddx: c.dx - b.dx, ddz: c.dz - b.dz });
      }
    }
    return out;
  }

  it("puts relief of the designed amplitude on the composed beach", () => {
    const deltas = duneDeltaSweep();
    expect(deltas.length).toBeGreaterThanOrEqual(FLOOR_DUNE_DELTA); // measured 2545
    let hi = -Infinity;
    let lo = Infinity;
    for (const dd of deltas) {
      hi = Math.max(hi, dd.dh);
      lo = Math.min(lo, dd.dh);
    }
    const spread = hi - lo;
    // The dune's contribution is `DUNE_AMPLITUDE · road.v · w · v` and NONE
    // of road.v, w or v depends on DUNE_AMPLITUDE — the road window is a
    // function of u, the altitude window of the pre-dune base height, and v
    // of position. `corridorD` is out of the picture here (see the sweep's
    // comment) and it is a linear blend regardless. So `spread` is EXACTLY
    // proportional to DUNE_AMPLITUDE, and a two-sided band on it is a
    // two-sided band on the amplitude.
    //
    // This replaces a guard that asserted a shore-parallel `maxStep > 0.1`:
    // a bare constant, unrelated to the feature, which the shipped field
    // cleared by 3.1%. It also could not fail upward at all.
    //
    // Measured spread at DUNE_AMPLITUDE = 1.2: 0.6989 m (max +0.3953, min
    // −0.3036). Halving the amplitude gives 0.3495 and doubling it gives
    // 1.3978, so [0.45, 1.05] fails both while keeping ~1.5x margin either
    // side of the shipped value.
    expect(spread).toBeGreaterThan(0.45);
    expect(spread).toBeLessThan(1.05);
  });

  it("keeps dune ridges elongated ALONG the shore, not across it", () => {
    // DUNE_WAVELENGTH_Z / DUNE_WAVELENGTH_X = 3 is the whole point of the
    // anisotropy the constants' own comments argue for: real foredunes run
    // parallel to the water, and ridges running shore-NORMAL would read as
    // corduroy pointing out to sea. Nothing pinned that, so swapping the two
    // wavelengths — the exact failure those comments warn about — broke no
    // test at all.
    //
    // A short wavelength means a steep gradient, so the anisotropy is
    // visible directly in the dune's own contribution to dx vs dz. RMS over
    // the sweep, measured: dx 0.01444, dz 0.00421, ratio 3.430 — close to
    // the wavelength ratio of 3, slightly above it because dz also carries
    // the altitude window's chain-rule term. Swapping the wavelengths drops
    // it to 0.689 (not the full 1/3.43 — dz keeps its window terms either
    // way). The floor of 2 sits 1.7x below the shipped ratio and 2.9x above
    // the swapped one.
    const deltas = duneDeltaSweep();
    expect(deltas.length).toBeGreaterThanOrEqual(FLOOR_DUNE_DELTA);
    let sx = 0;
    let sz = 0;
    for (const dd of deltas) {
      sx += dd.ddx * dd.ddx;
      sz += dd.ddz * dd.ddz;
    }
    const ratio = Math.sqrt(sx / deltas.length) / Math.sqrt(sz / deltas.length);
    expect(ratio).toBeGreaterThan(2);
  });

  it("meets both of duneD's early-out seams to second order (C2)", () => {
    // The C² claim rests on fbm2d's second derivatives, and duneD
    // has two hard early-outs — `road.v === 0` and `w === 0` — that return
    // `base` bit-exactly. Nothing tested that the hot side actually ARRIVES
    // at zero smoothly rather than merely close to it.
    //
    // `smootherstepD` is quintic, so near an edge S(t) ≈ 10·t³: value, first
    // and second derivatives all vanish there. That is exactly the C² claim,
    // and it is testable without differentiating anything — the dune's own
    // contribution C(δ) at distance δ inside the seam must grow like δ³, so
    // C(2δ)/C(δ) → 8. A cubic smoothstep would give 4 and a linear ramp 2,
    // so a band around 8 separates C² from C¹ and C⁰ cleanly.
    const C = (u: number, h: number): number =>
      duneD(SEED, 137.7, -412.3, u, 0, { h, dx: 0, dz: 0 }).h - h;
    const FAR_FROM_ROAD = 100; // road window wide open, so it cannot confound
    const cases: Array<[string, number, (d: number) => number]> = [
      // Road seam, approached from outside the corridor.
      ["road", 0.1, (d) => C(DUNE_ROAD_NEAR + d, 0.55)],
      // Altitude rise seam, approached from above the waterline.
      ["alt-in", 0.01, (d) => C(FAR_FROM_ROAD, DUNE_ALT_IN_LO + d)],
      // Altitude fall seam, approached from below the inland cut-off.
      ["alt-out", 0.1, (d) => C(FAR_FROM_ROAD, DUNE_ALT_OUT_HI - d)],
    ];
    const cold: Array<[string, number]> = [
      ["road", C(DUNE_ROAD_NEAR - 0.1, 0.55)],
      ["alt-in", C(FAR_FROM_ROAD, DUNE_ALT_IN_LO - 0.01)],
      ["alt-out", C(FAR_FROM_ROAD, DUNE_ALT_OUT_HI + 0.1)],
    ];
    for (const [name, v] of cold) expect(v, `${name} cold side`).toBe(0);
    for (const [name, d, at] of cases) {
      const one = at(d);
      const two = at(2 * d);
      // Teeth: a seam whose contribution is already numerically zero would
      // pass any ratio test vacuously.
      expect(Math.abs(one), `${name} is live`).toBeGreaterThan(1e-12);
      // Measured ratios: road 7.880, alt-in 7.866, alt-out 7.698.
      expect(two / one, `${name} approach order`).toBeGreaterThan(7);
      expect(two / one, `${name} approach order`).toBeLessThan(8.5);
    }
  });

  /** Points selected by actual distance to the road centerline (via the
   * public `roadDistance` hook), not by distance from the coastline: the
   * road-suppression annulus (DUNE_ROAD_NEAR, DUNE_ROAD_FAR) is defined in
   * `u`, and nothing about an inland-offset-from-coast sweep guarantees any
   * point lands there — the road wobbles relative to the coast, so the two
   * distances only correlate loosely. Candidates are built from inland
   * offsets swept finely enough to straddle the annulus at every z, then
   * kept only if roadDistance confirms it; 305 of 2562 candidates measured,
   * comfortably inside the dune altitude window too (both the road window's
   * smootherstep and the altitude window are hot throughout, so duneD's
   * chain-rule terms are live at every point). The offset grid is a 2 m
   * sweep rather than the five hand-picked offsets it started as: the
   * annulus is only DUNE_ROAD_FAR − DUNE_ROAD_NEAR = 10 m wide now, and a
   * coarse grid collected just 61 points through it. */
  function duneRoadAnnulusSweep(): Array<[number, number]> {
    const v = variantOrThrow("olympic");
    const pts: Array<[number, number]> = [];
    for (let i = -30; i <= 30; i++) {
      const z = i * 39.7 + 0.53;
      const d = v.coastDistance!(SEED, 0, z);
      for (let inland = 8; inland <= 90; inland += 2) {
        const x = 0 - d + inland;
        const dist = v.roadDistance!(SEED, x, z);
        if (dist > DUNE_ROAD_NEAR && dist < DUNE_ROAD_FAR) pts.push([x, z]);
      }
    }
    return pts;
  }

  it("returns exact analytic derivatives across the road-suppression annulus", () => {
    const pts = duneRoadAnnulusSweep();
    // A sweep that silently collects zero annulus points would pass while
    // testing nothing — the floor makes that failure mode itself fail.
    expect(pts.length).toBeGreaterThanOrEqual(FLOOR_DUNE_ANNULUS); // measured 305
    const { worst, steepest } = checkDerivatives("olympic", pts);
    expect(steepest).toBeGreaterThan(0.05);
    // ABSOLUTE bound, deliberately not the usual `worst / steepest <
    // TOL_RATIO`. `steepest` is the sweep-wide slope, which comes from the
    // base blend and has nothing to do with the dune, so dividing by it
    // scales the allowance to something the dune cannot influence. At the
    // pre-retune constants that inflated the allowance to 2.7e-3 — wide
    // enough that dropping BOTH of duneD's window chain-rule terms from dz
    // at once still PASSED (measured ratio 9.281e-3 against a 1e-2 bound:
    // the two terms have opposite sign at the worst point and partially
    // cancel). TOL_RATIO's amplitude-scaling rationale (see derivatives.ts)
    // is about PEAK_HEIGHT-scale fields; the dune is sub-metre, so here the
    // ratio only hides it.
    //
    // Measured `worst` over these 305 points at the shipped constants:
    //   3.092e-5  correct
    //   3.051e-5  with duneD stubbed to the identity — i.e. essentially ALL
    //             of the correct-case error is base-field central-difference
    //             truncation, and no bound can be set below it
    //   1.591e-2  road term (aDz·w·v) dropped from dz
    //   2.242e-4  altitude term (a·wDh·base.dz·v) dropped from dz
    //   1.591e-2  both dropped from dz
    // 1e-4 sits 3.2x above the correct case (and 3.3x above the base-only
    // floor that bounds it from below) while failing the weakest of the
    // three mutations by 2.2x. The altitude term is the weak one here only
    // because ∂d/∂z is small on this near-x-aligned coast; the "nonzero
    // uDz" unit test below carries independent teeth for it, with base.h
    // placed where the rise window's own derivative is largest.
    expect(worst).toBeLessThan(1e-4);
  });

  it("matches a central difference of h for duneD with nonzero uDz", () => {
    // All four existing duneD unit cases above pass uDz = 0 at points where
    // the road window's own derivative is zero, so the chain-rule terms
    // (roadDx/roadDz through uDz) have no direct unit coverage.
    //
    // Both operands are chosen so that BOTH window derivatives are live, not
    // merely both window VALUES:
    //  - u0 = 35 sits strictly inside the (DUNE_ROAD_NEAR, DUNE_ROAD_FAR) =
    //    (30, 40) annulus, so road.d ≠ 0. (u0 = 50 would leave road.v = 1
    //    and road.d = 0 — the road term silently dead.)
    //  - base.h = 0.55 is the midpoint of the [DUNE_ALT_IN_LO,
    //    DUNE_ALT_IN_HI] = [0.1, 1.0] rise, where rise.d is at its maximum,
    //    so wDh ≠ 0. (base.h = 1.0 sits at the top of the rise and the far
    //    side of the fall, where rise.d = fall.d = 0 and wDh vanishes.)
    //  - base.dz is what the altitude term rides on, so it must not be
    //    negligible against the rest of dz — and its SIGN matters. With
    //    uDz > 0 the road term aDz·w·v is positive-going; a NEGATIVE base.dz
    //    makes the altitude term a·wDh·base.dz·v oppose it, and the two then
    //    partially cancel, so dropping BOTH at once passed (measured at
    //    base.dz = −0.05: each term alone RED, both together GREEN — the
    //    very defect that was fixed in the annulus test). base.dz = +0.05
    //    makes them add.
    // Verified by mutation at these operands: dropping the road term, the
    // altitude term, or both from dz gives errors 4.62e-3, 4.28e-3 and
    // 8.90e-3 against a ~4.5e-4 tolerance — all three RED.
    const x = 100.3, z0 = 250.7, u0 = 35, uDz = 0.6;
    const base = { h: 0.55, dx: 0.02, dz: 0.05 };
    const analytic = duneD(SEED, x, z0, u0, uDz, base).dz;
    // Independent oracle: treat u and base as the exact linear functions of
    // z that uDz/base.dz declare them to be (u(z) = u0 + uDz·(z − z0),
    // base(z).h = base.h + base.dz·(z − z0)) and central-difference the
    // resulting h(z), in the spirit of checkDerivatives — no hard-coded
    // expected value.
    const at = (z: number): number =>
      duneD(SEED, x, z, u0 + uDz * (z - z0), uDz, {
        h: base.h + base.dz * (z - z0), dx: base.dx, dz: base.dz,
      }).h;
    const numeric = (at(z0 + H) - at(z0 - H)) / (2 * H);
    expect(Math.abs(analytic - numeric)).toBeLessThan(TOL_RATIO * Math.abs(analytic));
  });

  it("centres duneD's noise, so troughs and crests are equally likely", () => {
    // spawn.ts:30 rejects candidates below waterLevel + SPAWN_FREEBOARD.
    // An earlier version of this test composed the full olympic field at a
    // fixed inland offset (52 m) and asserted a lopsided 28-dry/8-wet split,
    // reasoning that dunes "measurably move points across the line". That
    // asymmetry was actually an earlier sign-error bug: fbm2d
    // sums gradientNoise2 and is normalized to [-1, 1] already (field.ts:218,
    // unlike [0, 1] fbm2), so `f.v - 0.5` skewed the field to ~[-1.5, 0.5]
    // and dunes pitted the beach almost everywhere (measured directly: 4000
    // duneD samples at base.h pinned to the threshold gave 3983 wet, 17 dry
    // -- 99.6% troughs). With `v = 0.5 * f.v`, dunes are properly zero-
    // centred, so a large sample straddling the line should split close to
    // 50/50 rather than lean hard toward "wet": this is a direct exercise of
    // duneD (not the full composed field, whose base height rarely sits
    // exactly on the freeboard line for any given inland offset, making a
    // composed-field sweep too sparse near the line to say much either way).
    //
    // NAMING: this measures fbm2d's CENTRING, not spawn behaviour on the
    // composed beach. It pins base.h and holds both windows open, so `a·w`
    // is a positive constant and the dry/wet split is a property of `v`
    // alone — invariant to DUNE_AMPLITUDE and to both window shapes. The
    // freeboard line is just a convenient, meaningful height to pin base.h
    // to; the test says nothing about how often real spawn candidates land
    // dry. The amplitude and window guards above cover the composed field.
    const threshold = SEA_LEVEL + SPAWN_FREEBOARD;
    const base = { h: threshold, dx: 0, dz: 0 }; // pinned to the line itself
    const u = DUNE_ROAD_FAR + 10; // road window fully open (road.v == 1)
    let dry = 0;
    let wet = 0;
    for (let ix = 0; ix < 200; ix++) {
      for (let iz = 0; iz < 20; iz++) {
        const x = ix * 3.1;
        const z = iz * 401.7 + ix * 7.3;
        const h = duneD(SEED, x, z, u, 0, base).h;
        if (h > threshold) dry++; else wet++;
      }
    }
    // Measured at SEED = DERIV_SEED, DUNE_AMPLITUDE = 1.2, n = 4000: 2077
    // dry, 1923 wet -- both comfortably over a third of the sample, neither
    // dominating the way the buggy field's 3983/17 split did.
    expect(dry).toBeGreaterThanOrEqual(1200); // teeth: crests clear the line often
    expect(wet).toBeGreaterThanOrEqual(1200); // teeth: troughs cut below it just as often
  });
});

describe("the bowl", () => {
  const v = () => variantOrThrow("olympic");
  const roadDist = (x: number, z: number) => v().roadDistance!(SEED, x, z);

  it("declares the bowl, trail and landmark tunables", () => {
    const t = v().tunables;
    // TRAIL_GRID_CELL replaces ASCENT_MAX_LEGS (2026-09-09):
    // the ascent's switchback ladder is gone
    // and the grid's cell size is the number the graph now turns on.
    for (const k of ["TRAILHEAD_RADIUS", "TRAILHEAD_U", "TRAIL_CORRIDOR_HALF", "TRAIL_GRID_CELL", "PEAK_INLAND_MIN", "APRON_BLEND_END"]) {
      expect(t[k], k).toBeTypeOf("number");
    }
    expect(Object.keys(t).some((k) => k.startsWith("WALL_"))).toBe(false);
  });

  it("exposes trailGraph and trailDistance, and the trailhead sits on the flat", () => {
    const g = v().trailGraph!(SEED);
    expect(g.edges.length).toBeGreaterThan(0);
    // Was exactly 0 (2026-09-09, re-pinned to
    // 0.05). The pad's disc is as flat as it ever was; what changed is that the
    // trail's own bed now runs THROUGH the pad's centre — node 0 is the car's
    // spot, not a point on the pad's rim — so the composed field there carries
    // the profile's first-sample slope instead of the disc's exact zero. The
    // profile's samples out to 8 m are all on the flat disc and only the
    // kernel's far tail reaches the fade ring, so it is tiny: measured 0.0062
    // at DERIV_SEED, a 0.6 % grade under a parked car.
    const s = v().sample(SEED, g.trailhead.x, g.trailhead.z);
    expect(Math.abs(s.dx)).toBeLessThan(0.05);
    expect(Math.abs(s.dz)).toBeLessThan(0.05);
    // The summit — the crest of the made peak — is on the trail, by
    // construction, and it is the highest node in the graph.
    const end = g.nodes[g.summit]!;
    expect(v().trailDistance!(SEED, end.x, end.z)).toBeLessThan(1e-9);
    for (const n of g.nodes) expect(n.h).toBeLessThanOrEqual(end.h + 1e-9);
  });

  it("holds the pad at the road's own grade, and the builder's field includes the road corridor", () => {
    for (const seed of [0x5eed, 12345, 777]) {
      const z = TRAIL_Z_ANCHOR;
      const rx = v().roadCenterX!(seed, z);
      const pad = olympicPreTrailSample(seed, rx + TRAILHEAD_U, z);
      expect(pad.h).toBeCloseTo(roadGradeAt(seed, z).h, 6);
      // On the road bed itself the pre-trail field IS the road grade.
      expect(olympicPreTrailSample(seed, rx, z).h).toBeCloseTo(roadGradeAt(seed, z).h, 6);
    }
  });

  it("is bit-identical to the pre-trail field outside the bowl", () => {
    // A `checked` floor, like the sibling corridor test's: without it this
    // passes vacuously the day `sweepPoints()` moves inside the bowl.
    let checked = 0;
    for (const [x, z] of sweepPoints()) {
      const { u } = roadFrameAt(SEED, x, z);
      if (inBowl(u, z)) continue;
      const pre = olympicPreTrailSample(SEED, x, z);
      const post = v().sample(SEED, x, z);
      // Field-by-field, not whole-object toBe: pre/post are independently
      // allocated TerrainSample objects (fresh literals every call), so
      // Object.is would fail on reference identity alone even when every
      // field agrees bit-for-bit — the same trap Decision 1 removed above.
      if (roadDist(x, z) >= ROAD_CORRIDOR_HALF) {
        expect(post.h).toBe(pre.h);
        expect(post.dx).toBe(pre.dx);
        expect(post.dz).toBe(pre.dz);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("returns exact analytic derivatives through every trail corridor and the trailhead pad", () => {
    const g = bowlFor(SEED).graph;
    const pts: Array<[number, number]> = [];
    // Every edge, not just the ascent chain: the spine and the forks carve too,
    // and the junctions where three corridors overlap
    // are exactly where the product and quotient rules are both live.
    for (const e of g.edges) {
      const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const x = a.x + t * (b.x - a.x), z = a.z + t * (b.z - a.z);
        for (const off of [0, 0.7, 2.3, 3.9, 4.6, -1.4, -3.1]) pts.push([x + off, z + off * 0.37]);
      }
    }
    // The pad disc and its fade, in the road frame, plus a ring just outside it.
    const R = TRAILHEAD_RADIUS + TRAILHEAD_FADE + 2;
    for (let dz = -R; dz <= R; dz += 1.9) for (let du = -R; du <= R; du += 1.7) {
      pts.push([v().roadCenterX!(SEED, TRAIL_Z_ANCHOR + dz) + TRAILHEAD_U + du, TRAIL_Z_ANCHOR + dz]);
    }
    const { worst, steepest } = checkDerivatives("olympic", pts);
    expect(worst).toBeLessThan(TOL_RATIO * steepest);
  });

  it("is exactly the pre-trail field with the pad on it: no wall anywhere between road and plateau", () => {
    // Every column between the road corridor and the plateau: composed field
    // minus pre-trail field is zero wherever no corridor, pad or dome reaches.
    let checked = 0;
    const { features } = bowlFor(SEED);
    for (let z = -560; z <= 560; z += 37) {
      for (let u = 31; u <= 300; u += 3.1) {
        const x = v().roadCenterX!(SEED, z) + u;
        if (v().trailDistance!(SEED, x, z) < TRAIL_CORRIDOR_HALF + 1) continue;
        const du = u - TRAILHEAD_U, dzp = z - TRAIL_Z_ANCHOR;
        if (du * du + dzp * dzp < (TRAILHEAD_RADIUS + TRAILHEAD_FADE + 1) ** 2) continue;
        // EVERY feature stage moves height, not just the peak's dome
        // (2026-09-11): until loops actually
        // built, the peak was the only one this scan could ever meet, and it
        // sits 700+ m inland (PEAK_INLAND_MIN), well past u <= 300. A loop
        // feature sits FEATURE_ROAD_CLEAR (150 m) from the road, so a pond or a
        // meadow can stand squarely inside this band — measured on SEED:
        // u = 275.9, z = -42 reads 0.23 m of pond APRON, 45.7 m from a 35.4 m
        // rim whose apron reaches POND_APRON beyond it. The reach excluded is
        // each kind's own outer edge: a meadow's and a peak's stop at `radius`,
        // a pond's apron runs POND_APRON past it (`basinD`) and a meadow's
        // MEADOW_RIM past it (`flatD`, since a later fix moved the ramp
        // outside the radius).
        const apronOf = (k: string) => (k === "pond" ? POND_APRON : k === "meadow" ? MEADOW_RIM : 0);
        if (features.some((f) => Math.hypot(x - f.x, z - f.z) < f.radius + apronOf(f.kind) + 2)) continue;
        const pre = olympicPreTrailSample(SEED, x, z);
        const post = v().sample(SEED, x, z);
        expect(post.h, `u=${u} z=${z}`).toBe(pre.h);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  // DELETED 2026-09-09: "raises a real dome
  // under a CARVED overlook". Landmarks are chosen among the cells the trail
  // can reach now, over the whole region rather than inside a fork's fan, and
  // the plateau stands ~100 m above the pad — so the overlook is FOUND
  // everywhere. Re-scanned on the real field over sequential seeds 0…500: not
  // one carves an overlook (and none of the 227 sweep seeds does either), so
  // this test had no seed left to stand on. The carve is covered by
  // trailBuild.test.ts's synthetic flat world (which carves, domes and routes
  // over it) and by landmarks.test.ts's "mask and dome primitives".
  // DELETED 2026-09-11: "puts real trees under a CARVED
  // stand on the real field". TRAILHEAD_U 44 → 9 and BOWL_U_MIN 30 → 8 move
  // the pad, the graph and the reachable ground near it, and the one seed this
  // test stood on (163) no longer carves a stand. Re-scanned on the real
  // field over sequential seeds 0…2000+: not one carves a stand any more (the
  // scan was killed past 2000 with zero hits, against roughly 1-in-500 before
  // this change), so this test has no seed left to stand on — the same failure
  // mode, and the same fix, as the CARVED-overlook test deleted above. The
  // carve is covered by trailBuild.test.ts's synthetic flat world (which
  // carves, domes and routes over it) and by landmarks.test.ts's "mask and
  // dome primitives" (the density-floor assertion this test's own comment
  // called its "composed-field counterpart" of).
});
