/**
 * Skin-shading constants. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `skin.ts` is the plugin that
 * binds them. `SKIN_WRAP` and `SKIN_SCATTER` are runtime uniforms in
 * `shaders/skinDiffuse.fragment.fx`, not mirrored GLSL literals; only
 * `SKIN_SCATTER_TINT` is a GLSL const there, and a lockstep test asserts it
 * agrees with this file — tune them together.
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
