/**
 * The motes on Babylon Lite: the pollen by day and the frost by night, every
 * slot of the tier's capacity an instance of one quad that the vertex stage
 * places from its number and the clock (`moteField.ts` says how, and how
 * that keeps the look of the game's two particle systems; `motesParams.ts`
 * gives the hour's and the weather's settings).
 *
 * Lite has particle systems of its own; none is used. They are built from
 * node graphs, stepped on the page a particle at a time and drawn as
 * billboard sprites in the sprite renderer's own colour, a buffer a frame.
 * The motes want the game's colour (the air's through the material colour
 * path a mote at a time, then added to the frame, as Babylon.js draws a
 * particle on the low tier's path) and are placed by the GPU.
 *
 * - **Nothing is kept or sent a frame.** The slots go up once. The clock
 *   and the wind's carry are the frame's block's, with the display curve
 *   (`frameBlock.ts`); the material's own uniforms are the two species'
 *   settings and the colour, written when the hour or the weather moves
 *   them.
 * - **The fragment stage is Babylon.js's particle stage** with no ramp and
 *   no fog (a particle system takes the scene's fog only where it is asked
 *   to, and the game's are not): the sprite times the mote's colour, to
 *   linear, the material colour path (`displayCurve.ts`).
 * - **Added to the frame by its alpha, tested against the depth and never
 *   written to it**, a quad facing the view as a particle's does, at the
 *   motes' place among the see-through draws (`SEE_THROUGH_ORDER`): before
 *   the mist banks, as Babylon.js draws particles before blended meshes.
 *
 * None on a tier with no capacity: the low tier draws no mote.
 */
import {
  addToScene, createPlane, createShaderMaterial, createTexture2DFromPixels, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderTexture,
  setThinInstances,
  type EngineContext, type Mesh, type PluginUniformBlock, type SceneContext, type ShaderMaterial,
} from "@babylonjs/lite";
import type { Rgb } from "@csarkosh/engine/game/colour";
import { MOTE_BOX, MOTE_SALT, emptyMoteUniforms, moteSlots, moteUniforms, motesShown, stepMoteTravel } from "@csarkosh/engine/game/moteField";
import { MOTE_TEX_SIZE, moteDiscMap, motesUnder } from "@csarkosh/engine/game/motesParams";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import type { WindRecord } from "@csarkosh/engine/game/windParams";
import { DISPLAY_CURVE_WGSL, onColourPath } from "@csarkosh/engine/game/lite/displayCurve";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { wgslFloat } from "./forestPlugins.js";
import {
  FRAME_BLOCK, FRAME_CONTRAST_NAME, FRAME_EXPOSURE_NAME, FRAME_PROJECTION_NAME, stageClocks, stageOwn, stageReads, type StageRecord,
} from "./frameBlock.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { shaderUniformDecls, shaderUniformWriter } from "@csarkosh/engine/game/lite/shaderUniforms";
import varyingsSource from "../shaders/motes/varyings.wgsl?raw";
import motesVertexSource from "../shaders/motes/motes.vertex.wgsl?raw";
import motesFragmentSource from "../shaders/motes/motes.fragment.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

const f = wgslFloat;

/** What the two stages hand each other. */
const VARYINGS = wgsl(varyingsSource);

/**
 * The vertex stage: `moteAt`'s steps (`moteField.ts`), then the quad's
 * corner laid out in the view's space as Babylon.js lays a particle's that
 * faces the camera. A slot not shown is put outside the view.
 */
const VERTEX = fill(wgsl(motesVertexSource), { varyings: VARYINGS, moteBox0: f(MOTE_BOX[0]), moteBox1: f(MOTE_BOX[1]), moteBox2: f(MOTE_BOX[2]), moteSaltLife: MOTE_SALT.life, moteSaltPhase: MOTE_SALT.phase, moteSaltX: MOTE_SALT.x, moteSaltY: MOTE_SALT.y, moteSaltZ: MOTE_SALT.z, moteSaltDriftX: MOTE_SALT.driftX, moteSaltDriftY: MOTE_SALT.driftY, moteSaltDriftZ: MOTE_SALT.driftZ, moteSaltSize: MOTE_SALT.size, frameBlock: FRAME_BLOCK, frameProjectionName: FRAME_PROJECTION_NAME });

/** The fragment stage: Babylon.js's particle stage on the material colour path. */
const FRAGMENT = fill(wgsl(motesFragmentSource), { varyings: VARYINGS, displayCurve: DISPLAY_CURVE_WGSL });

/** The stages' text, for the tests that hold it to the game's. */
export const MOTES_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** What the motes read from the frame's block under another name: the display curve. Their clock and the wind's carry
 * are the block's under their own. */
export const MOTES_FRAME_READS = { moteExposure: FRAME_EXPOSURE_NAME, moteContrast: FRAME_CONTRAST_NAME } as const;

/** What a frame draws the motes with, beside the game's own arguments: the render clock and the display curve. */
export type MotesFrame = { seconds: number; exposure: number; contrast: number };

/** The motes as they stand in a scene. */
export type LiteMotes = {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** The clock and the wind's carry as the last update left them, for the frame's block (`stageClocks`). */
  readonly clocks: StageRecord;
  /** The motes under `w` at `hour`, coloured `air`, in `wind`. The emitter's box is
   * round the camera the frame is drawn from. */
  update(w: WeatherParams, hour: number, air: Rgb, wind: WindRecord, frame: MotesFrame): void;
  /** Slots drawn by the last update, both species'. */
  readonly shown: number;
  dispose(): void;
};

/** The tier's motes in `scene`, reading `frame`, the frame's block; none shown until a frame has some; null on a tier
 * that draws none. */
export function createLiteMotes(engine: EngineContext, scene: SceneContext, tier: QualityTier, frame: PluginUniformBlock, uploads?: FrameUploads, linear = false): LiteMotes | null {
  const slots = moteSlots(tier);
  if (slots === null) return null;
  const values = emptyMoteUniforms();
  const own = stageOwn(values, MOTES_FRAME_READS);
  const material = createShaderMaterial({
    name: "motes",
    vertexSource: stageReads(VERTEX, MOTES_FRAME_READS),
    fragmentSource: stageReads(onColourPath(FRAGMENT, linear), MOTES_FRAME_READS),
    attributes: ["position", "uv"],
    // The view and the eye are the scene's own and the projection the frame's block's (`frameBlock.ts`): no system
    // uniform, so nothing is written for a camera that moves.
    uniforms: shaderUniformDecls(own),
    uniformBlocks: [frame],
    samplers: ["moteSprite"],
    needAlphaBlending: true,
    // Faint alone, bright where many overlap in lit air.
    blendMode: "additive",
    depthWrite: false,
    backFaceCulling: false,
  });
  // The soft disc: its smaller levels filtered between, repeating.
  const sprite = createTexture2DFromPixels(engine, moteDiscMap(), MOTE_TEX_SIZE, MOTE_TEX_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipMaps: true,
  });
  setShaderTexture(material, "moteSprite", sprite);
  const writeUniforms = shaderUniformWriter(material, own);

  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.motes;
  setThinInstances(mesh, slots.data, slots.count);
  uploads?.count("instances", slots.data.byteLength);
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);

  const travel = { x: 0, z: 0 };
  let lastSeconds: number | null = null;
  let visible = false;
  let shown = 0;

  return {
    mesh,
    material,
    clocks: stageClocks(values),
    get shown() {
      return shown;
    },
    update(w, hour, air, wind, frame) {
      const record = motesUnder(w, hour, air, tier, wind);
      // The wind's carry is stepped whether or not a mote is shown, as the clock is.
      stepMoteTravel(travel, record.drift, lastSeconds === null ? 0 : frame.seconds - lastSeconds);
      lastSeconds = frame.seconds;
      moteUniforms(record, tier, frame.seconds, travel, frame.exposure, frame.contrast, values);
      const any = motesShown(values);
      shown = any ? Math.round((values.motePollenDrift[2] + values.moteFrostDrift[2]) * slots.count / 2) : 0;
      if (any !== visible) {
        visible = any;
        setMeshVisible(mesh, any);
      }
      if (!any) return;
      if (writeUniforms()) uploads?.marked();
    },
    dispose() {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
