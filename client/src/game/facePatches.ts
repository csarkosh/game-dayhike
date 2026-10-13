/**
 * Patches of finer rock over the steep ground and the walkable rock. The
 * world is divided into `PATCH_CELL` metre cells on its own lattice; a cell
 * with steep or rock-painted ground in reach gets a patch: a finer grid of
 * the same ground, each vertex pushed out along the ground's normal by the
 * rock relief (`sim/faceRelief.ts`): the faces' relief, masked by the
 * ground's gradient so the push is nothing where the ground is not steep,
 * and (since 2026-10-13) the walkable rock's relief, masked by the ground's
 * rock paint where the faces' mask leaves off, shallow enough to walk over
 * with collision on the smooth ground, and louder the wider the rock about
 * the cell (`rockExtent`, `groundLoudness`); both faded out toward the cells
 * outside the patched set. The patch is painted as the clipmap paints the
 * ground under it, so it is the same rock in the same light. The ground's height is not changed; the clipmap
 * leaves out its triangles under fully steep ground well inside the reach
 * (`facePatchCover`), where a patch is drawn over them.
 *
 * Pure and Babylon-free; `facePatchMeshes.ts` is the shell that uploads it.
 *
 * Directions: west is −x, east +x, south −z, north +z. A cell (ci, cj)
 * covers [ci·16, (ci+1)·16] × [cj·16, (cj+1)·16].
 */
import { groundCover } from "../sim/clutter.js";
import { FACE_HALF_DEPTH, FACE_SLOPE_HI, FACE_SLOPE_LO, faceReliefD, groundReliefD } from "../sim/faceRelief.js";
import { stepT, stepTd } from "../sim/lakeShape.js";
import { elevationSampleAt, type TerrainSample } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { WEIGHTS2_STRIDE, type CoveredGround } from "./clipmap.js";
import type { QualityTier } from "./quality.js";
import { classifySurface, GRASS_SLOPE, ROCK_SLOPE } from "./terrainSurface.js";
import { waterGroundAt } from "./waterGround.js";

/** A patch cell's side, metres, on the world's lattice. */
export const PATCH_CELL = 16;
/** The most a patch vertex moves out along the ground's normal, metres: the
 * relief's half-depth doubled, its whole range from the smooth face out. */
export const PATCH_DEPTH = 2 * FACE_HALF_DEPTH;
/** The most a vertex of the walkable rock moves out along the ground's
 * normal, metres, at full loudness: shallow, since the ground is walked on
 * with collision on the smooth height field, so a foot is never further
 * inside the drawn rock than this, and on average half of it. */
export const GROUND_DEPTH = 0.4;
/** The radius (m) of the eight points about a corner whose rock-of-slope,
 * with the corner's own, is the rock's extent there (`rockExtent`). */
export const GROUND_EXTENT_RADIUS = 6;
/** The extent across which the walkable rock's loudness rises from its floor
 * to full: a lone outcrop in grass stays low, a rocky hillside is whole. */
export const GROUND_LOUD_LO = 0.1;
export const GROUND_LOUD_HI = 0.5;
/** The loudness at no extent: the share of GROUND_DEPTH the smallest rock shows. */
export const GROUND_LOUD_FLOOR = 0.75;
/** The rock-of-slope some point of a cell must reach for the cell to be
 * patched for its rock: under it the push is a few centimetres at most. */
export const GROUND_ROCK_MIN = 0.1;
/** Vertex spacing (m) of the cells within the near reach. */
export const PATCH_NEAR_SPACING = 0.5;
/** Vertex spacing (m) of the cells beyond it, within the far reach. */
export const PATCH_FAR_SPACING = 1;
/** Vertex spacing (m) of the cells beyond that, within the wide reach. */
export const PATCH_WIDE_SPACING = 2;
/** The distance (m) over which the relief fades to nothing toward a cell
 * outside the patched set, so a patch never ends with its relief in the air. */
export const PATCH_TAPER = 3;
/** The world step (m) of the differences that give the ground's curvature:
 * the finest grid's spacing. */
export const PATCH_CURVE_STEP = 0.5;
/** The most of the ground's radius of curvature the push may reach. */
export const PATCH_BEND_SHARE = 0.5;
/** And the walkable rock's: the whole radius, since its 0.4 m cannot gather
 * a hollow's points past its centre as the faces' 4 m can, and the lowland
 * outcrops it has to show are humps a few metres wide, tight enough that
 * half the radius took half their relief. */
export const GROUND_BEND_SHARE = 1.0;

export type PatchReach = { readonly near: number; readonly far: number; readonly wide: number };

/** Per tier: the camera's distance (m) to a cell's centre within which the
 * cell is at the near spacing (`near`), at the far spacing (`far`), and
 * patched at all, at the wide spacing beyond `far` (`wide`). */
export const PATCH_REACH: Readonly<Record<QualityTier, PatchReach>> = {
  high: { near: 48, far: 160, wide: 400 },
  medium: { near: 36, far: 120, wide: 300 },
  low: { near: 24, far: 80, wide: 200 },
};

export type PatchCell = { ci: number; cj: number; spacing: number };

/** A cell's eight neighbours as (di, dj): the four sides, then the four
 * corners. Bit k of a stitch's `open` is neighbour k. */
export const PATCH_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** The bits of `PatchStitch.open`, one a neighbour, in `PATCH_NEIGHBOURS`' order. */
export const OPEN_WEST = 1;
export const OPEN_EAST = 2;
export const OPEN_SOUTH = 4;
export const OPEN_NORTH = 8;
export const OPEN_SOUTH_WEST = 16;
export const OPEN_SOUTH_EAST = 32;
export const OPEN_NORTH_WEST = 64;
export const OPEN_NORTH_EAST = 128;

/** Which edges of a fine cell meet a coarse cell, whose midpoints are then
 * laid on the coarse edge; and `open`, which of the cell's eight neighbours
 * are outside the patched set, toward which the relief fades out. */
export type PatchStitch = {
  readonly west: boolean;
  readonly east: boolean;
  readonly north: boolean;
  readonly south: boolean;
  readonly open: number;
};

export const NO_STITCH: PatchStitch = { west: false, east: false, north: false, south: false, open: 0 };

export type FacePatch = {
  /** World-space positions, three a vertex. */
  positions: Float32Array;
  /** Unit normals of the displaced surface, three a vertex. */
  normals: Float32Array;
  /** RGBA a vertex: classifySurface's albedo, alpha 1. */
  colors: Float32Array;
  /** (grass, forestFloor, rock, sand) a vertex, as the clipmap's `weights`. */
  weights: Float32Array;
  /** (pebble, detail, duff, canopy) a vertex, as the clipmap's `weights2`. */
  weights2: Float32Array;
  /** min(1, grass cover) a vertex, as the clipmap's `cover`. */
  cover: Float32Array;
  /** 16-bit: the finest patch has 33² = 1089 vertices. */
  indices: Uint16Array;
  vertexCount: number;
  triangleCount: number;
};

/** One number per cell, for maps: unique for |ci|, |cj| < 32768. */
export function patchKey(ci: number, cj: number): number {
  return ci * 65536 + cj;
}

/** The share of the relief at a ground gradient `g`: 0 below FACE_SLOPE_LO,
 * 1 from FACE_SLOPE_HI, a quintic step between. */
export function faceMask(g: number): number {
  return stepT((g - FACE_SLOPE_LO) / (FACE_SLOPE_HI - FACE_SLOPE_LO));
}

/** The rock paint's share of the ground at gradient `g` by the slope alone:
 * the surface's own rule (`classifySurface`), 0 below GRASS_SLOPE and 1 from
 * ROCK_SLOPE, without the water's or the snow's say over it. */
export function rockOfSlope(g: number): number {
  const t = g <= GRASS_SLOPE ? 0 : g >= ROCK_SLOPE ? 1 : (g - GRASS_SLOPE) / (ROCK_SLOPE - GRASS_SLOPE);
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

// The taper's gradient, written by `taperInto` beside the share it returns.
let taperDx = 0;
let taperDz = 0;

/** The taper at (x, z) as `patchTaper` gives it, its gradient into
 * taperDx/taperDz: the step's slope along the way out of the nearest open
 * square, nothing where the share is whole or on the square itself. */
function taperInto(ci: number, cj: number, open: number, x: number, z: number): number {
  taperDx = 0;
  taperDz = 0;
  if (open === 0) return 1;
  let near = PATCH_TAPER;
  let nearX = 0;
  let nearZ = 0;
  for (let k = 0; k < PATCH_NEIGHBOURS.length; k++) {
    if ((open & (1 << k)) === 0) continue;
    const [di, dj] = PATCH_NEIGHBOURS[k] as readonly [number, number];
    const lx = (ci + di) * PATCH_CELL;
    const lz = (cj + dj) * PATCH_CELL;
    // The offset from the square's nearest point to (x, z), signed.
    const ex = x < lx ? x - lx : x > lx + PATCH_CELL ? x - (lx + PATCH_CELL) : 0;
    const ez = z < lz ? z - lz : z > lz + PATCH_CELL ? z - (lz + PATCH_CELL) : 0;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < near) {
      near = d;
      nearX = ex;
      nearZ = ez;
    }
  }
  if (near >= PATCH_TAPER) return 1;
  if (near > 0) {
    // ∂near/∂(x, z) is the unit offset away from the square.
    const slope = stepTd(near / PATCH_TAPER) / (PATCH_TAPER * near);
    taperDx = slope * nearX;
    taperDz = slope * nearZ;
  }
  return stepT(near / PATCH_TAPER);
}

/**
 * The relief's share at (x, z), a point of cell (ci, cj), toward the
 * neighbours `open` flags: a quintic step of the distance from the point to
 * the nearest of their squares, 0 on it and 1 from PATCH_TAPER in. Every
 * square outside the set within PATCH_TAPER of a point of the cell is one of
 * its eight neighbours, so two patches that share a point find the same
 * squares and taper it alike, bit for bit.
 */
export function patchTaper(ci: number, cj: number, open: number, x: number, z: number): number {
  return taperInto(ci, cj, open, x, z);
}

/** The ground's sharper principal curvature at (x, z), per metre, from its
 * second derivatives (h_xx, h_zz, h_xz) and gradient: the larger magnitude of
 * λ / sqrt(1 + g²) over the roots λ of det(H − λ A) = 0, A = I + ∇h ∇hᵀ. */
function bendOf(s: TerrainSample, hxx: number, hzz: number, hxz: number): number {
  const a = 1 + s.dx * s.dx + s.dz * s.dz;
  // det(H − λA) = a λ² − b λ + c, with det(A) = 1 + g².
  const b = hxx * (1 + s.dz * s.dz) + hzz * (1 + s.dx * s.dx) - 2 * hxz * s.dx * s.dz;
  const c = hxx * hzz - hxz * hxz;
  const disc = b * b - 4 * a * c;
  const root = Math.sqrt(disc > 0 ? disc : 0);
  return (Math.abs(b) + root) / (2 * a * Math.sqrt(a));
}

/**
 * How sharply the ground bends at (x, z), per metre: the larger principal
 * curvature in magnitude, concave or convex, of the ground's Hessian taken
 * by one-sided differences of its gradient PATCH_CURVE_STEP on in x and z,
 * and again PATCH_CURVE_STEP back, the larger of the two. The ground has
 * creases narrower than a grid step; a one-sided difference sees a crease
 * that lies on either side of the point, where a central one can step over
 * it. A fixed world step, not the grid's, so a point bends alike in every
 * patch that holds it.
 */
export function groundBend(seed: number, x: number, z: number, s: TerrainSample): number {
  const e = PATCH_CURVE_STEP;
  return bendFrom(
    s,
    elevationSampleAt(seed, x + e, z),
    elevationSampleAt(seed, x - e, z),
    elevationSampleAt(seed, x, z + e),
    elevationSampleAt(seed, x, z - e),
  );
}

/** `groundBend` from the ground at the point and PATCH_CURVE_STEP on and
 * back in x and in z, sampled already. */
function bendFrom(
  s: TerrainSample, xp: TerrainSample, xm: TerrainSample, zp: TerrainSample, zm: TerrainSample,
): number {
  const e = PATCH_CURVE_STEP;
  const on = bendOf(
    s, (xp.dx - s.dx) / e, (zp.dz - s.dz) / e, (xp.dz - s.dz + (zp.dx - s.dx)) / (2 * e),
  );
  const back = bendOf(
    s, (s.dx - xm.dx) / e, (s.dz - zm.dz) / e, (s.dz - xm.dz + (s.dx - zm.dx)) / (2 * e),
  );
  return on > back ? on : back;
}

/**
 * The relief's whole range at a point whose ground bends by `bend` per
 * metre: PATCH_DEPTH / (1 + PATCH_DEPTH · bend / PATCH_BEND_SHARE), the full
 * depth on even ground and, where it bends, always under PATCH_BEND_SHARE of
 * the bend's radius. Pushed out to the radius of a hollow, neighbouring
 * points would meet at its centre and the surface fold over; on a sharp
 * crest the mask, nothing on the crest and whole a step down its flanks,
 * would notch it. Smooth in the bend, so the depth has no step of its own.
 */
export function patchDepth(bend: number, depth = PATCH_DEPTH, share = PATCH_BEND_SHARE): number {
  return depth / (1 + (depth * bend) / share);
}

/**
 * The patch surface at (x, z) into `pos`, and its unit normal into `nrm`,
 * both at `at`: the ground pushed out along its normal by the masked relief,
 * tapered toward the squares outside the set. Every position and normal a
 * patch holds comes from here, from the world point and the squares outside
 * the set alone, so a point is the same doubles in every patch that holds
 * it, whatever its spacing.
 *
 * The push is k = d / sqrt(1 + g²) along n = (−h_x, 1, −h_z), with
 * d = m · τ · D · (v + 1) / 2: m the mask, τ the taper and D the depth the
 * ground's bend leaves (`patchDepth`); and, where the ground is painted
 * rock and the faces' mask leaves off, the walkable rock's push on top, the
 * same form with its own relief, its mask `rock · (1 − m) · loud` and its
 * depth GROUND_DEPTH cut by the bend alike. The normal is the displaced
 * surface's, from the field's own derivatives: ∂P/∂x ≈ (1, h_x, 0) + n · ∂k/∂x
 * with ∂k/∂x = (m · τ · D / 2 · v_x + m · D · (v + 1) / 2 · τ_x) / sqrt(1 + g²),
 * likewise in z, the slowly varying terms (the mask's, the depth's, the
 * ground normal's, sqrt(1 + g²)'s) left out; then ∂P/∂z × ∂P/∂x, which is
 * (−h_x, 1, −h_z) where the relief is nothing, up on flat ground as the
 * clipmap's. A column's flat face shades flat and its joint steep whatever
 * the grid's spacing, and the taper's ramp leans as it rises.
 */
function surfaceInto(
  seed: number, s: TerrainSample, x: number, z: number, ci: number, cj: number, open: number,
  ring: readonly TerrainSample[] | null, ri: number, rside: number,
  rock: number, loud: number,
  pos: Float64Array, nrm: Float64Array, at: number,
): void {
  const g2 = s.dx * s.dx + s.dz * s.dz;
  const mask = faceMask(Math.sqrt(g2));
  // The walkable rock's mask before the taper: the rock paint where the
  // faces' mask leaves off, at the cell's loudness.
  const rockMask = rock * (1 - mask) * loud;
  const taper = mask === 0 && rockMask === 0 ? 0 : taperInto(ci, cj, open, x, z);
  const m = mask * taper;
  const mg = rockMask * taper;
  let kx = 0;
  let kz = 0;
  if (m === 0 && mg === 0) {
    pos[at] = x;
    pos[at + 1] = s.h;
    pos[at + 2] = z;
  } else {
    const q = Math.sqrt(1 + g2);
    const bend = ring === null
      ? groundBend(seed, x, z, s)
      : bendFrom(
        s,
        ring[ri + 1] as TerrainSample,
        ring[ri - 1] as TerrainSample,
        ring[ri + rside] as TerrainSample,
        ring[ri - rside] as TerrainSample,
      );
    let d = 0;
    if (m > 0) {
      const r = faceReliefD(seed, x, z);
      const depth = patchDepth(bend);
      d += (m * depth * (r.v + 1)) / 2;
      const half = (m * depth) / 2;
      const whole = (mask * depth * (r.v + 1)) / 2;
      kx += half * r.dx + whole * taperDx;
      kz += half * r.dz + whole * taperDz;
    }
    if (mg > 0) {
      const r = groundReliefD(seed, x, z);
      const depth = patchDepth(bend, GROUND_DEPTH, GROUND_BEND_SHARE);
      d += (mg * depth * (r.v + 1)) / 2;
      const half = (mg * depth) / 2;
      const whole = (rockMask * depth * (r.v + 1)) / 2;
      kx += half * r.dx + whole * taperDx;
      kz += half * r.dz + whole * taperDz;
    }
    const k = d / q;
    pos[at] = x - s.dx * k;
    pos[at + 1] = s.h + k;
    pos[at + 2] = z - s.dz * k;
    kx /= q;
    kz /= q;
  }
  const ax = 1 - s.dx * kx;
  const ay = s.dx + kx;
  const az = -s.dz * kx;
  const bx = -s.dx * kz;
  const by = s.dz + kz;
  const bz = 1 - s.dz * kz;
  const nx = by * az - bz * ay;
  const ny = bz * ax - bx * az;
  const nz = bx * ay - by * ax;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nrm[at] = nx / len;
  nrm[at + 1] = ny / len;
  nrm[at + 2] = nz / len;
}

/**
 * The patch of cell (ci, cj) at `spacing` (0.5, 1 or 2 m), or null when no
 * point of its grid, boundary included, has steep ground or ground the
 * slope paints at least GROUND_ROCK_MIN rock (the slope is the only way the
 * rock paint comes). The grid is the
 * cell's own (16/spacing + 1)² points. The relief fades out toward the
 * neighbours `stitch.open` flags (`patchTaper`). On each edge `stitch` flags,
 * whose neighbour is at twice this spacing, the odd points are laid on the
 * line between their two even neighbours, as the coarser patch beside draws
 * that edge, and painted as the coarser patch's interpolation paints them;
 * the even points are the coarser patch's own, position and normal, since
 * both come from the world point alone.
 */
export function facePatchGeometry(
  seed: number, ci: number, cj: number, spacing: number, stitch: PatchStitch,
): FacePatch | null {
  const n = Math.round(PATCH_CELL / spacing);
  const side = n + 1;
  const count = side * side;
  const x0 = ci * PATCH_CELL;
  const z0 = cj * PATCH_CELL;
  const samples: TerrainSample[] = new Array<TerrainSample>(count);
  let steep = false;
  let rocky = false;
  for (let iz = 0; iz < side; iz++) {
    const z = z0 + iz * spacing;
    for (let ix = 0; ix < side; ix++) {
      const s = elevationSampleAt(seed, x0 + ix * spacing, z);
      samples[iz * side + ix] = s;
      const g = Math.sqrt(s.dx * s.dx + s.dz * s.dz);
      if (!steep && faceMask(g) > 0) steep = true;
      if (!rocky && rockOfSlope(g) >= GROUND_ROCK_MIN) rocky = true;
    }
  }
  if (!steep && !rocky) return null;

  // The walkable rock's loudness at the cell's four corners, interpolated
  // across it; nothing to read where no point of the cell is painted rock.
  const l00 = rocky ? groundLoudness(rockExtent(seed, x0, z0)) : 0;
  const l10 = rocky ? groundLoudness(rockExtent(seed, x0 + PATCH_CELL, z0)) : 0;
  const l01 = rocky ? groundLoudness(rockExtent(seed, x0, z0 + PATCH_CELL)) : 0;
  const l11 = rocky ? groundLoudness(rockExtent(seed, x0 + PATCH_CELL, z0 + PATCH_CELL)) : 0;

  // At the curvature's own step the grid holds each point's neighbours for
  // its bend: the samples again, with a ring one step outside the cell.
  // The same world points as `groundBend` samples, so the same bend.
  const rside = side + 2;
  let ring: TerrainSample[] | null = null;
  if (spacing === PATCH_CURVE_STEP) {
    ring = new Array<TerrainSample>(rside * rside);
    for (let iz = -1; iz <= side; iz++) {
      for (let ix = -1; ix <= side; ix++) {
        const inside = iz >= 0 && iz < side && ix >= 0 && ix < side;
        ring[(iz + 1) * rside + ix + 1] = inside
          ? samples[iz * side + ix] as TerrainSample
          : elevationSampleAt(seed, x0 + ix * spacing, z0 + iz * spacing);
      }
    }
  }

  const pos = new Float64Array(count * 3);
  const nrm = new Float64Array(count * 3);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  const weights2 = new Float32Array(count * WEIGHTS2_STRIDE);
  const cover = new Float32Array(count);
  for (let iz = 0; iz < side; iz++) {
    const z = z0 + iz * spacing;
    for (let ix = 0; ix < side; ix++) {
      const x = x0 + ix * spacing;
      const at = iz * side + ix;
      const s = samples[at] as TerrainSample;
      // Painted as the clipmap paints the ground at this point: the same
      // calls with the same inputs (`clipmap.ts`, `sampleInto`). The rock
      // weight is the walkable rock's mask, so the paint comes first.
      const gc = groundCover(seed, x, z, s);
      const duff = gc.duff;
      const canopy = forestDensity(seed, x, z, s);
      const { albedo, weights: w } = classifySurface(
        seed, x, z, s.h, Math.hypot(s.dx, s.dz), canopy, duff, waterGroundAt(seed, x, z, s.h),
      );
      const fx = ix / n;
      const fz = iz / n;
      const loud = (l00 * (1 - fx) + l10 * fx) * (1 - fz) + (l01 * (1 - fx) + l11 * fx) * fz;
      surfaceInto(
        seed, s, x, z, ci, cj, stitch.open, ring, (iz + 1) * rside + ix + 1, rside, w.rock, loud,
        pos, nrm, at * 3,
      );
      for (let c = 0; c < 3; c++) {
        positions[at * 3 + c] = pos[at * 3 + c] as number;
        normals[at * 3 + c] = nrm[at * 3 + c] as number;
      }
      const c = at * 4;
      colors[c] = albedo.r;
      colors[c + 1] = albedo.g;
      colors[c + 2] = albedo.b;
      colors[c + 3] = 1;
      weights[c] = w.grass;
      weights[c + 1] = w.forestFloor;
      weights[c + 2] = w.rock;
      weights[c + 3] = w.sand;
      const w2 = at * WEIGHTS2_STRIDE;
      weights2[w2] = w.pebble;
      weights2[w2 + 1] = w.detail;
      weights2[w2 + 2] = duff;
      weights2[w2 + 3] = canopy;
      cover[at] = Math.min(1, gc.grass);
    }
  }

  const attrs = { positions, normals, colors, weights, weights2, cover };
  if (stitch.west) stitchEdge(attrs, 0, side, n);
  if (stitch.east) stitchEdge(attrs, n, side, n);
  if (stitch.south) stitchEdge(attrs, 0, 1, n);
  if (stitch.north) stitchEdge(attrs, n * side, 1, n);

  const indices = new Uint16Array(n * n * 6);
  let k = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * side + ix;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // The clipmap's winding (`ringGeometry`): Babylon is left-handed, and
      // the reverse order culls the patch away from above.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  return { positions, normals, colors, weights, weights2, cover, indices, vertexCount: count, triangleCount: n * n * 2 };
}

type PatchAttributes = Pick<FacePatch, "positions" | "normals" | "colors" | "weights" | "weights2" | "cover">;

/** The mean of `width` values at vertices `lo` and `hi` into vertex `at`. */
function meanInto(a: Float32Array, width: number, at: number, lo: number, hi: number): void {
  for (let c = 0; c < width; c++) {
    a[at * width + c] = ((a[lo * width + c] as number) + (a[hi * width + c] as number)) / 2;
  }
}

/**
 * One edge of a patch laid on the edge of the coarser patch beside it, at
 * twice its spacing: each odd point
 * the mean of its two even neighbours, as the coarse patch interpolates its
 * edge between them: position, normal (made unit again), colour, weights and
 * cover. The edge's `n + 1` points run from vertex `start` in steps of `stride`.
 */
function stitchEdge(p: PatchAttributes, start: number, stride: number, n: number): void {
  for (let i = 1; i < n; i += 2) {
    const at = start + i * stride;
    const lo = at - stride;
    const hi = at + stride;
    meanInto(p.positions, 3, at, lo, hi);
    meanInto(p.normals, 3, at, lo, hi);
    meanInto(p.colors, 4, at, lo, hi);
    meanInto(p.weights, 4, at, lo, hi);
    meanInto(p.weights2, WEIGHTS2_STRIDE, at, lo, hi);
    meanInto(p.cover, 1, at, lo, hi);
    const nx = p.normals[at * 3] as number;
    const ny = p.normals[at * 3 + 1] as number;
    const nz = p.normals[at * 3 + 2] as number;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    p.normals[at * 3] = nx / len;
    p.normals[at * 3 + 1] = ny / len;
    p.normals[at * 3 + 2] = nz / len;
  }
}

/**
 * The cells within `reach.wide` of the camera, by the distance from the
 * camera to each cell's centre, each at the near spacing within `reach.near`,
 * the far spacing within `reach.far` and the wide spacing beyond. Ordered by
 * row (cj), then column (ci).
 */
export function facePatchCells(camX: number, camZ: number, reach: PatchReach): PatchCell[] {
  const wide2 = reach.wide * reach.wide;
  const far2 = reach.far * reach.far;
  const near2 = reach.near * reach.near;
  const i0 = Math.floor((camX - reach.wide) / PATCH_CELL);
  const i1 = Math.floor((camX + reach.wide) / PATCH_CELL);
  const j0 = Math.floor((camZ - reach.wide) / PATCH_CELL);
  const j1 = Math.floor((camZ + reach.wide) / PATCH_CELL);
  const cells: PatchCell[] = [];
  for (let cj = j0; cj <= j1; cj++) {
    const dz = (cj + 0.5) * PATCH_CELL - camZ;
    for (let ci = i0; ci <= i1; ci++) {
      const dx = (ci + 0.5) * PATCH_CELL - camX;
      const d2 = dx * dx + dz * dz;
      if (d2 > wide2) continue;
      const spacing = d2 <= near2 ? PATCH_NEAR_SPACING : d2 <= far2 ? PATCH_FAR_SPACING : PATCH_WIDE_SPACING;
      cells.push({ ci, cj, spacing });
    }
  }
  return cells;
}

/**
 * For each cell of `cells`, in order, which of its edges it lays on a coarser
 * neighbour's (an edge whose neighbour is in the set at a coarser spacing:
 * 0.5 m on 1 m, 1 m on 2 m; neighbouring cells are never more than a band
 * apart, the bands being wider than a cell), and which of its eight
 * neighbours are outside the set, not drawn, toward which its relief fades.
 */
export function facePatchStitch(cells: readonly PatchCell[]): PatchStitch[] {
  const spacingOf = new Map<number, number>();
  for (const c of cells) spacingOf.set(patchKey(c.ci, c.cj), c.spacing);
  const coarser = (ci: number, cj: number, spacing: number): boolean =>
    (spacingOf.get(patchKey(ci, cj)) ?? 0) > spacing;
  return cells.map((c) => {
    let open = 0;
    PATCH_NEIGHBOURS.forEach(([di, dj], k) => {
      if (!spacingOf.has(patchKey(c.ci + di, c.cj + dj))) open |= 1 << k;
    });
    return {
      west: coarser(c.ci - 1, c.cj, c.spacing),
      east: coarser(c.ci + 1, c.cj, c.spacing),
      south: coarser(c.ci, c.cj - 1, c.spacing),
      north: coarser(c.ci, c.cj + 1, c.spacing),
      open,
    };
  });
}

/**
 * The ground the patches cover for a camera at (camX, camZ), as the clipmap
 * leaves it out (`CoveredGround`): the squares whose centres lie within the
 * wide reach of the camera's cell's centre, less a cell's diagonal. Every
 * neighbour of such a square, corners too, is in the patched set, so its
 * patch has no open side, no taper, and the whole relief over it. The
 * rings ask for the cover of the set drawn (`FacePatches.cover`), never of
 * one still building, and are drawn again for each set the frame after it is
 * drawn, whether the camera moves or not; until that rebuild lands, a frame
 * or two, they leave out what the set before covered, which a set one cell
 * on still patches. A triangle the clipmap leaves out has three
 * fully steep vertices, each a grid point of its square's patch, so the
 * square has steep ground at its grid and a patch: ring 1's 2 m vertices and
 * the coarser rings' lie on every band's grid, and ring 0's 1 m vertices,
 * in squares up to 90.5 m from the camera's cell's centre, are left out only
 * within `fine`, the far reach (80 m on low), where the patches are 1 m or
 * finer.
 */
export function facePatchCover(camX: number, camZ: number, reach: PatchReach): CoveredGround {
  return {
    x: (Math.floor(camX / PATCH_CELL) + 0.5) * PATCH_CELL,
    z: (Math.floor(camZ / PATCH_CELL) + 0.5) * PATCH_CELL,
    reach: reach.wide - PATCH_CELL * Math.SQRT2,
    fine: reach.far,
    cell: PATCH_CELL,
  };
}
