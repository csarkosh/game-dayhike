/**
 * What the woods say on the climb (docs/gameplay/2026-10-05-the-woods-voice.md):
 * a bed of birdsong, full at the trailhead, thinner with every stretch climbed
 * and cut dead whenever the watcher shows; and the Hollow's call, heard from
 * up the trail each time the party passes a mark, nearer every time.
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

export type WoodsInputs = {
  /** The party's best climb so far, 0 at the trailhead and 1 at the crest (`EscalationState.progressMax`). */
  climb: number;
  /** The chase has begun. */
  chase: boolean;
  /** A Hollow is out: the watcher shown, or any other. */
  hollow: boolean;
  /** The weather's rain, 0 to 1. */
  rain: number;
};

export type WoodsState = {
  /** The birdsong's level, 0 to 1; negative before the first step. */
  birds: number;
  /** Seconds the birds still stay stopped. */
  hold: number;
  /** How many of `CALL_CLIMBS` have been passed; negative before the first step. */
  calls: number;
};

export const WOODS_REST: WoodsState = Object.freeze({ birds: -1, hold: 0, calls: -1 });

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

/**
 * One frame. The birds stop within a breath while a Hollow is out or the
 * chase is on, stay stopped BIRDS_HOLD_S after, and come back slowly to what
 * the climb and the rain leave. A call is cued on the frame the climb passes
 * a mark, one a frame at most, and never in the chase; a screen that joins a
 * climb under way starts from the marks already passed and hears none of them.
 */
export function stepWoods(prev: WoodsState, input: WoodsInputs, dt: number): { state: WoodsState; call: CallCue | null } {
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
    call = callCue(calls);
    calls++;
  }
  return { state: { birds, hold, calls }, call };
}
