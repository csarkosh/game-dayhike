/**
 * Distances in the ground plane between a point, a segment and an
 * axis-aligned box, for placing things beside the trail. A box is its centre
 * and its half-extents along x and z.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export type Ground = { x: number; z: number };

/** From a point to a box; 0 inside it. */
export function pointBoxGap(px: number, pz: number, centre: Ground, half: Ground): number {
  const ex = (px < centre.x ? centre.x - px : px - centre.x) - half.x;
  const ez = (pz < centre.z ? centre.z - pz : pz - centre.z) - half.z;
  const gx = ex > 0 ? ex : 0, gz = ez > 0 ? ez : 0;
  return Math.sqrt(gx * gx + gz * gz);
}

/** From a point to the segment a→b; a segment of no length is a point. */
export function pointSegmentGap(px: number, pz: number, a: Ground, b: Ground): number {
  const sx = b.x - a.x, sz = b.z - a.z;
  const len2 = sx * sx + sz * sz;
  let t = len2 === 0 ? 0 : ((px - a.x) * sx + (pz - a.z) * sz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (a.x + sx * t), dz = pz - (a.z + sz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Whether the segment a→b touches the box: a slab clip on each axis. */
function segmentCrossesBox(a: Ground, b: Ground, centre: Ground, half: Ground): boolean {
  let t0 = 0, t1 = 1;
  const axes: ReadonlyArray<readonly [number, number, number]> = [
    [a.x - centre.x, b.x - a.x, half.x],
    [a.z - centre.z, b.z - a.z, half.z],
  ];
  for (const [p, d, h] of axes) {
    if (d === 0) {
      if (p < -h || p > h) return false;
      continue;
    }
    let lo = (-h - p) / d, hi = (h - p) / d;
    if (lo > hi) {
      const s = lo;
      lo = hi;
      hi = s;
    }
    if (lo > t0) t0 = lo;
    if (hi < t1) t1 = hi;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * From the segment a→b to a box; 0 where they touch. Two convex shapes that
 * do not touch are nearest at a corner of one of them, so the least of the
 * segment's two ends to the box and the box's four corners to the segment is
 * the answer.
 */
export function segmentBoxGap(a: Ground, b: Ground, centre: Ground, half: Ground): number {
  if (segmentCrossesBox(a, b, centre, half)) return 0;
  let gap = pointBoxGap(a.x, a.z, centre, half);
  const end = pointBoxGap(b.x, b.z, centre, half);
  if (end < gap) gap = end;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = pointSegmentGap(centre.x + sx * half.x, centre.z + sz * half.z, a, b);
      if (g < gap) gap = g;
    }
  }
  return gap;
}
