import { HOLLOW_FIGURE_M } from "./hollowLook.js";
import { clamp01, type Rgb } from "./colour.js";
import { hash2 } from "../sim/field.js";

/**
 * The pure arithmetic of the ground cloud (docs/rendering/2026-10-07-ground-cloud-volume-design.md):
 * the night's mist as a volume the atmosphere plugin marches through in every
 * PBR fragment, rather than sprites. Its density by the night, the haunt and
 * the chase; the tileable noise that shapes it; and the height map of the
 * ground round the player that it rests on. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `atmosphere.ts` binds it.
 */

/**
 * The density knob, 0 to 1: the night's with no haunt on, the chase's (reached
 * by its cast), and how much the haunt lifts the night's toward 1. The
 * console's `mist <density>` holds it at a level instead, for looking at it.
 */
export const CLOUD_NIGHT_DENSITY = 0.3;
export const CLOUD_CHASE_DENSITY = 0.7;
export const CLOUD_HAUNT_LIFT = 0.25;
/** Extinction a metre at a density of 1, at the ground, where the noise is full. */
export const CLOUD_SIGMA = 0.55;
/**
 * Metres above the ground at which the cloud has thinned to 1/e, and the
 * metres the haunt adds to that at its full: the mist stands taller as the
 * shades come, at a full haunt to the figure's own height (HOLLOW_FIGURE_M,
 * 5.4 m), so a figure stands in it head to foot and comes out of it
 * (2026-10-20; 2.4 m before, a 1/e height of 4 m that left its head above).
 */
export const CLOUD_HEIGHT_M = 1.6;
export const CLOUD_HAUNT_HEIGHT_M = HOLLOW_FIGURE_M - CLOUD_HEIGHT_M;
/** Metres the cloud's floor sits below the ground, so a slope never shows its edge. */
export const CLOUD_SEAT = 0.3;
/** Metres from the eye the march reaches; the atmosphere's own fog is beyond. */
export const CLOUD_RANGE = 40;
/** Steps of the march a tier takes: high, medium, and none on low (the closed-form fog alone). */
export const CLOUD_STEPS_HIGH = 12;
export const CLOUD_STEPS_MEDIUM = 8;
/** The trail: the cloud's share of itself on the trail (thin, the way is open), and the metres off the trail's edge over which it fills to whole beside it. */
export const CLOUD_TRAIL_SHARE = 0.3;
export const CLOUD_TRAIL_EDGE_M = 0.8;
export const CLOUD_TRAIL_FADE_M = 4.5;
/** Metres from the eye within which the cloud's shapes smooth to a plain veil, the small ones first, so the near mist hangs rather than rushing past a walker. */
export const CLOUD_NEAR_M = 8;
/** The noise's two reads: metres a tile spans for the large shapes and the small, and the wind's metres a second. */
export const CLOUD_NOISE_LARGE_M = 11;
export const CLOUD_NOISE_SMALL_M = 4;
export const CLOUD_WIND_MPS = 0.35;
/** The cloud's own colour: the air's near colour lifted toward grey by this much, and this much brighter. */
export const CLOUD_GREY_MIX = 0.55;
export const CLOUD_LIFT = 1.35;
/** The glow toward the sun or moon through the cloud, and its sharpness. */
export const CLOUD_GLOW = 0.35;
export const CLOUD_GLOW_POWER = 4;
/** The map's size, the noise's and the ground's alike (the shader's ATM_CLOUD_EDGE is half a texel of it), and the ground's span (metres across). */
export const CLOUD_NOISE_SIZE = 64;
export const CLOUD_GROUND_SIZE = CLOUD_NOISE_SIZE;
export const CLOUD_GROUND_SPAN = 128;
/** The ground map is rebuilt once the eye is this far from its centre. */
export const CLOUD_GROUND_REBUILD_M = 16;

/** The cloud's density for a frame: the night (0 to 1), the haunt's level, and the chase's cast. */
export function cloudDensityUnder(night: number, haunt: number, chase: number): number {
  const n = clamp01(night), h = clamp01(haunt), c = clamp01(chase);
  const base = CLOUD_NIGHT_DENSITY + (1 - CLOUD_NIGHT_DENSITY) * h * CLOUD_HAUNT_LIFT;
  return n * (base + (CLOUD_CHASE_DENSITY - base) * c);
}

/**
 * The density knob a frame draws: the level it is held at (the console's
 * `mist <density>`), else the night's under the haunt and the chase, by how
 * far the mist has come in (0 to 1: the cloud rises by it, after the night).
 */
export function cloudDensityNow(hold: number | null, night: number, haunt: number, chase: number, mistIn: number): number {
  return hold ?? cloudDensityUnder(night, haunt, chase) * mistIn;
}

/**
 * The steps of the march on a tier: the high tier's where the post chain has
 * its halation, the medium's where it runs without, and none where there is
 * no chain (the low tier draws the closed-form fog alone).
 */
export function cloudStepsFor(features: { readonly pipeline: boolean; readonly halation: boolean }): number {
  if (!features.pipeline) return 0;
  return features.halation ? CLOUD_STEPS_HIGH : CLOUD_STEPS_MEDIUM;
}

/**
 * Whether the ground's map is to be built again for an eye at (x, z): none
 * is built yet (`at` null), or the eye is past CLOUD_GROUND_REBUILD_M from
 * the centre of the one that is.
 */
export function cloudGroundDue(at: { readonly x: number; readonly z: number } | null, x: number, z: number): boolean {
  return at === null || Math.hypot(x - at.x, z - at.z) > CLOUD_GROUND_REBUILD_M;
}

/** The cloud's height (metres to 1/e) for a haunt's level. */
export function cloudHeightUnder(haunt: number): number {
  return CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M * clamp01(haunt);
}

/** The cloud's colour under the air's near colour: lifted toward its own grey and brightened. */
export function cloudColourUnder(near: Rgb): Rgb {
  const grey = 0.299 * near.r + 0.587 * near.g + 0.114 * near.b;
  return {
    r: (near.r + (grey - near.r) * CLOUD_GREY_MIX) * CLOUD_LIFT,
    g: (near.g + (grey - near.g) * CLOUD_GREY_MIX) * CLOUD_LIFT,
    b: (near.b + (grey - near.b) * CLOUD_GREY_MIX) * CLOUD_LIFT,
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise on a lattice of `cells` over a `size` texture, one octave, in [0, 1]. */
function tileNoise(x: number, y: number, size: number, cells: number, seed: number): number {
  const u = (x / size) * cells, v = (y / size) * cells;
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = smooth(u - x0), fy = smooth(v - y0);
  const at = (i: number, j: number) => hash2(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/**
 * The cloud's noise: RGBA8, tileable, two channels of two-octave value noise
 * on their own seeds (the large shapes read R, the small read G), each
 * stretched to fill [0, 1]. Plain arithmetic, so the shell builds it headlessly.
 */
export function cloudNoiseMap(size: number = CLOUD_NOISE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (const [channel, seed] of [[0, 0x6d15], [1, 0x3f09]] as const) {
    const values = new Float32Array(size * size);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = tileNoise(x, y, size, 4, seed) * 0.65 + tileNoise(x, y, size, 8, seed + 1) * 0.35;
        values[y * size + x] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    for (let i = 0; i < size * size; i++) {
      data[i * 4 + channel] = Math.round(((values[i] as number) - lo) / Math.max(1e-6, hi - lo) * 255);
    }
  }
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  return data;
}

export type CloudGround = {
  /** RGBA8: the height in R from `base` over `range` metres, and in A how far off the trail a place is, 0 on it and 255 from CLOUD_TRAIL_FADE_M beyond its edge. */
  data: Uint8Array;
  base: number;
  range: number;
  centreX: number;
  centreZ: number;
};

/**
 * The ground round a place, for the cloud to rest on: `size` samples a side
 * over `span` metres, centred on (cx, cz), the lowest at 0 and the highest
 * at 255. A cell is span/size metres; the texture is read bilinearly.
 */
export function cloudGroundMap(elevation: (x: number, z: number) => number, cx: number, cz: number, trail: ((x: number, z: number) => number) | null = null, size: number = CLOUD_GROUND_SIZE, span: number = CLOUD_GROUND_SPAN): CloudGround {
  const heights = new Float32Array(size * size);
  const off = new Uint8Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = cx + ((i + 0.5) / size - 0.5) * span;
      const z = cz + ((j + 0.5) / size - 0.5) * span;
      const h = elevation(x, z);
      heights[j * size + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      const d = trail === null ? Infinity : trail(x, z);
      const t = clamp01((d - CLOUD_TRAIL_EDGE_M) / (CLOUD_TRAIL_FADE_M - CLOUD_TRAIL_EDGE_M));
      off[j * size + i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  const range = Math.max(1, hi - lo);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((((heights[i] as number) - lo) / range) * 255);
    data[i * 4 + 3] = off[i] as number;
  }
  return { data, base: lo, range, centreX: cx, centreZ: cz };
}

/** The cloud for a frame. */
export type CloudState = {
  /** The density knob, 0 to 1 (cloudDensityUnder), the steps the tier marches (0: no cloud), and the haunt's level, which the cloud stands taller by. */
  density: number;
  steps: number;
  haunt: number;
  /** The clock, seconds, for the wind. */
  seconds: number;
  /** The cloud's colour, linear. */
  colour: Rgb;
  /** The ground map's centre, base and range (cloudGroundMap). */
  ground: { centreX: number; centreZ: number; base: number; range: number };
};

/** No cloud, over no ground yet: the state before the first frame sets one. */
export function noCloud(): CloudState {
  return { density: 0, steps: 0, haunt: 0, seconds: 0, colour: { r: 0, g: 0, b: 0 }, ground: { centreX: 0, centreZ: 0, base: 0, range: 1 } };
}

/**
 * `state` for a frame: its density knob and the haunt's level, each held to
 * [0, 1], the tier's steps, the clock, and its colour under the air's near
 * colour (`cloudColourUnder`: dark by night, pale by day). The ground it
 * rests on is kept.
 */
export function cloudFor(state: CloudState, density: number, steps: number, seconds: number, haunt: number, near: Rgb): CloudState {
  return { ...state, density: Math.max(0, Math.min(1, density)), steps, seconds, haunt: Math.max(0, Math.min(1, haunt)), colour: cloudColourUnder(near) };
}

/** `state` resting on `ground`: the map's centre, base and range. */
export function cloudOn(state: CloudState, ground: CloudGround): CloudState {
  return { ...state, ground: { centreX: ground.centreX, centreZ: ground.centreZ, base: ground.base, range: ground.range } };
}

/**
 * Lays `ground` into the cloud's map (`cloudNoiseMap`, RGBA8): the height in
 * B and how far off the trail in A, beside the noise in R and G. The one map
 * is read bilinearly, repeating both ways for the noise; the ground's reads
 * are held half a texel inside its edge by the shader.
 */
export function writeCloudGround(map: Uint8Array, ground: CloudGround): void {
  for (let i = 0; i < CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE; i++) {
    map[i * 4 + 2] = ground.data[i * 4] as number;
    map[i * 4 + 3] = ground.data[i * 4 + 3] as number;
  }
}

/** The density knob at or under which the cloud is not marched at all. */
export const CLOUD_MARCH_FLOOR = 0.002;

/** The steps the cloud's march takes this frame: the tier's where it has density, else none. */
export function cloudMarchSteps(state: CloudState): number {
  return state.density > CLOUD_MARCH_FLOOR ? state.steps : 0;
}

/** The cloud's uniforms by name, in the order the atmosphere declares them. */
export type CloudUniforms = {
  /** Extinction a metre at the ground: CLOUD_SIGMA times the density knob. */
  atmCloudDensity: [number];
  /** The march's steps; 0 draws no cloud. */
  atmCloudSteps: [number];
  atmCloudRange: [number];
  /** One over the cloud's height (`cloudHeightUnder`). */
  atmCloudFalloff: [number];
  atmCloudSeat: [number];
  /** Metres the ground map's byte spans. */
  atmCloudGroundRange: [number];
  atmCloudNear: [number];
  atmCloudTrail: [number];
  /** One over the large and the small shapes' tile, metres. */
  atmCloudNoiseScale: [number, number];
  /** The wind's drift of the two reads, in tiles, each folded to [0, 1). */
  atmCloudWind: [number, number];
  /** (the glow toward the sun, its sharpness). */
  atmCloudGlow: [number, number];
  atmCloudColour: [number, number, number];
  /** (the ground map's centre x and z, one over its span, its base height). */
  atmCloudGroundRect: [number, number, number, number];
};

/** A record of the right shape, every component zero, for `cloudUniforms` to fill. */
export function emptyCloudUniforms(): CloudUniforms {
  return {
    atmCloudDensity: [0], atmCloudSteps: [0], atmCloudRange: [0], atmCloudFalloff: [0], atmCloudSeat: [0],
    atmCloudGroundRange: [0], atmCloudNear: [0], atmCloudTrail: [0], atmCloudNoiseScale: [0, 0], atmCloudWind: [0, 0],
    atmCloudGlow: [0, 0], atmCloudColour: [0, 0, 0], atmCloudGroundRect: [0, 0, 0, 0],
  };
}

/**
 * The cloud's uniforms for `c`, marched in `steps` (0: none; the caller's,
 * since the materials take none while the post chain marches the cloud).
 * Fills and returns `out` (a record of its own when none is given).
 */
export function cloudUniforms(c: CloudState, steps: number, out: CloudUniforms = emptyCloudUniforms()): CloudUniforms {
  out.atmCloudSteps[0] = steps;
  out.atmCloudDensity[0] = CLOUD_SIGMA * c.density;
  out.atmCloudRange[0] = CLOUD_RANGE;
  out.atmCloudFalloff[0] = 1 / cloudHeightUnder(c.haunt);
  out.atmCloudSeat[0] = CLOUD_SEAT;
  out.atmCloudGroundRange[0] = c.ground.range;
  out.atmCloudNear[0] = CLOUD_NEAR_M;
  out.atmCloudTrail[0] = CLOUD_TRAIL_SHARE;
  out.atmCloudNoiseScale[0] = 1 / CLOUD_NOISE_LARGE_M;
  out.atmCloudNoiseScale[1] = 1 / CLOUD_NOISE_SMALL_M;
  const wind = (c.seconds * CLOUD_WIND_MPS) / CLOUD_NOISE_LARGE_M;
  out.atmCloudWind[0] = wind % 1;
  out.atmCloudWind[1] = (wind * 0.6) % 1;
  out.atmCloudGlow[0] = CLOUD_GLOW;
  out.atmCloudGlow[1] = CLOUD_GLOW_POWER;
  out.atmCloudColour[0] = c.colour.r;
  out.atmCloudColour[1] = c.colour.g;
  out.atmCloudColour[2] = c.colour.b;
  out.atmCloudGroundRect[0] = c.ground.centreX;
  out.atmCloudGroundRect[1] = c.ground.centreZ;
  out.atmCloudGroundRect[2] = 1 / CLOUD_GROUND_SPAN;
  out.atmCloudGroundRect[3] = c.ground.base;
  return out;
}
