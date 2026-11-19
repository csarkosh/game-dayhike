/**
 * The rain on Babylon Lite: the streaks and, on the tiers that draw them,
 * the drips under the canopy, every drop an instance of one unit quad that
 * the vertex stage places inside a box locked to the camera, from what the
 * game draws them with (`rainField.ts`: the seeds, what a frame steps, the
 * counts and the uniforms; `rainParams.ts`: the placement's arithmetic).
 *
 * - **One mesh, one stage and one draw for both volumes.** An instance
 *   says whether it is a streak or a drip, the stage takes the
 *   plugin's statements for its kind, and the drips are the list's first
 *   instances, so they are blended before the streaks.
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
  addToScene, createPlane, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, removeFromScene,
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
import { DISPLAY_CURVE_WGSL, onColourPath } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageClocks, stageOwn, stageReads, type StageRecord } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";
import varyingsSource from "../shaders/rain/varyings.wgsl?raw";
import coveredSource from "../shaders/rain/covered.wgsl?raw";
import openSource from "../shaders/rain/open.wgsl?raw";
import rainVertexSource from "../shaders/rain/rain.vertex.wgsl?raw";
import rainFragmentSource from "../shaders/rain/rain.fragment.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS =
  wgsl(varyingsSource);

/**
 * The cover's lines: the plugin's under `RAIN_OCCLUSION` for a map, a drop
 * in the open or a drip never shown without one. The map is read at the
 * drop's texel, as the game's sampler reads it: the nearest, at the base
 * level.
 */
const COVERED = fill(wgsl(coveredSource), { rainMapTexels: f(RAIN_MAP.texels), rainMapLast: f(RAIN_MAP.texels - 1) });
const OPEN = wgsl(openSource);

/**
 * The vertex stage: the streak plugin's placement (`rain.vertexUpdatePosition.glsl`), each
 * line the streaks' or, for an instance that is a drip, the one the plugin
 * has under `RAIN_DRIP`; then the Standard material's own, the position
 * taken as the world's (the mesh and every instance stand at the origin)
 * and the fog's distance in the view's space. A drip past the share shown
 * is put outside the view.
 */
const vertex = (covered: boolean): string => fill(wgsl(rainVertexSource), { varyings: VARYINGS, dripSpeed: f(DRIP.speed), dripWidth: f(DRIP.width), rainStretch: f(RAIN_STRETCH), rainLength0: f(RAIN_LENGTH[0]), rainLength1: f(RAIN_LENGTH[1]), dripLength: f(DRIP.length), rainFadeNear0: f(RAIN_FADE_NEAR[0]), rainFadeNear1: f(RAIN_FADE_NEAR[1]), rainFadeFar0: f(RAIN_FADE_FAR[0]), rainFadeFar1: f(RAIN_FADE_FAR[1]), rainSkyFade: f(RAIN_SKY_FADE), rainSkyRamp: f(RAIN_SKY_RAMP), cover: covered ? COVERED : OPEN });

/**
 * The fragment stage: the Standard material's, with no light, an emissive
 * colour, a diffuse texture whose alpha is the material's and the scene's
 * fog (`CalcFogFactor` at `FOGMODE_EXP2`), in Babylon.js's order, and the
 * streak plugin's two lines before the colour is written.
 */
const FRAGMENT = fill(wgsl(rainFragmentSource), { varyings: VARYINGS, displayCurve: DISPLAY_CURVE_WGSL });

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
  /** The rain under `w` in `wind`. */
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
  engine: EngineContext, scene: SceneContext, tier: QualityTier, cover: RainCover | null, frame: PluginUniformBlock, uploads?: FrameUploads, linear = false,
): LiteRain {
  const field = createRainField(tier);
  const instances = rainInstances(tier);
  const values = emptyRainStageUniforms();
  const own = stageOwn(values, RAIN_FRAME_READS);
  const material = createShaderMaterial({
    name: "rain",
    vertexSource: stageReads(cover === null ? RAIN_WGSL.vertex : RAIN_WGSL.vertexCovered, RAIN_FRAME_READS),
    fragmentSource: stageReads(onColourPath(FRAGMENT, linear), RAIN_FRAME_READS),
    attributes: ["position", "uv"],
    // The view is the scene's own (`frameBlock.ts`): no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    samplers: cover === null ? ["rainStreak"] : ["rainStreak", "rainMap"],
    needAlphaBlending: true,
    blendMode: "alpha",
    depthWrite: false,
    backFaceCulling: false,
  });
  // The streak: its smaller levels filtered between, repeating.
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
