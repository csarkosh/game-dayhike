import { describe, expect, it } from "vitest";
import * as relief from "../../src/sim/faceRelief.js";
import {
  cellularD, cellularSite, faceKindD, faceReliefD, FACE_RELIEF_TUNABLES,
  FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, FACE_COLUMN_SALT,
  FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, FACE_BLOCK_SALT,
  FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER, FACE_BLOCK_FINE_SALT,
  type ReliefSample,
} from "../../src/sim/faceRelief.js";
import { DERIV_SEED as SEED, TOL_RATIO } from "./helpers/derivatives.js";

/** Central-difference arm. The relief's joints are a few tenths of a metre
 * wide, so the arm is far finer than the olympic harness's. */
const STEP = 1e-4;
/** A point this close to a junction of three cells (F3 − F2, in metres) may
 * sit on the kink the field has there, which no derivative matches. */
const JUNCTION_GAP = 1e-3;

const COLUMN_SALT = SEED ^ FACE_COLUMN_SALT;
const OTHER_SEED = 0x2b7e1516;

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

/** F3 − F2 of the cellular field at (x, z), over the same nine cells it reads. */
function junctionGap(x: number, z: number, cell: number, jitter: number, salt: number): number {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  const d: number[] = [];
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      const p = cellularSite(i, j, cell, jitter, salt);
      d.push(Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)));
    }
  }
  d.sort((a, b) => a - b);
  return (d[2] as number) - (d[1] as number);
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
function reliefGap(x: number, z: number): number {
  const s = faceKindD(SEED, x, z).v;
  let g = Infinity;
  if (s < 1) {
    g = Math.min(g, junctionGap(x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT));
  }
  if (s > 0) {
    g = Math.min(
      g,
      junctionGap(x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, SEED ^ FACE_BLOCK_SALT),
      junctionGap(x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, SEED ^ FACE_BLOCK_FINE_SALT),
    );
  }
  return g;
}

/** The distance from (x, z) to the nearest site other than a and b, over the
 * nine cells the field reads. */
function nearestOther(
  x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number },
): number {
  const i0 = Math.floor(x / FACE_COLUMN_CELL);
  const j0 = Math.floor(z / FACE_COLUMN_CELL);
  let best = Infinity;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    for (let j = j0 - 1; j <= j0 + 1; j++) {
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
      // on their border when no third site is as near.
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const half = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)) / 2;
      if (nearestOther(mx, mz, a, b) <= half + 0.01) continue;
      expect(column(mx, mz).v).toBe((a.o + b.o) / 2);
      checked++;
    }
    expect(checked).toBe(35);
  });

  it("carries exact derivatives (a 2,000-point sweep)", () => {
    const r = checkField(
      column,
      (x, z) => junctionGap(x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT),
      r2Points(2000, 1000),
    );
    // Measured worst / steepest: 1.4e-6, with no point left out needing it.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(2);
  });
});

describe("the relief", () => {
  it("carries exact derivatives through the forms and the mix (a 2,000-point sweep)", () => {
    const r = checkField((x, z) => faceReliefD(SEED, x, z), reliefGap, r2Points(2000, 1000));
    // Measured worst / steepest: 9.7e-7, with no point left out needing it.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(4);
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
