/**
 * The yaw that faces a direction, without trigonometry: a piecewise-linear
 * atan2 over eight octants. It is exact on the eight compass points and
 * within 0.072 rad between them, and bit-identical on every peer because it
 * uses no function a browser is free to implement its own way. Yaw 0 faces
 * +z and PI/2 faces +x, as a player's does. No direction at all faces +z.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export function facingYaw(dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx, az = dz < 0 ? -dz : dz;
  const t = ax + az === 0 ? 0 : ax / (ax + az); // 0 on +z, 1 on +x
  const quarter = Math.PI / 2;
  let yaw = t * quarter; // first octant pair: +x, +z
  if (dz < 0) yaw = Math.PI - yaw;
  if (dx < 0) yaw = -yaw;
  return yaw;
}

/**
 * The unit direction a yaw faces, without the host's trigonometry: the sine
 * and cosine as polynomials, so that every peer gets the same bits. The yaw
 * is folded into a quarter turn either side of +z or of -z, where nine terms
 * of each series are good to 1e-13.
 */
export function facingDir(yaw: number): { x: number; z: number } {
  const half = Math.PI / 2;
  let a = yaw, flip = 1;
  if (a > half) { a = Math.PI - a; flip = -1; }
  else if (a < -half) { a = -Math.PI - a; flip = -1; }
  const q = a * a;
  let sin = 0, cos = 0;
  // Horner, from the highest term down: x^17/17! ... x, and x^16/16! ... 1.
  for (let k = 8; k >= 0; k--) {
    sin = 1 - (sin * q) / ((2 * k + 2) * (2 * k + 3));
    cos = 1 - (cos * q) / ((2 * k + 1) * (2 * k + 2));
  }
  return { x: a * sin, z: flip * cos };
}
