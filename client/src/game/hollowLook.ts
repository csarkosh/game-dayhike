import type { Rgb } from "./colour.js";

/**
 * How the Hollow is drawn: a very dark shape the lights can touch, not an
 * unlit black one. Babylon-free so the numbers can be read and tested on
 * their own; `entityViews.ts` builds the material from them. A tuning pass
 * moves the three light-facing knobs and nothing else.
 */

/** Near-black: what little the sun, the sky and a headlamp can catch on it. */
export const HOLLOW_ALBEDO: Rgb = { r: 0.03, g: 0.03, b: 0.035 };
/** A faint floor so the shape keeps an edge against a black sky. */
export const HOLLOW_EMISSIVE: Rgb = { r: 0.006, g: 0.007, b: 0.009 };
/** Fully rough: the lamp shows its form, never a highlight. */
export const HOLLOW_ROUGHNESS = 1;
/** The material's name, by which the atmosphere plugin leaves it alone. */
export const HOLLOW_MATERIAL = "mat_hollow";
