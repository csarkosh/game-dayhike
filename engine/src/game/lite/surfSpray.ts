/**
 * The surf's spray on Babylon Lite: a short burst of soft sprites at each
 * plunge on the cove's face, on the tier that draws them, every sprite an
 * instance of one unit quad that the vertex stage places from its seed and
 * its burst's record, from what the game draws them with (`sprayField.ts`:
 * the seeds, the slots and their ages, the wind's velocity, the colour and
 * the rule that throws a burst).
 *
 * - **The stage is Babylon.js's Standard material as the game sets it for
 *   the spray**, with the spray plugin's code at its points
 *   (`surfSpray.vertex.glsl`, `surfSpray.fragment.glsl`, statement for
 *   statement): unlit, the foam's white under the sun and the fill its
 *   emissive, the scene's distance fog mixed in before the colour is taken
 *   to linear, then the tier's colour path (`displayCurve.ts`); and after
 *   it the plugin's soft disc on the alpha.
 * - **A sprite is its instance's matrix**, which is no matrix: its seed in
 *   the first four floats and its slot in the fifth (`sprayInstances`). The
 *   list goes up once.
 * - **The slots are the material's own uniforms**, a name a vec4, written
 *   once in a frame with a burst alive (its ages move then); the eye, the
 *   scene's fog and the display curve are the frame's block's.
 * - **Hidden with no burst alive**: no draw, and nothing written.
 * - **Blended over what is behind it, tested against the depth and never
 *   written to it**, after the sea, its curl and the lakes, as the game
 *   draws it after its water (`SEE_THROUGH_ORDER`).
 */
import {
  addToScene, createPlane, createShaderMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setThinInstances,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import {
  SURF_SPRAY_BURSTS, SURF_SPRAY_DRAG, SURF_SPRAY_ELEVATION, SURF_SPRAY_G, SURF_SPRAY_LIFE_S, SURF_SPRAY_OPACITY, SURF_SPRAY_SIZE_M, SURF_SPRAY_SPEED_MIN,
  SURF_SPRAY_STRETCH_M, createSprayBursts, emptySprayUniforms, sprayBurstName, sprayColour, sprayInstances, sprayUniforms, sprayWind,
  type SprayLight, type SprayThrown,
} from "../sprayField.js";
import type { WindRecord } from "../windParams.js";
import { DISPLAY_CURVE_WGSL, onColourPath } from "./displayCurve.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { wgslFloat } from "./forestPlugins.js";
import { FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, stageOwn, stageReads } from "./frameBlock.js";
import type { FrameUploads } from "./frameUploads.js";
import { shaderUniformDecls, shaderUniformWriter } from "./shaderUniforms.js";
import varyingsSource from "../shaders/surfSpray/varyings.wgsl?raw";
import surfSprayVertexSource from "../shaders/surfSpray/surfSpray.vertex.wgsl?raw";
import surfSprayFragmentSource from "../shaders/surfSpray/surfSpray.fragment.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS =
  wgsl(varyingsSource);

/** The slots' vec4s as the stage's one array, from the uniforms that hold them. */
const SLOTS = Array.from({ length: SURF_SPRAY_BURSTS * 2 }, (_, i) => `u.${sprayBurstName(i)}`).join(",");

/**
 * The vertex stage: the spray plugin's placement (`sprayPlace` and
 * `SPRAY_VERTEX_POSITION`, `surfSpray.ts`), then the Standard material's
 * own, the position taken as the world's (the mesh and every instance stand
 * at the origin) and the fog's distance in the view's space.
 */
const VERTEX = fill(wgsl(surfSprayVertexSource), { varyings: VARYINGS, surfSprayG: f(SURF_SPRAY_G), surfSprayDrag: f(SURF_SPRAY_DRAG), surfSprayLifeS0: f(SURF_SPRAY_LIFE_S[0]), surfSprayLifeS1: f(SURF_SPRAY_LIFE_S[1]), surfSpraySizeM: f(SURF_SPRAY_SIZE_M), surfSprayStretchM: f(SURF_SPRAY_STRETCH_M), surfSprayElevation0: f(SURF_SPRAY_ELEVATION[0]), surfSprayElevation1: f(SURF_SPRAY_ELEVATION[1]), surfSpraySpeedMin: f(SURF_SPRAY_SPEED_MIN), burstSlots: SURF_SPRAY_BURSTS * 2, slots: SLOTS });

/**
 * The fragment stage: the Standard material's, with no light, no texture, an
 * emissive colour and the scene's fog (`CalcFogFactor` at `FOGMODE_EXP2`),
 * in Babylon.js's order, and the spray plugin's disc (`sprayCover`) before
 * the colour is written.
 */
const FRAGMENT = fill(wgsl(surfSprayFragmentSource), { varyings: VARYINGS, displayCurve: DISPLAY_CURVE_WGSL, surfSprayOpacity: f(SURF_SPRAY_OPACITY) });

/** The stages' text, for the tests that hold it to the game's. */
export const SPRAY_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** What the spray reads from the frame's block under another name: the eye, the scene's fog and the display curve. */
export const SPRAY_FRAME_READS = {
  sprayCam: "fadeEye", sprayFogColour: "atmFarColour", sprayFogDensity: "atmBaseDensity", sprayExposure: FRAME_EXPOSURE_NAME, sprayContrast: FRAME_CONTRAST_NAME,
} as const;

/** The spray as it stands in a scene. */
export type LiteSurfSpray = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Throws a burst (`SprayBursts.burst`). */
  readonly burst: SprayThrown;
  /** A frame: each slot's age at the shared `seconds`, the wind and the lights; drawn only while a slot is alive. */
  update(seconds: number, wind: WindRecord, lights: readonly SprayLight[]): void;
  /** Whether the last update drew the spray. */
  readonly shown: boolean;
  dispose(): void;
};

/** The spray in `scene`, reading `frame`, the frame's block; hidden until a burst is alive. `linear` on a tier with a post chain. */
export function createLiteSurfSpray(engine: EngineContext, scene: SceneContext, frame: PluginUniformBlock, uploads?: FrameUploads, linear = false): LiteSurfSpray {
  const values = emptySprayUniforms();
  const own = stageOwn(values, SPRAY_FRAME_READS);
  const material = createShaderMaterial({
    name: "surfSpray",
    vertexSource: stageReads(VERTEX, SPRAY_FRAME_READS),
    fragmentSource: stageReads(onColourPath(FRAGMENT, linear), SPRAY_FRAME_READS),
    attributes: ["position"],
    // The view is the scene's own (`frameBlock.ts`): no system uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    needAlphaBlending: true,
    blendMode: "alpha",
    depthWrite: false,
    backFaceCulling: false,
  });
  const writeUniforms = shaderUniformWriter(material, own);

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.spray;
  const instances = sprayInstances();
  setThinInstances(mesh, instances.data, instances.count);
  uploads?.count("instances", instances.data.byteLength);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  const bursts = createSprayBursts();
  const windNow: [number, number] = [0, 0];
  const colour: [number, number, number] = [0, 0, 0];
  let shown = false;

  return {
    mesh,
    material,
    burst: bursts.burst,
    get shown() {
      return shown;
    },
    update(seconds, wind, lights) {
      const alive = bursts.age(seconds);
      if (alive !== shown) {
        shown = alive;
        setMeshVisible(mesh, alive);
      }
      if (!alive) return;
      sprayUniforms(bursts.data, sprayWind(wind, windNow), sprayColour(lights, colour), values);
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
