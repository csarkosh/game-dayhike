import { fbm2, valueNoise2 } from "../sim/field.js";
import { clamp01, mixRgb, type Rgb } from "./colour.js";
import { SLOPE_HI, SLOPE_LO } from "../sim/vegetation.js";

/**
 * Ground albedo from slope and altitude, alongside the per-material blend
 * weights the ground-texture layer needs. Pure and
 * Babylon-free; `clipmap.ts` bakes the colour into vertex colours, a PBR
 * material multiplies it into its own albedo, and the weights drive the
 * tiled ground-texture blend. `classifySurface` walks the palette once for
 * both; `surfaceAlbedo` and `surfaceWeights` are thin wrappers over it.
 *
 * The montane theme carries its own palette with no texture assets at all:
 * forest floor and grass on gentle low ground, exposed rock on steep faces,
 * scree near the angle of repose, snow above a snow line that is itself
 * perturbed so it does not read as a contour drawn across the mountain.
 *
 * IMPORTANT, and easy to "fix" wrongly. The snow band was written before the
 * montane field could reach it and sat dormant until the dense terrain
 * config raised peaks past the snow line. The
 * palette itself is written and tested across its whole input domain, which is
 * the right shape for it — it is a pure function of slope and altitude and
 * should not encode what the generator happens to emit this week.
 *
 * So: do not lower SNOW_LINE to make snow appear. The field is what is short,
 * not the snow line, and lowering it would put snow on hillocks that should not
 * have any and would have to be undone the moment the field is raised. Raise
 * the field instead.
 *
 * `slope` is the magnitude of the elevation gradient, hypot(dh/dx, dh/dz) — a
 * dimensionless rise over run, not an angle. 1.0 is 45 degrees.
 */

/** Nominal altitude of the snow line, in metres. */
export const SNOW_LINE = 220;
/** How far noise moves the snow line either side of nominal, in metres. */
export const SNOW_LINE_VARIATION = 45;
/** Metres above the local snow line over which snow fades in. */
const SNOW_BLEND = 25;

/**
 * Gradient at which vegetation starts giving way to rock, and the gradient by
 * which rock has fully replaced it. These are the FOREST's own slope gate
 * (sim/vegetation.ts SLOPE_LO/SLOPE_HI), taken by reference so the two can
 * never disagree again: ground a forest can hold is soil, and the rock class
 * completes exactly where the trees give up. Until 2026-09-10 the ground
 * turned rock from 0.25 and was all cobbles by 0.6 while trees stood at full
 * density to 0.55 — measured on a sampled seed, 17% of the trees and 18% of
 * the stumps stood on a cobblestone floor, which read as rock that the forest
 * grew straight out of, and flat, because the slope was gentle enough to walk.
 */
export const GRASS_SLOPE = SLOPE_LO;
const ROCK_SLOPE = SLOPE_HI;
/** Gradient by which loose scree has replaced solid rock. */
export const SCREE_SLOPE = 0.95;
/** Gradient by which snow no longer clings at all. */
const SNOW_MAX_SLOPE = 0.9;
/**
 * Width of the slope band, below `SNOW_MAX_SLOPE`, over which snow fades out as
 * it stops clinging to steepening ground. `SNOW_MAX_SLOPE - SNOW_CLING_BAND`
 * happens to land exactly on `ROCK_SLOPE` (0.6) — that is a coincidence, not a
 * design coupling: the two constants are picked independently, and nothing
 * breaks if they diverge.
 */
const SNOW_CLING_BAND = 0.3;

/** Wavelength of the snow line's perturbation, in metres. */
const SNOW_LINE_WAVELENGTH = 190;
/** Wavelength of the forest-floor to grass variation, in metres. */
const GROUND_WAVELENGTH = 34;

// Distinct constants so the two noise fields cannot correlate, which would show
// as vegetation patches lining up with the snow line.
const SNOW_SALT = 0x5e7a;
const GROUND_SALT = 0x9a13;

const FOREST_FLOOR: Rgb = { r: 0.11, g: 0.09, b: 0.06 };
const GRASS: Rgb = { r: 0.09, g: 0.15, b: 0.06 };
/** What the ground reads as where conifers stand over it: dark, green-led
 * crown colour rather than litter or grass. */
const CANOPY: Rgb = { r: 0.045, g: 0.085, b: 0.05 };
/** Blend cap at full density — full forest keeps a floor-litter remnant. */
const CANOPY_MAX = 0.85;
const ROCK: Rgb = { r: 0.17, g: 0.16, b: 0.15 };
const SCREE: Rgb = { r: 0.24, g: 0.23, b: 0.21 };
const SNOW: Rgb = { r: 0.78, g: 0.8, b: 0.84 };

/** Where dead leaves and twigs take over from grass, the floor colour leans
 * toward this needle bed the denser the canopy overhead — see the `duff`
 * blend in `classifySurface`. A mid tan-brown floor, not a dark one: the
 * paint carries the leaf carpet itself, and the litter pieces (duffClump.ts)
 * only add relief on top of it. */
export const NEEDLE_BED: Rgb = { r: 0.15, g: 0.105, b: 0.06 };
/** Blend cap for the duff overlay: even at duff = 1 a grass remnant survives,
 * the same way `CANOPY_MAX` leaves a floor-litter remnant under full canopy. */
export const DUFF_FLOOR_MAX = 0.75;

/** Altitude at which sand starts yielding to the forest floor.
 * Safe to key on altitude alone: nothing inland of the blend window sits below
 * +12 m, so these bands can only paint the shore. */
export const SAND_TOP = 4;
const COAST_FADE_END = 9;

const SEABED: Rgb = { r: 0.1, g: 0.09, b: 0.075 };
const SEABED_ROCK: Rgb = { r: 0.14, g: 0.14, b: 0.13 };
const WET_SAND: Rgb = { r: 0.3, g: 0.26, b: 0.2 };
const DRY_SAND: Rgb = { r: 0.55, g: 0.5, b: 0.4 };
const PEBBLE: Rgb = { r: 0.44, g: 0.41, b: 0.36 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Local altitude of the snow line. Perturbed by low-frequency noise, because a
 * snow line at one exact altitude is the single most obvious tell that a
 * mountain was generated: real ones wander with aspect, wind and shade.
 */
export function snowLineAt(seed: number, x: number, z: number): number {
  const n = fbm2(x / SNOW_LINE_WAVELENGTH, z / SNOW_LINE_WAVELENGTH, seed ^ SNOW_SALT, 3);
  return SNOW_LINE + (n - 0.5) * 2 * SNOW_LINE_VARIATION;
}

/** Per-material blend weights for the ground-texture layer.
 * The five material weights always sum to 1; `detail` is separate —
 * it is how strongly the tiled texture shows at all; drops to 0 under settled
 * snow, which is a surface rather than a ground material; the road is painted
 * per fragment by `roadPaint.ts` and no longer passes through here. */
export type TerrainWeights = {
  grass: number;
  forestFloor: number;
  rock: number;
  sand: number;
  pebble: number;
  detail: number;
};

type W = { grass: number; forestFloor: number; rock: number; sand: number; pebble: number };

const W_GRASS: W = { grass: 1, forestFloor: 0, rock: 0, sand: 0, pebble: 0 };
const W_FLOOR: W = { grass: 0, forestFloor: 1, rock: 0, sand: 0, pebble: 0 };
const W_ROCK: W = { grass: 0, forestFloor: 0, rock: 1, sand: 0, pebble: 0 };
const W_SAND: W = { grass: 0, forestFloor: 0, rock: 0, sand: 1, pebble: 0 };
const W_PEBBLE: W = { grass: 0, forestFloor: 0, rock: 0, sand: 0, pebble: 1 };

function mixW(a: W, b: W, t: number): W {
  const k = clamp01(t);
  return {
    grass: a.grass + (b.grass - a.grass) * k,
    forestFloor: a.forestFloor + (b.forestFloor - a.forestFloor) * k,
    rock: a.rock + (b.rock - a.rock) * k,
    sand: a.sand + (b.sand - a.sand) * k,
    pebble: a.pebble + (b.pebble - a.pebble) * k,
  };
}

/**
 * `canopy` is the forest density ρ ∈ [0, 1] at (x, z) — `clipmap.ts` passes
 * `forestDensity` so forested ground bakes darker and greener. `duff` is the
 * ground-cover field's own litter fraction (`sim/clutter.ts` `groundCover`) —
 * `clipmap.ts` passes it so the paint agrees with where the duff pieces
 * actually stand. Both default to 0, and `mixRgb`/`mixW` return their
 * untouched endpoint at t = 0, so every pre-canopy, pre-duff call site gets
 * bitwise-identical results.
 */
export function classifySurface(
  seed: number,
  x: number,
  z: number,
  altitude: number,
  slope: number,
  canopy = 0,
  duff = 0,
): { albedo: Rgb; weights: TerrainWeights } {
  // Gentle ground is a mottle of leaf litter and grass rather than one flat
  // green, which is most of what stops it reading as a painted plane.
  const ground = valueNoise2(x / GROUND_WAVELENGTH, z / GROUND_WAVELENGTH, seed ^ GROUND_SALT);
  let colour = mixRgb(FOREST_FLOOR, GRASS, ground);
  let w = mixW(W_FLOOR, W_GRASS, ground);
  // How strongly the tiled ground texture shows at all; drops to 0 under
  // settled snow, which is a surface rather than a ground material; the road
  // is painted per fragment by `roadPaint.ts` and no longer passes through here.
  let detail = 1;

  // Coastal bands, reusing the same mottle noise so pebble
  // patches and grass patches cannot correlate with a third field. Every edge
  // below keys on raw altitude with sea level implicitly at 0; if `SEA_LEVEL`
  // in sim/olympic.ts is ever retuned, all of these thresholds must move too.
  const dry = mixRgb(DRY_SAND, PEBBLE, ground);
  const wDry = mixW(W_SAND, W_PEBBLE, ground);
  const sand = mixRgb(WET_SAND, dry, smoothstep(0, 0.7, altitude));
  const wSand = mixW(W_SAND, wDry, smoothstep(0, 0.7, altitude));
  const submerged = mixRgb(SEABED, SEABED_ROCK, smoothstep(2, 12, -altitude));
  // Both seabed colours (SEABED, SEABED_ROCK) are the pebble layer.
  const wSub = W_PEBBLE;
  const coastal = mixRgb(submerged, sand, smoothstep(-0.4, 0.1, altitude));
  const wCoastal = mixW(wSub, wSand, smoothstep(-0.4, 0.1, altitude));
  colour = mixRgb(coastal, colour, smoothstep(SAND_TOP, COAST_FADE_END, altitude));
  w = mixW(wCoastal, w, smoothstep(SAND_TOP, COAST_FADE_END, altitude));

  // Canopy tint sits AFTER the coastal bands (the density field is already
  // zero on the beach) and BEFORE the slope overlays, so a cliff through a
  // forest still turns to rock.
  colour = mixRgb(colour, CANOPY, canopy * CANOPY_MAX);
  // Canopy is a tint over whatever material is beneath — no weight change.

  // Duff: where the ground-cover field says the grass has thinned into dead
  // leaves and twigs, the floor paints as leaf litter under them, leaning to
  // a needle bed the denser the canopy, so the gaps between pieces read as
  // full rather than as painted grass with twigs on it. A smoothstep of the
  // field, never a threshold; zero duff leaves every value bitwise unchanged.
  const litter = clamp01(duff) * DUFF_FLOOR_MAX;
  w = mixW(w, W_FLOOR, litter);
  colour = mixRgb(colour, mixRgb(FOREST_FLOOR, NEEDLE_BED, canopy), litter);

  // Every transition is a smoothstep, never a threshold. A threshold draws a
  // visible line across the hillside at exactly one gradient.
  colour = mixRgb(colour, ROCK, smoothstep(GRASS_SLOPE, ROCK_SLOPE, slope));
  w = mixW(w, W_ROCK, smoothstep(GRASS_SLOPE, ROCK_SLOPE, slope));
  colour = mixRgb(colour, SCREE, smoothstep(ROCK_SLOPE, SCREE_SLOPE, slope));
  w = mixW(w, W_ROCK, smoothstep(ROCK_SLOPE, SCREE_SLOPE, slope)); // scree is the rock layer

  const above = altitude - snowLineAt(seed, x, z);
  const settled = 1 - smoothstep(SNOW_MAX_SLOPE - SNOW_CLING_BAND, SNOW_MAX_SLOPE, slope);
  const snowFrac = smoothstep(0, SNOW_BLEND, above) * settled;
  colour = mixRgb(colour, SNOW, snowFrac);
  detail *= 1 - snowFrac;

  return { albedo: colour, weights: { ...w, detail } };
}

/**
 * Ground albedo from slope and altitude. Thin wrapper over `classifySurface`,
 * which walks the palette once for both the colour and the material weights
 * `surfaceWeights` returns — see there for the palette and its ordering.
 */
export function surfaceAlbedo(
  seed: number,
  x: number,
  z: number,
  altitude: number,
  slope: number,
  canopy = 0,
): Rgb {
  return classifySurface(seed, x, z, altitude, slope, canopy).albedo;
}

/**
 * Per-material blend weights for the ground-texture layer, alongside the
 * palette colour `surfaceAlbedo` returns. Thin wrapper over `classifySurface`
 * — see there for the palette and its ordering.
 */
export function surfaceWeights(
  seed: number,
  x: number,
  z: number,
  altitude: number,
  slope: number,
  canopy = 0,
): TerrainWeights {
  return classifySurface(seed, x, z, altitude, slope, canopy).weights;
}
