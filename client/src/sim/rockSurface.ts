/**
 * The walkable rock's layer over the ground: what the simulation stands a
 * player on where the surface paints rock, and the one rule the patches
 * (`game/facePatches.ts`) draw their rock from, so the two are one surface
 * on a plate's top.
 *
 * The ground's rock between the forest's slope gate and the steep faces is
 * drawn as fractured plates pushed out of the height field along its normal
 * (`faceRelief.ts`, `groundReliefD`), up to GROUND_DEPTH at full loudness.
 * Collision stays on the height field for the faces, which are not walked;
 * for the walkable rock the player would stand a metre inside a drawn
 * plate, so the simulation adds the layer's height here: the drawn push's
 * walking twin (`groundWalkD`, the plates with wide joints and no shards),
 * masked and scaled exactly as the drawn one, as a vertical thickness. On a
 * plate's top the player's feet are on the drawn rock; within a joint's
 * ramp of a fracture they float or sink by the step; a shard's tip passes
 * through them.
 *
 * Everything here is a pure function of the seed and the point, so every
 * peer stands on the same surface; the loudness is read at the 16 m
 * lattice's corners and kept, a memo of a pure function, never a state.
 * The constants are ROCK_SURFACE_TUNABLES, declared by the elevation pass
 * into the level id. sim/ determinism rules apply: no trig, no Math.pow, no
 * `**`, no hypot.
 */
import { elevationSampleAt, type TerrainSample } from "./terrain.js";
import { trailDistance, type TrailGraph } from "./trail.js";
import { FACE_RELIEF_TUNABLES, FACE_SLOPE_HI, FACE_SLOPE_LO, groundWalkD, type ReliefSample } from "./faceRelief.js";
import { stepT } from "./lakeShape.js";
import { SLOPE_HI, SLOPE_LO } from "./vegetation.js";

// ---- Tunables (every one appears in ROCK_SURFACE_TUNABLES) ------------------
/** The most the walkable rock stands out along the ground's normal, metres,
 * at full loudness: a metre, for the look of fractured bedrock (0.4 and 0.5
 * read as a cobbled ground). */
export const GROUND_DEPTH = 1.0;
/** The radius (m) of the eight points about a lattice corner whose
 * rock-of-slope, with the corner's own, is the rock's extent there. */
export const GROUND_EXTENT_RADIUS = 6;
/** The extent across which the loudness rises from its floor to full. */
export const GROUND_LOUD_LO = 0.1;
export const GROUND_LOUD_HI = 0.5;
/** The loudness at no extent: the share of GROUND_DEPTH the smallest rock shows. */
export const GROUND_LOUD_FLOOR = 0.75;
/** The rock-of-slope some point of a patch cell must reach for the cell to
 * be patched for its rock: under it the push is a few centimetres at most. */
export const GROUND_ROCK_MIN = 0.1;
/** The most of the ground's radius of curvature the push may reach: the
 * whole of it, since a metre cannot gather a hollow's points past its
 * centre as the faces' 4 m can (the faces keep half, `PATCH_BEND_SHARE`). */
export const GROUND_BEND_SHARE = 1.0;
/** The world step (m) of the differences that give the ground's curvature:
 * the patches' finest grid's spacing. */
export const GROUND_CURVE_STEP = 0.5;
/** The lattice (m) the loudness is read on: the patches' cell. */
export const GROUND_LOUD_CELL = 16;
/** The arm (m) of the central differences of the ground's height that give
 * the slope the mask reads (`maskSlopeAt`): a slope smoothed over three
 * metres, so where the paint's threshold is crossed within a stride the
 * layer ramps in over that distance rather than standing up as a bank the
 * walk cannot take (the point's own gradient gave a bank of gradient 3 at
 * a rock band's edge). */
export const GROUND_MASK_STEP = 1.5;
/** The trail's clearance: no rock within GROUND_TRAIL_CLEAR_LO m of a trail's
 * centreline, the bed and a step beside it, the whole of it from
 * GROUND_TRAIL_CLEAR_HI, a quintic step between. The bed is walked at a
 * walk's limit, and a plate across it stopped the trail's own walks. */
export const GROUND_TRAIL_CLEAR_LO = 2;
export const GROUND_TRAIL_CLEAR_HI = 5;
/** The arm (m) of the central differences that give the layer's gradient:
 * the rise's own, mask, loudness, depth cap and thickness included, since
 * the mask ramps the layer up within a metre at a rock patch's edge and the
 * twin's derivative alone would under-report the slope there. */
export const GROUND_SLOPE_STEP = 0.05;

/** These, and the ground relief's own (the `GROUND_` constants of
 * `faceRelief.ts`, the plates' and the walking twin's), which shape the
 * surface the player stands on; the faces' constants are not here, since
 * the faces are not walked. */
export const ROCK_SURFACE_TUNABLES: Readonly<Record<string, number>> = {
  GROUND_DEPTH, GROUND_EXTENT_RADIUS, GROUND_LOUD_LO, GROUND_LOUD_HI, GROUND_LOUD_FLOOR,
  GROUND_ROCK_MIN, GROUND_BEND_SHARE, GROUND_CURVE_STEP, GROUND_LOUD_CELL, GROUND_SLOPE_STEP, GROUND_MASK_STEP,
  GROUND_TRAIL_CLEAR_LO, GROUND_TRAIL_CLEAR_HI,
  ...Object.fromEntries(Object.entries(FACE_RELIEF_TUNABLES).filter(([k]) => k.startsWith("GROUND_"))),
};

/** The share of the faces' relief at a ground gradient `g`: 0 below
 * FACE_SLOPE_LO, 1 from FACE_SLOPE_HI, a quintic step between. */
export function faceMask(g: number): number {
  return stepT((g - FACE_SLOPE_LO) / (FACE_SLOPE_HI - FACE_SLOPE_LO));
}

/** The rock paint's share of the ground at gradient `g` by the slope alone:
 * the surface's own rule (`game/terrainSurface.ts`, `classifySurface`), 0
 * below the forest's SLOPE_LO and 1 from SLOPE_HI, a smoothstep between,
 * without the water's or the snow's say over it. */
export function rockOfSlope(g: number): number {
  const t = g <= SLOPE_LO ? 0 : g >= SLOPE_HI ? 1 : (g - SLOPE_LO) / (SLOPE_HI - SLOPE_LO);
  return t * t * (3 - 2 * t);
}

/** The eight points about a corner, GROUND_EXTENT_RADIUS out: the compass
 * points and the diagonals. */
const EXTENT_RING: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * The rock's extent about (x, z), 0 to 1: the mean rock-of-slope at the
 * point and at the eight points GROUND_EXTENT_RADIUS out. A function of the
 * world point alone, read at a cell's corners, which its neighbours share,
 * so the loudness interpolated across a cell meets the next cell's without
 * a step.
 */
export function rockExtent(seed: number, x: number, z: number): number {
  const at = elevationSampleAt(seed, x, z);
  let sum = rockOfSlope(Math.sqrt(at.dx * at.dx + at.dz * at.dz));
  for (const [ux, uz] of EXTENT_RING) {
    const s = elevationSampleAt(seed, x + ux * GROUND_EXTENT_RADIUS, z + uz * GROUND_EXTENT_RADIUS);
    sum += rockOfSlope(Math.sqrt(s.dx * s.dx + s.dz * s.dz));
  }
  return sum / (1 + EXTENT_RING.length);
}

/** The walkable rock's loudness at an extent `e`: GROUND_LOUD_FLOOR at none,
 * rising by a quintic step over GROUND_LOUD_LO to GROUND_LOUD_HI to 1. */
export function groundLoudness(e: number): number {
  return GROUND_LOUD_FLOOR + (1 - GROUND_LOUD_FLOOR) * stepT((e - GROUND_LOUD_LO) / (GROUND_LOUD_HI - GROUND_LOUD_LO));
}

// The loudness at the lattice's corners, kept once read: a memo of a pure
// function of the seed and the corner, which every caller reads alike.
const loudMemo = new Map<number, number>();
let loudMemoSeed = Number.NaN;

/** The loudness at lattice corner (ci, cj) of the seed, read once. */
export function cornerLoudness(seed: number, ci: number, cj: number): number {
  if (seed !== loudMemoSeed) {
    loudMemo.clear();
    loudMemoSeed = seed;
  }
  const key = ci * 65536 + cj;
  const kept = loudMemo.get(key);
  if (kept !== undefined) return kept;
  const l = groundLoudness(rockExtent(seed, ci * GROUND_LOUD_CELL, cj * GROUND_LOUD_CELL));
  loudMemo.set(key, l);
  return l;
}

/** The loudness at (x, z): the corners' of its lattice cell, interpolated
 * across it, so the same doubles in a cell wherever it is read from. */
export function loudnessAt(seed: number, x: number, z: number): number {
  const ci = Math.floor(x / GROUND_LOUD_CELL);
  const cj = Math.floor(z / GROUND_LOUD_CELL);
  const fx = x / GROUND_LOUD_CELL - ci;
  const fz = z / GROUND_LOUD_CELL - cj;
  const l00 = cornerLoudness(seed, ci, cj);
  const l10 = cornerLoudness(seed, ci + 1, cj);
  const l01 = cornerLoudness(seed, ci, cj + 1);
  const l11 = cornerLoudness(seed, ci + 1, cj + 1);
  return (l00 * (1 - fx) + l10 * fx) * (1 - fz) + (l01 * (1 - fx) + l11 * fx) * fz;
}

/** The ground's sharper principal curvature at (x, z), per metre, from its
 * second derivatives (h_xx, h_zz, h_xz) and gradient: the larger magnitude of
 * λ / sqrt(1 + g²) over the roots λ of det(H − λ A) = 0, A = I + ∇h ∇hᵀ. */
function bendOf(s: TerrainSample, hxx: number, hzz: number, hxz: number): number {
  const a = 1 + s.dx * s.dx + s.dz * s.dz;
  const b = hxx * (1 + s.dz * s.dz) + hzz * (1 + s.dx * s.dx) - 2 * hxz * s.dx * s.dz;
  const c = hxx * hzz - hxz * hxz;
  const disc = b * b - 4 * a * c;
  const root = Math.sqrt(disc > 0 ? disc : 0);
  return (Math.abs(b) + root) / (2 * a * Math.sqrt(a));
}

/** `groundBend` from the ground at the point and GROUND_CURVE_STEP on and
 * back in x and in z, sampled already. */
export function bendFrom(
  s: TerrainSample, xp: TerrainSample, xm: TerrainSample, zp: TerrainSample, zm: TerrainSample,
): number {
  const e = GROUND_CURVE_STEP;
  const on = bendOf(s, (xp.dx - s.dx) / e, (zp.dz - s.dz) / e, (xp.dz - s.dz + (zp.dx - s.dx)) / (2 * e));
  const back = bendOf(s, (s.dx - xm.dx) / e, (s.dz - zm.dz) / e, (s.dz - xm.dz + (s.dx - zm.dx)) / (2 * e));
  return on > back ? on : back;
}

/**
 * How sharply the ground bends at (x, z), per metre: the larger principal
 * curvature in magnitude, concave or convex, of the ground's Hessian taken
 * by one-sided differences of its gradient GROUND_CURVE_STEP on in x and z,
 * and again GROUND_CURVE_STEP back, the larger of the two. A fixed world
 * step, so a point bends alike wherever it is read from.
 */
export function groundBend(seed: number, x: number, z: number, s: TerrainSample): number {
  const e = GROUND_CURVE_STEP;
  return bendFrom(
    s,
    elevationSampleAt(seed, x + e, z),
    elevationSampleAt(seed, x - e, z),
    elevationSampleAt(seed, x, z + e),
    elevationSampleAt(seed, x, z - e),
  );
}

/** A relief's whole range at a point whose ground bends by `bend` per
 * metre: `depth / (1 + depth · bend / share)`, the full depth on even ground
 * and, where it bends, always under `share` of the bend's radius. */
export function depthUnderBend(depth: number, bend: number, share: number): number {
  return depth / (1 + (depth * bend) / share);
}

/** The slope the mask reads at (x, z): the ground's gradient by central
 * differences of its height GROUND_MASK_STEP either way, a slope smoothed
 * over three metres, so the layer's edge is a ramp. */
export function maskSlopeAt(seed: number, x: number, z: number): number {
  const e = GROUND_MASK_STEP;
  const gx = (elevationSampleAt(seed, x + e, z).h - elevationSampleAt(seed, x - e, z).h) / (2 * e);
  const gz = (elevationSampleAt(seed, x, z + e).h - elevationSampleAt(seed, x, z - e).h) / (2 * e);
  return Math.sqrt(gx * gx + gz * gz);
}

/** The trail's clearance at (x, z): 0 on the bed and a step beside it, 1
 * from GROUND_TRAIL_CLEAR_HI out, by the distance to the nearest edge of
 * the graph; 1 everywhere without a graph. */
export function trailClearAt(trail: TrailGraph | null, x: number, z: number): number {
  if (trail === null) return 1;
  const d = trailDistance(trail, x, z);
  return stepT((d - GROUND_TRAIL_CLEAR_LO) / (GROUND_TRAIL_CLEAR_HI - GROUND_TRAIL_CLEAR_LO));
}

/** The walkable rock's mask at a mask slope `g` and loudness: the rock
 * paint's share where the faces' leaves off, at the loudness. */
export function rockMask(g: number, loud: number): number {
  return rockOfSlope(g) * (1 - faceMask(g)) * loud;
}

/** The rock paint's share at (x, z) by the smoothed slope: the mask before
 * the faces' and the loudness, what the patches and the layer read. */
export function rockPaintAt(seed: number, x: number, z: number): number {
  return rockOfSlope(maskSlopeAt(seed, x, z));
}

/** The layer at a point: its vertical thickness (m) over the ground, and
 * the thickness's gradient. */
export type RockLayer = { rise: number; dx: number; dz: number };

export const NO_ROCK: RockLayer = Object.freeze({ rise: 0, dx: 0, dz: 0 });

/**
 * The layer's vertical thickness at (x, z) over the ground sample `s`
 * there: the walking twin's push `mask · depth · (v + 1) / 2` along the
 * ground's unit normal, as the drawn rock's is on a plate's top, read as a
 * thickness `d · sqrt(1 + g²)`; the mask by the smoothed slope
 * (`maskSlopeAt`), off the trail's bed (`trailClearAt`). Nothing, exactly,
 * where the surface paints no rock or the trail runs.
 */
export function rockRiseAt(seed: number, x: number, z: number, s: TerrainSample, trail: TrailGraph | null = null): number {
  const g2 = s.dx * s.dx + s.dz * s.dz;
  const gm = maskSlopeAt(seed, x, z);
  const paint = rockOfSlope(gm);
  if (paint === 0) return 0;
  const clear = trailClearAt(trail, x, z);
  if (clear === 0) return 0;
  const mask = paint * (1 - faceMask(gm)) * loudnessAt(seed, x, z) * clear;
  if (mask === 0) return 0;
  const depth = depthUnderBend(GROUND_DEPTH, groundBend(seed, x, z, s), GROUND_BEND_SHARE);
  const r: ReliefSample = groundWalkD(seed, x, z);
  return (mask * depth * Math.sqrt(1 + g2) * (r.v + 1)) / 2;
}

/**
 * The walkable rock's layer at (x, z) over the ground sample `s` there: its
 * thickness (`rockRiseAt`) and the thickness's gradient by central
 * differences GROUND_SLOPE_STEP either way, the mask's, the loudness's and
 * the depth cap's changes included. Nothing, exactly, where the surface
 * paints no rock; and where it does, the gradient is read even if the rise
 * at the point itself is nothing, since the layer may rise a step on.
 */
export function rockLayerAt(seed: number, x: number, z: number, s: TerrainSample, trail: TrailGraph | null = null): RockLayer {
  const rise = rockRiseAt(seed, x, z, s, trail);
  if (rise === 0 && (rockPaintAt(seed, x, z) === 0 || trailClearAt(trail, x, z) === 0)) return NO_ROCK;
  const e = GROUND_SLOPE_STEP;
  const xp = rockRiseAt(seed, x + e, z, elevationSampleAt(seed, x + e, z), trail);
  const xm = rockRiseAt(seed, x - e, z, elevationSampleAt(seed, x - e, z), trail);
  const zp = rockRiseAt(seed, x, z + e, elevationSampleAt(seed, x, z + e), trail);
  const zm = rockRiseAt(seed, x, z - e, elevationSampleAt(seed, x, z - e), trail);
  const dx = (xp - xm) / (2 * e);
  const dz = (zp - zm) / (2 * e);
  if (rise === 0 && dx === 0 && dz === 0) return NO_ROCK;
  return { rise, dx, dz };
}
