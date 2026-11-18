/**
 * The splashes on Babylon Lite: short-lived crown rings where the rain
 * lands, on the cover map's surface in a disc round the eye, every ring an
 * instance of one unit quad that the vertex stage places from its seed and
 * the clock, from what the game draws them with (`splashField.ts`: the
 * seeds, how many a frame draws and the uniforms; `rainParams.ts`: the
 * constants).
 *
 * - **The stage is Babylon.js's Standard material as the game sets it for
 *   the splashes**, statement for statement, with the splash plugin's code
 *   at its two points (`rainSplash.ts`): unlit, the rain's colour its
 *   emissive, no texture, the scene's distance fog mixed in before the
 *   colour is taken to linear, then the material colour path
 *   (`displayCurve.ts`); and after it the plugin's ring, drawn from the
 *   quad's own coordinates, on the alpha.
 * - **A ring is its instance's matrix**, which is no matrix: its seed in
 *   the first four floats (`splashInstances`). The list goes up once, when
 *   the mesh is made; a frame changes only how many are drawn.
 * - **The clock is the frame's block's** (`frameBlock.ts`), with the eye,
 *   the scene's fog and the display curve. The material's own uniforms are
 *   written once in a frame that moves one (the lamp, the sun, the rain,
 *   the map's centre); a frame with no rain draws nothing and writes
 *   nothing for them.
 * - **Blended over what is behind them, tested against the depth and never
 *   written to it**, before the drips and the streaks, as the game draws
 *   them (`SEE_THROUGH_ORDER`).
 *
 * None on a tier without a cover map to land them on.
 */
import {
  addToScene, createPlane, createShaderMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderTexture,
  setThinInstanceDrawCount, setThinInstances,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import type { AtmosphereRecord } from "../atmosphereParams.js";
import type { QualityTier } from "../quality.js";
import type { RainLamp } from "../rainField.js";
import { RAIN_MAP, SPLASH, SPLASH_CYCLES } from "../rainParams.js";
import { emptySplashStageUniforms, splashInstances, splashStageUniforms, splashUniforms, splashesDrawn } from "../splashField.js";
import type { WeatherParams } from "../weather.js";
import { DISPLAY_CURVE_WGSL, onColourPath } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageClocks, stageOwn, stageReads, type StageRecord } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import type { RainCover } from "./rain.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS =
  "struct SplashOut{@builtin(position)position:vec4<f32>,@location(0)fogDistance:vec3<f32>,@location(1)splashAlpha:f32,@location(2)splashPhase:f32,@location(3)splashUv:vec2<f32>}";

/**
 * The vertex stage: the splash plugin's placement (`SPLASH_VERTEX_POSITION`,
 * `rainSplash.ts`), then the Standard material's own, the position taken as
 * the world's (the mesh and every instance stand at the origin) and the
 * fog's distance in the view's space. The map is read at the ring's texel,
 * as the game's sampler reads it: the nearest, at the base level.
 */
const VERTEX = /* wgsl */ `
${VARYINGS}
fn splashHash(p:vec2<f32>)->vec2<f32>{
  var p3=fract(vec3<f32>(p.xyx)*vec3<f32>(0.1031,0.1030,0.0973));
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
@vertex fn mainVertex(input:VertexInput)->SplashOut{
  var out:SplashOut;
  let u=shaderUniforms;
  let splashSeed=input.world0;
  let sT=u.splashTime/${f(SPLASH.life)}+splashSeed.x;
  let sCycle=floor(sT)-${f(SPLASH_CYCLES)}*floor(floor(sT)/${f(SPLASH_CYCLES)});
  let sPhase=fract(sT);
  let sH=splashHash(splashSeed.yz+sCycle);
  let sR=${f(SPLASH.radius)}*sqrt(sH.x);
  let sA=6.2831853*sH.y;
  let sXZ=u.splashCam.xz+vec2<f32>(cos(sA),sin(sA))*sR;
  let sMu=(sXZ-u.splashMapCentre)/u.splashMapExtent+0.5;
  let sMap=textureLoad(splashMap,vec2<i32>(clamp(sMu*${f(RAIN_MAP.texels)},vec2<f32>(0.0),vec2<f32>(${f(RAIN_MAP.texels - 1)}))),0);
  let sIn=step(0.0,sMu.x)*step(sMu.x,1.0)*step(0.0,sMu.y)*step(sMu.y,1.0);
  let sp=vec3<f32>(sXZ.x,sMap.r,sXZ.y);
  let sToCam=u.splashCam-sp;
  let sDist=max(length(sToCam),0.001);
  let sView=sToCam/sDist;
  let sSide=cross(vec3<f32>(0.0,1.0,0.0),sView);
  let sRight=sSide/max(length(sSide),0.001);
  let sUp=cross(sView,sRight);
  let sSize=mix(${f(SPLASH.size[0])},${f(SPLASH.size[1])},splashSeed.w)*(0.5+sPhase)*sIn;
  let positionUpdated=sp+(sRight*input.position.x+sUp*input.position.y)*sSize;
  let sSunT=max(dot(sView,u.splashSun),0.0);
  let sToLamp=sp-u.splashLampPos;
  let sLampD2=dot(sToLamp,sToLamp);
  let sCos=dot(sToLamp,u.splashLampDir)/sqrt(max(sLampD2,0.0001));
  let sCone=smoothstep(u.splashLamp.y,0.5+0.5*u.splashLamp.y,sCos);
  let sLampT=u.splashLamp.x*sCone/(1.0+sLampD2);
  let sBack=min(sSunT+sLampT,1.0);
  out.splashAlpha=(1.0-sPhase)*u.splashRain*(0.5+0.5*sBack)*sIn;
  out.splashPhase=sPhase;
  out.splashUv=input.position.xy+0.5;
  let worldPos=vec4<f32>(positionUpdated,1.0);
  out.position=scene.viewProjection*worldPos;
  out.fogDistance=(scene.view*worldPos).xyz;
  return out;
}`;

/**
 * The fragment stage: the Standard material's, with no light, no texture, an
 * emissive colour and the scene's fog (`CalcFogFactor` at `FOGMODE_EXP2`),
 * in Babylon.js's order, and the splash plugin's ring before the colour is
 * written.
 */
const FRAGMENT = /* wgsl */ `
${VARYINGS}
${DISPLAY_CURVE_WGSL}
const SPLASH_E:f32=2.71828;
fn splashFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(SPLASH_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:SplashOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let alpha=1.0;
  let emissiveColor=u.splashEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=splashFogFactor(input.fogDistance,u.splashFogDensity);
  color=vec4<f32>(mix(u.splashFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.splashExposure,u.splashContrast),color.a);
  let sD=length(input.splashUv-0.5)*2.0;
  let sRing=1.0-smoothstep(0.0,0.15,abs(sD-(0.3+0.7*input.splashPhase)));
  color.a*=sRing*input.splashAlpha;
  return color;
}`;

/** The stages' text, for the tests that hold it to the game's. */
export const SPLASH_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** What the splashes read from the frame's block under another name: the eye, the scene's fog and the display curve.
 * Their clock is the block's under its own. */
export const SPLASH_FRAME_READS = {
  splashCam: "fadeEye", splashFogColour: "atmFarColour", splashFogDensity: "atmBaseDensity", splashExposure: FRAME_EXPOSURE_NAME,
  splashContrast: FRAME_CONTRAST_NAME,
} as const;

/** What a frame draws the splashes with beside the weather: the eye, the clock, the headlamp, the way the sun's light
 * travels, the rain's colour, the scene's fog and the display curve. */
export type SplashFrame = {
  eye: { readonly x: number; readonly y: number; readonly z: number };
  seconds: number;
  lamp: RainLamp;
  sunTravel: { readonly x: number; readonly y: number; readonly z: number };
  /** The rain's colour (`rainMilk`). */
  milk: readonly [number, number, number];
  air: AtmosphereRecord;
  exposure: number;
  contrast: number;
};

/** The splashes as they stand in a scene. */
export type LiteRainSplash = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The splashes' clock as the last update that drew a ring left it, for the frame's block (`stageClocks`). */
  readonly clocks: StageRecord;
  /** The rings under `w`. */
  update(w: WeatherParams, frame: SplashFrame): void;
  /** Rings drawn by the last update. */
  readonly shown: number;
  dispose(): void;
};

/** The tier's splashes in `scene` on the map `cover`, reading `frame`, the frame's block; hidden until a frame draws a
 * ring; null on a tier that draws none. */
export function createLiteRainSplash(
  engine: EngineContext, scene: SceneContext, tier: QualityTier, cover: RainCover, frame: PluginUniformBlock, uploads?: FrameUploads, linear = false,
): LiteRainSplash | null {
  const instances = splashInstances(tier);
  if (instances.count === 0) return null;
  const values = emptySplashStageUniforms();
  const own = stageOwn(values, SPLASH_FRAME_READS);
  const material = createShaderMaterial({
    name: "rainSplash",
    vertexSource: stageReads(VERTEX, SPLASH_FRAME_READS),
    fragmentSource: stageReads(onColourPath(FRAGMENT, linear), SPLASH_FRAME_READS),
    attributes: ["position"],
    // The view is the scene's own (`frameBlock.ts`): no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    samplers: ["splashMap"],
    needAlphaBlending: true,
    blendMode: "alpha",
    depthWrite: false,
    backFaceCulling: false,
  });
  setShaderTexture(material, "splashMap", cover.texture);
  const writeUniforms = shaderUniformWriter(material, own);

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.splashes;
  // The whole list goes up with the mesh's first frame, shown or not; a frame after changes only how many are drawn.
  setThinInstances(mesh, instances.data, instances.count);
  uploads?.count("instances", instances.data.byteLength);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  let shown = 0;

  return {
    mesh,
    material,
    clocks: stageClocks(values),
    get shown() {
      return shown;
    },
    update(w, frame) {
      const count = splashesDrawn(w, tier, true);
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
      splashUniforms(frame.eye, w, frame.lamp, frame.sunTravel, frame.seconds, cover.centre, values);
      splashStageUniforms(frame.milk, frame.air, frame.exposure, frame.contrast, values);
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
