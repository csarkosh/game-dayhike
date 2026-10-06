/**
 * What a stare sounds like (stareLens.ts): the player's own heart, one beat
 * for each the screen's darkness swells on, and whispers that circle the
 * head. All of it is synthesized on the ambient context (ambientAudio.ts,
 * which also muffles the world under a stare): the heart is two falling
 * tones a beat, and a whisper is the shared noise through a mouth's two
 * resonances, opened and shut a syllable at a time, with no consonant (the
 * hiss one made read as a snare). No voice says a word.
 */
import { HEART_DUB_AT, STARE_FLOOR, type StareLens } from "./stareLens.js";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The heart's bus at a full stare, and the whispers'. Under the master volume. */
export const HEART_LEVEL = 0.75;
export const WHISPER_LEVEL = 0.45;
/** The stare below which no whisper is heard, and at which they are all there. */
export const WHISPER_START = 0.12;
export const WHISPER_FULL = 0.75;
/** The share of the whispers' level the haunt alone brings: under a full stare's, and enough to be heard. */
export const HAUNT_WHISPER_SHARE = 0.6;
/** Voices, each on its own circle round the head. */
export const WHISPER_VOICES = 4;
/** Seconds ahead of the context's clock a voice's syllables are scheduled. */
export const WHISPER_LOOKAHEAD_S = 0.5;
/** A syllable's length and the gap after it, in seconds: slow, so each is heard whole (as first built, 80 to 260 ms with gaps of 20 to 120, they ran together). */
export const WHISPER_SYLLABLE_S: readonly [number, number] = [0.16, 0.42];
export const WHISPER_GAP_S: readonly [number, number] = [0.08, 0.26];
/** A syllable's gain at its loudest: the two resonances pass a sliver of the noise, and this is what brings a voice up to the heart's side. */
export const WHISPER_SYLLABLE_GAIN = 3;
/** The world's low-pass under a stare: open at none, shut down to this at a full one, and the share of its level left. */
export const MUFFLE_OPEN_HZ = 20000;
export const MUFFLE_SHUT_HZ = 650;
export const MUFFLE_GAIN = 0.45;

/** The heart's level for a stare: rising fast, so the first beats are heard. */
export function heartLevel(level: number): number {
  const l = clamp01(level);
  return l < STARE_FLOOR ? 0 : HEART_LEVEL * Math.sqrt(l);
}

/** The whispers' level for a stare: none under WHISPER_START, all at WHISPER_FULL. */
export function whisperLevel(level: number): number {
  const t = clamp01((level - WHISPER_START) / (WHISPER_FULL - WHISPER_START));
  return WHISPER_LEVEL * t * t * (3 - 2 * t);
}

/** The world's low-pass cutoff for a stare, falling by equal ratios, so the ear hears it close evenly. */
export function muffleHz(level: number): number {
  return MUFFLE_OPEN_HZ * Math.pow(MUFFLE_SHUT_HZ / MUFFLE_OPEN_HZ, clamp01(level));
}

/** The world's level under a stare. */
export function muffleGain(level: number): number {
  return 1 - (1 - MUFFLE_GAIN) * clamp01(level);
}

/** A mouth's two resonances, Hz, for five vowels: what a whisper is noise shaped by. */
const VOWELS: readonly (readonly [number, number])[] = [
  [730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840],
];

type Voice = {
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  open: GainNode;
  panner: PannerNode;
  /** When its next syllable begins on the context's clock, and how many are left in its phrase. */
  next: number;
  left: number;
  /** Its circle: where it started, how fast it turns (radians a second, either way), how far out and how high. */
  angle: number;
  turn: number;
  radius: number;
  height: number;
};

export type StareAudio = {
  /**
   * One frame: plays the beats the lens has begun since the last call,
   * schedules the whispers and moves them round the listener, whose place is
   * given in Web Audio's right-handed frame.
   */
  set(lens: StareLens, x: number, y: number, z: number, haunt?: number): void;
};

/**
 * Builds the heart's and the whispers' buses into `out`. `noise` is the
 * ambient graph's shared buffer; `random` draws the whispers' syllables.
 * The voices are built on the first stare, so a match nobody looks up in
 * carries none of them.
 */
export function createStareAudio(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, random: () => number): StareAudio {
  const heart = ctx.createGain();
  heart.gain.value = 1;
  heart.connect(out);
  const whispers = ctx.createGain();
  whispers.gain.value = 0;
  whispers.connect(out);
  let voices: Voice[] | null = null;
  let beats = -1;
  let silentSince = 0;

  const between = (a: number, b: number): number => a + (b - a) * random();

  /** One of the heart's two sounds: a tone falling an octave under a short swell, and its octave above for small speakers. */
  function thump(at: number, level: number, from: number): void {
    for (const [ratio, share] of [[1, 1], [2, 0.3]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(from * ratio, at);
      osc.frequency.exponentialRampToValueAtTime(from * ratio * 0.5, at + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * share, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      osc.connect(g);
      g.connect(heart);
      osc.start(at);
      osc.stop(at + 0.3);
    }
  }

  function build(now: number): Voice[] {
    const made: Voice[] = [];
    for (let i = 0; i < WHISPER_VOICES; i++) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = between(0.8, 1.25);
      src.start(0, random() * noise.duration);
      const low = ctx.createBiquadFilter();
      low.type = "bandpass";
      low.Q.value = 5;
      const high = ctx.createBiquadFilter();
      high.type = "bandpass";
      high.Q.value = 7;
      const open = ctx.createGain();
      open.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.rolloffFactor = 0;
      src.connect(low);
      src.connect(high);
      low.connect(open);
      high.connect(open);
      open.connect(panner);
      panner.connect(whispers);
      made.push({
        low, high, open, panner,
        next: now + between(0, 0.8), left: 0,
        angle: between(0, 2 * Math.PI), turn: between(0.25, 0.9) * (random() < 0.5 ? -1 : 1),
        radius: between(0.45, 0.9), height: between(-0.15, 0.25),
      });
    }
    return made;
  }

  /** Schedules one voice's syllables up to the look-ahead: phrases of a few, a breath between, the breaths shorter as the stare deepens. */
  function speak(v: Voice, now: number, level: number): void {
    if (v.next < now) v.next = now;
    while (v.next < now + WHISPER_LOOKAHEAD_S) {
      if (v.left <= 0) {
        v.left = 3 + Math.floor(random() * 5);
        v.next += between(0.6, 2.8) * (1.5 - level);
        continue;
      }
      const at = v.next;
      const length = between(WHISPER_SYLLABLE_S[0], WHISPER_SYLLABLE_S[1]);
      const loud = WHISPER_SYLLABLE_GAIN * between(0.35, 1);
      const vowel = VOWELS[Math.floor(random() * VOWELS.length) % VOWELS.length] as readonly [number, number];
      v.low.frequency.setTargetAtTime(vowel[0] * between(0.9, 1.1), at, 0.05);
      v.high.frequency.setTargetAtTime(vowel[1] * between(0.9, 1.1), at, 0.05);
      v.open.gain.setValueAtTime(0, at);
      v.open.gain.linearRampToValueAtTime(loud, at + length * 0.3);
      v.open.gain.linearRampToValueAtTime(0, at + length);
      v.next = at + length + between(WHISPER_GAP_S[0], WHISPER_GAP_S[1]);
      v.left--;
    }
  }

  return {
    set(lens, x, y, z, haunt = 0) {
      const now = ctx.currentTime;
      // The heart: the beat the lens began, and its second sound in step.
      if (beats < 0) beats = lens.beats;
      if (lens.beats !== beats) {
        beats = lens.beats;
        const level = heartLevel(lens.level);
        if (level > 0) {
          thump(now, level, 62);
          thump(now + HEART_DUB_AT * lens.period, level * 0.7, 74);
        }
      }
      // The whispers: the stare's, or the haunt's (escalation.ts), whichever is more.
      const level = Math.max(whisperLevel(lens.level), WHISPER_LEVEL * HAUNT_WHISPER_SHARE * clamp01(haunt));
      whispers.gain.setTargetAtTime(level, now, 0.4);
      if (level > 0) silentSince = now;
      // A second past the last stare the bus has faded, and nothing more is scheduled.
      if (voices === null && level === 0) return;
      voices ??= build(now);
      const speaking = now - silentSince < 1;
      for (const v of voices) {
        if (speaking) speak(v, now, Math.max(clamp01(lens.level), clamp01(haunt) * 0.5));
        const a = v.angle + v.turn * now;
        v.panner.positionX.value = x + Math.cos(a) * v.radius;
        v.panner.positionY.value = y + v.height;
        v.panner.positionZ.value = z + Math.sin(a) * v.radius;
      }
    },
  };
}
