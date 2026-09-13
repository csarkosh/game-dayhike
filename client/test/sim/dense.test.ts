// client/test/sim/dense.test.ts
import { describe, expect, it } from "vitest";
import "../../src/sim/montane.js";
import { TREELINE_LO } from "../../src/sim/vegetation.js";
import { variantOrThrow } from "./helpers/derivatives.js";

/**
 * The density census: the promises tuning must keep, all counts and
 * fractions — never absolute tolerances a tunable can silently invalidate.
 * Window and seed match a fixed baseline, so these bounds are comparable
 * with the sparse field's measured numbers (max 294 m, 0 massifs above
 * 300 m, 36 % flat lowland, 8.8 % above the treeline).
 *
 * The flats bound below is amended from an original 0.12 to 0.10 (the
 * measured PEAK finding): a 24-config sweep found a non-zero uplift floor
 * collapses flat lowland while barely raising peaks, so tall peaks were
 * chosen instead (UPLIFT_WAVELENGTH 1792, PEAK_HEIGHT 1100, floor left at
 * 0) — measured max 483 m, 19 massifs above 300 m, 11.0 % flats.
 */
const SEED = 1337;
const STEP = 64;
const X0 = 0, X1 = 8192, Z0 = -4096, Z1 = 4096;

function censusGrid(): { h: number[][]; flatLowFrac: number; max: number } {
  const v = variantOrThrow("dense");
  const h: number[][] = [];
  let flatLow = 0;
  let n = 0;
  let max = -Infinity;
  for (let z = Z0; z <= Z1; z += STEP) {
    const row: number[] = [];
    for (let x = X0; x <= X1; x += STEP) {
      const s = v.sample(SEED, x, z);
      row.push(s.h);
      max = Math.max(max, s.h);
      n++;
      if (s.h < 80 && Math.sqrt(s.dx * s.dx + s.dz * s.dz) < 0.15) flatLow++;
    }
    h.push(row);
  }
  return { h, flatLowFrac: flatLow / n, max };
}

/** 4-neighbour connected components of h > threshold. */
function massifs(h: number[][], threshold: number): number {
  const nz = h.length;
  const nx = h[0]!.length;
  const seen = h.map((row) => row.map(() => false));
  let components = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (seen[iz]![ix]! || h[iz]![ix]! <= threshold) continue;
      components++;
      const stack: Array<[number, number]> = [[iz, ix]];
      seen[iz]![ix] = true;
      while (stack.length > 0) {
        const [cz, cx] = stack.pop()!;
        for (const [dz, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const az = cz + dz, ax = cx + dx;
          if (az < 0 || az >= nz || ax < 0 || ax >= nx) continue;
          if (seen[az]![ax]! || h[az]![ax]! <= threshold) continue;
          seen[az]![ax] = true;
          stack.push([az, ax]);
        }
      }
    }
  }
  return components;
}

describe("dense density census", () => {
  const grid = censusGrid();

  it("keeps at least two massifs above 300 m in the view window", () => {
    expect(massifs(grid.h, 300)).toBeGreaterThanOrEqual(2);
  });

  it("reaches real peak height — snow becomes reachable", () => {
    expect(grid.max).toBeGreaterThan(400);
  });

  it("keeps flat lowland for the future highway", () => {
    // Amended bound: 0.12 -> 0.10, per the measured PEAK finding — a
    // non-zero uplift floor recovers flats but flattens peaks too, so tall
    // peaks were chosen instead, accepting less flat land.
    expect(grid.flatLowFrac).toBeGreaterThanOrEqual(0.10);
  });

  it("keeps the forested proportion after the treeline re-anchor", () => {
    const flat = grid.h.flat();
    const above = flat.filter((h) => h > TREELINE_LO).length / flat.length;
    expect(above).toBeGreaterThanOrEqual(0.05);
    expect(above).toBeLessThanOrEqual(0.15);
  });
});
