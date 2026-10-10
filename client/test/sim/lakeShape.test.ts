import { describe, expect, it } from "vitest";
import {
  LAKE_DIRECTIONS, harmonicPair, harmonicSum, lakeDepthD, lakeShoreInto, lakeWobble, newLakeShore, quantile3,
  smin, smootherstepD, spineMetricInto, type LakeShape,
} from "../../src/sim/lakeShape.js";
import { fbm2d } from "../../src/sim/field.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { H, TOL_RATIO } from "./helpers/derivatives.js";
import { timeLimit } from "../helpers/timeLimit.js";

const metric = { v: 0, dx: 0, dz: 0 };

describe("the shore's small pieces", { timeout: timeLimit(10_000) }, () => {
  it("holds 64 unit directions 5.625° apart from +x toward +z", () => {
    expect(LAKE_DIRECTIONS).toHaveLength(64);
    expect(LAKE_DIRECTIONS[0]).toEqual([1, 0]);
    expect(LAKE_DIRECTIONS[16]).toEqual([0, 1]);
    expect(LAKE_DIRECTIONS[32]).toEqual([-1, 0]);
    expect(LAKE_DIRECTIONS[48]).toEqual([0, -1]);
    for (let k = 0; k < 64; k++) {
      const [x, z] = LAKE_DIRECTIONS[k]!;
      const [nx, nz] = LAKE_DIRECTIONS[(k + 1) % 64]!;
      expect(x * x + z * z, `k ${k}`).toBeCloseTo(1, 14);
      expect(x * nx + z * nz, `k ${k}`).toBeCloseTo(0.9951847266721969, 14);
      expect(x * nz - z * nx, `k ${k}`).toBeGreaterThan(0);
    }
  });

  it("takes the smooth minimum (a + b − √((a − b)² + k²)) / 2", () => {
    expect(smin(3, 3, 2)).toBe(2);
    expect(smin(0, 10, 0.3)).toBeCloseTo(-0.0022494939776844802, 15);
    expect(smin(10, 0, 0.3)).toBeCloseTo(-0.0022494939776844802, 15);
  });

  it("reads a three-point quantile table piecewise linearly", () => {
    expect(quantile3(0, 1.5, 2.2, 3)).toBe(1.5);
    expect(quantile3(0.25, 1.5, 2.2, 3)).toBeCloseTo(1.85, 14);
    expect(quantile3(0.5, 1.5, 2.2, 3)).toBeCloseTo(2.2, 14);
    expect(quantile3(0.75, 1.5, 2.2, 3)).toBeCloseTo(2.6, 14);
    expect(quantile3(1, 1.5, 2.2, 3)).toBe(3);
  });

  it("steps by the quintic smootherstep, flat at both ends", () => {
    expect(smootherstepD(0, 2, -1)).toEqual({ v: 0, d: 0 });
    expect(smootherstepD(0, 2, 3)).toEqual({ v: 1, d: 0 });
    expect(smootherstepD(0, 2, 1).v).toBeCloseTo(0.5, 15);
    expect(smootherstepD(0, 2, 1).d).toBeCloseTo(0.9375, 15);
  });
});

describe("the spine's metric", { timeout: timeLimit(10_000) }, () => {
  const stadium = stadiumShape({ cx: 0, cz: 10, halfLen: 10, w: 10 });

  it("is the distance to the spine over the half-width: 0 on it, 1 on the plain shore", () => {
    expect(spineMetricInto(metric, stadium, 7, 10)).toEqual({ v: 0.7, dx: 0.1, dz: 0 });
    const cap = spineMetricInto(metric, stadium, 6, 28);
    expect(cap.v).toBeCloseTo(1, 14);
    expect(cap.dx).toBeCloseTo(0.06, 14);
    expect(cap.dz).toBeCloseTo(0.08, 14);
    expect(spineMetricInto(metric, stadium, 0, 30).v).toBeCloseTo(1, 14);
  });

  it("runs the half-width between the points' widths by a smootherstep along the segment", () => {
    const egg: LakeShape = { ...stadium, width: [10, 20] };
    const m = spineMetricInto(metric, egg, 7.5, 10);
    expect(m.v).toBeCloseTo(0.5, 14);
    expect(m.dx).toBeCloseTo(0.06666666666666667, 14);
    expect(m.dz).toBeCloseTo(-0.03125, 14);
  });

  it("has no crease on the inside of a bend: the gradient is continuous across the inner bisector", () => {
    // A 45° bend at (0, 20), turning toward +x; its inner bisector leaves the
    // joint along (0.9238795325112867, −0.3826834323650898).
    const bent: LakeShape = { ...stadium, px: [0, 0, 14.142135623730951], pz: [0, 20, 34.14213562373095], width: [10, 10, 10] };
    const bx = 0.9238795325112867, bz = -0.3826834323650898;
    for (const along of [4, 8, 12]) {
      const x = bx * along, z = 20 + bz * along;
      const a = spineMetricInto({ v: 0, dx: 0, dz: 0 }, bent, x - 0.001 * bz, z + 0.001 * bx);
      const b = spineMetricInto({ v: 0, dx: 0, dz: 0 }, bent, x + 0.001 * bz, z - 0.001 * bx);
      expect(Math.abs(a.dx - b.dx), `along ${along}`).toBeLessThan(1e-3);
      expect(Math.abs(a.dz - b.dz), `along ${along}`).toBeLessThan(1e-3);
    }
  });

  it("returns its record, refilled", () => {
    const out = { v: 0, dx: 0, dz: 0 };
    expect(spineMetricInto(out, stadium, 3, 4)).toBe(out);
  });
});

describe("the harmonics and the wobble", { timeout: timeLimit(10_000) }, () => {
  const at30 = [0.8660254037844387, 0.5] as const;
  const at45 = [0.7071067811865476, 0.7071067811865476] as const;
  // cos kθ and sin kθ for k = 3 to 16, at θ = 30° and 45°.
  const want30: Array<[number, number]> = [
    [0, 1], [-0.5, 0.866025403784439], [-0.866025403784439, 0.5], [-1, 0], [-0.866025403784439, -0.5],
    [-0.5, -0.866025403784438], [0, -1], [0.5, -0.866025403784439], [0.866025403784438, -0.5], [1, 0],
    [0.866025403784439, 0.499999999999999], [0.5, 0.866025403784439], [0, 1], [-0.499999999999999, 0.866025403784439],
  ];
  const want45: Array<[number, number]> = [
    [-0.707106781186547, 0.707106781186548], [-1, 0], [-0.707106781186548, -0.707106781186547], [0, -1],
    [0.707106781186547, -0.707106781186548], [1, 0], [0.707106781186548, 0.707106781186547], [0, 1],
    [-0.707106781186548, 0.707106781186547], [-1, 0], [-0.707106781186547, -0.707106781186548], [0, -1],
    [0.707106781186548, -0.707106781186547], [1, 0],
  ];

  it("steps cos kθ and sin kθ by complex multiplication, k up to 16", () => {
    for (let k = 3; k <= 16; k++) {
      const [c30, s30] = harmonicPair(k, at30[0], at30[1]);
      expect(c30, `30° k ${k}`).toBeCloseTo(want30[k - 3]![0], 12);
      expect(s30, `30° k ${k}`).toBeCloseTo(want30[k - 3]![1], 12);
      const [c45, s45] = harmonicPair(k, at45[0], at45[1]);
      expect(c45, `45° k ${k}`).toBeCloseTo(want45[k - 3]![0], 12);
      expect(s45, `45° k ${k}`).toBeCloseTo(want45[k - 3]![1], 12);
    }
  });

  it("sums a_k cos kθ + b_k sin kθ and its derivative in θ by the same pass", () => {
    const a = new Array<number>(14).fill(0), b = new Array<number>(14).fill(0);
    a[2] = 0.2; // k = 5
    const one = harmonicSum(a, b, at30[0], at30[1]);
    expect(one.v).toBeCloseTo(-0.17320508075688776, 12);
    expect(one.dTheta).toBeCloseTo(-0.5, 12);
    b[13] = 0.1; // k = 16: sin 480° = 0.866…, d/dθ = 16 · 0.1 · cos 480° = −0.8
    const two = harmonicSum(a, b, at30[0], at30[1]);
    expect(two.v).toBeCloseTo(-0.17320508075688776 + 0.0866025403784439, 12);
    expect(two.dTheta).toBeCloseTo(-0.5 - 0.8, 12);
  });

  it("wobbles as two octaves of the field's gradient noise", () => {
    for (const [x, z] of [[1.3, -7.9], [104.25, 33.5], [-61.75, 280.125]] as const) {
      const w = lakeWobble(x, z, 0x5a1e);
      const f = fbm2d(x, z, 0x5a1e, 2);
      expect(w.v).toBeCloseTo(f.v, 12);
      expect(w.dx).toBeCloseTo(f.dx, 12);
      expect(w.dz).toBeCloseTo(f.dz, 12);
    }
  });
});

describe("the shore distance", { timeout: timeLimit(30_000) }, () => {
  // The spec's literal stadium: L:W 1.5 at mean radius 20 has w = 0.7817 R and ℓ = w.
  const w = 15.63349571083393;
  const stadium = stadiumShape({ cx: 0, cz: 0, halfLen: 7.816747855416965, w, size: 20 });

  it("is w − d on a straight stadium's flank and the distance past its cap", () => {
    const r = lakeShoreInto(newLakeShore(), stadium, 5, 0);
    expect(r.s).toBeCloseTo(10.63349571083393, 12);
    expect(r.sx).toBeCloseTo(-1, 12);
    expect(r.sz).toBeCloseTo(0, 12);
    const cap = lakeShoreInto(newLakeShore(), stadium, 0, 7.816747855416965 + w + 3);
    expect(cap.s).toBeCloseTo(-3, 12);
    expect(cap.sz).toBeCloseTo(-1, 12);
  });

  it("writes into the caller's record, returns it, and is −∞ past the bound", () => {
    const out = newLakeShore();
    expect(lakeShoreInto(out, stadium, 3, 4)).toBe(out);
    expect(lakeShoreInto(out, stadium, stadium.bound + 0.001, 0).s).toBe(Number.NEGATIVE_INFINITY);
    expect(out.depth).toBe(0);
  });

  it("returns the same record on every call, nothing allocated", { timeout: timeLimit(2000) }, () => {
    const out = newLakeShore();
    for (let i = 0; i < 1000; i++) {
      const r = lakeShoreInto(out, stadium, 3 + (i % 7), 4 - (i % 5));
      expect(r).toBe(out);
    }
    expect(lakeShoreInto(out, stadium, 3, 4)).toBe(out);
  });

  it("weighs the side: 1 toward the head, 0 away from it, ½ across and at the centre", () => {
    const at = (x: number, z: number) => lakeShoreInto(newLakeShore(), stadium, x, z);
    expect(at(12, 0).sigma).toBe(1);
    expect(at(-12, 0).sigma).toBe(0);
    expect(at(0, 12).sigma).toBeCloseTo(0.5, 15);
    expect(at(0, 0).sigma).toBe(0.5);
    // Halfway through the fade (3 m to 9 m at size 20): ½ + ½ · ½ · 1.
    const mid = at(6, 0);
    expect(mid.sigma).toBeCloseTo(0.75, 14);
    expect(mid.sigmaX).toBeCloseTo(0.15625, 14);
    expect(mid.sigmaZ).toBeCloseTo(0, 14);
  });

  it("deepens a valley lake by its shelf and drop: 0.4 sMax each at sMax 15, to 3 m at murk 1", () => {
    expect(lakeDepthD(3, 1, 6, 6)).toEqual({ v: 0.45, d: 0.28125 });
    const lake = stadiumShape({ cx: 0, cz: 0, halfLen: 10, w: 15, size: 20, murk: 1 });
    const at = (x: number) => lakeShoreInto(newLakeShore(), lake, x, 0);
    expect(at(12).depth).toBeCloseTo(0.45, 12);
    expect(at(12).depthX).toBeCloseTo(-0.28125, 12);
    expect(at(9).depth).toBeCloseTo(0.9, 12);
    expect(at(6).depth).toBeCloseTo(1.95, 12);
    expect(at(0.5).depth).toBeCloseTo(3, 12);
    expect(at(16).depth).toBe(0);
  });

  it("deepens a tarn by a shelf 2 m wide under the headwall and 0.35 sMax on the outlet side, to 0.095 · 2 · meanRadius", () => {
    const tarn = stadiumShape({ cx: 0, cz: 0, halfLen: 5, w: 20, size: 25, family: "tarn", sMax: 20, meanRadius: 25 });
    const at = (x: number) => lakeShoreInto(newLakeShore(), tarn, x, 0);
    expect(at(19).depth).toBeCloseTo(0.45, 12);
    expect(at(18).depth).toBeCloseTo(0.9, 12);
    expect(at(-16.5).depth).toBeCloseTo(0.45, 12);
    expect(at(-13).depth).toBeCloseTo(0.9, 12);
    expect(at(0).depth).toBeCloseTo(4.75, 12);
  });

  it("pushes the shore into the lake under a bulge, by β(1 − r²/ρ²)³", () => {
    const bulged: LakeShape = { ...stadium, width: [15, 15], bumps: [{ x: 12, z: 0, radius: 4, height: 0.5 }] };
    expect(lakeShoreInto(newLakeShore(), bulged, 12, 0).s).toBeCloseTo(-4.5, 12);
    expect(lakeShoreInto(newLakeShore(), bulged, 14, 0).s).toBeCloseTo(-2.1640625, 12);
  });

  it("draws the shore out along the spout, its axis half its width in", () => {
    const spouted: LakeShape = { ...stadium, width: [15, 15], spout: { ax: 15, az: 0, bx: 23, bz: 0, half: 3 } };
    expect(lakeShoreInto(newLakeShore(), spouted, 19, 0).s).toBeCloseTo(3.6608292442733115, 12);
    expect(lakeShoreInto(newLakeShore(), spouted, 30, 0).s).toBeCloseTo(-3.557567837997644, 12);
  });
});

describe("the shore distance's derivatives", { timeout: timeLimit(30_000) }, () => {
  // A bent, tapered spine with harmonics, a wobble and a spout, its joint at the centre.
  const harmA = new Array<number>(14).fill(0), harmB = new Array<number>(14).fill(0);
  harmA[0] = 0.05; harmA[2] = 0.03; harmB[1] = 0.04; harmB[4] = 0.02; harmA[9] = 0.01;
  const full: LakeShape = {
    ...stadiumShape({ cx: 0, cz: 0, halfLen: 10, w: 12, size: 20, murk: 1, sMax: 14, meanRadius: 20 }),
    px: [0, 0, 10], pz: [-15, 0, 10], width: [12, 14, 10],
    harmA, harmB, noiseAmp: 0.02, noiseSeed: 77,
    spout: { ax: -14, az: 0, bx: -20, bz: 0, half: 3 },
    shoreMax: 30, bound: 80,
  };

  it("is finite at the centre, on the spine, at its joint and along the spout", () => {
    for (const [x, z] of [[0, 0], [0, -7.5], [5, 5], [10, 10], [-14, 0], [-17, 0], [-20, 0], [-23, 0]] as const) {
      const r = lakeShoreInto(newLakeShore(), full, x, z);
      for (const v of [r.s, r.sx, r.sz, r.depth, r.depthX, r.depthZ, r.sigma, r.sigmaX, r.sigmaZ]) {
        expect(Number.isFinite(v), `(${x}, ${z})`).toBe(true);
      }
    }
  });

  it("matches central differences through the joint and the spout's mouth", () => {
    const e = 1e-4;
    for (const [x, z] of [[0.5, 0.3], [-0.4, 0.6], [-13.5, 2.2], [-16, -2.9], [-21, 1.5]] as const) {
      const r = lakeShoreInto(newLakeShore(), full, x, z);
      const ndx = (lakeShoreInto(newLakeShore(), full, x + e, z).s - lakeShoreInto(newLakeShore(), full, x - e, z).s) / (2 * e);
      const ndz = (lakeShoreInto(newLakeShore(), full, x, z + e).s - lakeShoreInto(newLakeShore(), full, x, z - e).s) / (2 * e);
      expect(Math.abs(r.sx - ndx), `(${x}, ${z})`).toBeLessThan(1e-6);
      expect(Math.abs(r.sz - ndz), `(${x}, ${z})`).toBeLessThan(1e-6);
    }
  });

  it("has exact derivatives of s, the depth and σ at 12 bearings and 11 radii", () => {
    let worst = 0, steepest = 0;
    for (const field of ["s", "depth", "sigma"] as const) {
      const dx = field === "s" ? "sx" : field === "depth" ? "depthX" : "sigmaX";
      const dz = field === "s" ? "sz" : field === "depth" ? "depthZ" : "sigmaZ";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 2 * Math.PI + 0.37;
        for (const k of [0.1, 0.3, 0.5, 0.62, 0.7, 0.8, 0.9, 0.97, 1.03, 1.2, 1.4]) {
          const x = Math.cos(a) * k * full.shoreMax, z = Math.sin(a) * k * full.shoreMax;
          const r = lakeShoreInto(newLakeShore(), full, x, z);
          const ndx = (lakeShoreInto(newLakeShore(), full, x + H, z)[field] - lakeShoreInto(newLakeShore(), full, x - H, z)[field]) / (2 * H);
          const ndz = (lakeShoreInto(newLakeShore(), full, x, z + H)[field] - lakeShoreInto(newLakeShore(), full, x, z - H)[field]) / (2 * H);
          worst = Math.max(worst, Math.abs(r[dx] - ndx), Math.abs(r[dz] - ndz));
          steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
        }
      }
    }
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});
