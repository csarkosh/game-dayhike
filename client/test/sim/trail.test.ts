import { describe, it, expect } from "vitest";
import {
  trailCorridorD, segmentDistance, segmentSegmentDistanceSq, buildProfile, profileAt,
  TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, TRAIL_TUNABLES, TRAIL_EDGE_MIN_GAP, TRAIL_PROFILE_STEP, TRAIL_PROFILE_SMOOTH,
  TRAIL_EDGE_GAP,
  type TrailNode, type TrailEdge,
} from "../../src/sim/trail.js";
import { TRAIL_GRID_CELL } from "../../src/sim/trailGrid.js";
import type { TerrainSample } from "../../src/sim/terrain.js";

/** A hillside rising in +x at grade 0.4 with a 3 m bump at x ≈ 60. */
function ground(x: number, z: number): TerrainSample {
  const b = Math.max(0, 1 - ((x - 60) / 10) ** 2);
  const bd = x >= 50 && x <= 70 ? -2 * (x - 60) / 100 : 0;
  return { h: 20 + 0.4 * x + 0.02 * z + 3 * b, dx: 0.4 + 3 * bd, dz: 0.02 };
}
const gh = (x: number, z: number) => ground(x, z).h;

describe("buildProfile / profileAt", () => {
  it("pins the ends to the node heights and follows a plane exactly", () => {
    const p = buildProfile((x, z) => 20 + 0.4 * x + 0.02 * z, 0, 0, 20, 100, 0, 60);
    expect(p.length).toBe(Math.ceil(100 / TRAIL_PROFILE_STEP) + 1);
    expect(p[0]).toBe(20);
    expect(p[p.length - 1]).toBe(60);
    for (let k = 1; k < p.length - 1; k++) expect(p[k]).toBeCloseTo(20 + 0.4 * (k * 100 / (p.length - 1)), 9);
    // Interpolation between samples is the plane too, and its derivative is the plane's rise per τ.
    for (const tau of [0.13, 0.5, 0.77, 0.999]) {
      const s = profileAt(p, tau);
      expect(s.v).toBeCloseTo(20 + 40 * tau, 6);
      expect(s.dTau).toBeCloseTo(40, 4);
    }
  });
  it("smooths a bump without moving the ends, over TRAIL_PROFILE_SMOOTH samples", () => {
    const p = buildProfile(gh, 0, 0, gh(0, 0), 120, 0, gh(120, 0));
    const n = p.length - 1;
    const kBump = Math.round(60 / (120 / n));
    // The bump is 3 m on the ground and less on the profile; the profile still rises with the hillside.
    expect(p[kBump]! - (20 + 0.4 * 60)).toBeGreaterThan(0.5);
    expect(p[kBump]! - (20 + 0.4 * 60)).toBeLessThan(3);
    expect(p[0]).toBe(gh(0, 0));
    expect(p[n]).toBe(gh(120, 0));
    expect(TRAIL_PROFILE_SMOOTH).toBeGreaterThan(0);
  });
  it("extrapolates linearly beyond the ends with the end tangent, no kink", () => {
    const p = buildProfile((x) => 20 + 0.4 * x, 0, 0, 20, 100, 0, 60);
    const at = (t: number) => profileAt(p, t);
    expect(at(-0.05).v).toBeCloseTo(at(0).v - 0.05 * at(0).dTau, 6);
    expect(at(1.05).v).toBeCloseTo(at(1).v + 0.05 * at(1).dTau, 6);
    expect(at(-0.05).dTau).toBeCloseTo(at(0).dTau, 9);
  });
});

describe("segmentDistance", () => {
  it("is perpendicular distance inside, endpoint distance beyond", () => {
    expect(segmentDistance(0, 0, 10, 0, 5, 3)).toBeCloseTo(3, 12);
    expect(segmentDistance(0, 0, 10, 0, 14, 3)).toBeCloseTo(5, 12);
    expect(segmentDistance(0, 0, 10, 0, -4, 3)).toBeCloseTo(5, 12);
  });
});

describe("segmentSegmentDistanceSq", () => {
  const d = (...a: number[]): number =>
    Math.sqrt(segmentSegmentDistanceSq(
      a[0] as number, a[1] as number, a[2] as number, a[3] as number,
      a[4] as number, a[5] as number, a[6] as number, a[7] as number,
    ));

  it("is the perpendicular offset for parallel segments", () => {
    expect(d(0, 0, 10, 0, 0, 3, 10, 3)).toBeCloseTo(3, 12);
    // Offset along the shared direction as well: still perpendicular, because
    // the projections overlap.
    expect(d(0, 0, 10, 0, 4, 3, 14, 3)).toBeCloseTo(3, 12);
  });

  it("is zero for crossing segments, both proper and touching", () => {
    expect(d(0, 0, 10, 0, 5, -5, 5, 5)).toBe(0);      // proper X
    expect(d(0, 0, 10, 0, 5, 0, 5, 5)).toBe(0);       // T, endpoint on the other
    expect(d(0, 0, 10, 0, 10, 0, 20, 0)).toBe(0);     // collinear, sharing a point
    expect(d(0, 0, 10, 0, 4, 0, 20, 0)).toBe(0);      // collinear, overlapping
  });

  it("is endpoint-to-endpoint when the projections do not overlap", () => {
    expect(d(0, 0, 10, 0, 13, 4, 20, 9)).toBeCloseTo(5, 12);   // (10,0) to (13,4)
    expect(d(0, 0, 10, 0, 20, 0, 30, 0)).toBeCloseTo(10, 12);  // collinear, disjoint
  });

  it("is endpoint-to-interior for a T that stops short", () => {
    expect(d(0, 0, 10, 0, 5, 2, 5, 9)).toBeCloseTo(2, 12);
  });

  it("is symmetric in its two segments", () => {
    const a = [1, 2, 9, 7] as const;
    const b = [-3, 5, 6, -4] as const;
    expect(d(...a, ...b)).toBeCloseTo(d(...b, ...a), 12);
  });
});

// `edgeGapSq`, `trimJunction` and `TRAIL_JUNCTION_R` were DELETED with their
// describe on 2026-09-09: the
// junction-trimmed gap query was the fan-and-chord builder's spacing check, and
// nothing in `src/` called it once the grid's two-cell rule and the
// simplifier's own `segmentSegmentDistanceSq` test took that job. The constant
// relation it used to guard is asserted in the tunables test below.

/** Two edges meeting at a node on the hillside, profiles from the ground. */
const NODES: TrailNode[] = [
  { x: 0, z: 0, h: gh(0, 0), u: 0 },
  { x: 90, z: 20, h: gh(90, 20), u: 90 },
  { x: 130, z: -40, h: gh(130, -40), u: 130 },
];
const EDGES: TrailEdge[] = [
  { a: 0, b: 1, kind: "stem", profile: buildProfile(gh, 0, 0, gh(0, 0), 90, 20, gh(90, 20)), progress0: 0, progress1: 0.5 },
  { a: 1, b: 2, kind: "stem", profile: buildProfile(gh, 90, 20, gh(90, 20), 130, -40, gh(130, -40)), progress0: 0.5, progress1: 1 },
];
const sample = (x: number, z: number) => trailCorridorD(NODES, EDGES, x, z, ground(x, z));

describe("trailCorridorD", () => {
  it("returns the base AS THE SAME OBJECT outside every corridor", () => {
    const b = ground(40, 30);
    expect(trailCorridorD(NODES, EDGES, 40, 30, b)).toBe(b);
    const c = ground(-10, -10);
    expect(trailCorridorD(NODES, EDGES, -10, -10, c)).toBe(c);
  });
  it("lays the bed on the profile, within centimetres of the ground away from the bump", () => {
    for (const tau of [0.1, 0.3, 0.9]) {
      const x = 90 * tau, z = 20 * tau;
      expect(sample(x, z).h).toBeCloseTo(profileAt(EDGES[0]!.profile, tau).v, 9);
      expect(Math.abs(sample(x, z).h - gh(x, z))).toBeLessThan(0.05);
    }
  });
  it("crosses the bump with the bump, not through it", () => {
    // At x ≈ 60 on edge 0 the ground carries a 3 m bump; the bed rises over it.
    const tau = 60 / 90;
    const onBed = sample(90 * tau, 20 * tau).h;
    expect(onBed - (20 + 0.4 * 60 + 0.02 * 20 * tau)).toBeGreaterThan(0.5);
  });
  it("levels the tread across TRAIL_BED_HALF and returns to the ground by TRAIL_CORRIDOR_HALF", () => {
    // Perpendicular to edge 0 at its midpoint.
    const ex = 90, ez = 20, L = Math.hypot(ex, ez), nx = -ez / L, nz = ex / L;
    const mx = 45, mz = 10;
    const bed = sample(mx, mz).h;
    expect(sample(mx + nx * 0.9, mz + nz * 0.9).h).toBeCloseTo(bed, 6);
    expect(sample(mx - nx * 0.9, mz - nz * 0.9).h).toBeCloseTo(bed, 6);
    const R = TRAIL_CORRIDOR_HALF + 0.01;
    const far = ground(mx + nx * R, mz + nz * R);
    expect(trailCorridorD(NODES, EDGES, mx + nx * R, mz + nz * R, far)).toBe(far);
  });
  it("adds at most a third of the bed's lift per metre across the shoulder", () => {
    // Perpendicular to edge 0 where the bed rides over the 3 m bump: the
    // corridor lifts the ground by D(n) = w(n)·(bed − ground). Its cross-grade
    // |dD/dn| is what the eye sees as the bench's shoulder; on a 1 m vertex
    // grid a shoulder steeper than ~a third of the lift per metre aliases into
    // light/dark stripes flanking the bed (2026-09-10). smootherstep's peak
    // slope is 1.875 over the blend width, so a 6 m blend (bed 1 → corridor 7)
    // caps the kernel's share at 0.3125·max|D|; the old 3 m blend allowed
    // 0.625·max|D|. The ground's own curvature under the bump adds a few
    // hundredths on top (measured 0.35·max|D| at 6 m, 0.67 at 3 m), so the
    // bound sits at 0.40: red for the old width, green for the new.
    const tau = 60 / 90, ex = 90, ez = 20, L = Math.hypot(ex, ez), nx = -ez / L, nz = ex / L;
    const mx = 90 * tau, mz = 20 * tau;
    let maxD = 0, maxGrade = 0, prev: number | null = null;
    for (let n = -TRAIL_CORRIDOR_HALF; n <= TRAIL_CORRIDOR_HALF; n += 0.05) {
      const x = mx + nx * n, z = mz + nz * n;
      const D = sample(x, z).h - gh(x, z);
      maxD = Math.max(maxD, Math.abs(D));
      if (prev !== null) maxGrade = Math.max(maxGrade, Math.abs(D - prev) / 0.05);
      prev = D;
    }
    expect(maxD).toBeGreaterThan(0.5); // the bump is really being crossed
    expect(maxGrade).toBeLessThanOrEqual(0.40 * maxD);
  });
  it("returns exact analytic derivatives across the beds, the blends and the junction", () => {
    const H = 0.01;
    let worst = 0, steepest = 0, checked = 0;
    for (const e of EDGES) {
      const a = NODES[e.a]!, b = NODES[e.b]!;
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const x0 = a.x + (b.x - a.x) * t, z0 = a.z + (b.z - a.z) * t;
        for (const off of [0, 0.6, 1.3, 2.4, 3.2, 3.9, -0.8, -2.1, -3.7]) {
          const x = x0 + off * 0.3, z = z0 + off;
          const s = sample(x, z);
          const ndx = (sample(x + H, z).h - sample(x - H, z).h) / (2 * H);
          const ndz = (sample(x, z + H).h - sample(x, z - H).h) / (2 * H);
          worst = Math.max(worst, Math.abs(s.dx - ndx), Math.abs(s.dz - ndz));
          steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(0.01 * steepest);
  });
  it("declares its tunables, exhaustively, and the two-cell rule covers the spacing invariant", () => {
    const keys = [
      "TRAIL_HARD_SLOPE_MAX", "TRAIL_EDGE_GAP", "TRAIL_BED_HALF", "TRAIL_CORRIDOR_HALF", "TRAIL_CLEAR", "TRAIL_SALT",
      "TRAIL_GRID_CELL", "TRAIL_GRID_CAP", "TRAIL_SLOPE_COST", "TRAIL_REUSE_FACTOR", "TRAIL_MOVE_GRADE_MAX", "TRAIL_SIMPLIFY_TOL",
      "TRAIL_PROFILE_STEP", "TRAIL_PROFILE_SMOOTH", "TRAIL_REROUTE_MAX",
    ];
    for (const k of keys) expect(TRAIL_TUNABLES[k], k).toBeTypeOf("number");
    expect(Object.keys(TRAIL_TUNABLES).sort()).toEqual([...keys].sort());
    expect(TRAIL_BED_HALF).toBeLessThan(TRAIL_CORRIDOR_HALF);
    expect(TRAIL_EDGE_MIN_GAP).toBe(2 * TRAIL_CORRIDOR_HALF + TRAIL_EDGE_GAP);
    expect(2 * TRAIL_GRID_CELL).toBeGreaterThanOrEqual(TRAIL_EDGE_MIN_GAP);
  });
});
