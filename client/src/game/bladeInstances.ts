/**
 * The blade field's instance lists: what each bucket of the grass is drawn
 * with, made from the tier lists `bladeField.ts` collects. One list a clump
 * character, distance tier and size, each a matrix, a ground tint and a
 * strength an instance (`instanceLists.ts`), filled with the clutter's own
 * matrix, trample and tint writers (`clutterInstances.ts`), and cut to the
 * view (`grassCull.ts`). `lite/bladeMeshes.ts` says what the buckets are and
 * draws them.
 *
 * Loads no engine: the shell that draws the grass hands these arrays to its
 * meshes, and nothing here knows what a mesh is.
 */
import type { Rgb } from "./colour.js";
import { BLADE_CHARACTER_COUNT, BLADE_SIZE_COUNT, createBladeCollector, type BladeCell, type BladeTiers } from "./bladeField.js";
import { instanceMatrixFor, trampleFrame, writeFoliage } from "./clutterInstances.js";
import type { CullPose } from "./grassCull.js";
import {
  KEPT_FOLIAGE, KEPT_STRIDE, commitStaged, createInstanceList, createViewCut, cutList, ensureStaging, stageKept, type InstanceList,
} from "./instanceLists.js";
import { createKeptValues } from "./keptValues.js";
import { sliceDue, type Slices } from "./syncJobs.js";

/** The distance tiers a clump is drawn in: fine, mid, coarse. */
export const BLADE_TIER_COUNT = 3;

/** A cell's height scale at strength 0 and 1 (`strength`, the clamped
 * [0, 1] cut — never the unclamped `cover` a cell's `size` was chosen from). */
export const BLADE_STRENGTH_HEIGHT: readonly [number, number] = [0.5, 1];
/** A cell's height scale under full canopy: 1, so the canopy no longer
 * shortens the sward on its own — a cell's strength alone carries the height. */
export const BLADE_CANOPY_HEIGHT = 1;

/** A cell's height scale: the strength cut between BLADE_STRENGTH_HEIGHT's
 * ends, then the canopy's own scale toward BLADE_CANOPY_HEIGHT. */
export function bladeHeightScale(strength: number, canopy: number): number {
  return (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * strength) *
    (1 + (BLADE_CANOPY_HEIGHT - 1) * canopy);
}

/** The blades' material's roughness. */
export const BLADE_ROUGHNESS = 0.8;

/** Every list of the field carries the ground tint and the strength, and is cut to the view; none carries the fade's bands. */
const BLADE_STREAMS = { bands: false, foliage: true, strength: true } as const;

/** One matrix's worth of scratch floats, so a cell's matrix can be composed
 * and copied into the kept values at any offset without a per-instance
 * subarray view. */
const scratchMat = new Float32Array(16);
/** The frame handed to `instanceMatrixFor`: the bench's own trample frame with
 * the height scaled by the cell's strength and canopy. Module-level and
 * rewritten per cell, because a walk computes thousands of cells and an
 * object per cell is exactly the allocation the fill rules out. */
const scratchFrame: { height: number; lean: number; ax: number; az: number; tint: Rgb } = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

/** Cells' worth of work a slice of a fill does before it yields: a cell whose
 * values are copied counts 1, one computed for the first time
 * `FILL_NEW_COST` — its trample frame and ground tint are several walks
 * through the terrain's noise. About a tenth of a millisecond. */
const FILL_SLICE = 1024;
const FILL_NEW_COST = 16;
/** Work (in those units) that counts as one unit of the scheduler's clock (`sliceDue`): a cell computed for the first
 * time is four, one copied a quarter. A slice ends by the clock as well as by the count. */
const FILL_CLOCK_WORK = 4;

/** What computing a cell's kept values ahead weighs on a slice of idle work,
 * in `prefetchWindow`'s units: about what sampling a cell does. */
const KEPT_AHEAD_COST = 64;

export type BladeLists = {
  /** `lists[tier][character][size]`. */
  readonly lists: readonly (readonly (readonly InstanceList[])[])[];
  /** Every list, in tier-then-character-then-size order. */
  readonly all: readonly InstanceList[];
  /**
   * The rebuild for an eye at (x, z), as slices (`syncJobs.ts`): the tier
   * lists collected, the three tiers staged, then all three copied into the
   * collected buffers a cut reads in the last slice, in one step, so no cut
   * ever reads a list half written. A list that outgrew its arrays says so
   * (`grown`): its mesh wants the new drawn buffers.
   */
  rebuild(x: number, z: number): Slices;
  /** Idle work (`syncJobs.ts`): the cells the next crossings from (x, z) on `heading` add, looked up and their values computed ahead. */
  prefetch(x: number, z: number, headingX: number, headingZ: number): Slices;
  /**
   * Cuts every list to the frustum of `pose` widened by `CULL_MARGIN`
   * (`grassCull.ts`), after a rebuild or once the view has moved past the
   * thresholds, and does nothing otherwise; `null` keeps every collected
   * cell. `changed` is called with each list whose drawn prefix is no longer
   * the last cut's, and its index in `all`: its mesh wants the prefix again.
   */
  cut(pose: CullPose | null, changed: (list: InstanceList, index: number) => void): void;
  /** Forgets every cut: the drawn buffers were handed back, so the next cut is made and reported for every list. */
  forgetCuts(): void;
  /** The eye position the collected buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /** Cells whose matrix and tint are kept (`keptValues.ts`). */
  readonly kept: number;
};

export function createBladeLists(seed: number): BladeLists {
  /**
   * A cell's matrix and tint, computed the first time it is listed. Both are
   * functions of the cell and the seed alone: the trample frame is the
   * trail's, the height scale the cell's own strength and canopy, the tint
   * the ground under it. Nothing in them depends on the eye, the tier the
   * cell is listed in (a cell in two tiers' lists draws the same clump in
   * each), the time or the wind. The strength is the cell's own field.
   */
  function computeCell(c: BladeCell, out: Float32Array, offset: number): void {
    const frame = trampleFrame(seed, c);
    // A thin sward is short as well as sparse: bladeHeightScale carries that.
    const heightScale = bladeHeightScale(c.strength, c.canopy);
    // `trampleFrame` returns a SHARED scratch object, valid only until the
    // next call. The copy below exists so the height can be scaled without
    // writing through to it, and it copies `tint` only to stay a faithful
    // frame — `instanceMatrixFor` reads height, lean and the axis, never the
    // tint, so that field is inert here. The live read of the shared frame
    // is `writeFoliage`'s `frame.tint`, which is why the order (frame,
    // matrix, foliage) must stay inside one call: hoisting `writeFoliage`
    // past the next `trampleFrame` would stain this cell with the following
    // cell's bench tint. Only values are kept, never the frame.
    scratchFrame.height = frame.height * heightScale;
    scratchFrame.lean = frame.lean;
    scratchFrame.ax = frame.ax;
    scratchFrame.az = frame.az;
    scratchFrame.tint = frame.tint;
    instanceMatrixFor(c, scratchFrame, scratchMat);
    out.set(scratchMat, offset);
    writeFoliage(seed, c, out, offset + KEPT_FOLIAGE, frame);
  }
  const kept = createKeptValues<BladeCell>(KEPT_STRIDE, computeCell);
  // Memoizing collector, not the pure `collectBladeCells`: a rebuild happens
  // on every 1 m crossing, and re-sampling the whole disc from cold each time
  // would pay fresh gate, terrain and density samples for thousands of cells
  // that have not moved (see bladeField.ts). A cell it lets go takes its kept
  // values with it.
  const collector = createBladeCollector(seed, (c) => kept.release(c));
  const lists: InstanceList[][][] = [];
  const all: InstanceList[] = [];
  for (let tier = 0; tier < BLADE_TIER_COUNT; tier++) {
    const row: InstanceList[][] = [];
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      const sizes: InstanceList[] = [];
      for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
        const list = createInstanceList(BLADE_STREAMS, true);
        sizes.push(list);
        all.push(list);
      }
      row.push(sizes);
    }
    lists.push(row);
  }
  const viewCut = createViewCut();
  const view = { x: NaN, z: NaN };

  /**
   * One tier's fill, as slices: two passes over its list, so every list
   * knows its size before a single matrix is written and no buffer has to
   * grow mid-fill. Pass 1 counts, `ensureStaging` grows what it must, pass 2
   * writes each list's staging buffers (`stagedCount` the cursor). The tier
   * arrives nearest-first from the field and is walked in order, so each
   * list's instances stay sorted by distance. Pass 2 copies each cell's
   * kept matrix and tint, computing them only for a cell listed for the
   * first time (`computeCell`), and yields by the work done: a cell computed
   * counts as `FILL_NEW_COST` copied ones.
   */
  function* stage(cells: BladeCell[], row: InstanceList[][]): Slices {
    for (const sizes of row) for (const list of sizes) list.stagedCount = 0;
    for (const c of cells) (row[c.character] as InstanceList[])[c.size]!.stagedCount++;
    for (const sizes of row) for (const list of sizes) {
      ensureStaging(list);
      list.stagedCount = 0;
    }
    yield;
    let work = 0;
    for (const c of cells) {
      const list = (row[c.character] as InstanceList[])[c.size] as InstanceList;
      const known = kept.size;
      const at = kept.offsetOf(c);
      const i = stageKept(list, kept.data, at);
      list.staged.strength[i] = c.strength;
      const cost = kept.size > known ? FILL_NEW_COST : 1;
      work += cost;
      const ended = sliceDue(cost / FILL_CLOCK_WORK);
      if (work >= FILL_SLICE || ended) {
        work = 0;
        yield;
      }
    }
  }

  /** A cell looked up ahead: its matrix and tint computed too, so the fill at
   * the crossing only copies them. */
  const ahead = (c: BladeCell): number => {
    const known = kept.size;
    kept.offsetOf(c);
    return kept.size > known ? KEPT_AHEAD_COST : 1;
  };

  return {
    lists,
    all,
    *rebuild(x, z) {
      const tiers: BladeTiers = yield* collector.collectSlices(x, z);
      yield;
      yield* stage(tiers.fine, lists[0] as InstanceList[][]);
      yield* stage(tiers.mid, lists[1] as InstanceList[][]);
      yield* stage(tiers.coarse, lists[2] as InstanceList[][]);
      for (const list of all) commitStaged(list);
      viewCut.invalidate();
      view.x = x;
      view.z = z;
    },
    prefetch(x, z, headingX, headingZ) {
      return collector.prefetchSlices(x, z, headingX, headingZ, ahead);
    },
    cut(pose, changed) {
      const planes = viewCut.planesFor(pose);
      if (planes === null) return;
      for (let index = 0; index < all.length; index++) {
        const list = all[index] as InstanceList;
        if (cutList(list, planes)) changed(list, index);
      }
    },
    forgetCuts() {
      // A list that never grew holds no drawn buffer to have been handed back: its cut stands.
      for (const list of all) if (list.cull !== null && list.drawn.buf.length > 0) list.cull.kept = -1;
      viewCut.invalidate();
    },
    view,
    get kept() {
      return kept.size;
    },
  };
}
