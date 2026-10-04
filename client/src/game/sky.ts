import { clamp01, type Rgb } from "./colour.js";

/**
 * Sun and sky maths: pure, Babylon-free, and therefore testable under
 * `environment: "node"`. `lighting.ts` is the Babylon shell that applies it.
 *
 * Trigonometry is fine here. The ban on `Math.sin` is a `sim/` rule, because an
 * ULP difference between JS engines there would build a different world on each
 * peer with no way to correct it. Nothing in this file crosses the wire.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Peak DirectionalLight intensity. Image-based lighting supplies the ambient. */
export const SUN_PEAK = 4;

/** Fraction of a surface's own colour still visible at the fog reference distance. */
export const FOG_FLOOR = 0.05;

/**
 * How far the sun's arc leans away from vertical.
 *
 * Not decoration. A sun passing exactly through the zenith casts no lateral
 * shadow at noon, and terrain relief is read almost entirely through shadowing —
 * so an untilted arc would produce a midday that flattens the landscape
 * completely, which is the failure this whole step exists to fix.
 */
const ARC_TILT = 0.25;

/**
 * The night sky's own colour. The scattering table is effectively black from
 * about 12 degrees below the horizon, so the dome adds this as its floor,
 * standing in for the moonlit night sky: weighted by the night factor, it
 * appears as the twilight fades, and midnight keeps the colour it has always
 * had (`skyState.ts`).
 */
export const NIGHT_SKY: Readonly<Rgb> = Object.freeze({ r: 0.02, g: 0.03, b: 0.06 });

/** Sun altitude at which the sky has finished turning from dawn to full day. */
const DAY_ALTITUDE = 0.35;
/** Depth below the horizon at which the sky has finished turning to night. */
const NIGHT_ALTITUDE = 0.25;

const EXPOSURE_NIGHT = 1.6;
const EXPOSURE_DAY = 0.9;

/**
 * Hemispheric fill intensity by day. The sun and image-based lighting from the
 * probe dominate, so the fill only needs to soften shadow cores.
 */
export const FILL_DAY = 0.15;

/**
 * Hemispheric fill intensity at night. Once the sun has set, the fill is the
 * *only* remaining light — measured: at hour 21 the old fixed 0.15 fill tinted by the
 * near-black night sky colour totalled roughly 0.005 of ambient light versus
 * ~4.0 at noon, which is why night rendered pure black no matter what
 * `exposureFor` did. This needs to be high enough on its own to keep the frame
 * legible.
 */
export const FILL_NIGHT = 1.2;

/**
 * A desaturated cool blue: moonlight, not the night sky's own near-black
 * colour. The fill's colour once the night factor has taken over from the
 * sky's light (`skyState.ts`).
 */
export const MOONLIGHT: Readonly<Rgb> = Object.freeze({ r: 0.2, g: 0.26, b: 0.4 });

/**
 * Where in the sun's altitude the day/night blend sits: 0 at the bottom of the
 * night transition band, 1 at the top of the day one. The airborne motes pick
 * their species by it (`motesParams.ts`).
 */
export function twilightT(altitude: number): number {
  return clamp01((altitude + NIGHT_ALTITUDE) / (NIGHT_ALTITUDE + DAY_ALTITUDE));
}

/**
 * Unit vector pointing from the world *toward* the sun.
 *
 * Note the direction: a Babylon `DirectionalLight` wants the direction light
 * travels, which is the negation of this. `lighting.ts` negates once, at the one
 * place it matters. Expressing it this way round means `y` reads as altitude —
 * positive above the horizon — which is what makes the tests legible.
 *
 * Hour 6 puts the sun on the +x horizon, hour 12 near the zenith, hour 18 on the
 * -x horizon, hour 0 underfoot, and hour 24 exactly where hour 0 is.
 */
export function sunPositionAt(hour: number): Vec3 {
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const z = -ARC_TILT;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Stands in for an eye adapting: a bright sky needs less exposure than a dark
 * one. Strictly decreasing in altitude, which is the property the test pins —
 * a non-monotonic exposure curve makes the image pump as `/time` sweeps.
 */
export function exposureFor(altitude: number): number {
  const a = altitude < -1 ? -1 : altitude > 1 ? 1 : altitude;
  return EXPOSURE_NIGHT + (EXPOSURE_DAY - EXPOSURE_NIGHT) * ((a + 1) / 2);
}

/**
 * Density for Babylon's `FOGMODE_EXP2`, whose transmittance is
 * `exp(-(density * d)^2)`. Solved so that exactly `FOG_FLOOR` of a surface's own
 * colour survives at `viewDistance` — which is what makes the draw-distance edge
 * invisible rather than merely far away.
 */
export function fogDensityFor(viewDistance: number): number {
  return Math.sqrt(-Math.log(FOG_FLOOR)) / viewDistance;
}
