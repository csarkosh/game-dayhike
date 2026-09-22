import { clamp01, type Rgb } from "./colour.js";
import { latticeHash } from "./groundHexParams.js";
import { BLADE_CHARACTER_COUNT } from "./bladeField.js";

/**
 * The blade clumps: the meshes the blade field (bladeField.ts) draws, one per
 * character and distance tier, built here from a parameter table and a
 * lattice hash so they need no asset and every value can be retuned in one
 * place. Babylon-free: the shell (bladeMeshes.ts) wraps the arrays in
 * meshes, and the tests read them directly.
 *
 * A blade is a strip of BLADE_RINGS cross-sections plus one tip vertex, its
 * root on a disc of BLADE_CLUMP_RADIUS at y = 0 (the model convention: origin
 * at the base). It droops outward as a parabola, tapers to the tip, and
 * carries its face normal rolled to either side so it shades as a
 * half-cylinder. A character may add a tip feature: a seed head (one diamond
 * quad above the tip) or flower heads (a stem with a five-petal rosette).
 * One static vec4 per vertex, `blade`, names the root the blade collapses to,
 * the blade's random (its place in the hand-off order) and the vertex's
 * fraction of its own blade's height; a feature's vertices carry their
 * blade's root and random so they collapse with it.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

/** Cross-sections below the tip. */
export const BLADE_RINGS = 3;
export const BLADE_VERTS = BLADE_RINGS * 2 + 1;
export const BLADE_TRIS = (BLADE_RINGS - 1) * 2 + 1;
/** Roots lie on a disc of this radius (m); clumps on the 0.5 m lattice overlap a little. */
export const BLADE_CLUMP_RADIUS = 0.35;
/** The face normal is rolled this far (rad) about the blade's axis, one way per side. */
export const BLADE_ROUND = 0.3;
/** The material's base albedo, linear: a meadow green. */
export const BLADE_ALBEDO: Rgb = { r: 0.3, g: 0.4, b: 0.12 };
/** Vertex colour at the tip, from white at the root. */
export const BLADE_TIP_TINT: Rgb = { r: 0.95, g: 0.95, b: 0.75 };
/** Per-blade luminance spread: `1 + BLADE_LUMA · (random − 0.5)`. */
export const BLADE_LUMA = 0.3;
/** Width of one blade's shrink window in units of a hand-off ramp;
 * FOLIAGE_BLADE_SOFT in the GLSL. */
export const BLADE_SOFT = 0.15;
/** The high tier's whole field at full strength must stay under this many
 * vertices (a test computes it from the reach, the pad and the counts). */
export const BLADE_VERTEX_BUDGET = 1_400_000;

export type BladeTip = "none" | "seed" | "flower";

export type BladeCharacter = {
  name: string;
  /** Blade height (m) by the blade's random. */
  height: readonly [number, number];
  /** Half-width (m) at the root; the strip tapers linearly to the tip. */
  width: number;
  /** Outward lean (rad) applied as a parabola of the height fraction. */
  droop: readonly [number, number];
  /** Multiplies the vertex colour: the character's own cast. */
  tint: Rgb;
  tip: BladeTip;
  /** Flower-bearing only: how many heads a clump carries, by hash. */
  heads?: readonly [number, number];
};

/** Straw for seed heads. */
export const SEED_HEAD_TINT: Rgb = { r: 1.1, g: 1.0, b: 0.7 };
/** Flower-head colours, chosen by hash. */
export const FLOWER_PALETTE: readonly Rgb[] = [
  { r: 1.0, g: 1.0, b: 0.95 },
  { r: 1.0, g: 0.9, b: 0.3 },
  { r: 0.6, g: 0.45, b: 0.9 },
  { r: 0.9, g: 0.25, b: 0.2 },
];
/** Seed head: a diamond this long (m) along the blade's axis, half this wide. */
export const SEED_HEAD_SIZE = 0.03;
/** Flower head: the stem's half-width and the rosette's radius (m); the head sits this high (m). */
export const FLOWER_STEM_WIDTH = 0.003;
export const FLOWER_ROSETTE = 0.018;
export const FLOWER_HEIGHT: readonly [number, number] = [0.3, 0.45];

/** Indexed by the character ids of bladeField.ts (fine, tussock, weed, flower). */
export const BLADE_CHARACTERS: readonly BladeCharacter[] = [
  { name: "fine grass", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "none" },
  { name: "tussock", height: [0.35, 0.5], width: 0.008, droop: [0.2, 0.6], tint: { r: 1.05, g: 1.0, b: 0.85 }, tip: "seed" },
  { name: "broad-leaf weed", height: [0.15, 0.25], width: 0.03, droop: [0.6, 1.1], tint: { r: 0.8, g: 0.9, b: 1.0 }, tip: "none" },
  { name: "flower-bearing", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "flower", heads: [1, 3] },
];

export type BladeQuality = "high" | "medium";

/** Blades per clump, by quality tier, character and distance tier (fine, mid, coarse). */
export const BLADE_TIER_COUNTS: Record<BladeQuality, readonly (readonly [number, number, number])[]> = {
  high: [[100, 40, 16], [80, 28, 12], [12, 8, 4], [100, 32, 12]],
  medium: [[50, 20, 8], [40, 14, 6], [6, 4, 2], [50, 16, 6]],
};

export type BladeClumpGeometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  /** (rootX, rootZ, random, heightFraction) per vertex. */
  blade: Float32Array;
};

/** One of a blade's draws: the lattice hash on (blade index, salt). */
function draw(i: number, salt: number): number {
  return latticeHash(i, salt);
}

/** How many flower heads a flower-bearing clump carries: by the clump's own draw. */
function headCount(character: BladeCharacter): number {
  if (character.tip !== "flower" || character.heads === undefined) return 0;
  const [lo, hi] = character.heads;
  return lo + Math.floor(draw(7, 11) * (hi - lo + 1));
}

/** Vertices a clump of this character and blade count carries. */
export function bladeVertexCount(character: BladeCharacter, count: number): number {
  let n = count * BLADE_VERTS;
  if (character.tip === "seed") n += count * 4;
  if (character.tip === "flower") n += headCount(character) * (BLADE_VERTS + 20);
  return n;
}

export function bladeClumpGeometry(character: BladeCharacter, count: number): BladeClumpGeometry {
  const heads = headCount(character);
  const n = bladeVertexCount(character, count);
  const tris = count * BLADE_TRIS + (character.tip === "seed" ? count * 2 : 0) + heads * (2 * (BLADE_RINGS - 1) + 1 + 10);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const blade = new Float32Array(n * 4);
  const indices = new Uint16Array(tris * 3);
  let ii = 0;
  let v = 0;

  // Writes one vertex: position, a unit normal, the colour (tint × luma ×
  // the root-to-tip gradient, or a feature's own colour) and the record.
  const put = (
    px: number, py: number, pz: number, nx: number, ny: number, nz: number,
    r: number, g: number, b: number, rootX: number, rootZ: number, random: number, h: number,
  ): number => {
    positions[v * 3] = px; positions[v * 3 + 1] = py; positions[v * 3 + 2] = pz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / nl; normals[v * 3 + 1] = ny / nl; normals[v * 3 + 2] = nz / nl;
    colors[v * 4] = r; colors[v * 4 + 1] = g; colors[v * 4 + 2] = b; colors[v * 4 + 3] = 1;
    blade[v * 4] = rootX; blade[v * 4 + 1] = rootZ; blade[v * 4 + 2] = random; blade[v * 4 + 3] = h;
    return v++;
  };
  const tri = (a: number, b: number, c: number): void => { indices[ii++] = a; indices[ii++] = b; indices[ii++] = c; };

  // One strip: `rings` cross-sections of half-width `hw(h)` plus a tip, drooping
  // outward along (outX, outZ) by a parabola of the height fraction. Returns
  // the index of its first vertex.
  const strip = (
    rootX: number, rootZ: number, height: number, droop: number, hw: number,
    outX: number, outZ: number, yaw: number, random: number, tintR: number, tintG: number, tintB: number,
  ): number => {
    const wX = Math.cos(yaw), wZ = Math.sin(yaw);
    const nX = -wZ, nZ = wX;
    const first = v;
    const ring = (h: number, side: number): void => {
      const cx = rootX + outX * height * droop * h * h;
      const cy = height * h;
      const cz = rootZ + outZ * height * droop * h * h;
      const w = hw * (1 - h);
      const c = Math.cos(BLADE_ROUND * side), s = Math.sin(BLADE_ROUND * side);
      put(
        cx + wX * w * side, cy, cz + wZ * w * side,
        c * nX + s * wX, 0, c * nZ + s * wZ,
        tintR * (1 + (BLADE_TIP_TINT.r - 1) * h), tintG * (1 + (BLADE_TIP_TINT.g - 1) * h), tintB * (1 + (BLADE_TIP_TINT.b - 1) * h),
        rootX, rootZ, random, h,
      );
    };
    for (let k = 0; k < BLADE_RINGS; k++) { ring(k / BLADE_RINGS, -1); ring(k / BLADE_RINGS, 1); }
    ring(1, 0);
    for (let k = 0; k + 1 < BLADE_RINGS; k++) {
      const a = first + 2 * k;
      tri(a, a + 2, a + 1);
      tri(a + 1, a + 2, a + 3);
    }
    const last = first + 2 * (BLADE_RINGS - 1);
    tri(last, first + BLADE_VERTS - 1, last + 1);
    return first;
  };

  // Every blade's strip first, so the blades' vertices are contiguous from 0
  // (the tests index them as b · BLADE_VERTS); the tip features follow.
  const seedHeads: { first: number; height: number; droop: number; outX: number; outZ: number; yaw: number; rootX: number; rootZ: number; random: number }[] = [];
  for (let b = 0; b < count; b++) {
    const random = draw(b, 1);
    const rho = BLADE_CLUMP_RADIUS * Math.sqrt(draw(b, 2));
    const phi = 2 * Math.PI * draw(b, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const height = character.height[0] + (character.height[1] - character.height[0]) * draw(b, 4);
    const droop = character.droop[0] + (character.droop[1] - character.droop[0]) * draw(b, 5);
    const yaw = 2 * Math.PI * draw(b, 6);
    const outX = rho > 1e-6 ? Math.cos(phi) : Math.cos(yaw);
    const outZ = rho > 1e-6 ? Math.sin(phi) : Math.sin(yaw);
    const luma = 1 + BLADE_LUMA * (random - 0.5);
    const first = strip(rootX, rootZ, height, droop, character.width, outX, outZ, yaw,
      random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma);
    if (character.tip === "seed") seedHeads.push({ first, height, droop, outX, outZ, yaw, rootX, rootZ, random });
  }
  for (const s of seedHeads) {
    // A diamond in the blade's own plane, from the tip up along the droop's tangent.
    const tip = s.first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const ax = s.outX * s.height * s.droop * 2, ay = s.height, az = s.outZ * s.height * s.droop * 2;
    const al = Math.hypot(ax, ay, az);
    const ux = ax / al, uy = ay / al, uz = az / al;
    const wX = Math.cos(s.yaw), wZ = Math.sin(s.yaw);
    const size = SEED_HEAD_SIZE;
    const n0x = -wZ, n0z = wX;
    const c = SEED_HEAD_TINT;
    const p0 = put(tx, ty, tz, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p1 = put(tx + ux * size * 0.5 + wX * size * 0.5, ty + uy * size * 0.5, tz + uz * size * 0.5 + wZ * size * 0.5, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p2 = put(tx + ux * size * 0.5 - wX * size * 0.5, ty + uy * size * 0.5, tz + uz * size * 0.5 - wZ * size * 0.5, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p3 = put(tx + ux * size, ty + uy * size, tz + uz * size, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    tri(p0, p1, p2);
    tri(p1, p3, p2);
  }

  for (let f = 0; f < heads; f++) {
    // A head: a thin stem strip on its own root, then five petals around the
    // stem's tip, each a quad tilted outward, in one palette colour.
    const random = draw(100 + f, 1);
    const rho = BLADE_CLUMP_RADIUS * 0.8 * Math.sqrt(draw(100 + f, 2));
    const phi = 2 * Math.PI * draw(100 + f, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const height = FLOWER_HEIGHT[0] + (FLOWER_HEIGHT[1] - FLOWER_HEIGHT[0]) * draw(100 + f, 4);
    const yaw = 2 * Math.PI * draw(100 + f, 6);
    const stemTint = { r: 0.7, g: 0.9, b: 0.5 };
    const first = strip(rootX, rootZ, height, 0.15, FLOWER_STEM_WIDTH, Math.cos(phi), Math.sin(phi), yaw, random, stemTint.r, stemTint.g, stemTint.b);
    const tip = first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const colour = FLOWER_PALETTE[Math.floor(draw(100 + f, 9) * FLOWER_PALETTE.length) % FLOWER_PALETTE.length] as Rgb;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * 2 * Math.PI + yaw;
      const dx = Math.cos(a), dz = Math.sin(a);
      const r = FLOWER_ROSETTE;
      // A petal quad: from the head centre outward, tilted 30° down at the outer edge.
      const q0 = put(tx, ty, tz, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q1 = put(tx + dx * r * 0.5 - dz * r * 0.35, ty, tz + dz * r * 0.5 + dx * r * 0.35, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q2 = put(tx + dx * r, ty - r * 0.5, tz + dz * r, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q3 = put(tx + dx * r * 0.5 + dz * r * 0.35, ty, tz + dz * r * 0.5 - dx * r * 0.35, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      tri(q0, q1, q2);
      tri(q0, q2, q3);
    }
  }
  return { positions, normals, colors, indices, blade };
}

/** The second per-blade random the strength cut uses, derived from the root
 * so it is independent of the hand-off random. Mirrors bR2 in
 * foliageWorldPos.vertex.fx token for token; the roots stay under 0.35 m so
 * the products stay small enough for float32 to agree. */
export function bladeSecondRandom(rootX: number, rootZ: number): number {
  const v = rootX * 37.31 + rootZ * 91.17 + 0.37;
  return v - Math.floor(v);
}

/**
 * How much of a blade remains: `grow` (0 before the grow-in band, 1 past it)
 * admits blades from the low randoms up, `thin` (0 before the collapse band,
 * 1 past it) removes them from the low randoms up, each over a window
 * BLADE_SOFT wide, so an inner tier's survivors and an outer tier's arrivals
 * are complementary halves of one clump; `strength` cuts blades whose second
 * random exceeds it. Mirrors the collapse in foliageWorldPos.vertex.fx.
 */
export function bladeAlive(random: number, second: number, strength: number, grow: number, thin: number): number {
  const aliveIn = clamp01(((1 + BLADE_SOFT) * grow - random) / BLADE_SOFT);
  const aliveOut = clamp01((random - thin * (1 + BLADE_SOFT)) / BLADE_SOFT + 1);
  return aliveIn * aliveOut * (second < strength ? 1 : 0);
}

// A mismatch between the character table here and BLADE_CHARACTER_COUNT in
// bladeField.ts fails at the type level.
const _characterCount: typeof BLADE_CHARACTER_COUNT extends 4 ? true : never = true;
void _characterCount;
