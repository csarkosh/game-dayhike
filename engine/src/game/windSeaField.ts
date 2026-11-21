/**
 * Which field draws the wind sea, by tier, with no engine (spec §6, §10): on
 * high the compute FFT, on medium, and on high where compute is not to be
 * had or fails, the loop baked in a worker, on low nothing: the sea keeps
 * its ripple bump there. Until a field is ready the mode stays 0 and the sea
 * is the swell alone: the FFT is drawn once it runs, and if it is still
 * compiling after OCEAN_GPU_DEADLINE seconds of frames that draw the sea, the
 * loop is drawn instead. The FFT is stepped only in a frame that draws the
 * sea: each frame's field is evolved from h0 at that frame's time, so a frame
 * skipped costs nothing, and a player out of sight of the sea pays no compute
 * for it.
 *
 * Both fields are made with the wind blowing along +x; the shaders turn them
 * to the wind's direction (`oceanWindFrame`), so the high tier's spectrum is
 * rebuilt only when the wind's speed moves by WIND_SEA_RESPECTRUM_U, never as
 * it turns (it turns a full circle in 20 minutes, which would rebuild the
 * spectrum, about 20 ms on the main thread, every few seconds). The speed the
 * sea follows is its wind's, lagged by OCEAN_SEA_LAG (`lagSeaWind`).
 *
 * The fields' pictures are whatever the renderer that makes them holds them
 * as (`T`): this module hands them on and never reads one.
 */
import type { QualityTier } from "./quality.js";
import { FFT_CASCADES, FFT_N, cascadeBands } from "./oceanSpectrum.js";
import { windSeaBandStats } from "./oceanLoopBake.js";
import { createSeaWindLag, loopTimeAfter, type WindSeaState } from "./oceanWindSea.js";

/** m/s the wind's speed moves before the high tier's spectrum is rebuilt. */
export const WIND_SEA_RESPECTRUM_U = 0.5;
/** s of the shared clock the high tier's FFT may stay compiling, counted over the frames that draw the sea, before
 * the loop is drawn instead. */
export const OCEAN_GPU_DEADLINE = 30;
/** The most seconds one frame counts toward OCEAN_GPU_DEADLINE: a forward jump of the shared seconds (a tab
 * resuming, a client's welcome) is a frame, not the time it skips. */
export const OCEAN_GPU_FRAME_MAX = 0.25;

/** 0: no wind sea drawn (low, or a field not ready yet); 1: the medium loop; 2: the high tier's FFT. */
export type WindSeaMode = 0 | 1 | 2;

/** The loop as a field: its frames' picture and the numbers its bake measured. */
export type WindSeaLoopField<T> = { texture: T; heightStd: number; slopeVar: number };

/** The FFT as a field. */
export type WindSeaFftField<T> = {
  /** (height, dx, dz, Jacobian), a layer a cascade. */
  disp: T;
  /** (slopeX, slopeZ, 0, 0), likewise. */
  slope: T;
  /** Rebuilds h0 for the wind sea's state and uploads it. */
  setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void;
  /** One frame at `seconds` on the shared clock: nothing until every shader has compiled. */
  step(seconds: number): void;
  /** `compiling` until the shaders are ready, `running` once a frame has been dispatched, `failed` if one did not
   * compile or the device refused the first frame. */
  status(): "compiling" | "running" | "failed";
  dispose(): void;
};

/** How a renderer makes the two fields. */
export type WindSeaFieldMakers<T> = {
  /** The loop, baked and made a picture; it never arrives where the bake cannot be had. `signal` aborts when the
   * sea goes before it answers. */
  loop(signal: AbortSignal): Promise<WindSeaLoopField<T>>;
  /** The FFT, null where there is no compute. */
  fft(): Promise<WindSeaFftField<T> | null>;
  /** Lets a loop's picture go. */
  dropLoop(texture: T): void;
};

export type WindSeaField<T> = {
  readonly mode: WindSeaMode;
  /** The field's (height, dx, dz, ·) texture array: the loop's frames, or the FFT's cascades; null in mode 0. */
  readonly disp: T | null;
  /** The FFT's (slopeX, slopeZ) cascades in mode 2, else null. */
  readonly slope: T | null;
  /** `oceanWindStats`: the drawn field's height standard deviation (m) at the sea's wind, fully developed (the
   * shaders take the fetch's share of it near shore), then each field's slope variance (the loop's alone in
   * mode 1, the three cascades' in mode 2). */
  readonly stats: [number, number, number, number];
  /** The loop's time (s), run at the sea's rate and folded into [0, LOOP_SECONDS). */
  readonly loopTime: number;
  /** Per frame, before the scene renders: the wind sea's state for the wind as it blows now, the sea's
   * seconds, and whether the sea is drawn (drawn when not said): the FFT is stepped, and its deadline counted,
   * only then. Returns the sea's own state, the same at the speed the sea follows (`lagSeaWind`), which the
   * fields, the loop's scale and rate and the whitecaps take. */
  update(state: WindSeaState, seconds: number, drawn?: boolean): WindSeaState;
  dispose(): void;
};

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

/** The wind sea's field of world `seed` on `tier`, its pictures made by `makers`. */
export function createWindSeaField<T>(seed: number, tier: QualityTier, makers: WindSeaFieldMakers<T>): WindSeaField<T> {
  let mode: WindSeaMode = 0;
  let disp: T | null = null;
  let slope: T | null = null;
  const stats: [number, number, number, number] = [0, 0, 0, 0];
  let loopTime = 0;
  // The speed the sea follows: the wind's own on the first frame, then lagged behind it (`oceanWindSea.ts`).
  const lag = createSeaWindLag();
  let loop: WindSeaLoopField<T> | null = null;
  let gpu: WindSeaFftField<T> | null = null;
  let gpuU10: number | null = null;
  // The seconds the FFT has spent compiling over frames that drew the sea, each frame's held to
  // OCEAN_GPU_FRAME_MAX: what its deadline is measured by.
  let gpuWaited = 0;
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
    makers.loop(abort.signal)
      .then((made) => {
        if (disposed) {
          makers.dropLoop(made.texture);
          return;
        }
        loop = made;
        if (gpu === null) useLoop();
      })
      .catch(() => undefined);
  }

  // The FFT gone (failed, or still compiling past its deadline): the loop instead.
  function dropGpu(): void {
    gpu?.dispose();
    gpu = null;
    gpuU10 = null;
    gpuWaited = 0;
    useLoop();
    askLoop();
  }

  if (tier === "medium") askLoop();
  if (tier === "high") {
    makers.fft().then((made) => {
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
      gpuWaited = 0;
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
    update(state, seconds, drawn = true) {
      // The shared seconds can step back: the lag's clock holds through the
      // step, so no second is counted twice.
      const sea = lag.step(state, seconds);
      const dt = lag.dt;
      if (gpu !== null && gpu.status() === "failed") dropGpu();
      if (gpu !== null) {
        if (needsRespectrum(gpuU10, sea.u10)) {
          gpu.setSpectrum({ u10: sea.u10, dir: [1, 0] }, seed);
          gpuU10 = sea.u10;
          const s = cascadeStats(sea.u10);
          for (let i = 0; i < 4; i++) stats[i] = s[i] as number;
        }
        // Out of sight the FFT is not stepped: its textures hold the last field
        // it made until the sea is drawn again.
        if (drawn) gpu.step(seconds);
        const status = gpu.status();
        if (status === "running") {
          mode = 2;
          disp = gpu.disp;
          slope = gpu.slope;
          return sea;
        }
        if (drawn) gpuWaited += Math.min(dt, OCEAN_GPU_FRAME_MAX);
        if (status === "compiling" && gpuWaited <= OCEAN_GPU_DEADLINE) return sea;
        dropGpu();
      }
      // The loop's own clock, run at the sea's rate: a fully developed sea's
      // times scale with the wind as its lengths do with its square.
      if (loop !== null) {
        loopTime = loopTimeAfter(loopTime, dt, sea);
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
      if (loop !== null) makers.dropLoop(loop.texture);
      loop = null;
      mode = 0;
      disp = null;
      slope = null;
    },
  };
}
