import type { Rgb } from "./colour.js";
import { hash3 } from "../sim/field.js";

/**
 * The evergreen shrub: the mesh the clutter's shrub class draws
 * (`CLUTTER_SHRUB`, sim/clutter.ts), built here from a parameter table and a
 * hash so it needs no asset. Babylon-free, like `bladeClump.ts`: the shell
 * (`clutterMeshes.ts`) wraps the arrays in meshes, and the tests read them
 * directly.
 *
 * It is modelled on salal (Gaultheria shallon), the shrub of the Olympic
 * coast and lowland forest: arching stems from one base, broad leathery
 * oval leaves set alternately along them, the whole a dense mound. The same
 * mound, smaller, stands for the huckleberries of the high forest. A stem is
 * a flat ribbon that arcs up and out; a leaf is a folded oval of six
 * vertices (a diamond of four at the far level of detail), hung along a stem or set on the mound's shell to close it. Every
 * leaf's normal leans from its own face toward the mound's outward
 * direction, so the mound shades as one rounded mass and not as a scatter of
 * flat cards.
 *
 * The origin is at the base (the model convention); the unit mound stands
 * about a metre tall, and the class's scale makes it 0.5 to 1.3 m.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

export type ShrubCharacter = {
  name: string;
  /** Stems from the base, at the near and the far level of detail. */
  stems: readonly [number, number];
  /** Leaves along each stem. */
  stemLeaves: readonly [number, number];
  /** Leaves on the mound's shell. */
  shellLeaves: readonly [number, number];
  /** A leaf's length (m); its width is `LEAF_ASPECT` of it. The far level
   * draws fewer, larger leaves that cover the same mound. */
  leaf: readonly [number, number];
  /** The mound's height and radius (m). */
  height: number;
  radius: number;
  /** Leaf colours between which each leaf is drawn, linear. */
  dark: Rgb;
  light: Rgb;
};

/** Two mounds: a low, wide one and a taller, narrower one. Their leaf counts
 * are what the class costs a frame, so they are as few as close the mound:
 * about 750 triangles near and 130 far, with the far leaves larger to cover
 * the same dome. */
export const SHRUB_CHARACTERS: readonly ShrubCharacter[] = [
  {
    name: "low mound", stems: [9, 4], stemLeaves: [7, 3], shellLeaves: [115, 40], leaf: [0.2, 0.38],
    height: 0.85, radius: 0.8, dark: { r: 0.012, g: 0.03, b: 0.012 }, light: { r: 0.032, g: 0.07, b: 0.022 },
  },
  {
    name: "tall mound", stems: [8, 4], stemLeaves: [8, 3], shellLeaves: [100, 36], leaf: [0.19, 0.36],
    height: 1.1, radius: 0.62, dark: { r: 0.014, g: 0.034, b: 0.014 }, light: { r: 0.036, g: 0.076, b: 0.024 },
  },
];

/** A leaf's width over its length: a broad oval. */
export const LEAF_ASPECT = 0.62;
/** Where along its midrib a leaf is widest, and where its shoulders are and how wide, so the near leaf is an oval. */
const LEAF_WIDEST = 0.38;
const LEAF_SHOULDER = 0.74;
const LEAF_SHOULDER_WIDTH = 0.66;
/** A leaf's sides rise this share of its width above its midrib: the fold. */
const LEAF_FOLD = 0.18;
/** How far a leaf's normal leans from its own face toward the mound's outward direction. */
const LEAF_NORMAL_OUT = 0.65;
const STEM_SEGMENTS = 4;
const STEM_WIDTH = 0.012;
const STEM_COLOUR: Rgb = { r: 0.035, g: 0.02, b: 0.014 };
/** Stems start this far under the origin, so no base shows on a slope. */
const STEM_ROOT = -0.05;
/** The first leaf on a stem sits this share of the way up it. */
const STEM_BARE = 0.3;
/** The shell's leaves lie from this share of the mound's radius out to its surface. */
const SHELL_INNER = 0.6;
/** A leaf at the shell's inner edge is this dark, of one at the surface. */
const SHELL_INNER_SHADE = 0.45;
const SALT = 0x5a1a1;

export type ShrubGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

type V3 = [number, number, number];

function normalize(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * One mound's arrays, for a character and a level of detail (0 near, 1 far).
 * A pure function of both: every draw comes from `hash3` over the leaf's or
 * the stem's own index.
 */
export function shrubGeometry(variant: number, lod: number): ShrubGeometry {
  const ch = SHRUB_CHARACTERS[variant] as ShrubCharacter;
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

  /** A leaf at `at`, its midrib along `dir`, shaded as part of the mound whose
   * outward direction there is `out`. With `flat` the leaf lies in the
   * mound's surface, facing `out`; without, its width runs level. `shade`
   * darkens a leaf inside the mound. */
  const leaf = (at: V3, dir: V3, out: V3, flat = false, shade = 1): void => {
    const length = (ch.leaf[lod] as number) * (0.75 + 0.5 * rand());
    const half = length * LEAF_ASPECT * 0.5;
    const d = normalize(dir);
    // The leaf's width runs across its midrib, as level as the midrib allows.
    let side = cross(d, flat ? out : [0, 1, 0]);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-3) side = [1, 0, 0];
    side = normalize(side);
    const face = normalize(cross(side, d));
    const up: V3 = face[1] < 0 ? [-face[0], -face[1], -face[2]] : face;
    const n = normalize([
      up[0] * (1 - LEAF_NORMAL_OUT) + out[0] * LEAF_NORMAL_OUT,
      up[1] * (1 - LEAF_NORMAL_OUT) + out[1] * LEAF_NORMAL_OUT,
      up[2] * (1 - LEAF_NORMAL_OUT) + out[2] * LEAF_NORMAL_OUT,
    ]);
    const t = rand();
    const colour: Rgb = {
      r: ch.dark.r + (ch.light.r - ch.dark.r) * t,
      g: ch.dark.g + (ch.light.g - ch.dark.g) * t,
      b: ch.dark.b + (ch.light.b - ch.dark.b) * t,
    };
    const lift = half * LEAF_FOLD;
    /** A vertex `u` of the way along the midrib and `w` half-widths to its side, the sides lifted by the fold. */
    const at2 = (u: number, w: number, shadeAt: number): number => push([
      at[0] + d[0] * length * u + side[0] * half * w + up[0] * lift * Math.abs(w),
      at[1] + d[1] * length * u + side[1] * half * w + up[1] * lift * Math.abs(w),
      at[2] + d[2] * length * u + side[2] * half * w + up[2] * lift * Math.abs(w),
    ], n, colour, shadeAt * shade);
    const base = at2(0, 0, 0.8);
    const left = at2(LEAF_WIDEST, -1, 1);
    const right = at2(LEAF_WIDEST, 1, 1);
    const tip = at2(1, 0, 1.1);
    if (lod > 0) {
      // Far: a diamond.
      indices.push(base, left, tip, base, tip, right);
      return;
    }
    // Near: an oval, its shoulders between the widest point and the tip.
    const leftShoulder = at2(LEAF_SHOULDER, -LEAF_SHOULDER_WIDTH, 1.05);
    const rightShoulder = at2(LEAF_SHOULDER, LEAF_SHOULDER_WIDTH, 1.05);
    indices.push(base, left, right, left, leftShoulder, right, leftShoulder, rightShoulder, right, leftShoulder, tip, rightShoulder);
  };

  /** The mound's outward direction at a point: from a centre a third of the way up. */
  const outward = (p: V3): V3 => normalize([p[0], (p[1] - ch.height * 0.33) * 1.2 + 0.25, p[2]]);

  const stems = ch.stems[lod] as number;
  const stemLeaves = ch.stemLeaves[lod] as number;
  for (let s = 0; s < stems; s++) {
    const azimuth = ((s + rand()) / stems) * Math.PI * 2;
    // The inner stems stand, the outer ones arch over to the mound's edge.
    const reach = ch.radius * (0.25 + 0.75 * rand());
    const top = ch.height * (1 - 0.45 * (reach / ch.radius) * (reach / ch.radius)) * (0.8 + 0.2 * rand());
    const ax = Math.cos(azimuth);
    const az = Math.sin(azimuth);
    const point = (u: number): V3 => {
      // Up fast, out late: a stem that rises and then arches.
      const outU = u * u * (0.6 + 0.4 * u);
      const upU = 1 - (1 - u) * (1 - u);
      return [ax * reach * outU, STEM_ROOT + (top - STEM_ROOT) * upU, az * reach * outU];
    };
    const across: V3 = [-az * STEM_WIDTH, 0, ax * STEM_WIDTH];
    let prev: [number, number] | null = null;
    for (let k = 0; k <= STEM_SEGMENTS; k++) {
      const u = k / STEM_SEGMENTS;
      const p = point(u);
      const taper = 1 - 0.7 * u;
      const n: V3 = [ax * 0.6, 0.8, az * 0.6];
      const a = push([p[0] - across[0] * taper, p[1], p[2] - across[2] * taper], n, STEM_COLOUR, 1);
      const b = push([p[0] + across[0] * taper, p[1], p[2] + across[2] * taper], n, STEM_COLOUR, 1);
      if (prev !== null) indices.push(prev[0], prev[1], a, prev[1], b, a);
      prev = [a, b];
    }
    for (let k = 0; k < stemLeaves; k++) {
      const u = STEM_BARE + (1 - STEM_BARE) * ((k + 0.5) / stemLeaves);
      const p = point(u);
      const ahead = point(Math.min(1, u + 0.05));
      const along = normalize([ahead[0] - p[0], ahead[1] - p[1], ahead[2] - p[2]]);
      // Alternate leaves: one side of the stem, then the other, each angled
      // out from it and a little down, as a leathery leaf hangs.
      const hand = k % 2 === 0 ? 1 : -1;
      const spread = 0.9 + 0.5 * rand();
      const dir: V3 = [
        along[0] * 0.5 - az * hand * spread,
        along[1] * 0.5 - 0.15 - 0.3 * rand(),
        along[2] * 0.5 + ax * hand * spread,
      ];
      leaf(p, dir, outward(p));
    }
  }

  // The shell: leaves lying in the mound's surface, each facing outward and
  // hanging a little, in layers from the surface inward. The inner layers are
  // darker, so the mound is closed and shaded from every side and no stem
  // stands alone against the sky.
  const shell = ch.shellLeaves[lod] as number;
  for (let i = 0; i < shell; i++) {
    const azimuth = rand() * Math.PI * 2;
    // Even over the dome's height, short of the very base.
    const rise = 0.1 + 0.9 * rand();
    const ring = Math.sqrt(Math.max(0, 1 - rise * rise * 0.85));
    const depth = SHELL_INNER + (1 - SHELL_INNER) * rand();
    const p: V3 = [
      Math.cos(azimuth) * ch.radius * ring * depth,
      ch.height * rise * depth,
      Math.sin(azimuth) * ch.radius * ring * depth,
    ];
    const out = outward(p);
    // The midrib runs in the surface: round the mound, turned down by a draw.
    const round: V3 = normalize(cross(out, [0, 1, 0]));
    const down: V3 = normalize(cross(round, out));
    const turn = (rand() - 0.5) * 2.4;
    const hang = (down[1] > 0 ? -1 : 1) * (0.35 + 0.9 * rand());
    const dir: V3 = [
      round[0] * Math.cos(turn) + down[0] * hang,
      round[1] * Math.cos(turn) + down[1] * hang,
      round[2] * Math.cos(turn) + down[2] * hang,
    ];
    const inside = (depth - SHELL_INNER) / (1 - SHELL_INNER);
    leaf(p, dir, out, true, SHELL_INNER_SHADE + (1 - SHELL_INNER_SHADE) * inside);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}
