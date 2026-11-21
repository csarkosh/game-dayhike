import type { Rgb } from "./colour.js";
import { hash3 } from "../sim/field.js";

/**
 * The plants of the high ground: the meshes the clutter's high-plant class
 * draws (`CLUTTER_HIGHPLANT`, sim/clutter.ts), built in code as the shrub's
 * are (`shrubClump.ts`), and Babylon-free. Four plants of the Olympic
 * subalpine, by the instance's variant:
 *
 * - beargrass (Xerophyllum tenax) as a tussock of wiry arching leaves;
 * - beargrass in flower: the same tussock under a stalk a metre and more
 *   tall, ending in a club of creamy white;
 * - lupine: a low mound of hand-shaped leaves under spikes of blue-violet;
 * - mountain heather: a mat a hand high, dark green flecked with pink.
 *
 * Beargrass comes twice on purpose: most of a colony is not in flower in any
 * one year, and the tussocks are what make the stalks read as beargrass.
 *
 * The origin is at the base (the model convention).
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

export type HighPlantGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

export const HIGH_PLANT_TUSSOCK = 0;
export const HIGH_PLANT_BEARGRASS = 1;
export const HIGH_PLANT_LUPINE = 2;
export const HIGH_PLANT_HEATHER = 3;
export const HIGH_PLANT_COUNT = 4;

/** A tussock's leaves, near and far, their length (m) and width (m). */
const TUSSOCK_LEAVES: readonly [number, number] = [34, 12];
const TUSSOCK_LENGTH = 0.55;
const TUSSOCK_WIDTH: readonly [number, number] = [0.012, 0.03];
const TUSSOCK_DARK: Rgb = { r: 0.03, g: 0.055, b: 0.02 };
const TUSSOCK_LIGHT: Rgb = { r: 0.07, g: 0.105, b: 0.035 };
/** The flowering stalk's height (m), and the club's length and radius. */
const STALK_HEIGHT = 1.25;
const CLUB_LENGTH = 0.22;
const CLUB_RADIUS = 0.055;
const STALK_COLOUR: Rgb = { r: 0.07, g: 0.09, b: 0.04 };
const CLUB_COLOUR: Rgb = { r: 0.34, g: 0.33, b: 0.26 };
/** Lupine: leaves and spikes near and far, a leaf's span, a spike's height (m). */
const LUPINE_LEAVES: readonly [number, number] = [14, 6];
const LUPINE_SPIKES: readonly [number, number] = [5, 3];
const LUPINE_LEAF = 0.13;
const LUPINE_HEIGHT = 0.55;
const LUPINE_DARK: Rgb = { r: 0.022, g: 0.055, b: 0.022 };
const LUPINE_LIGHT: Rgb = { r: 0.045, g: 0.095, b: 0.035 };
const LUPINE_FLOWER: Rgb = { r: 0.075, g: 0.07, b: 0.3 };
const LUPINE_FLOWER_TIP: Rgb = { r: 0.16, g: 0.13, b: 0.36 };
/** Heather: sprigs near and far, the mat's radius and height (m). */
const HEATHER_SPRIGS: readonly [number, number] = [60, 20];
const HEATHER_RADIUS = 0.45;
const HEATHER_HEIGHT = 0.2;
const HEATHER_DARK: Rgb = { r: 0.014, g: 0.034, b: 0.016 };
const HEATHER_LIGHT: Rgb = { r: 0.032, g: 0.062, b: 0.026 };
const HEATHER_FLOWER: Rgb = { r: 0.3, g: 0.07, b: 0.15 };
/** The share of a heather mat's sprigs that end in flower. */
const HEATHER_BLOOM = 0.4;
const SALT = 0xa1b;

type V3 = [number, number, number];

function normalize(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** One plant's arrays, for a variant and a level of detail (0 near, 1 far): a pure function of both. */
export function highPlantGeometry(variant: number, lod: number): HighPlantGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let draw = 0;
  const rand = (): number => hash3(draw++, variant, lod, SALT);
  const push = (p: V3, n: V3, c: Rgb, shade: number): number => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    colors.push(c.r * shade, c.g * shade, c.b * shade, 1);
    return positions.length / 3 - 1;
  };
  /** A spike or a club: four sides from `foot` up `length`, widest at `belly` of the way, to a point. */
  const spike = (foot: V3, length: number, radius: number, base: Rgb, tip: Rgb): void => {
    const rings: [number, number][] = [[0, 0.35], [0.45, 1], [1, 0.05]];
    let prev: number[] | null = null;
    for (const [u, w] of rings) {
      const ring: number[] = [];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        ring.push(push(
          [foot[0] + Math.cos(a) * radius * w, foot[1] + length * u, foot[2] + Math.sin(a) * radius * w],
          normalize([Math.cos(a), 0.35, Math.sin(a)]), mix(base, tip, u), 1,
        ));
      }
      if (prev !== null) {
        for (let k = 0; k < 4; k++) {
          const k1 = (k + 1) % 4;
          indices.push(prev[k] as number, prev[k1] as number, ring[k] as number, prev[k1] as number, ring[k1] as number, ring[k] as number);
        }
      }
      prev = ring;
    }
  };
  /** A wiry leaf from the crown: up, out and over, a strip of three pieces. */
  const tussock = (): void => {
    const leaves = TUSSOCK_LEAVES[lod] as number;
    const width = TUSSOCK_WIDTH[lod] as number;
    for (let i = 0; i < leaves; i++) {
      const azimuth = ((i + rand()) / leaves) * Math.PI * 2;
      const ax = Math.cos(azimuth), az = Math.sin(azimuth);
      const length = TUSSOCK_LENGTH * (0.6 + 0.6 * rand());
      const lean = 0.35 + 0.65 * rand();
      const colour = mix(TUSSOCK_DARK, TUSSOCK_LIGHT, rand());
      let prev: [number, number] | null = null;
      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        const out = length * lean * u * (0.4 + 0.6 * u);
        // Rising, then drooping past its middle where it leans far.
        const up = length * (u - 0.75 * lean * u * u);
        const half = 0.5 * width * (1 - 0.8 * u);
        const n = normalize([ax * 0.5, 1, az * 0.5]);
        const a = push([ax * (0.02 + out) - az * half, up, az * (0.02 + out) + ax * half], n, colour, 0.65 + 0.5 * u);
        const b = push([ax * (0.02 + out) + az * half, up, az * (0.02 + out) - ax * half], n, colour, 0.65 + 0.5 * u);
        if (prev !== null) indices.push(prev[0], prev[1], a, prev[1], b, a);
        prev = [a, b];
      }
    }
  };

  if (variant === HIGH_PLANT_TUSSOCK || variant === HIGH_PLANT_BEARGRASS) {
    tussock();
    if (variant === HIGH_PLANT_BEARGRASS) {
      // The stalk, a thin spike of its own, and the club of flowers at its top.
      spike([0, 0, 0], STALK_HEIGHT - CLUB_LENGTH * 0.5, 0.012, STALK_COLOUR, STALK_COLOUR);
      spike([0, STALK_HEIGHT - CLUB_LENGTH, 0], CLUB_LENGTH, CLUB_RADIUS, CLUB_COLOUR, CLUB_COLOUR);
    }
  } else if (variant === HIGH_PLANT_LUPINE) {
    const leaves = LUPINE_LEAVES[lod] as number;
    const fingers = lod === 0 ? 6 : 4;
    for (let i = 0; i < leaves; i++) {
      // A hand of leaflets held flat on its own stalk, the hands at mixed heights round the crown.
      const azimuth = rand() * Math.PI * 2;
      const reach = 0.06 + 0.2 * rand();
      const centre: V3 = [Math.cos(azimuth) * reach, 0.1 + 0.2 * rand(), Math.sin(azimuth) * reach];
      const span = LUPINE_LEAF * (0.7 + 0.6 * rand());
      const colour = mix(LUPINE_DARK, LUPINE_LIGHT, rand());
      const n = normalize([Math.cos(azimuth) * 0.4, 1, Math.sin(azimuth) * 0.4]);
      const hub = push(centre, n, colour, 0.8);
      const turn = rand() * Math.PI * 2;
      for (let f = 0; f < fingers; f++) {
        const a = turn + (f / fingers) * Math.PI * 2;
        const w = (Math.PI / fingers) * 0.55;
        const l = push([centre[0] + Math.cos(a - w) * span * 0.6, centre[1] + 0.01, centre[2] + Math.sin(a - w) * span * 0.6], n, colour, 1);
        const t = push([centre[0] + Math.cos(a) * span, centre[1] - 0.012, centre[2] + Math.sin(a) * span], n, colour, 1.1);
        const r = push([centre[0] + Math.cos(a + w) * span * 0.6, centre[1] + 0.01, centre[2] + Math.sin(a + w) * span * 0.6], n, colour, 1);
        indices.push(hub, l, t, hub, t, r);
      }
    }
    const spikes = LUPINE_SPIKES[lod] as number;
    for (let i = 0; i < spikes; i++) {
      const azimuth = ((i + rand()) / spikes) * Math.PI * 2;
      const reach = 0.03 + 0.12 * rand();
      const height = LUPINE_HEIGHT * (0.7 + 0.45 * rand());
      const foot: V3 = [Math.cos(azimuth) * reach, 0.05, Math.sin(azimuth) * reach];
      // A bare stem to the leaves' height, then the flowers.
      spike(foot, height * 0.45, 0.008, LUPINE_DARK, LUPINE_LIGHT);
      spike([foot[0], foot[1] + height * 0.4, foot[2]], height * 0.6, 0.032, LUPINE_FLOWER, LUPINE_FLOWER_TIP);
    }
  } else {
    // Heather: short sprigs over a low dome, close enough to close it, some ending in flower.
    const sprigs = HEATHER_SPRIGS[lod] as number;
    const size = lod === 0 ? 0.075 : 0.14;
    for (let i = 0; i < sprigs; i++) {
      const azimuth = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * HEATHER_RADIUS;
      const ax = Math.cos(azimuth), az = Math.sin(azimuth);
      const dome = HEATHER_HEIGHT * (1 - 0.75 * (r / HEATHER_RADIUS) * (r / HEATHER_RADIUS));
      const foot: V3 = [ax * r, dome * 0.35, az * r];
      const top: V3 = [ax * (r + size * 0.5), dome + size * 0.4 * rand(), az * (r + size * 0.5)];
      const bloom = rand() < HEATHER_BLOOM;
      const colour = mix(HEATHER_DARK, HEATHER_LIGHT, rand());
      const n = normalize([ax * 0.5, 1, az * 0.5]);
      const a = push([foot[0] - az * size * 0.5, foot[1], foot[2] + ax * size * 0.5], n, colour, 0.75);
      const b = push([foot[0] + az * size * 0.5, foot[1], foot[2] - ax * size * 0.5], n, colour, 0.75);
      const c = push(top, n, bloom ? HEATHER_FLOWER : colour, bloom ? 1 : 1.15);
      indices.push(a, b, c);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}
