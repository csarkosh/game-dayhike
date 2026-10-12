import { describe, expect, it } from "vitest";
import * as relief from "../../src/sim/faceRelief.js";
import { olympicPreFaceSample } from "../../src/sim/olympic.js";
import type { TerrainSample } from "../../src/sim/terrain.js";
import {
  cellularD, cellularSite, faceKindD, faceReliefD, faceStageD, FACE_RELIEF_TUNABLES,
  FACE_SLOPE_LO, FACE_HALF_DEPTH,
  FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, FACE_COLUMN_SALT,
  FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, FACE_BLOCK_SALT,
  FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER, FACE_BLOCK_FINE_SALT,
  type ReliefSample,
} from "../../src/sim/faceRelief.js";
import { DERIV_SEED as SEED, TOL_RATIO } from "./helpers/derivatives.js";

/** Central-difference arm. The relief's joints are a few tenths of a metre
 * wide, so the arm is far finer than the olympic harness's. */
const STEP = 1e-4;
/** A point this close to a junction of three cells (`junctionGap`, in metres)
 * may sit on the kink the field has there, which no derivative matches. The
 * 2,000-point sweeps pass without leaving any out; denser ones meet kinks. */
const JUNCTION_GAP = 1e-3;

const COLUMN_SALT = SEED ^ FACE_COLUMN_SALT;
const OTHER_SEED = 0x2b7e1516;

const LITERALS: ReliefSample[] = [
  { v: -0.255054656435144, dx: 0.01242232974021108, dz: -0.04521580781442783 },
  { v: -0.641117458228481, dx: -0.02593568427113229, dz: 0.016330546971062593 },
  { v: 0.6808243365958333, dx: 0, dz: 0 },
  { v: -0.04838613330646532, dx: 0.7350120827756929, dz: 1.2471781921775384 },
  { v: -0.5118525647114797, dx: 0.29837845129074664, dz: 0.2101162746605993 },
];

/** The R2 low-discrepancy sequence over a square of half-width `half` about
 * the origin: an even, deterministic spread with no lattice to alias. */
function r2Points(n: number, half: number): Array<[number, number]> {
  const a1 = 0.7548776662466927;
  const a2 = 0.5698402909980532;
  const pts: Array<[number, number]> = [];
  for (let i = 1; i <= n; i++) {
    const u = (0.5 + a1 * i) % 1;
    const w = (0.5 + a2 * i) % 1;
    pts.push([(2 * u - 1) * half, (2 * w - 1) * half]);
  }
  return pts;
}

/** The sites' distances from (x, z), nearest first, over the 5 × 5 cells
 * about it (wider than the field ever needs). */
function siteDistances(
  x: number, z: number, cell: number, jitter: number, salt: number,
): number[] {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  const d: number[] = [];
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const p = cellularSite(i, j, cell, jitter, salt);
      d.push(Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)));
    }
  }
  return d.sort((a, b) => a - b);
}

/** How near (x, z) is to a kink of the cellular field: F2 − F1 where a third
 * site has weight (F3 − F1 < border), the nearest site changing there while
 * the third's weight reads it; Infinity elsewhere, where the field is smooth. */
function junctionGap(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): number {
  const [f1, f2, f3] = siteDistances(x, z, cell, jitter, salt) as [number, number, number];
  return f3 - f1 < border ? f2 - f1 : Infinity;
}

/**
 * The olympic harness's measure for any field: the worst gap between the
 * analytic and the central-difference derivative, and the sweep's steepest
 * numeric slope. A point whose junction gap is under JUNCTION_GAP is left out
 * of `worst` and counted in `skipped`; `worstAll` keeps every point.
 */
function checkField(
  f: (x: number, z: number) => ReliefSample,
  gap: (x: number, z: number) => number,
  pts: Array<[number, number]>,
): { worst: number; worstAll: number; steepest: number; skipped: number } {
  let worst = 0;
  let worstAll = 0;
  let steepest = 0;
  let skipped = 0;
  for (const [x, z] of pts) {
    const s = f(x, z);
    const ndx = (f(x + STEP, z).v - f(x - STEP, z).v) / (2 * STEP);
    const ndz = (f(x, z + STEP).v - f(x, z - STEP).v) / (2 * STEP);
    const err = Math.max(Math.abs(s.dx - ndx), Math.abs(s.dz - ndz));
    steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
    worstAll = Math.max(worstAll, err);
    if (gap(x, z) < JUNCTION_GAP) skipped++;
    else worst = Math.max(worst, err);
  }
  return { worst, worstAll, steepest, skipped };
}

/** The smallest junction gap among the forms with weight at (x, z). */
function reliefGap(x: number, z: number, seed = SEED): number {
  const s = faceKindD(seed, x, z).v;
  let g = Infinity;
  if (s < 1) {
    g = Math.min(g, junctionGap(
      x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, seed ^ FACE_COLUMN_SALT,
    ));
  }
  if (s > 0) {
    g = Math.min(
      g,
      junctionGap(
        x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, seed ^ FACE_BLOCK_SALT,
      ),
      junctionGap(
        x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
        seed ^ FACE_BLOCK_FINE_SALT,
      ),
    );
  }
  return g;
}

/** The distance from (x, z) to the nearest column site other than a and b,
 * over the 5 × 5 cells about it. */
function nearestOther(
  x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number },
): number {
  const i0 = Math.floor(x / FACE_COLUMN_CELL);
  const j0 = Math.floor(z / FACE_COLUMN_CELL);
  let best = Infinity;
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const p = cellularSite(i, j, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT);
      if ((p.x === a.x && p.z === a.z) || (p.x === b.x && p.z === b.z)) continue;
      best = Math.min(best, Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)));
    }
  }
  return best;
}

describe("the cellular field", () => {
  const column = (x: number, z: number): ReliefSample =>
    cellularD(x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT);

  it("is the nearest site's value, flat, well inside a cell", () => {
    let checked = 0;
    for (let i = -20; i < 20; i++) {
      const p = cellularSite(i, 7, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT);
      // On the site itself F1 = 0, and F2 is far past the joint's width.
      expect(nearestOther(p.x, p.z, p, p)).toBeGreaterThan(FACE_COLUMN_BORDER);
      const s = column(p.x, p.z);
      expect(s.v).toBe(p.o);
      expect(s.dx).toBe(0);
      expect(s.dz).toBe(0);
      checked++;
    }
    expect(checked).toBe(40);
  });

  it("is the mean of the two sites' values on the border between them", () => {
    let checked = 0;
    for (let i = -20; i < 20; i++) {
      const a = cellularSite(i, -3, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT);
      const b = cellularSite(i + 1, -3, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT);
      // The midpoint of two neighbouring sites is equidistant from both; it is
      // on their border, with no third value in the mix, when every other
      // site is a joint's width farther.
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const half = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)) / 2;
      if (nearestOther(mx, mz, a, b) <= half + FACE_COLUMN_BORDER) continue;
      expect(column(mx, mz).v).toBe((a.o + b.o) / 2);
      checked++;
    }
    expect(checked).toBe(32);
  });

  it("is the blend over every site with weight, the window widened when one is outside", () => {
    // The 5 × 5 reference holds every site with weight for any sample; the
    // field reads nine sites unless one with weight could lie outside them.
    // That is rare at the columns' numbers (none in 20,000 points here), so a
    // full jitter and a joint half a cell wide stand in for the case.
    const reference = (
      x: number, z: number, cell: number, jitter: number, border: number,
    ): number => {
      const i0 = Math.floor(x / cell);
      const j0 = Math.floor(z / cell);
      const sites: Array<{ f: number; o: number }> = [];
      for (let i = i0 - 2; i <= i0 + 2; i++) {
        for (let j = j0 - 2; j <= j0 + 2; j++) {
          const p = cellularSite(i, j, cell, jitter, COLUMN_SALT);
          sites.push({ f: Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)), o: p.o });
        }
      }
      const f1 = Math.min(...sites.map((q) => q.f));
      let sw = 0;
      let swo = 0;
      for (const q of sites) {
        const t = Math.min(1, (q.f - f1) / border);
        const w = 1 - t * t * t * (t * (t * 6 - 15) + 10);
        sw += w;
        swo += w * q.o;
      }
      return swo / sw;
    };
    const worst = (cell: number, jitter: number, border: number, half: number): number => {
      let e = 0;
      for (const [x, z] of r2Points(20000, half)) {
        const v = cellularD(x, z, cell, jitter, border, COLUMN_SALT).v;
        e = Math.max(e, Math.abs(v - reference(x, z, cell, jitter, border)));
      }
      return e;
    };
    const columns = worst(FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, 1000);
    expect(columns).toBeLessThan(1e-12);
    expect(worst(1, 1, 0.5, 300)).toBeLessThan(1e-12);
  });

  it("carries exact derivatives (a 2,000-point sweep)", () => {
    const r = checkField(
      column,
      (x, z) => junctionGap(
        x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT,
      ),
      r2Points(2000, 1000),
    );
    // Measured worst / steepest: 2.1e-6, with no point left out needing it.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(1);
  });
});

describe("the relief", () => {
  it("carries exact derivatives through the forms and the mix (a 2,000-point sweep)", () => {
    const r = checkField((x, z) => faceReliefD(SEED, x, z), reliefGap, r2Points(2000, 1000));
    // Measured worst / steepest: 1.7e-6, with no point left out needing it.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(1);
  });

  it("carries the mix's own derivative where the forms are flat", () => {
    // In the band, inside a cell of every form, the slope is the mix's alone:
    // a tenth at most, too small for the sweep above to see beside a joint.
    const flat = (x: number, z: number): boolean => {
      const s = faceKindD(SEED, x, z).v;
      if (s === 0 || s === 1) return false;
      const forms = [
        cellularD(x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT),
        cellularD(
          x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT,
        ),
        cellularD(
          x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
          SEED ^ FACE_BLOCK_FINE_SALT,
        ),
      ];
      return forms.every((f) => f.dx === 0 && f.dz === 0);
    };
    const pts = r2Points(20000, 1000).filter(([x, z]) => flat(x, z));
    expect(pts.length).toBe(1956);
    const r = checkField((x, z) => faceReliefD(SEED, x, z), () => Infinity, pts);
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    // Measured worst / steepest: 3.4e-8.
    expect(r.steepest).toBeGreaterThan(0.1);
  });

  it("stays within [−1, 1] and finite over 20,000 points, far ones included", () => {
    const pts = [
      ...r2Points(10000, 90000),
      ...r2Points(9996, 1000),
      [90000, 90000], [-90000, 90000], [90000, -90000], [-90000, -90000],
    ] as Array<[number, number]>;
    expect(pts.length).toBe(20000);
    for (const [x, z] of pts) {
      const s = faceReliefD(SEED, x, z);
      expect(Number.isFinite(s.v) && Number.isFinite(s.dx) && Number.isFinite(s.dz)).toBe(true);
      expect(Math.abs(s.v)).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic: two calls are bitwise equal", () => {
    for (const [x, z] of r2Points(500, 90000)) {
      const a = faceReliefD(SEED, x, z);
      const b = faceReliefD(SEED, x, z);
      expect(Object.is(a.v, b.v) && Object.is(a.dx, b.dx) && Object.is(a.dz, b.dz)).toBe(true);
    }
  });

  it("pins its value at five points", () => {
    // Exact: + − × ÷, Math.floor and Math.sqrt are correctly rounded in every
    // engine, and so is every value here.
    const at = (x: number, z: number): ReliefSample => faceReliefD(SEED, x, z);
    expect(at(0.5, 0.25)).toEqual(LITERALS[0]);
    expect(at(123.456, -789.012)).toEqual(LITERALS[1]);
    expect(at(-90000.5, -88888.25)).toEqual(LITERALS[2]);
    expect(at(-1234.5, 4321.75)).toEqual(LITERALS[3]);
    expect(at(77777.7, -66666.6)).toEqual(LITERALS[4]);
  });

  it("is one form where the share is 0 or 1, the forms read through cellularD", () => {
    let columns = 0;
    let blocks = 0;
    let band = 0;
    for (const [x, z] of r2Points(2000, 1000)) {
      const s = faceKindD(SEED, x, z).v;
      const r = faceReliefD(SEED, x, z);
      if (s === 0) {
        columns++;
        const c = cellularD(
          x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT,
        );
        expect(r).toEqual(c);
      } else if (s === 1) {
        blocks++;
        const a = cellularD(
          x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT,
        );
        const b = cellularD(
          x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
          SEED ^ FACE_BLOCK_FINE_SALT,
        );
        expect(r).toEqual({
          v: (a.v + 0.5 * b.v) * (2 / 3),
          dx: (a.dx + 0.5 * b.dx) * (2 / 3),
          dz: (a.dz + 0.5 * b.dz) * (2 / 3),
        });
      } else {
        band++;
      }
    }
    expect({ columns, blocks, band }).toEqual({ columns: 645, blocks: 634, band: 721 });
  });

  it("is continuous: no step along 100 lines of 100 m at 1 cm", () => {
    // Every sample, junctions included. The largest slope the sweeps meet is
    // 12.7, so a step over 0.15 in 1 cm is no slope but a break.
    const dirs = [[1, 0], [0, 1], [0.6, 0.8], [0.8, -0.6]] as const;
    const starts = r2Points(100, 1000);
    let largest = 0;
    for (let line = 0; line < 100; line++) {
      const [ox, oz] = starts[line] as [number, number];
      const [ux, uz] = dirs[line % 4] as readonly [number, number];
      let prev = faceReliefD(SEED, ox, oz).v;
      for (let k = 1; k <= 10000; k++) {
        const v = faceReliefD(SEED, ox + ux * k * 0.01, oz + uz * k * 0.01).v;
        largest = Math.max(largest, Math.abs(v - prev));
        prev = v;
      }
    }
    expect(largest).toBeLessThan(0.15);
  });

  it("differs between two worlds", () => {
    // The lattice hash takes the seed and the first index through one XOR, so
    // two seeds a few units apart share values between neighbouring cells;
    // the second world here is an unrelated seed.
    let same = 0;
    for (const [x, z] of r2Points(500, 1000)) {
      if (faceReliefD(SEED, x, z).v === faceReliefD(OTHER_SEED, x, z).v) same++;
    }
    expect(same).toBe(0);
  });

  it("splits a square kilometre between columns, blocks and the band between", () => {
    // 41 × 41 points at 25 m.
    let columns = 0;
    let blocks = 0;
    let band = 0;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        const s = faceKindD(SEED, -500 + 25 * i, -500 + 25 * j).v;
        if (s === 0) columns++;
        else if (s === 1) blocks++;
        else band++;
      }
    }
    expect({ columns, blocks, band }).toEqual({ columns: 550, blocks: 540, band: 591 });
  });
});

describe("faceStageD", () => {
  /** The world whose scarp the sweep below crosses. */
  const SCARP_SEED = 627994160;
  const pre = (x: number, z: number): TerrainSample => olympicPreFaceSample(SCARP_SEED, x, z);
  const stage = (x: number, z: number): TerrainSample =>
    faceStageD(SCARP_SEED, x, z, pre(x, z), pre);

  /** The scarp's face and its foot and crest: 79 × 31 points. */
  function scarp(): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    for (let x = -358; x <= -280; x += 1) {
      for (let z = -960; z <= -840; z += 4) pts.push([x, z]);
    }
    return pts;
  }
  const steep = (x: number, z: number): boolean => {
    const s = pre(x, z);
    return s.dx * s.dx + s.dz * s.dz > FACE_SLOPE_LO * FACE_SLOPE_LO;
  };

  it("returns the sample itself where the gradient is at most FACE_SLOPE_LO", () => {
    const never = (): TerrainSample => {
      throw new Error("sampled the chain below the slope");
    };
    for (const s of [
      { h: 12, dx: 0, dz: 0 },
      { h: 12, dx: 0.6, dz: -0.7 },
      { h: 12, dx: -1, dz: 0 },
      { h: 12, dx: 0, dz: 1 },
    ]) {
      expect(faceStageD(SCARP_SEED, 3.5, -7.25, s, never)).toBe(s);
    }
    let flat = 0;
    for (const [x, z] of scarp()) {
      if (steep(x, z)) continue;
      const s = pre(x, z);
      expect(faceStageD(SCARP_SEED, x, z, s, pre)).toBe(s);
      flat++;
    }
    expect(flat).toBe(88);
  });

  it("moves the steep ground by at most FACE_HALF_DEPTH along its normal", () => {
    let n = 0;
    let moved = 0;
    for (const [x, z] of scarp()) {
      if (!steep(x, z)) continue;
      const s = pre(x, z);
      const g2 = s.dx * s.dx + s.dz * s.dz;
      const d = Math.abs(stage(x, z).h - s.h);
      expect(d).toBeLessThanOrEqual(FACE_HALF_DEPTH * Math.sqrt(1 + g2));
      n++;
      if (d > 0.3) moved++; // more than half the half-depth, measured upright
    }
    expect(n).toBe(2361);
    expect(moved).toBe(1310);
  });

  it("carries exact derivatives over the scarp's steep ground", () => {
    const pts = scarp().filter(([x, z]) => steep(x, z));
    const r = checkField(
      (x, z) => {
        const s = stage(x, z);
        return { v: s.h, dx: s.dx, dz: s.dz };
      },
      (x, z) => reliefGap(x, z, SCARP_SEED),
      pts,
    );
    // Measured worst / steepest: 5.4e-5, with no point left out needing it.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(1);
  });
});

describe("the tunables", () => {
  it("holds every constant by name", () => {
    const keys = [
      "FACE_SLOPE_LO", "FACE_SLOPE_HI", "FACE_HALF_DEPTH", "FACE_DIFF_STEP",
      "FACE_COLUMN_CELL", "FACE_COLUMN_JITTER", "FACE_COLUMN_BORDER",
      "FACE_BLOCK_CELL", "FACE_BLOCK_JITTER", "FACE_BLOCK_BORDER",
      "FACE_BLOCK_FINE_CELL", "FACE_BLOCK_FINE_JITTER", "FACE_BLOCK_FINE_BORDER",
      "FACE_BLOCK_FINE_WEIGHT", "FACE_BLOCK_NORM",
      "FACE_KIND_WAVE", "FACE_KIND_LO", "FACE_KIND_HI",
      "FACE_COLUMN_SALT", "FACE_BLOCK_SALT", "FACE_BLOCK_FINE_SALT", "FACE_KIND_SALT",
    ];
    expect(Object.keys(FACE_RELIEF_TUNABLES).sort()).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(relief)) {
      if (typeof v === "number") expect(FACE_RELIEF_TUNABLES[k], k).toBe(v);
    }
  });
});
