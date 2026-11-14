/**
 * The Babylon shell over `bladeField.ts`: one thin-instance bucket per clump
 * character, distance tier and size, on one opaque material per tier, drawn
 * from the lists `bladeInstances.ts` makes of the field's tiers with the
 * cards' own matrix, trample and tint writers plus a per-instance strength.
 * Rebuilt on the field's own 1 m crossing; no per-frame allocation on the hot
 * path, the clutter shell's discipline. Nothing here dithers: every hand-off
 * is geometric, so no bucket carries the distance fade or `fadeBands`.
 *
 * The split is `clutterMeshes.ts`'s and for the same reason: all band and
 * placement maths is the pure field, the buffers and the cut are the lists',
 * which load no engine, and what lives here is meshes, materials, uploads
 * and dispose. The thirty-six buckets are the product of three axes that
 * cannot be collapsed — a character is a different MESH (its own blade table
 * and tip feature, so its own vertex data), a tier is a different blade COUNT
 * of the same character and a different hand-off band, and a size is a
 * further COUNT scaling of the same character and tier (`bladeCountFor`), so
 * a cell that buys a bigger clump gets a mesh with more blades rather than a
 * scaled-up one. Tier is the material axis because the band is a material
 * uniform on the foliage plugin; neither character nor size is, since all
 * twelve of a tier's character-size buckets share that band exactly.
 *
 * Draw-call budget: 4 characters × 3 tiers × 3 sizes = 36 draws, opaque and
 * single-material, drawn over the meadow's near cards.
 *
 * Culled to the view (`grassCull.ts`). The buckets surround the eye and
 * Babylon draws a thin-instanced mesh whole or not at all, so each bucket
 * keeps two sets of buffers: the COLLECTED ones the rebuild writes, which stay
 * on the CPU, and the DRAWN ones handed to the mesh. `cull`, run from the
 * renderer once the camera's pose for the frame is final, copies the cells
 * inside a slightly widened frustum to the front of the drawn buffers, in
 * order (so still nearest first), sets the count to them and uploads only
 * that prefix. It does that after every rebuild and whenever the view has
 * moved past grassCull.ts's thresholds, and nothing otherwise. The draw count
 * is the buckets' own and does not change; a bucket whose prefix is empty is
 * disabled, which can only lower it.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, BLADE_SIZE_COUNT, bladeTierBands } from "./bladeField.js";
import { BLADE_ROUGHNESS, BLADE_TIER_COUNT, createBladeLists } from "./bladeInstances.js";
import { BLADE_ALBEDO, BLADE_CHARACTERS, bladeClumpGeometry, bladeCountFor, type BladeQuality } from "./bladeClump.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageBladeEdges } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { prepBucketMesh } from "./clutterMeshes.js";
import type { CullPose } from "./grassCull.js";
import type { InstanceList } from "./instanceLists.js";
import { createCrossing, crossingAt, turn, type Heading, type Slices, type SyncJobs } from "./syncJobs.js";
import { buildAtOnce, type FirstBuilds } from "./firstBuilds.js";

// A cell's height scale, and the lists the buckets draw (the collected
// buffers a rebuild writes, the drawn ones a cut fills from them), are
// `bladeInstances.ts`'s, which loads no engine; named from here too.
export { BLADE_CANOPY_HEIGHT, BLADE_STRENGTH_HEIGHT, bladeHeightScale } from "./bladeInstances.js";

export const BLADE_MESH_PREFIX = "blade_clumps";
export function bladeMeshName(character: number, tier: number, size: number): string {
  return `${BLADE_MESH_PREFIX}_c${character}_t${tier}_s${size}`;
}

export type BladeMeshesOptions = {
  quality: BladeQuality;
  /** The renderer's scheduler: a one-cell step at a walk rebuilds as a job
   * over the frames that follow rather than in the frame of the crossing. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike
   * (`firstBuilds.ts`): a build that cannot wait is stepped by it rather
   * than run whole in the call that asked for it. Absent, it runs whole. */
  firstBuilds?: FirstBuilds;
};

export type BladeMeshes = {
  update(camX: number, camZ: number): void;
  /**
   * Draws only the cells inside the frustum of `pose` widened by
   * `CULL_MARGIN` (grassCull.ts), refiltering after a rebuild or once the
   * view has moved past the thresholds, and doing nothing otherwise. `null`
   * draws every collected cell. Until the first call after a rebuild, the
   * buckets draw the prefix of the last cut.
   */
  cull(pose: CullPose | null): void;
  /** The eye position the collected buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /**
   * Every bucket mesh, in tier-then-character-then-size order. Unlike the
   * clutter shell's `casterMeshes` this array is complete the moment
   * `createBladeMeshes` returns and never grows: the clumps are generated
   * geometry, not a GLB that has to land first, so there is no deferred
   * adoption and no contract to watch the length.
   */
  readonly meshes: readonly Mesh[];
  /** Cells whose matrix and tint are kept (keptValues.ts). */
  readonly kept: number;
  dispose(): void;
};

/**
 * Hands a grown bucket's new drawn buffers to its mesh after a rebuild. A
 * bucket that did not grow needs nothing here: its mesh keeps drawing the last
 * cut's prefix, whose drawn buffers the rebuild does not touch, until `cull`
 * cuts the new collected set, which it does in the same frame. A grown one
 * has fresh, empty drawn buffers, so it draws nothing until then.
 *
 * The buffers are created UPDATABLE (`staticBuffer` false) for the reason
 * `clutterMeshes.ts` records: `Buffer.updateDirectly` no-ops silently on a
 * non-updatable buffer, so `cull`'s prefix uploads would never reach the GPU.
 */
function applyGrown(list: InstanceList, mesh: Mesh): void {
  if (!list.grown) return;
  mesh.thinInstanceSetBuffer("matrix", list.drawn.buf, 16, false);
  mesh.thinInstanceSetBuffer("foliage", list.drawn.foliage, 4, false);
  mesh.thinInstanceSetBuffer("bladeStrength", list.drawn.strength, 1, false);
  // `thinInstanceSetBuffer` set the count to the whole capacity. A zero-count
  // bucket must be disabled outright: with `instancesCount` 0 Babylon's
  // `hasThinInstances` is false and the bare clump mesh would be drawn once at
  // the origin.
  mesh.thinInstanceCount = 0;
  mesh.setEnabled(false);
}

/**
 * Hands a bucket's drawn buffers, at their full capacity, back to its mesh.
 * After a WebGL context restore Babylon rebuilds each GPU buffer from the data
 * it was last given, which a prefix upload leaves as the prefix alone; a later,
 * longer cut would then write past its end. The bucket draws nothing until the
 * next cut fills it again.
 */
function rehandBucket(list: InstanceList, mesh: Mesh): void {
  if (list.drawn.buf.length === 0) return;
  list.grown = true;
  applyGrown(list, mesh);
  list.grown = false;
}

/**
 * A bucket whose cut changed: its mesh's count set to the kept cells, and
 * only them uploaded (Babylon's count form of
 * `thinInstancePartialBufferUpdate`: `kept` strides from offset 0). A bucket
 * that keeps exactly the cells of its last cut is never handed here: no
 * copy, no upload.
 */
function uploadCut(list: InstanceList, mesh: Mesh): void {
  const kept = list.cull?.kept ?? 0;
  mesh.thinInstanceCount = kept;
  if (kept > 0) {
    mesh.thinInstancePartialBufferUpdate("matrix", kept, 0);
    mesh.thinInstancePartialBufferUpdate("foliage", kept, 0);
    mesh.thinInstancePartialBufferUpdate("bladeStrength", kept, 0);
  }
  mesh.setEnabled(kept > 0);
}

/** One tier's material: opaque, two-sided, the meadow green, with the
 * blades profile, the sun-only translucency, its tier's hand-off band, and
 * never the distance fade. No texture and no alpha, so the material never
 * alpha-tests and never compiles a discard — early depth rejection stays on
 * for the whole draw, which keeps a full near field of grass cheap over the
 * cards drawn under it. The hand-off is geometric instead: each blade
 * shrinks to its root across the band, so there is nothing to dither. */
function createTierMaterial(scene: Scene, tier: number, meshHeight: number): PBRMaterial {
  const mat = new PBRMaterial(`${BLADE_MESH_PREFIX}_t${tier}_mat`, scene);
  mat.albedoColor = new Color3(BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = BLADE_ROUGHNESS;
  mat.backFaceCulling = false;
  // The clumps receive cast shadows (`createClumpMesh`), so the canopy's cut
  // of the sun is the shadow's: the plugin's sun factor binds 0 here.
  attachFoliage(mat, FOLIAGE_PROFILES.BLADES, meshHeight, { sunShadowed: true });
  attachFoliageLight(mat);
  setFoliageBladeEdges(mat, bladeTierBands()[tier]!);
  return mat;
}

/** The clump mesh for one character, tier and size: the pure geometry through
 * `VertexData`, the `blade` record as a custom vertex buffer (set after
 * `applyToMesh`, which rebuilds the mesh's buffers). */
function createClumpMesh(scene: Scene, character: number, tier: number, size: number, count: number): Mesh {
  const g = bladeClumpGeometry(BLADE_CHARACTERS[character]!, count);
  const mesh = new Mesh(bladeMeshName(character, tier, size), scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  // `applyToMesh` already set the bounding box from the positions, and a
  // custom vertex kind does not move it, so the box the caller reads the
  // material's height uniform off is correct as it stands — and it must be,
  // because `prepBucketMesh` pins it (`doNotSyncBoundingInfo`) and nothing
  // syncs it again for the life of the mesh.
  mesh.setVerticesData("blade", g.blade, false, 4);
  prepBucketMesh(mesh);
  // The one clutter that receives shadows, against the rule `prepBucketMesh`
  // just applied: opaque, near the eye and inside the first cascade, a clump
  // under the canopy must sit in the turf's shadow — lit geometry on shadowed
  // ground reads as a glow at this range, where a card's could hide behind its
  // size and its cutout. It still never casts; no clutter does.
  mesh.receiveShadows = true;
  return mesh;
}

export function createBladeMeshes(scene: Scene, seed: number, options: BladeMeshesOptions): BladeMeshes {
  // The lists (`bladeInstances.ts`): the cells collected, their kept matrices
  // and tints, the buffers and the cut. `lists.all` and `meshes` are in one
  // order, tier then character then size.
  const lists = createBladeLists(seed);
  const materials: PBRMaterial[] = [];
  const meshes: Mesh[] = [];
  for (let tier = 0; tier < BLADE_TIER_COUNT; tier++) {
    const row: Mesh[] = [];
    // The tier's tallest clump sets the material's height uniform, which the
    // plugin divides the vertex's height by to weight the sway. One material
    // serves all twelve of the tier's character-size buckets, so the tallest
    // of them is the only choice that never drives a weight past 1.
    let tallest = 0;
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
        const mesh = createClumpMesh(scene, ch, tier, size, bladeCountFor(options.quality, ch, tier, size));
        tallest = Math.max(tallest, mesh.getBoundingInfo().boundingBox.maximum.y);
        row.push(mesh);
        meshes.push(mesh);
      }
    }
    const mat = createTierMaterial(scene, tier, tallest);
    for (const mesh of row) mesh.material = mat;
    materials.push(mat);
  }
  let disposed = false;
  const jobs = options.jobs;
  const restoreObserver = scene.getEngine().onContextRestoredObservable.add(() => {
    for (const [i, list] of lists.all.entries()) rehandBucket(list, meshes[i] as Mesh);
    lists.forgetCuts();
  });
  const uploadChanged = (list: InstanceList, index: number): void => uploadCut(list, meshes[index] as Mesh);

  /**
   * The rebuild for an eye at (x, z), as slices (`syncJobs.ts`): the lists'
   * own, whose last slice copies every tier into the collected buffers
   * `cull` reads, and in that same step a grown bucket's new drawn buffers
   * to its mesh; `cull` uploads the rest.
   */
  function* rebuild(x: number, z: number): Slices {
    yield* lists.rebuild(x, z);
    for (const [i, list] of lists.all.entries()) applyGrown(list, meshes[i] as Mesh);
    aimed = false;
  }

  const crossing = createCrossing();
  const owner = {};
  const heading: Heading = { x: 0, z: 0 };
  /** Whether the idle work is aimed at the next crossings from where the
   * last rebuild left the field, on the present heading. */
  let aimed = false;
  /** Sets the idle work (`syncJobs.ts`) to look up the cells the next
   * crossings add, while no rebuild is pending. */
  function aim(x: number, z: number): void {
    if (aimed || jobs === undefined || jobs.pending(owner)) return;
    aimed = true;
    jobs.idle(owner, lists.prefetch(x, z, heading.x, heading.z));
  }

  return {
    /**
     * Rebuild only when the eye's snapped origin moves, on the field's own
     * BLADE_REBUILD_CELL — the cell BLADE_PAD is derived from, so every tier
     * list collected at the old origin still covers the eye anywhere inside
     * the new cell and no clump pops. A one-cell step at a walk is a job
     * given `options.jobs` (`crossingAt` says which crossings build at once).
     */
    update(x, z) {
      if (disposed) return;
      const ox = Math.floor(x / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      const oz = Math.floor(z / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      if (turn(heading, x - crossing.lastX, z - crossing.lastZ)) aimed = false;
      const kind = crossingAt(crossing, x, z, ox, oz, BLADE_REBUILD_CELL, jobs !== undefined, jobs?.started());
      if (kind === "none") {
        // While the loader steps this shell's build, nothing is prepared ahead of it.
        if (options.firstBuilds?.queued(owner) !== true) aim(x, z);
        return;
      }
      options.firstBuilds?.cancel(owner);
      if (kind === "later") {
        (jobs as SyncJobs).begin(owner, rebuild(x, z), false, "blades");
        return;
      }
      jobs?.cancel(owner);
      buildAtOnce(options.firstBuilds, owner, rebuild(x, z), "blades");
    },
    view: lists.view,
    cull(pose) {
      if (disposed) return;
      lists.cut(pose, uploadChanged);
    },
    meshes,
    get kept() {
      return lists.kept;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      jobs?.cancel(owner);
      jobs?.idle(owner, null);
      // A build the loader still holds is dropped with the shell: it would be stepped against meshes that have gone.
      options.firstBuilds?.cancel(owner);
      scene.getEngine().onContextRestoredObservable.remove(restoreObserver);
      // The meshes and the materials are both ours — generated here, adopted
      // from no container — so both have to be disposed by hand.
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
      meshes.length = 0;
    },
  };
}
