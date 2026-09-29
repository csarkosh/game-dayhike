import { CLUTTER_LITTER, groundCover, type ClutterInstance } from "../sim/clutter.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { latticeHash } from "./groundHexParams.js";
import { DUFF_CHARACTER_COUNT, DUFF_TWIG } from "./duffClump.js";
import { GROW_NONE, type BladeEdges } from "./bladeField.js";
import { finish, nextCrossing, type Slices } from "./syncJobs.js";
import { createCellWindow, inWindow, moveWindow, prefetchWindow, walkEveryCell, type CellRows } from "./cellWindow.js";

/**
 * The duff field: the counterpart of `bladeField.ts` for the ground's dead
 * leaves, twigs and small branches. Same walk, same cell idiom, same
 * memoising collector — the only real difference is what the cell reads
 * from the sim (`groundCover(...).duff` rather than `.grass`) and that it
 * has two tiers, not three, since duff never grows fine detail the way a
 * blade clump does. Where the blade field's `cover` can run past 1 (the
 * interior boost) and needs its own `strength` clamp, duff's field value is
 * already bounded to [0, 1], so the cell's `strength` is exactly what the
 * sim reports — no separate cover/strength split.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 * The sim is read (its gate and forest density), never written.
 */

/** Lattice cell (m). */
export const DUFF_CELL = 1;
/** The field rebuilds when the eye crosses a cell of this size (m). */
export const DUFF_REBUILD_CELL = 1;
/** The worst offset (m) between the true eye and the origin the distances
 * were measured against — the `BLADE_PAD` derivation, on duff's own cell
 * and rebuild sizes. */
export const DUFF_PAD = Math.SQRT2 * (DUFF_REBUILD_CELL + DUFF_CELL);
/** The outer reach (m) by quality tier: how far duff pieces stand from the
 * eye before the field gives out. Wide enough that a leaf-sized piece's own
 * edge is never a line the eye can follow, the lesson the blade-to-card
 * hand-off already taught. */
export const DUFF_REACH: Record<"high" | "medium", number> = { high: 24, medium: 16 };
/** Outer edge (m) of the near tier. */
export const DUFF_TIER_EDGE = 6;
/** Width (m) of the near→far hand-off band, ending at the tier edge. */
export const DUFF_TIER_BAND = 1.5;
/** Width (m) of the far tier's own collapse band, ending at the reach. */
export const DUFF_COLLAPSE_BAND = 2;
/** A cell whose gate is under this draws nothing. */
export const DUFF_STRENGTH_FLOOR = 0.05;
/** Jitter of a cell's piece inside the cell, as a fraction of the cell. */
export const DUFF_JITTER = 0.4;

/** Share of cells per character at full strength, in index order (twig,
 * leaf, small branch) — cumulative 0.15 / 0.90 / 1.00. Leaves are three
 * quarters of every draw. */
export const DUFF_CHARACTER_WEIGHTS: readonly number[] = [0.15, 0.75, 0.10];

/**
 * One cell of the field. Shaped as a `ClutterInstance` of the litter class
 * so the cards' matrix and tint writers in clutterMeshes.ts serve it
 * unchanged, plus the field's own: the strength, the canopy and the
 * character. `variant` is set to `DUFF_CHARACTER_COUNT`, one past
 * `LITTER_VARIANT_SCALE`'s indices — deliberately out of range, so
 * `instanceMatrixFor`'s lookup (`LITTER_VARIANT_SCALE[inst.variant] ?? 1`)
 * falls back to no pebble scale, and the class's own `TILTED` membership
 * still lays the piece on the ground normal.
 */
export type DuffCell = ClutterInstance & {
  /** The ground-cover field's duff at the piece, floored: the sim's own
   * value, tied straight back so the two can never drift apart unnoticed. */
  strength: number;
  /** forestDensity at the piece, for the shade and the height. */
  canopy: number;
  character: number;
  /** The uniform draw the character came from, kept so a test can re-derive it. */
  characterDraw: number;
};

export type DuffTiers = { near: DuffCell[]; far: DuffCell[] };

/** One of a cell's draws: the lattice hash on salted cell indices. The
 * salts (151, 191) differ from the blade field's own (131, 173) so the two
 * lattices' jitter, hash and character draws never correlate — duff must
 * not land in lockstep with the grass it fills in for. */
function cellDraw(ci: number, cj: number, salt: number): number {
  return latticeHash(ci + 151 * salt, cj + 191 * salt);
}

/** The near and far tiers' hand-off edges, in true eye distance. The near
 * tier has no grow-in (`GROW_NONE`, shared with the blade field's own
 * no-op fine tier); it collapses over the band the far tier grows in over;
 * the far tier collapses over its own reach. */
export function duffTierBands(reach: number): [BladeEdges, BladeEdges] {
  return [
    [GROW_NONE[0], GROW_NONE[1], DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE],
    [DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE, reach - DUFF_COLLAPSE_BAND, reach],
  ];
}

/** The character a cell draws: the weights walked with one uniform draw. */
export function duffCharacterFor(draw: number): number {
  let acc = 0;
  for (let c = 0; c < DUFF_CHARACTER_COUNT; c++) {
    acc += DUFF_CHARACTER_WEIGHTS[c] as number;
    if (draw < acc) return c;
  }
  return DUFF_TWIG;
}

/** The cell at lattice indices (ci, cj), or null where the gate is under the
 * floor. Pure in (seed, ci, cj): every rebuild sees the same cell. */
export function duffCellAt(seed: number, ci: number, cj: number): DuffCell | null {
  const x = (ci + 0.5 + DUFF_JITTER * (cellDraw(ci, cj, 1) - 0.5)) * DUFF_CELL;
  const z = (cj + 0.5 + DUFF_JITTER * (cellDraw(ci, cj, 2) - 0.5)) * DUFF_CELL;
  const variant = activeTerrainVariant();
  const s = variant.sample(seed, x, z);
  const strength = groundCover(seed, x, z, s).duff;
  if (strength < DUFF_STRENGTH_FLOOR) return null;
  const characterDraw = cellDraw(ci, cj, 4);
  return {
    cls: CLUTTER_LITTER,
    x,
    z,
    groundH: s.h,
    groundDx: s.dx,
    groundDz: s.dz,
    scale: 1,
    variant: DUFF_CHARACTER_COUNT,
    hash: cellDraw(ci, cj, 3),
    strength,
    canopy: forestDensity(seed, x, z, s),
    character: duffCharacterFor(characterDraw),
    characterDraw,
  };
}

function duffOrigin(v: number): number {
  return Math.floor(v / DUFF_CELL) * DUFF_CELL;
}

/** Listed cells a slice of the walk classifies before it yields. */
const TIER_SLICE = 4096;

/** The walk, shared by the pure one-shot and the collector that keeps its
 * square (`createDuffCollector`): the same loop over the same rows, in
 * slices for a job (`syncJobs.ts`); the one-shot runs it at once. */
function* collectDuffSlices(camX: number, camZ: number, reach: number, rowsOf: CellRows<DuffCell>): Slices<DuffTiers> {
  const ox = duffOrigin(camX), oz = duffOrigin(camZ);
  const nearHi = DUFF_TIER_EDGE + DUFF_PAD;
  const farLo = Math.max(0, DUFF_TIER_EDGE - DUFF_TIER_BAND - DUFF_PAD);
  const farHi = reach + DUFF_PAD;
  const nearHi2 = nearHi * nearHi, farLo2 = farLo * farLo, farHi2 = farHi * farHi;
  const r = farHi;
  const near: { c: DuffCell; d2: number }[] = [];
  const far: { c: DuffCell; d2: number }[] = [];
  const c0x = Math.floor((ox - r) / DUFF_CELL), c1x = Math.floor((ox + r) / DUFF_CELL);
  const c0z = Math.floor((oz - r) / DUFF_CELL), c1z = Math.floor((oz + r) / DUFF_CELL);
  const rows = yield* rowsOf(0, c0x, c1x, c0z, c1z);
  let listed = 0;
  for (const row of rows) {
    for (const c of row) {
      const dx = c.x - ox, dz = c.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= farHi2) continue;
      if (d2 < nearHi2) near.push({ c, d2 });
      if (d2 >= farLo2) far.push({ c, d2 });
    }
    listed += row.length;
    if (listed >= TIER_SLICE) {
      listed = 0;
      yield;
    }
  }
  // Stable, so cells at one distance keep the walk's order.
  const nearest = (a: { d2: number }, b: { d2: number }) => a.d2 - b.d2;
  near.sort(nearest);
  far.sort(nearest);
  const tiers = { near: near.map((p) => p.c), far: far.map((p) => p.c) };
  yield;
  return tiers;
}

/** The two tier lists around the eye, nearest first, each padded past its
 * band so no eye inside the rebuild cell can want a piece that is absent. */
export function collectDuffCells(seed: number, camX: number, camZ: number, reach: number): DuffTiers {
  return finish(collectDuffSlices(camX, camZ, reach, walkEveryCell((_, ci, cj) => duffCellAt(seed, ci, cj))));
}

export type DuffCollector = {
  /** Identical output to `collectDuffCells(seed, camX, camZ, reach)`. */
  collect(camX: number, camZ: number, reach: number): DuffTiers;
  /** `collect` as slices for a job (`syncJobs.ts`), returning the same lists. */
  collectSlices(camX: number, camZ: number, reach: number): Slices<DuffTiers>;
  /** Cached cell count, for the tests. */
  readonly size: number;
  /** Cells the last collect looked up: those its square added and those a
   * sweep had let go inside it. For the tests. */
  readonly walked: number;
  /**
   * Idle work (`syncJobs.ts`): looks up ahead the cells the next collect
   * will add, that of an eye at (camX, camZ) moving (hx, hz) a frame once it
   * crosses the rebuild line it reaches first, so that the collect finds
   * them cached. `found` is told of each cell and returns its work, as
   * `prefetchWindow` counts it. The lists are what they would be without.
   */
  prefetchSlices(camX: number, camZ: number, hx: number, hz: number, reach: number, found?: (cell: DuffCell) => number): Slices;
};

// Numeric cell key: exact for |index| < 2^20 (±524 km on a 1 m lattice).
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;
/** A cold disc at the high-tier reach (24 m) is about π·(24 + 2.83)²/1 ≈
 * 2,261 cells; a 1 m crossing adds a small fraction of that ring. The
 * collector does not evict until the cache holds this many cells, and even
 * then only down to the retained disc at the eviction radius (reach +
 * DUFF_PAD + 8 · DUFF_CELL ≈ 34.83 m) — about π·34.83²/1 ≈ 3,811 cells — so
 * the sweep runs well inside the 8,000 threshold and is periodic, never per
 * crossing. */
export const DUFF_SWEEP_SIZE = 8000;

/** Cached cells a slice of the eviction sweep looks at before it yields. */
const SWEEP_SLICE = 2048;

/** The memoising collector the shell uses: `duffCellAt` is pure in its cell,
 * so a crossing re-samples only the ring of cells newly inside the disc.
 * Eviction is keyed on the `reach` of the most recent `collect` call, so a
 * quality-tier change that shrinks the reach still sweeps the cells the
 * shrunk disc no longer needs. `release` is told of every cell the sweep
 * lets go, so what the shell keeps beside a cell goes with it. It keeps its
 * last square of cells too (`cellWindow.ts`), so a collect looks up only the
 * cells the square adds, and walks the cells it holds in the same order; a
 * cell the sweep lets go while the square still holds it is looked up again
 * at the next collect, as a walk of every cell would. */
export function createDuffCollector(seed: number, release?: (cell: DuffCell) => void): DuffCollector {
  const cache = new Map<number, DuffCell | null>();
  const square = createCellWindow<DuffCell>();
  const fresh = { count: 0 };
  const lookup = (ci: number, cj: number): DuffCell | null => {
    const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
    let c = cache.get(key);
    if (c === undefined) {
      c = duffCellAt(seed, ci, cj);
      cache.set(key, c);
      fresh.count++;
    }
    return c;
  };
  const rowsOf: CellRows<DuffCell> = function* (_, x0, x1, z0, z1) {
    yield* moveWindow(square, x0, x1, z0, z1, lookup, fresh);
    return square.rows;
  };
  function* collectSlices(camX: number, camZ: number, reach: number): Slices<DuffTiers> {
    const tiers = yield* collectDuffSlices(camX, camZ, reach, rowsOf);
    if (cache.size > DUFF_SWEEP_SIZE) {
      const ox = duffOrigin(camX), oz = duffOrigin(camZ);
      // Cells whose nearest point sits this far past the reach are evicted:
      // the `EVICT_RADIUS = reach + DUFF_PAD + 8 * DUFF_CELL` derivation
      // (the blade field's own `8 * BLADE_CELL` margin), written against
      // `DUFF_CELL` rather than folded to a literal so it stays right if
      // the cell size is ever retuned.
      const evictRadius = reach + DUFF_PAD + 8 * DUFF_CELL;
      const evictRadius2 = evictRadius * evictRadius;
      let looked = 0;
      for (const [key, c] of cache) {
        const cj = (key % KEY_SPAN) - KEY_HALF;
        const ci = Math.floor(key / KEY_SPAN) - KEY_HALF;
        const dx = Math.max(ci * DUFF_CELL - ox, 0, ox - (ci + 1) * DUFF_CELL);
        const dz = Math.max(cj * DUFF_CELL - oz, 0, oz - (cj + 1) * DUFF_CELL);
        if (dx * dx + dz * dz >= evictRadius2) {
          cache.delete(key);
          if (c !== null) release?.(c);
          // A corner cell of the square can lie past the eviction radius
          // and still be held: the next collect looks it up again.
          if (inWindow(square, ci, cj)) square.refresh.push(ci, cj);
        }
        if (++looked % SWEEP_SLICE === 0) yield;
      }
    }
    return tiers;
  }
  function* prefetchSlices(camX: number, camZ: number, hx: number, hz: number, reach: number, found?: (cell: DuffCell) => number): Slices {
    const ahead = new Float64Array(2);
    if (!nextCrossing(camX, camZ, hx, hz, DUFF_REBUILD_CELL, ahead)) return;
    const r = reach + DUFF_PAD;
    const ox = duffOrigin(ahead[0] as number), oz = duffOrigin(ahead[1] as number);
    yield* prefetchWindow(
      square,
      Math.floor((ox - r) / DUFF_CELL), Math.floor((ox + r) / DUFF_CELL), Math.floor((oz - r) / DUFF_CELL), Math.floor((oz + r) / DUFF_CELL),
      lookup, fresh, found,
    );
  }
  return {
    collectSlices,
    prefetchSlices,
    collect(camX: number, camZ: number, reach: number): DuffTiers {
      return finish(collectSlices(camX, camZ, reach));
    },
    get size(): number {
      return cache.size;
    },
    get walked(): number {
      return square.walked;
    },
  };
}
