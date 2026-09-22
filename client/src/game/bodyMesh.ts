import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";

import type { Vec3 } from "../sim/types.js";

const WOOD = new Color3(0.16, 0.11, 0.07);
const FIGURE = new Color3(0.72, 0.66, 0.6);

const UPRIGHT_SIZE = { width: 0.25, height: 3.2, depth: 0.25 };
const UPRIGHT_UP = 1.6;
const CROSSBAR_SIZE = { width: 2.0, height: 0.25, depth: 0.25 };
const CROSSBAR_UP = 2.4;
const CAPSULE_HEIGHT = 1.7;
const CAPSULE_RADIUS = 0.25;
const CAPSULE_UP = 1.75;
/** Hung this far in front of the upright, along the node's local +z. */
const CAPSULE_FORWARD = 0.15;

let instanceCount = 0;

/**
 * The body found at the crest: a placeholder cross of dark timber holding a
 * pale figure, standing where `body.pos` says and facing `body.yaw` — the
 * same facing convention as a player's. `StandardMaterial`, with fog left
 * ON: unlike the Hollow, the body is not a silhouette and should fade into
 * the mist like everything else (a PBR material with `fogEnabled = false`
 * never compiles under the atmosphere plugin — see `entityViews.ts`).
 */
export function createBodyMesh(scene: Scene, body: { pos: Vec3; yaw: number }): { node: TransformNode; dispose(): void } {
  const id = instanceCount++;
  const node = new TransformNode(`body_${id}`, scene);
  node.position.set(body.pos.x, body.pos.y, body.pos.z);
  node.rotation.y = body.yaw;

  const woodMaterial = new StandardMaterial(`body_${id}_wood`, scene);
  woodMaterial.diffuseColor = WOOD;
  woodMaterial.fogEnabled = true;

  const figureMaterial = new StandardMaterial(`body_${id}_figure`, scene);
  figureMaterial.diffuseColor = FIGURE;
  figureMaterial.fogEnabled = true;

  const upright = MeshBuilder.CreateBox(`body_${id}_upright`, UPRIGHT_SIZE, scene);
  upright.position.set(0, UPRIGHT_UP, 0);
  upright.material = woodMaterial;
  upright.parent = node;

  const crossbar = MeshBuilder.CreateBox(`body_${id}_crossbar`, CROSSBAR_SIZE, scene);
  crossbar.position.set(0, CROSSBAR_UP, 0);
  crossbar.material = woodMaterial;
  crossbar.parent = node;

  const figure = MeshBuilder.CreateCapsule(
    `body_${id}_figure`,
    { height: CAPSULE_HEIGHT, radius: CAPSULE_RADIUS },
    scene,
  );
  figure.position.set(0, CAPSULE_UP, CAPSULE_FORWARD);
  figure.material = figureMaterial;
  figure.parent = node;

  return {
    node,
    dispose() {
      node.dispose();
      woodMaterial.dispose();
      figureMaterial.dispose();
    },
  };
}
