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
