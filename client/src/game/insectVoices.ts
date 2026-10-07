/**
 * The water life's synthesized voices: small Web Audio graphs a builder makes
 * on a context and hands to `AmbientAudio.loopEmitter`, which positions them.
 * The midge swarms' hum loops until it is stopped; the dragonflies' wing
 * rustle and the Pacific chorus frog's call each end on their own. A voice's
 * `stop` ends every source it made and disconnects every node, so a stopped
 * voice leaves nothing wired to the bus. No Babylon and no timers: every
 * change over time is scheduled on the context's own clock.
 */
import type { VoiceSource } from "./ambientAudio.js";

/**
 * The hum: `HUM_OSCILLATORS` sawtooth oscillators spread evenly from
 * `1 − HUM_DETUNE` to `1 + HUM_DETUNE` times the pitch, so they beat against
 * one another as a swarm's many wings do, summed through a band-pass at the
 * pitch with Q `HUM_Q`. Each oscillator's level is `HUM_LEVEL`, swung by
 * `HUM_DRIFT` either way by a slow sine of its own between `HUM_DRIFT_HZ[0]`
 * and `HUM_DRIFT_HZ[1]`, so the six fade in and out independently.
 * `setPitch` glides every oscillator and the band with time constant
 * `HUM_PITCH_TC`.
 */
export const HUM_OSCILLATORS = 6, HUM_DETUNE = 0.08, HUM_Q = 4;
export const HUM_LEVEL = 0.15;
export const HUM_DRIFT = 0.1;
export const HUM_DRIFT_HZ: readonly [number, number] = [0.05, 0.25];
export const HUM_PITCH_TC = 0.5;

/**
 * The wing rustle: a burst of noise through a band-pass at `RUSTLE_HZ`
 * (Q `RUSTLE_Q`), its amplitude pulsed between 0 and 1 at the wingbeat,
 * under an envelope that rises over `RUSTLE_ATTACK_S` to `RUSTLE_LEVEL` and
 * falls to nothing at `RUSTLE_S`; a chase's clatter peaks at
 * `RUSTLE_LOUD_LEVEL` and lasts `RUSTLE_LOUD_S`. The noise is one buffer of
 * `RUSTLE_NOISE_S` a context, each burst reading its own stretch of it.
 */
export const RUSTLE_S = 0.25, RUSTLE_LOUD_S = 0.4;
export const RUSTLE_LEVEL = 0.5, RUSTLE_LOUD_LEVEL = 1;
export const RUSTLE_HZ = 1500, RUSTLE_Q = 1.2;
export const RUSTLE_ATTACK_S = 0.02;
export const RUSTLE_NOISE_S = 1;

/**
 * The Pacific chorus frog's two-part call, synthesized: two notes
 * (`FROG_NOTES`, each a start and an end in seconds from the call's start),
 * each a sine at the carrier, the second `FROG_RISE` times higher, under an
 * envelope that rises over `FROG_ATTACK_S` and decays to `FROG_FLOOR` by the
 * note's end; both pulsed between 0 and 1 at about `FROG_PULSE_HZ` (±10 %,
 * drawn per call). The call lasts `FROG_CALL_S`. A voice's carrier lies
 * between `FROG_CARRIER_HZ[0]` and `FROG_CARRIER_HZ[1]`.
 */
export const FROG_CALL_S = 0.35;
export const FROG_CARRIER_HZ: readonly [number, number] = [2000, 2500];
export const FROG_NOTES: readonly (readonly [number, number])[] = [[0, 0.11], [0.19, 0.35]];
export const FROG_RISE = 1.1;
export const FROG_PULSE_HZ = 100;
export const FROG_ATTACK_S = 0.01;
export const FROG_FLOOR = 0.001;

/** Ends every source and disconnects every node of a voice. A source that
 * already ended on its own is not an error. */
function halt(sources: readonly AudioScheduledSourceNode[], nodes: readonly AudioNode[]): void {
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      /* already ended: a voice that ran its length is not an error */
    }
  }
  for (const n of nodes) n.disconnect();
}

/** The midges' hum at `pitch` Hz, looping until stopped. */
export function humVoice(
  ctx: BaseAudioContext, pitch: number, random: () => number,
): VoiceSource & { setPitch(hz: number): void } {
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = pitch;
  band.Q.value = HUM_Q;
  const ratios: number[] = [];
  const oscillators: OscillatorNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [band];
  for (let k = 0; k < HUM_OSCILLATORS; k++) {
    const ratio = 1 + HUM_DETUNE * ((2 * k) / (HUM_OSCILLATORS - 1) - 1);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = pitch * ratio;
    const level = ctx.createGain();
    level.gain.value = HUM_LEVEL;
    // The drift: a slow sine added to the level's own value, so this
    // oscillator's loudness swings by HUM_DRIFT either way at a rate of its
    // own, about half of them starting downward.
    const drift = ctx.createOscillator();
    drift.type = "sine";
    drift.frequency.value = HUM_DRIFT_HZ[0] + (HUM_DRIFT_HZ[1] - HUM_DRIFT_HZ[0]) * random();
    const depth = ctx.createGain();
    depth.gain.value = random() < 0.5 ? -HUM_DRIFT : HUM_DRIFT;
    drift.connect(depth);
    depth.connect(level.gain);
    osc.connect(level);
    level.connect(band);
    osc.start();
    drift.start();
    ratios.push(ratio);
    oscillators.push(osc);
    sources.push(osc, drift);
    nodes.push(osc, level, drift, depth);
  }
  return {
    output: band,
    setPitch(hz) {
      const t = ctx.currentTime;
      for (let k = 0; k < oscillators.length; k++) {
        oscillators[k]!.frequency.setTargetAtTime(hz * ratios[k]!, t, HUM_PITCH_TC);
      }
      band.frequency.setTargetAtTime(hz, t, HUM_PITCH_TC);
    },
    stop() {
      halt(sources, nodes);
    },
  };
}

/** One noise buffer a context, made on the first rustle and kept while the context lives. */
const rustleNoise = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseFor(ctx: BaseAudioContext, random: () => number): AudioBuffer {
  let buffer = rustleNoise.get(ctx);
  if (buffer === undefined) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * RUSTLE_NOISE_S), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
    rustleNoise.set(ctx, buffer);
  }
  return buffer;
}

/** A dragonfly's wings passing close, pulsed at `wingHz`; a chase's clatter
 * when `loud`. Ends itself after `RUSTLE_S` (`RUSTLE_LOUD_S` when loud). */
export function rustleVoice(
  ctx: BaseAudioContext, wingHz: number, loud: boolean, random: () => number,
): VoiceSource {
  const t = ctx.currentTime;
  const length = loud ? RUSTLE_LOUD_S : RUSTLE_S;
  const src = ctx.createBufferSource();
  src.buffer = noiseFor(ctx, random);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = RUSTLE_HZ;
  band.Q.value = RUSTLE_Q;
  // The wingbeat: a sine at the wing rate swings the pulse gain between 0 and 1.
  const pulse = ctx.createGain();
  pulse.gain.value = 0.5;
  const wing = ctx.createOscillator();
  wing.type = "sine";
  wing.frequency.value = wingHz;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, t);
  envelope.gain.linearRampToValueAtTime(loud ? RUSTLE_LOUD_LEVEL : RUSTLE_LEVEL, t + RUSTLE_ATTACK_S);
  envelope.gain.linearRampToValueAtTime(0, t + length);
  src.connect(band);
  band.connect(pulse);
  wing.connect(depth);
  depth.connect(pulse.gain);
  pulse.connect(envelope);
  src.start(t, random() * (RUSTLE_NOISE_S - length));
  wing.start(t);
  src.stop(t + length);
  wing.stop(t + length);
  return {
    output: envelope,
    stop() {
      halt([src, wing], [src, band, pulse, wing, depth, envelope]);
    },
  };
}

/** One chorus frog's two-part call on a carrier of `carrierHz`. Ends itself
 * after `FROG_CALL_S`. */
export function frogCallVoice(ctx: BaseAudioContext, carrierHz: number, random: () => number): VoiceSource {
  const t = ctx.currentTime;
  // The pulses: a sine at about FROG_PULSE_HZ swings the call's gain between 0 and 1.
  const pulsed = ctx.createGain();
  pulsed.gain.value = 0.5;
  const pulse = ctx.createOscillator();
  pulse.type = "sine";
  pulse.frequency.value = FROG_PULSE_HZ * (0.9 + 0.2 * random());
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  pulse.connect(depth);
  depth.connect(pulsed.gain);
  const sources: AudioScheduledSourceNode[] = [pulse];
  const nodes: AudioNode[] = [pulsed, pulse, depth];
  for (let k = 0; k < FROG_NOTES.length; k++) {
    const [from, to] = FROG_NOTES[k]!;
    const note = ctx.createOscillator();
    note.type = "sine";
    note.frequency.value = k === 0 ? carrierHz : carrierHz * FROG_RISE;
    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    envelope.gain.setValueAtTime(0, t + from);
    envelope.gain.linearRampToValueAtTime(1, t + from + FROG_ATTACK_S);
    envelope.gain.exponentialRampToValueAtTime(FROG_FLOOR, t + to);
    note.connect(envelope);
    envelope.connect(pulsed);
    note.start(t + from);
    note.stop(t + to);
    sources.push(note);
    nodes.push(note, envelope);
  }
  pulse.start(t);
  pulse.stop(t + FROG_CALL_S);
  return {
    output: pulsed,
    stop() {
      halt(sources, nodes);
    },
  };
}
