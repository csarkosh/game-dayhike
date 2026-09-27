import type { Rgb } from "./colour.js";

/**
 * How the Hollow is drawn. Babylon-free so the numbers can be read and tested
 * on their own; `entityViews.ts` builds from them.
 *
 * The model keeps its own maps and takes the atmosphere like any other lit
 * surface; only its eyes are recoloured here. The capsule knobs below apply
 * to the fallback alone, drawn while the model has not loaded or when it
 * never will: a very dark shape the lights can touch, not an unlit black one.
 */

/** Drawn at this many times the model's 1.80 m, so it stands twice a hiker's height. Its hull is unchanged. */
export const HOLLOW_SCALE = 2;
/** The eyes: a saturated red, the one colour nothing else in the forest wears. */
export const HOLLOW_EYE_COLOR: Rgb = { r: 1, g: 0.04, b: 0.02 };
/**
 * The eyes' emissive intensity. At night the exposure is 1.6, so red at 4
 * reaches an exposed luminance of 0.2126 × 4 × 1.6 ≈ 1.36, over the
 * halation threshold of 1: the eyes bleed a glow into the dark around them,
 * a tell that reads from far off. By day (exposure 0.9) the same eyes sit at
 * 0.77, under the threshold, and read as solid red rather than as lamps.
 */
export const HOLLOW_EYE_INTENSITY = 4;
/** Metres per second the walk clip covers at speed 1 and scale 1; its playback rate is scaled from this. */
export const HOLLOW_WALK_CLIP_SPEED = 1.5;
/** Metres per second a ranger's walk clip covers at speed 1. */
export const RANGER_WALK_CLIP_SPEED = 1.5;

/** Near-black: what little the sun, the sky and a headlamp can catch on the fallback capsule. */
export const HOLLOW_ALBEDO: Rgb = { r: 0.03, g: 0.03, b: 0.035 };
/** A faint floor so the capsule keeps an edge against a black sky. */
export const HOLLOW_EMISSIVE: Rgb = { r: 0.006, g: 0.007, b: 0.009 };
/** Fully rough: the lamp shows the capsule's form, never a highlight. */
export const HOLLOW_ROUGHNESS = 1;
/** The capsule material's name, by which the atmosphere plugin leaves it alone. */
export const HOLLOW_MATERIAL = "mat_hollow";
