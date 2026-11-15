/**
 * The rain on Babylon Lite: the streaks and, on the tiers that draw them,
 * the drips under the canopy, every drop an instance of one unit quad that
 * the vertex stage places inside a box locked to the camera, from what the
 * game draws them with (`rainField.ts`: the seeds, what a frame steps, the
 * counts and the uniforms; `rainParams.ts`: the placement's arithmetic).
 *
 * - **One mesh, one stage and one draw for both volumes.** On Babylon.js the
 *   streaks and the drips are two meshes on two materials that carry the
 *   same plugin under different defines (`rainPlugin.ts`), drawn one after
 *   the other. Here an instance says which it is, the stage takes the
 *   plugin's statements for its kind, and the drips are the list's first
 *   instances, so they are blended before the streaks as the game blends
 *   them.
 * - **The stage is Babylon.js's Standard material as the game sets it for
 *   the rain**, statement for statement, with the streak plugin's code at
 *   its two points: unlit, the rain's colour its emissive (the fog colour
 *   lifted, `rainMilk`), the streak's sprite its diffuse texture and alpha,
 *   the scene's distance fog (exponential squared) mixed in before the
 *   colour is taken to linear, then the material colour path
 *   (`displayCurve.ts`); and after it the plugin's two lines, the headlamp's
 *   colour mixed in and the drop's alpha.
 * - **A drop is its instance's matrix**, which is no matrix: the seed and
 *   the class in its first four floats, which volume it is and a drip's
 *   place among the drips in the next two (`rainInstances`). The list goes
 *   up once, when the mesh is made; a frame changes only how many are
 *   drawn.
 * - **What moves with the clock is the frame's block's** (`frameBlock.ts`):
 *   the folded time, the smoothed frame, the wind's drift and the canopy's
 *   water, with the eye, the scene's fog and the display curve. The
 *   material's own uniforms are written once in a frame that moves one: the
 *   boxes as the camera moves, the lamp, the counts and the colour; a frame
 *   with the camera still writes none, and a dry frame draws nothing and
 *   writes nothing for the rain, its mesh hidden.
 * - **Under the cover map** (`rainMap.ts`), on the tiers that have one, the
 *   vertex stage reads the map at the drop's place as the plugin does under
 *   `RAIN_OCCLUSION`: a streak under hard cover fades, a drip shows only
 *   under the canopy. Without a map the streaks fall through everything and
 *   no drip is drawn.
 * - **Blended over what is behind them, tested against the depth and never
 *   written to it**, last of the see-through draws (`SEE_THROUGH_ORDER`).
 */
import {
  addToScene, createPlane, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, enableShaderMaterialVisiblePacketUpdates, removeFromScene,
  setMeshVisible, setShaderTexture, setThinInstanceDrawCount, setThinInstances,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial, type Texture2D,
} from "@babylonjs/lite";
import type { AtmosphereRecord } from "../atmosphereParams.js";
import type { QualityTier } from "../quality.js";
import {
  RAIN_TEX_H, RAIN_TEX_W, createRainField, emptyRainStageUniforms, rainInstances, rainInstancesDrawn, rainStageUniforms, rainStreakMap,
  type RainLamp,
} from "../rainField.js";
import { DRIP, RAIN_FADE_FAR, RAIN_FADE_NEAR, RAIN_LENGTH, RAIN_MAP, RAIN_SKY_FADE, RAIN_SKY_RAMP, RAIN_STRETCH, dripCountUnder, rainCountUnder } from "../rainParams.js";
import type { WeatherParams } from "../weather.js";
import type { WindRecord } from "../windParams.js";
import { DISPLAY_CURVE_WGSL } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageClocks, stageOwn, stageReads, type StageRecord } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS =
  "struct RainOut{@builtin(position)position:vec4<f32>,@location(0)uv:vec2<f32>,@location(1)fogDistance:vec3<f32>,@location(2)rainAlpha:f32,@location(3)rainLamp:f32}";

/**
 * The cover's lines: the plugin's under `RAIN_OCCLUSION` for a map, a drop
 * in the open or a drip never shown without one. The map is read at the
 * drop's texel, as the game's sampler reads it: the nearest, at the base
 * level.
 */
const COVERED = /* wgsl */ `
  let rMu=(rp.xz-u.rainMapCentre)/u.rainMapExtent+0.5;
  let rMap=textureLoad(rainMap,vec2<i32>(clamp(rMu*${f(RAIN_MAP.texels)},vec2<f32>(0.0),vec2<f32>(${f(RAIN_MAP.texels - 1)}))),0);
  let rInMap=step(0.0,rMu.x)*step(rMu.x,1.0)*step(0.0,rMu.y)*step(rMu.y,1.0);
  let rCovered=rInMap*step(rp.y,rMap.r+rMap.b);
  let rCover=select(mix(1.0,max(rMap.g,step(0.5,rMap.b)),rCovered),rCovered*(1.0-rMap.g)*u.rainCanopyWater,drip);`;
const OPEN = /* wgsl */ `
  let rCover=select(1.0,0.0,drip);`;

/**
 * The vertex stage: the streak plugin's placement (`rainPlugin.ts`), each
 * line the streaks' or, for an instance that is a drip, the one the plugin
 * has under `RAIN_DRIP`; then the Standard material's own, the position
 * taken as the world's (the mesh and every instance stand at the origin)
 * and the fog's distance in the view's space. A drip past the share shown
 * is put outside the view.
 */
const vertex = (covered: boolean): string => /* wgsl */ `
${VARYINGS}
@vertex fn mainVertex(input:VertexInput)->RainOut{
  var out:RainOut;
  let u=shaderUniforms;
  let rainSeed=input.world0;
  let drip=input.world1.x>0.5;
  let rainBoxMin=select(u.rainBoxMin,u.dripBoxMin,drip);
  let rainBoxSize=select(u.rainBoxSize,u.dripBoxSize,drip);
  let rkI=floor(rainSeed.w*3.0+0.5);
  let rkSel=vec4<f32>(vec4<f32>(rkI)==vec4<f32>(0.0,1.0,2.0,3.0));
  let rSpeed=select(dot(u.rainSpeeds,rkSel),${f(DRIP.speed)},drip);
  let rWidth=select(dot(u.rainWidths,rkSel),${f(DRIP.width)},drip);
  let rClassAlpha=select(dot(u.rainAlphas,rkSel),1.0,drip);
  let rDrift=select(vec3<f32>(u.rainDrift.x,-rSpeed*u.rainFold/rainBoxSize.y,u.rainDrift.y),vec3<f32>(0.0,-rSpeed*u.rainFold/rainBoxSize.y,0.0),drip);
  let rq=fract(rainSeed.xyz+rDrift-rainBoxMin/rainBoxSize);
  let rp=rainBoxMin+rq*rainBoxSize;
  let rAlong=select(normalize(vec3<f32>(u.rainWind.x,-rSpeed,u.rainWind.y)),vec3<f32>(0.0,-1.0,0.0),drip);
  let rToCam=u.rainCam-rp;
  let rDist=max(length(rToCam),0.001);
  let rView=rToCam/rDist;
  let rSide=cross(rAlong,rView);
  let rRight=rSide/max(length(rSide),0.001);
  let rLen=select(clamp(rSpeed*u.rainDt*${f(RAIN_STRETCH)},${f(RAIN_LENGTH[0])},${f(RAIN_LENGTH[1])}),${f(DRIP.length)},drip);
  let positionUpdated=rp+rRight*(input.position.x*rWidth)+rAlong*(input.position.y*rLen);
  let rFade=smoothstep(${f(RAIN_FADE_NEAR[0])},${f(RAIN_FADE_NEAR[1])},rDist)*(1.0-smoothstep(${f(RAIN_FADE_FAR[0])},${f(RAIN_FADE_FAR[1])},rDist));
  let rSky=1.0-${f(RAIN_SKY_FADE)}*smoothstep(0.0,${f(RAIN_SKY_RAMP)},-rView.y);
  let rToLamp=rp-u.rainLampPos;
  let rLampD2=dot(rToLamp,rToLamp);
  let rCos=dot(rToLamp,u.rainLampDir)/sqrt(max(rLampD2,0.0001));
  let rCone=smoothstep(u.rainLamp.y,0.5+0.5*u.rainLamp.y,rCos);
  let rLampT=u.rainLamp.x*rCone/(1.0+rLampD2);${covered ? COVERED : OPEN}
  out.rainAlpha=min(rFade*rCover*(rSky*rClassAlpha+rLampT),1.0);
  out.rainLamp=min(rLampT,1.0);
  let worldPos=vec4<f32>(positionUpdated,1.0);
  out.position=select(shaderSystem.viewProjection*worldPos,vec4<f32>(2.0,2.0,2.0,1.0),drip&&input.world1.y>=u.rainDripShown);
  out.fogDistance=(shaderSystem.view*worldPos).xyz;
  out.uv=input.uv;
  return out;
}`;

/**
 * The fragment stage: the Standard material's, with no light, an emissive
 * colour, a diffuse texture whose alpha is the material's and the scene's
 * fog (`CalcFogFactor` at `FOGMODE_EXP2`), in Babylon.js's order, and the
 * streak plugin's two lines before the colour is written.
 */
const FRAGMENT = /* wgsl */ `
${VARYINGS}
${DISPLAY_CURVE_WGSL}
const RAIN_E:f32=2.71828;
fn rainFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(RAIN_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:RainOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=1.0;
  let baseColor=textureSample(rainStreak,rainStreakSampler,input.uv);
  alpha*=baseColor.a;
  let emissiveColor=u.rainEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0))*baseColor.rgb;
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=rainFogFactor(input.fogDistance,u.rainFogDensity);
  color=vec4<f32>(mix(u.rainFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.rainExposure,u.rainContrast),color.a);
  color=vec4<f32>(mix(color.rgb,u.rainLampColour,input.rainLamp),color.a);
  color.a*=input.rainAlpha;
  return color;
}`;

/** The stages' text, under a cover map and without one, for the tests that hold it to the game's. */
export const RAIN_WGSL = { vertex: vertex(false), vertexCovered: vertex(true), fragment: FRAGMENT } as const;

/** What the rain reads from the frame's block under another name: the eye, the scene's fog and the display curve. Its
 * clocks (the folded time, the smoothed frame, the drift, the canopy's water) are the block's under their own. */
export const RAIN_FRAME_READS = {
  rainCam: "fadeEye", rainFogColour: "atmFarColour", rainFogDensity: "atmBaseDensity", rainExposure: FRAME_EXPOSURE_NAME, rainContrast: FRAME_CONTRAST_NAME,
} as const;

/** What a frame draws the rain with beside the weather and the wind: the camera, the frame's seconds, the headlamp, the
 * scene's fog and the display curve. */
export type RainFrame = {
  /** The eye, and the camera's yaw (0 faces +Z). */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  yaw: number;
  /** The frame's duration, seconds. */
  dt: number;
  lamp: RainLamp;
  air: AtmosphereRecord;
  exposure: number;
  contrast: number;
};

/** The cover map as the rain reads it: its picture, and the centre it was last drawn at. */
export type RainCover = { readonly texture: Texture2D; readonly centre: { readonly x: number; readonly z: number } };

/** The rain as it stands in a scene. */
export type LiteRain = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The rain's clocks as the last update that drew a drop left them, for the frame's block (`stageClocks`). */
  readonly clocks: StageRecord;
  /** Whether a frame under `w` draws a drop that reads the cover map: so the map is drawn for one, and not for a dry frame. */
  reads(w: WeatherParams): boolean;
  /** The rain under `w` in `wind`, as the game's shell is handed it. */
  update(w: WeatherParams, wind: WindRecord, frame: RainFrame): void;
  /** Streaks and drips drawn by the last update. */
  readonly drawn: number;
  readonly dripping: number;
  /** The rain's colour as the last update that drew a drop left it (`rainMilk`). */
  readonly milk: readonly [number, number, number];
  /** The canopy's water, 0 to 1, stepped by every update (`canopyWaterStep`, `weather.ts`). */
  readonly canopyWater: number;
  dispose(): void;
};

/**
 * The tier's rain in `scene`, reading `frame`, the frame's block; hidden
 * until a frame draws a drop. Given `cover` its drops are under the map; on
 * a tier that draws drips, none is drawn without it.
 */
export function createLiteRain(
  engine: EngineContext, scene: SceneContext, tier: QualityTier, cover: RainCover | null, frame: PluginUniformBlock, uploads?: FrameUploads,
): LiteRain {
  const field = createRainField(tier);
  const instances = rainInstances(tier);
  const values = emptyRainStageUniforms();
  const own = stageOwn(values, RAIN_FRAME_READS);
  const material = createShaderMaterial({
    name: "rain",
    vertexSource: stageReads(cover === null ? RAIN_WGSL.vertex : RAIN_WGSL.vertexCovered, RAIN_FRAME_READS),
    fragmentSource: stageReads(FRAGMENT, RAIN_FRAME_READS),
    attributes: ["position", "uv"],
    uniforms: ["viewProjection", "view", ...shaderUniformDecls(own)],
    uniformBlocks: [frame],
    samplers: cover === null ? ["rainStreak"] : ["rainStreak", "rainMap"],
    needAlphaBlending: true,
    blendMode: "alpha",
    depthWrite: false,
    backFaceCulling: false,
  });
  // Nothing of a hidden rain is written, the view's matrices included.
  enableShaderMaterialVisiblePacketUpdates(material);
  // The streak as the game's shell makes it: its smaller levels filtered between, repeating.
  const sprite = createTexture2DFromPixels(engine, rainStreakMap(), RAIN_TEX_W, RAIN_TEX_H, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  setShaderTexture(material, "rainStreak", sprite);
  if (cover !== null) setShaderTexture(material, "rainMap", cover.texture);
  const writeUniforms = shaderUniformWriter(material, own);

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.rain;
  // The whole list goes up with the mesh's first frame, shown or not; a frame after changes only how many are drawn.
  setThinInstances(mesh, instances.data, instances.drips + instances.streaks);
  uploads?.count("instances", instances.data.byteLength);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = 0;

  return {
    mesh,
    material,
    clocks: stageClocks(values),
    reads: (w) => cover !== null && (rainCountUnder(w.rain, tier) > 0 || dripCountUnder(field.canopyWater, tier) > 0),
    get drawn() {
      return field.drawn;
    },
    get dripping() {
      return field.dripping;
    },
    get milk() {
      return field.milk;
    },
    get canopyWater() {
      return field.canopyWater;
    },
    update(w, wind, frame) {
      const any = field.step(frame.eye, frame.yaw, w, wind, frame.dt, frame.lamp, frame.air.farColour, cover === null ? null : cover.centre);
      const count = any ? rainInstancesDrawn(field, instances.drips) : 0;
      if (count !== shown) {
        let visible = false;
        if (count > 0) {
          try {
            setThinInstanceDrawCount(mesh, count);
            visible = true;
          } catch {
            // The list is not up yet: Lite takes a draw count only after, and the mesh stays hidden for that frame.
          }
        }
        if (visible !== (shown > 0)) setMeshVisible(mesh, visible);
        shown = visible ? count : 0;
      }
      if (shown === 0) return;
      rainStageUniforms(field, instances.drips, frame.air, frame.exposure, frame.contrast, values);
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
