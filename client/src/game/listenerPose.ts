import type { ListenerPose } from "./ambientAudio.js";

/**
 * Fills `out` with a camera pose for the audio listener, in the game's left-handed world.
 *
 * yaw 0 faces +Z and positive pitch looks DOWN — the same convention
 * `UniversalCamera.rotation` carries and `viewBob.ts`'s right vector already
 * assumes — so forward is (sin yaw·cos pitch, −sin pitch, cos yaw·cos pitch) and
 * up is world up. Roll (the walking cue's) is deliberately dropped: it tilts the
 * image, not the ears.
 *
 * A function of its own so the trigonometry, the part a sign error hides in,
 * is unit-testable with no canvas, and so every renderer fills the pose the
 * same way. This module loads no Babylon.
 */
export function writeListenerPose(
  out: ListenerPose,
  x: number, y: number, z: number,
  yaw: number, pitch: number,
): void {
  const cp = Math.cos(pitch);
  out.x = x;
  out.y = y;
  out.z = z;
  out.fx = Math.sin(yaw) * cp;
  out.fy = -Math.sin(pitch);
  out.fz = Math.cos(yaw) * cp;
  out.ux = 0;
  out.uy = 1;
  out.uz = 0;
}
