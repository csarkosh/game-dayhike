/**
 * A cut, as the scene route's `frame()` sees it: the camera moved further between two drawn frames
 * than any shot moves it in one. After one the world streams in around the new camera over frames;
 * the route draws it in before the frame that counts.
 */
export const JUMP_M = 50;
/** Frames drawn at a cut's new camera before the frame that counts. */
export const WARM_FRAMES = 48;
/** The longest the route waits for the world after a cut. */
export const SETTLE_MAX_MS = 10_000;

export function cameraJumped(
  before: { x: number; y: number; z: number } | null,
  after: { x: number; y: number; z: number },
  metres = JUMP_M,
): boolean {
  return before !== null && Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > metres;
}
