/**
 * The cliffs on Babylon Lite: rock-wall modules instanced along the steep
 * rock faces the field picks, three LOD buckets a model out to the tier's
 * reach, each a mesh drawn as thin instances (`listMeshes.ts`).
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * the modules round the eye, seated and tinted, split by ring
 * (`cliffInstances.ts`, `cliffField.ts`). This module is where those meet
 * Lite: the models its loader reads (`forestModels.ts`) and their
 * materials.
 *
 * **The materials**: a
 * model's own maps, its colour drawn half way to the ground's under each
 * module, the wet look at the cliffs' cap and the air. The two near rings
 * hand off by their geometry and share a material; the far ring dithers out
 * over the last metres of the reach, on a material of its own.
 *
 * **At the shipped density the field lays no module**: nothing is fetched,
 * no bucket is made, and the faces are the terrain's own.
 */
import {
  createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setPbrMetallicReflectance,
  type EngineContext, type MaterialPlugin, type PluginUniformBlock, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { CLIFF_DENSITY, CLIFF_MODELS } from "../../sim/cliffField.js";
import { modelUrl } from "../assetUrls.js";
import { cliffOrigin } from "../cliffField.js";
import { CLIFF_FAR_LOD, CLIFF_GROUND_TINT, CLIFF_LOD_NODES, createCliffLists } from "../cliffInstances.js";
import type { InstanceList } from "@csarkosh/engine/game/instanceLists";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { WetUniforms } from "@csarkosh/engine/game/wetSurface";
import { loadModel, type ModelPart } from "./forestModels.js";
import { baseColourPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, type Vegetation } from "./forestPlugins.js";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import type { ReflectionRegistry } from "./lakePanorama.js";
import type { CoverRegistry } from "./rainMap.js";
import { listMesh, showList, type ListMesh } from "./listMeshes.js";

export function cliffMeshName(model: number, lod: number): string {
  return `cliff_m${model}_l${lod}`;
}

export type CliffMeshes = {
  /** Follows the eye: the lists are made again when it crosses a cell of the field. Before the models have landed it only keeps where the eye is. */
  update(camX: number, camZ: number): void;
  /** Models still being fetched or decoded. */
  waiting(): number;
  /** Resolves once the models have landed and the first lists are drawn, or at once where the field lays none. A model that fails is said and costs its own buckets alone. */
  readonly ready: Promise<void>;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  dispose(): void;
};

export type CliffMeshOptions = {
  /** The tier's rings. */
  quality: QualityTier;
  /** The share of cells that start a run; the shipped density when absent. */
  density?: number;
  /** The eye the far ring's fade measures from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels: the fade's noise is laid on its rows. */
  frame: { readonly height: number };
  /** The wet look's uniforms at the cliffs' porosity cap (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block, which every material reads the wind, the eye, the wet line and the air from (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** The renderer's record of its uploads, and its budget for the streamed ones (`frameUploads.ts`). */
  uploads?: FrameUploads;
  /** The rain's cover map: the near rings' buckets are hard cover, each registered once as its model lands; its
   * instances come and go inside it (`rainMap.ts`). */
  cover?: CoverRegistry;
  /** What a lake's shore panorama draws of the cliffs: the far ring's buckets, each as its model lands (`lakePanorama.ts`). */
  reflections?: ReflectionRegistry;
};

/** A bucket: the mesh of one model's one LOD root, and the list it draws. */
type Bucket = { target: ListMesh; list: InstanceList };

export function createCliffMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: CliffMeshOptions): CliffMeshes {
  const lists = createCliffLists(seed, options.quality, options.density);
  const loads = new AbortController();
  const materials: PbrMaterialProps[] = [];
  /** `buckets[model][lod]`; a slot is null where the model did not land or its file has no such root. */
  const buckets: (Bucket | null)[][] = CLIFF_MODELS.map(() => CLIFF_LOD_NODES.map(() => null));
  /** Each material's place among the draws: a model's near ring's, then its far ring's. */
  const orders = createDrawOrders(DRAW_ORDER.cliffs);
  let adopted = false;
  let disposed = false;
  let waiting = 0;
  let camX = Number.NaN;
  let camZ = Number.NaN;
  let builtX = Number.NaN;
  let builtZ = Number.NaN;

  /** A ring's material of a model: its maps and colour, the ground's tint, the far ring's dither, the wet look and the air. */
  function material(part: ModelPart, far: boolean, model: number): { made: PbrMaterialProps; vegetation: Vegetation } {
    const vegetation: Vegetation = {
      eye: options.eye, frame: options.frame, shared: options.shared, foliage: null, match: false, light: false, fade: far, conform: false, moss: null, deadwood: null, sky: true,
      ground: CLIFF_GROUND_TINT,
    };
    const made = createPbrMaterial({
      baseColorFactor: [part.factor[0], part.factor[1], part.factor[2], 1], metallicFactor: 0, roughnessFactor: 1,
      doubleSided: part.facts.doubleSided, usePhysicalLightFalloff: true,
      ...(part.colour === undefined ? {} : { baseColorTexture: part.colour }),
      ...(part.normal === undefined ? {} : { normalTexture: part.normal }),
    });
    setPbrMetallicReflectance(made, { color: [1, 1, 1], f0Factor: part.facts.specularWeight ?? 1 });
    made.plugins = [baseColourPlugin(), vegetationPlugin(vegetation), surfaceWetPlugin(options.wet, options.shared), options.air()];
    materials.push(made);
    orders.put(made, model * 2 + (far ? 1 : 0));
    return { made, vegetation };
  }

  const held = (model: number, lod: number): boolean => (buckets[model]?.[lod] ?? null) !== null;

  /** Fills the lists for the eye and shows every bucket, when the eye's origin on the field's lattice has moved. */
  function maybeBuild(): void {
    if (!adopted || disposed || Number.isNaN(camX)) return;
    const origin = cliffOrigin(camX, camZ);
    if (origin.x === builtX && origin.z === builtZ) return;
    lists.rebuild(camX, camZ, held);
    for (const row of buckets) {
      for (const bucket of row) if (bucket !== null) showList(bucket.target, bucket.list, bucket.list.count, options.uploads);
    }
    builtX = origin.x;
    builtZ = origin.z;
  }

  async function load(): Promise<void> {
    // A field that lays no module needs no model: nothing is fetched and no bucket is made.
    if ((options.density ?? CLIFF_DENSITY) === 0) return;
    waiting = CLIFF_MODELS.length;
    const settled = await Promise.allSettled(CLIFF_MODELS.map((output) =>
      loadModel(engine, modelUrl(output), CLIFF_LOD_NODES, loads.signal).finally(() => {
        waiting--;
      }),
    ));
    if (disposed) return;
    settled.forEach((result, model) => {
      if (result.status === "rejected") {
        // The shell keeps whatever loaded: the other model's buckets go on.
        console.error(`the cliffs' model ${CLIFF_MODELS[model]} could not be made; its modules are not drawn`, result.reason);
        return;
      }
      const roots = CLIFF_LOD_NODES.map((name) => result.value.get(name) ?? []);
      // A root holding more than one primitive is refused outright rather than half-drawn.
      const crowded = roots.findIndex((parts) => parts.length > 1);
      if (crowded >= 0) {
        console.error(`the cliffs' model ${CLIFF_MODELS[model]} holds ${roots[crowded]?.length} primitives under ${CLIFF_LOD_NODES[crowded]}; one is expected, and its modules are not drawn`);
        return;
      }
      const first = roots.find((parts) => parts.length > 0)?.[0];
      if (first === undefined) return;
      const near = material(first, false, model);
      const far = material(first, true, model);
      roots.forEach((parts, lod) => {
        const part = parts[0];
        if (part === undefined) return;
        const { made, vegetation } = lod === CLIFF_FAR_LOD ? far : near;
        const mesh = createMeshFromData(engine, cliffMeshName(model, lod), part.positions, part.normals, part.indices, part.uvs, undefined, part.tangents ?? undefined);
        mesh.material = made;
        mesh.renderOrder = orders.of(made);
        (buckets[model] as (Bucket | null)[])[lod] = {
          target: listMesh(scene, mesh, vegetationInstanceLayout(vegetation)),
          list: (lists.lists[model] as InstanceList[])[lod] as InstanceList,
        };
        if (lod !== CLIFF_FAR_LOD) options.cover?.add(mesh);
        else options.reflections?.add(mesh);
      });
    });
    adopted = true;
    // An eye that arrived while the models loaded is honoured now.
    maybeBuild();
  }

  const ready = load().catch((error: unknown) => {
    waiting = 0;
    if (!disposed) console.error("the cliffs could not be made; none is drawn", error);
  });

  return {
    update(x, z) {
      if (disposed) return;
      camX = x;
      camZ = z;
      maybeBuild();
    },
    waiting() {
      return Math.max(0, waiting);
    },
    ready,
    drawn() {
      let meshes = 0;
      let instances = 0;
      for (const row of buckets) {
        for (const bucket of row) {
          if (bucket === null || bucket.target.count === 0) continue;
          meshes++;
          instances += bucket.target.count;
        }
      }
      return { meshes, instances };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      for (const row of buckets) {
        for (const [lod, bucket] of row.entries()) {
          if (bucket === null) continue;
          options.cover?.remove(bucket.target.mesh);
          options.reflections?.remove(bucket.target.mesh);
          removeFromScene(scene, bucket.target.mesh);
          disposeMeshGpu(bucket.target.mesh);
          row[lod] = null;
        }
      }
      materials.length = 0;
    },
  };
}
