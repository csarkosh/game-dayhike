/**
 * The woods' other voices made on the ambient context (woodsSounds.ts says
 * when and where; ambientAudio.ts holds the bus): each a few nodes built for
 * the sound and left to end, as the drips are. Nothing is recorded: a knock
 * is a burst of the shared noise through a wooden resonance, a creak a
 * rough low tone dragged down, a breath the noise opened and shut like a
 * mouth, and so on. The fly is the day's: a buzz that passes the ear.
 */
import type { OddCue } from "./woodsSounds.js";

/** The level each kind plays at for a cue's level of 1, under the master volume. */
export const ODD_LEVEL: Readonly<Record<OddCue["kind"], number>> = {
  knock: 0.7, creak: 0.6, snap: 0.9, steps: 0.9, breath: 0.7, ring: 0.22, swell: 0.12, fly: 0.14,
};

/** What a kind needs of the context: the shared noise and a place to play into. */
export type OddVoiceGraph = {
  ctx: AudioContext;
  noise: AudioBuffer;
  /** Where the sound goes: a panner placed for it, or the bus for a sound with no place. */
  into: AudioNode;
};

/** A burst of the noise through `filter`, `seconds` long with an attack of `attack`, at `level`, from `at`. */
function burst(g: OddVoiceGraph, at: number, seconds: number, attack: number, level: number, filter: BiquadFilterNode): void {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(g.into);
  src.start(at);
  src.stop(at + seconds + 0.05);
}

function filterOf(g: OddVoiceGraph, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = g.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** A tone of `type` at `hz`, its gain `env` (time, value) pairs from `at`, the first a set and the rest ramps; `to` slides the pitch there over the whole. */
function tone(g: OddVoiceGraph, at: number, type: OscillatorType, hz: number, env: readonly (readonly [number, number])[], to = hz, through?: AudioNode): void {
  const osc = g.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  const end = at + (env[env.length - 1] as readonly [number, number])[0];
  if (to !== hz) osc.frequency.linearRampToValueAtTime(to, end);
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  for (const [t, v] of env) gain.gain.linearRampToValueAtTime(v, at + t);
  osc.connect(gain);
  gain.connect(through ?? g.into);
  osc.start(at);
  osc.stop(end + 0.05);
}

/** Makes the cue's sound from `at`, at `level` (the cue's times the kind's). */
export function makeOddSound(g: OddVoiceGraph, kind: OddCue["kind"], at: number, level: number): void {
  switch (kind) {
    case "knock":
      // Wood on wood, twice: a wooden resonance, and a thump under it.
      for (const t of [0, 0.34]) {
        burst(g, at + t, 0.12, 0.004, level, filterOf(g, "bandpass", 850, 9));
        tone(g, at + t, "sine", 180, [[0.006, level * 0.6], [0.09, 0]], 120);
      }
      return;
    case "creak": {
      // A rough low tone dragged down through a resonance that moves with it.
      const f = filterOf(g, "bandpass", 420, 4);
      f.frequency.linearRampToValueAtTime(900, at + 1.4);
      f.connect(g.into);
      tone(g, at, "sawtooth", 64, [[0.3, level], [1.4, level * 0.9], [1.9, 0]], 52, f);
      tone(g, at, "sawtooth", 64.7, [[0.3, level * 0.6], [1.4, level * 0.5], [1.9, 0]], 52.5, f);
      return;
    }
    case "snap": {
      const f = filterOf(g, "highpass", 2200, 0.7);
      burst(g, at, 0.05, 0.002, level, f);
      return;
    }
    case "steps":
      // Four crunches in the litter, each a little louder: nearer, then nothing.
      for (let i = 0; i < 4; i++) {
        burst(g, at + i * 0.48, 0.09, 0.008, level * (0.4 + 0.2 * i), filterOf(g, "bandpass", 520, 1.2));
      }
      return;
    case "breath": {
      // In, then out, lower: the noise opened and shut.
      const inF = filterOf(g, "bandpass", 520, 0.8);
      burst(g, at, 1.2, 1.0, level * 0.6, inF);
      const outF = filterOf(g, "bandpass", 340, 0.8);
      burst(g, at + 1.45, 1.5, 0.35, level, outF);
      return;
    }
    case "ring":
      // Two thin sines a hair apart, beating, rung once and left to fade.
      tone(g, at, "sine", 2300, [[0.4, level], [3, 0]]);
      tone(g, at, "sine", 2307, [[0.4, level * 0.7], [3, 0]]);
      return;
    case "swell":
      // Under everything: two low tones beating, risen over three seconds and let go over four.
      tone(g, at, "sine", 42, [[3, level], [7, 0]]);
      tone(g, at, "sine", 42.6, [[3, level * 0.8], [7, 0]]);
      return;
    case "fly": {
      // A buzz passing: a sawtooth with its octave, sliding down as it goes by.
      const f = filterOf(g, "lowpass", 2600, 0.7);
      f.connect(g.into);
      tone(g, at, "sawtooth", 205, [[0.3, level], [1.1, level], [1.5, 0]], 168, f);
      tone(g, at, "sawtooth", 410, [[0.3, level * 0.35], [1.1, level * 0.35], [1.5, 0]], 336, f);
      return;
    }
  }
}
