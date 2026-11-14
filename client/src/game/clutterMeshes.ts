/**
 * The Babylon shell over `clutterField.ts`: thin-
 * instance buckets for the fourteen clutter classes — grass, rock, boulder,
 * driftwood, fungus, bush, meadow, flower, litter, sword fern, shrub, drift log, wet plant, high plant — two LOD
 * levels deep. All band
 * math is `clutterField.ts` (via its memoizing `createClutterCollector`,
 * output-identical to the pure `collectClutter`); what lives here is buffers,
 * matrices and dispose — the same split as `forestField.ts`/`forestMeshes.ts`,
 * whose idioms this file follows: `AssetContainer` loading, one bucket per
 * model per LOD, deferred update while the GLBs land, `setEnabled(count > 0)`,
 * dispose discipline.
 *
 * It is `forestMeshes.ts`'s simpler sibling, and the simplifications are the
 * design: NO impostors and no bakes ("nothing here is tall enough
 * to earn one", so there is no render target, no alpha-tested quad, no
 * readiness gate), NO cohort or species split (a clutter class picks between
 * variant models by the instance's own `variant` field, which the sim already
 * drew), and only two of the three LOD levels each model ships: LOD0 for
 * the `near` band, LOD1 for `far` (and for the meadow's `near` band too on
 * the tiers that draw blades over it; see `clutterNearLodName`). LOD2 exists
 * in every file and goes unused —
 * a prop's LOD1 is already 36–230 triangles, and a third ring would buy
 * single-digit triangles per instance at the cost of seventeen more draw calls.
 *
 * Draw-call budget ("one draw per model per LOD"): every clutter GLB
 * is single-primitive and single-material, so each bucket is exactly one draw
 * call — 17 models × 2 LOD levels = 34, all of them ground cover the forest's
 * own 29 sit on top of. Rock and boulder spend more of that budget than their
 * model count alone suggests: each of their four model-url slots is cut into
 * ROCK_CUTS (rockRelief.ts) separate meshes, one bucket apiece, so those two
 * classes contribute 16 model-url slots' worth of buckets rather than 4 — 58
 * draws overall, not 34.
 *
 * Allocation discipline ("no per-frame allocation on the hot path"):
 * `update` allocates NOTHING while the camera stays inside its 3 m grass cell,
 * which is the per-frame case; a rebuild reuses one `Float32Array` per bucket,
 * and one staging array beside it that a rebuild in slices writes first
 * (`Bucket.staged`), both grown geometrically and never shrunk, and composes
 * each matrix through module-level scratch objects. This is the one place
 * the file deliberately diverges from `forestMeshes.ts`, which allocates a
 * fresh buffer per rebuild:
 * clutter rebuilds on a 3 m crossing rather than the forest's 12 m, so its
 * eighteen buffers would churn four times as often.
 *
 * The grass class is culled to the view (`CLUTTER_CULLED`, `grassCull.ts`) on
 * the tiers that ask for it: its buckets keep the COLLECTED buffers the
 * rebuild writes on the CPU and hand DRAWN ones to the mesh, and `cull`, run
 * from the renderer once the camera's pose for the frame is final, copies the
 * cards inside a slightly widened frustum to the front of the drawn buffers,
 * in collector order, and uploads only that prefix. It does so after every
 * rebuild and whenever the view has moved past grassCull.ts's thresholds, and
 * nothing otherwise. The draw count does not change. Every other class draws
 * its collected buffers whole, as before.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// friends are patched onto `Mesh.prototype` by this module. Without it the
// calls below are `undefined` at runtime — the same failure mode
// `forestMeshes.ts` and `lighting.ts` record at their own imports.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import { CLUTTER_MEADOW_NEAR_IN, COVER_RAMP_CLASSES, clutterFadeEdges, clutterSeamEdges, coverBands, coverFarBand, coverWiden, createClutterCollector } from "./clutterField.js";
import {
  CLUTTER_CULLED, CLUTTER_MODEL_IDS, CUT_CLASSES, DRIFTLOG_BLEACH, FAR_LOD, FOLIAGE_BY_CLASS, LOD_NAMES, NEAR_LOD, SHRUB_F0, SHRUB_ROUGHNESS,
  WET_CAP_BY_CLASS, clutterLodNames, clutterNearLodName, cutModel, cutOf, cutsFor, instanceMatrixFor, seatDriftLogs, trampleFrame, writeFoliage,
} from "./clutterInstances.js";
import { CLUTTER_BOULDER, CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, CLUTTER_GRASS_CELL, CLUTTER_HIGHPLANT, CLUTTER_MEADOW, CLUTTER_SHRUB, CLUTTER_WETPLANT, type ClutterInstance } from "../sim/clutter.js";
import { attachFoliage, setFoliageEdges, foliageMatched } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { attachDistanceFade, fadeBands, setDistanceWiden, writeFadeBands, type FadeBands } from "./distanceFadePlugin.js";
import { attachWet } from "./wetPlugin.js";
import { modelUrl } from "./assetUrls.js";
import { coverAlbedoTint, FOLIAGE_CARD_CONTRAST } from "./coverAlbedoParams.js";
import { SHRUB_CHARACTERS, shrubGeometry } from "./shrubClump.js";
import { WET_PLANT_COUNT, wetPlantGeometry } from "./wetPlantClump.js";
import { HIGH_PLANT_COUNT, highPlantGeometry } from "./highPlantClump.js";
import { ROCK_CUTS, rockPlanes, rockRelief, type RockPlane } from "./rockRelief.js";
import { cullInvalidate, cullPlanes, cullPrefix, cullSet, needsCull, type CullPose, type CullSet } from "./grassCull.js";
import { loadContainer, loadUntilAborted } from "./modelLoad.js";
import { createKeptValues } from "./keptValues.js";
import { createCrossing, crossingAt, turn, type Heading, type Slices, type SyncJobs } from "./syncJobs.js";
import { buildAtOnce, type FirstBuilds } from "./firstBuilds.js";

// Which model and LOD a class draws, how a rock is spread across its cuts,
// each class's profile and wet cap, and an instance's matrix and ground tint
// are `clutterInstances.ts`'s, which loads no engine; named from here too.
export {
  CLUTTER_CULLED, CLUTTER_SINK, CUT_CLASSES, DRIFTLOG_SINK, DRIFTLOG_SWING, LITTER_VARIANT_SCALE, WET_CAP_BY_CLASS, clutterNearLodName, cutOf,
  cutsFor, instanceMatrixFor, trampleFrame, writeFoliage,
} from "./clutterInstances.js";

/** Each class's models' addresses, by variant (`CLUTTER_MODEL_IDS`). */
const CLUTTER_MODEL_URLS: readonly (readonly string[])[] = CLUTTER_MODEL_IDS.map((ids) => ids.map((id) => modelUrl(`models/${id}.glb`)));

/**
 * A new mesh carrying `source`'s geometry cut by `planes` (rockRelief.ts):
 * flattened facets, unwelded so each shades by its own flat normal, and a
 * per-facet luma written as vertex colour. Keeps the source's material — a
 * `PBRMaterial` reads vertex colour from the MESH's own `useVertexColors`
 * flag, so there is nothing to set on the material itself.
 *
 * It also keeps the source's SIDE ORIENTATION, which is not cosmetic. That
 * value picks the winding the rasterizer calls a front face, and the cut
 * keeps the source's triangle order, so the two must agree. A glTF mesh comes
 * out of the loader clockwise, while a mesh built here defaults to
 * counter-clockwise in this left-handed scene — so leaving it at the default
 * would declare the cut's every triangle a BACK face. Nothing would be culled
 * (these materials draw both sides), but `twoSidedLighting` negates the
 * shading normal on a back face, so every facet would light by a normal
 * pointing into the rock and the whole model would render near-black.
 *
 * Two things about that assignment are quieter than they look, and neither is
 * visible to a `NullEngine` test, which has no rasterizer to disagree with:
 *
 * - It must come BEFORE the material is assigned. Setting `sideOrientation`
 *   raises Babylon's `_sideOrientationHint`, and it is the MATERIAL setter
 *   that reads the hint and clears the material's own overriding
 *   `sideOrientation` — a material's value wins over a mesh's wherever it is
 *   set. Assigning the material first skips that, and today gets away with it
 *   only because the material's value already defaults to null.
 * - Babylon only recomputes a mesh's effective side orientation each frame
 *   when the material culls back faces, overrides the orientation itself, or
 *   lights both sides. Here it is the last of those that keeps the recompute
 *   alive, so turning `twoSidedLighting` off on a rock material would need
 *   this revisited — it is the same flag that made the wrong value render
 *   black rather than merely inside-out.
 */
export function reliefMesh(source: Mesh, model: number, cut: number, planes: RockPlane[]): Mesh {
  const positions = source.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
  const normals = source.getVerticesData(VertexBuffer.NormalKind) as Float32Array;
  const uvs = source.getVerticesData(VertexBuffer.UVKind) as Float32Array | null;
  const indices = source.getIndices() as Uint32Array | Uint16Array;
  const geometry = rockRelief({ positions, normals, uvs, indices }, planes, model, cut);
  const mesh = new Mesh(`${source.name}_cut${cut}`, source.getScene());
  const data = new VertexData();
  data.positions = geometry.positions;
  data.normals = geometry.normals;
  data.colors = geometry.colors;
  data.indices = geometry.indices;
  if (geometry.uvs) data.uvs = geometry.uvs;
  data.applyToMesh(mesh, false);
  // Order matters — see the note above: the orientation before the material.
  mesh.sideOrientation = source.sideOrientation;
  mesh.material = source.material;
  mesh.useVertexColors = true;
  // Stamped on the mesh so a test can confirm every LOD of one (model, cut)
  // pair was cut with the exact same plane list — the shell's own
  // responsibility, since rockRelief.ts has no notion of LOD at all.
  mesh.metadata = { planes };
  return mesh;
}


/** The widened frustum's planes, rewritten by each cut. */
const cullScratchPlanes = new Float32Array(20);
/** All-zero planes, which `cullPrefix` passes every instance through. */
const KEEP_ALL = new Float32Array(20);


/** Instances a bucket's first real allocation covers. Sized so the sparse
 * classes (boulder ≤ 260, fungus ≤ 500 across two variants and two bands)
 * settle after one or two doublings, and grass — the only class that reaches
 * the high hundreds per bucket — after four. */
const BUCKET_MIN_INSTANCES = 64;

/** Shared zero-length placeholder for a bucket that has never held an
 * instance: `ensureCapacity` replaces it the first time one lands, and until
 * then nothing reads or writes it. */
const EMPTY_BUFFER = new Float32Array(0);

export type ClutterMeshesOptions = {
  /** Scales every class radius together — the quality-tier knob, passed
   * straight to the collector (low ≈ 60% radii). */
  radiusScale?: number;
  /** The blade field (bladeMeshes.ts) draws over the meadow's near cards on
   * this tier, so those cards dither in from the eye over
   * `CLUTTER_MEADOW_NEAR_IN` rather than standing at the feet. Off on the low
   * tier, which draws no blades. */
  nearBlades?: boolean;
  /** Filter the `CLUTTER_CULLED` classes' buckets to the view through `cull`.
   * On with the blade field, on the tiers that draw it; off, every bucket
   * draws its collected set whole and `cull` does nothing. */
  cull?: boolean;
  /** NullEngine escape hatch: bucket meshes per class → variant → LOD in
   * place of the nineteen production GLBs (the forestMeshes `assets` idiom).
   * `adopt` runs synchronously on them. */
  assets?: Mesh[][][][];
  /** The renderer's scheduler: a one-cell step at a walk rebuilds as a job
   * over the frames that follow rather than in the frame of the crossing. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike
   * (`firstBuilds.ts`): a build that cannot wait is stepped by it rather
   * than run whole in the call that asked for it. Absent, it runs whole. */
  firstBuilds?: FirstBuilds;
};

export type ClutterMeshes = {
  update(camX: number, camZ: number): void;
  /**
   * Draws only the culled classes' instances inside the frustum of `pose`
   * widened by `CULL_MARGIN` (grassCull.ts), refiltering after a rebuild or
   * once the view has moved past the thresholds, and doing nothing
   * otherwise. `null` draws every collected instance. A no-op for a shell
   * built without `cull`, and before the models land.
   */
  cull(pose: CullPose | null): void;
  /**
   * The boulder buckets — the complete clutter shadow-caster set. Grass,
   * rocks, driftwood, fungus and bush never cast: they are small props at
   * four-figure instance counts, and the shadow-map draw costs more than the
   * contact darkening it would buy. In production the GLBs load
   * asynchronously, so this array starts empty and fills once; callers that
   * register casters must watch its length, not snapshot it at creation —
   * the same contract `ForestMeshes.casterMeshes` carries.
   */
  readonly casterMeshes: readonly Mesh[];
  /** Instances whose matrix and tint are kept (keptValues.ts). */
  readonly kept: number;
  /** The camera position the buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  dispose(): void;
};

/**
 * One logical bucket: every geometry-bearing mesh of one model's one LOD
 * level (single-primitive for all nineteen clutter GLBs, so one mesh in practice)
 * sharing a single reused instance buffer.
 */
type Bucket = {
  meshes: Mesh[];
  /** Matrix data, reused across rebuilds; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** Four floats per instance, `fadeBands` attribute; capacity tracks `buf`. */
  bands: Float32Array;
  /** Four floats per instance (ground colour rgb + the sky's openness,
   * `1 − canopy`), the
   * `foliage` attribute; capacity tracks `buf`. Only written and uploaded
   * when `tints` is set — the classes without the foliage plugin never read
   * this buffer, so it stays at `EMPTY_BUFFER`. */
  foliage: Float32Array;
  /** The constant every instance of this bucket carries, or on a ramped
   * bucket (`COVER_RAMP_CLASSES`, the far level) the bands each instance's
   * own are drawn from (`rampBands`). */
  fade: FadeBands;
  ramp: boolean;
  /** The far band (`coverFarBand`) on the far level of a class that has one:
   * a card not kept past it goes out across this band (`coverBands`). */
  far: readonly [number, number] | null;
  /** Set for the classes that wear the foliage plugin (`FOLIAGE_BY_CLASS`),
   * which is exactly the classes whose `foliage` buffer this file writes and
   * uploads. */
  tints: boolean;
  /** Instances this rebuild — counted in pass 1, then reused as the write
   * cursor in pass 2, so it is the live count again when the fill ends. */
  count: number;
  /** Set when `buf` was replaced this rebuild: the mesh then needs a fresh
   * `thinInstanceSetBuffer` (a new GPU buffer) rather than an in-place
   * upload of the existing one. */
  grown: boolean;
  /** Filtered to the view: `buf`, `bands` and `foliage` are then the
   * collected buffers, never uploaded, and the mesh holds `drawn`. */
  culled: boolean;
  /** The drawn buffers of a culled bucket, the collected ones' capacity each,
   * the kept prefix at the front; empty for every other bucket. */
  drawn: { buf: Float32Array; bands: Float32Array; foliage: Float32Array };
  /** A culled bucket's card translations, x, y, z, written by the fill
   * beside `buf`: what the cut tests. */
  origins: Float32Array;
  /** A culled bucket's collected and drawn buffers as `cullPrefix` walks
   * them, with the last cut's indices; rebuilt only on growth. Null for every
   * other bucket. */
  cull: CullSet | null;
  /** Where a rebuild in slices writes, so that nothing the mesh draws or
   * `cull` reads changes until the rebuild's last slice copies it across:
   * the same four buffers, grown the same way, never uploaded. */
  staged: { buf: Float32Array; bands: Float32Array; foliage: Float32Array; origins: Float32Array };
  /** Instances staged — counted, then the write cursor, as `count` is. */
  stagedCount: number;
};

/** One matrix's worth of scratch floats, reused by `instanceMatrixFor` so
 * `computeInstance` can copy it into the kept values at any offset without
 * `Matrix.copyToArray` needing a per-instance subarray view. */
const scratchMatBuf = new Float32Array(16);

/** The node itself plus descendants, filtered to meshes that carry geometry —
 * `forestMeshes.ts`'s helper, which cannot be shared without exporting it from
 * a module this file doesn't otherwise touch. */
function geometryMeshes(node: Node): Mesh[] {
  const out: Mesh[] = [];
  const all: Node[] = [node, ...node.getChildMeshes(false)];
  for (const n of all) {
    if (n instanceof Mesh && n.getTotalVertices() > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Flags every bucket mesh needs before it can hold thin instances.
 *
 * Clutter thin instances deliberately never receive shadows (left at the
 * Babylon default `receiveShadows = false`): measured ~4 ms
 * for bush-scale receivers alone, enough on its own to push a
 * deep-forest frame past the 16.7 ms vsync cliff. Bushes read as
 * canopy-shadowed instead via a pre-darkened palette colour (`bush` in
 * `assets/palette.json`) rather than a real shadow
 * sample. The blade field's buckets (`bladeMeshes.ts`) and the duff field's
 * (`duffMeshes.ts`), which share this helper, are the exceptions, and turn
 * the flag back on themselves right after this call. */
export function prepBucketMesh(mesh: Mesh): void {
  mesh.isPickable = false;
  // Babylon culls a thin-instance mesh by its own bounding box, and syncing
  // that box would scan every matrix in the buffer on each rebuild
  // (`thinInstanceRefreshBoundingInfo` inside `thinInstanceSetBuffer`).
  // Clutter surrounds the camera on every side exactly as the forest does, so
  // the bucket is simply always active and the sync is skipped.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Nothing to draw until the first rebuild fills a buffer.
  mesh.setEnabled(false);
}

/**
 * Grows `bucket.buf` to hold `bucket.count` matrices if it does not already,
 * doubling from `BUCKET_MIN_INSTANCES` so a bucket allocates a bounded number
 * of times over a session and never per rebuild. The old contents are dropped
 * rather than copied: every live matrix is rewritten immediately afterwards.
 */
function ensureCapacity(bucket: Bucket): void {
  const needed = bucket.count * 16;
  if (bucket.buf.length >= needed) {
    bucket.grown = false;
    return;
  }
  let capacity = Math.max(bucket.buf.length, BUCKET_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.buf = new Float32Array(capacity);
  // 16 floats of matrix per instance ↔ 4 floats of bands (or foliage) per instance.
  bucket.bands = new Float32Array(capacity / 4);
  bucket.foliage = new Float32Array(capacity / 4);
  if (bucket.culled) {
    bucket.drawn = { buf: new Float32Array(capacity), bands: new Float32Array(capacity / 4), foliage: new Float32Array(capacity / 4) };
    bucket.origins = new Float32Array((capacity / 16) * 3);
    const vec4 = [{ src: bucket.bands, dst: bucket.drawn.bands }];
    if (bucket.tints) vec4.push({ src: bucket.foliage, dst: bucket.drawn.foliage });
    bucket.cull = cullSet(capacity / 16, bucket.origins, { src: bucket.buf, dst: bucket.drawn.buf }, vec4, []);
  }
  bucket.grown = true;
}

/**
 * Grows a bucket's staging buffers to hold `bucket.stagedCount` instances, by
 * `ensureCapacity`'s doubling; old contents are dropped, as there.
 */
function ensureStaging(bucket: Bucket): void {
  const needed = bucket.stagedCount * 16;
  if (bucket.staged.buf.length >= needed) return;
  let capacity = Math.max(bucket.staged.buf.length, BUCKET_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.staged = {
    buf: new Float32Array(capacity),
    bands: new Float32Array(capacity / 4),
    foliage: new Float32Array(capacity / 4),
    origins: bucket.culled ? new Float32Array((capacity / 16) * 3) : EMPTY_BUFFER,
  };
}

/**
 * Copies a bucket's staged instances into the buffers its meshes draw from
 * (the collected ones, for a culled bucket), growing those first by
 * `ensureCapacity`: after this the bucket holds exactly what a rebuild writing
 * them directly would, the tail past `count` included.
 */
function commitStaged(bucket: Bucket): void {
  bucket.count = bucket.stagedCount;
  ensureCapacity(bucket);
  const n = bucket.count;
  bucket.buf.set(bucket.staged.buf.subarray(0, n * 16));
  bucket.bands.set(bucket.staged.bands.subarray(0, n * 4));
  if (bucket.tints) bucket.foliage.set(bucket.staged.foliage.subarray(0, n * 4));
  if (bucket.culled) bucket.origins.set(bucket.staged.origins.subarray(0, n * 3));
}

/** Instances' worth of work a slice of the clutter's fill does before it
 * yields: an instance whose values are copied counts 1, one computed for the
 * first time `FILL_NEW_COST` — its trample frame and ground tint are several
 * walks through the terrain's noise. About a tenth of a millisecond. */
const FILL_SLICE = 1536;
const FILL_NEW_COST = 16;

/** What computing an instance's kept values ahead weighs on a slice of idle
 * work, in `prefetchWindow`'s units: about what sampling a cell does. */
const KEPT_AHEAD_COST = 64;

/**
 * Pushes a filled bucket to its meshes. A bucket whose buffer was just grown
 * needs the whole GPU buffer recreated; one that was written in place needs
 * only the live prefix re-uploaded, which is what `thinInstanceBufferUpdated`
 * does once `thinInstanceCount` has been set (it uploads `instancesCount`
 * strides, not the whole array).
 *
 * The buffer is created UPDATABLE (`staticBuffer` false), unlike
 * `forestMeshes.ts`'s static one, and that is load-bearing rather than a
 * preference: `Buffer.updateDirectly` no-ops silently on a non-updatable
 * buffer, so an in-place rebuild would never reach the GPU and the field
 * would freeze at whatever the last wholesale set left behind. Babylon's
 * recovery path for that (`thinInstanceAllowAutomaticStaticBufferRecreation`,
 * off unless opted into) disposes and recreates the GPU buffer on EVERY
 * update — the exact per-rebuild allocation this file's buffer reuse exists
 * to avoid. Updatable from the start is both correct and cheap.
 */
function applyBucket(bucket: Bucket): void {
  if (bucket.culled) {
    applyCulled(bucket);
    return;
  }
  const count = bucket.count;
  for (const mesh of bucket.meshes) {
    if (bucket.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", bucket.buf, 16, false);
      mesh.thinInstanceSetBuffer("fadeBands", bucket.bands, 4, false);
      if (bucket.tints) mesh.thinInstanceSetBuffer("foliage", bucket.foliage, 4, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("fadeBands");
        if (bucket.tints) mesh.thinInstanceBufferUpdated("foliage");
      }
    }
    // A zero-count bucket must be disabled outright: with `instancesCount` 0
    // Babylon's `hasThinInstances` is false and the bare bucket mesh would be
    // drawn once at the origin.
    mesh.setEnabled(count > 0);
  }
}

/**
 * A culled bucket after a rebuild. One that did not grow needs nothing: its
 * meshes keep drawing the last cut's prefix, whose drawn buffers the rebuild
 * does not touch, until `cull` cuts the new collected set in the same frame.
 * One that grew hands its meshes fresh, empty drawn buffers (updatable, for
 * `applyBucket`'s reason) and draws nothing until then.
 */
function applyCulled(bucket: Bucket): void {
  if (!bucket.grown) return;
  for (const mesh of bucket.meshes) {
    mesh.thinInstanceSetBuffer("matrix", bucket.drawn.buf, 16, false);
    mesh.thinInstanceSetBuffer("fadeBands", bucket.drawn.bands, 4, false);
    if (bucket.tints) mesh.thinInstanceSetBuffer("foliage", bucket.drawn.foliage, 4, false);
    // Set to the whole capacity by the buffer above; zero, and disabled so the
    // bare mesh is not drawn once at the origin (`applyBucket`'s note).
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
  }
}

/**
 * Hands a culled bucket's drawn buffers, at their full capacity, back to its
 * meshes, for the reason bladeMeshes.ts's `rehandBucket` gives: after a WebGL
 * context restore the GPU buffers are rebuilt at the last prefix's size. The
 * bucket draws nothing until the next cut fills it again.
 */
function rehandCulled(bucket: Bucket): void {
  if (bucket.cull === null || bucket.drawn.buf.length === 0) return;
  bucket.grown = true;
  applyCulled(bucket);
  bucket.grown = false;
  cullInvalidate(bucket.cull);
}

/**
 * Cuts one culled bucket's collected set by `planes` into its drawn buffers,
 * sets its meshes' count to the kept cards and uploads only them (Babylon's
 * count form of `thinInstancePartialBufferUpdate`: `kept` strides from
 * offset 0). A bucket that keeps exactly the cards of its last cut is left as
 * it is: no copy, no upload.
 */
function cutBucket(bucket: Bucket, planes: Float32Array): void {
  if (bucket.cull === null || !cullPrefix(planes, bucket.count, bucket.cull)) return;
  const kept = bucket.cull.kept;
  for (const mesh of bucket.meshes) {
    mesh.thinInstanceCount = kept;
    if (kept > 0) {
      mesh.thinInstancePartialBufferUpdate("matrix", kept, 0);
      mesh.thinInstancePartialBufferUpdate("fadeBands", kept, 0);
      if (bucket.tints) mesh.thinInstancePartialBufferUpdate("foliage", kept, 0);
    }
    mesh.setEnabled(kept > 0);
  }
}


/** Floats kept per instance: the matrix (16), then the tint (4), which only
 * the classes that wear the foliage plugin write and read. */
const KEPT_STRIDE = 20;
const KEPT_FOLIAGE = 16;

/**
 * The clutter's Babylon shell. Production loads the nineteen shipped GLBs
 * asynchronously and builds buckets when they arrive; the returned object is
 * complete immediately — an `update` before the assets exist just remembers
 * the camera, and is replayed the moment they land.
 */
export function createClutterMeshes(
  scene: Scene,
  seed: number,
  options: ClutterMeshesOptions = {},
): ClutterMeshes {
  const radiusScale = options.radiusScale ?? 1;
  const nearBlades = options.nearBlades ?? false;
  const culling = options.cull ?? false;
  /**
   * An instance's matrix, and its tint for a class that wears the foliage
   * plugin, computed the first time it is listed. Both are functions of the
   * instance and the seed alone: the trample frame is the trail's, the tint
   * the ground under it. The band an instance is listed in picks its bucket
   * and its fade bands, both written per bucket at the fill, never its matrix
   * or tint: a seam instance listed in both bands draws the same values in
   * each. Nothing here depends on the eye, the tier's radius, the time or the
   * wind.
   */
  function computeInstance(inst: ClutterInstance, out: Float32Array, offset: number): void {
    const frame = trampleFrame(seed, inst);
    instanceMatrixFor(inst, frame, scratchMatBuf);
    out.set(scratchMatBuf, offset);
    if (FOLIAGE_BY_CLASS.has(inst.cls)) writeFoliage(seed, inst, out, offset + KEPT_FOLIAGE, frame);
  }
  const kept = createKeptValues<ClutterInstance>(KEPT_STRIDE, computeInstance);
  // Memoizing collector, not the pure `collectClutter`: a rebuild happens on
  // every 3 m grass-cell crossing, and re-sampling all eight discs from cold
  // each time would pay fresh density and terrain samples for thousands of
  // cells that have not moved (see clutterField.ts). An instance it lets go
  // takes its kept values with it.
  const collector = createClutterCollector(seed, (inst) => kept.release(inst));

  const casterMeshes: Mesh[] = [];
  const containers: AssetContainer[] = [];
  /** The materials of the classes built in code, which no container owns. */
  const builtMaterials: PBRMaterial[] = [];
  /** `buckets[class][variant * cutsFor(class) + cut][lod]`, or null until the
   * GLBs land — plain `[class][variant][lod]` for every class outside
   * `CUT_CLASSES`, where `cutsFor` is 1 and the cut is always 0. */
  let buckets: Bucket[][][] | null = null;
  /** The buckets `cull` filters, flattened once at adoption. */
  let culledBuckets: Bucket[] = [];
  let disposed = false;
  /** Aborted first thing in `dispose`: a GLB in flight then ends at once and
   * quietly, and none starts after it (`modelLoad.ts`). */
  const loads = new AbortController();
  /** Set by a rebuild: the collected sets changed, so the next `cull` cuts
   * whatever the pose. */
  let dirty = false;
  /** What the drawn buffers hold: nothing cut yet, every card
   * (`cull(null)`), or the cut at `lastPose`. */
  let cutMode: "none" | "all" | "pose" = "none";
  const lastPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 0, aspect: 0 };
  const restoreObserver = scene.getEngine().onContextRestoredObservable.add(() => {
    for (const bucket of culledBuckets) rehandCulled(bucket);
    dirty = true;
  });

  // Last camera seen. An `update` that arrives while the GLBs are still
  // loading is honoured the moment they land.
  let camX = NaN;
  let camZ = NaN;

  /**
   * The bucket an instance belongs in. Indexing by the sim's own `variant`
   * draw is the whole variant mechanism; for the cut classes each model also
   * spreads across `cutsFor(inst.cls)` fractures, so the bucket dimension is
   * `variant * cuts + cut` (matching how `adopt` below lays the cut buckets
   * out) — for every other class `cuts` is 1 and `cutOf` is always 0, so this
   * collapses back to plain `variant` indexing. The `?? variants[0]`
   * fallback covers only a model table that has fallen behind the sim's
   * per-class `variants` count, where crashing the frame would be the worse
   * failure.
   */
  function bucketFor(variants: Bucket[][], inst: ClutterInstance, lod: number): Bucket {
    const cuts = cutsFor(inst.cls);
    const perLod = variants[inst.variant * cuts + cutOf(inst)] ?? (variants[0] as Bucket[]);
    return perLod[lod] as Bucket;
  }

  /** One instance at a bucket's staging cursor: its kept matrix (and the
   * origin a culled bucket tests), the bucket's fade bands, and its kept tint
   * where the bucket wears the foliage plugin. */
  function stageInstance(bucket: Bucket, inst: ClutterInstance): void {
    const at = kept.offsetOf(inst);
    const data = kept.data;
    const { buf, origins, bands, foliage } = bucket.staged;
    const i = bucket.stagedCount;
    const m = i * 16;
    for (let k = 0; k < 16; k++) buf[m + k] = data[at + k]!;
    if (bucket.culled) {
      // The matrix's translation, which is what the cut tests.
      origins[i * 3] = buf[m + 12]!;
      origins[i * 3 + 1] = buf[m + 13]!;
      origins[i * 3 + 2] = buf[m + 14]!;
    }
    writeFadeBands(bands, i * 4, coverBands(bucket.fade, bucket.ramp, bucket.far, inst.hash));
    if (bucket.tints) {
      const f = i * 4;
      for (let k = 0; k < 4; k++) foliage[f + k] = data[at + KEPT_FOLIAGE + k]!;
    }
    bucket.stagedCount++;
  }

  /**
   * Rebuild, as slices (`syncJobs.ts`): the bands collected, then two passes
   * over them, so every bucket knows its size before a single matrix is
   * written and no buffer has to grow mid-fill. Pass 1 counts, pass 2 writes
   * each bucket's staging buffers (`stagedCount` the cursor), copying each
   * instance's kept matrix and tint and computing them only for an instance
   * listed for the first time (`computeInstance`), and yields by the work
   * done (`FILL_SLICE`). The last slice copies every bucket's staged
   * instances into the buffers it draws and pushes them (a culled bucket's by
   * `cull`), all in one step, so no frame draws a bucket half rebuilt.
   */
  function* rebuild(x: number, z: number): Slices {
    const all = buckets as Bucket[][][];
    const bands = yield* collector.collectSlices(x, z, radiusScale);
    yield;

    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) bucket.stagedCount = 0;
      }
    }
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const variants = all[cls] as Bucket[][];
      const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[] };
      for (const inst of band.near) bucketFor(variants, inst, NEAR_LOD).stagedCount++;
      for (const inst of band.far) bucketFor(variants, inst, FAR_LOD).stagedCount++;
      // A class's count is a pass over its lists, the meadow's thousands long.
      yield;
    }
    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) {
          ensureStaging(bucket);
          bucket.stagedCount = 0;
        }
      }
    }
    let work = 0;
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const variants = all[cls] as Bucket[][];
      const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[] };
      for (let lod = NEAR_LOD; lod <= FAR_LOD; lod++) {
        for (const inst of lod === NEAR_LOD ? band.near : band.far) {
          const known = kept.size;
          stageInstance(bucketFor(variants, inst, lod), inst);
          work += kept.size > known ? FILL_NEW_COST : 1;
          if (work >= FILL_SLICE) {
            work = 0;
            yield;
          }
        }
      }
    }

    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) {
          commitStaged(bucket);
          applyBucket(bucket);
        }
      }
    }
    // The collected buffers were rewritten: the last cuts' indices no longer
    // name the same cards.
    for (const bucket of culledBuckets) if (bucket.cull !== null) cullInvalidate(bucket.cull);
    dirty = true;
    view.x = x;
    view.z = z;
    aimed = false;
  }

  const crossing = createCrossing();
  const view = { x: NaN, z: NaN };
  const owner = {};
  const jobs = options.jobs;
  const heading: Heading = { x: 0, z: 0 };
  /** Whether the idle work is aimed at the next crossings from where the
   * last rebuild left the bands, on the present heading. */
  let aimed = false;
  /** An instance looked up ahead: its matrix and tint computed too, so the
   * fill at the crossing only copies them. */
  const ahead = (inst: ClutterInstance): number => {
    const known = kept.size;
    kept.offsetOf(inst);
    return kept.size > known ? KEPT_AHEAD_COST : 1;
  };
  /** Sets the idle work (`syncJobs.ts`) to look up the cells the next
   * crossings add, while no rebuild is pending. */
  function aim(): void {
    if (aimed || jobs === undefined || jobs.pending(owner)) return;
    aimed = true;
    jobs.idle(owner, collector.prefetchSlices(camX, camZ, heading.x, heading.z, radiusScale, ahead));
  }

  /**
   * Rebuild only when the cell-snapped origin moves. ONE snap for all eight
   * classes, on the SMALLEST cell (grass, 3 m): the bands are a pure function
   * of each class's own snapped origin, so snapping on the finest grid can
   * only rebuild more often than a per-class snap would, never less — and the
   * collector's per-cell memoization absorbs the extra polls, which is what
   * makes one shared origin cheaper than tracking eight. Instance positions
   * live on each class's own fixed world lattice, so a stale origin only
   * shifts each disc's *boundary* by up to ~4 m diagonal, invisible at the
   * meadow's 20 m rim and its 9 m LOD split; rebuilding on the 0.7 m grid
   * would rebuild ~4× as often for no visible gain.
   *
   * A one-cell step at a walk is a job given `options.jobs` (`crossingAt`
   * says which crossings build at once). The first build, when the models
   * land, is always at once.
   */
  function maybeBuild(first: boolean): void {
    if (buckets === null || Number.isNaN(camX)) return;
    const originX = Math.floor(camX / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    const originZ = Math.floor(camZ / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    const kind = crossingAt(
      crossing, camX, camZ, originX, originZ, CLUTTER_GRASS_CELL,
      jobs !== undefined && !first, jobs?.started(),
    );
    if (kind === "none") {
      // While the loader steps this shell's build, nothing is prepared ahead of it.
      if (options.firstBuilds?.queued(owner) !== true) aim();
      return;
    }
    options.firstBuilds?.cancel(owner);
    if (kind === "later") {
      (jobs as SyncJobs).begin(owner, rebuild(camX, camZ), false, "clutter");
      return;
    }
    jobs?.cancel(owner);
    buildAtOnce(options.firstBuilds, owner, rebuild(camX, camZ), "clutter");
  }

  /**
   * Bucket meshes for one named LOD of a loaded container — `forestMeshes.ts`'
   * `lodMeshes`, minus its impostor-bake reparenting (no bake here needs a
   * single root to walk from). Located by NAME anywhere in the node graph,
   * never by scene-root position, because the shipped files nest the LOD roots
   * under wrapper nodes and the loader adds its own `__root__`.
   *
   * Each mesh gets its world transform (which carries the glTF right-handed →
   * Babylon left-handed conversion on the loader's `__root__`) baked into its
   * vertices and is then detached with an identity transform: thin instances
   * compose as `world * instanceMatrix`, i.e. the bucket mesh's own world
   * matrix is applied AFTER the per-instance matrix, so any leftover mesh
   * transform would mirror the whole placed field rather than each prop.
   * `bakeTransformIntoVertices` flips triangle winding when the determinant is
   * negative, so the handedness mirror keeps faces outward.
   */
  function lodMeshes(container: AssetContainer, name: string): Mesh[] {
    const nodes: Node[] = [...container.transformNodes, ...container.meshes];
    const root = nodes.find((n) => n.name === name);
    if (root === undefined) return [];
    const meshes = geometryMeshes(root);
    // Snapshot every world matrix before resetting any transform: if one
    // bucket mesh were an ancestor of another, resetting it first would
    // corrupt the descendant's world matrix mid-loop.
    const worlds = meshes.map((mesh) => mesh.computeWorldMatrix(true).clone());
    for (const [i, mesh] of meshes.entries()) {
      mesh.bakeTransformIntoVertices(worlds[i] as Matrix);
      mesh.position.setAll(0);
      mesh.rotationQuaternion = null;
      mesh.rotation.setAll(0);
      mesh.scaling.setAll(1);
      // Detach from the container hierarchy, whose nodes still carry the
      // transforms just baked away.
      mesh.parent = null;
    }
    return meshes;
  }

  /** Loads one container, adds it to the scene, and disables everything it
   * brought that isn't in one of the returned bucket groups (LOD2, empty
   * wrappers). Returns null if disposed mid-await — the caller must bail out
   * without adopting anything. */
  async function loadBucketed(url: string, lodNames: readonly string[] = LOD_NAMES): Promise<Mesh[][] | null> {
    const container = await loadUntilAborted(() => loadContainer(url, scene), loads.signal);
    containers.push(container);
    // Disposed while awaiting: dispose() has already run over an earlier
    // (possibly empty) container list, so clean up what just landed here.
    if (disposed) {
      container.dispose();
      return null;
    }
    container.addAllToScene();
    const groups = lodNames.map((lodName) => lodMeshes(container, lodName));
    const bucketed = new Set<Mesh>(groups.flat());
    for (const mesh of container.meshes) {
      if (mesh instanceof Mesh && !bucketed.has(mesh)) mesh.setEnabled(false);
    }
    return groups;
  }

  /**
   * For a cut class, splits each loaded model's `[lod]` mesh group into
   * `ROCK_CUTS` cut copies, laid out as `[variant * ROCK_CUTS + cut][lod]` so
   * `bucketFor` above can find them. The plane list is derived once per model
   * from LOD0's own vertices and handed to BOTH LOD0 and LOD1's `reliefMesh`
   * call — the one thing this function exists to guarantee, since a rock cut
   * with two different plane lists would change shape the moment its LOD
   * swaps. `rockPlanes` returns the planes that survive its cap-share rule,
   * not the candidates it started from, so what both LODs share is the set
   * that actually cuts and not merely the set that was considered. Classes
   * outside `CUT_CLASSES` pass through untouched, so this is a no-op for the
   * other seven. The model index handed to `rockPlanes`/`reliefMesh` is the
   * class's and the variant's together (`cutModel`).
   */
  function expandCutVariants(cls: number, variants: Mesh[][][]): Mesh[][][] {
    if (!CUT_CLASSES.has(cls)) return variants;
    const expanded: Mesh[][][] = [];
    for (let variant = 0; variant < variants.length; variant++) {
      const model = cutModel(cls, variant);
      const perLod = variants[variant] as Mesh[][];
      const lod0 = perLod[NEAR_LOD] as Mesh[];
      const lod1 = perLod[FAR_LOD] as Mesh[];
      const lod0Positions = lod0[0]!.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const planes = rockPlanes(model, cut, lod0Positions);
        expanded.push([
          lod0.map((mesh) => reliefMesh(mesh, model, cut, planes)),
          lod1.map((mesh) => reliefMesh(mesh, model, cut, planes)),
        ]);
      }
      // The uncut source meshes are replaced in every bucket above, so they
      // must stop drawing and stop being evaluated as active meshes; they are
      // NOT disposed here, because the container that loaded them (see
      // `loadBucketed`) still owns them for final cleanup, the same way it
      // already owns the unused LOD2 meshes and wrapper nodes.
      for (const mesh of [...lod0, ...lod1]) mesh.setEnabled(false);
    }
    return expanded;
  }

  /**
   * For a class whose `near` band draws LOD1 (`clutterNearLodName`), swaps
   * each variant's near mesh group for copies of its LOD1 group. Copies, not
   * the same meshes: a thin-instance buffer lives on the mesh's geometry, so
   * the near and far buckets need a geometry each. The copies share the LOD1
   * material, as the two LODs of a model already do. The LOD0 meshes they
   * replace stop drawing; whatever loaded them still owns them, as with
   * `expandCutVariants`. Every other class passes through untouched.
   */
  function nearLodVariants(cls: number, variants: Mesh[][][]): Mesh[][][] {
    if (clutterNearLodName(cls, nearBlades) === LOD_NAMES[NEAR_LOD]) return variants;
    return variants.map((perLod) => {
      for (const mesh of perLod[NEAR_LOD] as Mesh[]) mesh.setEnabled(false);
      const far = perLod[FAR_LOD] as Mesh[];
      const near = far.map((mesh) => mesh.clone(`${mesh.name}.near`, null, true).makeGeometryUnique());
      return [near, far];
    });
  }

  /** A class built in code, as mesh groups `[variant][lod]`: one material a
   * variant, white under the leaves' own vertex colours, shared by its two
   * levels of detail as a model's are. */
  function built(name: string, variants: number, geometry: (variant: number, lod: number) => { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array }): Mesh[][][] {
    return Array.from({ length: variants }, (_, variant) => {
      const mat = new PBRMaterial(`clutter_${name}_${variant}_mat`, scene);
      mat.albedoColor = new Color3(1, 1, 1);
      mat.metallic = 0;
      mat.roughness = SHRUB_ROUGHNESS;
      mat.metallicF0Factor = SHRUB_F0;
      mat.backFaceCulling = false;
      builtMaterials.push(mat);
      return LOD_NAMES.map((lodName, lod) => {
        const g = geometry(variant, lod);
        const mesh = new Mesh(`clutter_${name}_${variant}_${lodName}`, scene);
        const data = new VertexData();
        data.positions = g.positions;
        data.normals = g.normals;
        data.colors = g.colors;
        data.indices = g.indices;
        data.applyToMesh(mesh, false);
        mesh.material = mat;
        return [mesh];
      });
    });
  }

  /** Turns the loaded mesh groups into buckets and replays any update that
   * arrived while they were loading. */
  function adopt(loaded: Mesh[][][][]): void {
    // The drift log's seat and its bleach, from its own meshes and on its own
    // material (the class loads the trunk for itself, so the forest's logs
    // keep their bark).
    const driftLogs = (loaded[CLUTTER_DRIFTLOG] ?? []).flat(2);
    const driftPositions = driftLogs[0]?.getVerticesData(VertexBuffer.PositionKind);
    if (driftPositions !== null && driftPositions !== undefined) seatDriftLogs(driftPositions);
    for (const mesh of driftLogs) {
      if (mesh.material instanceof PBRMaterial) mesh.material.albedoColor.copyFromFloats(...DRIFTLOG_BLEACH);
    }
    // The cards in the cover's green (`coverAlbedoParams.ts`): each card
    // model's tint, a gain per channel that puts its texture's mean colour
    // on the green (the flowers' a grey one, their petals their own colour),
    // multiplied into the material its meshes share, once per material (a
    // GLB's two LOD groups carry one, as does every mesh of a group). Here,
    // before the LOD copies and the cut copies below, which share the
    // material by reference, so nothing applies it twice or misses it. The
    // shipped materials are white, so the product is the tint itself; one
    // that was not would keep its own colour under it. The classes that wear
    // the foliage profile alone: a rock, boulder, driftwood or fungus is not
    // a card and takes none, nor does the litter, which draws their models;
    // the classes built in code have no id and are white under their own
    // vertex colours. The same materials take the cards' contrast in the
    // foliage plugin below, which lifts the shade their textures bake into
    // their dark texels, which a gain cannot.
    const tinted = new Set<PBRMaterial>();
    loaded.forEach((variants, cls) => {
      if (!FOLIAGE_BY_CLASS.has(cls)) return;
      variants.forEach((perLod, variant) => {
        const id = CLUTTER_MODEL_IDS[cls]?.[variant];
        if (id === undefined) return;
        const tint = coverAlbedoTint(id);
        for (const mesh of perLod.flat()) {
          const mat = mesh.material;
          if (!(mat instanceof PBRMaterial) || tinted.has(mat)) continue;
          tinted.add(mat);
          const c = mat.albedoColor;
          c.copyFromFloats(c.r * tint.r, c.g * tint.g, c.b * tint.b);
        }
      });
    });
    buckets = loaded.map((variants, cls) =>
      expandCutVariants(cls, nearLodVariants(cls, variants)).map((perLod) =>
        perLod.map((meshes, lod) => {
          for (const mesh of meshes) prepBucketMesh(mesh);
          // Boulders are the only clutter that casts — see `casterMeshes`.
          // BOTH their LOD buckets do: a boulder crossing the near/far split
          // would otherwise drop its shadow mid-view.
          if (cls === CLUTTER_BOULDER) casterMeshes.push(...meshes);
          // Every class dithers toward its disc edge, and across its near/far
          // seam: the near LOD fades out over the seam, the
          // far LOD in over the seam and out over the edge. Hoisted above the
          // foliage block below, which also needs `edge`.
          const edge = clutterFadeEdges(cls, radiusScale);
          const seam = clutterSeamEdges(cls, radiusScale);
          const profile = FOLIAGE_BY_CLASS.get(cls);
          if (profile !== undefined) {
            for (const mesh of meshes) {
              if (mesh.material) {
                // Bake ran already, so the bound box is the placed geometry;
                // models put the origin at the footprint base, so max.y IS the height.
                mesh.refreshBoundingInfo();
                // The classes that draw the card models take the cards'
                // contrast with their tint above; a class built in code has
                // no texture with shade baked in and keeps its colours whole.
                const contrast = (CLUTTER_MODEL_IDS[cls]?.length ?? 0) > 0 ? FOLIAGE_CARD_CONTRAST : 1;
                // Cover matched to the ground takes the trees' cast shadows
                // as the ground does (`foliageMatched`).
                const matched = foliageMatched(mesh.material, profile);
                if (matched) mesh.receiveShadows = true;
                attachFoliage(mesh.material, profile, mesh.getBoundingInfo().boundingBox.maximum.y, { contrast, sunShadowed: matched });
                attachFoliageLight(mesh.material);
                // `edges` lives on the plugin instance, so it is per MATERIAL:
                // a card GLB's two LOD buckets share one material, so setting
                // the far bucket's edges here also governs the near bucket's
                // plugin instance — harmless, since the near bucket sits
                // entirely inside the disc edge already.
                if (lod === FAR_LOD) setFoliageEdges(mesh.material, [edge.start, edge.end]);
              }
            }
          }
          // The meadow's near cards stand under the blade field on the tiers
          // that draw it, and dither in from the eye there so none stands as
          // a flat plane at the feet. They do so on those tiers whether or not
          // blades grow at a given spot, so where the grass gate sits under
          // the field's floor the meadow cards thin inside 2.5 m and are gone
          // inside 1 m with nothing in their place. Every other near bucket
          // draws all the way in, as does the meadow's on the low tier, which
          // has no blades. The grass class's near cards in particular are
          // never cut: the blades only grow where the grass gate clears the
          // field's floor, so an in-band there would take away the last
          // cover standing. For the grass class the field may only ever ADD
          // to the near field.
          const nearIn = nearBlades && cls === CLUTTER_MEADOW ? CLUTTER_MEADOW_NEAR_IN : null;
          const fade: FadeBands = lod === NEAR_LOD
            ? fadeBands(nearIn, [seam.start, seam.end])
            : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
          // The far band's widening by eye distance, on the class's material
          // (the two levels share it; the near level ends inside the band).
          const widen = coverWiden(cls, radiusScale);
          for (const mesh of meshes) {
            if (mesh.material) {
              attachDistanceFade(mesh.material);
              if (widen !== null) setDistanceWiden(mesh.material, widen);
              attachWet(mesh.material, WET_CAP_BY_CLASS.get(cls)!);
            }
          }
          return {
            meshes,
            buf: EMPTY_BUFFER,
            bands: EMPTY_BUFFER,
            foliage: EMPTY_BUFFER,
            count: 0,
            grown: false,
            fade,
            ramp: lod === FAR_LOD && COVER_RAMP_CLASSES.has(cls),
            far: lod === FAR_LOD ? coverFarBand(cls, radiusScale) : null,
            tints: profile !== undefined,
            culled: culling && CLUTTER_CULLED.has(cls),
            drawn: { buf: EMPTY_BUFFER, bands: EMPTY_BUFFER, foliage: EMPTY_BUFFER },
            origins: EMPTY_BUFFER,
            cull: culling && CLUTTER_CULLED.has(cls)
              ? cullSet(0, EMPTY_BUFFER, { src: EMPTY_BUFFER, dst: EMPTY_BUFFER }, [], [])
              : null,
            staged: { buf: EMPTY_BUFFER, bands: EMPTY_BUFFER, foliage: EMPTY_BUFFER, origins: EMPTY_BUFFER },
            stagedCount: 0,
          };
        }),
      ),
    );
    culledBuckets = buckets.flat(2).filter((bucket) => bucket.culled);
    maybeBuild(true);
  }

  /** Production path: the nineteen clutter GLBs, `forestMeshes.ts`'s loading
   * idiom (itself `characterModel.ts`'s). */
  async function loadAssets(): Promise<void> {
    registerBuiltInLoaders();
    try {
      const loaded: Mesh[][][][] = [];
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        if (cls === CLUTTER_SHRUB) {
          loaded.push(built("shrub", SHRUB_CHARACTERS.length, shrubGeometry));
          continue;
        }
        if (cls === CLUTTER_WETPLANT) {
          loaded.push(built("wetplant", WET_PLANT_COUNT, wetPlantGeometry));
          continue;
        }
        if (cls === CLUTTER_HIGHPLANT) {
          loaded.push(built("highplant", HIGH_PLANT_COUNT, highPlantGeometry));
          continue;
        }
        const urls = CLUTTER_MODEL_URLS[cls] as readonly string[];
        const variants: Mesh[][][] = [];
        for (const url of urls) {
          const groups = await loadBucketed(url, clutterLodNames(cls));
          if (groups === null) return;
          variants.push(groups);
        }
        loaded.push(variants);
      }
      adopt(loaded);
    } catch {
      // A missing or broken asset costs the ground cover, never the match —
      // the same degrade-don't-block rule as `createForestMeshes`. A dispose
      // mid-load ends here too, with the rest of the list never fetched.
    }
  }

  // Fire and forget, like the forest's: clutter pops in when the assets land,
  // and stays absent forever if they fail. The NullEngine escape hatch runs
  // synchronously so the attachment is provable under test.
  if (options.assets !== undefined) adopt(options.assets);
  else void loadAssets();

  return {
    update(x, z) {
      if (disposed) return;
      if (turn(heading, x - camX, z - camZ)) aimed = false;
      camX = x;
      camZ = z;
      // While the GLBs are still loading this only remembers the camera;
      // adopt() replays it the moment they land.
      maybeBuild(false);
    },
    cull(pose) {
      if (disposed || culledBuckets.length === 0) return;
      if (!dirty && (pose === null ? cutMode === "all" : cutMode === "pose" && !needsCull(lastPose, pose))) return;
      let planes = KEEP_ALL;
      if (pose === null) {
        cutMode = "all";
      } else {
        cullPlanes(pose, cullScratchPlanes);
        planes = cullScratchPlanes;
        Object.assign(lastPose, pose);
        cutMode = "pose";
      }
      dirty = false;
      for (const bucket of culledBuckets) cutBucket(bucket, planes);
    },
    casterMeshes,
    get kept() {
      return kept.size;
    },
    view,
    dispose() {
      if (disposed) return;
      disposed = true;
      jobs?.cancel(owner);
      jobs?.idle(owner, null);
      // A build the loader still holds is dropped with the shell: it would be stepped against meshes that have gone.
      options.firstBuilds?.cancel(owner);
      loads.abort();
      scene.getEngine().onContextRestoredObservable.remove(restoreObserver);
      if (buckets !== null) {
        for (const variants of buckets) {
          for (const perLod of variants) {
            for (const bucket of perLod) {
              for (const mesh of bucket.meshes) mesh.dispose();
            }
          }
        }
      }
      // Containers own whatever the buckets did not adopt (materials, LOD2
      // meshes, wrapper nodes); mesh.dispose is idempotent, so the overlap
      // with the loop above is harmless.
      for (const container of containers) container.dispose();
      for (const mat of builtMaterials) mat.dispose();
      casterMeshes.length = 0;
      buckets = null;
      culledBuckets = [];
    },
  };
}
