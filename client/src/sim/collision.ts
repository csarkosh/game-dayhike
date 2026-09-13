import type { Vec3 } from "./types.js";
import type { Aabb } from "./level.js";
import { boxesNear, type BoxProvider } from "./boxSource.js";
import type { GroundField } from "./ground.js";
import { EPSILON, GROUND_RAY_STEP, GROUND_RAY_REFINEMENTS } from "./constants.js";

export type SweepHit = { t: number; normal: Vec3 };

export function expand(box: Aabb, half: Vec3): Aabb {
  return {
    min: { x: box.min.x - half.x, y: box.min.y - half.y, z: box.min.z - half.z },
    max: { x: box.max.x + half.x, y: box.max.y + half.y, z: box.max.z + half.z },
  };
}

/**
 * Slab test for a ray travelling `delta` from `origin`, against an already-expanded box.
 * Returns the entry fraction in [0, 1] and the face normal, or null.
 *
 * Bounded to [0,1] on purpose: callers pass the full frame displacement as `delta`,
 * so `t` is directly the fraction of this frame's motion that is safe to apply.
 */
function slab(origin: Vec3, delta: Vec3, box: Aabb): SweepHit | null {
  const o = [origin.x, origin.y, origin.z];
  const d = [delta.x, delta.y, delta.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];

  let tMin = 0;
  let tMax = 1;
  let hitAxis = -1;
  let hitSign = 0;

  for (let a = 0; a < 3; a++) {
    const oa = o[a] as number;
    const da = d[a] as number;
    const loa = lo[a] as number;
    const hia = hi[a] as number;

    if (Math.abs(da) < EPSILON) {
      // Parallel to this slab: no crossing is possible, so it must already overlap.
      if (oa < loa || oa > hia) return null;
      continue;
    }

    const inv = 1 / da;
    let t1 = (loa - oa) * inv;
    let t2 = (hia - oa) * inv;
    // Moving in +a enters through the min face (normal -a); moving in -a enters
    // through the max face (normal +a).
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    // `>=` not `>`. With `>`, a mover resting exactly on a surface produces
    // t1 === tMin === 0, hitAxis is never recorded, and the sweep reports no
    // hit — so the player falls straight through the floor it is standing on.
    // This is the single nastiest bug in this file; do not "simplify" it.
    if (t1 >= tMin) {
      tMin = t1;
      hitAxis = a;
      hitSign = sign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Every axis was parallel-and-overlapping: the mover starts inside. Report no
  // hit and let the caller's skin offset keep it from getting worse.
  if (hitAxis < 0) return null;

  const normal: Vec3 = { x: 0, y: 0, z: 0 };
  if (hitAxis === 0) normal.x = hitSign;
  else if (hitAxis === 1) normal.y = hitSign;
  else normal.z = hitSign;

  return { t: tMin, normal };
}

/**
 * Pushes a mover out of anything it is already overlapping, along the axis of
 * least penetration. Returns `center` unchanged when it is clear.
 *
 * This is not a nicety. `slab` reports no hit for a mover that starts inside a
 * box, so a penetrating mover has no collision at all. Snapshot positions are
 * quantized to 1/128 m, which routinely lands a client 1-3 mm *below* the
 * surface it is resting on — and a client that cannot detect the floor never
 * becomes grounded, so it silently switches to air acceleration and drifts
 * away from the host. Both sides run this, so both agree.
 */
export function depenetrate(center: Vec3, half: Vec3, provider: BoxProvider): Vec3 {
  const p: Vec3 = { x: center.x, y: center.y, z: center.z };

  // Twice the hull. Exact for the shallow penetration this function exists to
  // resolve, and measured to agree with a whole-level scan to the bit at up to
  // 5 cm deep. Deeper than that the least-penetration push along a large box can
  // exceed this region, so a spatial source may miss a box a flat scan would
  // find — see the note in chunkGrid.test.ts. Bounding it exactly would require
  // knowing the largest box extent a source can return, which is not worth
  // coupling this file to for a depth the simulation never reaches.
  const boxes = boxesNear(
    provider,
    { x: center.x - half.x * 2, y: center.y - half.y * 2, z: center.z - half.z * 2 },
    { x: center.x + half.x * 2, y: center.y + half.y * 2, z: center.z + half.z * 2 },
  );

  for (const box of boxes) {
    const e = expand(box, half);
    // Strict inequalities: exactly touching is resting, not penetrating.
    if (p.x <= e.min.x || p.x >= e.max.x) continue;
    if (p.y <= e.min.y || p.y >= e.max.y) continue;
    if (p.z <= e.min.z || p.z >= e.max.z) continue;

    const outMinX = p.x - e.min.x;
    const outMaxX = e.max.x - p.x;
    const outMinY = p.y - e.min.y;
    const outMaxY = e.max.y - p.y;
    const outMinZ = p.z - e.min.z;
    const outMaxZ = e.max.z - p.z;

    let best = outMinX;
    let axis = 0;
    let sign = -1;
    if (outMaxX < best) {
      best = outMaxX;
      axis = 0;
      sign = 1;
    }
    if (outMinY < best) {
      best = outMinY;
      axis = 1;
      sign = -1;
    }
    if (outMaxY < best) {
      best = outMaxY;
      axis = 1;
      sign = 1;
    }
    if (outMinZ < best) {
      best = outMinZ;
      axis = 2;
      sign = -1;
    }
    if (outMaxZ < best) {
      best = outMaxZ;
      axis = 2;
      sign = 1;
    }

    if (axis === 0) p.x = sign > 0 ? e.max.x : e.min.x;
    else if (axis === 1) p.y = sign > 0 ? e.max.y : e.min.y;
    else p.z = sign > 0 ? e.max.z : e.min.z;
  }

  return p;
}

export function sweepBox(
  center: Vec3,
  half: Vec3,
  delta: Vec3,
  provider: BoxProvider,
): SweepHit | null {
  if (Math.abs(delta.x) < EPSILON && Math.abs(delta.y) < EPSILON && Math.abs(delta.z) < EPSILON) {
    return null;
  }
  // The hull's swept AABB. A box matters exactly when `expand(box, half)` is
  // crossed, which is when the box itself intersects this region.
  const boxes = boxesNear(
    provider,
    {
      x: Math.min(center.x, center.x + delta.x) - half.x,
      y: Math.min(center.y, center.y + delta.y) - half.y,
      z: Math.min(center.z, center.z + delta.z) - half.z,
    },
    {
      x: Math.max(center.x, center.x + delta.x) + half.x,
      y: Math.max(center.y, center.y + delta.y) + half.y,
      z: Math.max(center.z, center.z + delta.z) + half.z,
    },
  );
  let best: SweepHit | null = null;
  for (const box of boxes) {
    const hit = slab(center, delta, expand(box, half));
    if (hit !== null && (best === null || hit.t < best.t)) best = hit;
  }
  return best;
}

export function raycastBox(origin: Vec3, dir: Vec3, maxDist: number, box: Aabb): number | null {
  const delta: Vec3 = { x: dir.x * maxDist, y: dir.y * maxDist, z: dir.z * maxDist };
  const hit = slab(origin, delta, box);
  return hit === null ? null : hit.t * maxDist;
}

/**
 * Distance along the ray to the ground surface, or null if it never dips below.
 *
 * The ground is a height field rather than a box, so there is no closed form:
 * this marches the sign of `rayHeight - groundHeight` and bisects the interval
 * that flips. Both halves are pure arithmetic over the same analytic field
 * every peer evaluates, so two peers agree exactly.
 *
 * The march can miss a ridge thinner than GROUND_RAY_STEP that the ray crosses
 * and leaves within one step. At 0.5 m against terrain whose gradient stays
 * near 1, that needs a spike narrower than half a metre, which this field does
 * not produce — and the cost of the alternative, a step small enough to be
 * unconditionally safe, is paid on every ray.
 */
export function raycastGround(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  ground: GroundField,
): number | null {
  const gapAt = (t: number): number =>
    origin.y + dir.y * t - ground.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);

  if (gapAt(0) <= 0) return 0; // started inside the ground

  let previous = 0;
  for (let t = GROUND_RAY_STEP; previous < maxDist; t += GROUND_RAY_STEP) {
    const capped = t > maxDist ? maxDist : t;
    if (gapAt(capped) > 0) {
      previous = capped;
      continue;
    }
    // Bracketed: above the surface at `previous`, on or below it at `capped`.
    let above = previous;
    let below = capped;
    for (let i = 0; i < GROUND_RAY_REFINEMENTS; i++) {
      const mid = (above + below) / 2;
      if (gapAt(mid) > 0) above = mid;
      else below = mid;
    }
    return below;
  }
  return null;
}

/**
 * Nearest hit against props and the ground together — what a sight line
 * actually meets. `ground` is null on hand-authored levels, whose floors
 * are ordinary brushes and so are already in `provider`.
 */
export function raycastScene(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  provider: BoxProvider,
  ground: GroundField | null,
): number | null {
  const box = raycast(origin, dir, maxDist, provider);
  if (ground === null) return box;
  const terrain = raycastGround(origin, dir, maxDist, ground);
  if (box === null) return terrain;
  if (terrain === null) return box;
  return terrain < box ? terrain : box;
}

/**
 * The query region is the segment's bounding box: correct, but less selective
 * than walking the grid cell by cell. Acceptable because the per-tick
 * line-of-sight ray is capped at ENEMY_DETECT_RANGE.
 */
export function raycast(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  provider: BoxProvider,
): number | null {
  const ex = origin.x + dir.x * maxDist;
  const ey = origin.y + dir.y * maxDist;
  const ez = origin.z + dir.z * maxDist;
  const boxes = boxesNear(
    provider,
    { x: Math.min(origin.x, ex), y: Math.min(origin.y, ey), z: Math.min(origin.z, ez) },
    { x: Math.max(origin.x, ex), y: Math.max(origin.y, ey), z: Math.max(origin.z, ez) },
  );
  let best: number | null = null;
  for (const box of boxes) {
    const d = raycastBox(origin, dir, maxDist, box);
    if (d !== null && (best === null || d < best)) best = d;
  }
  return best;
}
