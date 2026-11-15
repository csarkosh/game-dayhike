// client/src/game/waterPlants.ts
/**
 * A murky lake's plants: reeds and cattails on its wet band, its shallows and
 * its marsh; yellow pond-lilies on its 0.5 to 2 m water. The sim's clutter
 * field places them (`CLUTTER_REED`, `CLUTTER_LILY`, in the level id); this
 * draws every plant a lake has, once, at load, from the shapes and the lists
 * `waterPlantShapes.ts` makes with no engine. A lake is a few thousand
 * square metres, so nothing follows the camera.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { LakeSource } from "../sim/terrain.js";
import type { WaterPlantPlacements } from "./waterPlantField.js";
import { attachFoliage, setFoliageEdges, FOLIAGE_PROFILES } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import type { Rgb } from "./colour.js";
import {
  LILY_DEPTH_BIAS, LILY_FLOWER_COLOUR, LILY_FLOWER_ROUGHNESS, LILY_PAD_COLOUR, LILY_PAD_ROUGHNESS, REED_CHARACTERS, REED_ROUGHNESS, REED_WIND_EDGES,
  lilyFlowerGeometry, lilyPadGeometry, reedGeometry, waterPlantLists, type WaterPlantGeometry, type WaterPlantList,
} from "./waterPlantShapes.js";

export {
  CATTAIL_HEAD_AT, CATTAIL_HEAD_LENGTH, CATTAIL_HEAD_RADIUS, LILY_FLOWER_PATCHES, LILY_FLOWER_SHARE, LILY_LIFT, REED_BLADES, REED_CHARACTERS,
  lilyFlowerGeometry, lilyFlowers, lilyPadGeometry, lilyYaw, reedGeometry,
} from "./waterPlantShapes.js";

export type WaterPlants = { meshes: Mesh[]; dispose(): void };

function meshFrom(scene: Scene, name: string, g: WaterPlantGeometry): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.isPickable = false;
  return mesh;
}

function material(scene: Scene, name: string, albedo: Rgb, roughness: number): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = new Color3(albedo.r, albedo.g, albedo.b);
  mat.metallic = 0;
  mat.roughness = roughness;
  mat.backFaceCulling = false;
  return mat;
}

/** The plants of `list` as the mesh's thin instances. A mesh with none is disabled. */
function place(mesh: Mesh, list: WaterPlantList): void {
  if (list.count === 0) {
    mesh.setEnabled(false);
    return;
  }
  mesh.thinInstanceSetBuffer("matrix", list.matrices, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
}

/**
 * The plants of every lake in `lakes`. `placements[i]` is where lake i's
 * stand, made ahead (`waterPlantPlacements`, by `preparedScene.ts`); a lake
 * with none, or null, is sampled here.
 */
export function createWaterPlants(
  scene: Scene, seed: number, lakes: readonly LakeSource[], placements: readonly (WaterPlantPlacements | null)[] = [],
): WaterPlants {
  const lists = waterPlantLists(seed, lakes, placements);
  const meshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
  for (let variant = 0; variant < REED_CHARACTERS.length; variant++) {
    const mesh = meshFrom(scene, `water_reeds_${variant}`, reedGeometry(variant));
    const mat = material(scene, `water_reeds_${variant}_mat`, { r: 1, g: 1, b: 1 }, REED_ROUGHNESS);
    // The reeds receive cast shadows (below), so the canopy's cut of the sun
    // is the shadow's and the uniform binds 0.
    attachFoliage(mat, FOLIAGE_PROFILES.REEDS, mesh.getBoundingInfo().boundingBox.maximum.y, { sunShadowed: true });
    attachFoliageLight(mat);
    setFoliageEdges(mat, REED_WIND_EDGES);
    mesh.material = mat;
    mesh.receiveShadows = true;
    place(mesh, lists.reeds[variant] as WaterPlantList);
    meshes.push(mesh);
    materials.push(mat);
  }
  const padMesh = meshFrom(scene, "water_lily_pads", lilyPadGeometry());
  const padMat = material(scene, "water_lily_pads_mat", LILY_PAD_COLOUR, LILY_PAD_ROUGHNESS);
  padMat.zOffsetUnits = LILY_DEPTH_BIAS;
  padMesh.material = padMat;
  place(padMesh, lists.pads);
  const flowerMesh = meshFrom(scene, "water_lily_flowers", lilyFlowerGeometry());
  const flowerMat = material(scene, "water_lily_flowers_mat", LILY_FLOWER_COLOUR, LILY_FLOWER_ROUGHNESS);
  flowerMat.zOffsetUnits = LILY_DEPTH_BIAS;
  flowerMesh.material = flowerMat;
  place(flowerMesh, lists.flowers);
  meshes.push(padMesh, flowerMesh);
  materials.push(padMat, flowerMat);
  return {
    meshes,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
