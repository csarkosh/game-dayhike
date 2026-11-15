/**
 * The duff field's instance lists: what each bucket of the dead leaves,
 * twigs and small branches is drawn with, made from the tier lists
 * `duffField.ts` collects. One list a clump character and distance tier,
 * each a matrix, a ground tint and a strength an instance
 * (`instanceLists.ts`), filled with the clutter's own matrix and tint
 * writers (`clutterInstances.ts`). `bladeInstances.ts`'s sibling: the
 * differences are the field's own — two tiers, not three, no size axis, and
 * no cut to the view. `duffMeshes.ts` says what the buckets are and draws
 * them.
 *
 * Loads no engine: the shell that draws the duff hands these arrays to its
 * meshes, and nothing here knows what a mesh is.
 */
import { CLUTTER_SINK, instanceMatrixFor, trampleFrame, writeFoliage } from "./clutterInstances.js";
import { DUFF_CHARACTER_COUNT } from "./duffClump.js";
import { createDuffCollector, type DuffCell, type DuffTiers } from "./duffField.js";
import { KEPT_FOLIAGE, KEPT_STRIDE, createInstanceList, ensureCapacity, writeKept, type InstanceList } from "./instanceLists.js";
import { createKeptValues } from "./keptValues.js";
import type { Slices } from "./syncJobs.js";

/** The distance tiers a clump is drawn in: near, far. */
export const DUFF_TIER_COUNT = 2;

/** The duff's material's roughness: duller than the blades' 0.8 — dead leaf litter
 * scatters light more diffusely than a living blade's waxy surface. */
export const DUFF_ROUGHNESS = 0.9;

/** Every list of the field carries the ground tint and the strength; none carries the fade's bands, and none is cut to the view. */
const DUFF_STREAMS = { bands: false, foliage: true, strength: true } as const;

/** One matrix's worth of scratch floats, so a cell's matrix can be composed
 * and copied into the kept values at any offset without a per-instance
 * subarray view. */
const scratchMat = new Float32Array(16);
/** The Y translation's index in a matrix's flat 16-float array: the
 * translation occupies indices 12-14, column-major. */
const MATRIX_TY = 13;

/** What computing a cell's kept values ahead weighs on a slice of idle work,
 * in `prefetchWindow`'s units: about what sampling a cell does. */
const KEPT_AHEAD_COST = 64;

export type DuffLists = {
  /** `lists[tier][character]`. */
  readonly lists: readonly (readonly InstanceList[])[];
  /** Every list, in tier-then-character order. */
  readonly all: readonly InstanceList[];
  /**
   * The rebuild for an eye at (x, z), as slices (`syncJobs.ts`): the tier
   * lists collected, then both fills in the last slice. The fills write the
   * very buffers the meshes hold, so they run in one step. A list that
   * outgrew its arrays says so (`grown`).
   */
  rebuild(x: number, z: number): Slices;
  /** Idle work (`syncJobs.ts`): the cells the next crossings from (x, z) on the heading add, looked up and their values computed ahead. */
  prefetch(x: number, z: number, headingX: number, headingZ: number): Slices;
  /** The eye position the buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /** Cells whose matrix and tint are kept (`keptValues.ts`). */
  readonly kept: number;
};

/** The lists of a duff field drawn out to `reach` metres (`DUFF_REACH`, the quality tier's). */
export function createDuffLists(seed: number, reach: number): DuffLists {
  /**
   * A cell's matrix and tint, computed the first time it is listed: functions
   * of the cell and the seed alone, the blade lists' own reasoning. The
   * reach, the one thing the tier changes, decides only which cells are
   * listed, never what a listed cell draws.
   */
  function computeCell(c: DuffCell, out: Float32Array, offset: number): void {
    // The litter class is not trampled, so this is always the identity
    // frame for duff — called anyway, rather than skipped, so the fill
    // walks the same path the blades' does and the two stay comparable;
    // nobody later has to wonder whether duff is meant to flatten near the
    // trail and does not.
    const frame = trampleFrame(seed, c);
    instanceMatrixFor(c, frame, scratchMat);
    // `instanceMatrixFor` sinks every non-boulder instance CLUTTER_SINK
    // (2 cm) below its sampled ground height, on the reasoning that "two
    // centimetres is under a blade's width, so nothing visibly shortens"
    // (clutterInstances.ts). That holds for a blade root, a rock's flattened
    // underside or a grass card's base edge, whose own root sits well
    // clear of the ground it is meant to settle into — but not for duff,
    // whose root ring is built to lie exactly at the sampled ground
    // height, y = 0 (duffClump.ts: "Roots lie on a disc... at y = 0"), even
    // though a piece's own far vertices rise well above that: the leaf
    // character's own geometry rises to about 96 mm (80% of
    // `DUFF_HEIGHT_MAX`, duffClump.ts). Sinking the root 2 cm would still
    // settle it into the terrain rather than leave it lying on top, so the
    // sink is cancelled here, per-instance, rather than by changing
    // `instanceMatrixFor` itself, which every other clutter class still
    // relies on. This restores the piece's root ring to sit exactly at the
    // sampled ground height, the same plane its own vertices are built
    // against.
    scratchMat[MATRIX_TY] = (scratchMat[MATRIX_TY] as number) + CLUTTER_SINK;
    out.set(scratchMat, offset);
    writeFoliage(seed, c, out, offset + KEPT_FOLIAGE, frame);
  }
  const kept = createKeptValues<DuffCell>(KEPT_STRIDE, computeCell);
  // Memoizing collector, not the pure `collectDuffCells`: a rebuild happens on
  // every 1 m crossing, and re-sampling the whole disc from cold each time
  // would pay fresh gate, terrain and density samples for thousands of cells
  // that have not moved (see duffField.ts). A cell it lets go takes its kept
  // values with it.
  const collector = createDuffCollector(seed, (c) => kept.release(c));
  const lists: InstanceList[][] = [];
  const all: InstanceList[] = [];
  for (let tier = 0; tier < DUFF_TIER_COUNT; tier++) {
    const row: InstanceList[] = [];
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      const list = createInstanceList(DUFF_STREAMS, false);
      row.push(list);
      all.push(list);
    }
    lists.push(row);
  }
  const view = { x: NaN, z: NaN };

  /**
   * One tier's fill: two passes over its cells, so every list knows its size
   * before a single matrix is written and no buffer has to grow mid-fill.
   * The tier arrives nearest-first from the field and is walked in order, so
   * each list's instances stay sorted by distance. Pass 2 copies each
   * cell's kept matrix and tint, computing them only for a cell listed for
   * the first time (`computeCell`).
   */
  function fill(cells: DuffCell[], row: InstanceList[]): void {
    for (const list of row) list.count = 0;
    for (const c of cells) (row[c.character] as InstanceList).count++;
    for (const list of row) {
      ensureCapacity(list);
      list.count = 0;
    }
    for (const c of cells) {
      const list = row[c.character] as InstanceList;
      const at = kept.offsetOf(c);
      writeKept(list, list, list.count, kept.data, at);
      list.strength[list.count] = c.strength;
      list.count++;
    }
  }

  /** A cell looked up ahead: its matrix and tint computed too. */
  const ahead = (c: DuffCell): number => {
    const known = kept.size;
    kept.offsetOf(c);
    return kept.size > known ? KEPT_AHEAD_COST : 1;
  };

  return {
    lists,
    all,
    *rebuild(x, z) {
      const tiers: DuffTiers = yield* collector.collectSlices(x, z, reach);
      yield;
      fill(tiers.near, lists[0] as InstanceList[]);
      fill(tiers.far, lists[1] as InstanceList[]);
      view.x = x;
      view.z = z;
    },
    prefetch(x, z, headingX, headingZ) {
      return collector.prefetchSlices(x, z, headingX, headingZ, reach, ahead);
    },
    view,
    get kept() {
      return kept.size;
    },
  };
}
