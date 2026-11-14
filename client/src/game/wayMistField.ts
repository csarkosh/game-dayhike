/**
 * The mist beyond the way's banks (docs/gameplay/2026-11-13-the-way-down.md),
 * on the tiers with no marched ground mist: one mesh round the eye
 * (wayMistFieldGeometry.ts) and one material, the way's own mist carried on
 * over all the ground the player can see. The renderer makes it on the
 * material path alone and gives it, each frame, what it gives the way's mist.
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
import { CHASE_TINT } from "./gradeParams.js";
import { wayDistanceWithin, type WayDown } from "../sim/wayDown.js";
import { WAY_WARM_FRAMES } from "./wayLight.js";
import { WAY_CURL, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE, wayDrift, wayHeavePhases, wayTint } from "./wayLightGeometry.js";
import {
  FIELD_CELL_M, FIELD_FAR_M, FIELD_FILL_A_FRAME, FIELD_FIN_STRENGTH, FIELD_FLOATS, FIELD_FROM_M, FIELD_RIM_M, FIELD_SHEET_STRENGTH, FIELD_TOP_M, FIELD_VERTICES, FIELD_WHOLE_M,
  fieldIndices, fillField, newFieldCache, refreshField,
} from "./wayMistFieldGeometry.js";
import wayFieldVertex from "./shaders/wayField.vertex.fx?raw";
import wayFieldFragment from "./shaders/wayField.fragment.fx?raw";

export const WAY_FIELD_NAME = "wayField";
export const WAY_FIELD_UNIFORMS = ["viewProjection", "wayDrift", "wayEye", "wayFieldMist", "wayFieldReach", "wayGain", "wayHead", "wayMove", "wayTint"] as const;
export const WAY_FIELD_SAMPLERS = ["wayNoise"] as const;

export type WayMistField = {
  /**
   * A frame: the eye; the way's mist's `level` (0 none, 1 whole); the ground
   * mist's colour (`mist`); the frame's `seconds`; the chase's `cast` (0 to
   * 1), which the mist takes itself on this path; and the way and the ground
   * it stands on, or none (nothing is drawn).
   */
  update(eye: Vector3, level: number, mist: Rgb, seconds: number, cast: number, way: WayDown | null, heightAt: ((x: number, z: number) => number) | null): void;
  dispose(): void;
};

/** The mist beyond the way's banks in `scene`, toned for the material path. */
export function createWayMistField(scene: Scene): WayMistField {
  Effect.ShadersStore[`${WAY_FIELD_NAME}VertexShader`] = wayFieldVertex;
  Effect.ShadersStore[`${WAY_FIELD_NAME}FragmentShader`] = wayFieldFragment;
  const material = new ShaderMaterial(WAY_FIELD_NAME, scene, WAY_FIELD_NAME, {
    attributes: ["position", "wayField"],
    uniforms: [...WAY_FIELD_UNIFORMS],
    samplers: [...WAY_FIELD_SAMPLERS],
    needAlphaBlending: true,
  });
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.zOffset = -2;
  const eyeAt = new Vector3(), tint = new Vector3(), drift = new Vector4(), move = new Vector4(WAY_HEAVE, WAY_CURL, 0, 0);
  material.setVector3("wayEye", eyeAt);
  material.setVector3("wayTint", tint);
  material.setVector4("wayDrift", drift);
  material.setVector4("wayMove", move);
  material.setFloat("wayGain", 0);
  material.setFloat("wayHead", WAY_HEAD);
  material.setVector4("wayFieldMist", new Vector4(FIELD_SHEET_STRENGTH, FIELD_FIN_STRENGTH, FIELD_TOP_M, WAY_HIDE_SHARE));
  material.setVector4("wayFieldReach", new Vector4(FIELD_FROM_M, FIELD_WHOLE_M, FIELD_RIM_M[0], FIELD_RIM_M[1]));
  const noise = RawTexture.CreateRGBATexture(cloudNoiseMap(), CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  noise.wrapU = Texture.WRAP_ADDRESSMODE;
  noise.wrapV = Texture.WRAP_ADDRESSMODE;
  material.setTexture("wayNoise", noise);

  const out = { positions: new Float32Array(FIELD_VERTICES * 3), field: new Float32Array(FIELD_VERTICES * FIELD_FLOATS).fill(-1) };
  const mesh = new Mesh(WAY_FIELD_NAME, scene);
  mesh.setVerticesData(VertexBuffer.PositionKind, out.positions, true);
  mesh.setVerticesData("wayField", out.field, true, FIELD_FLOATS);
  mesh.setIndices(fieldIndices());
  mesh.material = material;
  mesh.isPickable = false;
  // It is round the eye wherever the eye looks, and its bounds are not kept up as it moves.
  mesh.alwaysSelectAsActiveMesh = true;

  let cache = newFieldCache();
  let lastWay: WayDown | null = null;
  let lastX = NaN, lastZ = NaN;
  /** Frames it is still to be drawn at nothing, so its pipeline is made before the chase shows it. */
  let warm = WAY_WARM_FRAMES;

  return {
    update(eye, level, mist, seconds, cast, way, heightAt) {
      const warming = warm > 0;
      if (warming) warm--;
      const shown = level > 0 && way !== null && heightAt !== null;
      mesh.setEnabled(warming || shown);
      material.setFloat("wayGain", warming || !shown ? 0 : level);
      if (!shown) return;
      if (way !== lastWay) {
        lastWay = way;
        cache = newFieldCache();
      }
      const cellX = Math.round(eye.x / FIELD_CELL_M), cellZ = Math.round(eye.z / FIELD_CELL_M);
      const filled = refreshField(cache, cellX, cellZ, heightAt, (x, z) => wayDistanceWithin(way, x, z, FIELD_FAR_M), FIELD_FILL_A_FRAME);
      if (filled > 0 || cellX !== lastX || cellZ !== lastZ) {
        lastX = cellX;
        lastZ = cellZ;
        fillField(out, cellX, cellZ, cache, eye.y);
        mesh.updateVerticesData(VertexBuffer.PositionKind, out.positions);
        mesh.updateVerticesData("wayField", out.field);
      }
      eyeAt.copyFrom(eye);
      material.setVector3("wayEye", eyeAt);
      const [r, g, b] = wayTint("material", mist, 1, cast, CHASE_TINT);
      tint.set(r, g, b);
      material.setVector3("wayTint", tint);
      const [dx, dy, dz, dw] = wayDrift(seconds);
      drift.set(dx, dy, dz, dw);
      material.setVector4("wayDrift", drift);
      const [first, second] = wayHeavePhases(seconds);
      move.set(WAY_HEAVE, WAY_CURL, first, second);
      material.setVector4("wayMove", move);
    },
    dispose() {
      mesh.dispose();
      noise.dispose();
      material.dispose();
    },
  };
}
