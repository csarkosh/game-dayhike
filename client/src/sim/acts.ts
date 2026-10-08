/**
 * The three acts of the climb, by the party's progress: the climb of the
 * living player nearest the crest, 0 at the trailhead and 1 at the crest, by
 * distance along the trail (`stemProgress`, trailRoute.ts). The day the
 * match starts in; from WET_AT, over WET_SPAN, the wet; from DUSK_AT, over
 * NIGHT_SPAN, the night; and once the night is in, from MIST_AT over
 * MIST_SPAN, the mist on the ground, which the haunt waits for. The sky, the
 * sound and the haunt all read these (game/escalation.ts, game/woodsVoice.ts,
 * sim/haunt.ts).
 *
 * sim/ determinism rules: no trig, no Math.pow.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The progress at which the weather turns, and over how much it turns: a tenth of the way is day. */
export const WET_AT = 0.1;
export const WET_SPAN = 0.08;
/** The progress at which the sun begins to go, and over how much it is gone: a fifth of the way is the wet, and the rest is night. */
export const DUSK_AT = 0.3;
export const NIGHT_SPAN = 0.1;
/** The progress at which the mist begins to rise off the ground, the night fully in, and over how much it is whole. */
export const MIST_AT = DUSK_AT + NIGHT_SPAN;
export const MIST_SPAN = 0.1;

/** Flat at both ends: Ken Perlin's smootherstep. */
export function smootherstep(x: number): number {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** How far into the wet act, into the night and into the mist a progress of 0 to 1 is, each 0 to 1. */
export function actsUnder(progress: number): { wet: number; night: number; mist: number } {
  return {
    wet: smootherstep((progress - WET_AT) / WET_SPAN),
    night: smootherstep((progress - DUSK_AT) / NIGHT_SPAN),
    mist: smootherstep((progress - MIST_AT) / MIST_SPAN),
  };
}
