import { clamp01 } from "./colour.js";
import { gustAt, type WindRecord } from "./windParams.js";
import { createStareAudio, MUFFLE_OPEN_HZ, muffleGain, muffleHz, type StareAudio } from "./stareAudio.js";
import type { StareLens } from "./stareLens.js";
import {
  DEFAULT_WEATHER, WEATHER_PRESETS, rainHissCentreHz, rainWindCut, type WeatherParams,
} from "./weather.js";

/** Peak gain for the rain layer, applied on top of the weather's rain value
 * (`ambientGainsUnder`'s `rain`, computed inline here since `setWind`
 * re-applies it ten times a second and that call allocates). */
export const RAIN_LEVEL = 0.5;
/** Peak gain for the wind layer, applied on top of `setWind`'s own
 * speed/mist-scaled gain (`ambientGainsUnder` no longer has a say in it). */
export const WIND_LEVEL = 0.4;
/**
 * The drip layer: under a wet canopy, sparse synthesised plops. Each is a
 * `DRIP_BURST_S` burst of the shared noise through a band-pass centred at
 * random between `DRIP_HZ[0]` and `DRIP_HZ[1]` with Q `DRIP_Q`, its envelope
 * up to `level × DRIP_LEVEL` over `DRIP_ATTACK_S` and down to `DRIP_FLOOR`
 * by the burst's end, where `level` is the canopy's water times the canopy
 * over the listener. The next drip follows after `DRIP_INTERVAL_S[0]` to
 * `DRIP_INTERVAL_S[1]` seconds divided by `0.5 + level`, so a wetter canopy
 * drips faster. Nothing drips below `DRIP_MIN_LEVEL`. `setDrip` schedules
 * every drip that falls within `DRIP_LOOKAHEAD_S` of the context's clock, so
 * a caller on the frame path keeps the train ahead of the audio thread.
 */
export const DRIP_LEVEL = 0.35;
export const DRIP_HZ: readonly [number, number] = [1000, 2000];
export const DRIP_Q = 6;
export const DRIP_ATTACK_S = 0.003;
export const DRIP_BURST_S = 0.025;
/** The burst's source is stopped this long after it starts: past the
 * envelope's floor, so nothing is cut while audible. */
export const DRIP_STOP_S = 0.03;
export const DRIP_FLOOR = 0.001;
export const DRIP_INTERVAL_S: readonly [number, number] = [0.3, 1.5];
export const DRIP_MIN_LEVEL = 0.02;
export const DRIP_LOOKAHEAD_S = 0.2;
/** The shared noise buffer's length, seconds. A drip reads a random stretch of it. */
export const NOISE_S = 2;
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
/** The world bus's own ramp, for a stare's muffling and a hush: short, so silence lands within a breath. */
export const HUSH_RAMP_S = 0.08;
/** The birdsong bed's bus at full song, how far each of its two passes sits to its ear,
 * the seconds one pass's end lies under the next's start (the bed is faded that long at
 * each end), how far ahead a pass is scheduled, and the gain's own short ramp: the level
 * handed in is already eased, and a hush has to land within a breath. */
export const BIRD_LEVEL = 0.5;
export const BIRD_PAN = 0.6;
export const BIRD_OVERLAP_S = 2;
export const BIRD_LOOKAHEAD_S = 1;
export const BIRD_GAIN_RAMP_S = 0.05;
/** The Hollow's call: its bus level at a cue's full level, the metres from the ear it
 * is placed at, and its two voices: the recording an octave down, and a fourth under
 * that a moment later, so no animal the player knows made it. */
export const HOLLOW_CALL_LEVEL = 3;
export const HOLLOW_CALL_STANDOFF_M = 20;
export const HOLLOW_CALL_VOICES: readonly { rate: number; share: number; after: number }[] = [
  { rate: 0.5, share: 1, after: 0 },
  { rate: 0.375, share: 0.6, after: 0.09 },
];
export const DEFAULT_VOLUME = 0.5;

/** A playing one-shot: `move` follows the animal, `stop` cuts it short. */
export type AudioEmitter = {
  move(x: number, y: number, z: number): void;
  stop(): void;
};

/**
 * A synthesized voice for `loopEmitter`: the node its sound leaves by, and
 * `stop`, which ends every source in it and disconnects every node it made.
 * Built by the caller's builder on the context (`insectVoices.ts`).
 */
export type VoiceSource = {
  readonly output: AudioNode;
  stop(): void;
};

/**
 * A playing positional voice that sounds until it is stopped: `move` and
 * `setGain` change it in place, never restarting it, and `stop` ends the
 * voice and disconnects the panner and gain it was given. A stopped one
 * ignores every call.
 */
export type LoopEmitter = {
  move(x: number, y: number, z: number): void;
  setGain(gain: number): void;
  stop(): void;
};

/** `LoopEmitter.setGain` reaches its target within this long: a
 * `setTargetAtTime` whose time constant is a third of it is within 5 % by then. */
export const LOOP_GAIN_RAMP_S = 0.1;

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
  /**
   * Drives the drip layer: `canopyWater` is how wet the canopy is
   * (`canopyWaterStep`, 0 to 1) and `canopyAtListener` the canopy over the
   * listener (`forestDensity`, 0 to 1). Their product is the drip level.
   * Schedules on the context's own clock with a short look-ahead, so call it
   * every frame; inert before `unlock()`.
   */
  setDrip(canopyWater: number, canopyAtListener: number): void;
  /**
   * The forest's birdsong bed, decoded (birdBed.ts): from here it loops, two
   * passes of it half its length apart, one to each ear, each pass's end
   * under the next's start. Silent until `setBirds` raises it.
   */
  setBirdBed(buffer: AudioBuffer): void;
  /**
   * The birdsong's level, 0 to 1 (woodsVoice.ts), every frame: the caller
   * has eased it, so the gain only follows. Also keeps the bed's loop
   * scheduled. Inert before `unlock()`.
   */
  setBirds(level: number): void;
  /**
   * The Hollow's call (woodsVoice.ts): `buffer` an octave down and again a
   * fourth under that, from the direction given (Web Audio's right-handed
   * frame, any length), at `level` through a low-pass at `cutoffHz`. It is
   * placed by direction alone: how far it sounds is the level's and the
   * low-pass's to say. Inert before `unlock()`.
   */
  hollowCall(buffer: AudioBuffer, dx: number, dy: number, dz: number, level: number, cutoffHz: number): void;
  /**
   * Cuts the world's beds and calls by `share`, 0 to 1, within a breath
   * (woodsVoice.ts: the reveal's silence), on top of what a stare takes.
   * The stare's own sounds are left. Inert before `unlock()`.
   */
  setHush(share: number): void;
  /**
   * The local player's stare (stareLens.ts), every frame: the world's beds
   * and calls go muffled and quiet under it, and the heart and the whispers
   * play (stareAudio.ts). Inert before `unlock()`.
   */
  setStare(lens: StareLens): void;
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
  /**
   * Starts a positioned voice that sounds until it is stopped, or null before
   * `unlock()` and after `dispose()`, when `build` is not called. `build` makes
   * the voice's graph on the context; its output goes through the same
   * equal-power panner and inverse distance model as `emitter`'s, then a gain
   * of its own that `setGain` ramps, into the wildlife bus, and so through the
   * world's bus: a stare muffles it and a hush cuts it, as they do the calls.
   * Coordinates are in Web Audio's right-handed frame, as `emitter`'s are.
   * `dispose()` stops every one still playing.
   */
  loopEmitter(
    build: (ctx: BaseAudioContext) => VoiceSource,
    x: number, y: number, z: number,
    gain: number, ref: number, max: number,
  ): LoopEmitter | null;
  /** Places the listener, in Web Audio's right-handed frame. Inert before `unlock()`. */
  setListener(
    x: number, y: number, z: number,
    fx: number, fy: number, fz: number,
    ux: number, uy: number, uz: number,
  ): void;
  dispose(): void;
};

/**
 * Three synthesized ambience layers on gain nodes — not an audio engine. Rain
 * patter is band-passed noise whose centre falls as the rain gets heavier and
 * whose gain the wind cuts; wind is low-passed noise whose cutoff and gain
 * `setWind` drives from the shared wind field (`windParams.ts`), so the bed
 * tracks the same gusts the grass leans under; drips are short bursts of the
 * same noise `setDrip` schedules under a wet canopy. Everything is inert until
 * `unlock()`, and the latest weather/volume set before unlock applies then.
 *
 * `createCtx` is injectable so tests can hand in a fake — node has no
 * AudioContext, the same reason the Babylon shells test under NullEngine.
 * `random` draws the drips' intervals, centres and noise offsets, injectable
 * for the same reason.
 */
export function createAmbientAudio(
  createCtx: () => AudioContext = () => new AudioContext(),
  random: () => number = Math.random,
): AmbientAudio {
  let ctx: AudioContext | null = null;
  let pending: WeatherParams = { ...WEATHER_PRESETS[DEFAULT_WEATHER] };
  let volume = DEFAULT_VOLUME;
  let master: GainNode | null = null;
  /** What the rain, the wind, the drips and the wildlife are mixed through: the stare muffles it, and nothing else. */
  let world: GainNode | null = null;
  let worldFilter: BiquadFilterNode | null = null;
  let stare: StareAudio | null = null;
  /** What the world's bus is cut by, and the stare's level: its gain is the product of what each leaves. */
  let hush = 0;
  let stareLevel = 0;
  let birdGain: GainNode | null = null;
  let birdBed: AudioBuffer | null = null;
  /** Each ear's pan node, and when its next pass of the bed starts on the context's clock. */
  let birdSides: { pan: StereoPannerNode; next: number }[] = [];
  /** The listener, in Web Audio's frame, for the whispers' circles. */
  let earX = 0, earY = 0, earZ = 0;
  let rainGain: GainNode | null = null;
  let rainFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let wildlifeGain: GainNode | null = null;
  let dripGain: GainNode | null = null;
  /** The shared noise, read looping by the rain and wind beds and in bursts by the drips. */
  let noise: AudioBuffer | null = null;
  /** The wind speed of the last applied `setWind`, for the hiss's wind cut. */
  let windSpeed = 0;
  /** Whether a drip train is running, and when its next drip falls on the context's clock. */
  let dripping = false;
  let nextDrip = 0;
  /** Drained and emptied by `unlock`; a registration after that runs immediately. */
  const unlockListeners: (() => void)[] = [];
  /** Listener XZ for the gust sample, in Babylon's world (`setListener`'s mirrored z undone). */
  let listenerX = 0, listenerZ = 0;
  /** The wind record's own clock at the last applied `setWind`, so a fresh
   * context (or dispose/recreate) never throttles the first call. */
  let lastWindTime = -Infinity;
  /** Every loop emitter still playing, so `dispose` can stop them: a loop,
   * unlike a one-shot, never ends on its own. */
  const loops = new Set<LoopEmitter>();

  /** The rain bed's centre and gain for the pending weather and the last
   * wind speed. On `setWind`'s path, so it allocates nothing. */
  function applyGains(w: WeatherParams): void {
    if (!ctx || !rainGain || !rainFilter) return;
    rainFilter.frequency.setTargetAtTime(rainHissCentreHz(w.rain), ctx.currentTime, GAIN_RAMP_S);
    rainGain.gain.setTargetAtTime(clamp01(w.rain) * RAIN_LEVEL * rainWindCut(windSpeed), ctx.currentTime, GAIN_RAMP_S);
  }

  /** Seconds to the next drip at a level: the interval's draw, faster when wetter. */
  function dripInterval(level: number): number {
    const [lo, hi] = DRIP_INTERVAL_S;
    return (lo + (hi - lo) * random()) / (0.5 + level);
  }

  /** One drip at `t` on the context's clock: a burst of the noise through its own band-pass and envelope. */
  function fireDrip(t: number, level: number): void {
    if (!ctx || !dripGain || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = DRIP_HZ[0] + (DRIP_HZ[1] - DRIP_HZ[0]) * random();
    filter.Q.value = DRIP_Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * DRIP_LEVEL, t + DRIP_ATTACK_S);
    g.gain.exponentialRampToValueAtTime(DRIP_FLOOR, t + DRIP_BURST_S);
    src.connect(filter);
    filter.connect(g);
    g.connect(dripGain);
    // Nothing disconnects this chain: a stopped source and everything downstream
    // of it is released once nothing else references it, as the emitters' are.
    src.start(t, random() * (NOISE_S - DRIP_STOP_S));
    src.stop(t + DRIP_STOP_S);
  }

  /**
   * The panner every positioned voice goes through. equalpower, not HRTF:
   * HRTF convolves per source and this can have a dozen calls alive at once.
   * inverse rolloff with an explicit refDistance/maxDistance is what makes a
   * squirrel audible only within its 60 m and an elk bugle carry across the
   * valley.
   */
  function positioned(c: AudioContext, x: number, y: number, z: number, ref: number, max: number): PannerNode {
    const panner = c.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = ref;
    panner.maxDistance = max;
    panner.rolloffFactor = 1;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    return panner;
  }

  return {
    unlock() {
      if (ctx) return;
      ctx = createCtx();

      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      // The world's bus: every bed and call below is mixed into it, and it
      // reaches the master through a low-pass the stare shuts (wired last).
      world = ctx.createGain();
      world.gain.value = 1;

      // One shared noise buffer; two looping readers with different filters,
      // and the drips' bursts.
      noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_S, ctx.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noiseBuffer = noise;
      function noiseSource(): AudioBufferSourceNode {
        const src = ctx!.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        src.start();
        return src;
      }

      // Rain patter: noise -> band-pass -> gain. `applyGains` moves the
      // centre with the rain value (`rainHissCentreHz`) and cuts the gain by
      // the wind (`rainWindCut`). The centre rests where the pending weather
      // puts it, so an unlock under rain does not slide down for two seconds.
      rainFilter = ctx.createBiquadFilter();
      rainFilter.type = "bandpass";
      rainFilter.frequency.value = rainHissCentreHz(pending.rain);
      rainFilter.Q.value = 0.7;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      noiseSource().connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(world);

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
      windGain.connect(world);

      // The wildlife bus. Unlike the three beds above it carries no weather
      // ramp of its own: weather scales each call's own gain as it is emitted
      // (`wildlifePresenceUnder`), per species, which a single shared node
      // cannot do — a raven under dread is louder while everything else is
      // silent.
      wildlifeGain = ctx.createGain();
      wildlifeGain.gain.value = WILDLIFE_LEVEL;
      wildlifeGain.connect(world);

      // The drips' bus: each drip carries its own envelope, so this holds no
      // level of its own; `setDrip` builds the drips into it.
      dripGain = ctx.createGain();
      dripGain.gain.value = 1;
      dripGain.connect(world);
      dripping = false;

      // The birdsong's bus: silent until the bed is in and `setBirds` raises it.
      birdGain = ctx.createGain();
      birdGain.gain.value = 0;
      birdGain.connect(world);
      birdSides = [];
      birdBed = null;

      worldFilter = ctx.createBiquadFilter();
      worldFilter.type = "lowpass";
      worldFilter.frequency.value = MUFFLE_OPEN_HZ;
      world.connect(worldFilter);
      worldFilter.connect(master);
      // The stare's own sounds sit beside the world, not in it: they are not muffled.
      stare = createStareAudio(ctx, master, noise, random);

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
      // The hiss's wind cut reads the same speed; re-applied on the weather
      // fade's own ramp, which this call's throttle keeps to ten a second.
      windSpeed = clamp01(record.speed);
      applyGains(pending);
    },
    setDrip(canopyWater, canopyAtListener) {
      if (!ctx || !dripGain || !noise) return;
      const level = clamp01(canopyWater) * clamp01(canopyAtListener);
      if (level <= DRIP_MIN_LEVEL) {
        dripping = false;
        return;
      }
      const now = ctx.currentTime;
      // A train that starts (or resumes after a stall longer than the
      // look-ahead) waits one interval first, rather than plopping at once.
      if (!dripping || nextDrip < now) {
        dripping = true;
        nextDrip = now + dripInterval(level);
      }
      while (nextDrip < now + DRIP_LOOKAHEAD_S) {
        fireDrip(nextDrip, level);
        nextDrip += dripInterval(level);
      }
    },
    setBirdBed(buffer) {
      if (!ctx || !birdGain || birdSides.length > 0) return;
      birdBed = buffer;
      for (const [i, side] of [-BIRD_PAN, BIRD_PAN].entries()) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = side;
        pan.connect(birdGain);
        // The second ear starts half a bed in, so the two never sing the same bar.
        const at = ctx.currentTime;
        const offset = i * buffer.duration * 0.5;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(pan);
        src.start(at, offset);
        birdSides.push({ pan, next: at + buffer.duration - offset - BIRD_OVERLAP_S });
      }
    },
    setBirds(level) {
      if (!ctx || !birdGain) return;
      birdGain.gain.setTargetAtTime(BIRD_LEVEL * clamp01(level), ctx.currentTime, BIRD_GAIN_RAMP_S);
      if (birdBed === null) return;
      for (const side of birdSides) {
        // A tab left in the background comes back with its passes long over: start from now.
        if (side.next < ctx.currentTime) side.next = ctx.currentTime;
        if (side.next > ctx.currentTime + BIRD_LOOKAHEAD_S) continue;
        const src = ctx.createBufferSource();
        src.buffer = birdBed;
        src.connect(side.pan);
        src.start(side.next);
        side.next += birdBed.duration - BIRD_OVERLAP_S;
      }
    },
    hollowCall(buffer, dx, dy, dz, level, cutoffHz) {
      if (!ctx || !world) return;
      const length = Math.hypot(dx, dy, dz);
      if (!(length > 0) || !(level > 0)) return;
      const at = ctx.currentTime;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoffHz;
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.rolloffFactor = 0;
      panner.positionX.value = earX + (dx / length) * HOLLOW_CALL_STANDOFF_M;
      panner.positionY.value = earY + (dy / length) * HOLLOW_CALL_STANDOFF_M;
      panner.positionZ.value = earZ + (dz / length) * HOLLOW_CALL_STANDOFF_M;
      filter.connect(panner);
      panner.connect(world);
      for (const voice of HOLLOW_CALL_VOICES) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = voice.rate;
        const g = ctx.createGain();
        g.gain.value = HOLLOW_CALL_LEVEL * clamp01(level) * voice.share;
        src.connect(g);
        g.connect(filter);
        src.start(at + voice.after);
      }
    },
    setHush(share) {
      hush = clamp01(share);
      if (!ctx || !world) return;
      world.gain.setTargetAtTime(muffleGain(stareLevel) * (1 - hush), ctx.currentTime, HUSH_RAMP_S);
    },
    setStare(lens) {
      if (!ctx || !world || !worldFilter || !stare) return;
      worldFilter.frequency.setTargetAtTime(muffleHz(lens.level), ctx.currentTime, 0.15);
      stareLevel = lens.level;
      world.gain.setTargetAtTime(muffleGain(stareLevel) * (1 - hush), ctx.currentTime, HUSH_RAMP_S);
      stare.set(lens, earX, earY, earZ);
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
      const panner = positioned(ctx, x, y, z, ref, max);
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
    loopEmitter(build, x, y, z, gain, ref, max) {
      if (!ctx || !wildlifeGain) return null;
      const c = ctx;
      const voice = build(c);
      const panner = positioned(c, x, y, z, ref, max);
      // A gain per loop, as per call: `setGain` moves it while the voice plays.
      const g = c.createGain();
      g.gain.value = gain;
      voice.output.connect(panner);
      panner.connect(g);
      g.connect(wildlifeGain);
      let playing = true;
      const loop: LoopEmitter = {
        move(nx, ny, nz) {
          if (!playing) return;
          panner.positionX.value = nx;
          panner.positionY.value = ny;
          panner.positionZ.value = nz;
        },
        setGain(v) {
          if (!playing) return;
          g.gain.setTargetAtTime(v, c.currentTime, LOOP_GAIN_RAMP_S / 3);
        },
        stop() {
          if (!playing) return;
          playing = false;
          loops.delete(loop);
          // Torn down by hand, unlike a one-shot's chain: the voice may hold
          // sources that loop for ever, and the panner and gain stay wired
          // into the bus until something disconnects them.
          voice.stop();
          voice.output.disconnect();
          panner.disconnect();
          g.disconnect();
        },
      };
      loops.add(loop);
      return loop;
    },
    setListener(x, y, z, fx, fy, fz, ux, uy, uz) {
      if (!ctx) return;
      // Web Audio's frame is right-handed (z mirrored from Babylon's); undo
      // that mirror so `gustAt` samples the gust in the world it was built for.
      listenerX = x;
      listenerZ = -z;
      earX = x;
      earY = y;
      earZ = z;
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
      // Before the context goes: a loop's sources would otherwise play on
      // until the close lands. `stop` takes each out of the set as it goes.
      for (const loop of loops) loop.stop();
      void ctx?.close();
      ctx = null;
      master = world = rainGain = windGain = wildlifeGain = dripGain = birdGain = null;
      birdBed = null;
      birdSides = [];
      rainFilter = windFilter = worldFilter = null;
      stare = null;
      noise = null;
      dripping = false;
      unlockListeners.length = 0;
    },
  };
}
