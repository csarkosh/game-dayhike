import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Scene } from "@babylonjs/core/scene.js";

import { BOARD_BOX_HALF, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes, type Board } from "../sim/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import { BOARD_FACE } from "./boardFace.js";
import { paintedBoard, type BoardDrawing, type BoardPainter } from "./boardPaint.js";
import { CAR_SHADOW_BIAS, CAR_SHADOW_TEX, carShadowAlphaMap, carShadowGrid } from "./carShadow.js";
import type { MeshRegistry, PropShadows } from "./propMeshes.js";
import { armYaw } from "./signMeshes.js";
import { defaultModelLoader, loaderUntilAborted, placeStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";

export const TRAILHEAD_CAR_OUTPUT = "models/trailhead.car.glb";
export const TRAILHEAD_KIOSK_OUTPUT = "models/trailhead.kiosk.glb";
/**
 * How far in front of the model's own face the painted plane stands. With
 * the view's near plane at 5 cm, a vertex lands in depth to within about
 * 0.7 mm for every metre between it and the eye, so a plane 1 mm in front
 * of another loses to it, in wedges across the face, from some places a
 * player stands. Measured from standpoints 1 to 18 m in front of the board:
 * at 1 mm and no bias the paint was lost from 16 of 75 under WebGPU and 1
 * of 78 under WebGL2; at 2 mm with the material's bias (`boardPaint.ts`),
 * from none under either. 2 mm holds the first metres and the bias the
 * rest.
 */
export const BOARD_FACE_LIFT = 0.002;

type Site = { x: number; z: number };

export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside;
   * absent, no car is placed: a staged scene brings its own and moves it. */
  car?: { site: Site; trailhead: Site };
  /** The board: its centre, the way its face looks, and its own line. */
  board: Board;
};

export type TrailheadDeps = {
  /** The box material by prop name — `terrainMaterialFor`, as the prop boxes use. */
  materialFor(name: string): Material;
  /** What the board's face carries. */
  board: BoardDrawing;
  paint?: BoardPainter;
  shadows?: PropShadows;
  /** The rain's cover map: the car and the kiosk are hard cover, box or model. */
  cover?: MeshRegistry;
  loader?: ModelLoader;
};

export type TrailheadMeshes = {
  /** Resolves once both models have settled, loaded or failed. */
  readonly ready: Promise<void>;
  dispose(): void;
};

/**
 * The car's yaw: 0 or PI only, so the model stays square to the box the sim
 * collides with. It stands at the pad's own place along the road on most
 * worlds, and there its nose points toward +z (yaw 0); where it has slid
 * along the road to clear the trail, its nose points back toward the pad.
 */
export function carYaw(site: Site, trailhead: Site): number {
  return trailhead.z >= site.z ? 0 : Math.PI;
}

/**
 * The trailhead's two models, placed once from the seed's places: the
 * ranger's SUV on the shoulder and the roofed board at the trail's
 * entrance, turned to face where a player arrives. Each stands on the
 * boxes the sim collides with and, until its model arrives (or for good, if
 * it never does), those boxes are drawn instead, exactly as the prop boxes
 * elsewhere are — so the trailhead never holds an invisible wall. The
 * board's face is a plane of the game's own, painted when the match starts
 * (`boardPaint.ts`) and placed by the face's size and place, which are the
 * model's to keep. Under the car, box or model, lies its soft dark patch
 * (`carShadow.ts`).
 */
/** The soft patch and its parts: what the caller disposes. */
export type CarShadowPatch = { mesh: Mesh; material: StandardMaterial | PBRMaterial; texture: RawTexture; dispose(): void };

/**
 * The patch under the car: black, unlit, laid over the ground by its
 * texture's alpha. It writes no depth, so it is in the way of nothing
 * drawn after it. Built as the mist's material is (`mistMeshes.ts`), so
 * the two are drawn by one shader; that material reads Babylon's own fog,
 * which is lighter than the atmosphere's in a mist, so far off the patch
 * stays dark on a fogged road. With `atmosphere` it is a PBR material
 * instead, which the atmosphere's fog reaches as it reaches the ground.
 * `darkness` scales its alpha.
 */
export function createCarShadowPatch(
  scene: Scene,
  site: { x: number; z: number },
  groundH: (x: number, z: number) => number,
  { moving = false, atmosphere = false, darkness = 1 }: { moving?: boolean; atmosphere?: boolean; darkness?: number } = {},
): CarShadowPatch {
  const texture = RawTexture.CreateRGBATexture(
    carShadowAlphaMap(), CAR_SHADOW_TEX.width, CAR_SHADOW_TEX.height, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
    Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  let material: StandardMaterial | PBRMaterial;
  if (atmosphere) {
    const pbr = new PBRMaterial("mat_car_shadow_fogged", scene);
    pbr.unlit = true;
    pbr.albedoColor = new Color3(0, 0, 0);
    pbr.opacityTexture = texture;
    pbr.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    material = pbr;
  } else {
    const plain = new StandardMaterial("mat_trailhead_car_shadow", scene);
    plain.disableLighting = true;
    plain.opacityTexture = texture;
    material = plain;
  }
  material.alpha = darkness;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.zOffsetUnits = CAR_SHADOW_BIAS;
  const grid = carShadowGrid(site, groundH);
  const mesh = new Mesh("trailhead_car_shadow", scene);
  const data = new VertexData();
  data.positions = grid.positions;
  data.normals = grid.normals;
  data.uvs = grid.uvs;
  data.indices = grid.indices;
  data.applyToMesh(mesh);
  mesh.position.set(grid.origin.x, grid.origin.y, grid.origin.z);
  mesh.scaling.set(grid.scale.x, grid.scale.y, grid.scale.z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  // A parked car's patch never moves; a moving car's rides it, a child of its root.
  if (!moving) mesh.freezeWorldMatrix();
  return {
    mesh,
    material,
    texture,
    dispose() {
      mesh.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export function createTrailheadMeshes(
  scene: Scene,
  sites: TrailheadSites,
  groundH: (x: number, z: number) => number,
  deps: TrailheadDeps,
): TrailheadMeshes {
  // Aborted first thing in `dispose`: a model in flight then ends at once and
  // quietly (`modelLoad.ts`).
  const loads = new AbortController();
  const load = loaderUntilAborted(deps.loader ?? defaultModelLoader(scene), loads.signal);
  const paint = deps.paint ?? paintedBoard;
  let disposed = false;
  const placed: PlacedModel[] = [];
  const painted: Material[] = [];

  function fallbackBox(name: string, material: string, site: Site, half: Vec3): Mesh {
    const ground = groundH(site.x, site.z);
    const mesh = MeshBuilder.CreateBox(name, { width: 2 * half.x, height: 2 * half.y, depth: 2 * half.z }, scene);
    mesh.position.set(site.x, ground + half.y, site.z);
    mesh.material = deps.materialFor(material);
    attachWet(mesh.material, WET_CAP.prop);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    deps.cover?.add(mesh);
    return mesh;
  }
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    deps.cover?.remove(box);
    box.dispose();
  }


  const car = sites.car ?? null;
  const carBox = car === null ? null : fallbackBox("trailhead_car_box", CAR_MATERIAL, car.site, CAR_HALF);
  const patch = car === null ? null : createCarShadowPatch(scene, car.site, groundH);
  const kioskBoxes = boardBoxes(sites.board).map((b, k) => fallbackBox(`trailhead_kiosk_box_${k}`, KIOSK_MATERIAL, b, BOARD_BOX_HALF));

  async function place(
    output: string, name: string, site: Site, yaw: number, boxes: readonly Mesh[],
    after?: (model: PlacedModel) => void,
  ): Promise<void> {
    let container: AssetContainer;
    try {
      container = await load(output);
    } catch {
      // A missing model costs the look, never the collider: the box stays.
      return;
    }
    // Disposed while the file was in flight: nothing will ever draw it.
    if (disposed) {
      container.dispose();
      return;
    }
    let model: PlacedModel;
    try {
      model = placeStaticModel(container, name, site.x, groundH(site.x, site.z), site.z, yaw);
    } catch {
      container.dispose();
      return;
    }
    for (const m of model.meshes) {
      deps.shadows?.add(m);
      deps.cover?.add(m);
      // The weather soaks the car and the kiosk as it does every prop.
      if (m.material) attachWet(m.material, WET_CAP.prop);
    }
    placed.push(model);
    for (const box of boxes) dropBox(box);
    try {
      after?.(model);
    } catch {
      // A face that cannot be painted costs the look, never the board.
    }
  }

  let face: Mesh | null = null;
  /**
   * The face's own plane: 2 m by 1 m, 2 mm in front of the model's
   * planks, in the board's own space so it turns with the board. A plane
   * looks toward -Z as it is made; half a turn points it out of the face,
   * and leaves the texture's left at the player's left.
   */
  function faceOn(model: PlacedModel): void {
    const material = paint(scene, "trailhead_board_face", deps.board);
    painted.push(material);
    const plane = MeshBuilder.CreatePlane("trailhead_board_face", { width: BOARD_FACE.width, height: BOARD_FACE.height }, scene);
    plane.parent = model.node;
    plane.position.set(0, BOARD_FACE.centreY, BOARD_FACE.front + BOARD_FACE_LIFT);
    plane.rotation.y = Math.PI;
    plane.material = material;
    plane.isPickable = false;
    // It takes the shadows the board does, but casts none of its own.
    plane.receiveShadows = true;
    face = plane;
  }

  const ready = Promise.all([
    car === null || carBox === null ? Promise.resolve() : place(TRAILHEAD_CAR_OUTPUT, "trailhead_car", car.site, carYaw(car.site, car.trailhead), [carBox]),
    place(
      TRAILHEAD_KIOSK_OUTPUT, "trailhead_kiosk", sites.board,
      // The model's face looks toward +Z; turn +Z onto the board's facing.
      armYaw({ dx: sites.board.fx, dz: sites.board.fz }), kioskBoxes, faceOn,
    ),
  ]).then(() => undefined);

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      if (carBox !== null) dropBox(carBox);
      if (patch !== null) {
        patch.mesh.dispose();
        patch.material.dispose();
        patch.texture.dispose();
      }
      for (const box of kioskBoxes) dropBox(box);
      face?.dispose();
      face = null;
      for (const model of placed) {
        for (const m of model.meshes) {
          deps.shadows?.remove(m);
          deps.cover?.remove(m);
        }
        model.dispose();
      }
      placed.length = 0;
      for (const m of painted) m.dispose(true, true);
      painted.length = 0;
    },
  };
}
