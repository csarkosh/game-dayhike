/**
 * The seeps: where the ground is wet away from open water. A seep is a
 * winding ribbon, the band of a low-frequency noise near its middle value, so
 * it runs as a line across the hillside and not as a patch. The wet-ground
 * plants stand in it (`clutter.ts`) and the alders stand along it
 * (`vegetation.ts`): one field, so the two agree where the water is.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */
import { fbm2 } from "./field.js";

/** The noise's wavelength (m) and octaves. Declared in the level id by the
 * clutter's tunables (`CLUTTER_WETPLANT_SEEP_*`), which take these by
 * reference. */
export const SEEP_WAVELENGTH = 140;
export const SEEP_OCTAVES = 2;
export const SEEP_SALT = 0x5ee9;

/** How far the seep noise at a point is from its middle value: 0 on a seep's
 * centreline, growing to either side. A ribbon is where this is small. */
export function seepOffset(seed: number, x: number, z: number): number {
  const n = fbm2(x / SEEP_WAVELENGTH, z / SEEP_WAVELENGTH, seed ^ SEEP_SALT, SEEP_OCTAVES);
  return n > 0.5 ? n - 0.5 : 0.5 - n;
}
