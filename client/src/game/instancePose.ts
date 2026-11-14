/**
 * An instance's pose as plain numbers: the turn of a model as a quaternion,
 * and its scale, turn and place composed into the sixteen floats of a
 * thin-instance matrix. Loads no engine, so the lists a scenery shell draws
 * (`forestInstances.ts`) are made, and tested, with none.
 *
 * The arithmetic is Babylon.js's own, term for term and in its order
 * (`Quaternion.RotationAxisToRef`, `RotationYawPitchRollToRef`,
 * `FromUnitVectorsToRef`, `multiplyToRef`, `Matrix.ComposeToRef`,
 * `Vector3.TransformCoordinatesFromFloatsToRef`), so a matrix made here is,
 * bit for bit, the one those calls made: left-handed, column-major as a
 * shader reads it, translation in floats 12 to 14.
 */

/** A rotation as a quaternion. A Babylon.js `Quaternion` is one. */
export type Quat = { x: number; y: number; z: number; w: number };

/** A point or a direction. */
export type Vec3 = { x: number; y: number; z: number };

/** Below this, one plus the dot of two unit vectors counts as them opposed. */
const OPPOSED = 0.001;

/** The turn by `angle` radians about `axis`, into `out`. */
export function quatAboutAxis(axis: Vec3, angle: number, out: Quat): Quat {
  out.w = Math.cos(angle / 2);
  const sinByLength = Math.sin(angle / 2) / Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
  out.x = axis.x * sinByLength;
  out.y = axis.y * sinByLength;
  out.z = axis.z * sinByLength;
  return out;
}

/** The turn from Euler angles: about z by `z`, then x by `x`, then y by `y` (yaw, pitch, roll as y, x, z), into `out`. */
export function quatFromEuler(x: number, y: number, z: number, out: Quat): Quat {
  const halfRoll = z * 0.5;
  const halfPitch = x * 0.5;
  const halfYaw = y * 0.5;
  const sinRoll = Math.sin(halfRoll);
  const cosRoll = Math.cos(halfRoll);
  const sinPitch = Math.sin(halfPitch);
  const cosPitch = Math.cos(halfPitch);
  const sinYaw = Math.sin(halfYaw);
  const cosYaw = Math.cos(halfYaw);
  out.x = cosYaw * sinPitch * cosRoll + sinYaw * cosPitch * sinRoll;
  out.y = sinYaw * cosPitch * cosRoll - cosYaw * sinPitch * sinRoll;
  out.z = cosYaw * cosPitch * sinRoll - sinYaw * sinPitch * cosRoll;
  out.w = cosYaw * cosPitch * cosRoll + sinYaw * sinPitch * sinRoll;
  return out;
}

/** The shortest turn carrying the unit vector `from` onto the unit vector `to`, into `out`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3, out: Quat): Quat {
  const r = from.x * to.x + from.y * to.y + from.z * to.z + 1;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (r < OPPOSED) {
    w = 0;
    if (Math.abs(from.x) > Math.abs(from.z)) {
      x = -from.y;
      y = from.x;
      z = 0;
    } else {
      x = 0;
      y = -from.z;
      z = from.y;
    }
  } else {
    x = from.y * to.z - from.z * to.y;
    y = from.z * to.x - from.x * to.z;
    z = from.x * to.y - from.y * to.x;
    w = r;
  }
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  if (length !== 0 && length !== 1.0) {
    const scale = 1.0 / length;
    x *= scale;
    y *= scale;
    z *= scale;
    w *= scale;
  }
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/** The Hamilton product a·b, which applies `b` first, into `out`. Every
 * component is computed before any is written, so `out` may be an operand. */
export function quatMultiply(a: Quat, b: Quat, out: Quat): Quat {
  const x = a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x;
  const y = -a.x * b.z + a.y * b.w + a.z * b.x + a.w * b.y;
  const z = a.x * b.y - a.y * b.x + a.z * b.w + a.w * b.z;
  const w = -a.x * b.x - a.y * b.y - a.z * b.z + a.w * b.w;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/**
 * The matrix that scales by (sx, sy, sz), turns by `q` and then moves to
 * (px, py, pz), written into the sixteen floats of `out` from `offset`.
 */
export function composeInto(
  out: Float32Array, offset: number,
  sx: number, sy: number, sz: number,
  q: Quat,
  px: number, py: number, pz: number,
): void {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = px;
  out[offset + 13] = py;
  out[offset + 14] = pz;
  out[offset + 15] = 1;
}

/** The point (x, y, z) carried by the matrix at `offset` of `m`, into `out`. */
export function transformPoint(m: ArrayLike<number>, offset: number, x: number, y: number, z: number, out: Vec3): Vec3 {
  const at = (i: number): number => m[offset + i] as number;
  const rx = x * at(0) + y * at(4) + z * at(8) + at(12);
  const ry = x * at(1) + y * at(5) + z * at(9) + at(13);
  const rz = x * at(2) + y * at(6) + z * at(10) + at(14);
  const rw = 1 / (x * at(3) + y * at(7) + z * at(11) + at(15));
  out.x = rx * rw;
  out.y = ry * rw;
  out.z = rz * rw;
  return out;
}
