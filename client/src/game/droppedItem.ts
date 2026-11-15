/**
 * The dropped cap's meshes on Babylon.js: a crown and a brim built here at
 * the place, the size, the colour and the tip `droppedCap.ts` gives, which
 * is where the cap is worked out with no engine.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CAP_BRIM, CAP_COLOUR, CAP_CROWN, CAP_ROUGHNESS, capSeat, type DroppedCap } from "./droppedCap.js";

export { CAP_COLOUR, CAP_NEAR_M, CAP_PROGRESS, CAP_RADIUS, CAP_SIDE_M, droppedCapAt, type DroppedCap } from "./droppedCap.js";

export type DroppedCapView = { node: TransformNode; dispose(): void };

/** The cap's meshes at `cap`, seated on the ground at `groundY`, tipped a little as a dropped thing lies. */
export function createDroppedCap(scene: Scene, cap: DroppedCap, groundY: number): DroppedCapView {
  const node = new TransformNode("dropped_cap", scene);
  const mat = new PBRMaterial("mat_dropped_cap", scene);
  mat.albedoColor = new Color3(CAP_COLOUR.r, CAP_COLOUR.g, CAP_COLOUR.b);
  mat.metallic = 0;
  mat.roughness = CAP_ROUGHNESS;
  const crown = MeshBuilder.CreateSphere("dropped_cap_crown", { diameter: CAP_CROWN.diameter, segments: CAP_CROWN.segments, slice: CAP_CROWN.slice }, scene);
  crown.material = mat;
  crown.parent = node;
  crown.scaling.y = CAP_CROWN.scaleY;
  const brim = MeshBuilder.CreateCylinder("dropped_cap_brim", { diameter: CAP_BRIM.diameter, height: CAP_BRIM.height, tessellation: CAP_BRIM.tessellation }, scene);
  brim.material = mat;
  brim.parent = node;
  brim.position.set(CAP_BRIM.position.x, CAP_BRIM.position.y, CAP_BRIM.position.z);
  brim.scaling.set(CAP_BRIM.scaling.x, CAP_BRIM.scaling.y, CAP_BRIM.scaling.z);
  for (const m of [crown, brim]) {
    m.isPickable = false;
    m.receiveShadows = true;
  }
  const seat = capSeat(cap, groundY);
  node.position.set(seat.position.x, seat.position.y, seat.position.z);
  node.rotation.set(seat.rotation.x, seat.rotation.y, seat.rotation.z);
  return {
    node,
    dispose() {
      for (const m of node.getChildMeshes(false)) (m as Mesh).dispose();
      mat.dispose();
      node.dispose();
    },
  };
}
