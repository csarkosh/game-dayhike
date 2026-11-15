/**
 * The dropped cap on Babylon Lite: the missing hiker's cap beside the trail
 * (`droppedCap.ts` says where it lies, how it is seated and its shape).
 *
 * One mesh and one draw, the crown and the brim together, where the game on
 * Babylon.js builds two meshes of one material: the shape is the same
 * vertices, each already where its own mesh's transform would put it in the
 * cap's frame, and the mesh stands at the cap's seat. Its material is the
 * game's: the cap's red, matt, lit as every surface is and under the air.
 * The cap does not move: nothing is written for it after it is made. And it
 * is small and lies in one place: it is drawn only while the view's planes
 * hold it (`seen`), so a frame that does not look at it has no draw for it.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setMeshVisible,
  type EngineContext, type MaterialPlugin, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import { CAP_COLOUR, CAP_RADIUS, CAP_ROUGHNESS, capGeometry, capSeat, type DroppedCap } from "../droppedCap.js";
import type { ViewFrustumPlane } from "./cameraPose.js";
import { quatFromEuler } from "../instancePose.js";
import { DRAW_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";

/** The sphere (m) about its seat the cap is taken to fill for the view's planes: its brim reaches a radius and a half. */
export const CAP_SPHERE_M = CAP_RADIUS * 3;

/** Whether a sphere of `radius` about (x, y, z) touches the inside of every plane. */
export function sphereInView(planes: readonly ViewFrustumPlane[], x: number, y: number, z: number, radius: number): boolean {
  for (const plane of planes) {
    if (plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.d <= -radius) return false;
  }
  return true;
}

export type CapMesh = {
  readonly mesh: Mesh;
  /** Shows the cap while the view's planes hold it, and hides it while they do not. */
  seen(planes: readonly ViewFrustumPlane[]): void;
  dispose(): void;
};

/** The cap's mesh at `cap`, seated on ground at `groundY`. `air` is the air's plugin, one a material. */
export function createCapMesh(engine: EngineContext, scene: SceneContext, cap: DroppedCap, groundY: number, air: () => MaterialPlugin, uploads?: FrameUploads): CapMesh {
  const shape = capGeometry();
  const mesh = createMeshFromData(engine, "dropped_cap", shape.positions, shape.normals, shape.indices);
  uploads?.count("geometry", shape.positions.byteLength + shape.normals.byteLength + shape.indices.byteLength, 3);
  uploads?.made();
  const material = createPbrMaterial({
    baseColorFactor: [CAP_COLOUR.r, CAP_COLOUR.g, CAP_COLOUR.b, 1], metallicFactor: 0, roughnessFactor: CAP_ROUGHNESS, usePhysicalLightFalloff: true,
  });
  material.plugins = [air()];
  mesh.material = material;
  mesh.renderOrder = DRAW_ORDER.cap;
  const seat = capSeat(cap, groundY);
  mesh.position.x = seat.position.x;
  mesh.position.y = seat.position.y;
  mesh.position.z = seat.position.z;
  const turn = quatFromEuler(seat.rotation.x, seat.rotation.y, seat.rotation.z, { x: 0, y: 0, z: 0, w: 1 });
  mesh.rotationQuaternion.x = turn.x;
  mesh.rotationQuaternion.y = turn.y;
  mesh.rotationQuaternion.z = turn.z;
  mesh.rotationQuaternion.w = turn.w;
  // Hidden until a view holds it.
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  let disposed = false;
  let shown = false;
  return {
    mesh,
    seen(planes) {
      if (disposed) return;
      const now = sphereInView(planes, seat.position.x, seat.position.y, seat.position.z, CAP_SPHERE_M);
      if (now === shown) return;
      shown = now;
      setMeshVisible(mesh, now);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      uploads?.dropped();
    },
  };
}
