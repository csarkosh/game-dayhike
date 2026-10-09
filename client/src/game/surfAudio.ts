/**
 * The surf's sound on the ambient context's loop emitters: a bed that
 * follows the nearest point of the cove's toe line, a thud on each plunge
 * and a hiss as each sheet draws back. What breaks where is decided
 * elsewhere and arrives each frame as a `SurfSound` (`surfSound.ts`); this
 * shell holds the voices, caps them and mirrors Babylon's world into Web
 * Audio's.
 *
 * - The bed: `SURF_BED_CLIP` looping round its seamless stretch
 *   (`SURF_BED_LOOP_S`) from a random point in it, through a lowpass of its
 *   own, on one loop emitter at the nearest point; its gain is
 *   `surfBedGain(envelope, hs)` and its cutoff `surfCutoffHz(inland,
 *   canopy)`, so it swells with the sets and the swell's height and dulls
 *   inland and under the trees. It starts once its clip is decoded, the sea
 *   is present and its gain is above `SURF_GAIN_STEP`, made silent and
 *   raised through the emitter's ramp; absent, it is sent a gain of nothing
 *   and stops after `SURF_BED_HOLD_S` of it.
 * - Plunges and backwash: each a recording on a loop emitter that ends
 *   itself, as the frogs' calls are; at most `SURF_PLUNGE_VOICES` and
 *   `SURF_BACKWASH_VOICES` sounding, the nearest of a frame's new ones taking
 *   the free slots, none beyond `SURF_RANGE_M`, gained by the plunge's
 *   height and the sheet's reach, each through a lowpass of its own set once
 *   at its start to `surfCutoffHz(inland, canopy)`, the bed's cutoff then. A
 *   slot frees, and its emitter is stopped, once its clip has run its length
 *   and `SURF_SHOT_MARGIN_S`.
 *
 * Gain and cutoff changes smaller than their steps are not sent, and a value
 * that is not a finite number is never sent. Everything joins the world bus
 * through the wildlife gain (`ambientAudio.ts`), so the stare's muffle, the
 * reveal's hush and the limiter act on the surf as on the frogs. Positions
 * arrive in Babylon's left-handed frame and go to Web Audio with z negated.
 * Nothing happens before the context is unlocked, and nothing is queued.
 */
import { LOOP_GAIN_RAMP_S, type AmbientAudio, type LoopEmitter, type VoiceSource } from "./ambientAudio.js";
import { audioUrl } from "./assetUrls.js";
import { SURF_EVENTS, SURF_RANGE_M, type SurfSound } from "./surfSound.js";

export { SURF_RANGE_M };
/** The bed's gain at a full envelope and a swell of 2 m. */
export const SURF_LEVEL = 0.6;
/** Every surf voice keeps its gain to this distance (m) and falls as `SURF_REF_M / d` beyond. */
export const SURF_REF_M = 40;
/** The lowpass at the waterline and `SURF_LOWPASS_INLAND_M` inland (Hz), and the share full canopy takes off it. */
export const SURF_LOWPASS_SHORE_HZ = 8000, SURF_LOWPASS_INLAND_HZ = 1500, SURF_LOWPASS_INLAND_M = 300, SURF_CANOPY_LOWPASS = 0.5;
export const SURF_PLUNGE_VOICES = 4, SURF_BACKWASH_VOICES = 2;
/** Gain changes smaller than this are not sent. */
export const SURF_GAIN_STEP = 0.005;
/** Cutoff changes smaller than this (Hz) are not sent. */
export const SURF_CUTOFF_STEP_HZ = 20;
/** The bed recording's seamless stretch, s: it loops within it, never to the file's own ends. */
export const SURF_BED_LOOP_S: readonly [number, number] = [0.25, 30.25];
/** A bed whose gain has been nothing this long stops. */
export const SURF_BED_HOLD_S = 2;
/** A one-shot's slot frees this long after its clip's own length, so its tail is never cut. */
export const SURF_SHOT_MARGIN_S = 0.1;
/** A plunge this high (m), and a sheet drawing back from this reach (m), is heard at `SURF_LEVEL`. */
export const SURF_PLUNGE_FULL_M = 2, SURF_BACKWASH_FULL_M = 10;
/** The catalog's `audio` ids. */
export const SURF_BED_CLIP = "ambience.surf_cove";
export const SURF_PLUNGE_CLIPS: readonly string[] = ["call.surf_plunge_a", "call.surf_plunge_b", "call.surf_plunge_c"];
export const SURF_BACKWASH_CLIPS: readonly string[] = ["call.surf_backwash_a", "call.surf_backwash_b"];

/** The bed's gain: `SURF_LEVEL · (0.5 + 0.5 · envelope) · min(1, hs / 2)`, 0 for a value that is not a finite number. */
export function surfBedGain(envelope: number, hs: number): number {
  if (!Number.isFinite(envelope) || !Number.isFinite(hs)) return 0;
  return SURF_LEVEL * (0.5 + 0.5 * Math.min(1, Math.max(0, envelope))) * Math.min(1, Math.max(0, hs) / 2);
}

/** The bed's and each one-shot's cutoff (Hz): from the shore's to the inland one over `SURF_LOWPASS_INLAND_M`, less `SURF_CANOPY_LOWPASS` of it under full canopy. */
export function surfCutoffHz(inland: number, canopy: number): number {
  const u = Number.isFinite(inland) ? Math.min(1, Math.max(0, inland / SURF_LOWPASS_INLAND_M)) : 0;
  const shade = Number.isFinite(canopy) ? Math.min(1, Math.max(0, canopy)) : 0;
  return (SURF_LOWPASS_SHORE_HZ + (SURF_LOWPASS_INLAND_HZ - SURF_LOWPASS_SHORE_HZ) * u) * (1 - SURF_CANOPY_LOWPASS * shade);
}

export type SurfAudio = {
  /** One frame of the surf, heard from `listener` (Babylon's frame). */
  update(sound: SurfSound, listener: { x: number; y: number; z: number }): void;
  dispose(): void;
};

export type SurfAudioOptions = {
  /** Injected by the tests; production fetches the hashed URL Vite serves. */
  fetchClip?: (id: string) => Promise<ArrayBuffer>;
};

type Bed = {
  emitter: LoopEmitter | null;
  filter: BiquadFilterNode | null;
  ctx: BaseAudioContext | null;
  gain: number;
  hz: number;
  /** When its gain fell to nothing, while it still sounds; −1 while above. */
  silentFrom: number;
};
type ShotSlot = {
  emitter: LoopEmitter | null;
  endsAt: number;
  clip: AudioBuffer | null;
  /** The lowpass's cutoff (Hz) for the next start, set once there. */
  hz: number;
  readonly build: (ctx: BaseAudioContext) => VoiceSource;
};
type Events = { count: number; x: Float32Array; y: Float32Array; z: Float32Array };

/** `buffer` played from `offset` seconds in: once, ending itself, or with `loop` round that stretch until it is stopped. */
function clipVoice(ctx: BaseAudioContext, buffer: AudioBuffer, offset: number, loop: readonly [number, number] | null): VoiceSource {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
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
        /* already ended: a clip that ran its length is not an error */
      }
      src.disconnect();
    },
  };
}

/** `voice` into a lowpass at `hz` that is the voice's output; stopping it stops the voice and parts the filter. */
function lowpassed(ctx: BaseAudioContext, voice: VoiceSource, hz: number): { voice: VoiceSource; filter: BiquadFilterNode } {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = hz;
  voice.output.connect(filter);
  return {
    filter,
    voice: {
      output: filter,
      stop() {
        voice.stop();
        filter.disconnect();
      },
    },
  };
}

/**
 * `random` picks the bed's starting point and each one-shot's recording;
 * `now` is the clock, in seconds, the one-shots' lengths and the bed's hold
 * are measured on; `options.fetchClip` fetches a clip's bytes. All are
 * injectable for the tests.
 */
export function createSurfAudio(
  ambient: Pick<AmbientAudio, "loopEmitter" | "onUnlock" | "decode">,
  random: () => number = Math.random,
  now: () => number = () => performance.now() / 1000,
  options: SurfAudioOptions = {},
): SurfAudio {
  let unlocked = false;
  let disposed = false;
  let bedClip: AudioBuffer | undefined;
  const plungeClips: (AudioBuffer | undefined)[] = [];
  const backwashClips: (AudioBuffer | undefined)[] = [];
  const taken = new Int32Array(SURF_EVENTS);

  const bed: Bed = { emitter: null, filter: null, ctx: null, gain: 0, hz: SURF_LOWPASS_SHORE_HZ, silentFrom: -1 };
  // Built only once its clip is in: the recording round its stretch, from a random point in it, into its lowpass.
  const buildBed = (c: BaseAudioContext): VoiceSource => {
    const offset = SURF_BED_LOOP_S[0] + (SURF_BED_LOOP_S[1] - SURF_BED_LOOP_S[0]) * random();
    const { voice, filter } = lowpassed(c, clipVoice(c, bedClip!, offset, SURF_BED_LOOP_S), bed.hz);
    bed.filter = filter;
    bed.ctx = c;
    return voice;
  };

  function shotSlots(n: number): ShotSlot[] {
    const slots: ShotSlot[] = [];
    for (let i = 0; i < n; i++) {
      // Played once, into a lowpass of its own set at its start.
      const slot: ShotSlot = {
        emitter: null, endsAt: 0, clip: null, hz: SURF_LOWPASS_SHORE_HZ,
        build: (c) => lowpassed(c, clipVoice(c, slot.clip!, 0, null), slot.hz).voice,
      };
      slots.push(slot);
    }
    return slots;
  }
  const plungeSlots = shotSlots(SURF_PLUNGE_VOICES);
  const backwashSlots = shotSlots(SURF_BACKWASH_VOICES);

  ambient.onUnlock(() => {
    unlocked = true;
  });

  const fetchClip = options.fetchClip ?? (async (id: string) => {
    const response = await fetch(audioUrl(`audio/${id}.mp3`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  /** Fetches clip `id` now and hands it to `into` once the context exists and it is decoded. */
  function load(id: string, into: (buffer: AudioBuffer) => void): void {
    const warn = (reason: string): void => console.warn(`surf clip "${id}" will not play: ${reason}`);
    fetchClip(id).then(
      (bytes) => {
        if (disposed) return;
        ambient.onUnlock(() => {
          void ambient.decode(bytes).then((buffer) => {
            if (disposed) return;
            if (buffer === null) warn("the browser could not decode it");
            else into(buffer);
          });
        });
      },
      (e: unknown) => {
        if (!disposed) warn(e instanceof Error ? e.message : String(e));
      },
    );
  }
  load(SURF_BED_CLIP, (b) => {
    bedClip = b;
  });
  for (let k = 0; k < SURF_PLUNGE_CLIPS.length; k++) load(SURF_PLUNGE_CLIPS[k]!, (b) => { plungeClips[k] = b; });
  for (let k = 0; k < SURF_BACKWASH_CLIPS.length; k++) load(SURF_BACKWASH_CLIPS[k]!, (b) => { backwashClips[k] = b; });

  function updateBed(s: SurfSound, present: boolean, t: number): void {
    const gain = present ? surfBedGain(s.envelope, s.hs) : 0;
    const hz = surfCutoffHz(s.inland, s.canopy);
    if (bed.emitter === null) {
      if (gain < SURF_GAIN_STEP || bedClip === undefined) return;
      bed.hz = hz;
      // Made silent and raised through the emitter's ramp: a loop entered
      // mid-stretch at its full gain would click.
      bed.emitter = ambient.loopEmitter(buildBed, s.nearX, s.nearY, -s.nearZ, 0, SURF_REF_M, SURF_RANGE_M);
      if (bed.emitter === null) return;
      bed.emitter.setGain(gain);
      bed.gain = gain;
      bed.silentFrom = -1;
      return;
    }
    if (gain > 0) {
      bed.silentFrom = -1;
      bed.emitter.move(s.nearX, s.nearY, -s.nearZ);
      if (Math.abs(gain - bed.gain) >= SURF_GAIN_STEP) {
        bed.gain = gain;
        bed.emitter.setGain(gain);
      }
      if (Math.abs(hz - bed.hz) >= SURF_CUTOFF_STEP_HZ && bed.filter !== null && bed.ctx !== null) {
        bed.hz = hz;
        bed.filter.frequency.setTargetAtTime(hz, bed.ctx.currentTime, LOOP_GAIN_RAMP_S / 3);
      }
      return;
    }
    // Silence is sent outright; the bed stops once it has held.
    if (bed.silentFrom < 0) {
      bed.silentFrom = t;
      bed.gain = 0;
      bed.emitter.setGain(0);
    } else if (t - bed.silentFrom >= SURF_BED_HOLD_S) {
      stopBed();
    }
  }

  function stopBed(): void {
    bed.emitter?.stop();
    bed.emitter = null;
    bed.filter = null;
    bed.ctx = null;
    bed.gain = 0;
    bed.silentFrom = -1;
  }

  /** Stops the one-shots that have run their length. */
  function release(slots: readonly ShotSlot[], t: number): void {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.emitter !== null && t >= slot.endsAt) {
        slot.emitter.stop();
        slot.emitter = null;
        slot.clip = null;
      }
    }
  }

  /** The index of the nearest of `events` within range not yet taken this frame, or −1. */
  function nearest(events: Events, listener: { x: number; y: number; z: number }, takenN: number): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < events.count; i++) {
      let seen = false;
      for (let k = 0; k < takenN; k++) {
        if (taken[k] === i) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      const d = Math.hypot(events.x[i]! - listener.x, events.y[i]! - listener.y, events.z[i]! - listener.z);
      if (d <= SURF_RANGE_M && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** A decoded clip of `clips`, picked by `random`, or the first decoded after it; undefined while none is. */
  function pick(clips: readonly (AudioBuffer | undefined)[], n: number): AudioBuffer | undefined {
    const first = Math.min(n - 1, Math.floor(random() * n));
    for (let k = 0; k < n; k++) {
      const clip = clips[(first + k) % n];
      if (clip !== undefined) return clip;
    }
    return undefined;
  }

  function shots(
    slots: readonly ShotSlot[], clips: readonly (AudioBuffer | undefined)[], n: number,
    events: Events, amount: Float32Array, full: number, hz: number, listener: { x: number; y: number; z: number }, t: number,
  ): void {
    release(slots, t);
    let takenN = 0;
    for (let k = 0; k < slots.length; k++) {
      const slot = slots[k]!;
      if (slot.emitter !== null) continue;
      // The nearest new event loud enough to be sent.
      let i = -1;
      let gain = 0;
      for (;;) {
        i = nearest(events, listener, takenN);
        if (i < 0) break;
        taken[takenN++] = i;
        gain = SURF_LEVEL * Math.min(1, amount[i]! / full);
        if (gain >= SURF_GAIN_STEP) break;
      }
      if (i < 0) return;
      const clip = pick(clips, n);
      if (clip === undefined) return;
      slot.clip = clip;
      slot.hz = hz;
      slot.emitter = ambient.loopEmitter(slot.build, events.x[i]!, events.y[i]!, -events.z[i]!, gain, SURF_REF_M, SURF_RANGE_M);
      if (slot.emitter === null) return;
      slot.endsAt = t + clip.duration + SURF_SHOT_MARGIN_S;
    }
  }

  function stopAll(slots: readonly ShotSlot[]): void {
    for (const slot of slots) {
      slot.emitter?.stop();
      slot.emitter = null;
      slot.clip = null;
    }
  }

  return {
    update(s, listener) {
      if (disposed || !unlocked) return;
      const t = now();
      // Written as "finite" so a point that is not a number is absent.
      const present = s.present && Number.isFinite(s.nearX) && Number.isFinite(s.nearY) && Number.isFinite(s.nearZ);
      updateBed(s, present, t);
      if (!present) {
        release(plungeSlots, t);
        release(backwashSlots, t);
        return;
      }
      const hz = surfCutoffHz(s.inland, s.canopy);
      shots(plungeSlots, plungeClips, SURF_PLUNGE_CLIPS.length, s.plunges, s.plunges.height, SURF_PLUNGE_FULL_M, hz, listener, t);
      shots(backwashSlots, backwashClips, SURF_BACKWASH_CLIPS.length, s.backwash, s.backwash.reach, SURF_BACKWASH_FULL_M, hz, listener, t);
    },
    dispose() {
      disposed = true;
      stopBed();
      stopAll(plungeSlots);
      stopAll(backwashSlots);
      bedClip = undefined;
      plungeClips.length = 0;
      backwashClips.length = 0;
    },
  };
}
