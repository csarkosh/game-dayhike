import { describe, expect, it } from "vitest";
import {
  FEATURE_TUNABLES, PEAK_RADIUS_MIN, PEAK_RADIUS_MAX, PEAK_RISE_MIN, PEAK_RISE_MAX, PEAK_CREST_RADIUS,
  MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX, MEADOW_RIM, POND_RADIUS_MIN, POND_RADIUS_MAX, POND_DEPTH, POND_APRON,
  LOOP_WEIGHT_1, LOOP_WEIGHT_2, LOOP_WEIGHT_3, TREELINE_BELOW_CREST, TREELINE_BAND, PEAK_RIM_FADE,
  planFeatures, peakD, flatD, basinD, featureStageD, featureMaskAt, type Feature,
} from "../../src/sim/features.js";
import { TRAIL_GRID_CAP } from "../../src/sim/trailGrid.js";
import type { TerrainSample } from "../../src/sim/terrain.js";

const flat: TerrainSample = { h: 100, dx: 0, dz: 0 };
const tilted = (x: number, z: number): TerrainSample => ({ h: 50 + 0.1 * x - 0.05 * z, dx: 0.1, dz: -0.05 });
// The dome the builder actually places: radius 300, a mid-range rise
// (was 220/75).
const peak: Feature = { id: 0, kind: "peak", x: 0, z: 0, radius: PEAK_RADIUS_MAX, height: 65, crestH: 165 };
const meadow: Feature = { id: 1, kind: "meadow", x: 1000, z: 0, radius: 90, height: 60 };
const pond: Feature = { id: 2, kind: "pond", x: 0, z: 1000, radius: 30, height: 100 };

function central(stage: (x: number, z: number) => TerrainSample, x: number, z: number): { dx: number; dz: number } {
  const H = 0.02;
  return {
    dx: (stage(x + H, z).h - stage(x - H, z).h) / (2 * H),
    dz: (stage(x, z + H).h - stage(x, z - H).h) / (2 * H),
  };
}

describe("the seeded feature plan", () => {
  it("draws 1–3 loops per seed with the declared weights, and never two ponds", () => {
    const counts = [0, 0, 0, 0];
    let ponds2 = 0;
    for (let seed = 0; seed < 3000; seed++) {
      const { loops } = planFeatures(seed);
      expect(loops.length).toBeGreaterThanOrEqual(1);
      expect(loops.length).toBeLessThanOrEqual(3);
      counts[loops.length]! += 1;
      if (loops.filter((k) => k === "pond").length > 1) ponds2++;
    }
    expect(ponds2).toBe(0);
    // Within ±0.05 of the weights over 3000 draws (binomial σ ≈ 0.9 %).
    expect(counts[1]! / 3000).toBeCloseTo(LOOP_WEIGHT_1, 1);
    expect(counts[2]! / 3000).toBeCloseTo(LOOP_WEIGHT_2, 1);
    expect(counts[3]! / 3000).toBeCloseTo(LOOP_WEIGHT_3, 1);
  });
  it("is deterministic", () => {
    expect(planFeatures(777)).toEqual(planFeatures(777));
    expect(planFeatures(0x5eed)).toEqual(planFeatures(0x5eed));
  });
});

describe("the peak stage", () => {
  it("raises the crest by height (a flat platform over PEAK_CREST_RADIUS) and returns the same object outside the dome", () => {
    expect(peakD(peak, 0, 0, flat).h).toBeCloseTo(flat.h + peak.height, 9);
    expect(peakD(peak, PEAK_CREST_RADIUS - 0.5, 0, flat).h).toBeCloseTo(flat.h + peak.height, 9);
    expect(peakD(peak, PEAK_RADIUS_MAX - 0.1, 0, flat).h).toBeGreaterThan(flat.h);
    expect(peakD(peak, PEAK_RADIUS_MAX, 0, flat)).toBe(flat);
    expect(peakD(peak, 0, 400, flat)).toBe(flat);
  });
  it("is sharper than the old dome: the crest keeps a grade of at least 0.2 over the first 20 m of skirt", () => {
    // 0.25 → 0.2: the crest grade is k·rise/(R − c) and both terms moved
    // (R 220 → 300, rise 60–90 → 50–80), so it reads 0.19–0.30 across the
    // range instead of 0.31–0.46. Still an order of magnitude over the old
    // carved dome (0.035 over the same 20 m).
    const c = PEAK_CREST_RADIUS;
    const hc = peakD(peak, c, 0, flat).h, h20 = peakD(peak, c + 20, 0, flat).h;
    expect((hc - h20) / 20).toBeGreaterThan(0.2);
  });
  it("never exceeds the walkable cap on its skirt — nor the routing grid's own cap", () => {
    let steepest = 0;
    for (let r = 1; r < PEAK_RADIUS_MAX; r += 1) {
      const s = peakD(peak, r, 0, flat);
      steepest = Math.max(steepest, Math.hypot(s.dx, s.dz));
    }
    expect(steepest).toBeLessThan(0.9);
    // TRAIL_GRID_CAP: a skirt over the grid's cap is only walkable because
    // `resampleAround` keeps it passable, and the stem then climbs ground
    // its own corridor union cannot take. At the widest rise (80) the flank
    // maxes at 0.517.
    expect(steepest).toBeLessThan(TRAIL_GRID_CAP);
  });
  it("returns exact analytic derivatives on flat and tilted ground", () => {
    const c = PEAK_CREST_RADIUS;
    for (const [x, z] of [[5, 3], [60, -40], [150, 120], [210, 10], [-100, -100], [c + 1, 0], [c + 40, 30]] as const) {
      const a = peakD(peak, x, z, flat), n = central((px, pz) => peakD(peak, px, pz, flat), x, z);
      expect(Math.abs(a.dx - n.dx)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dx)));
      expect(Math.abs(a.dz - n.dz)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dz)));
      const b = peakD(peak, x, z, tilted(x, z)), m = central((px, pz) => peakD(peak, px, pz, tilted(px, pz)), x, z);
      expect(Math.abs(b.dx - m.dx)).toBeLessThan(0.01 * Math.max(1, Math.abs(m.dx)));
      expect(Math.abs(b.dz - m.dz)).toBeLessThan(0.01 * Math.max(1, Math.abs(m.dz)));
    }
  });
});

describe("the meadow flat", () => {
  // The WHOLE disc is levelled now and the ramp to the hillside lies
  // OUTSIDE it, over the apron [R, R + MEADOW_RIM] — the pond's own shape.
  // The rim used to be the outer MEADOW_RIM of the radius itself, so the
  // plateau ended at R − MEADOW_RIM and the sample was exact at R.
  it("levels the whole disc to height, ramps over an outer apron, and is exact beyond it", () => {
    expect(flatD(meadow, 1000, 0, tilted(1000, 0)).h).toBeCloseTo(meadow.height, 9);
    const rimIn = 1000 + meadow.radius - 1;
    expect(flatD(meadow, rimIn, 0, tilted(rimIn, 0)).h).toBeCloseTo(meadow.height, 9);
    // Partway along the apron the height is strictly between the flat and the
    // hillside it is ramping back to.
    const mid = 1000 + meadow.radius + MEADOW_RIM / 2;
    const midBase = tilted(mid, 0);
    const midH = flatD(meadow, mid, 0, midBase).h;
    const lo = Math.min(meadow.height, midBase.h), hi = Math.max(meadow.height, midBase.h);
    expect(midH).toBeGreaterThan(lo);
    expect(midH).toBeLessThan(hi);
    const outside = tilted(1000 + meadow.radius + MEADOW_RIM, 0);
    expect(flatD(meadow, 1000 + meadow.radius + MEADOW_RIM, 0, outside)).toBe(outside);
  });
  it("returns exact analytic derivatives across the apron", () => {
    for (const r of [0, 40, meadow.radius - 5, meadow.radius + 5, meadow.radius + MEADOW_RIM / 2, meadow.radius + MEADOW_RIM - 1, meadow.radius + MEADOW_RIM + 5]) {
      const x = 1000 + r, z = 7;
      const a = flatD(meadow, x, z, tilted(x, z)), n = central((px, pz) => flatD(meadow, px, pz, tilted(px, pz)), x, z);
      expect(Math.abs(a.dx - n.dx)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dx)));
      expect(Math.abs(a.dz - n.dz)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dz)));
    }
  });
});

describe("the pond basin", () => {
  it("dishes POND_DEPTH at the centre, holds the rim height at the rim, and is exact outside", () => {
    expect(basinD(pond, 0, 1000, flat).h).toBeCloseTo(pond.height - POND_DEPTH, 9);
    expect(basinD(pond, 0, 1000 + pond.radius - 0.01, flat).h).toBeCloseTo(pond.height, 2);
    const edge = flat;
    expect(basinD(pond, 0, 1000 + pond.radius + POND_APRON + 1, edge)).toBe(edge);
  });
  it("is wadeable: nowhere deeper than POND_DEPTH and the floor grade stays under 0.15", () => {
    let deepest = 0, steepest = 0;
    for (let r = 0; r < pond.radius; r += 0.5) {
      const s = basinD(pond, r, 1000, flat);
      deepest = Math.max(deepest, pond.height - s.h);
      steepest = Math.max(steepest, Math.hypot(s.dx, s.dz));
    }
    expect(deepest).toBeLessThanOrEqual(POND_DEPTH + 1e-9);
    expect(steepest).toBeLessThan(0.15);
  });
  it("returns exact analytic derivatives", () => {
    for (const r of [0.5, 10, 20, 29, 45, 60]) {
      const x = 3, z = 1000 + r;
      const a = basinD(pond, x, z, tilted(x, z)), n = central((px, pz) => basinD(pond, px, pz, tilted(px, pz)), x, z);
      expect(Math.abs(a.dx - n.dx)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dx)));
      expect(Math.abs(a.dz - n.dz)).toBeLessThan(0.01 * Math.max(1, Math.abs(n.dz)));
    }
  });
});

describe("the composed stage and the mask", () => {
  const all = [peak, meadow, pond];
  it("applies every feature and returns the same object where none reaches", () => {
    expect(featureStageD(all, 0, 0, flat).h).toBeCloseTo(flat.h + peak.height, 9);
    expect(featureStageD(all, 1000, 0, flat).h).toBeCloseTo(meadow.height, 9);
    expect(featureStageD(all, 0, 1000, flat).h).toBeCloseTo(pond.height - POND_DEPTH, 9);
    expect(featureStageD(all, 500, 500, flat)).toBe(flat);
    expect(featureStageD([], 0, 0, flat)).toBe(flat);
  });
  it("masks trees out of the meadow and its margin, off the pond and its shore, and above the treeline", () => {
    expect(featureMaskAt(all, 1000, 0).tree).toBe(0);
    // The meadow's flat is the whole disc and its apron lies outside it, so
    // the tree margin starts at R + MEADOW_RIM, not at R.
    expect(featureMaskAt(all, 1000 + meadow.radius + MEADOW_RIM + 5, 0).tree).toBe(0);
    expect(featureMaskAt(all, 1000 + meadow.radius + MEADOW_RIM + 30, 0).tree).toBe(1);
    expect(featureMaskAt(all, 0, 1000 + pond.radius + 7).tree).toBe(0);
    expect(featureMaskAt(all, 0, 1000 + pond.radius + 30).tree).toBe(1);
    // The peak's crest is flat.h + peak.height; the treeline is
    // TREELINE_BELOW_CREST under it.
    const crestH = flat.h + peak.height;
    expect(featureMaskAt(all, 0, 0, crestH).tree).toBe(0);
    expect(featureMaskAt(all, 500, 500).tree).toBe(1);
  });

  // THE TREE RAMP WALKED ON THE STAGE'S OWN GROUND. The assertion this
  // replaces read
  // `featureMaskAt(all, 0, 0, crestH - TREELINE_BELOW_CREST - 80).tree === 1`
  // — an (x, z, h) triple that CANNOT OCCUR, because at the peak's centre the
  // height IS crestH. Decoupling the position from the height is what hid the
  // fact that `below = crestH - h` inside the disc only ever reaches the
  // dome's own rise, which was under TREELINE_BELOW_CREST + TREELINE_BAND on
  // every world the builder ships: the ramp could not complete anywhere
  // inside the disc, and the mask then jumped the whole remaining amplitude
  // at `d = f.radius`. Walk out from the crest instead, sampling `peakD` for
  // the height at each step, and require what a treeline actually means.
  it("walks the peak's tree ramp out from the crest: monotone, and full forest before the rim", () => {
    const crestH = flat.h + peak.height;
    expect(peak.crestH).toBe(crestH);
    let prev = -1, reached = -1;
    for (let d = 0; d <= peak.radius; d += 1) {
      const h = peakD(peak, d, 0, flat).h;
      const tree = featureMaskAt([peak], d, 0, h).tree;
      expect(tree, `d = ${d}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = tree;
      if (reached < 0 && tree >= 1 - 1e-9) reached = d;
    }
    // The ramp completes INSIDE the disc — the earlier defect was that it
    // could not, on any world. The dome's rise here is 65 m against a band that
    // ends at TREELINE_BELOW_CREST + TREELINE_BAND = 50.
    expect(TREELINE_BELOW_CREST + TREELINE_BAND).toBeLessThanOrEqual(PEAK_RISE_MIN);
    expect(reached).toBeGreaterThan(PEAK_CREST_RADIUS);
    expect(reached).toBeLessThan(peak.radius);
  });

  it("keeps the tree mask continuous across the peak's rim, on every bearing", () => {
    // The other half of that same defect: the peak branch used to `continue`
    // at `d >= f.radius` with no radial falloff, so whatever the height ramp
    // had reached just inside the rim jumped straight back to 1 one metre
    // later — measured worst jump 1.00 on four of five probe seeds. PEAK_RIM_FADE
    // fades the THINNING out over the dome's outer 40 m, so the two sides of
    // the rim agree. Sampled AT THE TREELINE HEIGHT (the worst case: the
    // height ramp itself is 0 there, so the whole amplitude is on the fade).
    const treeline = (peak.crestH as number) - TREELINE_BELOW_CREST;
    let worst = 0;
    for (let b = 0; b < 36; b++) {
      const th = (b * Math.PI) / 18;
      const ux = Math.cos(th), uz = Math.sin(th);
      const rIn = peak.radius - 1, rOut = peak.radius + 1;
      const inside = featureMaskAt([peak], ux * rIn, uz * rIn, treeline).tree;
      const outside = featureMaskAt([peak], ux * rOut, uz * rOut, treeline).tree;
      worst = Math.max(worst, Math.abs(inside - outside));
    }
    console.info(`[features] worst tree-mask jump across the peak's rim over 36 bearings: ${worst.toFixed(4)}`);
    expect(worst).toBeLessThanOrEqual(0.05);
    // INSIDE the fade band the thinning is at full strength — the fade is a
    // rim treatment, not a weakening of the treeline: one metre in from where
    // it starts, the mask at the treeline height is still the bare 0 the
    // height ramp asks for.
    const inFade = peak.radius - PEAK_RIM_FADE - 1;
    expect(featureMaskAt([peak], inFade, 0, treeline).tree).toBeCloseTo(0, 9);
  });
  it("marks the meadow interior and the pond shore, and leaves the rest alone", () => {
    expect(featureMaskAt(all, 1000, 0).meadow).toBe(1);
    expect(featureMaskAt(all, 1000, 0).clutter).toBe(1);
    expect(featureMaskAt(all, 0, 1000 + pond.radius + 2).bare).toBe(1);
    expect(featureMaskAt(all, 0, 1000 + pond.radius + 2).clutter).toBe(0);
    expect(featureMaskAt(all, 500, 500)).toEqual({ tree: 1, clutter: 1, meadow: 0, bare: 0 });
  });
  it("declares its tunables, exhaustively", () => {
    // PEAK_SHOULDER joined: a loop feature's candidate may sit on the dome's
    // outer 40% shoulder, excluded by PEAK_SHOULDER · peak.radius + its own
    // radius rather than the whole dome radius — 46 keys -> 47.
    // LOOP_JOIN_REACH joined: the overlap count's junction exemption
    // (SPLIT_SNAP, borrowed from splitAt) measured 4-12 m short across the sweep
    // seeds earlier — a half-loop's join into A or B legitimately runs
    // 18-26 m along the stem's own buffer, so its own named tunable replaces
    // the borrowed one — 47 keys -> 48.
    // PEAK_RIM_FADE joined: the peak's tree thinning and its rock paint both
    // fade out over the dome's outer 40 m, so the mask meets the forest
    // outside the disc continuously and the paint is disc-local at all —
    // 48 keys -> 49.
    // PEAK_CENTRE_TRIES joined: the builder tries three candidate centres
    // before a world gets no peak at all, and a world whose stem ends on the
    // second is a different world — 49 keys -> 50.
    // LOOP_TRIES, TREE_PENALTY and LOOP_SCAN_STRIDE joined: all three
    // steered the graph from inside `trailBuild.ts` without being declared
    // anywhere, so moving LOOP_TRIES to 16 later would have forked worlds
    // under one level id. The values are unchanged — 50 keys -> 53.
    const keys = [
      "PEAK_RADIUS_MIN", "PEAK_RADIUS_MAX", "PEAK_RISE_MIN", "PEAK_RISE_MAX", "PEAK_CREST_RADIUS", "PEAK_SHARPNESS",
      "PEAK_INLAND_MIN", "PEAK_INLAND_MAX", "PEAK_SHOULDER", "PEAK_LOWER_STEP", "PEAK_LOWER_TRIES", "PEAK_CENTRE_TRIES",
      "TREELINE_BELOW_CREST", "TREELINE_BAND", "PEAK_RIM_FADE",
      "MEADOW_RADIUS_MIN", "MEADOW_RADIUS_MAX", "MEADOW_RIM", "MEADOW_TREE_MARGIN", "MEADOW_SLOPE_MAX",
      "POND_RADIUS_MIN", "POND_RADIUS_MAX", "POND_DEPTH", "POND_APRON", "POND_SHORE", "POND_TREE_MARGIN", "POND_SLOPE_MAX",
      "LOOP_WEIGHT_1", "LOOP_WEIGHT_2", "LOOP_WEIGHT_3",
      "LOOP_BAND_LO_1", "LOOP_BAND_HI_1", "LOOP_BAND_LO_2", "LOOP_BAND_HI_2", "LOOP_BAND_LO_3", "LOOP_BAND_HI_3",
      "LOOP_LATERAL_MIN", "LOOP_LATERAL_MAX", "FEATURE_ROAD_CLEAR", "FEATURE_SPACING",
      "RING_BAND", "RING_COST", "LOOP_JUNCTION_GAP", "LOOP_OVERLAP_MAX", "LOOP_JOIN_REACH", "LOOP_LEN_MIN", "LOOP_LEN_MAX",
      "LOOP_TRIES", "TREE_PENALTY", "LOOP_SCAN_STRIDE",
      "STEM_LEN_MIN", "STEM_LEN_MAX", "FEATURE_SALT",
    ];
    for (const k of keys) expect(FEATURE_TUNABLES[k], k).toBeTypeOf("number");
    expect(Object.keys(FEATURE_TUNABLES).sort()).toEqual([...keys].sort());
    expect(Object.keys(FEATURE_TUNABLES).length).toBe(53);
  });
  it("keeps its ranges within their working bounds", () => {
    // 220/220 and 60/90 → 300/300 and 50/80: the original numbers put the
    // flank over the routing grid's cap. See PEAK_RADIUS_MIN's comment.
    expect([PEAK_RADIUS_MIN, PEAK_RADIUS_MAX]).toEqual([300, 300]);
    expect([PEAK_RISE_MIN, PEAK_RISE_MAX]).toEqual([50, 80]);
    // 70/110 -> 50/90.
    expect([MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX]).toEqual([50, 90]);
    expect([POND_RADIUS_MIN, POND_RADIUS_MAX, POND_DEPTH]).toEqual([25, 40, 0.6]);
    expect(LOOP_WEIGHT_1 + LOOP_WEIGHT_2 + LOOP_WEIGHT_3).toBeCloseTo(1, 12);
  });
});
