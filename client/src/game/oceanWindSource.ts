/**
 * The wind sea's field for the sea's material, by tier (spec §6, §10): on high
 * the WebGPU compute FFT (`oceanGpuFft.ts`, imported only on that path), on
 * medium, and on high where compute is not to be had or fails, the loop
 * baked in a worker (`oceanLoop.worker.ts`), on low nothing: the sea keeps
 * PBR's bump there. Until a field is ready the mode stays 0 and the sea is
 * the swell alone: the FFT is drawn once it runs, and if it is still
 * compiling after OCEAN_GPU_DEADLINE seconds of frames that draw the sea, the
 * loop is drawn instead. The FFT is stepped only in a frame that draws the sea:
 * each frame's field is evolved from h0 at that frame's time, so a frame
 * skipped costs nothing, and a player out of sight of the sea pays no compute
 * for it.
 *
 * Both fields are made with the wind blowing along +x; the shaders turn them
 * to the wind's direction (`oceanWindFrame`), so the high tier's spectrum is
 * rebuilt only when the wind's speed moves by WIND_SEA_RESPECTRUM_U, never as
 * it turns (it turns a full circle in 20 minutes, which would rebuild the
 * spectrum, about 20 ms on the main thread, every few seconds). The speed the
 * sea follows is its wind's, lagged by OCEAN_SEA_LAG (`lagSeaWind`).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { GpuWindSea } from "./oceanGpuFft.js";
import type { QualityTier } from "./quality.js";
import { startLoopWorker, type LoopStarter } from "./oceanLoopStart.js";
import { createWindSeaField, type WindSeaField } from "./windSeaField.js";

export { startLoopWorker, type LoopStarter } from "./oceanLoopStart.js";
// Which field is drawn, and when, is kept with no engine (`windSeaField.ts`), and handed on under its names.
export { OCEAN_GPU_DEADLINE, OCEAN_GPU_FRAME_MAX, WIND_SEA_RESPECTRUM_U, cascadeStats, needsRespectrum, type WindSeaMode } from "./windSeaField.js";

/** The wind sea's field as Babylon.js's textures. */
export type WindSeaSource = WindSeaField<BaseTexture>;

/** Makes the high tier's FFT: by default `createGpuWindSea`, imported on that path alone. */
export type GpuStarter = (scene: Scene) => Promise<GpuWindSea | null>;

/** The FFT on the scene's engine, null where the engine has no compute (every engine but WebGPU's). */
export async function startGpuWindSea(scene: Scene): Promise<GpuWindSea | null> {
  const { createGpuWindSea } = await import("./oceanGpuFft.js");
  return createGpuWindSea(scene.getEngine());
}

export function createWindSeaSource(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  startLoop: LoopStarter = startLoopWorker,
  startGpu: GpuStarter = startGpuWindSea,
): WindSeaSource {
  return createWindSeaField<BaseTexture>(seed, tier, {
    // The loop's frames as a texture array, once the worker's bake lands; none made for a sea that has gone.
    loop: (signal) =>
      startLoop(seed, signal).then((reply) => {
        if (signal.aborted) throw new Error("the sea went before its loop landed");
        const texture = new RawTexture2DArray(
          reply.data, reply.n, reply.n, reply.frames, Constants.TEXTUREFORMAT_RGBA, scene,
          false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT,
        );
        texture.name = "oceanWindLoop";
        texture.wrapU = Texture.WRAP_ADDRESSMODE;
        texture.wrapV = Texture.WRAP_ADDRESSMODE;
        return { texture, heightStd: reply.heightStd, slopeVar: reply.slopeVar };
      }),
    fft: () => startGpu(scene),
    dropLoop: (texture) => texture.dispose(),
  });
}
