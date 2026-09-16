import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { SignPost } from "../sim/signs.js";
import { SIGN_POST_HALF } from "../sim/signs.js";

/** The trailhead board: the sign beside the car, with the book painted on the face toward the pad. */
export type SignBoard = { x: number; z: number; facing: { dx: number; dz: number }; lines: string[] };

export type SignMeshes = { dispose(): void };
/** Makes the painted material for one arm or the board: `paintedMaterial`, or a stand-in where there is no canvas. */
export type Painter = (scene: Scene, name: string, lines: readonly string[], width: number, height: number) => Material;

/** The yaw that turns +z onto a unit direction, in the sim's convention (yaw 0 faces +z, PI/2 faces +x). */
export function armYaw(dir: { dx: number; dz: number }): number {
  return Math.atan2(dir.dx, dir.dz);
}

const ARM_LENGTH = 0.9;
const ARM_HEIGHT = 0.16;
const ARM_ABOVE_GROUND = 1.8;
const WOOD = "#6b4f2a";
const PAINT = "#f2ead8";

/**
 * Painted wood: the words are drawn into a texture on the arm rather than
 * floated in the air, so they are read the way a sign is — by walking up to
 * it with a lamp. One texture per arm and one for the board; a handful per
 * world, never rebuilt.
 */
export function paintedMaterial(scene: Scene, name: string, lines: readonly string[], width: number, height: number): PBRMaterial {
  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = WOOD;
  ctx.fillRect(0, 0, width, height);
  // The largest size at which every line fits the width (monospace runs about
  // 0.62 em per glyph) and all the lines fit the height.
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const size = Math.round(Math.min(height * 0.45, (height / (lines.length + 1)) * 0.8, (width * 0.92) / (longest * 0.62)));
  ctx.font = `bold ${size}px ui-monospace, monospace`;
  ctx.fillStyle = PAINT;
  for (const [i, line] of lines.entries()) {
    ctx.fillText(line, size * 0.5, size * 1.2 + i * size * 1.3);
  }
  texture.update(true);
  const material = new PBRMaterial(`${name}_mat`, scene);
  material.albedoTexture = texture;
  material.metallic = 0;
  material.roughness = 0.9;
  return material;
}

export function createSignMeshes(
  scene: Scene,
  posts: readonly SignPost[],
  board: SignBoard,
  groundH: (x: number, z: number) => number,
  paint: Painter = paintedMaterial,
): SignMeshes {
  const meshes: Mesh[] = [];
  for (const [p, post] of posts.entries()) {
    const base = groundH(post.x, post.z);
    for (const [a, arm] of post.arms.entries()) {
      const mesh = MeshBuilder.CreateBox(`sign_${p}_arm_${a}`, { width: 0.05, height: ARM_HEIGHT, depth: ARM_LENGTH }, scene);
      // The arm's near end at the post's face, its length along the direction it names.
      const along = SIGN_POST_HALF.x + ARM_LENGTH / 2;
      mesh.position.set(post.x + arm.dx * along, base + ARM_ABOVE_GROUND, post.z + arm.dz * along);
      mesh.rotation.y = armYaw(arm);
      mesh.material = paint(scene, `sign_${p}_arm_${a}_tex`, [arm.names.join(" · ")], 512, 96);
      mesh.isPickable = false;
      meshes.push(mesh);
    }
  }
  // The board: a plane a hair off the sign's face, the book painted on it.
  const boardMesh = MeshBuilder.CreatePlane("sign_board", { width: 1.15, height: 1.9 }, scene);
  boardMesh.position.set(board.x + board.facing.dx * 0.11, groundH(board.x, board.z) + 1.0, board.z + board.facing.dz * 0.11);
  // A plane faces -z by default; turn it to face along `facing`.
  boardMesh.rotation.y = armYaw(board.facing) + Math.PI;
  boardMesh.material = paint(scene, "sign_board_tex", board.lines, 1024, 1700);
  boardMesh.isPickable = false;
  meshes.push(boardMesh);
  return {
    dispose() {
      for (const m of meshes) {
        m.material?.dispose(true, true);
        m.dispose();
      }
      meshes.length = 0;
    },
  };
}
