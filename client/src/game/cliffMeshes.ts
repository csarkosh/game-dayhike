/**
 * The cliff modules' Babylon shell: rock-wall models instanced along the
 * steep rock faces the field (`sim/cliffField.ts`) picks, in three LOD buckets
 * per model out to the tier's reach. LOD0 → LOD1 → LOD2 hand off
 * geometrically at fixed rings, the opaque path the rock props take (a
 * discard on an opaque material costs frame time scene-wide — see
 * distanceFadePlugin.ts); only the far bucket dithers, out over the last
 * `CLIFF_FADE_BAND` metres, on a material of its own, because a wall
 * popping out of the skyline at the reach is visible and its fragments at
 * that range are few. Every instance carries the ground colour under it for
 * the tint plugin (`cliffTintPlugin.ts`). The near buckets cast shadows. The
 * lists the buckets draw are `cliffInstances.ts`'s, made with no engine.
 *
 * Where a module stands is the simulation's, and in the level id; this
 * shell only draws what the field placed. Nothing here may migrate into
 * sim/.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import { modelUrl } from "./assetUrls.js";
import { loadContainer, loadUntilAborted } from "./modelLoad.js";
import { cliffOrigin } from "./cliffField.js";
import { CLIFF_DENSITY, CLIFF_MODELS } from "../sim/cliffField.js";
import { CLIFF_FAR_LOD as FAR_LOD, CLIFF_LOD_NODES, createCliffLists } from "./cliffInstances.js";
import { attachCliffTint } from "./cliffTintPlugin.js";
import { prepBucketMesh } from "./clutterMeshes.js";
import { attachDistanceFade } from "./distanceFadePlugin.js";
import type { InstanceList } from "./instanceLists.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";
import type { QualityTier } from "./quality.js";

// The LOD roots, a module's seat and matrix, and the lists the buckets draw
// are `cliffInstances.ts`'s, which loads no engine; named from here too.
export { CLIFF_LOD_NODES, cliffInstanceMatrix, cliffSeat } from "./cliffInstances.js";

export const CLIFF_MESH_PREFIX = "cliff";
export function cliffMeshName(model: number, lod: number): string {
  return `${CLIFF_MESH_PREFIX}_m${model}_l${lod}`;
}

export type CliffMeshesOptions = {
  quality: QualityTier;
  /** How a model's GLB is fetched; the default loads it by URL. A test hands
   * in a reader of the file on disk. */
  loader?: (output: string) => Promise<AssetContainer>;
  /** The share of cells that start a run (`cliffCellRuns`); the default is
   * `CLIFF_DENSITY`. A test lays the field at a share of its own. */
  density?: number;
};

export type CliffMeshes = {
  update(camX: number, camZ: number): void;
  /** Every bucket mesh, model-major then LOD. Empty until the GLBs land. */
  readonly meshes: readonly Mesh[];
  /** The LOD0 and LOD1 buckets — the ones that enter the shadow map, the
   * same contract `ForestMeshes.casterMeshes` carries: the renderer registers
   * new entries as they appear. */
  readonly casterMeshes: readonly Mesh[];
  /** Resolves once every model has loaded, or at once where the field lays
   * none (a density of 0), with nothing fetched. */
  readonly ready: Promise<void>;
  dispose(): void;
};

/** A bucket: the mesh of one model's one LOD root, and the list it draws. */
type Bucket = { mesh: Mesh; list: InstanceList };

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
  const fetchModel = options.loader ?? ((output: string) => loadContainer(modelUrl(output), scene));
  // Aborted first thing in `dispose`: a load in flight then ends at once and
  // quietly, and none starts after it (`modelLoad.ts`).
  const loads = new AbortController();
  const load = (output: string): Promise<AssetContainer> => loadUntilAborted(() => fetchModel(output), loads.signal);
  // The lists (`cliffInstances.ts`): the modules collected, their matrices,
  // their kept tints and the far ring's bands.
  const lists = createCliffLists(seed, options.quality, options.density);
  const containers: AssetContainer[] = [];
  /** The far buckets' material clones — this shell's own, so nothing else
   * disposes them. */
  const farMaterials: Material[] = [];
  /** `buckets[model][lod]`; a slot is null when the GLB brought no such root. */
  const buckets: (Bucket | null)[][] = [];
  const meshes: Mesh[] = [];
  const casterMeshes: Mesh[] = [];
  let builtX = NaN;
  let builtZ = NaN;
  let pendingX = NaN;
  let pendingZ = NaN;

  /** Whether a model's LOD root landed: the lists fill only the buckets that have a mesh. */
  const held = (model: number, lod: number): boolean => (buckets[model]?.[lod] ?? null) !== null;

  function rebuild(x: number, z: number): void {
    if (meshes.length === 0) return;
    lists.rebuild(x, z, held);
    for (let lod = 0; lod < CLIFF_LOD_NODES.length; lod++) {
      for (const row of buckets) {
        const b = row[lod];
        if (!b) continue;
        const { mesh, list } = b;
        // Replaced wholesale on every rebuild (the tree shell's discipline);
        // "matrix" first, since it fixes the count the others are checked
        // against, and exact-length views so Babylon never reads past the
        // instances this rebuild wrote.
        mesh.thinInstanceSetBuffer("matrix", list.buf.subarray(0, list.count * 16), 16, true);
        mesh.thinInstanceSetBuffer("foliage", list.foliage.subarray(0, list.count * 4), 4, true);
        if (lod === FAR_LOD) mesh.thinInstanceSetBuffer("fadeBands", list.bands.subarray(0, list.count * 4), 4, true);
        // With `instancesCount` 0 Babylon's `hasThinInstances` is false and
        // the bare model would be drawn once at the origin.
        mesh.setEnabled(list.count > 0);
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
    // A field that lays no module needs no model: nothing is fetched, no
    // bucket is made, and `update` finds no mesh to fill.
    if ((options.density ?? CLIFF_DENSITY) === 0) return;
    if (options.loader === undefined) registerBuiltInLoaders();
    for (const [model, output] of CLIFF_MODELS.entries()) {
      let container: AssetContainer;
      try {
        container = await load(output);
      } catch (error) {
        // Disposed while loading: nothing failed, and nothing is left to do.
        if (loads.signal.aborted) return;
        throw error;
      }
      if (loads.signal.aborted) {
        // Disposed between the load settling and this line running (a
        // dispose from another promise's continuation): `dispose` already ran
        // over an earlier container list, so clean up what just landed here.
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
          attachWet(mesh.material, WET_CAP.cliff);
        }
        row.push({ mesh, list: (lists.lists[model] as InstanceList[])[lod] as InstanceList });
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
    if (loads.signal.aborted) return;
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
      if (loads.signal.aborted) return;
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
      if (loads.signal.aborted) return;
      loads.abort();
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
