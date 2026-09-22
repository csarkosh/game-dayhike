/**
 * Escalation and atmosphere (docs/gameplay/2026-09-16-escalation-and-atmosphere.md):
 * two numbers computed on every client from state every peer already has.
 * The world — shared, never falling — is how far up the stem the party's
 * best living climber has reached, and 1 once the chase has begun, and it
 * takes the sun from the base hour to night and the weather toward the
 * eerie preset. The lens — yours — is being off the trail or the nearest
 * Hollow's closeness, and it lifts the dread the grade and the wildlife
 * read. Nothing here is authoritative; nothing crosses the wire.
 */
import { Phase, type WorldState, type Vec3 } from "../sim/types.js";
import { isHollowState } from "../sim/hollow.js";
import { trailDistance, type TrailGraph } from "../sim/trail.js";
import { stemProgress } from "../sim/trailRoute.js";
import type { BoxProvider } from "../sim/boxSource.js";
import type { GroundField } from "../sim/ground.js";
import { hasLineOfSight } from "../sim/ai.js";
import { PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { WEATHER_PRESETS, lerpWeather, type WeatherParams } from "./weather.js";
import { clamp01 } from "./colour.js";

/** Metres from the nearest trail edge at which "off the trail" begins: the corridor's 7 m plus 3. */
export const OFF_TRAIL_START = 10;
/** Metres out at which the spike rises at full rate. */
export const OFF_TRAIL_FULL = 60;
/** Seconds off the trail, at full rate, to fill the spike. */
export const SPIKE_RISE_S = 20;
/** Seconds on the trail to empty it. */
export const SPIKE_DECAY_S = 8;
/** Within this of the eye the Hollow's nearness is total. */
export const NEAR_FULL = 10;
/** Beyond this it is nothing. */
export const NEAR_START = 80;
/** The nearness's share without line of sight: still there, still felt. */
export const NEAR_BLIND = 0.5;
/** The hour the world reaches at full escalation: the sun is up 6–18. */
export const NIGHT_HOUR = 22;
/** The sky's sunrise; a base before it is already dark and stays. */
export const DAWN_HOUR = 6;
/** Time constant of the world's easing, seconds: the light goes over about a minute. */
export const WORLD_EASE_S = 20;
/** Time constant of the lens's easing, seconds. */
export const LENS_EASE_S = 1.5;

export type EscalationTargets = {
  /** The party's best living climb up the stem before the ratchet, or 1 in the chase. */
  world: number;
  /** The local player's distance past the corridor, 0 on the trail to 1 at OFF_TRAIL_FULL. */
  offTrail: number;
  /** The nearest Hollow's closeness to the local eye, 0 to 1. */
  near: number;
  /** The local player is dead: their spike and lens hold. */
  dead: boolean;
};

export type EscalationState = {
  /** The highest world target seen: the sky never brightens. */
  progressMax: number;
  /** The off-trail spike, integrated. */
  spike: number;
  /** The eased world, 0 to 1. */
  world: number;
  /** The eased lens, 0 to 1. */
  lens: number;
};

export const ESCALATION_REST: EscalationState = Object.freeze({ progressMax: 0, spike: 0, world: 0, lens: 0 });

export type AtmosphereBase = { weather: WeatherParams; hour: number };

/** The raw inputs from state. Pure. */
export function escalationTargets(
  state: WorldState,
  localId: number,
  graph: TrailGraph,
  boxes: BoxProvider,
  ground: GroundField | null,
): EscalationTargets {
  const hollows: Vec3[] = [];
  for (const e of state.enemies.values()) {
    if (!isHollowState(e.ai)) continue;
    hollows.push(e.pos);
  }

  let world = 0;
  if (state.phase === Phase.Chase) world = 1;
  else {
    for (const p of state.players.values()) {
      if (p.health <= 0) continue;
      const progress = 1 - stemProgress(graph, p.pos.x, p.pos.z);
      if (progress > world) world = progress;
    }
  }

  const me = state.players.get(localId);
  if (me === undefined) return { world, offTrail: 0, near: 0, dead: false };

  const d = trailDistance(graph, me.pos.x, me.pos.z);
  const offTrail = clamp01((d - OFF_TRAIL_START) / (OFF_TRAIL_FULL - OFF_TRAIL_START));

  const eye: Vec3 = { x: me.pos.x, y: me.pos.y + PLAYER_EYE_OFFSET, z: me.pos.z };
  let near = 0;
  for (const h of hollows) {
    const dx = h.x - eye.x;
    const dy = h.y - eye.y;
    const dz = h.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let n = clamp01((NEAR_START - dist) / (NEAR_START - NEAR_FULL));
    if (n > 0 && !hasLineOfSight(eye, h, boxes, ground)) n *= NEAR_BLIND;
    if (n > near) near = n;
  }
  return { world, offTrail, near, dead: me.health <= 0 };
}

/** First-order lag toward `to` with time constant `tau`, seconds. */
function lag(from: number, to: number, dt: number, tau: number): number {
  if (dt <= 0) return from;
  return from + (to - from) * (1 - Math.exp(-dt / tau));
}

/**
 * One frame of the state: the ratchet, the spike's rise or decay, the two
 * lags. A dead player's spike and lens hold; the world keeps moving. Pure.
 */
export function stepEscalation(prev: EscalationState, t: EscalationTargets, dt: number): EscalationState {
  if (dt <= 0) return prev;
  const progressMax = Math.max(prev.progressMax, clamp01(t.world));
  const world = lag(prev.world, progressMax, dt, WORLD_EASE_S);
  if (t.dead) return { progressMax, spike: prev.spike, world, lens: prev.lens };
  const spike =
    t.offTrail > 0
      ? Math.min(1, prev.spike + (t.offTrail / SPIKE_RISE_S) * dt)
      : Math.max(0, prev.spike - dt / SPIKE_DECAY_S);
  const lens = lag(prev.lens, Math.max(spike, clamp01(t.near)), dt, LENS_EASE_S);
  return { progressMax, spike, world, lens };
}

function smootherstep(x: number): number {
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * The sky and the weather for an eased state: the sun from the base hour to
 * NIGHT_HOUR (a base already past it, or before DAWN_HOUR, stays), the
 * weather from the base preset to eerie, both by smootherstep of the world;
 * then dread lifted to the lens.
 */
export function atmosphereUnder(base: AtmosphereBase, s: EscalationState): AtmosphereBase {
  const e = smootherstep(clamp01(s.world));
  const hour =
    base.hour >= NIGHT_HOUR || base.hour <= DAWN_HOUR ? base.hour : base.hour + (NIGHT_HOUR - base.hour) * e;
  const weather = lerpWeather(base.weather, WEATHER_PRESETS.eerie, e);
  const lens = clamp01(s.lens);
  return { weather: { ...weather, dread: Math.min(1, Math.max(weather.dread, lens)) }, hour };
}
