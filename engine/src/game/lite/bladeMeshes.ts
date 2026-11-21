/**
 * The grass on Babylon Lite: the blade field's clumps, one bucket a clump
 * character, distance tier and size, drawn as thin instances over the
 * meadow's near cards on the tiers that draw blades.
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * the clumps' geometry (`bladeClump.ts`), the lists of cells round the eye
 * with their matrices, ground tints and strengths, cut to the view
 * (`bladeInstances.ts`), each tier's hand-off band (`bladeField.ts`) and
 * the foliage's numbers (`foliageUniforms.ts`). This module is where those
 * meet Lite: a mesh a bucket (`listMeshes.ts`) and a material a tier.
 *
 * **The material**: opaque,
 * the meadow green under the clump's own vertex colours, drawn on both
 * sides and lit on one, with the foliage at the blades' profile (the wind,
 * each blade's collapse to its root across the tier's band and by the
 * cell's strength, the ground's colour drawn into it, its own answer to the
 * sun) and the air. Matched to the ground, so nothing glints on it. No
 * distance dither and no wet look: every hand-off is geometric.
 *
 * **The lists follow the eye and the view.** They are made again when the
 * eye crosses a metre: at a walk as a job of the renderer's scheduler
 * (`rebuildJobs.ts`), whose last slice hands the cut every tier's cells at
 * once, and between crossings the cells the next one adds are looked up as
 * idle work. They are cut again to the view after a rebuild and whenever it
 * has turned or moved past `grassCull.ts`'s thresholds; a cut sends only
 * the buckets whose kept cells changed. Until a rebuild is whole the
 * buckets draw the last cut of the last one.
 */
import {
  createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setPbrMetallicReflectance,
  type EngineContext, type MaterialPlugin, type PluginUniformBlock, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { BLADE_ALBEDO, BLADE_CHARACTERS, bladeClumpGeometry, bladeCountFor, type BladeQuality } from "../bladeClump.js";
import { BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, BLADE_SIZE_COUNT, bladeTierBands } from "../bladeField.js";
import { BLADE_ROUGHNESS, BLADE_TIER_COUNT, createBladeLists } from "../bladeInstances.js";
import { FOLIAGE_PROFILES, foliageLook } from "../foliageUniforms.js";
import type { CullPose } from "../grassCull.js";
import type { FirstBuilds } from "../firstBuilds.js";
import type { InstanceList } from "../instanceLists.js";
import type { SyncJobs } from "../syncJobs.js";
import {
  baseColourPlugin, oneSidedLightPlugin, surfaceSplitPlugin, vegetationInstanceLayout, vegetationPlugin, type Vegetation,
} from "./forestPlugins.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { listMesh, showList, type ListMesh } from "./listMeshes.js";
import { cellOrigin, createRebuilds } from "./rebuildJobs.js";

export function bladeMeshName(character: number, tier: number, size: number): string {
  return `blade_clumps_c${character}_t${tier}_s${size}`;
}

export type BladeMeshes = {
  /** Follows the eye: the lists are made again when it crosses a metre, at a walk over the frames after. */
  update(camX: number, camZ: number): void;
  /** Draws the cells inside the view of `pose` (`null`: every cell), cutting again only after a rebuild or once the view has moved past the thresholds. */
  cull(pose: CullPose | null): void;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  dispose(): void;
};

export type BladeMeshOptions = {
  /** The tier's blade counts. */
  quality: BladeQuality;
  /** The eye the foliage measures from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels. */
  frame: { readonly height: number };
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

export function createBladeMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: BladeMeshOptions): BladeMeshes {
  // The lists and the buckets are in one order: tier, then character, then size.
  const lists = createBladeLists(seed);
  const materials: PbrMaterialProps[] = [];
  const buckets: ListMesh[] = [];
  const bands = bladeTierBands();
  /** Each tier's material's place among the draws. */
  const orders = createDrawOrders(DRAW_ORDER.blades);
  for (let tier = 0; tier < BLADE_TIER_COUNT; tier++) {
    const clumps = [];
    // The tier's tallest clump is the height its material's sway is weighed by: one material serves the tier.
    let tallest = 0;
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
        const geometry = bladeClumpGeometry(BLADE_CHARACTERS[ch] as (typeof BLADE_CHARACTERS)[number], bladeCountFor(options.quality, ch, tier, size));
        tallest = Math.max(tallest, heightOf(geometry.positions));
        clumps.push({ name: bladeMeshName(ch, tier, size), geometry });
      }
    }
    // The canopy's cut of the sun is the ground's own on cover matched to it.
    const look = foliageLook(`blade_clumps_t${tier}_mat`, FOLIAGE_PROFILES.BLADES, tallest, { sunShadowed: true });
    look.bladeEdges = bands[tier] as (typeof bands)[number];
    const vegetation: Vegetation = {
      eye: options.eye, frame: options.frame, shared: options.shared, foliage: look, match: true, light: true, fade: false, conform: false, moss: null, deadwood: null, sky: true,
    };
    const material = createPbrMaterial({
      baseColorFactor: [BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b, 1], metallicFactor: 0, roughnessFactor: BLADE_ROUGHNESS,
      doubleSided: true, usePhysicalLightFalloff: true,
    });
    // Matched to the ground: nothing glints on it.
    setPbrMetallicReflectance(material, { color: [1, 1, 1], f0Factor: 0 });
    material.plugins = [baseColourPlugin(), oneSidedLightPlugin(), vegetationPlugin(vegetation), surfaceSplitPlugin(), options.air()];
    materials.push(material);
    orders.take(material);
    const layout = vegetationInstanceLayout(vegetation);
    for (const { name, geometry } of clumps) {
      const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, Uint32Array.from(geometry.indices), undefined, undefined, undefined, geometry.colors);
      mesh.material = material;
      mesh.renderOrder = orders.of(material);
      // A blade's root and draw, a vertex: after the material, whose plugin declares it.
      mesh.pluginVertexData = geometry.blade;
      buckets.push(listMesh(scene, mesh, layout));
    }
  }
  let disposed = false;
  // The lists' own rebuild: its last slice copies every tier into the buffers the cut reads, and the next cut shows them.
  const rebuilds = createRebuilds({
    name: "blades",
    cell: BLADE_REBUILD_CELL,
    origin: cellOrigin(BLADE_REBUILD_CELL),
    rebuild: (x, z) => lists.rebuild(x, z),
    ahead: (x, z, hx, hz) => lists.prefetch(x, z, hx, hz),
    jobs: options.jobs,
    firstBuilds: options.firstBuilds,
  });
  const show = (list: InstanceList, index: number): void => {
    showList(buckets[index] as ListMesh, list.drawn, list.cull?.kept ?? 0, options.uploads);
  };

  return {
    update(x, z) {
      if (disposed) return;
      // The buckets go on drawing the last cut until the cut after the rebuild.
      rebuilds.update(x, z);
    },
    cull(pose) {
      if (disposed) return;
      lists.cut(pose, show);
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
