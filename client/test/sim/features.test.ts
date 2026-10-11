import { describe, expect, it } from "vitest";
import {
  FEATURE_TUNABLES, PEAK_RADIUS_MIN, PEAK_RADIUS_MAX, PEAK_RISE_MIN, PEAK_RISE_MAX, PEAK_CREST_RADIUS,
  MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX, MEADOW_RIM, POND_RADIUS_MIN, POND_RADIUS_MAX,
  LOOP_WEIGHT_1, LOOP_WEIGHT_2, LOOP_WEIGHT_3, TREELINE_BELOW_CREST, TREELINE_BAND, PEAK_RIM_FADE,
  planFeatures, peakD, flatD, featureStageD, featureMaskAt, murkFor, MURK_LO, MURK_HI, type Feature,
  lakeDepthD, lakeMiddleDepth, LAKE_SHELF_DEPTH, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH, LAKE_DEPTH_MURKY, LAKE_DEPTH_CLEAR,
  chooseLobe, marshD, marshWeightAt, marshWidth, lobePoints, MARSH_AMP, MARSH_EDGE, MARSH_ONSET, MARSH_MURK_MIN, MARSH_WIDTH_MIN, MARSH_WIDTH_MAX,
} from "../../src/sim/features.js";
import { TRAIL_GRID_CAP } from "../../src/sim/trailGrid.js";
import type { TerrainSample } from "../../src/sim/terrain.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { lakeShoreInto, newLakeShore } from "../../src/sim/lakeShape.js";

const flat: TerrainSample = { h: 100, dx: 0, dz: 0 };
const tilted = (x: number, z: number): TerrainSample => ({ h: 50 + 0.1 * x - 0.05 * z, dx: 0.1, dz: -0.05 });
// The dome the builder actually places: radius 300, a mid-range rise
// (was 220/75).
const peak: Feature = { id: 0, kind: "peak", x: 0, z: 0, radius: PEAK_RADIUS_MAX, height: 65, crestH: 165 };
const meadow: Feature = { id: 1, kind: "meadow", x: 1000, z: 0, radius: 90, height: 60 };
// A pond 30 m in half-width about a 10 m spine, murky: its bed 3 m deep in the middle.
const pond: Feature = {
  id: 2, kind: "pond", x: 0, z: 1000, radius: 30, height: 100, murk: 1,
  shape: stadiumShape({ cx: 0, cz: 1000, halfLen: 5, w: 30, size: 30, level: 100, murk: 1 }),
};

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

describe("the composed stage and the mask", () => {
  const all = [peak, meadow, pond];
  it("applies every feature and returns the same object where none reaches", () => {
    expect(featureStageD(all, 0, 0, flat).h).toBeCloseTo(flat.h + peak.height, 9);
    expect(featureStageD(all, 1000, 0, flat).h).toBeCloseTo(meadow.height, 9);
    expect(featureStageD(all, 0, 1000, flat).h).toBeCloseTo(pond.height - 3, 9);
    expect(featureStageD(all, 500, 500, flat)).toBe(flat);
    expect(featureStageD([], 0, 0, flat)).toBe(flat);
  });
  it("masks trees out of the meadow and its margin, off the pond and its shore, and above the treeline", () => {
    expect(featureMaskAt(all, 1000, 0).tree).toBe(0);
    // The meadow's flat is the whole disc and its apron lies outside it, so
    // the tree margin starts at R + MEADOW_RIM, not at R.
    expect(featureMaskAt(all, 1000 + meadow.radius + MEADOW_RIM + 5, 0).tree).toBe(0);
    expect(featureMaskAt(all, 1000 + meadow.radius + MEADOW_RIM + 30, 0).tree).toBe(1);
    // The pond's flank is the line x = 30 for |z − 1000| ≤ 5: 7 m and 30 m out.
    expect(featureMaskAt(all, 37, 1000).tree).toBe(0);
    expect(featureMaskAt(all, 60, 1000).tree).toBe(1);
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
  it("follows the shore, not a circle: the same 9 m out on the flank and past the cap", () => {
    // smoothstep(8, 18, 9) = 0.028; the cap's tip is (0, 1035).
    expect(featureMaskAt([pond], 39, 1000).tree).toBeCloseTo(0.028, 12);
    expect(featureMaskAt([pond], 0, 1044).tree).toBeCloseTo(0.028, 12);
    // 3 m past the cap's tip, 38 m from the centre: still the bare shore.
    expect(featureMaskAt([pond], 0, 1038).bare).toBe(1);
  });

  it("marks the meadow interior and the pond shore, and leaves the rest alone", () => {
    expect(featureMaskAt(all, 1000, 0).meadow).toBe(1);
    expect(featureMaskAt(all, 1000, 0).clutter).toBe(1);
    expect(featureMaskAt(all, 32, 1000).bare).toBe(1);
    expect(featureMaskAt(all, 32, 1000).clutter).toBe(0);
    // Under the water too.
    expect(featureMaskAt(all, 10, 1000).bare).toBe(1);
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
      "POND_RADIUS_MIN", "POND_RADIUS_MAX", "POND_SHORE", "POND_TREE_MARGIN", "POND_SLOPE_MAX", "LAKE_TRAIL_CLEAR", "LAKE_SPILL_MARGIN",
      "LAKE_STEM_SHIFT", "LAKE_RING_MARGIN", "LAKE_LEVEL_RAISE_MAX",
      "MURK_LO", "MURK_HI",
      "LAKE_SHELF_DEPTH", "LAKE_SHELF_WIDTH", "LAKE_SLOPE_WIDTH", "LAKE_DEPTH_MURKY", "LAKE_DEPTH_CLEAR",
      "LAKE_JOINT_K", "LAKE_HARM_C_VALLEY", "LAKE_HARM_GAIN_MIN", "LAKE_HARM_GAIN_MAX", "LAKE_HARM_FADE_LO", "LAKE_HARM_FADE_HI",
      "LAKE_NOISE_AMP_MIN", "LAKE_NOISE_AMP_MAX", "LAKE_NOISE_WAVE", "LAKE_SPOUT_K", "LAKE_SIDE_EDGE", "LAKE_SHELF_SHARE",
      "TARN_SHELF_HEAD", "TARN_SHELF_OUTLET_SHARE", "TARN_DEPTH_SHARE", "LAKE_RAY_STEP", "LAKE_RAY_HALVINGS",
      "LAKE_BANK_GRADE_GENTLE", "LAKE_BANK_GRADE_STEEP", "LAKE_BANK_WIDTH_GENTLE", "LAKE_BANK_WIDTH_STEEP", "LAKE_BANK_EASE",
      "LAKE_APRON_RISE", "LAKE_APRON_MIN", "LAKE_APRON_MAX", "LAKE_APRON_BAND", "LAKE_APRON_STEP", "LAKE_APRON_SOFT",
      "LAKE_MEASURE_STEP", "LAKE_BOUND_MARGIN", "LAKE_BOUND_STEP", "LAKE_BOUND_REACH", "LAKE_SHAPE_SALT", "LAKE_NOISE_SALT",
      "LAKE_VALLEY_LW_LO", "LAKE_VALLEY_LW_MID", "LAKE_VALLEY_LW_HI", "LAKE_TAPER_MAX", "LAKE_VALLEY_TWO_SHARE",
      "LAKE_VALLEY_BEND_MIN", "LAKE_VALLEY_BEND_MAX", "LAKE_BEND_AT_MIN", "LAKE_BEND_AT_MAX", "LAKE_BEND3_JITTER",
      "LAKE_VALLEY_LOBED_SHARE", "LAKE_PINCH_MIN", "LAKE_PINCH_MAX", "LAKE_SPOUT_WIDTH_MIN", "LAKE_SPOUT_WIDTH_MAX",
      "LAKE_SPOUT_LENGTH_MIN", "LAKE_SPOUT_LENGTH_MAX", "LAKE_OUTLET_REACH", "LAKE_CENTRE_STEP",
      "LAKE_SILL", "LAKE_NOTCH_RAMP", "LAKE_NOTCH_FADE",
      "MARSH_MURK_MIN", "MARSH_WIDTH_MIN", "MARSH_WIDTH_MAX", "MARSH_AMP", "MARSH_NOISE_WAVE", "MARSH_EDGE",
      "MARSH_SHORE_START", "MARSH_SHORE_SCAN", "MARSH_SCORE_STEP", "MARSH_SALT", "MARSH_ONSET",
      "LOOP_WEIGHT_1", "LOOP_WEIGHT_2", "LOOP_WEIGHT_3",
      "LOOP_BAND_LO_1", "LOOP_BAND_HI_1", "LOOP_BAND_LO_2", "LOOP_BAND_HI_2", "LOOP_BAND_LO_3", "LOOP_BAND_HI_3",
      "LOOP_LATERAL_MIN", "LOOP_LATERAL_MAX", "FEATURE_ROAD_CLEAR", "FEATURE_SPACING",
      "RING_BAND", "RING_COST", "LOOP_JUNCTION_GAP", "LOOP_OVERLAP_MAX", "LOOP_JOIN_REACH", "LOOP_LEN_MIN", "LOOP_LEN_MAX",
      "LOOP_TRIES", "TREE_PENALTY", "LOOP_SCAN_STRIDE",
      "STEM_LEN_MIN", "STEM_LEN_MAX", "FEATURE_SALT",
    ];
    for (const k of keys) expect(FEATURE_TUNABLES[k], k).toBeTypeOf("number");
    expect(Object.keys(FEATURE_TUNABLES).sort()).toEqual([...keys].sort());
    // The valley lakes' outlines: POND_DEPTH and POND_APRON went with the dish,
    // and the shore's 58 constants (`LAKE_SHAPE_TUNABLES`), the sill and the
    // notch's 3, the trail's clearance, the spill's margin, the stem's
    // shift, the ring's margin and the level's raise joined — 70 keys -> 129.
    // MARSH_ONSET joined with the marsh's shore coordinates — 129 keys -> 130.
    expect(Object.keys(FEATURE_TUNABLES).length).toBe(130);
  });
  it("keeps its ranges within their working bounds", () => {
    // 220/220 and 60/90 → 300/300 and 50/80: the original numbers put the
    // flank over the routing grid's cap. See PEAK_RADIUS_MIN's comment.
    expect([PEAK_RADIUS_MIN, PEAK_RADIUS_MAX]).toEqual([300, 300]);
    expect([PEAK_RISE_MIN, PEAK_RISE_MAX]).toEqual([50, 80]);
    // 70/110 -> 50/90.
    expect([MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX]).toEqual([50, 90]);
    expect([POND_RADIUS_MIN, POND_RADIUS_MAX]).toEqual([25, 40]);
    expect(LOOP_WEIGHT_1 + LOOP_WEIGHT_2 + LOOP_WEIGHT_3).toBeCloseTo(1, 12);
  });
});

describe("murkFor", () => {
  it("is fully murky in the lowest quarter of the climb and fully clear in the highest", () => {
    expect(murkFor(10, 10, 210)).toBe(1);
    expect(murkFor(10 + 200 * MURK_LO, 10, 210)).toBe(1);
    expect(murkFor(10 + 200 * MURK_HI, 10, 210)).toBe(0);
    expect(murkFor(210, 10, 210)).toBe(0);
    expect(murkFor(110, 10, 210)).toBeCloseTo(0.5, 12);
  });

  it("stays in [0, 1] off the ends of the climb", () => {
    expect(murkFor(-50, 10, 210)).toBe(1);
    expect(murkFor(400, 10, 210)).toBe(0);
  });

  it("falls back to 0.5 with no crest, or a crest not above the pad", () => {
    expect(murkFor(50, 10, undefined)).toBe(0.5);
    expect(murkFor(50, 10, 10)).toBe(0.5);
    expect(murkFor(50, 10, 5)).toBe(0.5);
  });

  it("folds its two edges into the level id", () => {
    expect(FEATURE_TUNABLES.MURK_LO).toBe(0.25);
    expect(FEATURE_TUNABLES.MURK_HI).toBe(0.75);
  });
});

describe("the lake's bed", () => {
  it("falls to the shelf's depth at the shelf's width", () => {
    for (const murk of [0, 0.5, 1]) {
      expect(lakeDepthD(LAKE_SHELF_WIDTH, murk, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH).v).toBeCloseTo(LAKE_SHELF_DEPTH, 12);
    }
    expect(LAKE_SHELF_DEPTH).toBe(0.9);
    expect(LAKE_SHELF_WIDTH).toBe(10);
  });

  it("has a flat middle 3 m deep when murky and 6 m when clear", () => {
    const flat = LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH;
    const at = (s: number, murk: number) => lakeDepthD(s, murk, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH);
    expect(at(flat, 1).v).toBeCloseTo(LAKE_DEPTH_MURKY, 12);
    expect(at(flat, 0).v).toBeCloseTo(LAKE_DEPTH_CLEAR, 12);
    expect(at(flat + 7, 0.5).v).toBeCloseTo(4.5, 12);
    expect(at(flat + 7, 0.5).d).toBe(0);
    expect(lakeMiddleDepth(0.25)).toBeCloseTo(5.25, 12);
  });

  it("is C² at the shore, the shelf's edge and the middle's", () => {
    const e = 1e-4;
    const at = (s: number, murk: number) => lakeDepthD(s, murk, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH);
    for (const murk of [0, 1]) {
      expect(at(0, murk)).toEqual({ v: 0, d: 0 });
      for (const s of [0, LAKE_SHELF_WIDTH, LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH]) {
        const second = (t: number): number => (at(t + e, murk).d - at(t - e, murk).d) / (2 * e);
        // the second derivative is continuous: the same a little either side
        expect(Math.abs(second(s - 1e-3) - second(s + 1e-3))).toBeLessThan(0.02);
      }
    }
  });

  it("keeps a flat middle on the smallest pond", () => {
    expect(POND_RADIUS_MIN - LAKE_SHELF_WIDTH - LAKE_SLOPE_WIDTH).toBeGreaterThan(0);
  });
});

describe("the marsh", () => {
  // A murky lake 30 m in half-width about a 20 m spine along z at (0, 1000):
  // its shelf 10 m wide, its flank the line x = 30 for |z − 1000| ≤ 10.
  const shape = stadiumShape({ cx: 0, cz: 1000, halfLen: 10, w: 30, size: 30, level: 50, murk: 0.9 });
  const pond: Feature = { id: 1, kind: "pond", x: 0, z: 1000, radius: 30, height: 50, murk: 0.9, shape };
  const flatGround = (): number => 50;

  it("comes only above murk 0.5, wider the murkier, and never on a tarn", () => {
    expect(chooseLobe(shape, 30, 0.5, flatGround)).toBeNull();
    expect(chooseLobe(shape, 30, 0.49, flatGround)).toBeNull();
    expect(marshWidth(30, 1)).toBeCloseTo(MARSH_WIDTH_MAX * 30, 12);
    expect(marshWidth(30, MARSH_MURK_MIN)).toBeCloseTo(MARSH_WIDTH_MIN * 30, 12);
    expect(chooseLobe(shape, 30, 0.9, flatGround)!.width).toBeCloseTo(marshWidth(30, 0.9), 12);
    expect(chooseLobe({ ...shape, family: "tarn" }, 30, 0.9, flatGround)).toBeNull();
  });

  it("lies where the shore is nearest the level: along the contour of a slope", () => {
    const slope = (x: number): number => 50 + 0.2 * x;
    const lobe = chooseLobe(shape, 30, 0.9, slope)!;
    expect(lobe.dirX).toBe(0);
    expect(Math.abs(lobe.dirZ)).toBe(1);
  });

  it("takes the first direction on ground that ties everywhere", () => {
    expect(chooseLobe(shape, 30, 0.9, flatGround)).toMatchObject({ dirX: 1, dirZ: 0 });
  });

  const lobe = { dirX: 1, dirZ: 0, width: marshWidth(30, 0.9) };
  const withLobe: Feature = { ...pond, lobe };
  const baseAt = (x: number, z: number): TerrainSample => ({ h: 50 + 0.1 * x + 0.05 * (z - 1000), dx: 0.1, dz: 0.05 });

  it("lies strictly between the shore and the shelf's inner edge", () => {
    const pts = lobePoints(shape, lobe, 0.5);
    expect(pts.length).toBeGreaterThan(100);
    const r = newLakeShore();
    for (const [x, z] of pts) {
      const s = lakeShoreInto(r, shape, x, z).s;
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(10);
    }
  });

  it("holds its core within MARSH_AMP of the level", () => {
    let core = 0;
    for (const [x, z] of lobePoints(shape, lobe, 0.5)) {
      if (marshWeightAt(shape, lobe, x, z) < 1) continue;
      core++;
      expect(Math.abs(marshD(7, withLobe, x, z, baseAt(x, z)).h - 50)).toBeLessThanOrEqual(MARSH_AMP + 1e-12);
    }
    expect(core).toBeGreaterThan(20);
  });

  it("is the bed itself outside the marsh, and on the far side of the lake", () => {
    for (const [x, z] of [[-25, 1000], [0, 1025], [31, 1000], [10, 1000]] as const) {
      const base = baseAt(x, z);
      expect(marshD(7, withLobe, x, z, base)).toBe(base);
    }
    const inside = baseAt(25, 1000);
    expect(marshD(7, pond, 25, 1000, inside)).toBe(inside); // no marsh on this pond
  });

  it("gives way to the bed smoothly: full inside MARSH_EDGE, none at the ellipse", () => {
    expect(marshWeightAt(shape, lobe, 25, 1000)).toBe(1);
    expect(marshWeightAt(shape, lobe, 29.999, 1000)).toBeLessThan(1e-6);
    expect(marshWeightAt(shape, null, 25, 1000)).toBe(0);
    expect(MARSH_EDGE).toBe(0.55);
  });

  it("fades out before the line through the centre across it, MARSH_ONSET metres along", () => {
    // A lake 8 m in half-width about a spine across the marsh's direction:
    // its shelf (3.2 m) reaches the line x = 0 within the marsh's half-width.
    const narrow = stadiumShape({ cx: 0, cz: 1000, halfLen: 30, w: 8, size: 20, level: 50, murk: 0.9 });
    const across = { ...narrow, px: [-30, 30], pz: [1000, 1000] };
    expect(MARSH_ONSET).toBe(8);
    for (const z of [1005, 1006, 1007]) {
      expect(marshWeightAt(across, lobe, 0.001, z), `z ${z}`).toBe(0);
      expect(marshWeightAt(across, lobe, -0.001, z), `z ${z}`).toBe(0);
    }
    let past = 0;
    for (const z of [1005, 1005.5, 1006, 1006.5]) if (marshWeightAt(across, lobe, 9, z) > 0) past++;
    expect(past).toBeGreaterThan(0);
  });

  it("has exact derivatives", () => {
    const e = 1e-5;
    const at = (x: number, z: number) => marshD(7, withLobe, x, z, baseAt(x, z));
    for (let i = 0; i < 60; i++) {
      const x = 20.3 + (i % 10);
      const z = 1000 - 14 + (i * 0.47);
      const s = at(x, z);
      expect(Math.abs(s.dx - (at(x + e, z).h - at(x - e, z).h) / (2 * e))).toBeLessThan(1e-5);
      expect(Math.abs(s.dz - (at(x, z + e).h - at(x, z - e).h) / (2 * e))).toBeLessThan(1e-5);
    }
  });
});
