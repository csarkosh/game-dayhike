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
 * half-cylinder. A character may add a tip feature, built from the same
 * strip so it shades like a blade rather than a flat card: a seed head (a
 * second, shorter strip continuing from the tip) or flower heads (a stem
 * strip with five petal strips fanned from its tip).
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
/** The material's base albedo, linear: a meadow green. The blades sit near
 * the top of the tone curve, so this value is far below what the colour
 * looks like on screen — halving it moves the rendered colour only about
 * 12%. Tuned by comparing the near field's mean colour against the far
 * field's in the same frame, not by eye against a swatch, and with the sun
 * pinned: the world clock keeps running, so two stills minutes apart are lit
 * differently and cannot be compared. Driving this lower does keep closing
 * the near/far gap, but only because the blades darken until the ground
 * between them is what the frame measures. */
export const BLADE_ALBEDO: Rgb = { r: 0.03, g: 0.04, b: 0.013 };
/** Vertex colour at the tip, from white at the root. */
export const BLADE_TIP_TINT: Rgb = { r: 0.95, g: 0.95, b: 0.75 };
/** Per-blade luminance spread: `1 + BLADE_LUMA · (random − 0.5)`. */
export const BLADE_LUMA = 0.3;
/** Width of one blade's shrink window in units of a hand-off ramp;
 * FOLIAGE_BLADE_SOFT in the GLSL. */
export const BLADE_SOFT = 0.15;
/** The high tier's whole field, every cell at BLADE_SIZE_FULL, must stay
 * under this many vertices (a test computes it from the reach, the pad and
 * the counts) — the budget covers the field's worst case, not its typical
 * one; the real bar is a frame-time measurement. */
export const BLADE_VERTEX_BUDGET = 1_600_000;

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
/** Seed head: the continuing strip's length (m), from the blade's own tip. */
export const SEED_HEAD_SIZE = 0.06;
/** Seed head: the strip's base half-width, as a multiple of the blade's own
 * half-width. Every strip vertex carries a normal lying flat in the
 * horizontal plane, and the fragment only tilts a normal toward up near the
 * root, so geometry high on a blade meets an overhead sun edge-on. A blade
 * survives that by being a sliver; a head wider than it is long does not —
 * at 2.5 the head was a squat face that crushed to black against the sward.
 * Keeping it near the blade's own width makes it a slender continuation,
 * which is what a seed head is meant to read as. */
export const SEED_HEAD_WIDTH = 1.2;
/** Flower head: the stem's half-width (m) and the rosette's reach (m), which scales
 * each petal strip's length and base width; the head sits this high (m). */
export const FLOWER_STEM_WIDTH = 0.003;
export const FLOWER_ROSETTE = 0.018;
export const FLOWER_HEIGHT: readonly [number, number] = [0.3, 0.45];

/** Indexed by the character ids of bladeField.ts (fine, tussock, weed, flower). */
export const BLADE_CHARACTERS: readonly BladeCharacter[] = [
  { name: "fine grass", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "none" },
  { name: "tussock", height: [0.35, 0.5], width: 0.008, droop: [0.2, 0.6], tint: { r: 1.05, g: 1.0, b: 0.85 }, tip: "none" },
  { name: "broad-leaf weed", height: [0.15, 0.25], width: 0.03, droop: [0.6, 1.1], tint: { r: 0.8, g: 0.9, b: 1.0 }, tip: "none" },
  { name: "flower-bearing", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "flower", heads: [1, 3] },
];

export type BladeQuality = "high" | "medium";

/** Blades per clump at BLADE_SIZE_BASE, by quality tier, character and
 * distance tier (fine, mid, coarse). A cell's actual count also scales by
 * its `size` through `BLADE_SIZE_FACTOR` (`bladeCountFor`). */
export const BLADE_TIER_COUNTS: Record<BladeQuality, readonly (readonly [number, number, number])[]> = {
  high: [[100, 40, 10], [80, 28, 8], [12, 8, 4], [100, 32, 8]],
  medium: [[50, 20, 5], [40, 14, 4], [6, 4, 2], [50, 16, 4]],
};
/** Blades per clump as a multiple of the tier's count, by size (thin, base, full). */
export const BLADE_SIZE_FACTOR: readonly [number, number, number] = [0.4, 1, 1.5];
/** A clump never carries fewer than this many blades. */
export const BLADE_COUNT_MIN = 4;
/** Blades a cell's clump carries: the tier's base count for its character,
 * scaled by its size and floored at `BLADE_COUNT_MIN` so even a thin,
 * coarse-tier clump reads as something rather than a stray blade or two. */
export function bladeCountFor(quality: BladeQuality, character: number, tier: number, size: number): number {
  const base = BLADE_TIER_COUNTS[quality][character]![tier]!;
  return Math.max(BLADE_COUNT_MIN, Math.round(base * (BLADE_SIZE_FACTOR[size] as number)));
}

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

/** Vertices a clump of this character and blade count carries. A seed head
 * is one more strip (BLADE_VERTS); a flower head is a stem strip plus five
 * petal strips, six strips of BLADE_VERTS each. */
export function bladeVertexCount(character: BladeCharacter, count: number): number {
  let n = count * BLADE_VERTS;
  if (character.tip === "seed") n += count * BLADE_VERTS;
  if (character.tip === "flower") n += headCount(character) * 6 * BLADE_VERTS;
  return n;
}

export function bladeClumpGeometry(character: BladeCharacter, count: number): BladeClumpGeometry {
  const heads = headCount(character);
  const n = bladeVertexCount(character, count);
  // Matches bladeVertexCount: a seed head is one more strip's worth of
  // triangles, a flower head is six strips' worth (the stem plus five petals).
  const tris = count * BLADE_TRIS + (character.tip === "seed" ? count * BLADE_TRIS : 0) + heads * 6 * BLADE_TRIS;
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

  // One strip: `rings` cross-sections of half-width `hw(h)` plus a tip, rising
  // from (baseX, baseY, baseZ) by `height` and drooping outward along (outX,
  // outZ) by a parabola of the height fraction — the bend uses |height| so a
  // strip that dips (a negative height, for a petal curling down) still
  // bends outward rather than back on itself. A tip feature's strip starts
  // its own base past its parent's tip but still names the parent's root and
  // random in `blade`, via (rootX, rootZ), so it collapses with its blade.
  // Returns the index of its first vertex.
  const strip = (
    baseX: number, baseY: number, baseZ: number, height: number, droop: number, hw: number,
    outX: number, outZ: number, yaw: number, random: number, tintR: number, tintG: number, tintB: number,
    rootX: number, rootZ: number,
  ): number => {
    const wX = Math.cos(yaw), wZ = Math.sin(yaw);
    const nX = -wZ, nZ = wX;
    const first = v;
    const ring = (h: number, side: number): void => {
      const bend = Math.abs(height) * droop * h * h;
      const cx = baseX + outX * bend;
      const cy = baseY + height * h;
      const cz = baseZ + outZ * bend;
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
  const seedHeads: { first: number; droop: number; outX: number; outZ: number; yaw: number; rootX: number; rootZ: number; random: number }[] = [];
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
    const first = strip(rootX, 0, rootZ, height, droop, character.width, outX, outZ, yaw,
      random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
    if (character.tip === "seed") seedHeads.push({ first, droop, outX, outZ, yaw, rootX, rootZ, random });
  }
  for (const s of seedHeads) {
    // A second, shorter strip continuing from the blade's tip: the same
    // droop and lean the blade itself just used, so it reads as the blade
    // thickening into a head rather than a card stuck on top.
    const tip = s.first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const c = SEED_HEAD_TINT;
    strip(tx, ty, tz, SEED_HEAD_SIZE, s.droop, character.width * SEED_HEAD_WIDTH, s.outX, s.outZ, s.yaw,
      s.random, c.r, c.g, c.b, s.rootX, s.rootZ);
  }

  for (let f = 0; f < heads; f++) {
    // A head: a thin stem strip on its own root, then five short, wide petal
    // strips fanned from the stem's tip, each with its own small droop so it
    // curls outward and down, in one palette colour.
    const random = draw(100 + f, 1);
    const rho = BLADE_CLUMP_RADIUS * 0.8 * Math.sqrt(draw(100 + f, 2));
    const phi = 2 * Math.PI * draw(100 + f, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const height = FLOWER_HEIGHT[0] + (FLOWER_HEIGHT[1] - FLOWER_HEIGHT[0]) * draw(100 + f, 4);
    const yaw = 2 * Math.PI * draw(100 + f, 6);
    const stemTint = { r: 0.7, g: 0.9, b: 0.5 };
    const first = strip(rootX, 0, rootZ, height, 0.15, FLOWER_STEM_WIDTH, Math.cos(phi), Math.sin(phi), yaw,
      random, stemTint.r, stemTint.g, stemTint.b, rootX, rootZ);
    const tip = first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const colour = FLOWER_PALETTE[Math.floor(draw(100 + f, 9) * FLOWER_PALETTE.length) % FLOWER_PALETTE.length] as Rgb;
    // Negative so each petal dips below the stem's tip as it reaches out.
    const petalLength = -FLOWER_ROSETTE * 0.7;
    const petalDroop = 1.2;
    const petalWidth = FLOWER_ROSETTE * 0.5;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * 2 * Math.PI + yaw;
      strip(tx, ty, tz, petalLength, petalDroop, petalWidth, Math.cos(a), Math.sin(a), a,
        random, colour.r, colour.g, colour.b, rootX, rootZ);
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
