/**
 * The sea's waves as the water material reads them: the swell's tables as
 * one texture (`oceanTables.ts`), and the values that move each frame on the
 * shared clock, written in place into the binding the sea's water plugin
 * holds (`OceanBinding`): what the shaders read the swell from, the same
 * tables `swellAt` reads on the CPU.
 *
 * The coastline row covers 12,480 m along z; it is written again around the
 * camera, and the texture uploaded, whenever the camera has moved more than
 * `OCEAN_COAST_RECENTRE` along z from where it was last written, so it always
 * reaches past the outermost water ring.
 *
 * Renderer-only; the maths is in the Babylon-free modules it reads.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { QualityTier } from "./quality.js";
import { createOceanFrame } from "./oceanFrame.js";
import type { OceanField } from "./oceanWaves.js";
import { oceanArrayPlaceholder, type OceanBinding, type WaterPlugin } from "./waterPlugin.js";
import { createWindSeaSource, type GpuStarter, type LoopStarter } from "./oceanWindSource.js";

export { OCEAN_NO_TIP, oceanComponentsFor, oceanTipsFor } from "./oceanFrame.js";

export type Ocean = {
  /** The swell the sea draws, the tier's count of its components: what the
   * sea's edge reads its crests and bores from, so it follows the waves the
   * player sees. Its coastline row is the one `update` moves with the camera. */
  readonly field: OceanField;
  /** The swell's tables, RGBA32F, `OCEAN_TABLE_SAMPLES` × `OCEAN_ATLAS_ROWS`, nearest, clamped. */
  atlas: RawTexture;
  /** The wind sea's displacement and slopes, texture 2D arrays. */
  windDisp: BaseTexture;
  windSlope: BaseTexture;
  /** How the wind sea is drawn: 0 low (normals), 1 the loop, 2 the GPU FFT. */
  windMode: 0 | 1 | 2;
  /** Per frame: the camera, the shared seconds, the game's wind (0..1 and the
   * direction it blows toward), the hour (0–24), and whether the sea is drawn
   * (the high tier's FFT is stepped only then; drawn when not said). */
  update(
    camX: number, camZ: number, seconds: number, wind01: number, windDir: [number, number], hour: number, drawn?: boolean,
  ): void;
  /** Points the plugin at this ocean's binding, whose values `update` moves. */
  bind(plugin: WaterPlugin): void;
  dispose(): void;
};

/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. The wind
 * sea is the tier's (`oceanWindSource.ts`): the FFT on high, the loop baked
 * in a worker on medium and wherever the FFT cannot be had, none on low; its
 * textures are the scene's 1×1 array placeholder until a field is ready.
 * `wind` replaces how the fields are started (the tests', under Node).
 * `made` is the world's field for the tier made ahead (`preparedScene.ts`),
 * taken as the ocean's own; absent or null, it is made here.
 */
export function createOcean(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  wind: { startLoop?: LoopStarter; startGpu?: GpuStarter } = {},
  made?: OceanField | null,
): Ocean {
  // What the sea is drawn with, kept and stepped with no engine (`oceanFrame.ts`).
  const frame = createOceanFrame(seed, tier, made);
  const { field } = frame;
  const { tables } = field;
  const atlas = new RawTexture(
    tables.data,
    tables.width,
    tables.rows,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
  atlas.name = "oceanAtlas";
  atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
  atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
  const placeholder = oceanArrayPlaceholder(scene);
  const windSea = createWindSeaSource(scene, seed, tier, wind.startLoop, wind.startGpu);
  // The frame's numbers with the textures beside them: one object, written in place.
  const binding: OceanBinding = Object.assign(frame.numbers, { atlas, windDisp: placeholder, windSlope: placeholder });
  return {
    field,
    atlas,
    // What the binding holds, which follows the wind sea's field as it comes.
    get windDisp() {
      return binding.windDisp;
    },
    get windSlope() {
      return binding.windSlope;
    },
    get windMode() {
      return binding.coast[3] as 0 | 1 | 2;
    },
    update(_camX, camZ, seconds, wind01, windDir, hour, drawn = true) {
      const rowWritten = frame.update(camZ, seconds, wind01, windDir, hour, (blowing) => {
        const sea = windSea.update(blowing, seconds, drawn);
        return { sea, mode: windSea.mode, loopTime: windSea.loopTime, stats: windSea.stats };
      });
      // The whole atlas, 466 KB, once a kilometre at most.
      if (rowWritten) atlas.update(tables.data);
      binding.windDisp = windSea.disp ?? placeholder;
      binding.windSlope = windSea.slope ?? placeholder;
    },
    bind(plugin) {
      plugin.ocean = binding;
    },
    dispose() {
      // The placeholder is the scene's, shared, and goes with the scene.
      atlas.dispose();
      windSea.dispose();
    },
  };
}
