import { INNER_LINES, type VoiceScenario } from "./innerLines.js";

/**
 * The inner voice (docs/gameplay/2026-10-07-the-inner-voice.md): the ranger's
 * own lines, one at a time, steering the player and selling the day, the
 * dusk, the dread and the chase. Pure and Babylon-free: each frame it reads
 * what the player is in and says at most one line, under rules that keep it
 * rare: a global cooldown, each scenario once or capped, nothing over the
 * end, and in the chase only the chase's own. It is local: what one player
 * hears never goes on the wire. A pool is drawn in a seeded order with no
 * repeat until it is spent, so two matches hear different lines.
 */

export type VoiceInputs = {
  /** The climb, 0 to 1, and the acts (sim/acts.ts). */
  climb: number;
  wet: number;
  night: number;
  mist: number;
  /** The chase, and the match over (any end card up). */
  chase: boolean;
  ended: boolean;
  /** Metres off the trail (sim/trail.ts trailDistance), the lamp, the stare, and whether the player moved this frame. */
  offTrail: number;
  lamp: boolean;
  stare: number;
  moving: boolean;
  /** A shade in the player's view this frame; the Hollow's cry this frame; the Hollow itself before the player's eyes (the summit scene's reveal). */
  shadeSeen: boolean;
  cry: boolean;
  hollowSeen: boolean;
  /** Beside the dropped cap; at the body; safe at the car. */
  nearCap: boolean;
  nearBody: boolean;
  safe: boolean;
};

export type VoiceState = {
  /** Seconds since the last line, and since the match began. */
  since: number;
  elapsed: number;
  /** How many times each scenario has spoken, and when last. */
  said: Partial<Record<VoiceScenario, number>>;
  last: Partial<Record<VoiceScenario, number>>;
  /** Each pool's order for this match (indices), and how far through it the voice is. */
  order: Partial<Record<VoiceScenario, number[]>>;
  at: Partial<Record<VoiceScenario, number>>;
  /** Timers the scenarios watch: off the trail, standing still, the lamp off in the dark, a shade once seen, the cries heard. */
  offTrailFor: number;
  stillFor: number;
  darkUnlitFor: number;
  shadeFor: number;
  shadeGoneFor: number;
  cries: number;
  wasChase: boolean;
  rng: number;
};

/** Seconds between any two lines, and the least before the first. */
export const VOICE_GAP_S = 22;
export const VOICE_FIRST_S = 4;
/** Seconds a line stays up. */
export const VOICE_LINE_MS = 3600;
/** Off the trail: metres off it, and seconds there, before the voice says so; the dark's version from this much night. */
export const OFF_TRAIL_M = 6;
export const OFF_TRAIL_S = 8;
export const OFF_TRAIL_NIGHT = 0.5;
/** Standing still at night this long. */
export const STILL_S = 20;
/** The lamp off this long into the dark. */
export const UNLIT_S = 10;
/** The stare at which the voice says not to look. */
export const DONT_LOOK = 0.4;
/** Seconds without a shade in view, after one, before the voice says there was nobody. */
export const SHADE_GONE_S = 1.5;
/** How many times a scenario may speak in a match, and the seconds between its own lines. */
const CAPS: Readonly<Record<VoiceScenario, { cap: number; gap: number }>> = {
  trailhead: { cap: 1, gap: 0 },
  rain: { cap: 1, gap: 0 },
  offTrailDay: { cap: 3, gap: 60 },
  offTrailNight: { cap: 3, gap: 60 },
  dusk: { cap: 1, gap: 0 },
  lamp: { cap: 1, gap: 0 },
  mist: { cap: 1, gap: 0 },
  cryFirst: { cap: 1, gap: 0 },
  cryAgain: { cap: 1, gap: 0 },
  shadeFirst: { cap: 1, gap: 0 },
  shadeGone: { cap: 1, gap: 0 },
  still: { cap: 2, gap: 90 },
  dontLook: { cap: 2, gap: 90 },
  crest: { cap: 1, gap: 0 },
  cap: { cap: 1, gap: 0 },
  body: { cap: 1, gap: 0 },
  hollow: { cap: 1, gap: 0 },
  chaseStart: { cap: 1, gap: 0 },
  chaseOffTrail: { cap: 1, gap: 0 },
  safe: { cap: 1, gap: 0 },
};
/** The scenarios the chase allows; the rest are the climb's. */
const CHASE_ONLY: ReadonlySet<VoiceScenario> = new Set(["chaseStart", "chaseOffTrail", "safe"]);
/** Lines that cut the gap: the body, the chase's start and the car do not wait on the cooldown. */
const URGENT: ReadonlySet<VoiceScenario> = new Set(["body", "hollow", "chaseStart", "safe", "cryFirst"]);

export function voiceRest(seed: number): VoiceState {
  return {
    since: Infinity, elapsed: 0, said: {}, last: {}, order: {}, at: {},
    offTrailFor: 0, stillFor: 0, darkUnlitFor: 0, shadeFor: 0, shadeGoneFor: 0, cries: 0, wasChase: false,
    rng: (seed >>> 0) || 1,
  };
}

function next(state: VoiceState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

/** A line said: its text, and the clip that is it (voiceClips.ts): the scenario and the line's index in its pool. */
export type VoiceLine = { text: string; scenario: VoiceScenario; index: number };

/** A pool's line for this match: the pool in a seeded order, no repeat until spent, then a new order. */
function draw(state: VoiceState, scenario: VoiceScenario): VoiceLine {
  const pool = INNER_LINES[scenario];
  let order = state.order[scenario];
  let at = state.at[scenario] ?? 0;
  if (order === undefined || at >= order.length) {
    order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next(state) * (i + 1));
      const t = order[i] as number;
      order[i] = order[j] as number;
      order[j] = t;
    }
    state.order[scenario] = order;
    at = 0;
  }
  state.at[scenario] = at + 1;
  const index = order[at] as number;
  return { text: pool[index] as string, scenario, index };
}

/** Whether the scenario may speak now: under its cap, past its own gap, and past the voice's. */
function may(state: VoiceState, scenario: VoiceScenario): boolean {
  const rule = CAPS[scenario];
  const said = state.said[scenario] ?? 0;
  if (said >= rule.cap) return false;
  const last = state.last[scenario];
  if (last !== undefined && state.elapsed - last < rule.gap) return false;
  if (!URGENT.has(scenario) && state.since < VOICE_GAP_S) return false;
  return true;
}

/**
 * One frame. Returns the state and the line to say (its text and its clip), or null. The timers
 * step whether or not a line comes, so a scenario's moment is not lost to
 * the cooldown: it speaks when the gap allows, if its condition still holds.
 */
export function stepInnerVoice(prev: VoiceState, input: VoiceInputs, dt: number): { state: VoiceState; line: VoiceLine | null } {
  const state: VoiceState = { ...prev, said: { ...prev.said }, last: { ...prev.last }, order: { ...prev.order }, at: { ...prev.at } };
  state.elapsed += dt;
  state.since += dt;
  // The timers.
  state.offTrailFor = input.offTrail > OFF_TRAIL_M ? state.offTrailFor + dt : 0;
  state.stillFor = input.moving ? 0 : state.stillFor + dt;
  state.darkUnlitFor = input.night >= OFF_TRAIL_NIGHT && !input.lamp ? state.darkUnlitFor + dt : 0;
  if (input.shadeSeen) { state.shadeFor += dt; state.shadeGoneFor = 0; } else if (state.shadeFor > 0) state.shadeGoneFor += dt;
  if (input.cry) state.cries += 1;
  const chaseBegan = input.chase && !state.wasChase;
  state.wasChase = input.chase;
  if (input.ended) return { state, line: null };

  // The scenarios, first that holds and may speak wins; the urgent ones first.
  const candidates: VoiceScenario[] = [];
  if (input.chase && (chaseBegan || (state.said.chaseStart ?? 0) === 0)) candidates.push("chaseStart");
  if (input.safe) candidates.push("safe");
  if (input.nearBody && !input.chase) candidates.push("body");
  if (input.hollowSeen && !input.chase) candidates.push("hollow");
  if (input.cry && state.cries === 1) candidates.push("cryFirst");
  if (input.chase) {
    if (state.offTrailFor >= OFF_TRAIL_S / 2 && input.offTrail > OFF_TRAIL_M + 2) candidates.push("chaseOffTrail");
  } else {
    if (input.cry && state.cries === 2) candidates.push("cryAgain");
    if (input.nearCap) candidates.push("cap");
    if (input.shadeSeen && state.shadeFor > 0.3) candidates.push("shadeFirst");
    if (!input.shadeSeen && state.shadeFor > 0 && state.shadeGoneFor >= SHADE_GONE_S && (state.said.shadeFirst ?? 0) > 0) candidates.push("shadeGone");
    if (input.stare >= DONT_LOOK && input.night >= OFF_TRAIL_NIGHT) candidates.push("dontLook");
    if (state.offTrailFor >= OFF_TRAIL_S) candidates.push(input.night >= OFF_TRAIL_NIGHT ? "offTrailNight" : "offTrailDay");
    if (input.mist >= 0.2 && input.mist <= 0.6) candidates.push("mist");
    if (state.darkUnlitFor >= UNLIT_S) candidates.push("lamp");
    if (input.night >= 0.3 && input.night <= 0.7) candidates.push("dusk");
    if (input.wet >= 0.5 && input.wet < 1) candidates.push("rain");
    if (input.night >= OFF_TRAIL_NIGHT && state.stillFor >= STILL_S) candidates.push("still");
    if (input.climb >= 0.9) candidates.push("crest");
    if (input.climb < 0.03 && state.elapsed >= VOICE_FIRST_S) candidates.push("trailhead");
  }
  for (const scenario of candidates) {
    if (input.chase && !CHASE_ONLY.has(scenario)) continue;
    if (!may(state, scenario)) continue;
    state.said[scenario] = (state.said[scenario] ?? 0) + 1;
    state.last[scenario] = state.elapsed;
    state.since = 0;
    return { state, line: draw(state, scenario) };
  }
  return { state, line: null };
}
