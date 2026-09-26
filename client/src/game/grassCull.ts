/**
 * Per-frame frustum filtering of thin-instance buckets. A bucket's instances
 * surround the eye and Babylon draws a thin-instanced mesh whole or not at
 * all, so a bucket of grass is vertex-shaded in full whatever the view; at a
 * walking gaze five in six of its instances are outside it. The shells keep
 * each bucket's full collected buffers on the CPU and draw a prefix: the
 * instances inside a frustum widened by CULL_MARGIN on every side and pushed
 * back CULL_PUSHBACK behind the eye, copied in order to the front of the
 * drawn buffers. The prefix is refiltered only when the camera has turned by
 * CULL_TURN or moved by CULL_MOVE since it was cut, and those sit inside the
 * margins, so an instance the camera can see is always in the prefix.
 *
 * Pure and Babylon-free: the planes are built from the pose, not read from the
 * scene, so the kept set is a function of the pose and the collected set.
 */

/**
 * How far each side plane is opened beyond the camera's own (rad). Two
 * degrees past CULL_TURN: a yaw turn while pitched is partly a roll about the
 * view, which moves the frame's corners further than the turn itself, and the
 * view bob rolls the camera by up to 0.6°.
 */
export const CULL_MARGIN = (6 * Math.PI) / 180;
/** How far the apex is moved back along the view, behind the eye (m). */
export const CULL_PUSHBACK = 1;
/**
 * An instance's reach beyond its translation (m), which is its root on the
 * ground. The furthest a drawn vertex gets from it: a grass-class card at its
 * largest scale spans 0.50 m sideways and 0.60 m up, a blade clump 0.63 m
 * sideways and 0.50 m up, and the foliage vertex stage then moves a vertex
 * sideways by up to 0.76 of its drawn height (the wind's lean, peak gust and
 * flutter at speed 1), 0.04 m of camera tilt and 0.25 m of a player's bend:
 * 1.38 m for a card, 1.39 m for a clump. The pinned test
 * in grassCull.test.ts derives both from the models and the clump geometry,
 * and fails if a culled class reaches further.
 */
export const CULL_RADIUS = 1.5;
/** A turn (yaw or pitch, rad) past which the prefix is cut again. */
export const CULL_TURN = (4 * Math.PI) / 180;
/** A move (m) past which the prefix is cut again. */
export const CULL_MOVE = 0.5;

/** The render camera's pose: yaw 0 faces +Z, positive pitch looks down, no
 * roll; `fov` is the vertical field of view and `aspect` width over height. */
export type CullPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number };
/** One per-instance buffer: the collected `src`, the drawn `dst` of equal
 * capacity, and the floats per instance. */
export type CullStream = { src: Float32Array; dst: Float32Array; stride: number };

/**
 * The widened frustum's five planes into `out` (20 floats): right, left, top,
 * bottom, then the near plane through the pushed-back apex. Four floats each,
 * (nx, ny, nz, d) with the normal pointing inward, so a point p is inside a
 * plane when n·p + d ≥ 0. No far plane: the buckets' own discs end the field.
 */
export function cullPlanes(pose: CullPose, out: Float32Array): void {
  // Forward, right and up as inCone (wildlifeDirector.ts) has them.
  const sy = Math.sin(pose.yaw), cy = Math.cos(pose.yaw), sp = Math.sin(pose.pitch), cp = Math.cos(pose.pitch);
  const fx = sy * cp, fy = -sp, fz = cy * cp;
  const rx = cy, ry = 0, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const ax = pose.x - fx * CULL_PUSHBACK, ay = pose.y - fy * CULL_PUSHBACK, az = pose.z - fz * CULL_PUSHBACK;
  const halfY = pose.fov / 2 + CULL_MARGIN;
  const halfX = Math.atan(Math.tan(pose.fov / 2) * pose.aspect) + CULL_MARGIN;
  const side = (k: number, ex: number, ey: number, ez: number, half: number, sign: number): void => {
    // The plane through the apex holding the edge direction f·cos + sign·e·sin;
    // its inward normal is f·sin − sign·e·cos.
    const c = Math.cos(half), s = Math.sin(half);
    const nx = fx * s - sign * ex * c, ny = fy * s - sign * ey * c, nz = fz * s - sign * ez * c;
    out[k] = nx;
    out[k + 1] = ny;
    out[k + 2] = nz;
    out[k + 3] = -(nx * ax + ny * ay + nz * az);
  };
  side(0, rx, ry, rz, halfX, 1);
  side(4, rx, ry, rz, halfX, -1);
  side(8, ux, uy, uz, halfY, 1);
  side(12, ux, uy, uz, halfY, -1);
  out[16] = fx;
  out[17] = fy;
  out[18] = fz;
  out[19] = -(fx * ax + fy * ay + fz * az);
}

/**
 * Whether the prefix cut at `last` may no longer hold everything `pose` sees:
 * no cut yet, a turn past CULL_TURN, a move past CULL_MOVE, or a frustum of
 * another shape (a resized window, a new field of view).
 */
export function needsCull(last: CullPose | null, pose: CullPose): boolean {
  if (last === null) return true;
  if (pose.fov !== last.fov || pose.aspect !== last.aspect) return true;
  // The yaw difference wrapped into [−π, π], so a turn across the seam is
  // measured as the small turn it is.
  let dyaw = (pose.yaw - last.yaw) % (2 * Math.PI);
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  if (Math.abs(dyaw) > CULL_TURN || Math.abs(pose.pitch - last.pitch) > CULL_TURN) return true;
  const dx = pose.x - last.x, dy = pose.y - last.y, dz = pose.z - last.z;
  return dx * dx + dy * dy + dz * dz > CULL_MOVE * CULL_MOVE;
}

/**
 * Copies every instance of `matrix.src` (and the same instance of each
 * attribute stream) whose translation lies within CULL_RADIUS of the inside of
 * all five `planes` to the front of the `dst` buffers, in collector order, and
 * returns how many were kept. The collected buffers are only read, so the next
 * pass starts from the full set. All-zero planes keep everything.
 */
export function cullPrefix(planes: Float32Array, count: number, matrix: CullStream, attrs: readonly CullStream[]): number {
  const src = matrix.src, dst = matrix.dst;
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    const x = src[o + 12]!, y = src[o + 13]!, z = src[o + 14]!;
    let inside = true;
    for (let p = 0; p < 20; p += 4) {
      if (planes[p]! * x + planes[p + 1]! * y + planes[p + 2]! * z + planes[p + 3]! < -CULL_RADIUS) {
        inside = false;
        break;
      }
    }
    if (!inside) continue;
    // Index loops rather than `set(subarray(...))`: a view per kept instance
    // is an allocation per instance on a per-frame path.
    const d = kept * 16;
    for (let k = 0; k < 16; k++) dst[d + k] = src[o + k]!;
    for (const a of attrs) {
      const s = a.stride, so = i * s, dO = kept * s;
      for (let k = 0; k < s; k++) a.dst[dO + k] = a.src[so + k]!;
    }
    kept++;
  }
  return kept;
}
