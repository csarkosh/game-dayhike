/**
 * The water life's sound on the ambient context's loop emitters: the midge
 * swarms' hum, the dragonflies' wings and the chorus frogs' calls. What
 * sounds where is decided elsewhere and arrives each frame as a
 * `WaterLifeSound`; this shell holds the voices, caps them and mirrors
 * Babylon's world into Web Audio's.
 *
 * - Hums: the `HUM_MAX` nearest swarms within `HUM_RANGE` that have midges
 *   and presence keep a loop emitter each, kept by swarm (its index in
 *   `hums`) from frame to frame and moved, re-gained and re-pitched in place.
 *   A hum begins silent and is raised to its gain through the emitter's
 *   ramp, so a swarm forming over the ear never starts at full gain.
 *   A swarm that drops out fades over `HUM_FADE_S`, is sent a gain of nothing
 *   and is stopped once the emitter's gain has followed (`LOOP_GAIN_RAMP_S`
 *   on), so the cut falls on silence; until it stops it still counts against
 *   the cap.
 * - Frog calls and rustles: each a voice on a loop emitter that ends itself;
 *   at most `FROG_VOICES_MAX` and `RUSTLE_MAX` sounding, the nearest of a
 *   frame's new ones taking the free slots, none beyond its range. A slot
 *   frees, and its emitter is stopped, once its voice has run its length.
 * - A frog voice calls a recording: one of `FROG_CALL_CLIPS`, and a playback
 *   rate within `FROG_RATE`, each picked once a voice by a hash of its index,
 *   so every voice keeps its own call and pitch. Until that clip is decoded
 *   (before the unlock, or for good if it failed to load) the voice calls the
 *   synthesized call (`frogCallVoice`) instead.
 * - The far chorus: the frogs farther out than the voices, `FROG_BED_CLIPS`
 *   looping at the bed's two places over the water, each from a random point
 *   in its seamless stretch (`FROG_BED_LOOP_S`), gained by the bed's level.
 *   A loop starts once its clip is decoded and its level is above nothing,
 *   none beyond `FROG_RANGE`; when its level reaches nothing it is sent a
 *   gain of nothing, and it stops after `FROG_BED_HOLD_S` of it.
 *
 * The clips are fetched at once and decoded once the context exists, as
 * `birdBed.ts` does its bed; a clip that fails is absent, and warned of once.
 *
 * Positions arrive in Babylon's left-handed frame and go to Web Audio with z
 * negated, as `wildlifeAudio.ts` sends its calls (`app.ts` places the
 * listener every frame through `listenerToAudio`). Nothing happens before the
 * context is unlocked, and nothing is queued: a frame's frog calls are that
 * frame's alone, so the first frame after unlock plays none from before it.
 */
import { hash3 } from "../sim/field.js";
import { LOOP_GAIN_RAMP_S, type AmbientAudio, type LoopEmitter, type VoiceSource } from "./ambientAudio.js";
import { audioUrl } from "./assetUrls.js";
import type { FrogCall } from "./frogChorus.js";
import {
  FROG_CALL_S, FROG_CARRIER_HZ, RUSTLE_LOUD_S, RUSTLE_S, frogCallVoice, humVoice, rustleVoice,
} from "./insectVoices.js";

export const HUM_MAX = 8, FROG_VOICES_MAX = 12, RUSTLE_MAX = 2;
export const HUM_REF = 0.5, HUM_RANGE = 10, FROG_REF = 3, FROG_RANGE = 120, RUSTLE_REF = 0.3, RUSTLE_RANGE = 3;
/** A dropped hum's gain falls linearly to nothing over this long; it stops `LOOP_GAIN_RAMP_S` later. */
export const HUM_FADE_S = 0.5;
/** A hum's gain is `presence · sqrt(midges / HUM_MIDGES_UNIT)`. */
export const HUM_MIDGES_UNIT = 200;
/** A rustle's wingbeat is drawn between these, Hz: the skimmers' and the darners'. */
export const RUSTLE_WING_HZ: readonly [number, number] = [30, 36];
/** A one-shot's slot frees this long after its voice's own length, so its tail is never cut. */
export const SHOT_MARGIN_S = 0.1;
/** The chorus frog's recorded calls, the catalog's `audio` ids: a voice calls one of them. */
export const FROG_CALL_CLIPS: readonly string[] = ["call.frog_single_a", "call.frog_single_b", "call.frog_single_c"];
/** A voice's playback rate lies between these: its own pitch. */
export const FROG_RATE: readonly [number, number] = [0.94, 1.06];
/** The hash salts of a voice's clip and rate: the frogs' own (`frogChorus.ts` holds 80 and 81). */
const SALT_CLIP = 82, SALT_RATE = 83;
/** The far chorus's recordings, at the bed's first place and its second: a dense chorus and a soft, distant one. */
export const FROG_BED_CLIPS: readonly string[] = ["call.frog_chorus_near", "call.frog_chorus_far"];
/** The chorus recordings' seamless stretch, s: they loop within it, never to the files' own ends. */
export const FROG_BED_LOOP_S: readonly [number, number] = [0.5, 10.5];
/** A chorus loop keeps its gain to this distance and falls as `FROG_BED_REF / d` beyond. */
export const FROG_BED_REF = 30;
/**
 * Each chorus loop's gain at a level of 1, the near recording's and the far
 * one's: the chorus carried across the water at a level a player hears from
 * the shore, under the nearer voices' calls but never lost beneath the
 * ambience.
 */
export const FROG_BED_GAIN: readonly [number, number] = [0.5, 0.35];
/** A chorus loop whose level has been nothing this long stops. */
export const FROG_BED_HOLD_S = 2;
/** Changes smaller than these are not sent, so a steady hum adds no automation event a frame. */
const GAIN_STEP = 0.005, PITCH_STEP = 0.5;

export type WaterLifeSound = {
  /** The swarms by row, the first `hums_n` valid; a row's index is its swarm's identity. */
  hums: { x: number; y: number; z: number; midges: number; presence: number }[];
  hums_n: number;
  /** The hum's pitch, Hz. */
  pitch: number;
  /** This frame's dragonfly rustles. */
  rustles: readonly { x: number; y: number; z: number; loud: boolean }[];
  /** This frame's frog calls. */
  frogCalls: readonly FrogCall[];
  /** The far chorus: its level, 0 to 1, and its two places, one a `FROG_BED_CLIPS` loop in order. */
  bed: {
    level: number;
    points: readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
  };
};

export type WaterLifeAudio = {
  /** One frame of the water life's sound, heard from `listener` (Babylon's frame). */
  update(s: WaterLifeSound, listener: { x: number; y: number; z: number }): void;
  dispose(): void;
};

export type WaterLifeAudioOptions = {
  /** Injected by the tests; production fetches the hashed URL Vite serves. */
  fetchClip?: (id: string) => Promise<ArrayBuffer>;
};

type Point = { x: number; y: number; z: number };
type Hum = VoiceSource & { setPitch(hz: number): void };
type HumSlot = {
  emitter: LoopEmitter | null;
  voice: Hum | null;
  readonly build: (ctx: BaseAudioContext) => VoiceSource;
  gain: number;
  pitch: number;
  fading: boolean;
  fadeFrom: number;
  fadeGain: number;
  /** The fade is over and the gain of nothing sent: the voice stops at `stopAt`. */
  draining: boolean;
  stopAt: number;
  /** The frame this swarm was last among the nearest. */
  chosen: number;
};
type BedLoop = {
  emitter: LoopEmitter | null;
  readonly build: (ctx: BaseAudioContext) => VoiceSource;
  gain: number;
  /** When its level fell to nothing, while it still sounds; −1 while above. */
  silentFrom: number;
};
type ShotSlot = {
  emitter: LoopEmitter | null;
  endsAt: number;
  hz: number;
  loud: boolean;
  /** A frog's recording and its rate, or null for the synthesized call. */
  clip: AudioBuffer | null;
  rate: number;
  readonly build: (ctx: BaseAudioContext) => VoiceSource;
};

function lerp(range: readonly [number, number], u: number): number {
  return range[0] + (range[1] - range[0]) * u;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * `buffer` played at `rate` from `offset` seconds in: once, ending itself, or
 * with `loop` round that stretch of it until it is stopped.
 */
function clipVoice(
  ctx: BaseAudioContext, buffer: AudioBuffer, rate: number, offset: number,
  loop: readonly [number, number] | null,
): VoiceSource {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  if (loop !== null) {
    src.loop = true;
    src.loopStart = loop[0];
    src.loopEnd = loop[1];
  }
  src.start(0, offset);
  return {
    output: src,
    stop() {
      try {
        src.stop();
      } catch {
        /* already ended: a call that ran its length is not an error */
      }
      src.disconnect();
    },
  };
}

/** Stops the one-shots that have run their length. */
function release(slots: readonly ShotSlot[], t: number): void {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.emitter !== null && t >= slot.endsAt) {
      slot.emitter.stop();
      slot.emitter = null;
    }
  }
}

/**
 * `random` draws the voices' variations and each frog voice's carrier;
 * `now` is the clock, in seconds, the hums' fades and the one-shots' lengths
 * are measured on; `options.fetchClip` fetches a clip's bytes. All are
 * injectable for the tests.
 */
export function createWaterLifeAudio(
  ambient: Pick<AmbientAudio, "loopEmitter" | "onUnlock" | "decode">,
  random: () => number = Math.random,
  now: () => number = () => performance.now() / 1000,
  options: WaterLifeAudioOptions = {},
): WaterLifeAudio {
  let unlocked = false;
  let disposed = false;
  let frame = 0;
  let liveHums = 0;
  const humSlots: (HumSlot | undefined)[] = [];
  const chosenIdx = new Int32Array(HUM_MAX);
  const chosenDist = new Float64Array(HUM_MAX);
  const taken = new Int32Array(Math.max(FROG_VOICES_MAX, RUSTLE_MAX));
  /** Each frog voice's carrier, drawn on its first call and kept. */
  const carriers: number[] = [];

  function shotSlot(voice: (ctx: BaseAudioContext, slot: ShotSlot) => VoiceSource): ShotSlot {
    const slot: ShotSlot = { emitter: null, endsAt: 0, hz: 0, loud: false, clip: null, rate: 1, build: (c) => voice(c, slot) };
    return slot;
  }
  const frogSlots: ShotSlot[] = [];
  for (let i = 0; i < FROG_VOICES_MAX; i++) {
    frogSlots.push(shotSlot((c, slot) => (slot.clip !== null ? clipVoice(c, slot.clip, slot.rate, 0, null) : frogCallVoice(c, slot.hz, random))));
  }
  const rustleSlots: ShotSlot[] = [];
  for (let i = 0; i < RUSTLE_MAX; i++) rustleSlots.push(shotSlot((c, slot) => rustleVoice(c, slot.hz, slot.loud, random)));
  /** `FROG_CALL_CLIPS` and `FROG_BED_CLIPS` decoded, by index; a hole until (or unless) its clip is in. */
  const callClips: (AudioBuffer | undefined)[] = [];
  const bedClips: (AudioBuffer | undefined)[] = [];
  const bedLoops: BedLoop[] = [];
  for (let k = 0; k < FROG_BED_CLIPS.length; k++) {
    // Built only once its clip is in, from a random point in its stretch.
    const offset = (): number => lerp(FROG_BED_LOOP_S, random());
    bedLoops.push({ emitter: null, gain: 0, silentFrom: -1, build: (c) => clipVoice(c, bedClips[k]!, 1, offset(), FROG_BED_LOOP_S) });
  }

  ambient.onUnlock(() => {
    unlocked = true;
  });

  const fetchClip = options.fetchClip ?? (async (id: string) => {
    const response = await fetch(audioUrl(`audio/${id}.mp3`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  /** Fetches clip `id` now and decodes it once the context exists, into `into[k]`. */
  function load(id: string, into: (AudioBuffer | undefined)[], k: number): void {
    const warn = (reason: string): void => console.warn(`water life clip "${id}" will not play: ${reason}`);
    fetchClip(id).then(
      (bytes) => {
        if (disposed) return;
        ambient.onUnlock(() => {
          void ambient.decode(bytes).then((buffer) => {
            if (disposed) return;
            if (buffer === null) warn("the browser could not decode it");
            else into[k] = buffer;
          });
        });
      },
      (e: unknown) => {
        if (!disposed) warn(e instanceof Error ? e.message : String(e));
      },
    );
  }
  for (let k = 0; k < FROG_CALL_CLIPS.length; k++) load(FROG_CALL_CLIPS[k]!, callClips, k);
  for (let k = 0; k < FROG_BED_CLIPS.length; k++) load(FROG_BED_CLIPS[k]!, bedClips, k);

  /** Swarm `k`'s slot, made the first time the swarm is heard. */
  function humSlot(k: number): HumSlot {
    let slot = humSlots[k];
    if (slot === undefined) {
      const made: HumSlot = {
        emitter: null, voice: null, gain: 0, pitch: 0, fading: false, fadeFrom: 0, fadeGain: 0, draining: false, stopAt: 0, chosen: -1,
        build: (c) => {
          const v = humVoice(c, made.pitch, random);
          made.voice = v;
          return v;
        },
      };
      humSlots[k] = made;
      slot = made;
    }
    return slot;
  }

  function setGain(slot: HumSlot, gain: number): void {
    if (Math.abs(gain - slot.gain) < GAIN_STEP) return;
    slot.gain = gain;
    slot.emitter?.setGain(gain);
  }

  function carrierOf(voice: number): number {
    let hz = carriers[voice];
    if (hz === undefined) {
      hz = lerp(FROG_CARRIER_HZ, random());
      carriers[voice] = hz;
    }
    return hz;
  }

  /** The index of the nearest of `events` within `range` not yet taken this frame, or −1. */
  function nearest(events: readonly Point[], listener: Point, range: number, takenN: number): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < events.length; i++) {
      let seen = false;
      for (let k = 0; k < takenN; k++) {
        if (taken[k] === i) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      const d = distance(events[i]!, listener);
      if (d <= range && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function hums(s: WaterLifeSound, listener: Point, t: number): void {
    // The nearest audible swarms, sorted, in fixed arrays.
    let chosenN = 0;
    for (let k = 0; k < s.hums_n; k++) {
      const h = s.hums[k]!;
      if (h.presence <= 0 || h.midges <= 0) continue;
      const d = distance(h, listener);
      // Written as "not within" so a swarm whose place is not a number is never heard.
      if (!(d <= HUM_RANGE)) continue;
      if (chosenN === HUM_MAX && d >= chosenDist[HUM_MAX - 1]!) continue;
      let at = chosenN < HUM_MAX ? chosenN : HUM_MAX - 1;
      while (at > 0 && chosenDist[at - 1]! > d) {
        chosenIdx[at] = chosenIdx[at - 1]!;
        chosenDist[at] = chosenDist[at - 1]!;
        at--;
      }
      chosenIdx[at] = k;
      chosenDist[at] = d;
      if (chosenN < HUM_MAX) chosenN++;
    }
    for (let m = 0; m < chosenN; m++) humSlot(chosenIdx[m]!).chosen = frame;

    // The dropped fade, are sent a gain of nothing and stop once it has
    // followed: the cap frees as they end. One chosen again before it stops
    // is the same voice, gained again.
    for (let k = 0; k < humSlots.length; k++) {
      const slot = humSlots[k];
      if (slot === undefined || slot.emitter === null) continue;
      if (slot.chosen === frame) {
        slot.fading = false;
        slot.draining = false;
        continue;
      }
      if (!slot.fading) {
        slot.fading = true;
        slot.fadeFrom = t;
        slot.fadeGain = slot.gain;
      }
      if (slot.draining) {
        if (t >= slot.stopAt) {
          slot.emitter.stop();
          slot.emitter = null;
          slot.voice = null;
          slot.fading = false;
          slot.draining = false;
          liveHums--;
        }
        continue;
      }
      const left = 1 - (t - slot.fadeFrom) / HUM_FADE_S;
      if (left > 0) {
        setGain(slot, slot.fadeGain * left);
        continue;
      }
      // Sent outright: a change under `GAIN_STEP` would be held back, and the
      // emitter's gain follows its target over `LOOP_GAIN_RAMP_S`, so the voice
      // is cut only after that.
      slot.gain = 0;
      slot.emitter.setGain(0);
      slot.draining = true;
      slot.stopAt = t + LOOP_GAIN_RAMP_S;
    }

    // The chosen: moved, re-gained and re-pitched in place, or started while the cap allows.
    for (let m = 0; m < chosenN; m++) {
      const k = chosenIdx[m]!;
      const h = s.hums[k]!;
      const slot = humSlots[k]!;
      const gain = h.presence * Math.sqrt(h.midges / HUM_MIDGES_UNIT);
      if (slot.emitter === null) {
        if (liveHums >= HUM_MAX) continue;
        slot.pitch = s.pitch;
        // Made silent and raised through the emitter's ramp, as a chorus
        // loop is: begun at its gain it would sound at once at full strength.
        slot.emitter = ambient.loopEmitter(slot.build, h.x, h.y, -h.z, 0, HUM_REF, HUM_RANGE);
        if (slot.emitter === null) continue;
        slot.gain = 0;
        setGain(slot, gain);
        liveHums++;
        continue;
      }
      slot.emitter.move(h.x, h.y, -h.z);
      setGain(slot, gain);
      if (Math.abs(s.pitch - slot.pitch) >= PITCH_STEP) {
        slot.pitch = s.pitch;
        slot.voice?.setPitch(s.pitch);
      }
    }
  }

  function frogs(calls: readonly FrogCall[], listener: Point, t: number): void {
    release(frogSlots, t);
    let takenN = 0;
    for (let k = 0; k < frogSlots.length; k++) {
      const slot = frogSlots[k]!;
      if (slot.emitter !== null) continue;
      const i = nearest(calls, listener, FROG_RANGE, takenN);
      if (i < 0) break;
      taken[takenN++] = i;
      const call = calls[i]!;
      const clip = callClips[Math.floor(hash3(call.voice, 0, SALT_CLIP, 0) * FROG_CALL_CLIPS.length)];
      if (clip !== undefined) {
        slot.clip = clip;
        slot.rate = lerp(FROG_RATE, hash3(call.voice, 0, SALT_RATE, 0));
      } else {
        slot.clip = null;
        slot.hz = carrierOf(call.voice);
      }
      slot.emitter = ambient.loopEmitter(slot.build, call.x, call.y, -call.z, call.gain, FROG_REF, FROG_RANGE);
      slot.endsAt = t + (slot.clip !== null ? slot.clip.duration / slot.rate : FROG_CALL_S) + SHOT_MARGIN_S;
    }
  }

  function rustles(events: WaterLifeSound["rustles"], listener: Point, t: number): void {
    release(rustleSlots, t);
    let takenN = 0;
    for (let k = 0; k < rustleSlots.length; k++) {
      const slot = rustleSlots[k]!;
      if (slot.emitter !== null) continue;
      const i = nearest(events, listener, RUSTLE_RANGE, takenN);
      if (i < 0) break;
      taken[takenN++] = i;
      const e = events[i]!;
      slot.hz = lerp(RUSTLE_WING_HZ, random());
      slot.loud = e.loud;
      slot.emitter = ambient.loopEmitter(slot.build, e.x, e.y, -e.z, 1, RUSTLE_REF, RUSTLE_RANGE);
      slot.endsAt = t + (e.loud ? RUSTLE_LOUD_S : RUSTLE_S) + SHOT_MARGIN_S;
    }
  }

  function bed(b: WaterLifeSound["bed"], listener: Point, t: number): void {
    for (let k = 0; k < bedLoops.length; k++) {
      const loop = bedLoops[k]!;
      const p = b.points[k]!;
      // Written as "within" and "above" so a place or a level that is not a number is silence.
      const gain = distance(p, listener) <= FROG_RANGE && b.level > 0 ? b.level * FROG_BED_GAIN[k]! : 0;
      if (loop.emitter === null) {
        if (gain <= 0 || bedClips[k] === undefined) continue;
        // Made silent and raised through the emitter's ramp: a loop entered
        // mid-stretch at its full gain would click.
        loop.emitter = ambient.loopEmitter(loop.build, p.x, p.y, -p.z, 0, FROG_BED_REF, FROG_RANGE);
        if (loop.emitter === null) continue;
        loop.emitter.setGain(gain);
        loop.gain = gain;
        loop.silentFrom = -1;
        continue;
      }
      if (gain > 0) {
        loop.silentFrom = -1;
        if (Math.abs(gain - loop.gain) >= GAIN_STEP) {
          loop.gain = gain;
          loop.emitter.setGain(gain);
        }
        continue;
      }
      // Silence is sent outright, as a dropped hum's is; the loop stops once it has held.
      if (loop.silentFrom < 0) {
        loop.silentFrom = t;
        loop.gain = 0;
        loop.emitter.setGain(0);
      } else if (t - loop.silentFrom >= FROG_BED_HOLD_S) {
        loop.emitter.stop();
        loop.emitter = null;
      }
    }
  }

  function stopAll(slots: readonly (ShotSlot | HumSlot | BedLoop | undefined)[]): void {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot === undefined || slot.emitter === null) continue;
      slot.emitter.stop();
      slot.emitter = null;
    }
  }

  return {
    update(s, listener) {
      if (disposed || !unlocked) return;
      const t = now();
      frame++;
      hums(s, listener, t);
      frogs(s.frogCalls, listener, t);
      rustles(s.rustles, listener, t);
      bed(s.bed, listener, t);
    },
    dispose() {
      disposed = true;
      stopAll(humSlots);
      stopAll(frogSlots);
      stopAll(rustleSlots);
      stopAll(bedLoops);
      liveHums = 0;
      callClips.length = 0;
      bedClips.length = 0;
      for (const slot of frogSlots) slot.clip = null;
    },
  };
}
