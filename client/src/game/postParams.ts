import type { QualityTier } from "./quality.js";

/**
 * The pure arithmetic of the post chain: which passes a tier gets, and the
 * finish pass's record. Babylon-free and on the architecture test's
 * BABYLON_FREE_FILES list; `post.ts` is the shell.
 */

export type PostFeatures = {
  pipeline: boolean;
  halation: boolean;
  lens: boolean;
  colourPath: "post" | "material";
  /** The paint pass's stroke radius (px at PAINT_ROWS rows), 0 for no pass (2026-10-17). */
  paint: number;
  /** The temporal anti-aliasing (2026-10-28), in place of FXAA where the chain has the depth to reproject with. */
  taa: boolean;
};

/**
 * The tier ladder as data. Without float render targets (NullEngine, weak
 * WebGL) nothing HDR can run, so every tier falls to the material path: an
 * 8-bit chain would band the very frames this restyle exists for. The lens
 * (rain on the glass) rides the pipeline: every tier with the chain has it.
 */
export function postFeaturesFor(tier: QualityTier, fxSupported: boolean): PostFeatures {
  if (!fxSupported || tier === "low") return { pipeline: false, halation: false, lens: false, colourPath: "material", paint: 0, taa: false };
  return {
    pipeline: true,
    halation: tier === "high",
    lens: true,
    colourPath: "post",
    paint: tier === "high" ? PAINT_RADIUS_HIGH : PAINT_RADIUS_MEDIUM,
    taa: true,
  };
}

// ---- The temporal anti-aliasing (2026-10-28): the frame blended into the frames before it. ----
/** The new frame's share of the blend. Measured on the Air at the explore
 * trailhead with the camera still (medium, 975 by 776, DPR 2): at 0.1 the
 * share of the frame's pixels blinking fell to a third to a half of the
 * chain without it (leaf flutter against the low sun 3.5 % from 8.4 %, the
 * sunrise's sweeping dapple 8 % from 30 %), at 0.9 ms a frame. */
export const TAA_BLEND = 0.1;
/** How far the history may stray from the current frame's 3 by 3
 * neighbourhood, in that neighbourhood's standard deviations, before it is
 * clipped to it: what keeps a leaf that has moved, or an animal, from
 * trailing. */
export const TAA_CLIP = 1.25;
/** The sharpen after the blend, an unsharp mask held inside the
 * neighbours' range; 0 for none. */
export const TAA_SHARPEN = 0.5;
/** The jitter walks this many steps of the Halton sequence, then starts over. */
export const TAA_SAMPLES = 8;
/** The Halton sequence's value at `i` in base `b`, in [0, 1): 0 at 0. */
export function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / b)) {
    f /= b;
    r += f * (n % b);
  }
  return r;
}
/** The projection's offset on frame `frame`, in clip units: the Halton walk
 * in bases 2 and 3, centred, so every step is within half a pixel of the
 * frame's `width` by `height` and the eight average to the pixel's centre. */
export function taaJitter(frame: number, width: number, height: number): { x: number; y: number } {
  const i = (frame % TAA_SAMPLES) + 1;
  return { x: ((halton(i, 2) - 0.5) * 2) / width, y: ((halton(i, 3) - 0.5) * 2) / height };
}

// ---- The paint pass (2026-10-17): the frame smeared into strokes before the grade. ----
/** The stroke radius (px) at PAINT_ROWS rows, by tier: a wider stroke on
 * high, where the pass's taps (the square of twice the radius plus one) are
 * affordable, a narrower one on medium. */
export const PAINT_RADIUS_HIGH = 3;
export const PAINT_RADIUS_MEDIUM = 2;
/** The frame height the radii are set at; a taller frame scales the stroke
 * with it, so a stroke is the same share of the picture at any size. */
export const PAINT_ROWS = 675;
/** The shader's window never reaches past this many pixels (its loop bound). */
export const PAINT_REACH = 6;
/** How far the painted frame replaces the rendered one: 1 wholly. */
export const PAINT_STRENGTH = 0.8;
/** The stroke radius for a frame of `rows` rows: the tier's radius scaled by
 * the rows, never under 2 (a 1 px stroke is no stroke) nor past the reach. */
export function paintRadiusFor(base: number, rows: number): number {
  if (base <= 0) return 0;
  return Math.min(PAINT_REACH, Math.max(2, Math.round((base * rows) / PAINT_ROWS)));
}

/** The share of the frame's pixels, on each axis, the strokes are painted
 * at (2026-10-18): the paint pass's cost is its window's reads times its
 * pixels, and at half the pixels on each axis it reads a quarter as many,
 * each read a 2 by 2 average of the frame. A laptop's 1512 by 982 window on
 * the medium tier drew at 32 to 37 frames a second with the strokes at full
 * resolution and 51 at half, on an Apple M4. The compose
 * (`paintCompose.fragment.fx`) brings them back to full. */
export const PAINT_SCALE = 0.5;
/** How sharply the compose prefers, of the four painted texels round a
 * pixel, those whose scene is like the pixel's own (a joint bilateral
 * upsample, the frame's own colour the guide): a plain bilinear upscale
 * smeared every edge a painted texel wide, the blades and the kiosk soft. */
export const PAINT_JOINT_SHARPNESS = 60;
/** The stroke's radius in the half-size frame's pixels: the frame's own
 * radius (`paintRadiusFor`), the same share of the picture, at the scale. */
export function paintTexelRadius(base: number, rows: number): number {
  return paintRadiusFor(base, rows) * PAINT_SCALE;
}
/** The half-size frame's size as Babylon makes a pass's target: the frame's
 * size times the ratio, truncated. */
export function paintTargetSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(width * PAINT_SCALE)), height: Math.max(1, Math.floor(height * PAINT_SCALE)) };
}

/** MSAA sample count on the first pass of the chain (the scene pass on high,
 * the grade on medium): that pass's input target is the scene render, so
 * multisampling it multisamples every opaque edge, which is what the blade
 * clumps need. The engine clamps it to its cap; the low tier has no chain
 * and gets none. */
export const MSAA_SAMPLES = 4;

// ---- Browser-tunable magnitudes. `clear` identity is not. ----
/** One 8-bit step. The finish pass applies TPDF dither at ±1 LSB
 * (`(d1 + d2 − 1) · LSB`, the sum of two uniform draws), the correct
 * triangular form — not ±½ LSB, which is RPDF (a single uniform draw). Don't
 * "fix" it to ±½. */
export const DITHER_LSB = 1 / 255;
/** Linear, EXPOSED scene luminance above which halation is extracted: brighter
 * than display white before the tone map rolls it off. */
export const HALATION_THRESHOLD = 1.0;
/** Luminance excess at which the extract saturates; keeps the response bounded. */
export const HALATION_CAP = 4.0;

