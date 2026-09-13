/**
 * Shared road-line probes for sim test files: the centerline x-position and
 * the road's own coast-distance offset d_r(z), both reproduced from the
 * olympic variant's PUBLIC tunables rather than any private state. Moved out
 * of olympic.test.ts's "endless highway" describe block so
 * road.test.ts's census can reuse them instead of duplicating.
 *
 * Registers the olympic variant as a side effect so callers don't have to.
 */
import "../../../src/sim/olympic.js";
import { fbm2d } from "../../../src/sim/field.js";
import { roadOffsetD } from "../../../src/sim/road.js";
import { DERIV_SEED as SEED, variantOrThrow } from "./derivatives.js";

/** Same off-lattice first coordinate and salt the coastline warp uses. */
const WARP_LINE_X = 0.318;
const COAST_WARP_SALT = 0x0cea;

/**
 * The ROAD's blend window, reproduced from the variant's tunables: the
 * headland/bay value, with no apron in it.
 *
 * 2026-09-09: this helper once pulled the window out to APRON_BLEND_END
 * inside the trail's z-window, because the variant did — and the variant
 * was wrong to.
 * `roadOffsetD`'s coast offset is a FRACTION of the window, so widening the
 * window moves the highway inland; `coastFrame` now hands the road its own
 * un-aproned pair (`roadBlendEnd`) and this oracle follows it. `apron.test.ts`
 * pins the two against each other. */
export function roadOffsetDAt(z: number): { dr: number; drDz: number } {
  const t = variantOrThrow("olympic").tunables;
  const warp = fbm2d(WARP_LINE_X, z / t.COAST_WARP_WAVELENGTH!, SEED ^ COAST_WARP_SALT, t.COAST_WARP_OCTAVES!);
  const head = 0.5 + 0.5 * warp.v;
  const blendEnd = t.BLEND_END_HEADLAND! + (t.BLEND_END_BAY! - t.BLEND_END_HEADLAND!) * head;
  return roadOffsetD(SEED, z, t.BLEND_START!, blendEnd, 0);
}

/** Find the centerline x at a given z by bisecting the signed offset.
 * d and d_r are both available through exported pieces: u = d − d_r, and
 * coastDistance gives d. */
export function centerlineX(z: number): number {
  const d = (x: number) => variantOrThrow("olympic").coastDistance!(SEED, x, z);
  // dr is d at the centerline; solve d(x) = dr via one algebraic step:
  // d(x) = x − coastline(z), so x_r = x0 − d(x0) + dr for any probe x0.
  const x0 = 0;
  const { dr } = roadOffsetDAt(z);
  return x0 - d(x0) + dr;
}
