/**
 * The base conform's arithmetic (`lite/forestPlugins.ts` says what the
 * conform is and draws it): its two constants, the displacement the vertex
 * stage computes, and the uniforms it is drawn with as one record by name.
 * Loads no engine.
 */

/** Model-space height over which the conform fades to nothing (m). Sized so the
 * weight is still ~0.99 across a giant's root plate, which ends by model
 * y = 0.25, and gone before the trunk is clear of it. */
export const GROUND_CONFORM_RAMP = 0.8;

/** How far past the local ground plane the downhill edge is pushed. 1.0 leaves
 * a p90 gap of 0.339 m, 1.5 gives 0.316 m, 2.0 gives 0.296 m for more burial —
 * so 1.5. Browser-tunable, like the WIND_AMP constants. */
export const GROUND_CONFORM_OVERSHOOT = 1.5;

/** The arithmetic of the conform's vertex code (`CONFORM_GLSL`), in TypeScript, so the analytic gate and the
 * shader cannot drift apart. `modelY` is the vertex's model-space height;
 * `offX`/`offZ` are its world-space horizontal offset from the instance
 * origin; `dx`/`dz` are the local ground gradient at the instance (the
 * `groundGrad` attribute), i.e. how far the ground rises per metre moved in
 * world X/Z. */
export function conformDisplacement(
  offX: number,
  offZ: number,
  modelY: number,
  dx: number,
  dz: number,
): number {
  const t = Math.min(1, Math.max(0, modelY / GROUND_CONFORM_RAMP));
  const w = 1 - t * t * (3 - 2 * t);
  // `+ 0` scrubs the signed zero IEEE 754 produces at w === 0 (+0 * a negative
  // plane term is -0): GLSL draws -0.0 and 0.0 identically, but JS's `toBe`
  // does not, so leaving it in would fail the ramp-top test over a distinction
  // that has no shader-visible meaning.
  return w * Math.min(0, GROUND_CONFORM_OVERSHOOT * (offX * dx + offZ * dz)) + 0;
}

/** The conform's uniforms by name: the ramp's height and the overshoot. */
export type ConformUniforms = { gcRamp: [number]; gcOvershoot: [number] };

/** The uniforms every conformed material is drawn with: the two constants. */
export function conformUniforms(): ConformUniforms {
  return { gcRamp: [GROUND_CONFORM_RAMP], gcOvershoot: [GROUND_CONFORM_OVERSHOOT] };
}
