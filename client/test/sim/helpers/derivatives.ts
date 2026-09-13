/**
 * Shared analytic-vs-numeric derivative harness for terrain variant tests.
 * Moved out of montane.test.ts so coastal variants can reuse it with extra
 * sweep points.
 */
import "../../../src/sim/montane.js";
import { terrainVariant, type TerrainVariant } from "../../../src/sim/terrain.js";

export const DERIV_SEED = 0x5eed;
/** Differencing arm: small enough that truncation error sits well under
 * TOL_RATIO even inside ridge creases (softened by RIDGE_EPSILON), large
 * enough that float cancellation on ~100 m heights is negligible. */
export const H = 0.02;
/**
 * The bound is a FRACTION of the sweep's steepest measured slope, not an
 * absolute gradient. Central-difference truncation error is O(H²·h''), which
 * scales linearly with the field's amplitude — so an absolute bound is really
 * a bound on `PEAK_HEIGHT`. Tuning any constant (amplitudes included) means
 * re-running this file afterward, and an absolute bound would go red on the
 * very next such change for a reason that has nothing to do with
 * derivatives. `steepest` scales with amplitude identically, so the ratio
 * does not.
 *
 * Measured worst/steepest at PEAK_HEIGHT = 650: montane 1.2e-3, plain 2.2e-3,
 * ridged 1.2e-3. 0.01 clears the largest of those by 4.6×, and the teeth are
 * untouched: dropping the weight-gradient term entirely gives 6.2e-1 and
 * flipping its sign gives 1.2e+0, i.e. 62× and 124× above this bound.
 */
export const TOL_RATIO = 0.01;

export function sweepPoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = -10; i <= 10; i++) {
    for (let j = -10; j <= 10; j += 2) {
      pts.push([i * 977.31 + 0.318, j * 1237.17 - 0.947]);
    }
  }
  // Far from the origin, both signs — coordinates can be large and negative.
  pts.push([91237.4, -88411.9], [-64203.1, 71911.7], [-95001.3, -93777.1]);
  return pts;
}

export function variantOrThrow(name: string): TerrainVariant {
  const v = terrainVariant(name);
  if (v === undefined) throw new Error(`variant ${name} not registered`);
  return v;
}

export function checkDerivatives(
  name: string,
  pts: Array<[number, number]> = sweepPoints(),
): { worst: number; steepest: number } {
  const v = variantOrThrow(name);
  let worst = 0;
  let steepest = 0;
  for (const [x, z] of pts) {
    const s = v.sample(DERIV_SEED, x, z);
    const ndx = (v.sample(DERIV_SEED, x + H, z).h - v.sample(DERIV_SEED, x - H, z).h) / (2 * H);
    const ndz = (v.sample(DERIV_SEED, x, z + H).h - v.sample(DERIV_SEED, x, z - H).h) / (2 * H);
    worst = Math.max(worst, Math.abs(s.dx - ndx), Math.abs(s.dz - ndz));
    steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
  }
  return { worst, steepest };
}
