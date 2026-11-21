/**
 * The duff on Babylon Lite: the near field of dead leaves, twigs and small
 * branches, one bucket a clump character and distance tier, drawn as thin
 * instances on the tiers that draw the blade grass: what the grass field
 * thins out, this fills in.
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * the clumps' geometry (`duffClump.ts`), the lists of cells round the eye
 * with their matrices, ground tints and strengths (`duffInstances.ts`),
 * each tier's hand-off band (`duffField.ts`) and the foliage's numbers
 * (`foliageUniforms.ts`). This module is where those meet Lite: a mesh a
 * bucket (`listMeshes.ts`) and a material a tier.
 *
 * **The material**: opaque,
 * the dead-leaf brown under the clump's own vertex colours, drawn on both
 * sides and lit on one, with the foliage at the duff's profile (no wind;
 * each piece's collapse to its root across the tier's band and by the
 * cell's strength; the ground's colour drawn into it; its own answer to the
 * sun), the wet look at the duff's cap and the air. No distance dither:
 * every hand-off is geometric.
 *
 * **The lists follow the eye**: made again when it crosses a metre, at a
 * walk as a job of the renderer's scheduler (`rebuildJobs.ts`) whose last
 * slice fills every bucket's list and shows them together, so no frame
 * draws one tier moved on against another that has not. Between crossings
 * the cells the next one adds are looked up as idle work.
 */
import {
  createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setPbrMetallicReflectance,
  type EngineContext, type MaterialPlugin, type PluginUniformBlock, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { DUFF_ALBEDO, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_TIER_COUNTS, duffClumpGeometry } from "../duffClump.js";
import { DUFF_REACH, DUFF_REBUILD_CELL, duffTierBands } from "../duffField.js";
import { DUFF_ROUGHNESS, DUFF_TIER_COUNT, createDuffLists } from "../duffInstances.js";
import { FOLIAGE_PROFILES, foliageLook } from "../foliageUniforms.js";
import type { FirstBuilds } from "../firstBuilds.js";
import type { InstanceList } from "../instanceLists.js";
import type { Slices, SyncJobs } from "../syncJobs.js";
import type { WetUniforms } from "../wetSurface.js";
import {
  baseColourPlugin, oneSidedLightPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, type Vegetation,
} from "./forestPlugins.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { listBytes, listMesh, showList, type ListMesh } from "./listMeshes.js";
import { cellOrigin, createRebuilds } from "./rebuildJobs.js";

/** What showing the duff's lists is expected to take (ms): each bucket handed its list, one step. The scheduler
 * learns the figure on the device it runs on (`syncJobs.ts`) and trusts it where it is more. */
const DUFF_UPLOAD_MS = 1;

export function duffMeshName(character: number, tier: number): string {
  return `duff_clumps_c${character}_t${tier}`;
}

export type DuffMeshes = {
  /** Follows the eye: the lists are made again when it crosses a metre, at a walk over the frames after. */
  update(camX: number, camZ: number): void;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  dispose(): void;
};

export type DuffMeshOptions = {
  /** The tier's reach and piece counts. */
  quality: "high" | "medium";
  /** The eye the foliage measures from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels. */
  frame: { readonly height: number };
  /** The wet look's uniforms at the duff's porosity cap (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block, which every material reads the wind, the eye, the wet line and the air from (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** The renderer's scheduler: given it, a crossing at a walk is a job. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike (`firstBuilds.ts`). */
  firstBuilds?: FirstBuilds;
  /** The renderer's record of its uploads, and its budget for the streamed ones (`frameUploads.ts`). */
  uploads?: FrameUploads;
};

/** The height of the tallest vertex of `positions` (xyz a vertex) over the clump's own ground. */
function heightOf(positions: Float32Array): number {
  let top = 0;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i] as number);
  return top;
}

export function createDuffMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: DuffMeshOptions): DuffMeshes {
  const reach = DUFF_REACH[options.quality];
  // The lists and the buckets are in one order: tier, then character.
  const lists = createDuffLists(seed, reach);
  const materials: PbrMaterialProps[] = [];
  const buckets: ListMesh[] = [];
  const bands = duffTierBands(reach);
  /** Each tier's material's place among the draws. */
  const orders = createDrawOrders(DRAW_ORDER.duff);
  for (let tier = 0; tier < DUFF_TIER_COUNT; tier++) {
    const clumps = [];
    // The tier's tallest clump is the height its material's foliage is weighed by: one material serves the tier.
    let tallest = 0;
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      const geometry = duffClumpGeometry(DUFF_CHARACTERS[ch] as (typeof DUFF_CHARACTERS)[number], DUFF_TIER_COUNTS[options.quality][tier] as number);
      tallest = Math.max(tallest, heightOf(geometry.positions));
      clumps.push({ name: duffMeshName(ch, tier), geometry });
    }
    // The canopy's cut of the sun is the ground's own on cover that lies on it.
    const look = foliageLook(`duff_clumps_t${tier}_mat`, FOLIAGE_PROFILES.DUFF, tallest, { sunShadowed: true });
    look.bladeEdges = bands[tier] as (typeof bands)[number];
    const vegetation: Vegetation = {
      eye: options.eye, frame: options.frame, shared: options.shared, foliage: look, match: false, light: true, fade: false, conform: false, moss: null, deadwood: null, sky: true,
    };
    const material = createPbrMaterial({
      baseColorFactor: [DUFF_ALBEDO.r, DUFF_ALBEDO.g, DUFF_ALBEDO.b, 1], metallicFactor: 0, roughnessFactor: DUFF_ROUGHNESS,
      doubleSided: true, usePhysicalLightFalloff: true,
    });
    setPbrMetallicReflectance(material, { color: [1, 1, 1], f0Factor: 1 });
    material.plugins = [baseColourPlugin(), oneSidedLightPlugin(), vegetationPlugin(vegetation), surfaceWetPlugin(options.wet, options.shared), options.air()];
    materials.push(material);
    orders.take(material);
    const layout = vegetationInstanceLayout(vegetation);
    for (const { name, geometry } of clumps) {
      const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, Uint32Array.from(geometry.indices), undefined, undefined, undefined, geometry.colors);
      mesh.material = material;
      mesh.renderOrder = orders.of(material);
      // A piece's root and draw, a vertex: after the material, whose plugin declares it.
      mesh.pluginVertexData = geometry.blade;
      buckets.push(listMesh(scene, mesh, layout));
    }
  }
  let disposed = false;

  /** The rebuild for an eye at (x, z): the lists' own, whose last slice fills every list, and in that same step each bucket shown. */
  function* rebuild(x: number, z: number): Slices {
    yield* lists.rebuild(x, z);
    // The lists are filled; the meshes go on drawing the last ones until the frame's upload budget has room for these.
    // Showing them is one step, whose cost the scheduler learns.
    yield DUFF_UPLOAD_MS;
    if (options.uploads !== undefined) {
      let sending = 0;
      for (let i = 0; i < buckets.length; i++) {
        const list = lists.all[i] as InstanceList;
        sending += listBytes(list.count, (buckets[i] as ListMesh).layout.floats);
      }
      yield* options.uploads.hold(sending);
    }
    if (disposed) return;
    for (let i = 0; i < buckets.length; i++) {
      const list = lists.all[i] as InstanceList;
      showList(buckets[i] as ListMesh, list, list.count, options.uploads);
    }
  }
  const rebuilds = createRebuilds({
    name: "duff",
    cell: DUFF_REBUILD_CELL,
    origin: cellOrigin(DUFF_REBUILD_CELL),
    rebuild,
    ahead: (x, z, hx, hz) => lists.prefetch(x, z, hx, hz),
    jobs: options.jobs,
    firstBuilds: options.firstBuilds,
  });

  return {
    update(x, z) {
      if (disposed) return;
      rebuilds.update(x, z);
    },
    drawn() {
      let meshes = 0;
      let instances = 0;
      for (const bucket of buckets) {
        if (bucket.count === 0) continue;
        meshes++;
        instances += bucket.count;
      }
      return { meshes, instances };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rebuilds.dispose();
      for (const bucket of buckets) {
        removeFromScene(scene, bucket.mesh);
        disposeMeshGpu(bucket.mesh);
      }
      buckets.length = 0;
      materials.length = 0;
    },
  };
}
