
/**
 * Where the listener is and which way it faces, in BABYLON's left-handed world
 * — the frame `renderer.listener()` reads the camera in. `wildlifeAudio.ts`
 * mirrors it into Web Audio's right-handed one; nothing else may.
 */
export type ListenerPose = {
  x: number; y: number; z: number;
  fx: number; fy: number; fz: number;
  ux: number; uy: number; uz: number;
};

/** The listener in Web Audio's right-handed frame, as the sound's bus placed it: where it is, and its forward and up. */
export type EarFrame = { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number };

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
