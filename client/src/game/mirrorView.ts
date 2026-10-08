/**
 * The lake mirror's view and projection, Babylon-free and on
 * BABYLON_FREE_FILES: the reflection in the water's plane and Lengyel's
 * oblique near plane, so the mirrored camera clips at the water with no
 * clip plane, no clip-distance varying and no shader variant.
 *
 * Every matrix is a Float32Array(16) in Babylon's layout: row-major storage
 * of a matrix that multiplies a ROW vector on its left, `clip = p · M`, so
 * clip component j is Σ_i p_i · m[4i + j] and the translation sits in
 * m[12..14]. `Matrix.FromArray(out)` reads these arrays as they are, and
 * `camera.getProjectionMatrix().m` and `getViewMatrix().m` are in the same
 * layout. Lengyel's paper writes column vectors, so his "third row" (the
 * coefficients that make clip z) is m[2], m[6], m[10], m[14] here, and his
 * "fourth row" (clip w) is m[3], m[7], m[11], m[15].
 *
 * The mirrored camera's view is `reflection · view`: a world point is
 * mirrored in the water first, then seen by the player's view.
 */

const scratchInverse = new Float64Array(16);
const scratchQ = new Float64Array(4);

/**
 * The reflection in the plane y = `level`: (x, y, z) → (x, 2·level − y, z).
 * Writes `out` (Babylon layout), returns it. Its determinant is −1, so
 * winding flips under it. The same matrix as Babylon's
 * `Matrix.ReflectionToRef(new Plane(0, 1, 0, -level))`.
 */
export function reflectionMatrix(level: number, out: Float32Array): Float32Array {
  out.fill(0);
  out[0] = 1;
  out[5] = -1;
  out[10] = 1;
  out[13] = 2 * level;
  out[15] = 1;
  return out;
}

/**
 * Inverts the 4×4 matrix `m` into `out`, in double precision (any layout:
 * the inverse of the stored array is the stored inverse). Returns false and
 * leaves `out` as it was when `m` is singular.
 */
function invert4(m: Float32Array, out: Float64Array): boolean {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0 || !Number.isFinite(det)) return false;
  const inv = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
  return true;
}

/**
 * Lengyel's oblique near plane. `projection` is a perspective projection in
 * Babylon's layout (`camera.getProjectionMatrix().m`); `plane` is (a, b, c,
 * d) in that camera's space, a·x + b·y + c·z + d = 0, its normal pointing
 * into the half-space that is kept and the camera on the other side (d < 0
 * for a plane under the eye with its normal pointing away from it). The
 * clip-z coefficients (m[2], m[6], m[10], m[14]) are replaced so that the
 * near plane is `plane` and the far plane still passes through the
 * frustum's far corner on the plane's side:
 *
 * - `halfZ` true, [0, 1] depth (WebGPU, `engine.isNDCHalfZRange`):
 *   z' = λ·C with λ = (M₄·Q) / (C·Q), so a point on the plane has depth 0;
 * - `halfZ` false, [−1, 1] depth (WebGL2):
 *   z' = λ·C − M₄ with λ = 2·(M₄·Q) / (C·Q), so a point on the plane has depth −1;
 *
 * where M₄ is the clip-w coefficients and Q the camera-space point the
 * projection takes to (sgn a, sgn b, 1, 1). Points across the plane fall
 * under the near depth and are clipped. Every other entry is `projection`'s.
 * Writes `out` (which may be `projection` itself) and returns it; a singular
 * projection, or a plane the frustum's far corner lies on or behind (C·Q ≤
 * 0: nothing of the frustum to keep, the near plane would turn over), leaves
 * `out` a copy of `projection`. `plane` may be a tuple or the Float32Array
 * `cameraSpacePlane` writes.
 */
export function obliqueProjection(
  projection: Float32Array,
  plane: ArrayLike<number>,
  halfZ: boolean,
  out: Float32Array,
): Float32Array {
  if (out !== projection) out.set(projection);
  if (!invert4(projection, scratchInverse)) return out;
  const qx = Math.sign(plane[0]!);
  const qy = Math.sign(plane[1]!);
  // Q = q · P⁻¹ for the row vector q = (sgn a, sgn b, 1, 1).
  for (let i = 0; i < 4; i++) {
    scratchQ[i] =
      qx * scratchInverse[i]! +
      qy * scratchInverse[4 + i]! +
      scratchInverse[8 + i]! +
      scratchInverse[12 + i]!;
  }
  const cDotQ =
    plane[0]! * scratchQ[0]! + plane[1]! * scratchQ[1]! + plane[2]! * scratchQ[2]! + plane[3]! * scratchQ[3]!;
  if (cDotQ <= 0 || !Number.isFinite(cDotQ)) return out;
  const wQ =
    scratchQ[0]! * projection[3]! +
    scratchQ[1]! * projection[7]! +
    scratchQ[2]! * projection[11]! +
    scratchQ[3]! * projection[15]!;
  const lambda = ((halfZ ? 1 : 2) * wQ) / cDotQ;
  for (let i = 0; i < 4; i++) {
    const w = halfZ ? 0 : projection[4 * i + 3]!;
    out[4 * i + 2] = lambda * plane[i]! - w;
  }
  return out;
}

/**
 * The world plane y = `level` (normal +y: the water's upper side is kept) in
 * the space of the camera whose view is `view` (Babylon layout): for the
 * mirrored camera pass its view, `reflection · view`. With the view's
 * inverse V⁻¹, component j is Σ_i V⁻¹[4j + i] · (0, 1, 0, −level)_i, so a
 * camera-space point c lies on the kept side when plane · (c, 1) > 0. For
 * the mirrored camera the eye is on the other side and d < 0, as
 * `obliqueProjection` needs. Writes `out` (4 floats) and returns it; a
 * singular view leaves `out` as it was.
 */
export function cameraSpacePlane(view: Float32Array, level: number, out: Float32Array): Float32Array {
  if (!invert4(view, scratchInverse)) return out;
  for (let j = 0; j < 4; j++) {
    out[j] = scratchInverse[4 * j + 1]! - level * scratchInverse[4 * j + 3]!;
  }
  return out;
}

/** The ripple offset's scale in the mirror's read: the plugin binds it as `waterMirrorK`. */
export const MIRROR_OFFSET_K = 0.05;
/** The water depth (m) at which a ripple moves the read by its whole offset: `lakeMirror.fragment.fx`'s WATER_MIRROR_DEPTH. */
export const MIRROR_DEPTH_FULL = 0.5;
/** The held frames' smear's cap, a share of the frame's height: `lakeMirror.fragment.fx`'s LAKE_MOTION_SMEAR_CAP. */
export const LAKE_MOTION_SMEAR_CAP = 0.05;

/**
 * The TypeScript twin of `waterMirrorUv` (`lakeMirror.fragment.fx`): the
 * mirror target's texel [u, v] for a surface point whose clip position in
 * the mirrored camera is (clipX, clipY, ·, clipW), mapped to 0..1 as Babylon
 * samples a target (v up the screen), then moved by the ripple's slope
 * (slopeX, slopeZ) times `k`, scaled by the water's `depth` over
 * `MIRROR_DEPTH_FULL` (none at the contact line) and over the view depth
 * (never under 1 m), and never up the screen: v stays at or below the
 * unmoved texel's, so no texel from past a bank's reflected top is read.
 */
export function mirrorUv(
  clipX: number, clipY: number, clipW: number, slopeX: number, slopeZ: number, depth: number, viewDepth: number, k: number,
): [number, number] {
  const u0 = (clipX / clipW) * 0.5 + 0.5;
  const v0 = (clipY / clipW) * 0.5 + 0.5;
  const scale = (k * Math.min(depth / MIRROR_DEPTH_FULL, 1)) / Math.max(viewDepth, 1);
  return [u0 + slopeX * scale, Math.min(v0 + slopeZ * scale, v0)];
}
