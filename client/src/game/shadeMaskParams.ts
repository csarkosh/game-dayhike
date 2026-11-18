/**
 * What the haunt's figures are drawn into their mask with, with no engine
 * (docs/gameplay/2026-10-06-the-mist-shades.md): the mask's size, a
 * figure's colour there, and its smoke's numbers. `lite/shadeMask.ts` draws
 * the mask and takes its values from here.
 */

/** The mask's size as a share of the frame: a blurred figure wants no more. */
export const SHADE_MASK_RATIO = 0.5;

/** Noise cells a metre, the metres a second the smoke rises through the figure, the soft edge of its coming and going, and the share of the figure's height at its feet lost in the mist. Mirrored in shaders/shadeSmokeNoise.fx; the lockstep test asserts them. */
export const SHADE_SMOKE_SCALE = 0.9;
export const SHADE_SMOKE_RISE = 0.6;
export const SHADE_SMOKE_SOFT = 0.12;
export const SHADE_SMOKE_FEET = 0.16;
/** How much of the figure's turned edge the fraying may take, 0 to 1, and the most its outline swells or draws in, metres. */
export const SHADE_SMOKE_FRAY = 0.55;
export const SHADE_SMOKE_SWELL_M = 0.35;
/** The smoke's clock folds at this many seconds, so its noise keeps its precision through a long night. */
export const SHADE_SMOKE_FOLD_S = 3600;

/** The smallest power of two not under `x`, and the largest not over it. */
const ceilingPot = (x: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, x)));
const floorPot = (x: number): number => 2 ** Math.floor(Math.log2(Math.max(1, x)));

/**
 * One side of the mask for a frame `pixels` across on that side: the frame's
 * share at `SHADE_MASK_RATIO`, eased up for a small frame and taken to the
 * nearer power of two, never past the largest power of two the frame holds.
 * The rule Babylon.js sizes a render target by when it is given a ratio.
 */
export function shadeMaskSide(pixels: number, ratio: number = SHADE_MASK_RATIO): number {
  const minimum = 128;
  const x = pixels * ratio;
  const eased = x + (minimum * minimum) / (minimum + x);
  const up = ceilingPot(eased);
  const down = floorPot(eased);
  const nearest = up - eased > eased - down ? down : up;
  return Math.min(floorPot(pixels), nearest);
}

/** The mask's size for a frame `width` by `height`. */
export function shadeMaskSize(width: number, height: number): { width: number; height: number } {
  return { width: shadeMaskSide(width), height: shadeMaskSide(height) };
}

/**
 * A figure's colour in the mask: its red the shade, by its softness (1 a
 * blur in the mist, 0 the Hollow itself) and fainter far off (`near`), its
 * blue the real thing resolved out of it; its green, how far gone it was, is
 * 0 since the smoke took the going.
 */
export function shadeMaskColour(soft: number, near: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = soft * near;
  out[1] = 0;
  out[2] = 1 - soft;
  return out;
}

/** The smoke's uniforms: (how far in the figure is, the clock, its feet's height, its own height), and (the fraying, the swell). */
export type ShadeSmokeUniforms = { shadeSmoke: [number, number, number, number]; shadeSmokeEdge: [number, number] };

export function shadeSmokeUniforms(
  presence: number, time: number, feetY: number, height: number, out: ShadeSmokeUniforms = { shadeSmoke: [0, 0, 0, 0], shadeSmokeEdge: [0, 0] },
): ShadeSmokeUniforms {
  out.shadeSmoke[0] = presence;
  out.shadeSmoke[1] = time;
  out.shadeSmoke[2] = feetY;
  out.shadeSmoke[3] = height;
  out.shadeSmokeEdge[0] = SHADE_SMOKE_FRAY;
  out.shadeSmokeEdge[1] = SHADE_SMOKE_SWELL_M;
  return out;
}

/** The smoke's clock for `ms` since it began: seconds, folded. */
export function shadeSmokeSeconds(ms: number): number {
  return (ms / 1000) % SHADE_SMOKE_FOLD_S;
}
