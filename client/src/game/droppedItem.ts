/**
 * The dropped cap (docs/gameplay/2026-10-07-the-inner-voice.md): the missing
 * hiker's cap, lying beside the trail a fifth of the way up, the one thing
 * of theirs the ranger finds before the crest. A small shape built here, a
 * crown and a brim, in a red nothing else on the ground wears, seated on the
 * terrain a stride off the path on the side the seed draws. The inner voice
 * speaks when the player comes within CAP_NEAR_M of it.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { TrailGraph } from "../sim/trail.js";
import { stemPointAt } from "../sim/trailRoute.js";
import { hash2 } from "../sim/field.js";

/** How far up the stem the cap lies (0 the pad, 1 the crest), how far off the path, and how near the player must come to it. */
export const CAP_PROGRESS = 0.2;
export const CAP_SIDE_M = 1.6;
export const CAP_NEAR_M = 3.5;
/** The cap's size, metres, and its colour. */
export const CAP_RADIUS = 0.11;
export const CAP_COLOUR = { r: 0.55, g: 0.06, b: 0.05 };

export type DroppedCap = { x: number; z: number; yaw: number };

/** Where the cap lies for a trail and a seed: beside the stem at CAP_PROGRESS, on the seed's side, or null without a stem. */
export function droppedCapAt(graph: TrailGraph, seed: number): DroppedCap | null {
  const at = stemPointAt(graph, CAP_PROGRESS);
  if (at === null) return null;
  const side = hash2(7, 11, seed) < 0.5 ? 1 : -1;
  // Perpendicular to the stem's direction: a stride off the path.
  return { x: at.x - at.dz * CAP_SIDE_M * side, z: at.z + at.dx * CAP_SIDE_M * side, yaw: hash2(13, 17, seed) * 6.2832 };
}

export type DroppedCapView = { node: TransformNode; dispose(): void };

/** The cap's meshes at `cap`, seated on the ground at `groundY`, tipped a little as a dropped thing lies. */
export function createDroppedCap(scene: Scene, cap: DroppedCap, groundY: number): DroppedCapView {
  const node = new TransformNode("dropped_cap", scene);
  const mat = new PBRMaterial("mat_dropped_cap", scene);
  mat.albedoColor = new Color3(CAP_COLOUR.r, CAP_COLOUR.g, CAP_COLOUR.b);
  mat.metallic = 0;
  mat.roughness = 0.9;
  const crown = MeshBuilder.CreateSphere("dropped_cap_crown", { diameter: CAP_RADIUS * 2, segments: 10, slice: 0.5 }, scene);
  crown.material = mat;
  crown.parent = node;
  crown.scaling.y = 0.75;
  const brim = MeshBuilder.CreateCylinder("dropped_cap_brim", { diameter: CAP_RADIUS * 2.1, height: CAP_RADIUS * 0.12, tessellation: 16 }, scene);
  brim.material = mat;
  brim.parent = node;
  brim.position.set(0, 0, CAP_RADIUS * 0.55);
  brim.scaling.set(0.8, 1, 1.1);
  for (const m of [crown, brim]) {
    m.isPickable = false;
    m.receiveShadows = true;
  }
  node.position.set(cap.x, groundY + CAP_RADIUS * 0.12, cap.z);
  node.rotation.set(0.18, cap.yaw, 0.12);
  return {
    node,
    dispose() {
      for (const m of node.getChildMeshes(false)) (m as Mesh).dispose();
      mat.dispose();
      node.dispose();
    },
  };
}
