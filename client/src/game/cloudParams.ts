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
export const CLOUD_SIGMA = 0.4;
/** Per metre above the ground: the cloud thins to 1/e this far up. */
export const CLOUD_FALLOFF = 1 / 2.5;
/** Metres the cloud's floor sits below the ground, so a slope never shows its edge. */
export const CLOUD_SEAT = 0.3;
/** Metres from the eye the march reaches; the atmosphere's own fog is beyond. */
export const CLOUD_RANGE = 40;
/** Steps of the march a tier takes: high, medium, and none on low (the closed-form fog alone). */
export const CLOUD_STEPS_HIGH = 12;
export const CLOUD_STEPS_MEDIUM = 8;
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
  /** RGBA8, the height in R from `base` over `range` metres. */
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
export function cloudGroundMap(elevation: (x: number, z: number) => number, cx: number, cz: number, size: number = CLOUD_GROUND_SIZE, span: number = CLOUD_GROUND_SPAN): CloudGround {
  const heights = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = cx + ((i + 0.5) / size - 0.5) * span;
      const z = cz + ((j + 0.5) / size - 0.5) * span;
      const h = elevation(x, z);
      heights[j * size + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  const range = Math.max(1, hi - lo);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((((heights[i] as number) - lo) / range) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, base: lo, range, centreX: cx, centreZ: cz };
}
