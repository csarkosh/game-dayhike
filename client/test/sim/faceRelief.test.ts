import { describe, expect, it } from "vitest";
import * as relief from "../../src/sim/faceRelief.js";
import {
  cellularD, cellularSite, faceKindD, faceReliefD, groundReliefD, FACE_RELIEF_TUNABLES,
  FACE_VALUE_SPAN, FACE_TILT,
  GROUND_SLAB_CELL, GROUND_SLAB_JITTER, GROUND_SLAB_BORDER, GROUND_SLAB_SALT, GROUND_SLAB_TILT, GROUND_SLAB_DOME,
  GROUND_RUBBLE_CELL, GROUND_RUBBLE_JITTER, GROUND_RUBBLE_BORDER, GROUND_RUBBLE_SALT, GROUND_RUBBLE_WEIGHT,
  GROUND_RUBBLE_TILT, GROUND_RUBBLE_DOME,
  GROUND_MASS_CELL, GROUND_MASS_JITTER, GROUND_MASS_BORDER, GROUND_MASS_SALT, GROUND_MASS_WEIGHT,
  GROUND_MASS_TILT, GROUND_MASS_DOME, GROUND_GAIN,
  FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, FACE_COLUMN_SALT,
  FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, FACE_BLOCK_SALT,
  FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER, FACE_BLOCK_FINE_SALT,
  FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, FACE_FORM_SALT,
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
const FORM_SALT = SEED ^ FACE_FORM_SALT;
const OTHER_SEED = 0x2b7e1516;

// 2026-10-12: before the cells grew, the five were
// { v: -0.12037865902238515, dx: 0.04777240972266101, dz: -0.0953495767388083 },
// { v: -0.10498793659924666, dx: -0.13370372839279204, dz: 0.10937997344723992 },
// { v: 0.20755520608187866, dx: 0.006429429777199409, dz: -0.05001600740943104 },
// { v: 0.7838926004062614, dx: 0.35650137342660326, dz: 0.6833581444538253 },
// { v: 0.35525572845396025, dx: 0.23628379485076956, dz: 0.1145750618920356 }.
const LITERALS: ReliefSample[] = [
  { v: -0.07751539147952732, dx: -0.029081705600085897, dz: -0.31256940893685803 },
  { v: -1, dx: 0, dz: 0 },
  { v: 1, dx: 0, dz: 0 },
  { v: 0.9369929206143341, dx: 0.06305075270789248, dz: 0.0708063536146969 },
  { v: -0.5974911820313454, dx: 0.10290644415487171, dz: 0.23077708088406573 },
];

/** The fine relief, weighted 1, over the large forms, weighted 1.5, their sum
 * times the gain over the weights' sum (2.5 / 2.5, exactly 1) and clamped to
 * [−1, 1], flat where the clamp holds: the relief's own expression. */
function gained(fine: ReliefSample, form: ReliefSample): ReliefSample {
  const n = 2.5 / 2.5;
  const v = n * (fine.v + 1.5 * form.v);
  if (v > 1 || v < -1) return { v: v > 1 ? 1 : -1, dx: 0, dz: 0 };
  return { v, dx: n * (fine.dx + 1.5 * form.dx), dz: n * (fine.dz + 1.5 * form.dz) };
}

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

/** A site's tilt term at (x, z): FACE_TILT · (a · (x − sx) + b · (z − sz)) / cell,
 * in the order the field sums it. */
function tiltTerm(
  x: number, z: number, p: { x: number; z: number; a: number; b: number }, cell: number,
): number {
  const tc = FACE_TILT / cell;
  return tc * p.a * (x - p.x) + tc * p.b * (z - p.z);
}

/** The blend written out over the 5 × 5 cells about (x, z), wider than the
 * field ever needs: its value before the clamp, and the largest and smallest
 * tilt term among the sites with weight. */
function blendSites(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): { v: number; tiltMax: number; tiltMin: number } {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  const sites: Array<{ f: number; u: number; tilt: number }> = [];
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const p = cellularSite(i, j, cell, jitter, salt);
      const tilt = tiltTerm(x, z, p, cell);
      sites.push({
        f: Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)),
        u: p.o * FACE_VALUE_SPAN + tilt,
        tilt,
      });
    }
  }
  const f1 = Math.min(...sites.map((q) => q.f));
  let sw = 0;
  let swu = 0;
  let tiltMax = -Infinity;
  let tiltMin = Infinity;
  for (const q of sites) {
    const t = Math.min(1, (q.f - f1) / border);
    const w = 1 - t * t * t * (t * (t * 6 - 15) + 10);
    if (w > 0) {
      tiltMax = Math.max(tiltMax, q.tilt);
      tiltMin = Math.min(tiltMin, q.tilt);
    }
    sw += w;
    swu += w * q.u;
  }
  return { v: swu / sw, tiltMax, tiltMin };
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

/** The smallest junction gap among the lattices with weight at (x, z): the
 * large forms everywhere, and the fine forms the share gives weight. */
function reliefGap(x: number, z: number): number {
  const s = faceKindD(SEED, x, z).v;
  let g = junctionGap(
    x, z, FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, SEED ^ FACE_FORM_SALT,
  );
  if (s < 1) {
    g = Math.min(g, junctionGap(
      x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, SEED ^ FACE_COLUMN_SALT,
    ));
  }
  if (s > 0) {
    g = Math.min(
      g,
      junctionGap(
        x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT,
      ),
      junctionGap(
        x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
        SEED ^ FACE_BLOCK_FINE_SALT,
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

/** The nearest site to (x, z) and whether every other site is a joint's
 * width farther, so the field there is that site's plane alone. */
function soleSite(
  x: number, z: number, cell: number, jitter: number, border: number, salt: number,
): { p: ReturnType<typeof cellularSite>; sole: boolean } {
  const i0 = Math.floor(x / cell);
  const j0 = Math.floor(z / cell);
  let best = Infinity;
  let second = Infinity;
  let p = cellularSite(i0, j0, cell, jitter, salt);
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const q = cellularSite(i, j, cell, jitter, salt);
      const f = Math.sqrt((x - q.x) * (x - q.x) + (z - q.z) * (z - q.z));
      if (f < best) {
        second = best;
        best = f;
        p = q;
      } else if (f < second) {
        second = f;
      }
    }
  }
  return { p, sole: second - best >= border };
}

/** A site's plane at (x, z), in the order the field sums it. */
function plane(
  x: number, z: number, p: ReturnType<typeof cellularSite>, cell: number,
): ReliefSample {
  const tc = FACE_TILT / cell;
  return { v: p.o * FACE_VALUE_SPAN + tiltTerm(x, z, p, cell), dx: tc * p.a, dz: tc * p.b };
}

describe("the cellular field", () => {
  const column = (x: number, z: number): ReliefSample =>
    cellularD(x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT);

  it("is the nearest site's plane well inside a cell", () => {
    const tc = FACE_TILT / FACE_COLUMN_CELL;
    let checked = 0;
    for (let i = -20; i < 20; i++) {
      const p = cellularSite(i, 7, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, COLUMN_SALT);
      // A tenth of a metre off the site, F1 ≈ 0.11, and F2 is far past
      // F1 and the joint's width.
      const x = p.x + 0.1;
      const z = p.z - 0.05;
      const f1 = Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
      expect(nearestOther(x, z, p, p)).toBeGreaterThan(f1 + FACE_COLUMN_BORDER);
      const s = column(x, z);
      expect(s.v).toBe(p.o * FACE_VALUE_SPAN + tiltTerm(x, z, p, FACE_COLUMN_CELL));
      expect(s.dx).toBe(tc * p.a);
      expect(s.dz).toBe(tc * p.b);
      checked++;
    }
    expect(checked).toBe(40);
  });

  it("is the mean of the two sites' planes on the border between them", () => {
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
      const ua = a.o * FACE_VALUE_SPAN + tiltTerm(mx, mz, a, FACE_COLUMN_CELL);
      const ub = b.o * FACE_VALUE_SPAN + tiltTerm(mx, mz, b, FACE_COLUMN_CELL);
      expect(column(mx, mz).v).toBe((ua + ub) / 2);
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
    ): number => Math.max(-1, Math.min(1, blendSites(x, z, cell, jitter, border, COLUMN_SALT).v));
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
    // The 5 × 5 holds every site with weight for a joint under (2 − √2)
    // cells; every lattice of the relief keeps under a quarter of a cell.
    const shares = [
      FACE_COLUMN_BORDER / FACE_COLUMN_CELL,
      FACE_BLOCK_BORDER / FACE_BLOCK_CELL,
      FACE_BLOCK_FINE_BORDER / FACE_BLOCK_FINE_CELL,
      FACE_FORM_BORDER / FACE_FORM_CELL,
    ];
    expect(shares).toEqual([0.1, 1.4 / 6, 0.7 / 3, 0.175]);
    for (const share of shares) expect(share).toBeLessThan(2 - Math.SQRT2);
  });

  it("tilts its planes both ways, within the bound, and never needs the clamp here", () => {
    // A site with weight is within F1 + border ≤ 1.42 · cell + border of the
    // sample, and |a|, |b| ≤ 1, so its tilt term is at most
    // FACE_TILT · 2 · (1.42 + border / cell). Over 20,000 points each lattice's
    // tilt reaches both signs, at under half that bound, and no blend passes
    // ±1: the clamp holds the range for every sample but engages on none here.
    const forms = [
      [FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT],
      [FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT],
      [
        FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
        SEED ^ FACE_BLOCK_FINE_SALT,
      ],
      [FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, FORM_SALT],
    ] as const;
    const seen = forms.map(([cell, jitter, border, salt]) => {
      let tiltMax = -Infinity;
      let tiltMin = Infinity;
      let clamped = 0;
      for (const [x, z] of r2Points(20000, 1000)) {
        const b = blendSites(x, z, cell, jitter, border, salt);
        tiltMax = Math.max(tiltMax, b.tiltMax);
        tiltMin = Math.min(tiltMin, b.tiltMin);
        if (b.v > 1 || b.v < -1) clamped++;
      }
      const bound = FACE_TILT * 2 * (1.42 + border / cell);
      expect(Math.max(tiltMax, -tiltMin)).toBeLessThanOrEqual(bound);
      return { tiltMax, tiltMin, clamped };
    });
    // 2026-10-12: before the cells grew, the four were
    // { tiltMax: 0.4402055220495723, tiltMin: -0.44214625627634785, clamped: 0 },
    // { tiltMax: 0.3982215901929238, tiltMin: -0.4015684322765919, clamped: 0 },
    // { tiltMax: 0.39425022331276444, tiltMin: -0.4112739089875262, clamped: 0 },
    // { tiltMax: 0.4076679714111451, tiltMin: -0.4116286666803809, clamped: 0 }.
    expect(seen).toEqual([
      { tiltMax: 0.3985676269496804, tiltMin: -0.40469138901851087, clamped: 0 },
      { tiltMax: 0.42615377839517143, tiltMin: -0.3970554417188491, clamped: 0 },
      { tiltMax: 0.3865835664243227, tiltMin: -0.38951547203652126, clamped: 0 },
      { tiltMax: 0.40425740988901027, tiltMin: -0.41973243931740706, clamped: 0 },
    ]);
  });

  it("carries exact derivatives (a 2,000-point sweep)", () => {
    const r = checkField(
      column,
      (x, z) => junctionGap(
        x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT,
      ),
      r2Points(2000, 1000),
    );
    // Measured worst / steepest: 9.3e-7, with no point left out needing it.
    // 2026-10-12: 2.6e-6 before the cells grew.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(1);
  });
});

describe("the relief", () => {
  it("carries exact derivatives through the forms and the mix (a 2,000-point sweep)", () => {
    const r = checkField((x, z) => faceReliefD(SEED, x, z), reliefGap, r2Points(2000, 1000));
    // Measured worst / steepest: 9.3e-7, with no point left out needing it.
    // 2026-10-12: 2.2e-6, and 1 left out, before the cells grew.
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    expect(r.skipped).toBe(2);
  });

  it("carries the mix's own derivative inside the forms' cells", () => {
    // In the band, inside a cell of every form, the slope is the planes' and
    // the mix's alone: under a tenth, too small for the sweep above to see
    // beside a joint. The large forms' cells count among them.
    const inside = (x: number, z: number): boolean => {
      const s = faceKindD(SEED, x, z).v;
      if (s === 0 || s === 1) return false;
      const forms = [
        [FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT],
        [FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT],
        [
          FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
          SEED ^ FACE_BLOCK_FINE_SALT,
        ],
        [FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, FORM_SALT],
      ] as const;
      return forms.every(([cell, jitter, border, salt]) => {
        const [f1, f2] = siteDistances(x, z, cell, jitter, salt) as [number, number];
        return f2 - f1 >= border;
      });
    };
    const pts = r2Points(20000, 1000).filter(([x, z]) => inside(x, z));
    // 2026-10-12: 1253 before the cells grew.
    expect(pts.length).toBe(1325);
    const r = checkField((x, z) => faceReliefD(SEED, x, z), () => Infinity, pts);
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    // Measured worst / steepest: 5.1e-10; steepest 0.10, the gain lifting the
    // mix's slopes 2.5 times. A plane's slope is its tilt over its cell, so
    // larger cells lean less per metre.
    // 2026-10-12: 2.9e-8 and steepest 0.15, held above 0.125, before the
    // cells grew.
    expect(Math.round(r.steepest * 1e4) / 1e4).toBe(0.1021);
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

  it("is the fine cells' planes over the large form's plane, inside a cell of each", () => {
    // Where the share is 0 or 1 and the point is inside a cell of every
    // lattice with weight, each lattice is its nearest site's plane, built
    // here from cellularSite: the columns' alone, or the blocks' two octaves
    // at 1 and 0.5 times 2/3, and under either the large form's at 1.5, the
    // sum divided by 2.5, multiplied by the gain of 2.5 and clamped.
    const pts: Array<[number, number]> = [];
    let first: ReliefSample | undefined;
    for (const [x, z] of r2Points(20000, 1000)) {
      const s = faceKindD(SEED, x, z).v;
      if (s !== 0 && s !== 1) continue;
      const form = soleSite(x, z, FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, FORM_SALT);
      if (!form.sole) continue;
      let fine: ReliefSample;
      if (s === 0) {
        const c = soleSite(
          x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT,
        );
        if (!c.sole) continue;
        fine = plane(x, z, c.p, FACE_COLUMN_CELL);
      } else {
        const a = soleSite(
          x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT,
        );
        const b = soleSite(
          x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
          SEED ^ FACE_BLOCK_FINE_SALT,
        );
        if (!a.sole || !b.sole) continue;
        const pa = plane(x, z, a.p, FACE_BLOCK_CELL);
        const pb = plane(x, z, b.p, FACE_BLOCK_FINE_CELL);
        fine = {
          v: (pa.v + 0.5 * pb.v) * (2 / 3),
          dx: (pa.dx + 0.5 * pb.dx) * (2 / 3),
          dz: (pa.dz + 0.5 * pb.dz) * (2 / 3),
        };
      }
      const f = plane(x, z, form.p, FACE_FORM_CELL);
      const r = faceReliefD(SEED, x, z);
      expect(r).toEqual(gained(fine, f));
      if (pts.length === 0) first = r;
      pts.push([x, z]);
    }
    // 2026-10-12: 4411 points, the first at (78.04265994708359,
    // -882.5553440311485) with { v: -0.65061572282477, dx: -0.039864086006828406,
    // dz: -0.0030732853251888813 }, before the cells grew.
    expect(pts.length).toBe(4671);
    expect(pts[0]).toEqual([568.2873274536977, -22.235926027255104]);
    expect(first).toEqual({ v: -1, dx: 0, dz: 0 });
  });

  it("is one form where the share is 0 or 1, the forms read through cellularD", () => {
    let columns = 0;
    let blocks = 0;
    let band = 0;
    const mix = gained;
    for (const [x, z] of r2Points(2000, 1000)) {
      const s = faceKindD(SEED, x, z).v;
      const r = faceReliefD(SEED, x, z);
      const form = cellularD(
        x, z, FACE_FORM_CELL, FACE_FORM_JITTER, FACE_FORM_BORDER, FORM_SALT,
      );
      if (s === 0) {
        columns++;
        const c = cellularD(
          x, z, FACE_COLUMN_CELL, FACE_COLUMN_JITTER, FACE_COLUMN_BORDER, COLUMN_SALT,
        );
        expect(r).toEqual(mix(c, form));
      } else if (s === 1) {
        blocks++;
        const a = cellularD(
          x, z, FACE_BLOCK_CELL, FACE_BLOCK_JITTER, FACE_BLOCK_BORDER, SEED ^ FACE_BLOCK_SALT,
        );
        const b = cellularD(
          x, z, FACE_BLOCK_FINE_CELL, FACE_BLOCK_FINE_JITTER, FACE_BLOCK_FINE_BORDER,
          SEED ^ FACE_BLOCK_FINE_SALT,
        );
        expect(r).toEqual(mix({
          v: (a.v + 0.5 * b.v) * (2 / 3),
          dx: (a.dx + 0.5 * b.dx) * (2 / 3),
          dz: (a.dz + 0.5 * b.dz) * (2 / 3),
        }, form));
      } else {
        band++;
      }
    }
    expect({ columns, blocks, band }).toEqual({ columns: 645, blocks: 634, band: 721 });
  });

  it("is continuous: no step along 100 lines of 100 m at 1 cm", () => {
    // Every sample, junctions included. The largest step the lines meet is
    // 0.054, a slope of 5.4: the steepest joint's 2.1 times the gain of 2.5.
    // A step over 0.25 in 1 cm, more than four times that, is no slope but a
    // break. 2026-10-12: 0.086 before the cells grew.
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
    expect(largest).toBeLessThan(0.25);
  });

  it("uses its range: a mean |v| about half the range, the clamp holding a few percent", () => {
    // Without the gain the mean of the two blends clusters near zero, a mean
    // |v| of 0.19; the gain spreads it, and the clamp holds the points it
    // carries past ±1, flat there. Counted by form over 20,000 points.
    let sum = 0;
    const clamped = { columns: 0, blocks: 0, band: 0 };
    for (const [x, z] of r2Points(20000, 1000)) {
      const s = faceKindD(SEED, x, z).v;
      const v = faceReliefD(SEED, x, z).v;
      sum += Math.abs(v);
      if (v === 1 || v === -1) clamped[s === 0 ? "columns" : s === 1 ? "blocks" : "band"]++;
    }
    const mean = sum / 20000;
    // 2026-10-12: 0.4583 and { columns: 616, blocks: 371, band: 471 } before
    // the cells grew.
    expect(Math.round(mean * 1e4) / 1e4).toBe(0.46);
    expect(mean).toBeGreaterThanOrEqual(0.45);
    expect(mean).toBeLessThanOrEqual(0.75);
    expect(clamped).toEqual({ columns: 612, blocks: 380, band: 468 });
  });

  it("differs between two worlds", () => {
    // The lattice hash takes the seed and the first index through one XOR, so
    // two seeds a few units apart share values between neighbouring cells;
    // the second world here is an unrelated seed. Where both worlds hold at
    // the same bound of the clamp they agree there, and only there.
    let same = 0;
    let held = 0;
    for (const [x, z] of r2Points(500, 1000)) {
      const a = faceReliefD(SEED, x, z).v;
      const b = faceReliefD(OTHER_SEED, x, z).v;
      if (a === b && (a === 1 || a === -1)) held++;
      else if (a === b) same++;
    }
    expect(same).toBe(0);
    expect(held).toBe(1);
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

describe("the walkable rock's relief", () => {
  /** The smallest junction gap among the three lattices: within JUNCTION_GAP
   * of a junction of three cells of any, the field has a kink no derivative
   * matches. And 0 where an octave's own value is within CLAMP_GAP of its
   * clamp: a dome crosses −1 in the hollow between two cobbles, and the
   * octave is flat past it, a crease the junction gap does not see (the
   * faces' planes clamp rarely, and far from a sweep's points). */
  const CLAMP_GAP = 2e-3;
  function groundGap(x: number, z: number): number {
    const octaves = [
      cellularD(x, z, GROUND_SLAB_CELL, GROUND_SLAB_JITTER, GROUND_SLAB_BORDER, SEED ^ GROUND_SLAB_SALT, GROUND_SLAB_TILT, GROUND_SLAB_DOME),
      cellularD(x, z, GROUND_RUBBLE_CELL, GROUND_RUBBLE_JITTER, GROUND_RUBBLE_BORDER, SEED ^ GROUND_RUBBLE_SALT, GROUND_RUBBLE_TILT, GROUND_RUBBLE_DOME),
      cellularD(x, z, GROUND_MASS_CELL, GROUND_MASS_JITTER, GROUND_MASS_BORDER, SEED ^ GROUND_MASS_SALT, GROUND_MASS_TILT, GROUND_MASS_DOME),
    ];
    if (octaves.some((o) => Math.abs(o.v) > 1 - CLAMP_GAP)) return 0;
    return Math.min(
      junctionGap(x, z, GROUND_SLAB_CELL, GROUND_SLAB_JITTER, GROUND_SLAB_BORDER, SEED ^ GROUND_SLAB_SALT),
      junctionGap(x, z, GROUND_RUBBLE_CELL, GROUND_RUBBLE_JITTER, GROUND_RUBBLE_BORDER, SEED ^ GROUND_RUBBLE_SALT),
      junctionGap(x, z, GROUND_MASS_CELL, GROUND_MASS_JITTER, GROUND_MASS_BORDER, SEED ^ GROUND_MASS_SALT),
    );
  }

  it("is the slabs, the rubble and the outcrops at their weights, gained and clamped", () => {
    const n = GROUND_GAIN / (1 + GROUND_RUBBLE_WEIGHT + GROUND_MASS_WEIGHT);
    for (const [x, z] of r2Points(300, 1000)) {
      const slab = cellularD(x, z, GROUND_SLAB_CELL, GROUND_SLAB_JITTER, GROUND_SLAB_BORDER, SEED ^ GROUND_SLAB_SALT, GROUND_SLAB_TILT, GROUND_SLAB_DOME);
      const rubble = cellularD(x, z, GROUND_RUBBLE_CELL, GROUND_RUBBLE_JITTER, GROUND_RUBBLE_BORDER, SEED ^ GROUND_RUBBLE_SALT, GROUND_RUBBLE_TILT, GROUND_RUBBLE_DOME);
      const mass = cellularD(x, z, GROUND_MASS_CELL, GROUND_MASS_JITTER, GROUND_MASS_BORDER, SEED ^ GROUND_MASS_SALT, GROUND_MASS_TILT, GROUND_MASS_DOME);
      const v = n * (slab.v + GROUND_RUBBLE_WEIGHT * rubble.v + GROUND_MASS_WEIGHT * mass.v);
      const want = v > 1 || v < -1
        ? { v: v > 1 ? 1 : -1, dx: 0, dz: 0 }
        : { v, dx: n * (slab.dx + GROUND_RUBBLE_WEIGHT * rubble.dx + GROUND_MASS_WEIGHT * mass.dx), dz: n * (slab.dz + GROUND_RUBBLE_WEIGHT * rubble.dz + GROUND_MASS_WEIGHT * mass.dz) };
      expect(groundReliefD(SEED, x, z)).toEqual(want);
    }
  });

  it("carries exact derivatives through its three octaves (a 2,000-point sweep)", () => {
    const r = checkField((x, z) => groundReliefD(SEED, x, z), groundGap, r2Points(2000, 1000));
    expect(r.worst / r.steepest).toBeLessThan(TOL_RATIO);
    // The points on an octave's clamp or a junction, left out: about half
    // of the 2,000 (957), since the rubble's domes fall past −1 over about
    // half the ground, the floor between its cobbles, flat there; the rest
    // match to the ratio.
    expect(r.skipped).toBeLessThan(1200);
    expect(r.skipped).toBeGreaterThan(500);
  });

  it("stays within [−1, 1] and finite over 20,000 points, far ones included", () => {
    const pts = [
      ...r2Points(10000, 90000),
      ...r2Points(9996, 1000),
      [90000, 90000], [-90000, 90000], [90000, -90000], [-90000, -90000],
    ] as Array<[number, number]>;
    for (const [x, z] of pts) {
      const s = groundReliefD(SEED, x, z);
      expect(Number.isFinite(s.v) && Number.isFinite(s.dx) && Number.isFinite(s.dz)).toBe(true);
      expect(Math.abs(s.v)).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic, and another field than the faces' and another world's", () => {
    let same = 0;
    let sameAsFace = 0;
    let sameAsOther = 0;
    for (const [x, z] of r2Points(500, 90000)) {
      const a = groundReliefD(SEED, x, z);
      const b = groundReliefD(SEED, x, z);
      if (Object.is(a.v, b.v) && Object.is(a.dx, b.dx) && Object.is(a.dz, b.dz)) same++;
      if (a.v === faceReliefD(SEED, x, z).v) sameAsFace++;
      if (a.v === groundReliefD(OTHER_SEED, x, z).v) sameAsOther++;
    }
    expect(same).toBe(500);
    // The clamp's ±1 can agree by chance; the rest never.
    expect(sameAsFace).toBeLessThan(100);
    expect(sameAsOther).toBeLessThan(100);
  });

  it("is continuous: no step along 100 lines of 100 m at 1 cm", () => {
    const dirs = [[1, 0], [0, 1], [0.6, 0.8], [0.8, -0.6]] as const;
    const starts = r2Points(100, 1000);
    let largest = 0;
    for (let line = 0; line < 100; line++) {
      const [ox, oz] = starts[line] as [number, number];
      const [ux, uz] = dirs[line % 4] as readonly [number, number];
      let prev = groundReliefD(SEED, ox, oz).v;
      for (let k = 1; k <= 10000; k++) {
        const v = groundReliefD(SEED, ox + ux * k * 0.01, oz + uz * k * 0.01).v;
        largest = Math.max(largest, Math.abs(v - prev));
        prev = v;
      }
    }
    // The rubble's 0.3 m joints are the steepest: a unit range over 0.3 m at
    // the gain is a step of about 0.04 in 1 cm.
    expect(largest).toBeLessThan(0.25);
  });

  it("uses its range: a mean |v| about half the range, the clamp holding some", () => {
    let sum = 0;
    let clamped = 0;
    const pts = r2Points(5000, 1000);
    for (const [x, z] of pts) {
      const v = groundReliefD(SEED, x, z).v;
      sum += Math.abs(v);
      if (v === 1 || v === -1) clamped++;
    }
    // Measured at the gain of 1.5 and the domes of 3: a mean of 0.57, 15 %
    // clamped (0.68 and 35 % at a gain of 2, where the tops and hollows sat
    // flat; 0.43 and 5 % at domes of 1.5).
    const mean = sum / pts.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.65);
    expect(clamped / pts.length).toBeGreaterThan(0.05);
    expect(clamped / pts.length).toBeLessThan(0.25);
  });
});

describe("the tunables", () => {
  it("holds every constant by name", () => {
    const keys = [
      "FACE_SLOPE_LO", "FACE_SLOPE_HI", "FACE_HALF_DEPTH",
      "FACE_COLUMN_CELL", "FACE_COLUMN_JITTER", "FACE_COLUMN_BORDER",
      "FACE_BLOCK_CELL", "FACE_BLOCK_JITTER", "FACE_BLOCK_BORDER",
      "FACE_BLOCK_FINE_CELL", "FACE_BLOCK_FINE_JITTER", "FACE_BLOCK_FINE_BORDER",
      "FACE_BLOCK_FINE_WEIGHT", "FACE_BLOCK_NORM", "FACE_VALUE_SPAN", "FACE_TILT",
      "FACE_FORM_CELL", "FACE_FORM_JITTER", "FACE_FORM_BORDER", "FACE_FORM_WEIGHT", "FACE_GAIN",
      "FACE_KIND_WAVE", "FACE_KIND_LO", "FACE_KIND_HI",
      "FACE_COLUMN_SALT", "FACE_BLOCK_SALT", "FACE_BLOCK_FINE_SALT", "FACE_KIND_SALT",
      "FACE_FORM_SALT",
      "GROUND_SLAB_CELL", "GROUND_SLAB_JITTER", "GROUND_SLAB_BORDER", "GROUND_SLAB_TILT", "GROUND_SLAB_DOME",
      "GROUND_RUBBLE_CELL", "GROUND_RUBBLE_JITTER", "GROUND_RUBBLE_BORDER", "GROUND_RUBBLE_WEIGHT",
      "GROUND_RUBBLE_TILT", "GROUND_RUBBLE_DOME",
      "GROUND_MASS_CELL", "GROUND_MASS_JITTER", "GROUND_MASS_BORDER", "GROUND_MASS_WEIGHT",
      "GROUND_MASS_TILT", "GROUND_MASS_DOME",
      "GROUND_GAIN", "GROUND_SLAB_SALT", "GROUND_RUBBLE_SALT", "GROUND_MASS_SALT",
    ];
    expect(Object.keys(FACE_RELIEF_TUNABLES).sort()).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(relief)) {
      if (typeof v === "number") expect(FACE_RELIEF_TUNABLES[k], k).toBe(v);
    }
  });
});
