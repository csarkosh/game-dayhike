/**
 * The Babylon shell over `clutterField.ts`: thin-
 * instance buckets for the fourteen clutter classes — grass, rock, boulder,
 * driftwood, fungus, bush, meadow, flower, litter, sword fern, shrub, drift log, wet plant, high plant — two LOD
 * levels deep. All band
 * math is `clutterField.ts` (via its memoizing `createClutterCollector`,
 * output-identical to the pure `collectClutter`), and the lists the buckets
 * draw are `clutterLists.ts`'s, made with no engine; what lives here is
 * meshes, materials, uploads and dispose — the same split as `forestField.ts`/`forestMeshes.ts`,
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
 * (`instanceLists.ts`), both grown geometrically and never shrunk, and
 * composes each matrix through module-level scratch objects. This is the one place
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

import { clutterFadeEdges, coverWiden } from "./clutterField.js";
import {
  CLUTTER_MODEL_IDS, CUT_CLASSES, DRIFTLOG_BLEACH, FAR_LOD, FOLIAGE_BY_CLASS, LOD_NAMES, NEAR_LOD, SHRUB_F0, SHRUB_ROUGHNESS, WET_CAP_BY_CLASS,
  clutterLodNames, clutterNearLodName, cutModel, seatDriftLogs,
} from "./clutterInstances.js";
import { createClutterLists, type ClutterBucket, type ClutterLists } from "./clutterLists.js";
import { CLUTTER_BOULDER, CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, CLUTTER_GRASS_CELL, CLUTTER_HIGHPLANT, CLUTTER_SHRUB, CLUTTER_WETPLANT } from "../sim/clutter.js";
import { attachFoliage, setFoliageEdges, foliageMatched } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { attachDistanceFade, setDistanceWiden } from "./distanceFadePlugin.js";
import { attachWet } from "./wetPlugin.js";
import { modelUrl } from "./assetUrls.js";
import { coverAlbedoTint, FOLIAGE_CARD_CONTRAST } from "./coverAlbedoParams.js";
import { SHRUB_CHARACTERS, shrubGeometry } from "./shrubClump.js";
import { WET_PLANT_COUNT, wetPlantGeometry } from "./wetPlantClump.js";
import { HIGH_PLANT_COUNT, highPlantGeometry } from "./highPlantClump.js";
import { ROCK_CUTS, rockPlanes, rockRelief, type RockPlane } from "./rockRelief.js";
import type { CullPose } from "./grassCull.js";
import type { InstanceList } from "./instanceLists.js";
import { loadContainer, loadUntilAborted } from "./modelLoad.js";
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
 * drawing one instance list (`clutterLists.ts`): the list's own buffers, or
 * for a list filtered to the view its drawn ones.
 */
type Bucket = { meshes: Mesh[]; bucket: ClutterBucket };

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
function applyBucket({ meshes, bucket: { list } }: Bucket): void {
  if (list.culled) {
    applyCulled(meshes, list);
    return;
  }
  const count = list.count;
  const tints = list.streams.foliage;
  for (const mesh of meshes) {
    if (list.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", list.buf, 16, false);
      mesh.thinInstanceSetBuffer("fadeBands", list.bands, 4, false);
      if (tints) mesh.thinInstanceSetBuffer("foliage", list.foliage, 4, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("fadeBands");
        if (tints) mesh.thinInstanceBufferUpdated("foliage");
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
function applyCulled(meshes: readonly Mesh[], list: InstanceList): void {
  if (!list.grown) return;
  for (const mesh of meshes) {
    mesh.thinInstanceSetBuffer("matrix", list.drawn.buf, 16, false);
    mesh.thinInstanceSetBuffer("fadeBands", list.drawn.bands, 4, false);
    if (list.streams.foliage) mesh.thinInstanceSetBuffer("foliage", list.drawn.foliage, 4, false);
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
function rehandCulled({ meshes, bucket: { list } }: Bucket): void {
  if (list.cull === null || list.drawn.buf.length === 0) return;
  list.grown = true;
  applyCulled(meshes, list);
  list.grown = false;
}

/**
 * A culled bucket whose cut changed: its meshes' count set to the kept cards,
 * and only them uploaded (Babylon's count form of
 * `thinInstancePartialBufferUpdate`: `kept` strides from offset 0). A bucket
 * that keeps exactly the cards of its last cut is never handed here: no
 * copy, no upload.
 */
function uploadCut({ meshes, bucket: { list } }: Bucket): void {
  const kept = list.cull?.kept ?? 0;
  for (const mesh of meshes) {
    mesh.thinInstanceCount = kept;
    if (kept > 0) {
      mesh.thinInstancePartialBufferUpdate("matrix", kept, 0);
      mesh.thinInstancePartialBufferUpdate("fadeBands", kept, 0);
      if (list.streams.foliage) mesh.thinInstancePartialBufferUpdate("foliage", kept, 0);
    }
    mesh.setEnabled(kept > 0);
  }
}

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
  const casterMeshes: Mesh[] = [];
  const containers: AssetContainer[] = [];
  /** The materials of the classes built in code, which no container owns. */
  const builtMaterials: PBRMaterial[] = [];
  /** The lists the buckets draw (`clutterLists.ts`: the instances collected,
   * their kept matrices and tints, the buffers and the cut), and the buckets
   * in the lists' own order; null until the GLBs land. */
  let lists: ClutterLists | null = null;
  let buckets: Bucket[] | null = null;
  /** A list's bucket: the meshes that draw it. */
  const bucketOf = new Map<ClutterBucket, Bucket>();
  let disposed = false;
  /** Aborted first thing in `dispose`: a GLB in flight then ends at once and
   * quietly, and none starts after it (`modelLoad.ts`). */
  const loads = new AbortController();
  const restoreObserver = scene.getEngine().onContextRestoredObservable.add(() => {
    if (buckets === null || lists === null) return;
    for (const bucket of buckets) rehandCulled(bucket);
    lists.forgetCuts();
  });
  const uploadChanged = (changed: ClutterBucket): void => uploadCut(bucketOf.get(changed) as Bucket);

  // Last camera seen. An `update` that arrives while the GLBs are still
  // loading is honoured the moment they land.
  let camX = NaN;
  let camZ = NaN;

  /**
   * Rebuild, as slices (`syncJobs.ts`): the lists' own, whose last slice
   * copies every bucket's staged instances into the buffers it draws, and in
   * that same step pushes them to the meshes (a culled bucket's by `cull`),
   * so no frame draws a bucket half rebuilt.
   */
  function* rebuild(x: number, z: number): Slices {
    yield* (lists as ClutterLists).rebuild(x, z);
    for (const bucket of buckets as Bucket[]) applyBucket(bucket);
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
  /** Sets the idle work (`syncJobs.ts`) to look up the cells the next
   * crossings add, while no rebuild is pending. */
  function aim(): void {
    if (aimed || jobs === undefined || jobs.pending(owner)) return;
    aimed = true;
    jobs.idle(owner, (lists as ClutterLists).prefetch(camX, camZ, heading.x, heading.z));
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
    if (buckets === null || lists === null || Number.isNaN(camX)) return;
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
    const groups = loaded.map((variants, cls) => expandCutVariants(cls, nearLodVariants(cls, variants)));
    lists = createClutterLists(seed, { radiusScale, nearBlades, cull: culling, rows: groups.map((rows) => rows.length) });
    const made: Bucket[] = [];
    groups.forEach((rows, cls) =>
      rows.forEach((perLod, row) =>
        perLod.forEach((meshes, lod) => {
          for (const mesh of meshes) prepBucketMesh(mesh);
          // Boulders are the only clutter that casts — see `casterMeshes`.
          // BOTH their LOD buckets do: a boulder crossing the near/far split
          // would otherwise drop its shadow mid-view.
          if (cls === CLUTTER_BOULDER) casterMeshes.push(...meshes);
          // The class's disc edge, where its far level's sway and sink end;
          // the bands each bucket's instances fade across are the lists'
          // (`clutterBucketFade`).
          const edge = clutterFadeEdges(cls, radiusScale);
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
          const bucket: Bucket = { meshes, bucket: ((lists as ClutterLists).buckets[cls] as ClutterBucket[][])[row]![lod] as ClutterBucket };
          bucketOf.set(bucket.bucket, bucket);
          made.push(bucket);
        }),
      ),
    );
    buckets = made;
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
      if (disposed || lists === null) return;
      lists.cut(pose, uploadChanged);
    },
    casterMeshes,
    get kept() {
      return lists?.kept ?? 0;
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
        for (const bucket of buckets) {
          for (const mesh of bucket.meshes) mesh.dispose();
        }
      }
      // Containers own whatever the buckets did not adopt (materials, LOD2
      // meshes, wrapper nodes); mesh.dispose is idempotent, so the overlap
      // with the loop above is harmless.
      for (const container of containers) container.dispose();
      for (const mat of builtMaterials) mat.dispose();
      casterMeshes.length = 0;
      buckets = null;
      lists = null;
      bucketOf.clear();
    },
  };
}
