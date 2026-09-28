import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";

import { BOARD_BOX_HALF, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes, type Board } from "../sim/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import { BOARD_FACE } from "./boardFace.js";
import { paintedBoard, type BoardDrawing, type BoardPainter } from "./boardPaint.js";
import type { PropShadows } from "./propMeshes.js";
import { armYaw } from "./signMeshes.js";
import { defaultModelLoader, loaderUntilAborted, placeStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";

export const TRAILHEAD_CAR_OUTPUT = "models/trailhead.car.glb";
export const TRAILHEAD_KIOSK_OUTPUT = "models/trailhead.kiosk.glb";
/** How far in front of the model's own face the painted plane stands. */
export const BOARD_FACE_LIFT = 0.001;

type Site = { x: number; z: number };

export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside. */
  car: { site: Site; trailhead: Site };
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
 * model's to keep.
 */
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
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    return mesh;
  }
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    box.dispose();
  }

  const carBox = fallbackBox("trailhead_car_box", CAR_MATERIAL, sites.car.site, CAR_HALF);
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
    for (const m of model.meshes) deps.shadows?.add(m);
    placed.push(model);
    for (const box of boxes) dropBox(box);
    after?.(model);
  }

  let face: Mesh | null = null;
  /**
   * The face's own plane: 2 m by 1 m, a millimetre in front of the model's
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
    place(TRAILHEAD_CAR_OUTPUT, "trailhead_car", sites.car.site, carYaw(sites.car.site, sites.car.trailhead), [carBox]),
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
      dropBox(carBox);
      for (const box of kioskBoxes) dropBox(box);
      face?.dispose();
      face = null;
      for (const model of placed) {
        for (const m of model.meshes) deps.shadows?.remove(m);
        model.dispose();
      }
      placed.length = 0;
      for (const m of painted) m.dispose(true, true);
      painted.length = 0;
    },
  };
}
