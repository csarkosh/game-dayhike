/**
 * The Babylon shell over `duffField.ts`: one thin-instance bucket per clump
 * character and distance tier, on one opaque material per tier, drawn from
 * the lists `duffInstances.ts` makes of the field's tiers with the cards'
 * own matrix and tint writers plus a per-instance strength.
 * `bladeMeshes.ts`'s sibling: same rebuild cadence, same two-pass fill, same
 * buffer-reuse discipline, same dispose. The differences are the field's own — two tiers, not three, since
 * duff never grows fine detail the way a blade clump does, and no size axis,
 * since a duff cell's `strength` is already bounded to [0, 1] and never buys a
 * bigger clump the way a blade cell's boosted `cover` does.
 *
 * Draw-call budget: 3 characters × 2 tiers = 6 draws, opaque and
 * single-material, filling in what the thinning grass field gives up.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DUFF_REACH, DUFF_REBUILD_CELL, duffTierBands } from "./duffField.js";
import { DUFF_ALBEDO, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_TIER_COUNTS, duffClumpGeometry } from "./duffClump.js";
import { DUFF_ROUGHNESS, DUFF_TIER_COUNT, createDuffLists } from "./duffInstances.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageBladeEdges } from "./foliagePlugin.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { prepBucketMesh } from "./clutterMeshes.js";
import type { InstanceList } from "./instanceLists.js";
import { createCrossing, crossingAt, turn, type Heading, type Slices, type SyncJobs } from "./syncJobs.js";
import { buildAtOnce, type FirstBuilds } from "./firstBuilds.js";

export const DUFF_MESH_PREFIX = "duff_clumps";
export function duffMeshName(character: number, tier: number): string {
  return `${DUFF_MESH_PREFIX}_c${character}_t${tier}`;
}
export type DuffMeshesOptions = {
  quality: "high" | "medium";
  /** The renderer's scheduler: a one-cell step at a walk rebuilds as a job
   * over the frames that follow rather than in the frame of the crossing. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike
   * (`firstBuilds.ts`): a build that cannot wait is stepped by it rather
   * than run whole in the call that asked for it. Absent, it runs whole. */
  firstBuilds?: FirstBuilds;
};

export type DuffMeshes = {
  update(camX: number, camZ: number): void;
  /** The eye position the buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /** Every bucket mesh, in tier-then-character order. Complete the moment
   * `createDuffMeshes` returns — the blade shell's own contract, since the
   * clumps are built here from vertex arrays rather than loaded from a GLB
   * that lands later. */
  readonly meshes: readonly Mesh[];
  /** Cells whose matrix and tint are kept (keptValues.ts). */
  readonly kept: number;
  dispose(): void;
};

/**
 * Pushes a filled bucket to its mesh — `bladeMeshes.ts`'s own `applyBucket`,
 * buffer names aside. See there for why the buffers are created UPDATABLE and
 * why the tail past `count` is re-uploaded whole on an in-place write.
 */
function applyBucket(list: InstanceList, mesh: Mesh): void {
  const { count } = list;
  if (list.grown) {
    mesh.thinInstanceSetBuffer("matrix", list.buf, 16, false);
    mesh.thinInstanceSetBuffer("foliage", list.foliage, 4, false);
    mesh.thinInstanceSetBuffer("bladeStrength", list.strength, 1, false);
    mesh.thinInstanceCount = count;
  } else {
    mesh.thinInstanceCount = count;
    if (count > 0) {
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.thinInstanceBufferUpdated("foliage");
      mesh.thinInstanceBufferUpdated("bladeStrength");
    }
  }
  // A zero-count bucket must be disabled outright: with `instancesCount` 0
  // Babylon's `hasThinInstances` is false and the bare clump mesh would be
  // drawn once at the origin.
  mesh.setEnabled(count > 0);
}

/** One tier's material: opaque, two-sided (a laid-down twig or leaf is seen
 * from any yaw), the dead-leaf albedo, with the DUFF profile, its tier's
 * hand-off band, and never the distance fade — the hand-off is geometric,
 * the blade shell's own reasoning. */
function createTierMaterial(scene: Scene, tier: number, meshHeight: number, reach: number): PBRMaterial {
  const mat = new PBRMaterial(`${DUFF_MESH_PREFIX}_t${tier}_mat`, scene);
  mat.albedoColor = new Color3(DUFF_ALBEDO.r, DUFF_ALBEDO.g, DUFF_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = DUFF_ROUGHNESS;
  mat.backFaceCulling = false;
  // The clumps receive cast shadows (`createClumpMesh`), so the canopy's cut
  // of the sun is the shadow's: the plugin's sun factor binds 0 here.
  attachFoliage(mat, FOLIAGE_PROFILES.DUFF, meshHeight, { sunShadowed: true });
  attachFoliageLight(mat);
  attachWet(mat, WET_CAP.duff);
  setFoliageBladeEdges(mat, duffTierBands(reach)[tier]!);
  return mat;
}

/** The clump mesh for one character and tier: the pure geometry through
 * `VertexData`, the `blade` record as a custom vertex buffer (set after
 * `applyToMesh`, which rebuilds the mesh's buffers). */
function createClumpMesh(scene: Scene, character: number, tier: number, count: number): Mesh {
  const g = duffClumpGeometry(DUFF_CHARACTERS[character]!, count);
  const mesh = new Mesh(duffMeshName(character, tier), scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("blade", g.blade, false, 4);
  prepBucketMesh(mesh);
  // Against `prepBucketMesh`'s own rule (clutter never receives shadows,
  // measured too costly at bush scale): duff lies flat on the turf, which
  // DOES receive shadows, so a lit mat on shadowed ground would be the exact
  // glow `bladeMeshes.ts` calls out for its own clumps — opaque, near the eye,
  // inside the first cascade — and the argument is stronger here than for a
  // standing blade, since duff is floor rather than something standing above
  // the ground it shares a shadow with. Argued, not measured: the ~4 ms
  // `prepBucketMesh` cites for bush-scale receivers is a real number against
  // a real frame budget, and these six buckets add shadow-receiving draws of
  // their own inside a 12 m disc with no frame-time reading behind them yet —
  // this comment states a case, not a result.
  mesh.receiveShadows = true;
  return mesh;
}

export function createDuffMeshes(scene: Scene, seed: number, options: DuffMeshesOptions): DuffMeshes {
  const reach = DUFF_REACH[options.quality];
  // The lists (`duffInstances.ts`): the cells collected, their kept matrices
  // and tints, and the buffers. `lists.all` and `meshes` are in one order,
  // tier then character.
  const lists = createDuffLists(seed, reach);
  const materials: PBRMaterial[] = [];
  const meshes: Mesh[] = [];
  for (let tier = 0; tier < DUFF_TIER_COUNT; tier++) {
    const row: Mesh[] = [];
    // The tier's tallest clump sets the material's height uniform, the blade
    // shell's own reasoning: one material serves all three of the tier's
    // character buckets, so the tallest is the only choice that never drives
    // the sway weight past 1 (moot here, since DUFF's amp is 0 — see below —
    // but the uniform is shared machinery the plugin always binds).
    let tallest = 0;
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      const count = DUFF_TIER_COUNTS[options.quality][tier]!;
      const mesh = createClumpMesh(scene, ch, tier, count);
      tallest = Math.max(tallest, mesh.getBoundingInfo().boundingBox.maximum.y);
      row.push(mesh);
      meshes.push(mesh);
    }
    const mat = createTierMaterial(scene, tier, tallest, reach);
    for (const mesh of row) mesh.material = mat;
    materials.push(mat);
  }
  let disposed = false;
  const jobs = options.jobs;

  /**
   * The rebuild for an eye at (x, z), as slices (`syncJobs.ts`): the lists'
   * own, whose last slice fills the very buffers the meshes hold, and in
   * that same step each bucket pushed to its mesh.
   */
  function* rebuild(x: number, z: number): Slices {
    yield* lists.rebuild(x, z);
    for (const [i, list] of lists.all.entries()) applyBucket(list, meshes[i] as Mesh);
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
     * DUFF_REBUILD_CELL; a one-cell step at a walk is a job given
     * `options.jobs` (`crossingAt` says which crossings build at once).
     */
    update(x, z) {
      if (disposed) return;
      const ox = Math.floor(x / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
      const oz = Math.floor(z / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
      if (turn(heading, x - crossing.lastX, z - crossing.lastZ)) aimed = false;
      const kind = crossingAt(crossing, x, z, ox, oz, DUFF_REBUILD_CELL, jobs !== undefined, jobs?.started());
      if (kind === "none") {
        // While the loader steps this shell's build, nothing is prepared ahead of it.
        if (options.firstBuilds?.queued(owner) !== true) aim(x, z);
        return;
      }
      options.firstBuilds?.cancel(owner);
      if (kind === "later") {
        (jobs as SyncJobs).begin(owner, rebuild(x, z), false, "duff");
        return;
      }
      jobs?.cancel(owner);
      buildAtOnce(options.firstBuilds, owner, rebuild(x, z), "duff");
    },
    view: lists.view,
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
      // The meshes and the materials are both ours — generated here, adopted
      // from no container — so both have to be disposed by hand.
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
      meshes.length = 0;
    },
  };
}
