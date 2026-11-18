/**
 * The valley mist banks on Babylon Lite: every bank a frame shows as an
 * instance of one unit quad, drawn by one stage of the hike's own, from what
 * the game draws them with (`mistBanks.ts`: which banks, where the wind has
 * carried each, how far each has faded, each quad's world matrix and the
 * material's uniforms; `mistField.ts`: the sprite).
 *
 * - **The stage is Babylon.js's Standard material as the game sets it for
 *   the banks**, statement for statement: unlit, the banks' colour its
 *   emissive, the sprite's alpha its opacity, the scene's distance fog
 *   (exponential squared, toward the gradient's far end) mixed in before
 *   the colour is taken to linear, then the material colour path
 *   (`displayCurve.ts`), and the mesh's visibility on the alpha last. The
 *   atmosphere's plugin is not on it: the banks' fog is the stage's own.
 * - **A bank's visibility rides in the last float of its instance's
 *   matrix** (`writeMistInstances`), so a frame that moves a bank, turns the
 *   camera or changes a fade writes one buffer, counted on the renderer's
 *   record of its uploads, and a frame that does none of them writes
 *   nothing. The scene's fog and the display curve are read from the
 *   frame's block (`frameBlock.ts`), so the material's own uniform is the
 *   banks' colour alone, written when the air's colours move.
 * - **Blended over what is behind them, tested against the depth and never
 *   written to it**, after every opaque draw and the sky, at the banks'
 *   place among the see-through draws (`SEE_THROUGH_ORDER`), farthest bank
 *   first within the one draw.
 */
import {
  addToScene, createPlane, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, flushThinInstances, removeFromScene, setMeshVisible,
  setShaderTexture, setThinInstanceCount, setThinInstances,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import type { AtmosphereRecord } from "../atmosphereParams.js";
import type { Rgb } from "../colour.js";
import { MIST_INSTANCE_FLOATS, createMistBanks, emptyMistUniforms, mistUniforms, writeMistInstances, type MistOrder } from "../mistBanks.js";
import { MIST_TEX_SIZE, mistAlphaMap } from "../mistField.js";
import type { QualityTier } from "../quality.js";
import type { WeatherParams } from "../weather.js";
import type { WindRecord } from "../windParams.js";
import { DISPLAY_CURVE_WGSL, onColourPath } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageOwn, stageReads } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";

/** What the two stages hand each other. */
const VARYINGS = "struct MistOut{@builtin(position)position:vec4<f32>,@location(0)uv:vec2<f32>,@location(1)fogDistance:vec3<f32>,@location(2)visibility:f32}";

/** The vertex stage: a corner of the quad through its instance's matrix, whose last float is the bank's visibility, and
 * the fog's distance in the view's space. */
const VERTEX = /* wgsl */ `
${VARYINGS}
@vertex fn mainVertex(input:VertexInput)->MistOut{
  var out:MistOut;
  let world=mat4x4<f32>(input.world0,input.world1,input.world2,vec4<f32>(input.world3.xyz,1.0));
  let worldPos=world*vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  out.fogDistance=(scene.view*worldPos).xyz;
  out.uv=input.uv;
  out.visibility=input.world3.w;
  return out;
}`;

/**
 * The fragment stage: the Standard material's, with no light, an emissive
 * colour, an opacity texture and the scene's fog (`CalcFogFactor` at
 * `FOGMODE_EXP2`), in Babylon.js's order.
 */
const FRAGMENT = /* wgsl */ `
${VARYINGS}
${DISPLAY_CURVE_WGSL}
const MIST_E:f32=2.71828;
fn mistFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(MIST_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:MistOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=1.0;
  let opacityMap=textureSample(mistSprite,mistSpriteSampler,input.uv);
  alpha*=opacityMap.a;
  let emissiveColor=u.mistEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=mistFogFactor(input.fogDistance,u.mistFogDensity);
  color=vec4<f32>(mix(u.mistFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.mistExposure,u.mistContrast),color.a);
  color.a*=input.visibility;
  return color;
}`;

/** The stages' text, for the tests that hold it to the game's. */
export const MIST_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** What the banks read from the frame's block, by the block's names: the scene's fog and the display curve. */
export const MIST_FRAME_READS = {
  mistFogColour: "atmFarColour", mistFogDensity: "atmBaseDensity", mistExposure: FRAME_EXPOSURE_NAME, mistContrast: FRAME_CONTRAST_NAME,
} as const;

/** Bytes an instance hands to the GPU. */
export const MIST_INSTANCE_BYTES = MIST_INSTANCE_FLOATS * 4;

/** What a frame draws the banks with, beside the camera's place: the pose it is seen from, the air and the display curve. */
export type MistFrame = {
  /** The eye the banks are ordered from, and the camera's yaw they are turned to. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  yaw: number;
  /** The banks' colour, the fog gradient's middle. */
  colour: Rgb;
  air: AtmosphereRecord;
  exposure: number;
  contrast: number;
};

/** The banks as they stand in a scene. */
export type LiteMistMeshes = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The banks for a camera at (camX, camZ) under `w`, at `seconds` of the render clock, as the game's shell is handed them. */
  update(camX: number, camZ: number, w: WeatherParams, wind: WindRecord, seconds: number, frame: MistFrame): void;
  /** Banks drawn by the last update. */
  readonly shown: number;
  dispose(): void;
};

/** The banks of `seed`'s world in `scene`, reading `frame`, the frame's block; none shown until a frame with mist. */
export function createLiteMistMeshes(
  engine: EngineContext, scene: SceneContext, seed: number, tier: QualityTier, frame: PluginUniformBlock, uploads?: FrameUploads, linear = false,
): LiteMistMeshes {
  const banks = createMistBanks(seed, tier);
  const cap = banks.drawn.length;
  const values = emptyMistUniforms();
  const own = stageOwn(values, MIST_FRAME_READS);
  const material = createShaderMaterial({
    name: "mistBanks",
    vertexSource: stageReads(VERTEX, MIST_FRAME_READS),
    fragmentSource: stageReads(onColourPath(FRAGMENT, linear), MIST_FRAME_READS),
    attributes: ["position", "uv"],
    // The view is the scene's own (`frameBlock.ts`): no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    samplers: ["mistSprite"],
    needAlphaBlending: true,
    blendMode: "alpha",
    // Soft volumes must not occlude, and are seen from either side.
    depthWrite: false,
    backFaceCulling: false,
  });
  // The sprite as the game's shell makes it: its smaller levels filtered between, repeating.
  const sprite = createTexture2DFromPixels(engine, mistAlphaMap(), MIST_TEX_SIZE, MIST_TEX_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  setShaderTexture(material, "mistSprite", sprite);
  const writeUniforms = shaderUniformWriter(material, own);

  // What the mesh draws from, and what the next frame is composed into: the mesh's arrays are written only where the
  // two differ.
  const matrices = new Float32Array(cap * MIST_INSTANCE_FLOATS);
  const next = new Float32Array(cap * MIST_INSTANCE_FLOATS);
  const order: MistOrder = [];
  let shown = 0;

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.mist;
  setThinInstances(mesh, matrices, cap);
  setThinInstanceCount(mesh, 0);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  function show(count: number): void {
    if (count === shown) return;
    shown = count;
    setThinInstanceCount(mesh, count);
    setMeshVisible(mesh, count > 0);
  }

  /** Whether the first `count` instances composed are the ones the mesh draws from. */
  function standing(count: number): boolean {
    if (count !== shown) return false;
    for (let i = 0; i < count * MIST_INSTANCE_FLOATS; i++) if (next[i] !== matrices[i]) return false;
    return true;
  }

  return {
    mesh,
    material,
    get shown() {
      return shown;
    },
    update(camX, camZ, w, wind, seconds, frame) {
      if (!banks.update(camX, camZ, w, wind, seconds)) {
        show(0);
        return;
      }
      const count = writeMistInstances(banks.drawn, frame.eye, frame.yaw, next, order);
      if (!standing(count)) {
        matrices.set(next.subarray(0, count * MIST_INSTANCE_FLOATS));
        show(count);
        if (count > 0) {
          flushThinInstances(mesh);
          uploads?.count("instances", count * MIST_INSTANCE_BYTES);
          uploads?.composed(count);
        }
      }
      if (count === 0) return;
      mistUniforms(frame.colour, frame.air, frame.exposure, frame.contrast, values);
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
