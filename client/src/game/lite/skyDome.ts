/**
 * The sky's dome on Babylon Lite: a box round the eye drawn by one fragment
 * stage, the game's own (`shaders/skyDome.fragment.fx`) in WGSL statement
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
 *   frame's block (`frameBlock.ts`). The vignette, the colour curves and the
 *   dither, which the low tier grades with in its materials on Babylon.js,
 *   are not drawn on Lite by any material, and not by this one.
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
import { rgbToHalfRgba } from "../halfFloat.js";
import { SKY_DOME_SIZE, createSkyTableUploads, emptySkyDomeUniforms, skyDomeUniforms } from "../skyDomeParams.js";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "../skyModel.js";
import { MIST_HORIZON, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS, type SkyState } from "../skyState.js";
import { DRAW_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageOwn, stageReads } from "./frameBlock.js";

const f = wgslFloat;

/**
 * The dome's radiance toward a unit direction, linear, as the fragment stage
 * composes it before its tone map (`domeRadiance` in `skyState.ts`): the
 * clear slice scaled, mixed toward the deck by the cloud, the night floor
 * added, the disc (capped where `capture` is 1), then the mist's blend
 * toward the air at the horizon. It reads `skyTable` through
 * `skyTableSampler`, which the stage that includes it binds.
 */
export const SKY_RADIANCE_WGSL = /* wgsl */ `
const SKY_PI:f32=${Math.PI.toFixed(8)};
const SKY_AZIMUTHS:f32=${f(SLICE_AZIMUTHS)};
const SKY_ELEVATIONS:f32=${f(SLICE_ELEVATIONS)};
const SKY_MIST_HORIZON:f32=${f(MIST_HORIZON)};
const SKY_DISC_COS:f32=${SUN_DISC_COS.toFixed(8)};
const SKY_DISC_CAPTURE_MAX:f32=${f(SUN_DISC_CAPTURE_MAX)};
fn skyTableUv(d:vec3<f32>,sunDir:vec3<f32>)->vec2<f32>{
  let h=d.xz;
  let s=sunDir.xz;
  let hl=length(h);
  let sl=length(s);
  let c=select(1.0,clamp(dot(h,s)/(hl*sl),-1.0,1.0),hl>1.0e-6&&sl>1.0e-6);
  let u=acos(c)/SKY_PI;
  let e=asin(clamp(d.y,0.0,1.0));
  let v=0.5+0.5*sign(e)*sqrt(abs(e)/(0.5*SKY_PI));
  return vec2<f32>((u*(SKY_AZIMUTHS-1.0)+0.5)/SKY_AZIMUTHS,(v*(SKY_ELEVATIONS-1.0)+0.5)/SKY_ELEVATIONS);
}
fn skyDeck(zenith:vec3<f32>,sinE:f32)->vec3<f32>{
  return zenith*(1.0+2.0*max(sinE,0.0))/3.0;
}
fn skyRadiance(d:vec3<f32>,sunDir:vec3<f32>,scale:f32,cloud:f32,deckZenith:vec3<f32>,night:vec3<f32>,disc:vec3<f32>,mistAir:vec3<f32>,mistWeight:f32,capture:f32)->vec3<f32>{
  var sky=scale*textureSampleLevel(skyTable,skyTableSampler,skyTableUv(d,sunDir),0.0).rgb;
  sky=mix(sky,skyDeck(deckZenith,d.y),cloud);
  sky+=night;
  let inDisc=step(SKY_DISC_COS,dot(d,sunDir));
  sky+=inDisc*mix(disc,min(disc,vec3<f32>(SKY_DISC_CAPTURE_MAX)),capture);
  let h=mistWeight*exp(-max(d.y,0.0)/SKY_MIST_HORIZON);
  return mix(sky,mistAir,h);
}`;

/** The vertex stage: a corner of the box at the eye plus its own position, which the fragment stage reads as the direction. */
const VERTEX = /* wgsl */ `
struct SkyOut{@builtin(position)position:vec4<f32>,@location(0)dir:vec3<f32>}
@vertex fn mainVertex(input:VertexInput)->SkyOut{
  var out:SkyOut;
  out.dir=input.position;
  out.position=scene.viewProjection*vec4<f32>(scene.vEyePosition.xyz+input.position,1.0);
  return out;
}`;

/**
 * The fragment stage: the radiance, then the material colour path as the
 * game's stage has it there, in Babylon's order (the exposure, Khronos PBR
 * Neutral, the encode, the contrast), and the clamp the dither leaves at an
 * intensity of 0.
 */
const fragment = (linear: boolean): string => /* wgsl */ `
struct SkyOut{@builtin(position)position:vec4<f32>,@location(0)dir:vec3<f32>}
${SKY_RADIANCE_WGSL}
fn skyNeutral(input:vec3<f32>)->vec3<f32>{
  let x=min(input.r,min(input.g,input.b));
  let offset=select(0.04,x-6.25*x*x,x<0.08);
  let color=input-offset;
  let peak=max(color.r,max(color.g,color.b));
  let k=1.0-0.76;
  let newPeak=1.0-k*k/(peak+k-0.76);
  let g=1.0-1.0/(0.15*(peak-newPeak)+1.0);
  let compressed=mix(color*(newPeak/max(peak,1.0e-6)),vec3<f32>(newPeak),g);
  return select(compressed,color,peak<0.76);
}
fn skyContrastOf(c:vec3<f32>,contrast:f32)->vec3<f32>{
  let high=c*c*(3.0-2.0*c);
  let shaped=select(mix(c,high,contrast-1.0),mix(vec3<f32>(0.5),c,contrast),contrast<1.0);
  return max(shaped,vec3<f32>(0.0));
}
@fragment fn mainFragment(input:SkyOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let sky=skyRadiance(normalize(input.dir),u.skySunDir,u.skyScale,u.skyCloud,u.skyDeckZenith,u.skyNight,u.skyDisc,u.skyMistAir,u.skyMistWeight,0.0);
  ${linear ? "return vec4<f32>(sky,1.0);" : ""}
  var toned=skyNeutral(sky*u.skyExposure);
  toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));
  toned=skyContrastOf(toned,u.skyContrast);
  return vec4<f32>(clamp(toned,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}`;
const FRAGMENT = fragment(false);

/** The stages' text, for the tests that hold it to the game's: the fragment's on the material colour path, and with the radiance handed on as it is, for a post chain to grade (`skyToneMap` at 0 in the game's). */
export const SKY_DOME_WGSL = { vertex: VERTEX, fragment: FRAGMENT, fragmentLinear: fragment(true) } as const;

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
    fragmentSource: stageReads(linear ? SKY_DOME_WGSL.fragmentLinear : FRAGMENT, SKY_FRAME_READS),
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
