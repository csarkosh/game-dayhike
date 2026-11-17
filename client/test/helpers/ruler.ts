/**
 * The tests' ruler: the plain arithmetic of a vector turned by a quaternion
 * and of a dot product, for a test that measures what a module made (a
 * rotation, by where it carries a vector) rather than comparing numbers
 * with numbers. Each is written in the order of operations Babylon.js's
 * `Vector3` uses, and a test that measures with it first holds it, bit for
 * bit, to what Babylon.js gave for that test's own cases
 * (`babylonFixture.ts`).
 *
 * Loads no engine.
 */

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** `v` turned by the unit quaternion `q`: v + w t + q x t, where t = 2 q x v. */
export function turned(q: Quat, v: Vec): Vec {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/** a · b. */
export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
