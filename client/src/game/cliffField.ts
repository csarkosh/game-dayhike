/**
 * The cliff modules in reach of the eye: the collector over the placement
 * field and the LOD bands the shell draws them in.
 *
 * Where a module stands is simulation, not rendering — the modules are part
 * of the world every peer agrees on, and their constants are in the level id
 * — so the field itself lives in `sim/cliffField.ts`. This file only asks it
 * for the cells around the eye, remembers the answers across rebuilds, and
 * splits what it gathered by distance.
 */
import type { ClutterInstance } from "../sim/clutter.js";
import { CLIFF_CELL, CLIFF_JITTER, CLIFF_RUN_REACH, cliffCellRuns } from "../sim/cliffField.js";
import type { QualityTier } from "./quality.js";

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

/** The farthest a cell's jittered point sits from the cell's centre: half
 * the jitter along each axis, on the diagonal. */
const CELL_POINT_REACH = Math.SQRT2 * (CLIFF_JITTER / 2) * CLIFF_CELL;

function collectWith(
  camX: number,
  camZ: number,
  reach: number,
  cellAt: (ci: number, cj: number) => readonly ClutterInstance[],
): ClutterInstance[] {
  const { x: ox, z: oz } = cliffOrigin(camX, camZ);
  const r = reach + CLIFF_PAD;
  const r2 = r * r;
  // The cells are walked a collar further out than the modules are kept: a
  // run lays modules up to `CLIFF_RUN_REACH` from its own cell's point, so a
  // cell that far outside the disc can own a module inside it — without the
  // collar that module would be missing until the eye walked toward its home
  // cell, then pop in. A cell's point lies within `CELL_POINT_REACH` of its
  // centre, so a cell whose centre is farther than `w` plus that from the
  // origin owns nothing that can land in the disc, and is not read.
  const w = r + CLIFF_RUN_REACH;
  const wc = w + CELL_POINT_REACH;
  const wc2 = wc * wc;
  const found: { m: ClutterInstance; d2: number }[] = [];
  const c0x = Math.floor((ox - w) / CLIFF_CELL), c1x = Math.floor((ox + w) / CLIFF_CELL);
  const c0z = Math.floor((oz - w) / CLIFF_CELL), c1z = Math.floor((oz + w) / CLIFF_CELL);
  for (let cj = c0z; cj <= c1z; cj++) {
    const cz = (cj + 0.5) * CLIFF_CELL - oz;
    for (let ci = c0x; ci <= c1x; ci++) {
      const cx = (ci + 0.5) * CLIFF_CELL - ox;
      if (cx * cx + cz * cz > wc2) continue;
      for (const m of cellAt(ci, cj)) {
        const dx = m.x - ox, dz = m.z - oz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r2) found.push({ m, d2 });
      }
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  return found.map((p) => p.m);
}

/** Every module within `reach` (plus the pad) of the snapped origin,
 * nearest first, from every cell whose run can reach that far. Pure; the
 * collector below is its memoising twin. */
export function collectCliffs(seed: number, camX: number, camZ: number, reach: number): ClutterInstance[] {
  return collectWith(camX, camZ, reach, (ci, cj) => cliffCellRuns(seed, ci, cj));
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
/** Cells this far past the walked disc's reach are evicted once the cache
 * outgrows `COLLECTOR_SWEEP_SIZE`. */
const COLLECTOR_EVICT_MARGIN = 4 * CLIFF_CELL;
const COLLECTOR_SWEEP_SIZE = 16384;

/**
 * Memoising counterpart to `collectCliffs`: `cliffCellRuns` is pure in
 * (seed, ci, cj), so a rebuild after a one-cell move re-reads only the walk's
 * leading edge instead of every cell in it. Nine cells in ten stop at the
 * density draw; the rest cost a terrain sample, and the ones that qualify
 * four neighbour samples, a dozen-odd probes over each module's solid, and
 * a gate and the probes again for every further spot along the run.
 */
export function createCliffCollector(seed: number): CliffCollector {
  const cache = new Map<number, readonly ClutterInstance[]>();
  return {
    collect(camX, camZ, reach) {
      const out = collectWith(camX, camZ, reach, (ci, cj) => {
        const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
        let run = cache.get(key);
        if (run === undefined) {
          run = cliffCellRuns(seed, ci, cj);
          cache.set(key, run);
        }
        return run;
      });
      if (cache.size > COLLECTOR_SWEEP_SIZE) {
        const { x: ox, z: oz } = cliffOrigin(camX, camZ);
        const evict = reach + CLIFF_PAD + CLIFF_RUN_REACH + COLLECTOR_EVICT_MARGIN;
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
