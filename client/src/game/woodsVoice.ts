/**
 * What the woods say on the climb (docs/gameplay/2026-10-05-the-woods-voice.md):
 * a bed of birdsong, full at the trailhead, thinner with every stretch climbed
 * and cut dead whenever the watcher shows; and the Hollow's call, heard from
 * up the trail each time the party passes a mark, nearer every time. And at
 * the crest, the reveal: the world's sound cut to nothing as the body is
 * found, then the same call from where the Hollow stands.
 *
 * Stepped on each screen from state every peer already has, like the
 * escalation (escalation.ts) whose ratcheted progress it reads. Nothing is on
 * the wire. Babylon-free; ambientAudio.ts plays what it says.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The climb up to which the birds are all there, and the climb past which there are none. */
export const BIRDS_FULL_UNTIL = 0.12;
export const BIRDS_GONE_AT = 0.88;
/** The share of the birdsong rain leaves. */
export const BIRDS_RAIN_SHARE = 0.3;
/** Seconds the birds take to stop, to stay stopped after the watcher has gone, and to come back. */
export const BIRDS_HUSH_S = 0.1;
export const BIRDS_HOLD_S = 8;
export const BIRDS_RETURN_S = 9;

/** The recording the Hollow's call is made from (wildlifeAudio.ts `CALL_CLIP`): the elk's bugle. */
export const HOLLOW_CALL_CLIP = "call.elk_bugle";
/** The climbs at which the Hollow calls, low to high. */
export const CALL_CLIMBS: readonly number[] = [0.12, 0.3, 0.48, 0.64, 0.78, 0.9];
/** Metres up the trail the first call and the last sound from. */
export const CALL_FAR_M = 420;
export const CALL_NEAR_M = 60;
/** The first call's level and the last's, and the low-pass each is heard through: distance is quiet and dull. */
export const CALL_FAR_LEVEL = 0.4;
export const CALL_NEAR_LEVEL = 0.9;
export const CALL_FAR_HZ = 1400;
export const CALL_NEAR_HZ = 3200;

/** The reveal: seconds of nothing from the finding of the body to the call. With the
 * call's own three and a half seconds it spans the Hollow's stand behind the body
 * (hollow.ts SUMMIT_REVEAL_S), which ends in the middle of the call. */
export const REVEAL_SILENCE_S = 1.6;
/** The reveal's call for a listener within REVEAL_NEAR_M of the body: louder and clearer
 * than any on the climb. Further off it falls to the climb's far call at CALL_FAR_M. */
export const REVEAL_NEAR_M = 30;
export const REVEAL_LEVEL = 1.3;
export const REVEAL_HZ = 6000;

export type WoodsInputs = {
  /** The party's best climb so far, 0 at the trailhead and 1 at the crest (`EscalationState.progressMax`). */
  climb: number;
  /** The chase has begun. */
  chase: boolean;
  /** A Hollow is out: the watcher shown, or any other. */
  hollow: boolean;
  /** The weather's rain, 0 to 1. */
  rain: number;
  /** Metres from the listener to the body at the crest. */
  crest: number;
};

export type WoodsState = {
  /** The birdsong's level, 0 to 1; negative before the first step. */
  birds: number;
  /** Seconds the birds still stay stopped. */
  hold: number;
  /** How many of `CALL_CLIMBS` have been passed; negative before the first step. */
  calls: number;
  /** Whether the chase was on at the last step. */
  chase: boolean;
  /** Seconds since this screen saw the chase begin while its call is still to come; negative otherwise. */
  reveal: number;
};

export const WOODS_REST: WoodsState = Object.freeze({ birds: -1, hold: 0, calls: -1, chase: false, reveal: -1 });

/** One call: how far up the trail it sounds from, its level, and the low-pass it is heard through. */
export type CallCue = { distance: number; level: number; cutoffHz: number };

/** The birdsong a climb leaves, before rain: all of it low down, falling evenly to none near the crest. */
export function birdsAt(climb: number): number {
  return 1 - clamp01((climb - BIRDS_FULL_UNTIL) / (BIRDS_GONE_AT - BIRDS_FULL_UNTIL));
}

/** The cue for the `index`th call: the first far, quiet and dull, the last near, loud and clear. */
export function callCue(index: number): CallCue {
  const t = CALL_CLIMBS.length <= 1 ? 1 : clamp01(index / (CALL_CLIMBS.length - 1));
  return {
    distance: lerp(CALL_FAR_M, CALL_NEAR_M, t),
    level: lerp(CALL_FAR_LEVEL, CALL_NEAR_LEVEL, t),
    cutoffHz: lerp(CALL_FAR_HZ, CALL_NEAR_HZ, t),
  };
}

/** The reveal's call for a listener `distance` metres from the body. */
export function revealCue(distance: number): CallCue {
  const t = clamp01((distance - REVEAL_NEAR_M) / (CALL_FAR_M - REVEAL_NEAR_M));
  return { distance: Math.max(0, distance), level: lerp(REVEAL_LEVEL, CALL_FAR_LEVEL, t), cutoffHz: lerp(REVEAL_HZ, CALL_FAR_HZ, t) };
}

/**
 * One frame. The birds stop within a breath while a Hollow is out or the
 * chase is on, stay stopped BIRDS_HOLD_S after, and come back slowly to what
 * the climb and the rain leave. A call is cued on the frame the climb passes
 * a mark, the latest alone when several are passed at once, and never in the chase; a screen that joins a
 * climb under way starts from the marks already passed and hears none of them.
 *
 * The reveal begins on the frame a screen that was watching the climb sees
 * the chase begin: `hush` is 1, the world's sound cut, for REVEAL_SILENCE_S,
 * and then the call is cued from the body. A screen that joins a chase under
 * way has no reveal.
 */
export function stepWoods(prev: WoodsState, input: WoodsInputs, dt: number): { state: WoodsState; call: CallCue | null; hush: number } {
  const climb = clamp01(input.climb);
  const hushed = input.hollow || input.chase;
  const hold = hushed ? BIRDS_HOLD_S : Math.max(0, prev.hold - Math.max(0, dt));
  const target = hold > 0 ? 0 : birdsAt(climb) * (1 - (1 - BIRDS_RAIN_SHARE) * clamp01(input.rain));
  let birds = target;
  if (prev.birds >= 0 && dt > 0) {
    const tau = target < prev.birds ? BIRDS_HUSH_S : BIRDS_RETURN_S;
    birds = prev.birds + (target - prev.birds) * (1 - Math.exp(-dt / tau));
  } else if (prev.birds >= 0) birds = prev.birds;

  let passed = 0;
  while (passed < CALL_CLIMBS.length && climb >= (CALL_CLIMBS[passed] as number)) passed++;
  let calls = prev.calls;
  let call: CallCue | null = null;
  if (calls < 0 || input.chase) calls = Math.max(calls, passed);
  else if (passed > calls) {
    // A climb that jumps several marks at once is heard as its latest alone.
    call = callCue(passed - 1);
    calls = passed;
  }
  let reveal = prev.reveal;
  if (input.chase && !prev.chase && prev.calls >= 0) reveal = 0;
  else if (reveal >= 0) reveal += Math.max(0, dt);
  if (!input.chase) reveal = -1;
  if (reveal >= REVEAL_SILENCE_S) {
    call = revealCue(input.crest);
    reveal = -1;
  }
  return { state: { birds, hold, calls, chase: input.chase, reveal }, call, hush: reveal >= 0 ? 1 : 0 };
}
