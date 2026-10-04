/**
 * The sky dome: a box around the eye drawn by one fragment stage
 * (`shaders/skyDome.fragment.fx`) from the sky's state (`skyState.ts`): the
 * clear sky's slice of the scattering table, the cloud deck, the night
 * floor (the moonlit night sky, by the night factor), the sun's disc and the
 * mist's horizon. The reflection probe captures
 * it as the image-based light (`lighting.ts`), switching it to the capture
 * output while it renders: the linear sky with the disc capped, raised to
 * 1/2.2 (`captureEncode`), since the probe is flagged as gamma and every PBR
 * material raises what it reads from it to 2.2 again.
 *
 * The slice goes up on each change of hour or weather as a 32 x 64 RGBA16F
 * texture, 16 KB: half float is filterable on WebGL2 and on WebGPU's core
 * features, where float32 filtering is optional. The stage reads it once, at
 * an explicit level, in uniform control flow.
 *
 * GLSL on every engine, as a ShaderMaterial is unless told otherwise
 * (`rainMap.ts` builds its own the same way): on WebGPU the stages are
 * translated, or found in the WGSL map once the corpus holds them.
 *
 * On the material colour path (no post chain) the stage tone-maps itself
 * (`skyToneMap`), as Babylon's image processing does every other material
 * there; the exposure comes in through `update` and the contrast is the
 * scene's own.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

import { NIGHT_SKY } from "./sky.js";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "./skyModel.js";
import type { SkyState } from "./skyState.js";
import { rgbToHalfRgba } from "./halfFloat.js";
import skyDomeVertex from "./shaders/skyDome.vertex.fx?raw";
import skyDomeFragment from "./shaders/skyDome.fragment.fx?raw";

/** The material's and the mesh's name, and the stages' name in Babylon's shader store. */
export const SKY_DOME_NAME = "skyDome";

/** The stages' uniforms: the two matrices, then the sky's. */
export const SKY_DOME_UNIFORMS: readonly string[] = [
  "world", "viewProjection",
  "skyScale", "skyCloud", "skyDeckZenith", "skyNight", "skyMistAir", "skyMistWeight", "skySunDir", "skyDisc",
  "skyCapture", "skyExposure", "skyToneMap", "skyContrast",
];

/** Big enough to sit outside any view, small enough to stay inside the far plane. */
const SKYBOX_SIZE = 8000;

export type SkyDome = {
  /** A box of SKYBOX_SIZE riding with the eye, never picked. */
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Uploads the clear slice as the table texture and sets every uniform from `s`;
   * `exposure` is the material path's image exposure. */
  update(s: SkyState, exposure: number): void;
  /** The probe's capture: the disc capped, the linear sky gamma-encoded, no tone map. */
  setCapture(on: boolean): void;
  dispose(): void;
};

export function createSkyDome(scene: Scene, colourPath: "post" | "material"): SkyDome {
  Effect.ShadersStore[`${SKY_DOME_NAME}VertexShader`] = skyDomeVertex;
  Effect.ShadersStore[`${SKY_DOME_NAME}FragmentShader`] = skyDomeFragment;

  const material = new ShaderMaterial(SKY_DOME_NAME, scene, SKY_DOME_NAME, {
    attributes: ["position"],
    uniforms: [...SKY_DOME_UNIFORMS],
    samplers: ["skyTable"],
  });
  // Seen from inside.
  material.backFaceCulling = false;

  // Linear filtering where the engine filters half floats (WebGL2 and WebGPU
  // both do; RawTexture falls back to nearest where it does not), clamped so
  // the azimuth's ends and the zenith row never wrap.
  const table = RawTexture.CreateRGBATexture(
    new Uint16Array(SLICE_AZIMUTHS * SLICE_ELEVATIONS * 4),
    SLICE_AZIMUTHS,
    SLICE_ELEVATIONS,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  table.name = "skyTable";
  table.wrapU = Texture.CLAMP_ADDRESSMODE;
  table.wrapV = Texture.CLAMP_ADDRESSMODE;
  material.setTexture("skyTable", table);

  const deckZenith = new Vector3();
  const mistAir = new Vector3();
  const sunDir = new Vector3(0, 1, 0);
  const disc = new Vector3();
  const night = new Vector3(NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b);
  // Until the first update the dome is the night sky alone.
  material.setFloat("skyScale", 0);
  material.setFloat("skyCloud", 0);
  material.setVector3("skyDeckZenith", deckZenith);
  material.setVector3("skyNight", night);
  material.setVector3("skyMistAir", mistAir);
  material.setFloat("skyMistWeight", 0);
  material.setVector3("skySunDir", sunDir);
  material.setVector3("skyDisc", disc);
  material.setFloat("skyCapture", 0);
  material.setFloat("skyExposure", 1);
  material.setFloat("skyToneMap", colourPath === "material" ? 1 : 0);
  material.setFloat("skyContrast", 1);

  const mesh = MeshBuilder.CreateBox(SKY_DOME_NAME, { size: SKYBOX_SIZE }, scene);
  mesh.material = material;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;

  return {
    mesh,
    material,
    update(s, exposure) {
      table.update(rgbToHalfRgba(s.clear.texels));
      material.setFloat("skyScale", s.scale);
      material.setFloat("skyCloud", s.cloud);
      material.setVector3("skyNight", night.set(s.nightFloor.r, s.nightFloor.g, s.nightFloor.b));
      material.setVector3("skyDeckZenith", deckZenith.set(s.deckZenith.r, s.deckZenith.g, s.deckZenith.b));
      material.setVector3("skyMistAir", mistAir.set(s.mistAir.r, s.mistAir.g, s.mistAir.b));
      material.setFloat("skyMistWeight", s.mistWeight);
      material.setVector3("skySunDir", sunDir.set(s.sunDir.x, s.sunDir.y, s.sunDir.z));
      material.setVector3("skyDisc", disc.set(s.discColour.r, s.discColour.g, s.discColour.b));
      material.setFloat("skyExposure", exposure);
      material.setFloat("skyContrast", scene.imageProcessingConfiguration.contrast);
    },
    setCapture(on) {
      material.setFloat("skyCapture", on ? 1 : 0);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      table.dispose();
    },
  };
}
