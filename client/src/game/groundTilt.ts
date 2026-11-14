/**
 * Seating props on sloped ground: the rotation that lays a flat-bottomed model
 * on the local tangent plane.
 *
 * Renderer-only, and it has to be — the sim is forbidden trig and `Math.hypot`
 * (architecture.test.ts), so it hands over the raw ∂h/∂x and ∂h/∂z and the
 * angles are derived here. Same division of labour `clutterMeshes`'
 * `instanceMatrixFor` already documents for yaw.
 *
 * Loads no engine: a rotation is written into any `{ x, y, z, w }`, a
 * Babylon.js `Quaternion` among them (`instancePose.ts`).
 *
 * Used by the props that REST on the ground. Trees do not use it: a conifer
 * grows plumb whatever the hillside does, so its base is conformed in the
 * vertex stage instead (`groundConformPlugin.ts`).
 */
import { quatAboutAxis, quatFromUnitVectors, quatMultiply, type Quat, type Vec3 } from "./instancePose.js";

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const scratchNormal: Vec3 = { x: 0, y: 0, z: 0 };
const scratchTilt: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchYaw: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchAxis: Vec3 = { x: 0, y: 0, z: 0 };

/** The upward unit normal's y component, 1/sqrt(1 + dx² + dz²). */
export function groundNormalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

/**
 * The rotation carrying world up onto the ground normal (−dx, 1, −dz)/‖·‖, so
 * a model's local XZ plane lands on the terrain's tangent plane. Written into
 * `out`; allocation-free on the per-instance path.
 */
export function groundNormalTilt(dx: number, dz: number, out: Quat): void {
  const inv = groundNormalY(dx, dz);
  scratchNormal.x = -dx * inv;
  scratchNormal.y = inv;
  scratchNormal.z = -dz * inv;
  quatFromUnitVectors(UP, scratchNormal, out);
}

/**
 * Yaw about world Y, then the ground tilt. `quatMultiply(a, b, out)` is the
 * Hamilton product a·b, which applies b FIRST — so tilt·yaw yaws the model
 * in its own frame and then lays the result on the slope, which is the order
 * that keeps the yaw meaningful. It computes all four components before
 * writing, so aliasing `out` with an operand is safe.
 */
export function seatOnGround(yaw: number, dx: number, dz: number, out: Quat): void {
  quatAboutAxis(UP, yaw, scratchYaw);
  groundNormalTilt(dx, dz, scratchTilt);
  quatMultiply(scratchTilt, scratchYaw, out);
}

/**
 * `seatOnGround` with the lean limited to `maxTilt` radians: yaw about world
 * Y, then a rotation toward the ground normal about the axis `groundNormalTilt`
 * turns on — up × normal, which for the gradient (dx, dz) is (−dz, 0, dx)
 * normalised — through `min(acos(ny), maxTilt)`.
 *
 * For the props that STAND against a hillside rather than lie on it: a wall
 * bedded into a 45° face by the full ground normal would lie back with the
 * slope and throw its top metres out over ground its base never touched.
 * With `maxTilt` past every slope this is `seatOnGround` exactly (the axis and
 * the angle are the ones `quatFromUnitVectors` derives); with
 * `maxTilt` 0 it is the plain yaw. Allocation-free, like its uncapped twin.
 */
export function seatOnGroundCapped(
  yaw: number,
  dx: number,
  dz: number,
  maxTilt: number,
  out: Quat,
): void {
  quatAboutAxis(UP, yaw, scratchYaw);
  const len = Math.hypot(dx, dz);
  // Flat ground (or no room to lean): the axis is degenerate and the tilt is
  // the identity either way, so the yaw alone is the seating.
  if (len < 1e-12 || maxTilt <= 0) {
    out.x = scratchYaw.x;
    out.y = scratchYaw.y;
    out.z = scratchYaw.z;
    out.w = scratchYaw.w;
    return;
  }
  scratchAxis.x = -dz / len;
  scratchAxis.y = 0;
  scratchAxis.z = dx / len;
  const angle = Math.min(Math.acos(groundNormalY(dx, dz)), maxTilt);
  quatAboutAxis(scratchAxis, angle, scratchTilt);
  quatMultiply(scratchTilt, scratchYaw, out);
}
