/**
 * Day Hike's side of the sound's bus (`ambientAudio.ts`): the voices that are
 * the hike's own, made on the graph the bus hands over, and the methods the
 * hike calls them by. The stare's heart and whispers and the chase's pulse
 * play beside the world, so the end's fade takes them and no muffle does;
 * the Hollow's call and the woods' other voices play in it; the car at the
 * end has a bus of its own off the master. The stare is also what muffles
 * the world.
 */
import {
  createAmbientAudio, type AmbientAudio, type SoundGame, type SoundHost,
} from "@csarkosh/engine/game/ambientAudio";
import { clamp01 } from "@csarkosh/engine/game/colour";
import type { StareLens } from "@csarkosh/engine/game/stareLens";
import type { OddCue } from "@csarkosh/engine/game/woodsSounds";
import { createCarAudio, type CarAudio, type CarPlace } from "./carAudio.js";
import { createChaseAudio, type ChaseAudio } from "./chaseAudio.js";
import { makeOddSound, ODD_LEVEL } from "./oddSounds.js";
import { createStareAudio, muffleGain, muffleHz, type StareAudio } from "./stareAudio.js";

/** The Hollow's call: its bus level at a cue's full level, the metres from the ear it
 * is placed at, and its two voices: the recording an octave down, and a fourth under
 * that a moment later, so no animal the player knows made it. */
export const HOLLOW_CALL_LEVEL = 3;
export const HOLLOW_CALL_STANDOFF_M = 20;
/** Seconds a fly takes to pass the ear (oddSounds.ts's buzz is as long). */
export const FLY_PASS_S = 1.5;
export const HOLLOW_CALL_VOICES: readonly { rate: number; share: number; after: number }[] = [
  { rate: 0.5, share: 1, after: 0 },
  { rate: 0.375, share: 0.6, after: 0.09 },
];
/** The call's first voice runs from this rate to this, by the variant; the second sits this far under it, and this long after. */
export const HOLLOW_CALL_RATE: readonly [number, number] = [0.38, 0.62];
export const HOLLOW_CALL_UNDER: readonly [number, number] = [0.66, 0.82];
export const HOLLOW_CALL_AFTER: readonly [number, number] = [0.04, 0.22];

/**
 * The two voices of one cry for a variant of 0 to 1: at 0, the voices as
 * `HOLLOW_CALL_VOICES` gives them. The variant is turned three ways by
 * taking it at different rates, so near variants are not near cries; past
 * 0.5 the second voice is the recording played backwards.
 */
export function hollowCallVoices(variant: number): readonly { rate: number; share: number; after: number; reversed: boolean }[] {
  const v = Math.max(0, Math.min(1, variant));
  if (v === 0) return HOLLOW_CALL_VOICES.map((voice) => ({ ...voice, reversed: false }));
  const a = (v * 7.31) % 1;
  const b = (v * 3.17 + 0.5) % 1;
  const c = (v * 11.7 + 0.25) % 1;
  const rate = HOLLOW_CALL_RATE[0] + (HOLLOW_CALL_RATE[1] - HOLLOW_CALL_RATE[0]) * a;
  const under = HOLLOW_CALL_UNDER[0] + (HOLLOW_CALL_UNDER[1] - HOLLOW_CALL_UNDER[0]) * b;
  const after = HOLLOW_CALL_AFTER[0] + (HOLLOW_CALL_AFTER[1] - HOLLOW_CALL_AFTER[0]) * c;
  return [
    { rate, share: 1, after: 0, reversed: false },
    { rate: rate * under, share: 0.55 + 0.2 * b, after, reversed: v > 0.5 },
  ];
}

/** The hike's own sounds, by the methods the bus wears for them. */
export type HikeSound = {
  /**
   * The Hollow's call (woodsVoice.ts): `buffer` an octave down and again a
   * fourth under that, from the direction given (Web Audio's right-handed
   * frame, any length), at `level` through a low-pass at `cutoffHz`. It is
   * placed by direction alone: how far it sounds is the level's and the
   * low-pass's to say. Inert before `unlock()`.
   */
  hollowCall(buffer: AudioBuffer, dx: number, dy: number, dz: number, level: number, cutoffHz: number, variant?: number): void;
  /**
   * One of the woods' other voices (woodsSounds.ts, oddSounds.ts): made at
   * once from the cue's place relative to the listener (x right, y up, z
   * ahead, in metres; a cue with no place plays on the bus itself). A fly
   * passes from its place to the mirror of it. Inert before `unlock()`.
   */
  playOdd(cue: OddCue): void;
  /**
   * The chase's pulse (chaseAudio.ts), every frame: `cast` is how far the
   * chase is in (escalation.ts), `near` the local lens, which quickens it.
   * Plays beside the world, not in it, so nothing hushes it. Inert before
   * `unlock()`.
   */
  setChase(cast: number, near: number): void;
  /**
   * The local player's stare (stareLens.ts), every frame: the world's beds
   * and calls go muffled and quiet under it, and the heart and the whispers
   * play (stareAudio.ts). Inert before `unlock()`.
   */
  setStare(lens: StareLens, haunt?: number): void;
  /**
   * The car at the end (carAudio.ts) on the `car` bus: its schedule starts
   * now (the door, the crank, the catch, the revs), placed at `at`, relative
   * to the listener as `setCar`'s place is. A car already playing is
   * stopped first. Inert before `unlock()`.
   */
  startCar(at: CarPlace): void;
  /**
   * The car, every frame: its speed (m/s) and its place relative to the
   * listener in Web Audio's frame, as `playOdd`'s cues are (x right, y up,
   * z ahead, metres). Inert before `unlock()` and with no car started.
   */
  setCar(speed: number, listenerRelative: CarPlace): void;
  /** The car's sources stopped and its nodes disconnected. */
  stopCar(): void;
};

/** The sound's bus as the hike has it: the world's, and the hike's own beside it. */
export type HikeAudio = AmbientAudio & HikeSound;

/** Day Hike's sound, for `createAmbientAudio`. */
export const hikeSound: SoundGame<HikeSound> = () => {
  /** The graph, from an unlock to the disposal. */
  let host: SoundHost | null = null;
  let stare: StareAudio | null = null;
  let chase: ChaseAudio | null = null;
  /** The car's bus (carAudio.ts), off the master beside the voice's, so the world's fade leaves it. */
  let carBus: GainNode | null = null;
  let car: CarAudio | null = null;
  /** Each call recording's reverse, made once. */
  const reversed = new Map<AudioBuffer, AudioBuffer>();
  function reversedOf(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer {
    let out = reversed.get(buffer);
    if (out !== undefined) return out;
    out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const from = buffer.getChannelData(c);
      const to = out.getChannelData(c);
      for (let i = 0; i < from.length; i++) to[i] = from[from.length - 1 - i] as number;
    }
    reversed.set(buffer, out);
    return out;
  }

  const api: HikeSound = {
      hollowCall(buffer, dx, dy, dz, level, cutoffHz, variant = 0) {
        if (host === null) return;
        const { ctx, world, ear } = host;
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
        panner.positionX.value = ear.x + (dx / length) * HOLLOW_CALL_STANDOFF_M;
        panner.positionY.value = ear.y + (dy / length) * HOLLOW_CALL_STANDOFF_M;
        panner.positionZ.value = ear.z + (dz / length) * HOLLOW_CALL_STANDOFF_M;
        filter.connect(panner);
        panner.connect(world);
        // No two cries alike: the variant picks the first voice's pitch, the
        // second's interval and delay, and whether the second is the recording
        // played backwards (a cry that ends where one begins).
        for (const voice of hollowCallVoices(clamp01(variant))) {
          const src = ctx.createBufferSource();
          src.buffer = voice.reversed ? reversedOf(ctx, buffer) : buffer;
          src.playbackRate.value = voice.rate;
          const g = ctx.createGain();
          g.gain.value = HOLLOW_CALL_LEVEL * clamp01(level) * voice.share;
          src.connect(g);
          g.connect(filter);
          src.start(at + voice.after);
        }
      },
      playOdd(cue) {
        if (host === null) return;
        const { ctx, world, noise, ear } = host;
        const level = ODD_LEVEL[cue.kind] * clamp01(cue.level);
        if (!(level > 0)) return;
        const at = ctx.currentTime;
        if (cue.kind === "swell") {
          makeOddSound({ ctx, noise, into: world }, cue.kind, at, level);
          return;
        }
        // The cue's frame to the world's: right is forward across up.
        const rx = ear.fy * ear.uz - ear.fz * ear.uy;
        const ry = ear.fz * ear.ux - ear.fx * ear.uz;
        const rz = ear.fx * ear.uy - ear.fy * ear.ux;
        const px = ear.x + rx * cue.x + ear.ux * cue.y + ear.fx * cue.z;
        const py = ear.y + ry * cue.x + ear.uy * cue.y + ear.fy * cue.z;
        const pz = ear.z + rz * cue.x + ear.uz * cue.y + ear.fz * cue.z;
        const panner = ctx.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.rolloffFactor = 0;
        panner.positionX.value = px;
        panner.positionY.value = py;
        panner.positionZ.value = pz;
        if (cue.kind === "fly") {
          // Across the head and out the other side.
          panner.positionX.setValueAtTime(px, at);
          panner.positionX.linearRampToValueAtTime(ear.x - rx * cue.x - ear.fx * cue.z, at + FLY_PASS_S);
          panner.positionZ.setValueAtTime(pz, at);
          panner.positionZ.linearRampToValueAtTime(ear.z - rz * cue.x - ear.fz * cue.z, at + FLY_PASS_S);
        }
        panner.connect(world);
        makeOddSound({ ctx, noise, into: panner }, cue.kind, at, level);
      },
      setChase(cast, near) {
        chase?.set(cast, near);
      },
      setStare(lens, haunt = 0) {
        if (host === null || stare === null) return;
        host.muffle(muffleHz(lens.level), muffleGain(lens.level));
        stare.set(lens, host.ear.x, host.ear.y, host.ear.z, haunt);
      },
      startCar(at) {
        if (host === null || carBus === null) return;
        car?.stop();
        car = createCarAudio(host.ctx, carBus, host.noise, host.ear);
        car.start();
        car.set(0, at);
      },
      setCar(speed, listenerRelative) {
        car?.set(speed, listenerRelative);
      },
      stopCar() {
        car?.stop();
        car = null;
      },
  };

  return {
    side: {
      unlocked(h) {
        host = h;
        // The stare's own sounds sit beside the world, not in it: they are not muffled.
        stare = createStareAudio(h.ctx, h.scene, h.noise, h.random);
        chase = createChaseAudio(h.ctx, h.scene, h.noise);
        carBus = h.ctx.createGain();
        carBus.gain.value = 1;
        carBus.connect(h.master);
      },
      disposed() {
        car?.stop();
        car = null;
        stare = null;
        chase = null;
        carBus = null;
        host = null;
      },
    },
    api,
  };
};

/**
 * The hike's bus. `createCtx` and `random` are the bus's own
 * (`createAmbientAudio`), injectable for its tests.
 */
export function createHikeAudio(
  createCtx?: () => AudioContext,
  random?: () => number,
): HikeAudio {
  return createAmbientAudio(hikeSound, createCtx, random);
}
