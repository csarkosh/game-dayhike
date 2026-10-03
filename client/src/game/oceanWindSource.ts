/**
 * The wind sea's field for the sea's material, by tier (spec §6, §10): on high
 * the WebGPU compute FFT (`oceanGpuFft.ts`, imported only on that path), on
 * medium, and on high where compute is not to be had or fails, the loop
 * baked in a worker (`oceanLoop.worker.ts`), on low nothing: the sea keeps
 * PBR's bump there. Until a field is ready the mode stays 0 and the sea is
 * the swell alone: the FFT is drawn once it runs, and if it is still
 * compiling OCEAN_GPU_DEADLINE seconds on, the loop is drawn instead.
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
import { FFT_CASCADES, FFT_N, LOOP_SECONDS, cascadeBands } from "./oceanSpectrum.js";
import { windSeaBandStats, type LoopReply, type LoopRequest } from "./oceanLoopBake.js";
import { lagSeaWind, windSeaAtSpeed, type WindSeaState } from "./oceanWindSea.js";

/** m/s the wind's speed moves before the high tier's spectrum is rebuilt. */
export const WIND_SEA_RESPECTRUM_U = 0.5;
/** s of the shared clock the high tier's FFT may stay compiling before the loop is drawn instead. */
export const OCEAN_GPU_DEADLINE = 30;

/** 0: no wind sea drawn (low, or a field not ready yet); 1: the medium loop; 2: the high tier's FFT. */
export type WindSeaMode = 0 | 1 | 2;

export type WindSeaSource = {
  readonly mode: WindSeaMode;
  /** The field's (height, dx, dz, ·) texture array: the loop's frames, or the FFT's cascades; null in mode 0. */
  readonly disp: BaseTexture | null;
  /** The FFT's (slopeX, slopeZ) cascades in mode 2, else null. */
  readonly slope: BaseTexture | null;
  /** `oceanWindStats`: the drawn field's height standard deviation (m) at the sea's wind, fully developed (the
   * shaders take the fetch's share of it near shore), then each field's slope variance (the loop's alone in
   * mode 1, the three cascades' in mode 2). */
  readonly stats: [number, number, number, number];
  /** The loop's time (s), run at the sea's rate and folded into [0, LOOP_SECONDS). */
  readonly loopTime: number;
  /** Per frame, before the scene renders: the wind sea's state for the wind as it blows now, and the sea's
   * seconds. Returns the sea's own state, the same at the speed the sea follows (`lagSeaWind`), which the
   * fields, the loop's scale and rate and the whitecaps take. */
  update(state: WindSeaState, seconds: number): WindSeaState;
  dispose(): void;
};

/** Bakes the loop for a seed: by default in the worker, which `signal` ends when the sea is disposed. */
export type LoopStarter = (seed: number, signal: AbortSignal) => Promise<LoopReply>;
/** Makes the high tier's FFT: by default `createGpuWindSea`, imported on that path alone. */
export type GpuStarter = (scene: Scene) => Promise<GpuWindSea | null>;

/**
 * The loop baked in the module worker. Rejects where there is no Worker (Node), where one cannot be made, on
 * a worker's error or a reply it cannot read, and when `signal` aborts first. The worker is ended whatever
 * happens: on its reply, on an error, and on the abort.
 */
export function startLoopWorker(seed: number, signal?: AbortSignal): Promise<LoopReply> {
  return new Promise<LoopReply>((resolve, reject) => {
    if (typeof Worker === "undefined") throw new Error("no Worker to bake the wind sea's loop in");
    if (signal?.aborted === true) throw new Error("the wind sea's loop is no longer wanted");
    const worker = new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" });
    const end = (): void => {
      worker.terminate();
      signal?.removeEventListener("abort", abandon);
    };
    function abandon(): void {
      end();
      reject(new Error("the wind sea's loop is no longer wanted"));
    }
    signal?.addEventListener("abort", abandon);
    worker.onmessage = (event: MessageEvent<LoopReply>): void => {
      end();
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      end();
      reject(new Error(event.message));
    };
    worker.onmessageerror = (): void => {
      end();
      reject(new Error("the wind sea's loop arrived unreadable"));
    };
    const request: LoopRequest = { seed };
    worker.postMessage(request);
  });
}

/** The FFT on the scene's engine, null where the engine has no compute (every engine but WebGPU's). */
export async function startGpuWindSea(scene: Scene): Promise<GpuWindSea | null> {
  const { createGpuWindSea } = await import("./oceanGpuFft.js");
  return createGpuWindSea(scene.getEngine());
}

/** Whether the FFT's spectrum must be rebuilt for a wind of `u10`: the first time, or the speed moved by
 * WIND_SEA_RESPECTRUM_U or more since the last build at `lastU10`. */
export function needsRespectrum(lastU10: number | null, u10: number): boolean {
  return lastU10 === null || Math.abs(u10 - lastU10) >= WIND_SEA_RESPECTRUM_U;
}

/** The FFT's stats at a wind: the three cascades' summed height variance, as a standard deviation, and each
 * cascade's slope variance, over the bands `windSeaH0` fills. */
export function cascadeStats(u10: number): [number, number, number, number] {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  let heightVar = 0;
  bands.forEach((band, i) => {
    const s = windSeaBandStats(u10, band);
    heightVar += s.heightVar;
    out[i + 1] = s.slopeVar;
  });
  out[0] = Math.sqrt(heightVar);
  return out;
}

function fold(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

export function createWindSeaSource(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  startLoop: LoopStarter = startLoopWorker,
  startGpu: GpuStarter = startGpuWindSea,
): WindSeaSource {
  let mode: WindSeaMode = 0;
  let disp: BaseTexture | null = null;
  let slope: BaseTexture | null = null;
  const stats: [number, number, number, number] = [0, 0, 0, 0];
  let loopTime = 0;
  let lastSeconds: number | null = null;
  // The speed the sea follows (m/s): the wind's own on the first frame, then lagged behind it.
  let seaU10: number | null = null;
  let loop: { texture: RawTexture2DArray; heightStd: number; slopeVar: number } | null = null;
  let gpu: GpuWindSea | null = null;
  let gpuU10: number | null = null;
  // The latest seconds counted when the FFT came (or on the first frame after): its deadline runs from there.
  let gpuSince: number | null = null;
  let loopAsked = false;
  let disposed = false;
  // Ends the loop's worker when the sea goes before it answers.
  const abort = new AbortController();

  function useLoop(): void {
    mode = loop === null ? 0 : 1;
    disp = loop?.texture ?? null;
    slope = null;
  }

  // The loop, once: on medium at once, on high when the FFT cannot be had.
  // Without a worker (Node), or if the bake or its upload fails, it never
  // arrives and the sea keeps its swell.
  function askLoop(): void {
    if (loopAsked) return;
    loopAsked = true;
    startLoop(seed, abort.signal)
      .then((reply) => {
        if (disposed) return;
        const texture = new RawTexture2DArray(
          reply.data, reply.n, reply.n, reply.frames, Constants.TEXTUREFORMAT_RGBA, scene,
          false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT,
        );
        texture.name = "oceanWindLoop";
        texture.wrapU = Texture.WRAP_ADDRESSMODE;
        texture.wrapV = Texture.WRAP_ADDRESSMODE;
        loop = { texture, heightStd: reply.heightStd, slopeVar: reply.slopeVar };
        if (gpu === null) useLoop();
      })
      .catch(() => undefined);
  }

  // The FFT gone (failed, or still compiling past its deadline): the loop instead.
  function dropGpu(): void {
    gpu?.dispose();
    gpu = null;
    gpuU10 = null;
    gpuSince = null;
    useLoop();
    askLoop();
  }

  if (tier === "medium") askLoop();
  if (tier === "high") {
    startGpu(scene).then((made) => {
      if (disposed) {
        made?.dispose();
        return;
      }
      if (made === null) {
        askLoop();
        return;
      }
      // Drawn once it runs (`update`): until then its textures hold a flat sea.
      gpu = made;
      gpuSince = lastSeconds;
    }, () => {
      if (!disposed) askLoop();
    });
  }

  return {
    get mode() {
      return mode;
    },
    get disp() {
      return disp;
    },
    get slope() {
      return slope;
    },
    get stats() {
      return stats;
    },
    get loopTime() {
      return loopTime;
    },
    update(state, seconds) {
      // The shared seconds step back a few ticks when a client's tick is
      // reconciled to the host's: the clocks here hold through the step and
      // run on only once the seconds pass the latest counted, so no second is
      // counted twice.
      const dt = lastSeconds === null ? 0 : Math.max(0, seconds - lastSeconds);
      const now = lastSeconds === null ? seconds : Math.max(lastSeconds, seconds);
      lastSeconds = now;
      seaU10 = seaU10 === null ? state.u10 : lagSeaWind(seaU10, state.u10, dt);
      const sea = windSeaAtSpeed(state, seaU10);
      if (gpu !== null && gpu.status() === "failed") dropGpu();
      if (gpu !== null) {
        gpuSince ??= now;
        if (needsRespectrum(gpuU10, sea.u10)) {
          gpu.setSpectrum({ u10: sea.u10, dir: [1, 0] }, seed);
          gpuU10 = sea.u10;
          const s = cascadeStats(sea.u10);
          for (let i = 0; i < 4; i++) stats[i] = s[i] as number;
        }
        gpu.step(seconds);
        const status = gpu.status();
        if (status === "running") {
          mode = 2;
          disp = gpu.disp;
          slope = gpu.slope;
          return sea;
        }
        if (status === "compiling" && now - gpuSince <= OCEAN_GPU_DEADLINE) return sea;
        dropGpu();
      }
      // The loop's own clock, run at the sea's rate: a fully developed sea's
      // times scale with the wind as its lengths do with its square.
      if (loop !== null) {
        loopTime = fold(loopTime + dt * sea.loopRate, LOOP_SECONDS);
        stats[0] = loop.heightStd * sea.loopScale;
        stats[1] = loop.slopeVar;
        stats[2] = 0;
        stats[3] = 0;
      }
      return sea;
    },
    dispose() {
      disposed = true;
      abort.abort();
      gpu?.dispose();
      gpu = null;
      loop?.texture.dispose();
      loop = null;
      mode = 0;
      disp = null;
      slope = null;
    },
  };
}
