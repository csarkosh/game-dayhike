/**
 * The woods' other voices (docs/gameplay/2026-10-05-the-woods-voice.md §4):
 * in the day, the odd fly passing the ear; by night, when every animal has
 * gone quiet, sounds that are not animals. A knock of wood on wood, twice.
 * A trunk's long creak. A stick snapped close by. Steps in the litter that
 * come nearer and stop. A breath at the shoulder. A thin ringing far off. A
 * swell under everything. None of them explained, none of them the same
 * place twice, more of them as the night deepens.
 *
 * Scheduled on each screen from its own small stream, so no two players
 * hear the same woods: what is heard is not on the wire, and nothing in the
 * sim reads it. Babylon-free; ambientAudio.ts makes the sounds.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type OddKind = "knock" | "creak" | "snap" | "steps" | "breath" | "ring" | "swell";
/** The night's kinds, in the order the stream draws from. */
export const ODD_KINDS: readonly OddKind[] = ["knock", "creak", "snap", "steps", "breath", "ring", "swell"];

/** The night below which nothing odd is heard, and the mean seconds between sounds there and at full night. */
export const ODD_NIGHT_MIN = 0.15;
export const ODD_GAP_FIRST_S = 48;
export const ODD_GAP_FULL_S = 14;
/** The share of sounds placed behind the listener. */
export const ODD_BEHIND_SHARE = 0.6;
/** Metres from the ear each kind sounds from, least and most. The swell has no place. */
export const ODD_RANGE: Readonly<Record<OddKind, readonly [number, number]>> = {
  knock: [14, 40], creak: [10, 30], snap: [4, 9], steps: [8, 18], breath: [1.5, 3], ring: [25, 60], swell: [0, 0],
};

/** The day above which flies are about, and the mean seconds between passes. */
export const FLY_DAY_MIN = 0.4;
export const FLY_GAP_S = 26;

export type WoodsSoundsState = {
  /** The stream. */
  seed: number;
  /** Seconds until the next odd sound, and the next fly. Negative before the first step. */
  odd: number;
  fly: number;
  /** The last kind, not drawn again at once. */
  last: OddKind | null;
};

export const WOODS_SOUNDS_REST: WoodsSoundsState = Object.freeze({ seed: 0, odd: -1, fly: -1, last: null });

export type WoodsSoundsInputs = {
  /** How far into the night the world is (`actsUnder`), 0 to 1. */
  night: number;
  /** How much of the day is left: 1 minus the wet act. */
  day: number;
  /** The chase is on: the Hollow is voice enough. */
  chase: boolean;
};

/** One sound to make: its kind, where it is from the ear (x right, y up, z ahead; all 0 for the swell), and its level. */
export type OddCue = { kind: OddKind | "fly"; x: number; y: number; z: number; level: number };

/** The stream: a 32-bit LCG, enough for a schedule. Returns the next seed and a draw in [0, 1). */
export function draw(seed: number): { seed: number; value: number } {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: next, value: next / 4294967296 };
}

/** A fresh state on a seed, with its first waits drawn. */
export function woodsSoundsFrom(seed: number): WoodsSoundsState {
  return { ...WOODS_SOUNDS_REST, seed: seed >>> 0 };
}

/** A place `metres` from the ear on a drawn bearing, behind more often than not, a little above or below the ear. */
function placeFor(state: WoodsSoundsState, metres: number): { seed: number; x: number; y: number; z: number } {
  let d = draw(state.seed);
  const behind = d.value < ODD_BEHIND_SHARE;
  d = draw(d.seed);
  // The bearing: anywhere in the chosen half, by a mix of the half's two edges and its middle.
  const t = d.value * 2 - 1;
  const x = Math.sin(t * Math.PI * 0.5) * metres;
  const z = Math.cos(t * Math.PI * 0.5) * metres * (behind ? -1 : 1);
  d = draw(d.seed);
  return { seed: d.seed, x, y: lerp(-0.5, 1.5, d.value), z };
}

/**
 * One frame. The night's sounds are spaced by a drawn gap whose mean falls
 * from ODD_GAP_FIRST_S to ODD_GAP_FULL_S as the night deepens, and none is
 * heard under ODD_NIGHT_MIN or in the chase; the day's flies likewise by
 * FLY_GAP_S while enough of the day is left. One cue a frame at most.
 */
export function stepWoodsSounds(prev: WoodsSoundsState, input: WoodsSoundsInputs, dt: number): { state: WoodsSoundsState; cue: OddCue | null } {
  const night = clamp01(input.night);
  const day = clamp01(input.day);
  let seed = prev.seed;
  let odd = prev.odd;
  let fly = prev.fly;
  let last = prev.last;
  let cue: OddCue | null = null;
  const step = Math.max(0, dt);

  const gapOdd = (): number => {
    const d = draw(seed);
    seed = d.seed;
    return lerp(ODD_GAP_FIRST_S, ODD_GAP_FULL_S, night) * lerp(0.5, 1.5, d.value);
  };
  if (night < ODD_NIGHT_MIN || input.chase) odd = -1;
  else if (odd < 0) odd = gapOdd();
  else {
    odd -= step;
    if (odd <= 0) {
      let d = draw(seed);
      let kind = ODD_KINDS[Math.floor(d.value * ODD_KINDS.length) % ODD_KINDS.length] as OddKind;
      if (kind === last) kind = ODD_KINDS[(ODD_KINDS.indexOf(kind) + 1) % ODD_KINDS.length] as OddKind;
      d = draw(d.seed);
      const [near, far] = ODD_RANGE[kind];
      const metres = lerp(near, far, d.value);
      d = draw(d.seed);
      const level = lerp(0.55, 1, d.value) * lerp(0.6, 1, night);
      seed = d.seed;
      if (kind === "swell") cue = { kind, x: 0, y: 0, z: 0, level };
      else {
        const at = placeFor({ ...prev, seed }, metres);
        seed = at.seed;
        cue = { kind, x: at.x, y: at.y, z: at.z, level };
      }
      last = kind;
      odd = gapOdd();
    }
  }

  if (day < FLY_DAY_MIN || input.chase) fly = -1;
  else if (fly < 0) {
    const d = draw(seed);
    seed = d.seed;
    fly = FLY_GAP_S * lerp(0.4, 1.6, d.value);
  } else {
    fly -= step;
    if (fly <= 0 && cue === null) {
      const at = placeFor({ ...prev, seed }, 1.2);
      seed = at.seed;
      cue = { kind: "fly", x: at.x, y: at.y, z: at.z, level: 1 };
      const d = draw(seed);
      seed = d.seed;
      fly = FLY_GAP_S * lerp(0.4, 1.6, d.value);
    } else if (fly <= 0) fly = 0.5;
  }
  return { state: { seed, odd, fly, last }, cue };
}
