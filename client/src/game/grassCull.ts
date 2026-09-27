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
/** A collected buffer and the drawn buffer of equal capacity it is cut into. */
export type CullPair = { src: Float32Array; dst: Float32Array };
/**
 * One bucket's buffers as `cullPrefix` reads and writes them, built by
 * `cullSet` once per growth. The matrix (sixteen floats an instance) and the
 * vec4 streams (`foliage`, `fadeBands`) are held as float64 views of the same
 * memory, so a kept instance moves as half as many words; the one-float
 * streams (`bladeStrength`) stay float32. `last` holds the indices the drawn buffers were last
 * cut to, `kept` how many (−1 once they no longer hold that cut), so a pass
 * that keeps exactly the same instances leaves the buffers and the upload
 * alone; `next` is the list a pass writes, swapped with `last` when the cut
 * changed.
 */
export type CullSet = {
  /** Each instance's translation, x, y, z: what the planes test. */
  origins: Float32Array;
  src64: Float64Array[];
  dst64: Float64Array[];
  /** Float64 words per instance of each of `src64`: 8 for a matrix, 2 for a vec4. */
  words: number[];
  src32: Float32Array[];
  dst32: Float32Array[];
  last: Int32Array;
  next: Int32Array;
  kept: number;
};

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

/** A float64 view of a float32 buffer's memory, two floats a word. */
function words64(a: Float32Array): Float64Array {
  if (a.byteOffset % 8 !== 0 || a.length % 2 !== 0) throw new Error("cull buffers must start 8-byte aligned and hold an even count");
  return new Float64Array(a.buffer, a.byteOffset, a.length / 2);
}

/**
 * The CullSet for one bucket of `capacity` instances: `origins` (3 floats an
 * instance, written by the shell's fill), the matrix pair, and its other
 * per-instance pairs, four floats (`vec4`) or one (`scalar`) an instance.
 *
 * Moving a float32 pair as one float64 word is exact for every float32 value
 * but a NaN whose three highest mantissa bits are all set: only such a float,
 * in the pair's upper half, makes the word itself a NaN, whose payload an
 * engine may rewrite. The infinities and the usual NaN move exactly; nothing
 * culled here holds any of them (matrices, colours and fade distances are
 * finite).
 */
export function cullSet(capacity: number, origins: Float32Array, matrix: CullPair, vec4: readonly CullPair[], scalar: readonly CullPair[]): CullSet {
  return {
    origins,
    src64: [matrix, ...vec4].map((p) => words64(p.src)),
    dst64: [matrix, ...vec4].map((p) => words64(p.dst)),
    words: [8, ...vec4.map(() => 2)],
    src32: scalar.map((p) => p.src),
    dst32: scalar.map((p) => p.dst),
    last: new Int32Array(capacity),
    next: new Int32Array(capacity),
    kept: -1,
  };
}

/** Forgets the last cut: the collected buffers were rewritten (a rebuild) or
 * the drawn ones handed back (a context restore), so the next pass cuts and
 * uploads whatever it keeps. */
export function cullInvalidate(set: CullSet): void {
  set.kept = -1;
}

function copy8(src: Float64Array, dst: Float64Array, idx: Int32Array, n: number): void {
  for (let k = 0; k < n; k++) {
    const s = idx[k]! * 8, d = k * 8;
    dst[d] = src[s]!;
    dst[d + 1] = src[s + 1]!;
    dst[d + 2] = src[s + 2]!;
    dst[d + 3] = src[s + 3]!;
    dst[d + 4] = src[s + 4]!;
    dst[d + 5] = src[s + 5]!;
    dst[d + 6] = src[s + 6]!;
    dst[d + 7] = src[s + 7]!;
  }
}
function copy2(src: Float64Array, dst: Float64Array, idx: Int32Array, n: number): void {
  for (let k = 0; k < n; k++) {
    const s = idx[k]! * 2, d = k * 2;
    dst[d] = src[s]!;
    dst[d + 1] = src[s + 1]!;
  }
}
function copy1(src: Float32Array, dst: Float32Array, idx: Int32Array, n: number): void {
  for (let k = 0; k < n; k++) dst[k] = src[idx[k]!]!;
}

/**
 * Cuts the first `count` instances of `set` by `planes`: every instance whose
 * origin lies within CULL_RADIUS of the inside of all five planes is kept,
 * and the kept instances' streams are copied, in collected order, to the
 * front of the drawn buffers; `set.kept` is how many. Returns false, having
 * copied nothing, when the kept instances are exactly those of the last cut,
 * which the drawn buffers still hold; true when the prefix changed and must be
 * uploaded. The collected buffers are only read. All-zero planes keep
 * everything.
 *
 * Two passes: the plane tests write the kept indices, then each stream is
 * copied by its own tight loop. The tests take no branch per instance: each
 * instance's index is written at the cursor and the cursor advances only if
 * it is kept, and the comparison with the last cut is folded in the same way.
 * A turning view changes which instances pass from one cut to the next, and
 * early-out tests then cost about twice as much in mispredicted branches.
 */
export function cullPrefix(planes: Float32Array, count: number, set: CullSet): boolean {
  const o = set.origins, last = set.last, next = set.next, before = set.kept;
  const p0 = planes[0]!, p1 = planes[1]!, p2 = planes[2]!, p3 = planes[3]!;
  const p4 = planes[4]!, p5 = planes[5]!, p6 = planes[6]!, p7 = planes[7]!;
  const p8 = planes[8]!, p9 = planes[9]!, p10 = planes[10]!, p11 = planes[11]!;
  const p12 = planes[12]!, p13 = planes[13]!, p14 = planes[14]!, p15 = planes[15]!;
  const p16 = planes[16]!, p17 = planes[17]!, p18 = planes[18]!, p19 = planes[19]!;
  const r = -CULL_RADIUS;
  let k = 0;
  let diff = 0;
  for (let i = 0; i < count; i++) {
    const x = o[i * 3]!, y = o[i * 3 + 1]!, z = o[i * 3 + 2]!;
    const d = Math.min(
      p0 * x + p1 * y + p2 * z + p3,
      p4 * x + p5 * y + p6 * z + p7,
      p8 * x + p9 * y + p10 * z + p11,
      p12 * x + p13 * y + p14 * z + p15,
      p16 * x + p17 * y + p18 * z + p19,
    );
    const inside = +(d >= r);
    next[k] = i;
    diff |= (last[k]! ^ i) & -inside;
    k += inside;
  }
  if (diff === 0 && k === before) return false;
  set.last = next;
  set.next = last;
  set.kept = k;
  for (let s = 0; s < set.src64.length; s++) {
    if (set.words[s] === 8) copy8(set.src64[s]!, set.dst64[s]!, next, k);
    else copy2(set.src64[s]!, set.dst64[s]!, next, k);
  }
  for (let s = 0; s < set.src32.length; s++) copy1(set.src32[s]!, set.dst32[s]!, next, k);
  return true;
}
