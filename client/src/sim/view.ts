import type { Vec3 } from "./types.js";

/**
 * The eye ray. yaw 0 faces +Z; negative pitch looks up, matching the camera.
 * Moved from the deleted `combat.ts` (2026-09-10): the rifle traced a
 * shot along it; Interact (`interact.ts`) and the headlamp aim along it now.
 */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}
