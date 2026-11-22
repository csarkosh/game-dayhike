/**
 * The tests' ruler: the plain arithmetic of a vector turned by a
 * quaternion, of a dot product, of a point carried by a matrix, of two
 * matrices multiplied, of a matrix's determinant and of a matrix undone,
 * for a test that measures what a module made (a rotation, by where it
 * carries a vector; a corner, told in a plank's own frame; a projection,
 * by the depth it gives a point) rather than comparing numbers with numbers. Each is written in the
 * order of operations Babylon.js's `Vector3` and `Matrix` use, and a test
 * that measures with it first holds it, bit for bit, to what Babylon.js
 * gave for that test's own cases (`babylonFixture.ts`).
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

/** The point `p` carried by the matrix `m` (sixteen floats, as a shader reads them), over its fourth coordinate. */
export function carried(m: ArrayLike<number>, p: Vec): Vec {
  const a = (i: number): number => m[i] as number;
  const rx = p.x * a(0) + p.y * a(4) + p.z * a(8) + a(12);
  const ry = p.x * a(1) + p.y * a(5) + p.z * a(9) + a(13);
  const rz = p.x * a(2) + p.y * a(6) + p.z * a(10) + a(14);
  const rw = 1 / (p.x * a(3) + p.y * a(7) + p.z * a(11) + a(15));
  return { x: rx * rw, y: ry * rw, z: rz * rw };
}

/** The matrix that carries a point by `a` and then by `b`, in single floats: row by column, each sum from its first term. */
export function product(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    const a0 = a[row * 4] as number, a1 = a[row * 4 + 1] as number, a2 = a[row * 4 + 2] as number, a3 = a[row * 4 + 3] as number;
    for (let col = 0; col < 4; col++) {
      out[row * 4 + col] = a0 * (b[col] as number) + a1 * (b[4 + col] as number) + a2 * (b[8 + col] as number) + a3 * (b[12 + col] as number);
    }
  }
  return out;
}

/** The determinant of the matrix in the first sixteen floats of `m`: its first row by that row's cofactors. */
export function determinant(m: ArrayLike<number>): number {
  const a = (i: number): number => m[i] as number;
  const m00 = a(0), m01 = a(1), m02 = a(2), m03 = a(3);
  const m10 = a(4), m11 = a(5), m12 = a(6), m13 = a(7);
  const m20 = a(8), m21 = a(9), m22 = a(10), m23 = a(11);
  const m30 = a(12), m31 = a(13), m32 = a(14), m33 = a(15);
  const d2233 = m22 * m33 - m32 * m23, d2133 = m21 * m33 - m31 * m23, d2132 = m21 * m32 - m31 * m22;
  const d2033 = m20 * m33 - m30 * m23, d2032 = m20 * m32 - m22 * m30, d2031 = m20 * m31 - m30 * m21;
  const c00 = +(m11 * d2233 - m12 * d2133 + m13 * d2132);
  const c01 = -(m10 * d2233 - m12 * d2033 + m13 * d2032);
  const c02 = +(m10 * d2133 - m11 * d2033 + m13 * d2031);
  const c03 = -(m10 * d2132 - m11 * d2032 + m12 * d2031);
  return m00 * c00 + m01 * c01 + m02 * c02 + m03 * c03;
}

/**
 * The inverse of the matrix in the first sixteen floats of `m`, in single
 * floats: the transpose of its cofactors over its determinant, the
 * cofactors of the first row first. Null for a matrix with no inverse.
 */
export function inverse(m: ArrayLike<number>): Float32Array | null {
  const a = (i: number): number => m[i] as number;
  const m00 = a(0), m01 = a(1), m02 = a(2), m03 = a(3);
  const m10 = a(4), m11 = a(5), m12 = a(6), m13 = a(7);
  const m20 = a(8), m21 = a(9), m22 = a(10), m23 = a(11);
  const m30 = a(12), m31 = a(13), m32 = a(14), m33 = a(15);
  // The two-by-two determinants of the last two rows, by the columns they take.
  const d2233 = m22 * m33 - m32 * m23, d2133 = m21 * m33 - m31 * m23, d2132 = m21 * m32 - m31 * m22;
  const d2033 = m20 * m33 - m30 * m23, d2032 = m20 * m32 - m22 * m30, d2031 = m20 * m31 - m30 * m21;
  const c00 = +(m11 * d2233 - m12 * d2133 + m13 * d2132);
  const c01 = -(m10 * d2233 - m12 * d2033 + m13 * d2032);
  const c02 = +(m10 * d2133 - m11 * d2033 + m13 * d2031);
  const c03 = -(m10 * d2132 - m11 * d2032 + m12 * d2031);
  const det = m00 * c00 + m01 * c01 + m02 * c02 + m03 * c03;
  if (det === 0) return null;
  const k = 1 / det;
  // Of the second and last rows, and of the second and third.
  const d1233 = m12 * m33 - m32 * m13, d1133 = m11 * m33 - m31 * m13, d1132 = m11 * m32 - m31 * m12;
  const d1033 = m10 * m33 - m30 * m13, d1032 = m10 * m32 - m30 * m12, d1031 = m10 * m31 - m30 * m11;
  const d1223 = m12 * m23 - m22 * m13, d1123 = m11 * m23 - m21 * m13, d1122 = m11 * m22 - m21 * m12;
  const d1023 = m10 * m23 - m20 * m13, d1022 = m10 * m22 - m20 * m12, d1021 = m10 * m21 - m20 * m11;
  const c10 = -(m01 * d2233 - m02 * d2133 + m03 * d2132);
  const c11 = +(m00 * d2233 - m02 * d2033 + m03 * d2032);
  const c12 = -(m00 * d2133 - m01 * d2033 + m03 * d2031);
  const c13 = +(m00 * d2132 - m01 * d2032 + m02 * d2031);
  const c20 = +(m01 * d1233 - m02 * d1133 + m03 * d1132);
  const c21 = -(m00 * d1233 - m02 * d1033 + m03 * d1032);
  const c22 = +(m00 * d1133 - m01 * d1033 + m03 * d1031);
  const c23 = -(m00 * d1132 - m01 * d1032 + m02 * d1031);
  const c30 = -(m01 * d1223 - m02 * d1123 + m03 * d1122);
  const c31 = +(m00 * d1223 - m02 * d1023 + m03 * d1022);
  const c32 = -(m00 * d1123 - m01 * d1023 + m03 * d1021);
  const c33 = +(m00 * d1122 - m01 * d1022 + m02 * d1021);
  return new Float32Array([
    c00 * k, c10 * k, c20 * k, c30 * k,
    c01 * k, c11 * k, c21 * k, c31 * k,
    c02 * k, c12 * k, c22 * k, c32 * k,
    c03 * k, c13 * k, c23 * k, c33 * k,
  ]);
}
