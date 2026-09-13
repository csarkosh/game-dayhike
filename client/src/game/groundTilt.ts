/**
 * Seating props on sloped ground: the rotation that lays a flat-bottomed model
 * on the local tangent plane.
 *
 * Renderer-only, and it has to be — the sim is forbidden trig and `Math.hypot`
 * (architecture.test.ts), so it hands over the raw ∂h/∂x and ∂h/∂z and the
 * angles are derived here. Same division of labour `clutterMeshes`'
 * `writeInstanceMatrix` already documents for yaw.
 *
 * Used by the props that REST on the ground. Trees do not use it: a conifer
 * grows plumb whatever the hillside does, so its base is conformed in the
 * vertex stage instead (`groundConformPlugin.ts`).
 */
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const UP = new Vector3(0, 1, 0);
const scratchNormal = new Vector3();
const scratchTilt = new Quaternion();
const scratchYaw = new Quaternion();

/** The upward unit normal's y component, 1/sqrt(1 + dx² + dz²). */
export function groundNormalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

/**
 * The rotation carrying world up onto the ground normal (−dx, 1, −dz)/‖·‖, so
 * a model's local XZ plane lands on the terrain's tangent plane. Written into
 * `out`; allocation-free on the per-instance path.
 */
export function groundNormalTilt(dx: number, dz: number, out: Quaternion): void {
  const inv = groundNormalY(dx, dz);
  scratchNormal.copyFromFloats(-dx * inv, inv, -dz * inv);
  Quaternion.FromUnitVectorsToRef(UP, scratchNormal, out);
}

/**
 * Yaw about world Y, then the ground tilt. Babylon's `a.multiplyToRef(b, out)`
 * is the Hamilton product a·b, which applies b FIRST — so tilt·yaw yaws the
 * model in its own frame and then lays the result on the slope, which is the
 * order that keeps the yaw meaningful. `multiplyToRef` computes all four
 * components before writing, so aliasing `out` with an operand is safe.
 */
export function seatOnGround(yaw: number, dx: number, dz: number, out: Quaternion): void {
  Quaternion.RotationAxisToRef(UP, yaw, scratchYaw);
  groundNormalTilt(dx, dz, scratchTilt);
  scratchTilt.multiplyToRef(scratchYaw, out);
}
