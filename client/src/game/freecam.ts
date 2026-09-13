export type FreecamState = { x: number; y: number; z: number };

/**
 * Note the absence of `pitch`. Horizontal movement is deliberately independent
 * of where the camera is looking: a camera that flies into the ground when you
 * look down and press forward cannot be used to inspect terrain.
 */
export type FreecamInput = { yaw: number; keys: ReadonlySet<string>; dt: number };

/** Metres per second. Brisk enough to cross a chunk in under three seconds. */
export const FREECAM_SPEED = 12;
/**
 * At 12 m/s base, Shift gives 144 m/s. `PEAK_HEIGHT` is 650, but that is the
 * relief amplitude at full uplift rather than the range reached — measured
 * relief for the default variant is about 188 m. What sets the
 * speed is the horizontal extent, not the vertical: ranges are at kilometre
 * scale and the renderer draws to about 8 km, so at the old boost of 4
 * (48 m/s) crossing the visible landscape took minutes.
 */
export const FREECAM_BOOST = 12;

/**
 * Integrates one frame of free-camera movement.
 *
 * Pure, and stepped by real elapsed seconds rather than by simulation ticks —
 * the camera is a view concern and is not bound to the 60 Hz step.
 */
export function stepFreecam(state: FreecamState, input: FreecamInput): FreecamState {
  const { yaw, keys, dt } = input;

  let forward = 0;
  let right = 0;
  let up = 0;
  if (keys.has("KeyW")) forward += 1;
  if (keys.has("KeyS")) forward -= 1;
  if (keys.has("KeyD")) right += 1;
  if (keys.has("KeyA")) right -= 1;
  if (keys.has("KeyJ")) up += 1;
  if (keys.has("KeyK")) up -= 1;

  // So a diagonal is not faster than a straight line.
  const planar = Math.sqrt(forward * forward + right * right);
  if (planar > 1) {
    forward /= planar;
    right /= planar;
  }

  const speed = FREECAM_SPEED * (keys.has("ShiftLeft") ? FREECAM_BOOST : 1) * dt;

  // Yaw 0 faces +Z, matching `sim/movement.ts` and Babylon's camera.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: state.x + (forward * sin + right * cos) * speed,
    y: state.y + up * speed,
    z: state.z + (forward * cos - right * sin) * speed,
  };
}
