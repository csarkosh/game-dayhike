import { clamp01 } from "./colour.js";
import { gustAt, type WindRecord } from "./windParams.js";
import {
  ambientGainsUnder, DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherParams,
} from "./weather.js";

/** Peak gain for the rain layer, applied on top of `ambientGainsUnder`. */
export const RAIN_LEVEL = 0.5;
/** Peak gain for the wind layer, applied on top of `setWind`'s own
 * speed/mist-scaled gain (`ambientGainsUnder` no longer has a say in it). */
export const WIND_LEVEL = 0.4;
/**
 * `setWind` knobs: the low-pass cutoff at zero gust and zero mist, how much a
 * gust darkens it further, how much mist deepens the base cutoff, the gain
 * floor at zero wind speed (so the bed is never silent), how much mist
 * quiets it, and the throttle on the shared wind field's own clock.
 */
export const WIND_CUTOFF_BASE = 400;
export const WIND_CUTOFF_GUST = 250;
export const WIND_MIST_DEEPEN = 0.5;
export const WIND_GAIN_FLOOR = 0.35;
export const WIND_MIST_QUIET = 0.3;
export const WIND_AUDIO_INTERVAL_S = 0.1;
/**
 * How much of the bed's loudness the gust swings: the gain scales by
 * `1 − depth … 1 + depth` from a trough to a crest, so a front passing is
 * heard as a swell, not only as the cutoff opening. The RAW gust drives it
 * (the shader's amplitude scales with speed, this does not), so the bed
 * breathes on a clear day too — it always plays, at a varying intensity.
 */
export const WIND_GAIN_DEPTH = 0.5;
/** The gain's own ramp: fast enough that a gust's swell survives, unlike the
 * 2 s `GAIN_RAMP_S` the weather fades use, which would smooth it away. */
export const WIND_GAIN_RAMP_S = 0.4;

/**
 * The wind bed's gain for a wind speed (0–1), a mist amount (0–1) and the raw
 * gust at the listener (`gustAt`, in [−1.5, 1.5]): the floor plus speed,
 * quieter under mist, swung by the gust. Pure, so the tests pin it exactly.
 */
export function windBedGain(speed: number, mist: number, gust: number): number {
  const gust01 = clamp01(0.5 + gust / 3);
  return WIND_LEVEL * (WIND_GAIN_FLOOR + (1 - WIND_GAIN_FLOOR) * clamp01(speed))
    * (1 - WIND_MIST_QUIET * clamp01(mist))
    * (1 - WIND_GAIN_DEPTH + 2 * WIND_GAIN_DEPTH * gust01);
}
/**
 * The bus every spatialized wildlife call is mixed through. One level
 * for the whole species chorus, sitting under the master volume, so a call that
 * is close and loud still cannot drown the synthesized weather beds above.
 */
export const WILDLIFE_LEVEL = 0.7;
/** setTargetAtTime time constant — slow enough that weather fades are audible. */
export const GAIN_RAMP_S = 2;
export const DEFAULT_VOLUME = 0.5;

/** A playing one-shot: `move` follows the animal, `stop` cuts it short. */
export type AudioEmitter = {
  move(x: number, y: number, z: number): void;
  stop(): void;
};

/**
 * Where the listener is and which way it faces, in BABYLON's left-handed world
 * — the frame `renderer.listener()` reads the camera in. `wildlifeAudio.ts`
 * mirrors it into Web Audio's right-handed one; nothing else may.
 */
export type ListenerPose = {
  x: number; y: number; z: number;
  fx: number; fy: number; fz: number;
  ux: number; uy: number; uz: number;
};

export type AmbientAudio = {
  /** Builds the graph. Call from a user gesture — browsers gate AudioContext on one. */
  unlock(): void;
  /**
   * Runs `fn` once the context exists — immediately if `unlock()` already ran,
   * otherwise at unlock. Anything that has to TOUCH the context to make progress
   * needs this signal: `decode` before unlock can only answer null, and without
   * a way to learn when that changes its caller either polls every frame or
   * gives up on the clip forever. Fires once per registration.
   */
  onUnlock(fn: () => void): void;
  setWeather(w: WeatherParams): void;
  /**
   * Moves the wind bed's low-pass cutoff and gain to one moment of the
   * shared wind field: a stronger gust at the listener darkens the cutoff
   * and raises the gain, mist deepens the cutoff and quiets the gain.
   * Throttled to `WIND_AUDIO_INTERVAL_S` by the record's own clock (which
   * wraps at `WIND_TIME_WRAP`), so callers may call this every frame.
   */
  setWind(record: WindRecord): void;
  setVolume(v: number): void;
  /**
   * Decodes compressed clip bytes on the ambient context. Resolves null rather
   * than rejecting: before `unlock()` there is no context to decode on, and a
   * clip the browser refuses is silence, not a crash.
   */
  decode(bytes: ArrayBuffer): Promise<AudioBuffer | null>;
  /**
   * Starts one positioned one-shot, or null before `unlock()`. Coordinates are
   * in Web Audio's RIGHT-handed frame — the caller mirrors Babylon's z, see
   * `ListenerPose`.
   */
  emitter(
    buffer: AudioBuffer,
    x: number, y: number, z: number,
    gain: number, ref: number, max: number,
  ): AudioEmitter | null;
  /** Places the listener, in Web Audio's right-handed frame. Inert before `unlock()`. */
  setListener(
    x: number, y: number, z: number,
    fx: number, fy: number, fz: number,
    ux: number, uy: number, uz: number,
  ): void;
  dispose(): void;
};

/**
 * Two synthesized ambience layers on gain nodes — not an audio engine. Rain
 * patter is band-passed noise; wind is low-passed noise whose cutoff and gain
 * `setWind` drives from the shared wind field (`windParams.ts`), so the bed
 * tracks the same gusts the grass leans under. Everything is inert until
 * `unlock()`, and the latest weather/volume set before unlock applies then.
 *
 * `createCtx` is injectable so tests can hand in a fake — node has no
 * AudioContext, the same reason the Babylon shells test under NullEngine.
 */
export function createAmbientAudio(
  createCtx: () => AudioContext = () => new AudioContext(),
): AmbientAudio {
  let ctx: AudioContext | null = null;
  let pending: WeatherParams = { ...WEATHER_PRESETS[DEFAULT_WEATHER] };
  let volume = DEFAULT_VOLUME;
  let master: GainNode | null = null;
  let rainGain: GainNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let wildlifeGain: GainNode | null = null;
  /** Drained and emptied by `unlock`; a registration after that runs immediately. */
  const unlockListeners: (() => void)[] = [];
  /** Listener XZ for the gust sample, in Babylon's world (`setListener`'s mirrored z undone). */
  let listenerX = 0, listenerZ = 0;
  /** The wind record's own clock at the last applied `setWind`, so a fresh
   * context (or dispose/recreate) never throttles the first call. */
  let lastWindTime = -Infinity;

  function applyGains(w: WeatherParams): void {
    if (!ctx || !rainGain) return;
    const g = ambientGainsUnder(w);
    rainGain.gain.setTargetAtTime(g.rain * RAIN_LEVEL, ctx.currentTime, GAIN_RAMP_S);
  }

  return {
    unlock() {
      if (ctx) return;
      ctx = createCtx();

      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);

      // One shared 2 s noise buffer; two looping readers with different filters.
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      function noiseSource(): AudioBufferSourceNode {
        const src = ctx!.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        src.start();
        return src;
      }

      // Rain patter: noise -> band-pass ~3 kHz -> gain.
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = "bandpass";
      rainFilter.frequency.value = 3000;
      rainFilter.Q.value = 0.7;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      noiseSource().connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(master);

      // Wind: noise -> low-pass. `setWind` drives the cutoff and this gain
      // from the shared wind field; the floor below keeps it audible — a
      // quiet steady bed rather than silence — before the first call.
      windFilter = ctx.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = WIND_CUTOFF_BASE;
      windGain = ctx.createGain();
      windGain.gain.value = WIND_LEVEL * WIND_GAIN_FLOOR;
      noiseSource().connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);

      // The wildlife bus. Unlike the three beds above it carries no weather
      // ramp of its own: weather scales each call's own gain as it is emitted
      // (`wildlifePresenceUnder`), per species, which a single shared node
      // cannot do — a raven under dread is louder while everything else is
      // silent.
      wildlifeGain = ctx.createGain();
      wildlifeGain.gain.value = WILDLIFE_LEVEL;
      wildlifeGain.connect(master);

      applyGains(pending);

      // Last, so a listener sees a context with its full graph already built.
      // Emptied afterwards to drop the references, not to guard against a second
      // unlock — the `if (ctx) return` above already makes this run once.
      for (const fn of unlockListeners) fn();
      unlockListeners.length = 0;
    },
    onUnlock(fn) {
      if (ctx) fn();
      else unlockListeners.push(fn);
    },
    setWeather(w) {
      pending = { ...w };
      applyGains(pending);
    },
    setWind(record) {
      if (!ctx || !windGain || !windFilter) return;
      // Throttled on the record's own clock, not wall time, so tests can
      // drive it — and so a caller re-sending a stale record never re-ramps.
      // `record.time` wraps at `WIND_TIME_WRAP`; a wrap reads as time going
      // backward, which this lets straight through rather than stalling.
      if (record.time - lastWindTime < WIND_AUDIO_INTERVAL_S && record.time >= lastWindTime) return;
      lastWindTime = record.time;
      const mist = clamp01(pending.mist);
      const gust = gustAt(record, listenerX, listenerZ);
      const cutoff = WIND_CUTOFF_BASE * (1 - WIND_MIST_DEEPEN * mist) + WIND_CUTOFF_GUST * gust;
      windFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.15);
      windGain.gain.setTargetAtTime(windBedGain(record.speed, mist, gust), ctx.currentTime, WIND_GAIN_RAMP_S);
    },
    setVolume(v) {
      volume = clamp01(v);
      if (ctx && master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    },
    decode(bytes) {
      if (!ctx) return Promise.resolve(null);
      return ctx.decodeAudioData(bytes).catch(() => null);
    },
    emitter(buffer, x, y, z, gain, ref, max) {
      if (!ctx || !wildlifeGain) return null;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // equalpower, not HRTF: HRTF convolves per source and this can have a
      // dozen calls alive at once. inverse rolloff with an explicit
      // refDistance/maxDistance is what makes a squirrel audible only within
      // its 60 m and an elk bugle carry across the valley.
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = ref;
      panner.maxDistance = max;
      panner.rolloffFactor = 1;
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
      // A gain per call, not one shared node: this is where weather and species
      // presence land, and they differ between two calls playing at once.
      //
      // Nothing disconnects this chain, deliberately: Web Audio's dynamic
      // lifetime releases a source and everything downstream of it once the
      // source has ended and nothing else references it, which is exactly a
      // finished one-shot. Nor is the number of concurrent voices capped, but
      // the schedule is NOT what bounds them: call intervals are set per UNIT,
      // and the 400 m collect disc holds many units of many species at once —
      // in practice that measured 26 calls a minute at a raven roost and 77 in
      // the elk meadow. What bounds the voice count is `wildlifeAudio.play`'s
      // distance gate, which drops a call whose distance to the listener is past
      // its own maxDistance (two-thirds of that 77 were) before it ever reaches
      // here — and "past its max" is not "silent": the inverse model floors at
      // refDistance/maxDistance, 10/300 ≈ −30 dB, held all the way out, which is
      // why those voices were audible clutter rather than free. A limiter at this
      // node would only ever fire on a bug in that gate.
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(panner);
      panner.connect(g);
      g.connect(wildlifeGain);
      src.start();
      return {
        move(nx, ny, nz) {
          panner.positionX.value = nx;
          panner.positionY.value = ny;
          panner.positionZ.value = nz;
        },
        stop() {
          try {
            src.stop();
          } catch {
            /* already ended — a one-shot that ran out is not an error */
          }
        },
      };
    },
    setListener(x, y, z, fx, fy, fz, ux, uy, uz) {
      if (!ctx) return;
      // Web Audio's frame is right-handed (z mirrored from Babylon's); undo
      // that mirror so `gustAt` samples the gust in the world it was built for.
      listenerX = x;
      listenerZ = -z;
      const l = ctx.listener;
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    },
    dispose() {
      void ctx?.close();
      ctx = null;
      master = rainGain = windGain = wildlifeGain = null;
      windFilter = null;
      unlockListeners.length = 0;
    },
  };
}
