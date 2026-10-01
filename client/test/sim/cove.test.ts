import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import {
  coveFor, coveProfileD, COVE_WIDTH_MIN, COVE_WIDTH_MAX, COVE_FACE_GRADE, COVE_BED_GRADE, COVE_CREST,
  COVE_BACK_FADE, COVE_END_BLEND, HEAD_HEIGHT_MIN, HEAD_HEIGHT_MAX, HEAD_REACH_MIN, HEAD_REACH_MAX, HEAD_HALF_WIDTH,
  roadFrameAt,
} from "../../src/sim/olympic.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";
import { checkDerivatives, TOL_RATIO, variantOrThrow } from "./helpers/derivatives.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the cove's profile", () => {
  it("meets the sea at the waterline at 1:12", () => {
    expect(coveProfileD(0).v).toBeCloseTo(0, 9);
    expect(coveProfileD(0).dd).toBeCloseTo(COVE_FACE_GRADE, 9);
    expect(coveProfileD(30).v).toBeCloseTo(30 * COVE_FACE_GRADE, 9);
  });

  it("tops out in a berm 3 m up with a flat backshore behind it", () => {
    expect(coveProfileD(40).v).toBeCloseTo(COVE_CREST, 9);
    expect(coveProfileD(40).dd).toBeCloseTo(0, 9);
    expect(coveProfileD(90).v).toBeCloseTo(COVE_CREST, 9);
  });

  it("falls at 1:12 to 2 m deep, then at 1:50 to the 8 m shelf break, then to the floor", () => {
    expect(coveProfileD(-12).v).toBeCloseTo(-1, 9);
    expect(coveProfileD(-124).v).toBeCloseTo(-4, 9);
    expect(coveProfileD(-124).dd).toBeCloseTo(COVE_BED_GRADE, 9);
    expect(coveProfileD(-324).v).toBeCloseTo(-8, 9);
    expect(coveProfileD(-2000).v).toBe(-25);
  });

  it("never falls going inland, and is nowhere steeper than 1:12", () => {
    let prev = -Infinity;
    for (let d = -1500; d <= 120; d += 0.25) {
      const p = coveProfileD(d);
      expect(p.v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(p.dd).toBeLessThanOrEqual(COVE_FACE_GRADE + 1e-12);
      prev = p.v;
    }
  });

  it("has an exact derivative", () => {
    const e = 1e-4;
    for (let d = -1200; d <= 100; d += 3.7) {
      const num = (coveProfileD(d + e).v - coveProfileD(d - e).v) / (2 * e);
      expect(Math.abs(coveProfileD(d).dd - num)).toBeLessThan(1e-7);
    }
  });
});

describe("the cove in front of the trailhead", { timeout: timeLimit(120_000) }, () => {
  const seeds = [0x5eed, 1, 12345, 777, 4242];

  it("is centred on the pad, seeded within its sizes, with one or two stacks off each headland", () => {
    for (const seed of seeds) {
      const c = coveFor(seed);
      expect(coveFor(seed)).toBe(c);
      expect(c.z0).toBe(TRAIL_Z_ANCHOR);
      expect(2 * c.halfWidth).toBeGreaterThanOrEqual(COVE_WIDTH_MIN);
      expect(2 * c.halfWidth).toBeLessThanOrEqual(COVE_WIDTH_MAX);
      expect(c.heads.map((h) => Math.sign(h.z - c.z0))).toEqual([-1, 1]);
      for (const h of c.heads) {
        expect(h.height).toBeGreaterThanOrEqual(HEAD_HEIGHT_MIN);
        expect(h.height).toBeLessThanOrEqual(HEAD_HEIGHT_MAX);
        expect(h.reach).toBeGreaterThanOrEqual(HEAD_REACH_MIN);
        expect(h.reach).toBeLessThanOrEqual(HEAD_REACH_MAX);
        const off = c.stacks.filter((s) => Math.abs(s.z - h.z) <= HEAD_HALF_WIDTH / 2).length;
        expect(off).toBeGreaterThanOrEqual(1);
        expect(off).toBeLessThanOrEqual(2);
      }
    }
  });

  it("rises from the sea at 1:12 to the berm at the pad's frontage", () => {
    const v = variantOrThrow("olympic");
    for (const seed of seeds) {
      const cx = v.roadCenterX!(seed, TRAIL_Z_ANCHOR);
      const x0 = cx - v.coastDistance!(seed, cx, TRAIL_Z_ANCHOR); // the waterline: d = 0
      expect(Math.abs(v.sample(seed, x0, TRAIL_Z_ANCHOR).h)).toBeLessThan(1e-9);
      const grade = (v.sample(seed, x0 + 1, TRAIL_Z_ANCHOR).h - v.sample(seed, x0 - 1, TRAIL_Z_ANCHOR).h) / 2;
      expect(grade).toBeCloseTo(COVE_FACE_GRADE, 3);
      if (x0 + 40 <= cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE) {
        expect(v.sample(seed, x0 + 40, TRAIL_Z_ANCHOR).h).toBeCloseTo(COVE_CREST, 9);
      }
    }
  });

  it("names its weight on the variant: 1 in the cove, 0 in the corridor and past the headlands", () => {
    const v = variantOrThrow("olympic");
    const seed = 0x5eed;
    const c = coveFor(seed);
    const cx = v.roadCenterX!(seed, 0);
    expect(v.coveMask!(seed, cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE - 5, 0)).toBe(1);
    expect(v.coveMask!(seed, cx - ROAD_CORRIDOR_HALF + 0.5, 0)).toBe(0);
    const far = c.halfWidth + 40;
    expect(v.coveMask!(seed, v.roadCenterX!(seed, far) - 80, far)).toBe(0);
  });

  it("weighs nothing past the along-shore window's far edge, and the same as before inside it", () => {
    const v = variantOrThrow("olympic");
    const seed = 0x5eed;
    const c = coveFor(seed);
    const seaward = (z: number): number => v.roadCenterX!(seed, z) - ROAD_CORRIDOR_HALF - COVE_BACK_FADE - 5;
    for (const sign of [-1, 1]) {
      const past = c.z0 + sign * (c.halfWidth + COVE_END_BLEND + 1);
      expect(v.coveMask!(seed, seaward(past), past)).toBe(0);
      // a metre inside the edge the window's tail still holds a little
      const inside = c.z0 + sign * (c.halfWidth + COVE_END_BLEND - 1);
      expect(v.coveMask!(seed, seaward(inside), inside)).toBeGreaterThan(0);
    }
    // At z0 the along-shore window is 1, so the weight is the seaward
    // window alone, in the back fade, from the road's own frame.
    const smootherstep = (e0: number, e1: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * t * (t * (t * 6 - 15) + 10);
    };
    const x = v.roadCenterX!(seed, c.z0) - ROAD_CORRIDOR_HALF - COVE_BACK_FADE / 3;
    const u = roadFrameAt(seed, x, c.z0).u;
    const full = 1 - smootherstep(-ROAD_CORRIDOR_HALF - COVE_BACK_FADE, -ROAD_CORRIDOR_HALF, u);
    expect(full).toBeGreaterThan(0.05);
    expect(full).toBeLessThan(0.95);
    expect(v.coveMask!(seed, x, c.z0)).toBeCloseTo(full, 12);
  });

  it("has exact derivatives across the cove, its ends, the headlands and the stacks", () => {
    const v = variantOrThrow("olympic");
    for (const seed of [0x5eed, 12345]) {
      const c = coveFor(seed);
      const pts: Array<[number, number]> = [];
      for (let z = -c.halfWidth - 60.3; z <= c.halfWidth + 60; z += 17.9) {
        for (let u = -330.1; u <= -25; u += 11.3) pts.push([v.roadCenterX!(seed, z) + u, z]);
      }
      for (const s of c.stacks) for (const k of [0.3, 0.7, 0.95]) pts.push([s.x + k * s.radius, s.z + 0.37]);
      const { worst, steepest } = checkDerivatives("olympic", pts, seed);
      expect(worst / steepest).toBeLessThan(TOL_RATIO);
    }
  });
});
