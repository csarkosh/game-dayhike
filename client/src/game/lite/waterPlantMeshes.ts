/**
 * A murky lake's plants on Babylon Lite: the reeds and the cattails, the
 * lily pads and their flowers, as the game draws them on Babylon.js
 * (`waterPlants.ts`), from the shapes and the lists made with no engine
 * (`waterPlantShapes.ts`): a mesh a reed variant, one for the pads and one
 * for the flowers, each every lake's plants of its kind as instances,
 * placed once.
 *
 * **The reeds' material**, as the game dresses it: white under the clump's
 * own vertex colours, drawn on both sides and lit on one, with the foliage
 * at the reeds' profile (the wind's bend, the root's shade, its own answer
 * to the sun) out to the reeds' wind edges, and the air. A pad and a flower
 * are plain: their colour, their roughness, a depth offset toward the eye
 * for a face that lies on the water, and the air.
 *
 * **A draw a kind of plant the view holds, and none otherwise.** Lite culls
 * no mesh, so each of the five is shown only while the view's planes hold
 * one of the boxes its plants stand in, a box a 16 m cell of the ground
 * (`plantBoxes`): the reeds of a far bank are drawn without the pads
 * behind the eye. Nothing is written a frame: the lists never change, and
 * the wind the reeds bend in is the frame's block's.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setPbrMetallicReflectance, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type SceneContext,
} from "@babylonjs/lite";
import type { LakeSource } from "../../sim/terrain.js";
import type { Rgb } from "../colour.js";
import { FOLIAGE_PROFILES, foliageLook } from "../foliageUniforms.js";
import { boxInPlanes, type ViewPlane } from "../lakeSeen.js";
import type { WaterPlantPlacements } from "../waterPlantField.js";
import {
  LILY_DEPTH_BIAS, LILY_FLOWER_COLOUR, LILY_FLOWER_ROUGHNESS, LILY_PAD_COLOUR, LILY_PAD_ROUGHNESS, REED_CHARACTERS, REED_ROUGHNESS, REED_WIND_EDGES,
  lilyFlowerGeometry, lilyPadGeometry, plantBoxes, reedGeometry, waterPlantLists, type WaterPlantGeometry, type WaterPlantList,
} from "../waterPlantShapes.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import { baseColourPlugin, oneSidedLightPlugin, surfaceSplitPlugin, vegetationPlugin, type Vegetation } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";
import { MATRIX_BYTES } from "./listMeshes.js";

/** How far a reed clump reaches about its root and over it, metres: its tallest blade at the class's largest scale, drooped. */
export const REED_AROUND_M = 1;
export const REED_TOP_M = 2.5;
/** How far a pad reaches about its centre, and a flower: a pad's radius is its scale. */
export const LILY_AROUND_M = 1;
/** How far under and over its place a lily, or a reed's root on uneven ground, is taken to reach. */
export const PLANT_SLACK_M = 0.25;

export type WaterPlantOptions = {
  /** The eye the foliage measures from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels. */
  frame: { readonly height: number };
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** A depth offset toward the eye, in the depth buffer's units, as a plugin. */
  ahead: (units: number) => MaterialPlugin;
  /** The frame's block. */
  shared: PluginUniformBlock;
  /** Each lake's plants placed ahead, by its place in the list. */
  placements?: readonly (WaterPlantPlacements | null)[];
  uploads?: FrameUploads;
};

export type LiteWaterPlants = {
  /** The reeds' three meshes, the pads' and the flowers': those with a plant. */
  readonly meshes: readonly Mesh[];
  /** Shows each mesh while the view's planes hold one of its plants' boxes, and hides it while they hold none. */
  seen(planes: readonly ViewPlane[]): void;
  /** Meshes shown, and the plants each mesh holds. */
  readonly shown: number;
  readonly counts: readonly number[];
  dispose(): void;
};

/** The height of the tallest vertex of `positions` (xyz a vertex). */
function heightOf(positions: Float32Array): number {
  let top = 0;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i] as number);
  return top;
}

/** The plants of `lakes` in world `seed`, made after the scene is registered. */
export function createLiteWaterPlants(
  engine: EngineContext, scene: SceneContext, seed: number, lakes: readonly LakeSource[], options: WaterPlantOptions,
): LiteWaterPlants {
  const { uploads } = options;
  const lists = waterPlantLists(seed, lakes, options.placements);
  const orders = createDrawOrders(DRAW_ORDER.waterPlants);
  const meshes: Mesh[] = [];
  const counts: number[] = [];
  /** Each mesh's boxes (`plantBoxes`) and whether it is shown. */
  const boxes: Float32Array[] = [];
  const visible: boolean[] = [];

  /** `geometry` as a mesh of `material` holding `list`, in the scene and hidden; nothing for an empty list. */
  function stand(name: string, geometry: WaterPlantGeometry, material: PbrMaterialProps, list: WaterPlantList, around: number, above: number): void {
    orders.take(material);
    if (list.count === 0) return;
    const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, Uint32Array.from(geometry.indices), undefined, undefined, undefined, geometry.colors);
    mesh.material = material;
    mesh.renderOrder = orders.of(material);
    setThinInstances(mesh, list.matrices, list.count);
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    uploads?.count("geometry", geometry.positions.byteLength + geometry.normals.byteLength + geometry.colors.byteLength + geometry.indices.byteLength * 2, 4);
    uploads?.count("instances", list.count * MATRIX_BYTES);
    uploads?.composed(list.count);
    uploads?.made();
    meshes.push(mesh);
    counts.push(list.count);
    boxes.push(plantBoxes(list, around, PLANT_SLACK_M, above));
    visible.push(false);
  }

  for (let variant = 0; variant < REED_CHARACTERS.length; variant++) {
    const geometry = reedGeometry(variant);
    // The reeds would take the sun's cast shadow, so the canopy's cut of the sun is the shadow's and none of the look's.
    const look = foliageLook(`water_reeds_${variant}_mat`, FOLIAGE_PROFILES.REEDS, heightOf(geometry.positions), { sunShadowed: true });
    look.edges = REED_WIND_EDGES;
    const vegetation: Vegetation = {
      eye: options.eye, frame: options.frame, shared: options.shared, foliage: look, match: false, light: true, fade: false, conform: false, moss: null, deadwood: null, sky: true,
    };
    const material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: REED_ROUGHNESS, doubleSided: true, usePhysicalLightFalloff: true });
    setPbrMetallicReflectance(material, { color: [1, 1, 1], f0Factor: 1 });
    material.plugins = [baseColourPlugin(), oneSidedLightPlugin(), vegetationPlugin(vegetation), surfaceSplitPlugin(), options.air()];
    stand(`water_reeds_${variant}`, geometry, material, lists.reeds[variant] as WaterPlantList, REED_AROUND_M, REED_TOP_M);
  }
  const plain = (colour: Rgb, roughness: number): PbrMaterialProps => {
    const material = createPbrMaterial({
      baseColorFactor: [colour.r, colour.g, colour.b, 1], metallicFactor: 0, roughnessFactor: roughness, doubleSided: true, usePhysicalLightFalloff: true,
    });
    material.plugins = [oneSidedLightPlugin(), options.ahead(-LILY_DEPTH_BIAS), options.air()];
    return material;
  };
  stand("water_lily_pads", lilyPadGeometry(), plain(LILY_PAD_COLOUR, LILY_PAD_ROUGHNESS), lists.pads, LILY_AROUND_M, PLANT_SLACK_M);
  stand("water_lily_flowers", lilyFlowerGeometry(), plain(LILY_FLOWER_COLOUR, LILY_FLOWER_ROUGHNESS), lists.flowers, LILY_AROUND_M, PLANT_SLACK_M);

  let shown = 0;
  let disposed = false;
  return {
    meshes,
    counts,
    get shown() {
      return shown;
    },
    seen(planes) {
      if (disposed) return;
      for (let m = 0; m < meshes.length; m++) {
        const cells = boxes[m] as Float32Array;
        let now = false;
        for (let at = 0; at < cells.length && !now; at += 6) {
          now = boxInPlanes(cells[at] as number, cells[at + 1] as number, cells[at + 2] as number, cells[at + 3] as number, cells[at + 4] as number, cells[at + 5] as number, planes);
        }
        if (now === visible[m]) continue;
        visible[m] = now;
        shown += now ? 1 : -1;
        setMeshVisible(meshes[m] as Mesh, now);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
        uploads?.dropped();
      }
    },
  };
}
