/**
 * The way down's mist (docs/gameplay/2026-11-13-the-way-down.md): the channel
 * of pale ground mist a player in the chase runs down, drawn as geometry
 * (sheets over the ground, veils along the way and fins across it,
 * wayLightGeometry.ts) with one material of its own, so no other material's
 * shader knows of it. One mesh a WAY_CHUNK_M of way, built a few of the
 * ground's heights a slice through the renderer's jobs; the renderer sets
 * the way when the app has it and gives the mist its level, the ground
 * mist's colour and the frame's seconds each frame.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector.js";
import type { Rgb } from "./colour.js";
import { CLOUD_NOISE_SIZE, cloudNoiseMap } from "./cloudParams.js";
import type { Slices, SyncJobs } from "./syncJobs.js";
import {
  WAY_CURL, WAY_DENSITY_FLOOR, WAY_FIN_SHARE, WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_HEAVE, WAY_HIDE_SHARE, WAY_LIGHT_FLOATS, WAY_MATERIAL_LIFT, WAY_MIST_REACH,
  WAY_NEAR_DAMP, WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_POINT_VERTICES, WAY_POST_LIFT, WAY_SHEET_STRENGTH, WAY_STRATA_M, WAY_VEIL_STRENGTH,
  wayChunk, wayChunks, wayDrift, wayGroundOf, wayHeavePhases, wayMistColour, type WayShape,
} from "./wayLightGeometry.js";
import wayLightVertex from "./shaders/wayLight.vertex.fx?raw";
import wayLightFragment from "./shaders/wayLight.fragment.fx?raw";

export const WAY_LIGHT_NAME = "wayLight";
export const WAY_LIGHT_UNIFORMS = ["viewProjection", "wayDrift", "wayEye", "wayGain", "wayGround", "wayMist", "wayMove", "wayPath", "wayStrata", "wayTint"] as const;
export const WAY_LIGHT_SAMPLERS = ["wayNoise"] as const;
/** Heights of the ground the build asks for in one slice of a frame's share. */
export const WAY_HEIGHTS_A_SLICE = 24;
/** Frames a new mesh is drawn at nothing, whatever the level, so its pipeline is made before the chase shows it. */
export const WAY_WARM_FRAMES = 3;
/** How far toward the eye the mist's depth is pulled, so its lowest sheet never fights the ground it lies on. */
const WAY_Z_OFFSET = -2;

export type WayLight = {
  /**
   * The way to draw the mist down, or none: its meshes are built a chunk a
   * slice, the old way's gone at once. Every vertex stands on `heightAt`: the
   * ground the players stand on (the sim's field, the walkable rock's rise
   * with it), since over rock the bare elevation lies up to a metre under
   * what is drawn and a sheet laid on it would be hidden.
   */
  setWay(way: WayShape | null, heightAt: (x: number, z: number) => number): void;
  /**
   * A frame: the eye; the mist's `level` (0 none, 1 whole); `undim`, one
   * over what the frame outside the mist is dimmed by, which the post
   * path's colour is multiplied by so the dim does not reach it; `mist`, the
   * ground mist's colour this frame (cloudParams.ts cloudColourUnder), which
   * the way's mist is a brighter, colder shade of; and the frame's
   * `seconds` (the ground mist's own clock), which its shapes drift and its banks heave by.
   */
  update(eye: Vector3, level: number, undim: number, mist: Rgb, seconds: number): void;
  /** Whether the whole way's meshes are built. */
  readonly ready: boolean;
  dispose(): void;
};

/** The way's mist in `scene`, toned for `colourPath`, built through `jobs`. */
export function createWayLight(scene: Scene, colourPath: "post" | "material", jobs: SyncJobs): WayLight {
  Effect.ShadersStore[`${WAY_LIGHT_NAME}VertexShader`] = wayLightVertex;
  Effect.ShadersStore[`${WAY_LIGHT_NAME}FragmentShader`] = wayLightFragment;
  const material = new ShaderMaterial(WAY_LIGHT_NAME, scene, WAY_LIGHT_NAME, {
    attributes: ["position", "wayLight"],
    uniforms: [...WAY_LIGHT_UNIFORMS],
    samplers: [...WAY_LIGHT_SAMPLERS],
    needAlphaBlending: true,
  });
  // Premultiplied: the shader gives the colour the mist adds and, apart from it, the share of what is behind that it hides.
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.disableDepthWrite = true;
  // A sheet is seen from over it and from under it, a veil from inside the channel and from outside it.
  material.backFaceCulling = false;
  material.zOffset = WAY_Z_OFFSET;
  const eyeAt = new Vector3();
  const tint = new Vector3();
  const drift = new Vector4();
  const move = new Vector4(WAY_HEAVE, WAY_CURL, 0, 0);
  material.setVector3("wayEye", eyeAt);
  material.setVector3("wayTint", tint);
  material.setVector4("wayDrift", drift);
  material.setVector4("wayMove", move);
  material.setFloat("wayGain", 0);
  material.setFloat("wayStrata", WAY_STRATA_M);
  material.setVector4("wayMist", new Vector4(WAY_VEIL_STRENGTH, WAY_FIN_SHARE, WAY_SHEET_STRENGTH, WAY_HIDE_SHARE));
  material.setVector4("wayGround", new Vector4(WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_MIST_REACH));
  material.setVector4("wayPath", new Vector4(WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_NEAR_DAMP, WAY_DENSITY_FLOOR));
  // The ground mist's own noise (the large shapes in its red, the small in its green), a texture of this material's own so it is there on every tier.
  const noise = RawTexture.CreateRGBATexture(cloudNoiseMap(), CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  noise.wrapU = Texture.WRAP_ADDRESSMODE;
  noise.wrapV = Texture.WRAP_ADDRESSMODE;
  material.setTexture("wayNoise", noise);

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
      // The chunk on a flat ground first, then each vertex lifted onto the real one, a few of its heights a slice: the
      // ground's height is the dear part (the walkable rock's layer is several reads a place), and a vertex that
      // stands over another's place on it (a sheet over the lowest, a head over its foot) takes that one's.
      const data = wayChunk(way, () => 0, from, to);
      const count = data.positions.length / 3;
      const ground = new Float32Array(count);
      let asked = 0;
      for (let v = 0; v < count; v++) {
        const j = v % WAY_POINT_VERTICES, own = wayGroundOf(j);
        if (own !== j) ground[v] = ground[v - j + own] as number;
        else {
          ground[v] = heightAt(data.positions[v * 3] as number, data.positions[v * 3 + 2] as number);
          if (++asked % WAY_HEIGHTS_A_SLICE === 0) yield;
        }
        data.positions[v * 3 + 1] = (data.positions[v * 3 + 1] as number) + (ground[v] as number);
      }
      const mesh = new Mesh(`${WAY_LIGHT_NAME}_${i}`, scene);
      mesh.setVerticesData(VertexBuffer.PositionKind, data.positions, false);
      mesh.setVerticesData("wayLight", data.light, false, WAY_LIGHT_FLOATS);
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
    update(eye, level, undim, mist, seconds) {
      eyeAt.copyFrom(eye);
      material.setVector3("wayEye", eyeAt);
      // On the post path the mist is lit before the tone map and the grade, so the frame's dim is taken back out of
      // it; on the material path the frame is already toned as each material is drawn, and the dim never reaches it.
      const [r, g, b] = wayMistColour(mist, colourPath === "post" ? WAY_POST_LIFT * undim : WAY_MATERIAL_LIFT);
      tint.set(r, g, b);
      material.setVector3("wayTint", tint);
      const [dx, dy, dz, dw] = wayDrift(seconds);
      drift.set(dx, dy, dz, dw);
      material.setVector4("wayDrift", drift);
      const [first, second] = wayHeavePhases(seconds);
      move.set(WAY_HEAVE, WAY_CURL, first, second);
      material.setVector4("wayMove", move);
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
      // While any mesh warms the mist is nothing: a frame of it ahead of the chase would show.
      material.setFloat("wayGain", warming ? 0 : level);
    },
    get ready() {
      return ready;
    },
    dispose() {
      clear();
      noise.dispose();
      material.dispose();
    },
  };
}
