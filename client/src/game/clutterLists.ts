/**
 * The ground clutter's instance lists: what each bucket of the cards, the
 * plants and the stones is drawn with, made from the bands `clutterField.ts`
 * collects. One list a class, a model (a cut of it, for the stones) and a
 * LOD level, each a matrix and the fade's bands an instance and, for a class
 * that wears the foliage, its ground tint (`instanceLists.ts`); the grass
 * class's lists are cut to the view on the tiers that ask for it
 * (`grassCull.ts`). `lite/clutterMeshes.ts` says what the buckets are and draws
 * them.
 *
 * Loads no engine: the shell that draws the clutter hands these arrays to
 * its meshes, and nothing here knows what a mesh is.
 */
import { CLUTTER_CLASS_COUNT, CLUTTER_MEADOW, type ClutterInstance } from "../sim/clutter.js";
import {
  CLUTTER_MEADOW_NEAR_IN, COVER_RAMP_CLASSES, clutterFadeEdges, clutterSeamEdges, coverBands, coverFarBand, createClutterCollector,
} from "./clutterField.js";
import { CLUTTER_CULLED, FAR_LOD, FOLIAGE_BY_CLASS, NEAR_LOD, cutOf, cutsFor, instanceMatrixFor, trampleFrame, writeFoliage } from "./clutterInstances.js";
import { fadeBands, writeFadeBands, type FadeBands } from "./distanceFade.js";
import type { CullPose } from "./grassCull.js";
import {
  KEPT_FOLIAGE, KEPT_STRIDE, commitStaged, createInstanceList, createViewCut, cutList, ensureStaging, stageKept, type InstanceList,
} from "./instanceLists.js";
import { createKeptValues } from "./keptValues.js";
import type { Slices } from "./syncJobs.js";

/** One matrix's worth of scratch floats, so an instance's matrix can be
 * composed and copied into the kept values at any offset without a
 * per-instance subarray view. */
const scratchMat = new Float32Array(16);

/** Instances' worth of work a slice of the clutter's fill does before it
 * yields: an instance whose values are copied counts 1, one computed for the
 * first time `FILL_NEW_COST` — its trample frame and ground tint are several
 * walks through the terrain's noise. About a tenth of a millisecond. */
const FILL_SLICE = 1536;
const FILL_NEW_COST = 16;

/** What computing an instance's kept values ahead weighs on a slice of idle
 * work, in `prefetchWindow`'s units: about what sampling a cell does. */
const KEPT_AHEAD_COST = 64;

/** One bucket's list, and what its instances' fade bands are drawn from. */
export type ClutterBucket = {
  readonly cls: number;
  readonly lod: number;
  readonly list: InstanceList;
  /** The constant every instance of this bucket carries, or on a ramped
   * bucket (`COVER_RAMP_CLASSES`, the far level) the bands each instance's
   * own are drawn from (`rampBands`). */
  readonly fade: FadeBands;
  readonly ramp: boolean;
  /** The far band (`coverFarBand`) on the far level of a class that has one:
   * a card not kept past it goes out across this band (`coverBands`). */
  readonly far: readonly [number, number] | null;
};

/**
 * The bands a bucket of class `cls` at LOD level `lod` fades across. Every
 * class dithers toward its disc edge, and across its near/far seam: the near
 * level fades out over the seam, the far level in over the seam and out over
 * the edge.
 *
 * The meadow's near cards stand under the blade field on the tiers that draw
 * it (`nearBlades`), and dither in from the eye there so none stands as a
 * flat plane at the feet. They do so on those tiers whether or not blades
 * grow at a given spot, so where the grass gate sits under the field's floor
 * the meadow cards thin inside 2.5 m and are gone inside 1 m with nothing in
 * their place. Every other near bucket draws all the way in, as does the
 * meadow's on the low tier, which has no blades. The grass class's near
 * cards in particular are never cut: the blades only grow where the grass
 * gate clears the field's floor, so an in-band there would take away the
 * last cover standing. For the grass class the field may only ever ADD to
 * the near field.
 */
export function clutterBucketFade(cls: number, lod: number, radiusScale: number, nearBlades: boolean): FadeBands {
  const edge = clutterFadeEdges(cls, radiusScale);
  const seam = clutterSeamEdges(cls, radiusScale);
  const nearIn = nearBlades && cls === CLUTTER_MEADOW ? CLUTTER_MEADOW_NEAR_IN : null;
  return lod === NEAR_LOD ? fadeBands(nearIn, [seam.start, seam.end]) : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
}

export type ClutterListsOptions = {
  /** Scales every class radius together: the quality tier's knob (low ≈ 60% radii). */
  radiusScale: number;
  /** The blade field draws over the meadow's near cards on this tier. */
  nearBlades: boolean;
  /** Filter the `CLUTTER_CULLED` classes' lists to the view. */
  cull: boolean;
  /** The bucket rows each class has: its models, times its cuts (`cutsFor`). */
  rows: readonly number[];
};

export type ClutterLists = {
  /** `buckets[class][variant * cutsFor(class) + cut][lod]` — plain
   * `[class][variant][lod]` for every class outside `CUT_CLASSES`, where
   * `cutsFor` is 1 and the cut is always 0. */
  readonly buckets: readonly (readonly (readonly ClutterBucket[])[])[];
  /** Every bucket, class by class, row by row, the near level before the far. */
  readonly all: readonly ClutterBucket[];
  /**
   * Rebuild, as slices (`syncJobs.ts`): the bands collected, then two passes
   * over them, so every list knows its size before a single matrix is
   * written and no buffer has to grow mid-fill. Pass 1 counts, pass 2 writes
   * each list's staging buffers (`stagedCount` the cursor), copying each
   * instance's kept matrix and tint and computing them only for an instance
   * listed for the first time, and yields by the work done (`FILL_SLICE`).
   * The last slice copies every list's staged instances into the buffers it
   * draws (a culled list's collected ones), all in one step, so no frame
   * draws a bucket half rebuilt. A list that outgrew its arrays says so
   * (`grown`).
   */
  rebuild(x: number, z: number): Slices;
  /** Idle work (`syncJobs.ts`): the cells the next crossings from (x, z) on the heading add, looked up and their values computed ahead. */
  prefetch(x: number, z: number, headingX: number, headingZ: number): Slices;
  /**
   * Cuts the culled lists to the frustum of `pose` widened by `CULL_MARGIN`
   * (`grassCull.ts`), after a rebuild or once the view has moved past the
   * thresholds, and does nothing otherwise, or where no list is culled;
   * `null` keeps every collected instance. `changed` is called with each
   * bucket whose drawn prefix is no longer the last cut's.
   */
  cut(pose: CullPose | null, changed: (bucket: ClutterBucket) => void): void;
  /** Forgets the cut of every culled list that holds drawn buffers: they were handed back, so the next cut is made and reported. */
  forgetCuts(): void;
  /** The camera position the buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /** Instances whose matrix and tint are kept (`keptValues.ts`). */
  readonly kept: number;
};

export function createClutterLists(seed: number, options: ClutterListsOptions): ClutterLists {
  const { radiusScale, nearBlades } = options;
  /**
   * An instance's matrix, and its tint for a class that wears the foliage,
   * computed the first time it is listed. Both are functions of the instance
   * and the seed alone: the trample frame is the trail's, the tint the
   * ground under it. The band an instance is listed in picks its bucket and
   * its fade bands, both written per bucket at the fill, never its matrix or
   * tint: a seam instance listed in both bands draws the same values in
   * each. Nothing here depends on the eye, the tier's radius, the time or
   * the wind.
   */
  function computeInstance(inst: ClutterInstance, out: Float32Array, offset: number): void {
    const frame = trampleFrame(seed, inst);
    instanceMatrixFor(inst, frame, scratchMat);
    out.set(scratchMat, offset);
    if (FOLIAGE_BY_CLASS.has(inst.cls)) writeFoliage(seed, inst, out, offset + KEPT_FOLIAGE, frame);
  }
  const kept = createKeptValues<ClutterInstance>(KEPT_STRIDE, computeInstance);
  // Memoizing collector, not the pure `collectClutter`: a rebuild happens on
  // every 3 m grass-cell crossing, and re-sampling every disc from cold each
  // time would pay fresh density and terrain samples for thousands of cells
  // that have not moved (see clutterField.ts). An instance it lets go takes
  // its kept values with it.
  const collector = createClutterCollector(seed, (inst) => kept.release(inst));

  const buckets: ClutterBucket[][][] = [];
  const all: ClutterBucket[] = [];
  for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
    const tints = FOLIAGE_BY_CLASS.has(cls);
    const culled = options.cull && CLUTTER_CULLED.has(cls);
    const rows: ClutterBucket[][] = [];
    for (let row = 0; row < (options.rows[cls] ?? 0); row++) {
      const perLod: ClutterBucket[] = [];
      for (const lod of [NEAR_LOD, FAR_LOD]) {
        const bucket: ClutterBucket = {
          cls, lod,
          list: createInstanceList({ bands: true, foliage: tints, strength: false }, culled),
          fade: clutterBucketFade(cls, lod, radiusScale, nearBlades),
          ramp: lod === FAR_LOD && COVER_RAMP_CLASSES.has(cls),
          far: lod === FAR_LOD ? coverFarBand(cls, radiusScale) : null,
        };
        perLod.push(bucket);
        all.push(bucket);
      }
      rows.push(perLod);
    }
    buckets.push(rows);
  }
  const culledBuckets = all.filter((bucket) => bucket.list.culled);
  const viewCut = createViewCut();
  const view = { x: NaN, z: NaN };

  /**
   * The bucket an instance belongs in. Indexing by the sim's own `variant`
   * draw is the whole variant mechanism; for the cut classes each model also
   * spreads across `cutsFor(inst.cls)` fractures, so the row is
   * `variant * cuts + cut` — for every other class `cuts` is 1 and `cutOf`
   * is always 0, so this collapses back to plain `variant` indexing. The
   * fallback to the first row covers only a model table that has fallen
   * behind the sim's per-class `variants` count, where crashing the frame
   * would be the worse failure.
   */
  function bucketFor(rows: ClutterBucket[][], inst: ClutterInstance, lod: number): ClutterBucket {
    const cuts = cutsFor(inst.cls);
    const perLod = rows[inst.variant * cuts + cutOf(inst)] ?? (rows[0] as ClutterBucket[]);
    return perLod[lod] as ClutterBucket;
  }

  /** One instance at a bucket's staging cursor: its kept matrix (and the
   * origin a culled list tests), the bucket's fade bands, and its kept tint
   * where the bucket wears the foliage. */
  function stageInstance(bucket: ClutterBucket, inst: ClutterInstance): void {
    const at = kept.offsetOf(inst);
    const i = stageKept(bucket.list, kept.data, at);
    writeFadeBands(bucket.list.staged.bands, i * 4, coverBands(bucket.fade, bucket.ramp, bucket.far, inst.hash));
  }

  /** An instance looked up ahead: its matrix and tint computed too, so the
   * fill at the crossing only copies them. */
  const ahead = (inst: ClutterInstance): number => {
    const known = kept.size;
    kept.offsetOf(inst);
    return kept.size > known ? KEPT_AHEAD_COST : 1;
  };

  return {
    buckets,
    all,
    *rebuild(x, z) {
      const bands = yield* collector.collectSlices(x, z, radiusScale);
      yield;

      for (const bucket of all) bucket.list.stagedCount = 0;
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        const rows = buckets[cls] as ClutterBucket[][];
        const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[] };
        for (const inst of band.near) bucketFor(rows, inst, NEAR_LOD).list.stagedCount++;
        for (const inst of band.far) bucketFor(rows, inst, FAR_LOD).list.stagedCount++;
        // A class's count is a pass over its lists, the meadow's thousands long.
        yield;
      }
      for (const bucket of all) {
        ensureStaging(bucket.list);
        bucket.list.stagedCount = 0;
      }
      let work = 0;
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        const rows = buckets[cls] as ClutterBucket[][];
        const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[] };
        for (let lod = NEAR_LOD; lod <= FAR_LOD; lod++) {
          for (const inst of lod === NEAR_LOD ? band.near : band.far) {
            const known = kept.size;
            stageInstance(bucketFor(rows, inst, lod), inst);
            work += kept.size > known ? FILL_NEW_COST : 1;
            if (work >= FILL_SLICE) {
              work = 0;
              yield;
            }
          }
        }
      }

      for (const bucket of all) commitStaged(bucket.list);
      viewCut.invalidate();
      view.x = x;
      view.z = z;
    },
    prefetch(x, z, headingX, headingZ) {
      return collector.prefetchSlices(x, z, headingX, headingZ, radiusScale, ahead);
    },
    cut(pose, changed) {
      if (culledBuckets.length === 0) return;
      const planes = viewCut.planesFor(pose);
      if (planes === null) return;
      for (let i = 0; i < culledBuckets.length; i++) {
        const bucket = culledBuckets[i] as ClutterBucket;
        if (cutList(bucket.list, planes)) changed(bucket);
      }
    },
    forgetCuts() {
      for (const bucket of culledBuckets) {
        const { list } = bucket;
        if (list.cull !== null && list.drawn.buf.length > 0) list.cull.kept = -1;
      }
      viewCut.invalidate();
    },
    view,
    get kept() {
      return kept.size;
    },
  };
}
