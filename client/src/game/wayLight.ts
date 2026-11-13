/**
 * The way down's light (docs/gameplay/2026-11-13-the-way-down.md): the half
 * pipe a player in the chase runs inside, drawn as geometry (a floor's strip
 * and two walls, wayLightGeometry.ts) with one additive material of its own,
 * so no other material's shader knows of it. One mesh a WAY_CHUNK_M of way,
 * built a chunk a slice through the renderer's jobs; the renderer sets the
 * way when the app has it and gives the light its level each frame.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector.js";
import type { Slices, SyncJobs } from "./syncJobs.js";
import {
  WAY_FLOOR_REACH, WAY_FLOOR_STRENGTH, WAY_TINT, WAY_WALL_REACH, WAY_WALL_STRENGTH, wayChunk, wayChunks, type WayShape,
} from "./wayLightGeometry.js";
import wayLightVertex from "./shaders/wayLight.vertex.fx?raw";
import wayLightFragment from "./shaders/wayLight.fragment.fx?raw";

export const WAY_LIGHT_NAME = "wayLight";
export const WAY_LIGHT_UNIFORMS = ["viewProjection", "wayEye", "wayGain", "wayShape", "wayTint"] as const;
/**
 * The light's gain on the material colour path (no post chain: the low
 * tier). There the frame is already toned and encoded as each material is
 * drawn, so the light is added in the frame's own terms, and the strengths,
 * which are the post path's linear ones, are scaled to read the same at
 * night; the frame's dim never reaches it.
 */
export const WAY_MATERIAL_GAIN = 1.7;
/** Frames a new mesh is drawn at nothing, whatever the level, so its pipeline is made before the chase shows it. */
export const WAY_WARM_FRAMES = 3;
/** How far toward the eye the light's depth is pulled, so its floor never fights the ground it lies on. */
const WAY_Z_OFFSET = -2;

export type WayLight = {
  /**
   * The way to light, or none: its meshes are built a chunk a slice, the
   * old way's gone at once. Every vertex stands on `heightAt`: the ground
   * the players stand on (the sim's field, the walkable rock's rise with
   * it), since over rock the bare elevation lies up to a metre under what
   * is drawn and a floor laid on it would be hidden.
   */
  setWay(way: WayShape | null, heightAt: (x: number, z: number) => number): void;
  /**
   * A frame: the eye, the light's `level` (0 none, 1 whole), and `undim`,
   * one over what the frame outside the light is dimmed by, which the post
   * path's light is multiplied by so the dim does not reach it.
   */
  update(eye: Vector3, level: number, undim: number): void;
  /** Whether the whole way's meshes are built. */
  readonly ready: boolean;
  dispose(): void;
};

/** The way's light in `scene`, toned for `colourPath`, built through `jobs`. */
export function createWayLight(scene: Scene, colourPath: "post" | "material", jobs: SyncJobs): WayLight {
  Effect.ShadersStore[`${WAY_LIGHT_NAME}VertexShader`] = wayLightVertex;
  Effect.ShadersStore[`${WAY_LIGHT_NAME}FragmentShader`] = wayLightFragment;
  const material = new ShaderMaterial(WAY_LIGHT_NAME, scene, WAY_LIGHT_NAME, {
    attributes: ["position", "wayLight"],
    uniforms: [...WAY_LIGHT_UNIFORMS],
    needAlphaBlending: true,
  });
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true;
  // A wall is seen from inside the channel and from outside it.
  material.backFaceCulling = false;
  material.zOffset = WAY_Z_OFFSET;
  const eyeAt = new Vector3();
  material.setVector3("wayEye", eyeAt);
  material.setFloat("wayGain", 0);
  material.setVector4("wayShape", new Vector4(WAY_FLOOR_STRENGTH, WAY_WALL_STRENGTH, WAY_FLOOR_REACH, WAY_WALL_REACH));
  material.setVector3("wayTint", new Vector3(WAY_TINT[0], WAY_TINT[1], WAY_TINT[2]));

  const owner = {};
  /** The meshes built, and the frames each has still to be drawn at nothing. */
  let meshes: { mesh: Mesh; warm: number }[] = [];
  let ready = false;

  function clear(): void {
    jobs.cancel(owner);
    for (const m of meshes) m.mesh.dispose();
    meshes = [];
    ready = false;
  }

  function* build(way: WayShape, heightAt: (x: number, z: number) => number): Slices {
    const chunks = wayChunks(way);
    for (let i = 0; i < chunks.length; i++) {
      const [from, to] = chunks[i] as [number, number];
      const data = wayChunk(way, heightAt, from, to);
      const mesh = new Mesh(`${WAY_LIGHT_NAME}_${i}`, scene);
      mesh.setVerticesData(VertexBuffer.PositionKind, data.positions, false);
      mesh.setVerticesData("wayLight", data.light, false, 2);
      mesh.setIndices(data.indices);
      mesh.material = material;
      mesh.isPickable = false;
      meshes.push({ mesh, warm: WAY_WARM_FRAMES });
      if (i + 1 < chunks.length) yield;
    }
    ready = true;
  }

  return {
    setWay(way, heightAt) {
      clear();
      if (way !== null && way.xs.length > 1) jobs.begin(owner, build(way, heightAt), true, WAY_LIGHT_NAME);
    },
    update(eye, level, undim) {
      eyeAt.copyFrom(eye);
      material.setVector3("wayEye", eyeAt);
      let warming = false;
      for (const m of meshes) {
        if (m.warm > 0) {
          m.warm--;
          warming = true;
          m.mesh.setEnabled(true);
          // Drawn wherever the eye looks, for these frames alone: the pipeline is what they are for.
          m.mesh.alwaysSelectAsActiveMesh = true;
        } else {
          m.mesh.alwaysSelectAsActiveMesh = false;
          m.mesh.setEnabled(level > 0);
        }
      }
      // While any mesh warms the light is nothing: a frame of the way's light ahead of the chase would show.
      material.setFloat("wayGain", warming ? 0 : level * (colourPath === "post" ? undim : WAY_MATERIAL_GAIN));
    },
    get ready() {
      return ready;
    },
    dispose() {
      clear();
      material.dispose();
    },
  };
}
