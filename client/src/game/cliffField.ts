/**
 * Where the cliff modules stand: a pure function of the world.
 *
 * The steep rock hillsides are a smooth sheet with a rock texture on them,
 * and no paint breaks a silhouette. This field seats rock-wall models on
 * ground that is BOTH rock and too steep to stand on, so the faces grow
 * ledges and the skyline breaks. The one rule everything here serves: a
 * module never stands where a foot can go. The gate is the simulation's own
 * stand limit (`GROUND_NORMAL_Y`) with a margin, read at the module's centre
 * and at the four corners of its footprint, so sight and collision never
 * disagree underfoot. Renderer-only: it reads the simulation and writes
 * nothing back. Nothing here may migrate into sim/.
 */
import { GROUND_NORMAL_Y } from "../sim/constants.js";
import { CLUTTER_ROCK, groundCover, type ClutterInstance } from "../sim/clutter.js";
import { elevationSampleAt, type TerrainSample } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { latticeHash } from "./groundHexParams.js";
import type { QualityTier } from "./quality.js";
import { classifySurface } from "./terrainSurface.js";

/** Lattice cell (m). One module at most per cell. */
export const CLIFF_CELL = 12;
/** Jitter of a module inside its cell, as a fraction of the cell, per axis. */
export const CLIFF_JITTER = 0.5;
/** How far below the stand limit the ground must be (in normal-y) before a
 * module may stand on it: a margin so a module never stands on the last
 * centimetre a foot can. */
export const CLIFF_STAND_MARGIN = 0.03;
/** Rock weight (`classifySurface`) a spot needs before a module stands on it,
 * so a module can never stand off the texture it belongs to. Above the snow
 * line the rock weight fades and the modules stop with the paint. */
export const CLIFF_ROCK_MIN = 0.8;
/** Share of the qualifying cells that carry a module. Drawn first, before a
 * terrain sample, so the cheap rejection comes first. */
export const CLIFF_DENSITY = 0.5;
/** Scale band a module draws from its cell hash — a multiplier on the model's
 * own size, not a length. */
export const CLIFF_SCALE: readonly [number, number] = [0.8, 1.3];
/** Yaw jitter (rad) either side of straight downslope, so a run of modules
 * is not a fence. */
export const CLIFF_YAW_JITTER = 0.3;
/** How far a module is pushed into the ground, as a fraction of its rendered
 * height: the base is buried, the ledges above ground are what shows. */
export const CLIFF_SINK = 0.35;
/** Neighbours (of four, at `CLIFF_CELL`) that must be steep rock for the long
 * module to be chosen over the short one. */
export const CLIFF_LONG_NEIGHBOURS = 3;
/** The two models, by variant index. */
export const CLIFF_WALL_A = 0;
export const CLIFF_WALL_B = 1;
export const CLIFF_MODELS: readonly string[] = ["models/cliff.wall_a.glb", "models/cliff.wall_b.glb"];
/** Each model's own size at scale 1, in metres, from its `LOD0` mesh: the
 * extent along its width (x), its depth (z) and its height (y). `scale` is a
 * multiplier on the model, so a band in metres means metres only once
 * divided by these. */
export const CLIFF_MODEL_WIDTH: readonly number[] = [8.27, 20.23];
export const CLIFF_MODEL_DEPTH: readonly number[] = [4.38, 6.58];
export const CLIFF_MODEL_HEIGHT: readonly number[] = [4.96, 7.17];

/** One of a cell's draws: the lattice hash on salted indices. The salts
 * (307, 331) are this field's own, so its draws never correlate with the
 * tree, blade or litter lattices beside it. */
function cellDraw(ci: number, cj: number, salt: number): number {
  return latticeHash(ci + 307 * salt, cj + 331 * salt);
}

/** Where cell (ci, cj)'s candidate stands, jittered inside the cell. */
export function cliffCellPoint(ci: number, cj: number): { x: number; z: number } {
  return {
    x: (ci + 0.5 + CLIFF_JITTER * (cellDraw(ci, cj, 1) - 0.5)) * CLIFF_CELL,
    z: (cj + 0.5 + CLIFF_JITTER * (cellDraw(ci, cj, 2) - 0.5)) * CLIFF_CELL,
  };
}

/**
 * The gate at one spot: the terrain sample, the rock weight read game-side
 * at that spot, and whether a module may stand there — steep past the
 * stand limit by the margin, AND rock.
 */
export function cliffGate(seed: number, x: number, z: number): { s: TerrainSample; rock: number; open: boolean } {
  const s = elevationSampleAt(seed, x, z);
  const ny = 1 / Math.sqrt(1 + s.dx * s.dx + s.dz * s.dz);
  if (ny >= GROUND_NORMAL_Y - CLIFF_STAND_MARGIN) return { s, rock: 0, open: false };
  const duff = groundCover(seed, x, z, s).duff;
  const rock = classifySurface(seed, x, z, s.h, Math.hypot(s.dx, s.dz), forestDensity(seed, x, z, s), duff).weights.rock;
  return { s, rock, open: rock >= CLIFF_ROCK_MIN };
}

/** Straight downslope, in the scene's yaw (yaw 0 faces +Z, forward is
 * (sin yaw, cos yaw)): the direction the scanned face looks out of the hill. */
export function cliffYaw(s: TerrainSample): number {
  return Math.atan2(-s.dx, -s.dz);
}

/** The four neighbours a long face is looked for in. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL],
];

/**
 * The module in cell (ci, cj), or null. Shaped as a `ClutterInstance` of the
 * rock class so `instanceMatrixFor` serves it unchanged: rock is in that
 * file's tilted set, so the module is seated on the ground normal — a wall
 * bedded into a 45° face leans back with it, as an outcrop does — and it is
 * outside the trampled set, so the trample frame is the identity. The yaw
 * rides in `hash` as a fraction of a turn, which is how that function reads
 * it. `groundH` already carries the sink.
 */
export function cliffCell(seed: number, ci: number, cj: number): ClutterInstance | null {
  if (cellDraw(ci, cj, 6) >= CLIFF_DENSITY) return null;
  const { x, z } = cliffCellPoint(ci, cj);
  const g = cliffGate(seed, x, z);
  if (!g.open) return null;
  let steepNeighbours = 0;
  for (const [ox, oz] of NEIGHBOURS) {
    if (cliffGate(seed, x + ox, z + oz).open) steepNeighbours++;
  }
  const scale = CLIFF_SCALE[0] + (CLIFF_SCALE[1] - CLIFF_SCALE[0]) * cellDraw(ci, cj, 3);
  const yaw = cliffYaw(g.s) + CLIFF_YAW_JITTER * (2 * cellDraw(ci, cj, 4) - 1);
  const hash = ((yaw / (Math.PI * 2)) % 1 + 1) % 1;
  /** All four corners of a module of `variant` at this scale and yaw pass
   * the gate — the module's extent, since the sink keeps the rest of it
   * below the surface it stands on. */
  const footprintOpen = (variant: number): boolean => {
    const hw = (CLIFF_MODEL_WIDTH[variant] as number) * scale / 2;
    const hd = (CLIFF_MODEL_DEPTH[variant] as number) * scale / 2;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return (
      cliffGate(seed, x + rx * hw, z + rz * hw).open &&
      cliffGate(seed, x - rx * hw, z - rz * hw).open &&
      cliffGate(seed, x + fx * hd, z + fz * hd).open &&
      cliffGate(seed, x - fx * hd, z - fz * hd).open
    );
  };
  // The long module where the face is long; where its own corners would
  // overhang walkable ground, the short one instead, and where even that
  // would, nothing.
  let variant = steepNeighbours >= CLIFF_LONG_NEIGHBOURS ? CLIFF_WALL_B : CLIFF_WALL_A;
  if (!footprintOpen(variant)) {
    if (variant === CLIFF_WALL_A) return null;
    variant = CLIFF_WALL_A;
    if (!footprintOpen(variant)) return null;
  }
  return {
    cls: CLUTTER_ROCK,
    x,
    z,
    groundH: g.s.h - CLIFF_SINK * scale * (CLIFF_MODEL_HEIGHT[variant] as number),
    groundDx: g.s.dx,
    groundDz: g.s.dz,
    scale,
    variant,
    hash,
  };
}

/** The worst offset (m) between the eye and the origin the distances are
 * measured against: the rebuild snaps to `CLIFF_CELL`, so the reach edge is
 * padded by a cell's diagonal and a module at the edge is collected before
 * its band needs it — the tree field's `SEAM_PAD`. */
export const CLIFF_PAD = Math.SQRT2 * CLIFF_CELL;
/** The three LOD rings (m from the rebuild origin) per quality tier: LOD0 to
 * the first, LOD1 to the second, LOD2 to the third, which is the reach. The
 * low tier has no LOD0 ring. */
export const CLIFF_RINGS: Record<QualityTier, readonly [number, number, number]> = {
  high: [60, 160, 400],
  medium: [60, 140, 250],
  low: [0, 80, 200],
};
/** Width (m) of the far bucket's dither-out at the reach. */
export const CLIFF_FADE_BAND = 40;
/** Modules a reach may hold at most; the worst 400 m disc of the census
 * worlds sits well under it. */
export const CLIFF_BUDGET = 700;

/** The eye's origin snapped to the lattice: the rebuild trigger and the
 * point every band distance is measured from. */
export function cliffOrigin(camX: number, camZ: number): { x: number; z: number } {
  return { x: Math.floor(camX / CLIFF_CELL) * CLIFF_CELL, z: Math.floor(camZ / CLIFF_CELL) * CLIFF_CELL };
}

function collectWith(
  camX: number,
  camZ: number,
  reach: number,
  cellAt: (ci: number, cj: number) => ClutterInstance | null,
): ClutterInstance[] {
  const { x: ox, z: oz } = cliffOrigin(camX, camZ);
  const r = reach + CLIFF_PAD;
  const r2 = r * r;
  const found: { m: ClutterInstance; d2: number }[] = [];
  const c0x = Math.floor((ox - r) / CLIFF_CELL), c1x = Math.floor((ox + r) / CLIFF_CELL);
  const c0z = Math.floor((oz - r) / CLIFF_CELL), c1z = Math.floor((oz + r) / CLIFF_CELL);
  for (let cj = c0z; cj <= c1z; cj++) {
    for (let ci = c0x; ci <= c1x; ci++) {
      const m = cellAt(ci, cj);
      if (m === null) continue;
      const dx = m.x - ox, dz = m.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r2) found.push({ m, d2 });
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  return found.map((p) => p.m);
}

/** Every module within `reach` (plus the pad) of the snapped origin,
 * nearest first. Pure; the collector below is its memoising twin. */
export function collectCliffs(seed: number, camX: number, camZ: number, reach: number): ClutterInstance[] {
  return collectWith(camX, camZ, reach, (ci, cj) => cliffCell(seed, ci, cj));
}

export type CliffCollector = {
  /** Identical output to `collectCliffs(seed, camX, camZ, reach)`. */
  collect(camX: number, camZ: number, reach: number): ClutterInstance[];
  /** Cached cell count — exposed so tests can pin the growth per crossing. */
  readonly size: number;
};

// Numeric cell key, exact for |cell index| < 2^20 — the tree field's packing.
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;
/** Cells this far past the reach are evicted once the cache outgrows
 * `COLLECTOR_SWEEP_SIZE`. */
const COLLECTOR_EVICT_MARGIN = 4 * CLIFF_CELL;
const COLLECTOR_SWEEP_SIZE = 16384;

/**
 * Memoising counterpart to `collectCliffs`: `cliffCell` is pure in (seed,
 * ci, cj), so a rebuild after a one-cell move re-reads only the disc's
 * leading edge instead of every cell in reach — a cell costs a terrain
 * sample and a surface classification, five more for the half that qualify.
 */
export function createCliffCollector(seed: number): CliffCollector {
  const cache = new Map<number, ClutterInstance | null>();
  return {
    collect(camX, camZ, reach) {
      const out = collectWith(camX, camZ, reach, (ci, cj) => {
        const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
        let m = cache.get(key);
        if (m === undefined) {
          m = cliffCell(seed, ci, cj);
          cache.set(key, m);
        }
        return m;
      });
      if (cache.size > COLLECTOR_SWEEP_SIZE) {
        const { x: ox, z: oz } = cliffOrigin(camX, camZ);
        const evict = reach + CLIFF_PAD + COLLECTOR_EVICT_MARGIN;
        const evict2 = evict * evict;
        for (const key of cache.keys()) {
          const cjPart = key % KEY_SPAN;
          const cj = cjPart - KEY_HALF;
          const ci = (key - cjPart) / KEY_SPAN - KEY_HALF;
          const cx = (ci + 0.5) * CLIFF_CELL - ox, cz = (cj + 0.5) * CLIFF_CELL - oz;
          if (cx * cx + cz * cz >= evict2) cache.delete(key);
        }
      }
      return out;
    },
    get size(): number {
      return cache.size;
    },
  };
}

/**
 * Splits nearest-first `instances` into the three LOD buckets by distance
 * from the origin against `rings`: [0, rings[0]) → LOD0, [rings[0],
 * rings[1]) → LOD1, [rings[1], rings[2]) → LOD2. Anything at or past the
 * reach is dropped (the pad collected it for the next rebuild, not this
 * one). Every instance lands in exactly one bucket.
 */
export function cliffBands(
  instances: readonly ClutterInstance[],
  ox: number,
  oz: number,
  rings: readonly [number, number, number],
): [ClutterInstance[], ClutterInstance[], ClutterInstance[]] {
  const out: [ClutterInstance[], ClutterInstance[], ClutterInstance[]] = [[], [], []];
  for (const m of instances) {
    const d = Math.hypot(m.x - ox, m.z - oz);
    if (d < rings[0]) out[0].push(m);
    else if (d < rings[1]) out[1].push(m);
    else if (d < rings[2]) out[2].push(m);
  }
  return out;
}
