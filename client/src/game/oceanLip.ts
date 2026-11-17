// client/src/game/oceanLip.ts
/**
 * The plunging lip's strip on the high tier (the sea's edge, spec §4.3): two
 * static meshes of columns across the cove's width and its end blends, a
 * metre apart near the camera and two metres beyond LIP_RANGE_M, each column
 * LIP_SLOTS cross-sections of LIP_PROFILE_VERTS vertices. A vertex's position
 * is not a place: it carries the column's world z, the slot and the section's
 * vertex, and the vertex stage (`shaders/oceanLip.vertex.fx`) places it from
 * the slot's crest (the tracker's state, `oceanBreaker.ts`), the baked
 * profile and the sea's own surface there. The strip draws with a material
 * of its own made as the sea's is (`mat_water_lip`), its water plugin made
 * with `lip`, so its lighting, refraction, foam and depth test are the sea's,
 * and it follows the sea's plugin every frame: the same binding, bed, frame
 * copy, clock and wind. Renderer-only.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { LIP_COLUMNS, LIP_KEYFRAMES, LIP_PROFILE_VERTS, LIP_SLOTS, type LipTracker } from "./oceanBreaker.js";
import { LIP_COARSE_M, LIP_FINE_M, closeFreeSlots, lipNear, lipReach, lipStripGeometry } from "./lipStrip.js";
import type { SwashCove } from "./swashTable.js";
import { WaterPlugin } from "./waterPlugin.js";
import { WATER_GROUP } from "./waterFrame.js";
import { budgetMaterial } from "./headlamp.js";

// The strips' vertices, their reach and the state they read are kept with no engine (`lipStrip.ts`), and handed on under their names.
export { LIP_COARSE_M, LIP_FINE_M, lipColumns, lipStripGeometry } from "./lipStrip.js";

export type OceanLip = {
  readonly fine: Mesh;
  readonly coarse: Mesh;
  /** The tracker's state, LIP_COLUMNS × LIP_SLOTS RGBA32F, uploaded every update with its free slots closed on the live crests near them. */
  readonly state: RawTexture;
  /** The baked profile, LIP_PROFILE_VERTS × LIP_KEYFRAMES RGBA32F. */
  readonly profile: RawTexture;
  /** Per frame, after the tracker's update: uploads its state, follows the sea's plugin, and draws the fine
   * strip near the camera, the coarse one beyond, neither when no slot holds a crest in mid-plunge. */
  update(camX: number, camZ: number): void;
  dispose(): void;
};

/** The water plugin a sea's material carries. */
function waterOf(material: PBRMaterial): WaterPlugin {
  const plugin = material.pluginManager?.getPlugin("Water");
  if (!(plugin instanceof WaterPlugin)) throw new Error(`${material.name} carries no water plugin`);
  return plugin;
}

/** The lip's plugin and material take what the sea's have this frame. */
function followSea(lip: WaterPlugin, lipMaterial: PBRMaterial, sea: WaterPlugin, seaMaterial: PBRMaterial): void {
  lip.ocean = sea.ocean;
  lip.bedTexture = sea.bedTexture;
  lip.bedOrigin = sea.bedOrigin;
  lip.bedTexels = sea.bedTexels;
  lip.bedSpacing = sea.bedSpacing;
  lip.sceneTexture = sea.sceneTexture;
  lip.depthTexture = sea.depthTexture;
  lip.screen = sea.screen;
  lip.nearFar = sea.nearFar;
  lip.time = sea.time;
  lip.windDir = sea.windDir;
  lip.windSpeed = sea.windSpeed;
  lip.windTime = sea.windTime;
  lip.octaves = sea.octaves;
  lip.skin = sea.skin;
  lip.rain = sea.rain;
  // The roughness's setter marks every submesh dirty: only a change is written.
  if (seaMaterial.roughness !== null && lipMaterial.roughness !== seaMaterial.roughness) lipMaterial.roughness = seaMaterial.roughness;
}

/**
 * The strip over the cove's face, on `mat_water_lip`, made as the sea's
 * material (`seaMaterialOf()`, `mat_water_sea`) is: its row, its
 * transparency, its group (WATER_GROUP when opaque, the high tier's path,
 * else 0), and the sea's binding and textures followed each update. The
 * meshes carry the attributes the sea's material asks for (`bedDepth`,
 * `oceanMorph`, `oceanCoarse`, zeros: the strip has no stitch and its depth
 * comes from the bed texture), the level in their metadata as the rings do,
 * and a bounding box over the face that holds every place a vertex can take:
 * their positions are not places. Neither receives shadows nor is picked;
 * the caller registers them with the rain map as it does the rings.
 */
export function createOceanLip(
  scene: Scene, seaMaterialOf: () => PBRMaterial, tracker: LipTracker, profile: Float32Array, cove: SwashCove, level: number,
): OceanLip {
  const seaMaterial = seaMaterialOf();
  const sea = waterOf(seaMaterial);
  const material = new PBRMaterial("mat_water_lip", scene);
  const plugin = new WaterPlugin(material, sea.row, { lip: true });
  material.backFaceCulling = false;
  material.transparencyMode = seaMaterial.transparencyMode;
  material.needDepthPrePass = false;
  budgetMaterial(material);
  // What the state texture is uploaded from (closeFreeSlots), made once.
  const upload = new Float32Array(tracker.state.data.length);
  closeFreeSlots(tracker.state.data, upload);
  const state = new RawTexture(
    upload, LIP_COLUMNS, LIP_SLOTS, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
  const shape = new RawTexture(
    profile, LIP_PROFILE_VERTS, LIP_KEYFRAMES, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
  for (const texture of [state, shape]) {
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  }
  state.name = "oceanLipState";
  shape.name = "oceanLipProfile";
  plugin.setLip(state, shape);
  plugin.setCove(cove.z0, cove.halfWidth, cove.toeD, cove.faceGrade);
  followSea(plugin, material, sea, seaMaterial);
  const group = seaMaterial.transparencyMode === PBRMaterial.PBRMATERIAL_OPAQUE ? WATER_GROUP : 0;

  // Every place a vertex can take (`lipReach`): the face from the toe to the
  // waterline, the section's reach about its crest and the sea's own movement each way.
  const reach = lipReach(cove, level);
  const bounds = new BoundingInfo(Vector3.FromArray(reach.min), Vector3.FromArray(reach.max));

  const strip = (name: string, step: number): Mesh => {
    const mesh = new Mesh(name, scene);
    const geometry = lipStripGeometry(cove, step);
    const vertices = geometry.positions.length / 3;
    const data = new VertexData();
    data.positions = geometry.positions;
    data.indices = geometry.indices;
    data.normals = new Float32Array(vertices * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));
    data.applyToMesh(mesh, false);
    mesh.setVerticesData("bedDepth", new Float32Array(vertices), false, 1);
    mesh.setVerticesData("oceanMorph", new Float32Array(vertices), false, 1);
    mesh.setVerticesData("oceanCoarse", new Float32Array(vertices * 2), false, 2);
    mesh.material = material;
    mesh.metadata = { waterLevel: level };
    mesh.renderingGroupId = group;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_STANDARD;
    // Never refreshBoundingInfo after this: the positions are not places.
    mesh.setBoundingInfo(bounds);
    mesh.setEnabled(false);
    return mesh;
  };
  const fine = strip("water_lip_fine", LIP_FINE_M);
  const coarse = strip("water_lip_coarse", LIP_COARSE_M);

  return {
    fine,
    coarse,
    state,
    profile: shape,
    update(camX, camZ) {
      const seaNow = seaMaterialOf();
      followSea(plugin, material, waterOf(seaNow), seaNow);
      const live = closeFreeSlots(tracker.state.data, upload);
      state.update(upload);
      // The camera's distance to the face's middle at its nearest column.
      const near = lipNear(reach, camX, camZ);
      fine.setEnabled(live && near);
      coarse.setEnabled(live && !near);
    },
    dispose() {
      fine.dispose();
      coarse.dispose();
      state.dispose();
      shape.dispose();
      material.dispose();
    },
  };
}
