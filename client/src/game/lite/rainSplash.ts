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
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { RainLamp } from "../rainField.js";
import { RAIN_MAP, SPLASH, SPLASH_CYCLES } from "@csarkosh/engine/game/rainParams";
import { emptySplashStageUniforms, splashInstances, splashStageUniforms, splashUniforms, splashesDrawn } from "../splashField.js";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import { DISPLAY_CURVE_WGSL, onColourPath } from "@csarkosh/engine/game/lite/displayCurve";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageClocks, stageOwn, stageReads, type StageRecord } from "./frameBlock.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import type { RainCover } from "./rain.js";
import { shaderUniformDecls, shaderUniformWriter } from "@csarkosh/engine/game/lite/shaderUniforms";
import varyingsSource from "../shaders/rainSplash/varyings.wgsl?raw";
import rainSplashVertexSource from "../shaders/rainSplash/rainSplash.vertex.wgsl?raw";
import rainSplashFragmentSource from "../shaders/rainSplash/rainSplash.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS =
  wgsl(varyingsSource);

/**
 * The vertex stage: the splash plugin's placement (`SPLASH_VERTEX_POSITION`,
 * `rainSplash.ts`), then the Standard material's own, the position taken as
 * the world's (the mesh and every instance stand at the origin) and the
 * fog's distance in the view's space. The map is read at the ring's texel,
 * as the game's sampler reads it: the nearest, at the base level.
 */
const VERTEX = fill(wgsl(rainSplashVertexSource), { varyings: VARYINGS, splashLife: f(SPLASH.life), splashCycles: f(SPLASH_CYCLES), splashRadius: f(SPLASH.radius), rainMapTexels: f(RAIN_MAP.texels), rainMapLast: f(RAIN_MAP.texels - 1), splashSize0: f(SPLASH.size[0]), splashSize1: f(SPLASH.size[1]) });

/**
 * The fragment stage: the Standard material's, with no light, no texture, an
 * emissive colour and the scene's fog (`CalcFogFactor` at `FOGMODE_EXP2`),
 * in Babylon.js's order, and the splash plugin's ring before the colour is
 * written.
 */
const FRAGMENT = fill(wgsl(rainSplashFragmentSource), { varyings: VARYINGS, displayCurve: DISPLAY_CURVE_WGSL });

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
