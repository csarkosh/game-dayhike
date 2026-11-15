/**
 * Whether a lake's water is in a view, read by its shore and with no engine:
 * the points of the shore a view is tested against, the two cheap answers
 * (the eye over the water, the view's centre ray meeting the lake's level
 * over water), a shore point inside every plane of the view, and a square,
 * a box and a sphere against the planes. `lakeView.ts` asks these of a Babylon.js camera; a
 * renderer with planes of its own asks them directly (`lakeDrawnFrom`).
 *
 * Allocates nothing a call.
 */
import { lakeOutline, lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";

/** The shore's march step (m); every other point is kept, so the points stand about twice this apart. */
export const LAKE_VIEW_STEP = 2;

/** The shore at the lake's level, about 4 m apart: (x, level, z) a point. */
export function lakeViewPoints(shape: LakeShape, level: number): Float32Array {
  const o = lakeOutline(shape, LAKE_VIEW_STEP);
  const n = Math.ceil(o.xs.length / 2);
  const points = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    points[k * 3] = o.xs[k * 2] as number;
    points[k * 3 + 1] = level;
    points[k * 3 + 2] = o.zs[k * 2] as number;
  }
  return points;
}

/** A plane of a view: a point p is inside where normal · p + d is 0 or more. */
export type ViewPlane = { readonly normal: { readonly x: number; readonly y: number; readonly z: number }; readonly d: number };

/** The shore read at the eye's place and down its centre ray, reused. */
const SHORE = newLakeShore();

/**
 * Whether the eye at (ex, ey, ez) stands over the lake's water, or its
 * centre ray along (fx, fy, fz) meets the lake's level over water (a narrow
 * lens, or a steep look at a strip of water between two shore points).
 */
export function lakeUnderEye(shape: LakeShape, ex: number, ey: number, ez: number, fx: number, fy: number, fz: number): boolean {
  if (lakeShoreInto(SHORE, shape, ex, ez).s > 0) return true;
  const t = (shape.level - ey) / fy;
  return Number.isFinite(t) && t > 0 && lakeShoreInto(SHORE, shape, ex + t * fx, ez + t * fz).s > 0;
}

/** Whether one of `points` (`lakeViewPoints`) lies inside every one of `planes`. */
export function shoreInPlanes(points: Float32Array, planes: readonly ViewPlane[]): boolean {
  for (let k = 0; k < points.length; k += 3) {
    const x = points[k] as number, y = points[k + 1] as number, z = points[k + 2] as number;
    let inside = true;
    for (let p = 0; p < planes.length; p++) {
      const plane = planes[p] as ViewPlane;
      if (plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.d < 0) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Whether the level square of half-side `half` about (cx, y, cz) reaches
 * inside every one of `planes`: false only where all four corners lie
 * outside one plane, which is the test a mesh's box is culled by.
 */
export function squareInPlanes(cx: number, y: number, cz: number, half: number, planes: readonly ViewPlane[]): boolean {
  for (let p = 0; p < planes.length; p++) {
    const { normal, d } = planes[p] as ViewPlane;
    const base = normal.x * cx + normal.y * y + normal.z * cz + d;
    // The corner farthest along the plane's normal: if that one is outside, all four are.
    if (base + Math.abs(normal.x) * half + Math.abs(normal.z) * half < 0) return false;
  }
  return true;
}

/** Whether the box from (minX, minY, minZ) to (maxX, maxY, maxZ) reaches inside every one of `planes`: false only where all of it lies outside one. */
export function boxInPlanes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, planes: readonly ViewPlane[]): boolean {
  for (let p = 0; p < planes.length; p++) {
    const { normal, d } = planes[p] as ViewPlane;
    // The corner farthest along the plane's normal: if that one is outside, the whole box is.
    const far = normal.x * (normal.x >= 0 ? maxX : minX) + normal.y * (normal.y >= 0 ? maxY : minY) + normal.z * (normal.z >= 0 ? maxZ : minZ) + d;
    if (far < 0) return false;
  }
  return true;
}

/** Whether the sphere of `radius` about (x, y, z) reaches inside every one of `planes`. */
export function sphereInPlanes(x: number, y: number, z: number, radius: number, planes: readonly ViewPlane[]): boolean {
  for (let p = 0; p < planes.length; p++) {
    const { normal, d } = planes[p] as ViewPlane;
    if (normal.x * x + normal.y * y + normal.z * z + d < -radius) return false;
  }
  return true;
}

/** How near its shore (m, either side of it) an eye is taken to see the lake wherever its surface's square is in view:
 * within it a strip of water can cross a corner of the view between two shore points. */
export const LAKE_NEAR_SHORE_M = 8;

/**
 * Whether a lake's surface is to be drawn for a view: its square of
 * half-side `half` at `y` in the view's planes, and then the eye within
 * `LAKE_NEAR_SHORE_M` of its shore, the eye over the water, the centre ray
 * meeting it, or a shore point in view. A lake drawn by its square alone is
 * drawn from the bank inside that square with the water behind the eye.
 */
export function lakeDrawnFrom(
  shape: LakeShape, y: number, half: number, points: Float32Array, planes: readonly ViewPlane[],
  ex: number, ey: number, ez: number, fx: number, fy: number, fz: number,
): boolean {
  if (!squareInPlanes(shape.cx, y, shape.cz, half, planes)) return false;
  if (Math.abs(lakeShoreInto(SHORE, shape, ex, ez).s) < LAKE_NEAR_SHORE_M) return true;
  return lakeUnderEye(shape, ex, ey, ez, fx, fy, fz) || shoreInPlanes(points, planes);
}
