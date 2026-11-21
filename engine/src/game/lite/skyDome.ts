/**
 * The sky's dome on Babylon Lite: a box round the eye drawn by one fragment
 * stage, the game's own (`skyDome.fragment.glsl`) in WGSL statement
 * for statement, from the numbers the game draws it with
 * (`skyDomeParams.ts`): the clear sky's slice of the scattering table at the
 * sun's altitude, the cloud deck, the night floor, the sun's disc and the
 * mist's horizon, for the hour and the weather.
 *
 * - **The box rides with the eye** as Babylon.js's `infiniteDistance` has it:
 *   the vertex stage puts a corner at the eye plus its own position, which
 *   is its direction from the eye, so the box's place is never written.
 * - **The table** goes up as a 32 x 64 half-float texture, filtered and
 *   clamped, already in the scene's units, and only when the sun's altitude
 *   or the table's count of slices has moved (`createSkyTableUploads`): a
 *   weather fade uploads nothing. The stage reads it once, at level 0.
 * - **Colour** is the low tier's material path, as every other material on
 *   Lite: the frame's exposure, Khronos PBR Neutral, the encode and the
 *   display curve's contrast, the exposure and the contrast read from the
 *   frame's block (`frameBlock.ts`). With no chain the dome grades its own
 *   colour as every material does: the vignette, the colour curves and the
 *   dither (`displayCurve.ts`).
 * - **The image-based light's capture** draws the same sky in linear light
 *   (`SKY_RADIANCE_WGSL`, `skyCapture.ts`), with the disc capped.
 *
 * The uniforms are written when the sky's state moves, never a frame. The
 * dome takes its place among the opaque draws last (`DRAW_ORDER.sky`), so
 * every pixel something nearer has drawn is passed over by the depth test.
 * It goes with the scene it is drawn in.
 */
import {
  addToScene, createBox, createRenderTexture2D, createShaderMaterial, setShaderTexture, setShaderUniform, updateTextureRegion,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial, type Texture2D,
} from "@babylonjs/lite";
import { MATERIAL_GRADE_WGSL } from "./displayCurve.js";
import { rgbToHalfRgba } from "../halfFloat.js";
import { SKY_DOME_SIZE, createSkyTableUploads, emptySkyDomeUniforms, skyDomeUniforms } from "../skyDomeParams.js";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "../skyModel.js";
import { MIST_HORIZON, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS, type SkyState } from "../skyState.js";
import { DRAW_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageOwn, stageReads } from "./frameBlock.js";
import radianceSource from "../shaders/skyDome/radiance.wgsl?raw";
import domeVertexSource from "../shaders/skyDome/dome.vertex.wgsl?raw";
import domeFragmentSource from "../shaders/skyDome/dome.fragment.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

const f = wgslFloat;

/**
 * The dome's radiance toward a unit direction, linear, as the fragment stage
 * composes it before its tone map (`domeRadiance` in `skyState.ts`): the
 * clear slice scaled, mixed toward the deck by the cloud, the night floor
 * added, the disc (capped where `capture` is 1), then the mist's blend
 * toward the air at the horizon. It reads `skyTable` through
 * `skyTableSampler`, which the stage that includes it binds.
 */
export const SKY_RADIANCE_WGSL = fill(wgsl(radianceSource), { mathPi: Math.PI.toFixed(8), sliceAzimuths: f(SLICE_AZIMUTHS), sliceElevations: f(SLICE_ELEVATIONS), mistHorizon: f(MIST_HORIZON), sunDiscCos: SUN_DISC_COS.toFixed(8), sunDiscCaptureMax: f(SUN_DISC_CAPTURE_MAX) });

/** The vertex stage: a corner of the box at the eye plus its own position, which the fragment stage reads as the direction. */
const VERTEX = wgsl(domeVertexSource);

/**
 * The fragment stage: the radiance, then the material colour path as the
 * game's stage has it there, in Babylon's order (the exposure, Khronos PBR
 * Neutral, the encode, the contrast), and the clamp the dither leaves at an
 * intensity of 0.
 */
const fragment = (linear: boolean, graded = false): string => fill(wgsl(domeFragmentSource), { grade: graded ? MATERIAL_GRADE_WGSL : "", radiance: SKY_RADIANCE_WGSL, linearReturn: linear ? "return vec4<f32>(sky,1.0);" : "", skyColour: graded ? "gradeVignette(sky*u.skyExposure,input.position.xy)" : "sky*u.skyExposure", gradedTone: graded ? "toned=gradeCurves(toned);toned=gradeDither(toned,input.position.xy);" : "" });
const FRAGMENT = fragment(false);

/** The stages' text, for the tests that hold it to the game's: the fragment's on the material colour path, and with the radiance handed on as it is, for a post chain to grade (`skyToneMap` at 0 in the game's). */
export const SKY_DOME_WGSL = { vertex: VERTEX, fragment: FRAGMENT, fragmentLinear: fragment(true), fragmentGraded: fragment(false, true) } as const;

/** What the dome reads from the frame's block, by the block's names: the display curve. */
export const SKY_FRAME_READS = { skyExposure: FRAME_EXPOSURE_NAME, skyContrast: FRAME_CONTRAST_NAME } as const;

/** The dome as it stands in a scene. */
export type LiteSkyDome = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The table's texture, which the capture reads too. */
  readonly table: Texture2D;
  /** Draws the dome for `s` at the frame's `exposure` and the display curve's `contrast`: its uniforms, and the slice
   * where it has moved. Says how many bytes of the table it handed to the GPU. */
  update(s: SkyState, exposure: number, contrast: number): number;
};

/** The bytes of the table's slice: four halves a texel. */
export const SKY_TABLE_BYTES = SLICE_AZIMUTHS * SLICE_ELEVATIONS * 8;

/** The sky's table as a half-float texture, filtered, clamped at its ends (`createRenderTexture2D` clamps by default). */
export function skyTableTexture(engine: EngineContext): Texture2D {
  return createRenderTexture2D(engine, SLICE_AZIMUTHS, SLICE_ELEVATIONS, { format: "rgba16float", minFilter: "linear", magFilter: "linear" });
}

/** The dome in `scene`, reading `frame`, the frame's block; the night sky alone until its first update. */
export function createLiteSkyDome(engine: EngineContext, scene: SceneContext, frame: PluginUniformBlock, linear = false): LiteSkyDome {
  const values = emptySkyDomeUniforms();
  const own = stageOwn(values, SKY_FRAME_READS);
  const material = createShaderMaterial({
    name: "skyDome",
    vertexSource: VERTEX,
    // With no chain the dome grades its own colour as the game's stage does: the vignette, the colour curves, the dither.
    fragmentSource: stageReads(linear ? SKY_DOME_WGSL.fragmentLinear : SKY_DOME_WGSL.fragmentGraded, SKY_FRAME_READS),
    attributes: ["position"],
    // The view and the eye are the scene's own (`frameBlock.ts`): no system uniform.
    uniforms: [
      ...Object.entries(own).map(([name, value]) => ({ name, type: value.length === 1 ? ("f32" as const) : ("vec3<f32>" as const), defaultValue: value })),
    ],
    uniformBlocks: [frame],
    samplers: ["skyTable"],
    // Seen from inside.
    backFaceCulling: false,
    // Where a post chain reads the frame's depth, the sky leaves it as nothing drawn: the chain's far sky.
    ...(linear ? { depthWrite: false } : {}),
  });
  const table = skyTableTexture(engine);
  setShaderTexture(material, "skyTable", table);
  const halves = new Uint16Array(SLICE_AZIMUTHS * SLICE_ELEVATIONS * 4);
  const uploads = createSkyTableUploads();
  /** Writes the dome's own uniforms, as `values` now stands. */
  const write = (): void => {
    for (const [name, value] of Object.entries(own)) setShaderUniform(material, name, value.length === 1 ? (value[0] as number) : value);
  };
  write();

  const mesh = createBox(engine, { size: SKY_DOME_SIZE });
  mesh.material = material;
  mesh.renderOrder = DRAW_ORDER.sky;
  addToScene(scene, mesh);

  return {
    mesh,
    material,
    table,
    update(s, exposure, contrast) {
      let bytes = 0;
      if (uploads.due(s)) {
        updateTextureRegion(engine, table, rgbToHalfRgba(s.clear.texels, halves, s.scale), { width: SLICE_AZIMUTHS, height: SLICE_ELEVATIONS, bytesPerRow: SLICE_AZIMUTHS * 8 });
        bytes += SKY_TABLE_BYTES;
      }
      skyDomeUniforms(s, exposure, contrast, values);
      write();
      return bytes;
    },
  };
}
