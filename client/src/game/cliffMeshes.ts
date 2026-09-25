/**
 * The cliff modules' Babylon shell: rock-wall models instanced along the
 * steep rock faces the field (`cliffField.ts`) picks, in three LOD buckets
 * per model out to the tier's reach. LOD0 → LOD1 → LOD2 hand off
 * geometrically at fixed rings, the opaque path the rock props take (a
 * discard on an opaque material costs frame time scene-wide — see
 * distanceFadePlugin.ts); only the far bucket dithers, out over the last
 * `CLIFF_FADE_BAND` metres, on a material of its own, because a wall
 * popping out of the skyline at the reach is visible and its fragments at
 * that range are few. Every instance carries the ground colour under it for
 * the tint plugin (`cliffTintPlugin.ts`). The near buckets cast shadows.
 *
 * Renderer-only. Nothing here may migrate into sim/: the field reads the
 * simulation and writes nothing back, so the world and the level id are
 * untouched.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

import { modelUrl } from "./assetUrls.js";
import {
  CLIFF_FADE_BAND, CLIFF_MODEL_HEIGHT, CLIFF_MODELS, CLIFF_RINGS, CLIFF_SINK, CLIFF_TILT_MAX,
  cliffBands, cliffOrigin, createCliffCollector,
} from "./cliffField.js";
import { attachCliffTint } from "./cliffTintPlugin.js";
import { prepBucketMesh, trampleFrame, writeFoliage } from "./clutterMeshes.js";
import { attachDistanceFade, fadeBands, type FadeBands } from "./distanceFadePlugin.js";
import { seatOnGroundCapped } from "./groundTilt.js";
import type { QualityTier } from "./quality.js";
import type { ClutterInstance } from "../sim/clutter.js";

/** The LOD roots inside each GLB, by bucket. */
export const CLIFF_LOD_NODES: readonly [string, string, string] = ["LOD0", "LOD1", "LOD2"];
/** The bucket that dithers out at the reach, and the first bucket past the
 * ones that cast. */
const FAR_LOD = 2;
export const CLIFF_MESH_PREFIX = "cliff";
export function cliffMeshName(model: number, lod: number): string {
  return `${CLIFF_MESH_PREFIX}_m${model}_l${lod}`;
}

export type CliffMeshesOptions = {
  quality: QualityTier;
  /** How a model's GLB is fetched; the default loads it by URL. A test hands
   * in a reader of the file on disk. */
  loader?: (output: string) => Promise<AssetContainer>;
};

export type CliffMeshes = {
  update(camX: number, camZ: number): void;
  /** Every bucket mesh, model-major then LOD. Empty until the GLBs land. */
  readonly meshes: readonly Mesh[];
  /** The LOD0 and LOD1 buckets — the ones that enter the shadow map, the
   * same contract `ForestMeshes.casterMeshes` carries: the renderer registers
   * new entries as they appear. */
  readonly casterMeshes: readonly Mesh[];
  /** Resolves once every model has loaded. */
  readonly ready: Promise<void>;
  dispose(): void;
};

type Bucket = {
  mesh: Mesh;
  /** Matrix data; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** The `foliage` attribute; capacity is `tint.length / 4`. */
  tint: Float32Array;
  /** The far bucket's `fadeBands`; empty on the near buckets. */
  fade: Float32Array;
  count: number;
};

const EMPTY_BUFFER = new Float32Array(0);
const scratchMat = new Float32Array(16);
const scratchQ = new Quaternion();
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchWorld = new Matrix();

/**
 * A module's world matrix, written into `out` (16 floats): uniform scale, the
 * yaw in `hash` seated by the CAPPED lean, and the origin the field chose.
 *
 * Not the clutter's `instanceMatrixFor`, which seats its tilted classes on the
 * full ground normal: a wall laid back with a 45° face throws its top metres
 * out over the ground at its foot, which is ground the field's probes have not
 * cleared (`cliffField.ts`'s `CLIFF_TILT_MAX`). The sink is vertical and
 * already inside `groundH`, so there is no `CLUTTER_SINK` here either — that
 * two-centimetre nudge breaks coplanarity for cards lying on the surface, and
 * a module buried a third of its height needs no such help.
 */
export function cliffInstanceMatrix(inst: ClutterInstance, out: Float32Array): void {
  seatOnGroundCapped(inst.hash * Math.PI * 2, inst.groundDx, inst.groundDz, CLIFF_TILT_MAX, scratchQ);
  scratchScale.copyFromFloats(inst.scale, inst.scale, inst.scale);
  scratchPos.copyFromFloats(inst.x, inst.groundH, inst.z);
  Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchWorld);
  scratchWorld.copyToArray(out);
}

/** A buffer big enough for `needed` floats, doubling from 64 instances' worth
 * so a bucket allocates a bounded number of times over a session and never
 * per rebuild. The old contents are dropped rather than copied: every live
 * entry is rewritten immediately afterwards. */
function grow(buf: Float32Array, needed: number, stride: number): Float32Array {
  if (buf.length >= needed) return buf;
  let capacity = Math.max(buf.length, 64 * stride);
  while (capacity < needed) capacity *= 2;
  return new Float32Array(capacity);
}

/**
 * The one geometry mesh under `name` in a loaded container, with its node
 * transform baked into its vertices and its parent cut, so a thin-instance
 * matrix is the only transform it wears — `clutterMeshes.ts`'s `lodMeshes`,
 * narrowed to the one mesh each cliff GLB puts under a LOD root. Thin
 * instances compose as `world * instanceMatrix`, so any leftover mesh
 * transform would move the whole placed field rather than each module;
 * `bakeTransformIntoVertices` flips triangle winding when the determinant is
 * negative, so the loader's right-handed → left-handed mirror on `__root__`
 * keeps faces outward.
 *
 * A root holding more than ONE geometry mesh is refused outright rather than
 * half-drawn: only the first would ever reach a bucket, so the model would
 * silently lose a part of itself at that distance.
 */
function lodMesh(container: AssetContainer, name: string): Mesh | null {
  const nodes: Node[] = [...container.transformNodes, ...container.meshes];
  const root = nodes.find((n) => n.name === name);
  if (root === undefined) return null;
  const all: Node[] = [root, ...root.getChildMeshes(false)];
  const geometry = all.filter((n): n is Mesh => n instanceof Mesh && n.getTotalVertices() > 0);
  if (geometry.length > 1) {
    throw new Error(`cliff model root ${name} holds ${geometry.length} geometry meshes; expected one`);
  }
  const mesh = geometry[0];
  if (mesh === undefined) return null;
  mesh.bakeTransformIntoVertices(mesh.computeWorldMatrix(true).clone());
  mesh.position.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.rotation.setAll(0);
  mesh.scaling.setAll(1);
  mesh.parent = null;
  return mesh;
}

export function createCliffMeshes(scene: Scene, seed: number, options: CliffMeshesOptions): CliffMeshes {
  const rings = CLIFF_RINGS[options.quality];
  const reach = rings[2];
  const farBands: FadeBands = fadeBands(null, [reach - CLIFF_FADE_BAND, reach]);
  const load = options.loader ?? ((output: string) => loadAssetContainerAsync(modelUrl(output), scene));
  // Memoising, not the pure `collectCliffs`: a rebuild happens on every
  // `CLIFF_CELL` crossing, and a cell costs a terrain sample and a surface
  // classification (about twenty more for the half that qualify).
  const collector = createCliffCollector(seed);
  /**
   * The ground tint per instance, kept for as long as the collector keeps the
   * instance. The tint costs a terrain sample, a surface classification and a
   * canopy read, and the collector hands back the SAME instance object for
   * every cell it still holds — so without this the whole field in reach was
   * re-sampled on each 12 m crossing, on the same frame as the clutter's own
   * rebuild. A `WeakMap` because the collector's eviction is the lifetime
   * that matters: an instance it drops takes its tint with it.
   */
  const tints = new WeakMap<ClutterInstance, Float32Array>();
  function tintFor(m: ClutterInstance): Float32Array {
    let tint = tints.get(m);
    if (tint === undefined) {
      tint = new Float32Array(4);
      // The ground's OWN height, not the sunk one `groundH` carries: the tint
      // is the colour of the surface the module stands on, and read a third
      // of a module's height lower a sea cliff would be tinted from a band it
      // never touches. Rock is outside the trampled set, so the frame is the
      // identity — asked for rather than assumed, as every other writer does.
      const onGround: ClutterInstance = {
        ...m,
        groundH: m.groundH + CLIFF_SINK * m.scale * (CLIFF_MODEL_HEIGHT[m.variant] as number),
      };
      writeFoliage(seed, onGround, tint, 0, trampleFrame(seed, onGround));
      tints.set(m, tint);
    }
    return tint;
  }
  const containers: AssetContainer[] = [];
  /** The far buckets' material clones — this shell's own, so nothing else
   * disposes them. */
  const farMaterials: Material[] = [];
  /** `buckets[model][lod]`; a slot is null when the GLB brought no such root. */
  const buckets: (Bucket | null)[][] = [];
  const meshes: Mesh[] = [];
  const casterMeshes: Mesh[] = [];
  let disposed = false;
  let builtX = NaN;
  let builtZ = NaN;
  let pendingX = NaN;
  let pendingZ = NaN;

  function rebuild(x: number, z: number): void {
    if (meshes.length === 0) return;
    const { x: ox, z: oz } = cliffOrigin(x, z);
    const all = collector.collect(x, z, reach);
    const bands = cliffBands(all, ox, oz, rings);
    for (const [lod, band] of bands.entries()) {
      // Two passes: every bucket knows its size before a matrix is written,
      // so no buffer grows mid-fill.
      for (const row of buckets) { const b = row[lod]; if (b) b.count = 0; }
      for (const m of band) { const b = buckets[m.variant]?.[lod]; if (b) b.count++; }
      for (const row of buckets) {
        const b = row[lod];
        if (!b) continue;
        b.buf = grow(b.buf, b.count * 16, 16);
        b.tint = grow(b.tint, b.count * 4, 4);
        if (lod === FAR_LOD) b.fade = grow(b.fade, b.count * 4, 4);
        b.count = 0;
      }
      for (const m of band) {
        const b = buckets[m.variant]?.[lod];
        if (!b) continue;
        cliffInstanceMatrix(m, scratchMat);
        b.buf.set(scratchMat, b.count * 16);
        b.tint.set(tintFor(m), b.count * 4);
        if (lod === FAR_LOD) b.fade.set(farBands, b.count * 4);
        b.count++;
      }
      for (const row of buckets) {
        const b = row[lod];
        if (!b) continue;
        // Replaced wholesale on every rebuild (the tree shell's discipline);
        // "matrix" first, since it fixes the count the others are checked
        // against, and exact-length views so Babylon never reads past the
        // instances this rebuild wrote.
        b.mesh.thinInstanceSetBuffer("matrix", b.buf.subarray(0, b.count * 16), 16, true);
        b.mesh.thinInstanceSetBuffer("foliage", b.tint.subarray(0, b.count * 4), 4, true);
        if (lod === FAR_LOD) b.mesh.thinInstanceSetBuffer("fadeBands", b.fade.subarray(0, b.count * 4), 4, true);
        // With `instancesCount` 0 Babylon's `hasThinInstances` is false and
        // the bare model would be drawn once at the origin.
        b.mesh.setEnabled(b.count > 0);
      }
    }
  }

  /** The far bucket's own material, split off the one the GLB shares across
   * its three LOD roots. It has to happen before ANY plugin attaches:
   * `Material.clone()` reconstructs each attached plugin through Babylon's
   * own class registry, and ours are outside it, so a clone taken after an
   * attach throws (`forestMeshes.ts`'s LOD2 split records the same rule). */
  function splitFarMaterial(lods: readonly (Mesh | null)[]): void {
    const far = lods[FAR_LOD];
    const shared = far?.material;
    if (far === null || far === undefined || shared === null || shared === undefined) return;
    if (lods[0]?.material !== shared && lods[1]?.material !== shared) return;
    const clone = shared.clone(`${shared.name}_far`);
    if (clone === null) return;
    far.material = clone;
    farMaterials.push(clone);
  }

  async function loadAssets(): Promise<void> {
    if (options.loader === undefined) registerBuiltInLoaders();
    for (const [model, output] of CLIFF_MODELS.entries()) {
      const container = await load(output);
      if (disposed) {
        // `dispose` already ran over an earlier container list, so clean up
        // what just landed here.
        container.dispose();
        return;
      }
      containers.push(container);
      container.addAllToScene();
      const lods = CLIFF_LOD_NODES.map((name) => lodMesh(container, name));
      splitFarMaterial(lods);
      const row: (Bucket | null)[] = [];
      for (const [lod, mesh] of lods.entries()) {
        if (mesh === null) {
          row.push(null);
          continue;
        }
        mesh.name = cliffMeshName(model, lod);
        prepBucketMesh(mesh);
        // Against `prepBucketMesh`'s rule that clutter never receives
        // shadows, for the duff shell's reason: the modules stand on ground
        // that receives shadows, near the eye and inside the first cascade,
        // so a lit wall under a shadowed face would glow.
        mesh.receiveShadows = true;
        if (mesh.material !== null) {
          // The dither is paid on the far bucket alone, where its fragments
          // are few — `force`, because the material is opaque.
          if (lod === FAR_LOD) attachDistanceFade(mesh.material, { force: true });
          attachCliffTint(mesh.material);
        }
        row.push({ mesh, buf: EMPTY_BUFFER, tint: EMPTY_BUFFER, fade: EMPTY_BUFFER, count: 0 });
        meshes.push(mesh);
        if (lod < FAR_LOD) casterMeshes.push(mesh);
      }
      buckets.push(row);
      // Everything else the container brought (the loader's own `__root__`,
      // any empty wrapper) stays out of the draw.
      for (const other of container.meshes) {
        if (other instanceof Mesh && !meshes.includes(other)) other.setEnabled(false);
      }
    }
    if (disposed) return;
    // Replay the eye the caller handed over while the models were loading.
    if (!Number.isNaN(pendingX)) {
      rebuild(pendingX, pendingZ);
      const o = cliffOrigin(pendingX, pendingZ);
      builtX = o.x;
      builtZ = o.z;
    }
  }
  const ready = loadAssets();

  return {
    /** Rebuild only when the eye's snapped origin moves, and remember the eye
     * until the models land — this runs every frame, so it allocates nothing
     * in the common case. */
    update(x, z) {
      if (disposed) return;
      pendingX = x;
      pendingZ = z;
      if (meshes.length === 0) return;
      const { x: ox, z: oz } = cliffOrigin(x, z);
      if (ox === builtX && oz === builtZ) return;
      // Recorded only once the rebuild has returned: a throw part way through
      // must not leave the shell claiming an origin it never built, which
      // would freeze the field at the half-filled buckets for as long as the
      // eye stayed in that cell.
      rebuild(x, z);
      builtX = ox;
      builtZ = oz;
    },
    meshes,
    casterMeshes,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      // The far buckets' materials are this shell's own clones; the meshes
      // and everything else came out of the containers, so disposing those
      // takes them and the shipped materials with them.
      //
      // `true` for the textures: `Material.clone()` makes the clone its own
      // `Texture` wrappers (they share the source's internal GPU texture, so
      // the clone costs no texture memory), and those wrappers are owned
      // exclusively by this shell — the forest's per-mesh clones are disposed
      // the same way, and without it they outlive the level.
      for (const material of farMaterials) material.dispose(false, true);
      farMaterials.length = 0;
      for (const container of containers) container.dispose();
      containers.length = 0;
      buckets.length = 0;
      meshes.length = 0;
      casterMeshes.length = 0;
    },
  };
}
