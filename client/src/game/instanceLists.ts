/**
 * The instance lists a ground-cover shell draws its buckets from, as typed
 * arrays: a matrix an instance and, beside it, the per-instance streams the
 * bucket's material reads (the fade's bands, the ground tint, a blade
 * clump's strength). A list is one bucket's worth, reused across rebuilds
 * and grown by doubling, never per rebuild.
 *
 * A rebuild in slices writes a list's STAGING buffers first and copies them
 * across in its last slice (`commitStaged`), so nothing that is drawn or cut
 * changes until then. A list filtered to the view (`grassCull.ts`) keeps the
 * COLLECTED buffers the rebuild writes on the CPU and beside them the DRAWN
 * ones its mesh holds, the kept instances at their front (`cutList`); every
 * other list's mesh holds the collected buffers themselves.
 *
 * Loads no engine: a shell hands these arrays to its meshes, and nothing
 * here knows what a mesh is.
 */
import { cullPlanes, cullPrefix, cullSet, needsCull, type CullPair, type CullPose, type CullSet } from "./grassCull.js";

/** Instances a list's first real allocation covers: a bucket settles after a few doublings from here. */
export const LIST_MIN_INSTANCES = 64;

/** Floats kept an instance (`keptValues.ts`): the matrix (16), then the tint (4). */
export const KEPT_STRIDE = 20;
export const KEPT_FOLIAGE = 16;

/** Shared zero-length placeholder for a list that has never held an
 * instance, or a stream the list does not carry: nothing reads or writes it. */
const EMPTY_BUFFER = new Float32Array(0);

/** The streams a list carries beside its matrices. */
export type ListStreams = {
  /** Four floats an instance: the `fadeBands` attribute. */
  readonly bands: boolean;
  /** Four floats an instance: the `foliage` attribute, the ground's colour and the sky's openness. */
  readonly foliage: boolean;
  /** One float an instance: the `bladeStrength` attribute. */
  readonly strength: boolean;
};

/** A list's arrays: sixteen floats of matrix an instance in `buf`, and each stream the list carries (empty otherwise). */
export type ListBuffers = { buf: Float32Array; bands: Float32Array; foliage: Float32Array; strength: Float32Array };

export type InstanceList = ListBuffers & {
  readonly streams: ListStreams;
  /** Filtered to the view: `buf` and the streams are then the collected buffers, and the mesh holds `drawn`. */
  readonly culled: boolean;
  /** Instances this rebuild: counted, then the write cursor of a fill that writes the list directly. */
  count: number;
  /** Set when the arrays were replaced by larger ones: the mesh then needs them handed over again. */
  grown: boolean;
  /** A culled list's drawn buffers, the collected ones' capacity each, the kept prefix at the front; empty otherwise. */
  drawn: ListBuffers;
  /** A culled list's translations, x, y, z an instance: what the cut tests. */
  origins: Float32Array;
  /** A culled list's buffers as `cullPrefix` walks them, with the last cut's indices; null otherwise. */
  cull: CullSet | null;
  /** Where a rebuild in slices writes first. */
  staged: ListBuffers & { origins: Float32Array };
  /** Instances staged: counted, then the write cursor, as `count` is. */
  stagedCount: number;
};

function emptyBuffers(): ListBuffers {
  return { buf: EMPTY_BUFFER, bands: EMPTY_BUFFER, foliage: EMPTY_BUFFER, strength: EMPTY_BUFFER };
}

function buffersFor(streams: ListStreams, capacity: number): ListBuffers {
  // 16 floats of matrix an instance ↔ 4 of bands or foliage ↔ 1 of strength.
  return {
    buf: new Float32Array(capacity),
    bands: streams.bands ? new Float32Array(capacity / 4) : EMPTY_BUFFER,
    foliage: streams.foliage ? new Float32Array(capacity / 4) : EMPTY_BUFFER,
    strength: streams.strength ? new Float32Array(capacity / 16) : EMPTY_BUFFER,
  };
}

function cullSetFor(list: InstanceList, capacity: number): CullSet {
  const vec4: CullPair[] = [];
  if (list.streams.bands) vec4.push({ src: list.bands, dst: list.drawn.bands });
  if (list.streams.foliage) vec4.push({ src: list.foliage, dst: list.drawn.foliage });
  const scalar: CullPair[] = list.streams.strength ? [{ src: list.strength, dst: list.drawn.strength }] : [];
  return cullSet(capacity, list.origins, { src: list.buf, dst: list.drawn.buf }, vec4, scalar);
}

/** A list that holds nothing yet, carrying `streams`, filtered to the view or not. */
export function createInstanceList(streams: ListStreams, culled: boolean): InstanceList {
  const list: InstanceList = {
    ...emptyBuffers(), streams, culled, count: 0, grown: false, drawn: emptyBuffers(), origins: EMPTY_BUFFER, cull: null,
    staged: { ...emptyBuffers(), origins: EMPTY_BUFFER }, stagedCount: 0,
  };
  if (culled) list.cull = cullSetFor(list, 0);
  return list;
}

/** The floats of matrix a list of `needed` holds: doubled from `LIST_MIN_INSTANCES` until it fits. */
function grownCapacity(held: number, needed: number): number {
  let capacity = Math.max(held, LIST_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  return capacity;
}

/**
 * Grows a list's arrays to hold `list.count` instances if they do not
 * already, doubling from `LIST_MIN_INSTANCES` so a list allocates a bounded
 * number of times over a session and never per rebuild. The old contents are
 * dropped rather than copied: every live instance is rewritten immediately
 * afterwards. A culled list takes new drawn buffers and a new cut with them.
 */
export function ensureCapacity(list: InstanceList): void {
  const needed = list.count * 16;
  if (list.buf.length >= needed) {
    list.grown = false;
    return;
  }
  const capacity = grownCapacity(list.buf.length, needed);
  Object.assign(list, buffersFor(list.streams, capacity));
  if (list.culled) {
    list.drawn = buffersFor(list.streams, capacity);
    list.origins = new Float32Array((capacity / 16) * 3);
    list.cull = cullSetFor(list, capacity / 16);
  }
  list.grown = true;
}

/** Grows a list's staging buffers to hold `list.stagedCount` instances, by `ensureCapacity`'s doubling; old contents are dropped, as there. */
export function ensureStaging(list: InstanceList): void {
  const needed = list.stagedCount * 16;
  if (list.staged.buf.length >= needed) return;
  const capacity = grownCapacity(list.staged.buf.length, needed);
  list.staged = { ...buffersFor(list.streams, capacity), origins: list.culled ? new Float32Array((capacity / 16) * 3) : EMPTY_BUFFER };
}

/**
 * One instance's kept values (`KEPT_STRIDE` floats at `at` of `data`) into
 * `into` at instance `i`: its matrix, the translation a culled list's cut
 * tests, and its tint where the list carries one.
 */
export function writeKept(list: InstanceList, into: ListBuffers & { origins: Float32Array }, i: number, data: Float32Array, at: number): void {
  const { buf } = into;
  const m = i * 16;
  for (let k = 0; k < 16; k++) buf[m + k] = data[at + k] as number;
  if (list.culled) {
    const o = i * 3;
    into.origins[o] = buf[m + 12] as number;
    into.origins[o + 1] = buf[m + 13] as number;
    into.origins[o + 2] = buf[m + 14] as number;
  }
  if (list.streams.foliage) {
    const { foliage } = into;
    const f = i * 4;
    for (let k = 0; k < 4; k++) foliage[f + k] = data[at + KEPT_FOLIAGE + k] as number;
  }
}

/** One instance's kept values at a list's staging cursor, which moves on: the index it was staged at. */
export function stageKept(list: InstanceList, data: Float32Array, at: number): number {
  const i = list.stagedCount++;
  writeKept(list, list.staged, i, data, at);
  return i;
}

/**
 * Copies a list's staged instances into the buffers its mesh draws from (the
 * collected ones, for a culled list), growing those first by
 * `ensureCapacity`: after this the list holds exactly what a fill writing
 * them directly would. A culled list's last cut no longer names the same
 * instances, and is forgotten.
 */
export function commitStaged(list: InstanceList): void {
  list.count = list.stagedCount;
  ensureCapacity(list);
  const n = list.count;
  list.buf.set(list.staged.buf.subarray(0, n * 16));
  if (list.streams.bands) list.bands.set(list.staged.bands.subarray(0, n * 4));
  if (list.streams.foliage) list.foliage.set(list.staged.foliage.subarray(0, n * 4));
  if (list.streams.strength) list.strength.set(list.staged.strength.subarray(0, n));
  if (list.cull !== null) {
    list.origins.set(list.staged.origins.subarray(0, n * 3));
    list.cull.kept = -1;
  }
}

/**
 * Cuts a culled list's collected set by `planes` into its drawn buffers
 * (`cullPrefix`): `list.cull.kept` instances at their front. False, with
 * nothing copied, for a list that keeps exactly the instances of its last
 * cut, and for one that is not culled.
 */
export function cutList(list: InstanceList, planes: Float32Array): boolean {
  return list.cull !== null && cullPrefix(planes, list.count, list.cull);
}

/** All-zero planes, which `cullPrefix` passes every instance through. */
const KEEP_ALL = new Float32Array(20);

/** When a shell's culled lists are cut again: after a rebuild, and when the view has moved past `grassCull.ts`'s thresholds. */
export type ViewCut = {
  /** The collected sets changed (a rebuild) or the drawn buffers were handed back: the next cut is made whatever the pose. */
  invalidate(): void;
  /**
   * The planes to cut the lists by for a camera at `pose` (`null`: every
   * instance kept), or null where the drawn buffers already hold that cut.
   * The planes are one array, rewritten by each call.
   */
  planesFor(pose: CullPose | null): Float32Array | null;
};

export function createViewCut(): ViewCut {
  /** Set by a rebuild: the collected sets changed, so the next cut is made whatever the pose. */
  let dirty = false;
  /** What the drawn buffers hold: nothing cut yet, every instance, or the cut at `lastPose`. */
  let cutMode: "none" | "all" | "pose" = "none";
  const lastPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 0, aspect: 0 };
  /** The widened frustum's planes, rewritten by each cut. */
  const planes = new Float32Array(20);
  return {
    invalidate() {
      dirty = true;
    },
    planesFor(pose) {
      if (!dirty && (pose === null ? cutMode === "all" : cutMode === "pose" && !needsCull(lastPose, pose))) return null;
      dirty = false;
      if (pose === null) {
        cutMode = "all";
        return KEEP_ALL;
      }
      cullPlanes(pose, planes);
      Object.assign(lastPose, pose);
      cutMode = "pose";
      return planes;
    },
  };
}
