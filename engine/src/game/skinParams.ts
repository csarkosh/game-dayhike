/**
 * Skin-shading constants. Engine-free and on the architecture test's
 * BABYLON_FREE_FILES list. The hike's renderer does not draw the skin's
 * shading (`lite/notDrawn.ts`): these are the look in numbers, for the
 * plugin that will, with `SKIN_WRAP` and `SKIN_SCATTER` as its uniforms and
 * `SKIN_SCATTER_TINT` as a constant of its shader.
 */

/** Wrap width: how far past the terminator diffuse keeps receiving light. */
export const SKIN_WRAP = 0.35;
/** Scatter amount: the red-shifted glow confined to the terminator band. */
export const SKIN_SCATTER = 0.25;
/** Scatter colour — blood under skin, so red-dominant. */
export const SKIN_SCATTER_TINT = [1.0, 0.3, 0.2] as const;

/**
 * Energy-conserving wrap Lambert: saturate((n·l + w) / (1 + w)²). At w = 0 it
 * is Lambert; at full light it never exceeds Lambert; the terminator lifts.
 */
export function skinWrapLambert(ndotl: number, wrap: number): number {
  const value = (ndotl + wrap) / ((1 + wrap) * (1 + wrap));
  return Math.min(1, Math.max(0, value));
}
