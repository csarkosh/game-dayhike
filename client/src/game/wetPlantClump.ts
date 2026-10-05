import type { Rgb } from "./colour.js";
import { hash3 } from "../sim/field.js";

/**
 * The plants of wet ground: the meshes the clutter's wet-plant class draws
 * (`CLUTTER_WETPLANT`, sim/clutter.ts), built in code as the shrub's are
 * (`shrubClump.ts`), and Babylon-free. Two plants, by the instance's variant,
 * each of which says "the ground is wet here" from across a clearing:
 *
 * - skunk cabbage (Lysichiton americanus): a rosette of very large, bright
 *   yellow-green paddle leaves standing from the mud, knee to waist high;
 * - devil's club (Oplopanax horridus): a few leaning, pale, spiny canes one
 *   to two metres tall, each ending in a whorl of very large maple-like
 *   leaves held flat.
 *
 * The origin is at the base (the model convention). Each leaf's normal leans
 * from its own face toward the plant's outward direction, so a clump shades
 * as one mass.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

export type WetPlantGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

export const WET_PLANT_SKUNK_CABBAGE = 0;
export const WET_PLANT_DEVILS_CLUB = 1;
export const WET_PLANT_COUNT = 2;

/** Skunk cabbage: leaves a rosette near and far, a leaf's length and greatest width (m). */
const CABBAGE_LEAVES: readonly [number, number] = [9, 5];
const CABBAGE_LENGTH = 0.85;
const CABBAGE_WIDTH = 0.34;
const CABBAGE_DARK: Rgb = { r: 0.03, g: 0.07, b: 0.016 };
const CABBAGE_LIGHT: Rgb = { r: 0.06, g: 0.125, b: 0.026 };
/** Devil's club: canes near and far, leaves a cane's whorl, a leaf's span (m), a cane's height (m). */
const CLUB_CANES: readonly [number, number] = [5, 3];
const CLUB_LEAVES: readonly [number, number] = [5, 3];
const CLUB_LEAF = 0.42;
const CLUB_HEIGHT: readonly [number, number] = [1.1, 1.9];
const CLUB_DARK: Rgb = { r: 0.018, g: 0.046, b: 0.015 };
const CLUB_LIGHT: Rgb = { r: 0.04, g: 0.088, b: 0.024 };
const CLUB_CANE: Rgb = { r: 0.07, g: 0.058, b: 0.04 };
/** How far a leaf's normal leans from its own face toward the plant's outward direction. */
const NORMAL_OUT = 0.5;
const SALT = 0x3e7;

type V3 = [number, number, number];

function normalize(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** One plant's arrays, for a variant and a level of detail (0 near, 1 far): a pure function of both. */
export function wetPlantGeometry(variant: number, lod: number): WetPlantGeometry {
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

  if (variant === WET_PLANT_SKUNK_CABBAGE) {
    const leaves = CABBAGE_LEAVES[lod] as number;
    const rings = lod === 0 ? 4 : 2;
    for (let i = 0; i < leaves; i++) {
      const azimuth = ((i + 0.6 * rand()) / leaves) * Math.PI * 2;
      const ax = Math.cos(azimuth), az = Math.sin(azimuth);
      const length = CABBAGE_LENGTH * (0.65 + 0.5 * rand());
      // The inner leaves stand, the outer ones lie back.
      const lean = 0.25 + 0.75 * rand();
      const colour = mix(CABBAGE_DARK, CABBAGE_LIGHT, rand());
      let prev: [number, number] | null = null;
      for (let k = 0; k <= rings; k++) {
        const u = k / rings;
        // Up from the mud, then arching out: the paddle's spine.
        const out = length * lean * u * u;
        const up = length * (u - 0.35 * lean * u * u);
        // Widest past the middle, a blunt tip, a narrow stalk.
        const half = 0.5 * CABBAGE_WIDTH * (length / CABBAGE_LENGTH) * Math.sin(Math.PI * Math.min(1, 0.12 + 0.88 * u)) ** 0.7 * (u < 1 ? 1 : 0.35);
        const centre: V3 = [ax * (0.04 + out), -0.03 + up, az * (0.04 + out)];
        const n = normalize([ax * (NORMAL_OUT + 0.4 * (1 - u)), 1 - NORMAL_OUT + 0.5 * u, az * (NORMAL_OUT + 0.4 * (1 - u))]);
        const shade = 0.7 + 0.4 * u;
        const a = push([centre[0] - az * half, centre[1] + 0.25 * half, centre[2] + ax * half], n, colour, shade);
        const b = push([centre[0] + az * half, centre[1] + 0.25 * half, centre[2] - ax * half], n, colour, shade);
        if (prev !== null) indices.push(prev[0], prev[1], a, prev[1], b, a);
        prev = [a, b];
      }
    }
  } else {
    const canes = CLUB_CANES[lod] as number;
    const whorl = CLUB_LEAVES[lod] as number;
    const lobes = lod === 0 ? 5 : 3;
    for (let c = 0; c < canes; c++) {
      const azimuth = ((c + 0.7 * rand()) / canes) * Math.PI * 2;
      const ax = Math.cos(azimuth), az = Math.sin(azimuth);
      const height = CLUB_HEIGHT[0] + (CLUB_HEIGHT[1] - CLUB_HEIGHT[0]) * rand();
      const reach = 0.15 + 0.45 * rand();
      const foot: V3 = [ax * 0.08, -0.04, az * 0.08];
      const top: V3 = [ax * (0.08 + reach), height, az * (0.08 + reach)];
      // The cane: three sides, tapering a little.
      const ring = (at: V3, r: number): number[] => {
        const out: number[] = [];
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          out.push(push([at[0] + Math.cos(a) * r, at[1], at[2] + Math.sin(a) * r], normalize([Math.cos(a), 0.15, Math.sin(a)]), CLUB_CANE, 1));
        }
        return out;
      };
      const lower = ring(foot, 0.022);
      const upper = ring(top, 0.014);
      for (let k = 0; k < 3; k++) {
        const k1 = (k + 1) % 3;
        indices.push(lower[k] as number, lower[k1] as number, upper[k] as number, lower[k1] as number, upper[k1] as number, upper[k] as number);
      }
      // The whorl: large lobed leaves held flat round the cane's top, each on a short stalk.
      for (let l = 0; l < whorl; l++) {
        const la = azimuth + ((l + 0.5 * rand()) / whorl) * Math.PI * 2;
        const lx = Math.cos(la), lz = Math.sin(la);
        const span = CLUB_LEAF * (0.7 + 0.5 * rand());
        const droop = 0.05 + 0.12 * rand();
        const centre: V3 = [top[0] + lx * span * 0.75, top[1] - droop - 0.06 * l, top[2] + lz * span * 0.75];
        const colour = mix(CLUB_DARK, CLUB_LIGHT, rand());
        const n = normalize([lx * NORMAL_OUT, 1, lz * NORMAL_OUT]);
        const hub = push(centre, n, colour, 0.85);
        const rim: number[] = [];
        // A lobed outline: points alternately at the lobes' tips and the notches between.
        for (let k = 0; k < lobes * 2; k++) {
          const a = la + (k / (lobes * 2)) * Math.PI * 2;
          const r = (k % 2 === 0 ? 0.5 : 0.3) * span;
          rim.push(push([centre[0] + Math.cos(a) * r, centre[1] - 0.25 * r * (k % 2 === 0 ? 1 : 0.4), centre[2] + Math.sin(a) * r], n, colour, k % 2 === 0 ? 1.1 : 0.95));
        }
        for (let k = 0; k < rim.length; k++) indices.push(hub, rim[k] as number, rim[(k + 1) % rim.length] as number);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}
