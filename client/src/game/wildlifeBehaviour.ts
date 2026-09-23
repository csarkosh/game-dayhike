/**
 * What ambient wildlife is doing. Pure: (unit, tick, player positions, seed, hour,
 * disturbances) in, poses and events out. Every random draw is
 * hash3(unit.id, episode, salt, seed) and every phase measures time from its
 * own start, so two peers whose flee trigger differs by a snapshot's latency
 * draw the same refuge and the same dwell and converge at the next settle —
 * the self-healing property the design relies on. The one exception is the call
 * schedule, which is keyed on the ABSOLUTE tick slot instead (like
 * rest wander), because a call must land on the same tick for every peer
 * regardless of when each one's UnitState was created.
 * Renderer-only; the foliagePlugin.ts rule on constants applies.
 */
import { hash3 } from "../sim/field.js";
import { elevationAt } from "../sim/terrain.js";
import { SIM_TICK_HZ, TICK_DT } from "../sim/constants.js";
import { clamp01 } from "./colour.js";
import type { WeatherParams } from "./weather.js";
import {
  FIRST_BIRD_SPECIES, GIANT_TRUNK_RADIUS_PER_SCALE, SPECIES_COUNT, SPECIES_DEER, SPECIES_EAGLE, SPECIES_ELK,
  SPECIES_GULL, SPECIES_RABBIT, SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, SPECIES_SQUIRREL, RAVEN_PERCH_HEIGHT,
  WILDLIFE_SPREAD, type WildlifeUnit,
} from "./wildlifeField.js";

/**
 * Which animation clip a creature's model plays. Defined here, not in
 * creatureModel.ts (which re-exports it), because wildlifeBehaviour.ts is the
 * pure state machine that decides it; the model just plays what it is told.
 */
export type ClipRole = "graze" | "idle" | "walk" | "run" | "alert";

export const PHASE_REST = 0;   // graze · forage · perched · loop
export const PHASE_ALERT = 1;  // alert · freeze · alarm run
export const PHASE_FLEE = 2;   // flee · bolt · climb · circle
export const PHASE_SETTLE = 3; // graze at refuge · hidden · treed
export const PHASE_RETURN = 4; // walk back · hop back · descend · land
/**
 * Walking (or flying) to a mark the wildlife director picked, then handing back to REST
 * there. It sorts ABOVE PHASE_RETURN numerically, so every `phase >= PHASE_FLEE` test in
 * this file — all of which mean "the squirrel is on the trunk" — is written out as the
 * three phases it actually means (see `squirrelOnTrunk`) rather than as an inequality a
 * cued animal would fall into.
 */
export const PHASE_CUE = 5;   // walk to the director's mark

export const CALL_RAVEN_CROAK = 0;
export const CALL_GULL_CRY = 1;
export const CALL_ELK_BUGLE = 2;
export const CALL_ELK_BARK = 3;
export const CALL_SQUIRREL_CHATTER = 4;
export const CALL_EAGLE_CRY = 5;
export const CALL_COUNT = 6;

// Elk and deer. Speeds m/s, ranges m, intervals s.
export const ELK_ALERT_RANGE = 45;
export const ELK_FLEE_RANGE = 28;
export const ELK_FLEE_SPEED = 9;
export const ELK_SETTLE_SECONDS = 60;
export const ELK_SETTLE_CLEAR = 80;
export const ELK_WALK_SPEED = 2;
export const ELK_WANDER = 3;
/** A flee entered from SETTLE (or already within this of the refuge) runs away from the
 * nearest player instead of re-targeting the refuge — the refuge is
 * only a meaningful goal for the FIRST flee out of REST/RETURN. */
export const ELK_FLEE_AWAY = 100;
export const ELK_REFUGE_ARRIVE = 10;
/** Half-width of the away-flee's episode-keyed heading jitter (degrees). */
export const ELK_FLEE_AWAY_JITTER_DEG = 20;
/** A refuge whose bearing from the herd lies within this of the bearing to the nearest
 * player is not a refuge — running to it runs THROUGH the player (observed in the
 * browser: a herd closed 22.7 m → 7.5 m in two seconds and then grazed in the player's face).
 * Such a flee takes the away-from-the-player rule instead; the refuge is still preferred
 * for every other bearing, which is most of them. */
export const ELK_REFUGE_PLAYER_CONE_DEG = 60;
/** A re-flee out of SETTLE cannot fire until the herd has held the settle this long —
 * without this, a player standing at the refuge (d ≤ ELK_FLEE_RANGE
 * forever) drives a flee → arrive-immediately → settle → re-flee livelock every tick. */
export const MIN_SETTLE_HOLD = 1;
/** An elk in REST or RETURN only re-enters ALERT once the nearest player has closed at
 * least this much further than the distance recorded at the LAST alert —
 * otherwise a stationary player sitting inside ELK_ALERT_RANGE re-triggers ALERT
 * every time it expires (ALERT freezes the lead, so the distance never reads as
 * "closing", and the old code always reset to REST on expiry regardless of which phase
 * it had interrupted). */
export const ALERT_REARM = 5;
/** Rest behaviour is a pure function of the ABSOLUTE tick on this grid (s): every slot draws a
 * "move or stay" and a goal from hash3(unit, slot), so two peers whose last episode ended a few
 * ticks apart converge the moment both reach the current slot's goal — the self-healing property.
 * Per-species graze/hide/forage dwell ranges (elk 4–12 s, rabbit 3–8 s, squirrel 2–6 s) are
 * superseded by these fixed-cadence absolute grids rather than honoured directly — an absolute
 * *range* would need its own slot-keyed draw to stay tick-pure, which was judged not worth the
 * complexity for a cosmetic cadence (the old `*_DWELL` exports that recorded
 * those ranges were dead code and have been deleted). */
export const ELK_REST_GRID = 8;
export const RABBIT_REST_GRID = 5;
export const SQUIRREL_REST_GRID = 4;
export const REST_MOVE_SHARE = 0.6;
export const ELK_ALERT_SECONDS: readonly [number, number] = [1, 2];
export const MEMBER_DELAY: readonly [number, number] = [0.2, 0.6];
// Rabbit
export const RABBIT_FREEZE_RANGE = 18;
export const RABBIT_BOLT_RANGE = 9;
export const RABBIT_BOLT_SPEED = 8;
export const RABBIT_RETURN_SPEED = 3;
export const RABBIT_FREEZE_SECONDS: readonly [number, number] = [1, 3];
export const RABBIT_HOP = 2;
export const RABBIT_LEGS: readonly [number, number] = [2, 3];
export const RABBIT_HIDDEN_SECONDS: readonly [number, number] = [20, 40];
// Squirrel
export const SQUIRREL_ALARM_RANGE = 12;
export const SQUIRREL_RUN_SPEED = 6;
export const SQUIRREL_CLIMB_SPEED = 3;
export const SQUIRREL_CLIMB: readonly [number, number] = [6, 10];
export const SQUIRREL_TREED_SECONDS: readonly [number, number] = [30, 60];
export const SQUIRREL_TREED_CLEAR = 15;
export const SQUIRREL_FORAGE_RADIUS = 6;
export const SQUIRREL_FORAGE_SPEED = 2.5;
/**
 * How far OUTSIDE the trunk's surface a clinging squirrel's origin sits (m). The full
 * offset from the trunk axis is GIANT_TRUNK_RADIUS_PER_SCALE × the tree's drawn scale plus
 * this, so it grows with the tree instead of the flat 0.35 m that was found
 * buried in the wood at 4/4 orbit stations when checked in the browser. The origin is the animal's feet and,
 * belly-to-the-bark, the body hangs OUTWARD from it — so this is the paws' gap from the bark,
 * measured 0.11 m at 0.12 and brought down to a
 * touch.
 */
export const SQUIRREL_CLING_CLEARANCE = 0.03;
// Birds
export const RAVEN_LIFT_RANGE = 30;
/** A roost also lifts when a same-tick disturbance (another unit's flee start, fed in by
 * the shell from the previous frame's events) lands within this of the roost. */
export const RAVEN_DISTURB_RANGE = 80;
export const RAVEN_CIRCLE_SECONDS: readonly [number, number] = [60, 90];
/**
 * How fast a raven changes height on a take-off or a landing (m/s), and the seconds that
 * blend is allowed to take. Both directions read the same numbers: the climb and the
 * descent are the same distance, so a fixed duration would give the two opposite speeds
 * whenever the loop moved.
 *
 * A DURATION, not a constant: the loop altitude is now canopy-relative
 * (`RAVEN_ROOST_CLEARANCE`), so it runs from the 40 m floor to well past 100 m in a tall
 * stand, and the fixed 3 s this replaced meant a 16–23 m/s average climb — 32–45 m/s at the
 * ease-out's steepest, against a horizontal RAVEN_SPEED of 10. Take-off used to read as
 * a cut; a 3 s blend over 60 m is a cut with motion blur. 8 m/s is a
 * corvid climbing hard, and the clamp keeps the shortest climbs from snapping and the
 * tallest from turning into a minute of ascent.
 */
export const RAVEN_CLIMB_MPS = 8;
export const RAVEN_BLEND_SECONDS: readonly [number, number] = [3, 12];
export const RAVEN_SPEED = 10;
export const GULL_SPEED = 12;
export const EAGLE_SPEED = 8;
export const GULL_GLIDE: readonly [number, number] = [2, 5];
// Calls, seconds
export const RAVEN_CROAK_INTERVAL: readonly [number, number] = [20, 60];
export const GULL_CRY_INTERVAL: readonly [number, number] = [8, 25];
export const ELK_BUGLE_INTERVAL: readonly [number, number] = [120, 300];
export const SQUIRREL_CHATTER_INTERVAL: readonly [number, number] = [15, 40];
export const EAGLE_CRY_INTERVAL: readonly [number, number] = [180, 480];
export const DAWN_HOUR = 6;
export const DUSK_HOUR = 20;
export const DAWN_DUSK_WINDOW = 1.5;
export const DAWN_DUSK_BUGLE_BOOST = 3;
/** Ticks integrated per call at most; beyond this the state jumps (a tab that was hidden). */
const MAX_CATCHUP_TICKS = 6;

export type PlayerPoint = { x: number; z: number };
export type MemberPose = { x: number; z: number; y: number; yaw: number; pitch: number; scale: number; clip: ClipRole; wing: number };
export type UnitState = {
  unit: WildlifeUnit; phase: number; episode: number; phaseStart: number; lastTick: number;
  x: number; z: number; y: number; yaw: number; goalX: number; goalZ: number; dwell: number; leg: number; legs: number;
  /** Metres of trunk height climbed/climbing-to (squirrel only) — kept distinct from `dwell`
   * (a seconds field for every other species) so the two units can't be mixed up. */
  climbTarget: number;
  climb: number;
  /** Elk/deer only. The nearest-player distance recorded at the last ALERT entry; an
   * ALERT can re-arm only once the player has closed ALERT_REARM further than this.
   * Infinity initially and whenever the player leaves ELK_SETTLE_CLEAR. */
  alertD: number;
  /** Elk/deer only. The phase ALERT interrupted (REST or RETURN) — resumed, not reset to
   * REST, when the alert expires without the player closing. */
  resumePhase: number;
  /** PHASE_CUE only: whether this cue is a bolt rather than a stroll — it picks both the
   * speed the mark is reached at and the clip played on the way. */
  cueRun: boolean;
  slot: number; prevD: number; poses: MemberPose[];
  /** False until a pose pass has written `poses` at least once. Bird poses are seated on
   * the GROUND at creation (`createUnitState` has no loop geometry to seat them on and
   * `poseBirds` has not run yet), so a call scheduled on a bird's very first tick would
   * otherwise be emitted from under the loop centre — up to 250 m of y error for an eagle,
   * and, now that the audio gates in 3-D, a wrongly kept or wrongly dropped voice. */
  posed: boolean;
  /** Per-member offset angle (rad), spread radius (m) and join-delay (ticks), drawn once
   * at creation instead of every frame in `poseGround`. Unused
   * by squirrel (single member, its own on-trunk pose logic) and by bird species
   * (`poseBirds` draws its own per-frame loop phase, which does need to vary with time). */
  memberOffsets: readonly { a: number; r: number; delay: number }[];
};
export type WildlifeEvent =
  | { kind: "call"; call: number; x: number; y: number; z: number; species: number }
  | { kind: "lift"; unit: UnitState }
  /** Pushed at every species' flee start — the shell collects these
   * across all units each frame and feeds them back in as next frame's `disturbances`. */
  | { kind: "flee"; x: number; z: number; species: number };

const SALT_DWELL = 1, SALT_WANDER_A = 2, SALT_WANDER_R = 3, SALT_ALERT = 4, SALT_SETTLE = 5, SALT_LEGS = 6, SALT_HIDDEN = 7,
  SALT_CLIMB = 8, SALT_TREED = 9, SALT_CIRCLE = 10, SALT_CALL = 11, SALT_AWAY = 12, SALT_MEMBER = 20;

function draw(u: UnitState, salt: number, seed: number): number {
  return hash3(u.unit.id, u.episode, salt, seed);
}
function range(t: number, r: readonly [number, number]): number {
  return r[0] + t * (r[1] - r[0]);
}
function seconds(u: UnitState, tick: number): number {
  return (tick - u.phaseStart) / SIM_TICK_HZ;
}
/** Seconds a roost's take-off or landing blend takes, from the climb it has to cover.
 * Pure in the unit, so both directions and the phase machine agree. */
export function ravenBlendSeconds(unit: WildlifeUnit): number {
  const climb = Math.abs(unit.altitude - RAVEN_PERCH_HEIGHT) / RAVEN_CLIMB_MPS;
  return Math.min(RAVEN_BLEND_SECONDS[1], Math.max(RAVEN_BLEND_SECONDS[0], climb));
}
/** Shortest-arc interpolation between two headings (rad). */
function lerpAngle(from: number, to: number, t: number): number {
  const twoPi = 2 * Math.PI;
  let d = (to - from) % twoPi;
  if (d > Math.PI) d -= twoPi;
  else if (d < -Math.PI) d += twoPi;
  return from + d * t;
}
/** Reused across calls: every caller destructures `{ d, p }` into
 * locals immediately, so mutating this one object between calls is invisible to them —
 * no call site holds a `nearest()` result live across a later `nearest()` call. */
const nearestScratch: { d: number; p: PlayerPoint | null } = { d: Infinity, p: null };
function nearest(players: readonly PlayerPoint[], x: number, z: number): { d: number; p: PlayerPoint | null } {
  nearestScratch.d = Infinity;
  nearestScratch.p = null;
  for (const q of players) {
    const dd = Math.hypot(q.x - x, q.z - z);
    if (dd < nearestScratch.d) { nearestScratch.d = dd; nearestScratch.p = q; }
  }
  return nearestScratch;
}
function enter(u: UnitState, phase: number, tick: number): void {
  u.phase = phase;
  u.phaseStart = tick;
}
/** Advance the lead toward its goal by `speed·dt`; returns true on arrival. Sets `yaw`
 * whenever there is a meaningful direction, including the arrival tick — previously
 * a unit that started a phase already at its goal (e.g. an alert that
 * begins with the lead already at the trunk) never got a yaw at all. */
function moveToward(u: UnitState, speed: number): boolean {
  const dx = u.goalX - u.x;
  const dz = u.goalZ - u.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-9) u.yaw = Math.atan2(dx, dz);
  const step = speed * TICK_DT;
  if (d <= step) { u.x = u.goalX; u.z = u.goalZ; return true; }
  u.x += (dx / d) * step;
  u.z += (dz / d) * step;
  return false;
}
function closing(prev: number, now: number): boolean {
  return now < prev - 1e-6;
}
/**
 * Rest wander on the species' absolute grid: when the tick enters a new slot, draw whether to
 * move and where (a polar offset within `radius` of the anchor). Keyed on the slot, not the
 * episode, so it is identical on every peer regardless of when the last episode ended.
 */
function restWander(u: UnitState, tick: number, seed: number, gridSeconds: number, radius: number): void {
  const slot = Math.floor(tick / (gridSeconds * SIM_TICK_HZ));
  if (slot === u.slot) return;
  u.slot = slot;
  if (hash3(u.unit.id, slot, SALT_DWELL, seed) >= REST_MOVE_SHARE) return;
  const a = hash3(u.unit.id, slot, SALT_WANDER_A, seed) * 2 * Math.PI;
  const r = Math.sqrt(hash3(u.unit.id, slot, SALT_WANDER_R, seed)) * radius;
  u.goalX = u.unit.x + r * Math.cos(a);
  u.goalZ = u.unit.z + r * Math.sin(a);
}

/**
 * The three phases a squirrel spends clinging to its trunk. Written out rather than left
 * as `phase >= PHASE_FLEE`, which PHASE_CUE (5) also satisfies — a cued squirrel is
 * crossing the forest floor, not hanging off the bark.
 */
function squirrelOnTrunk(phase: number): boolean {
  return phase === PHASE_FLEE || phase === PHASE_SETTLE || phase === PHASE_RETURN;
}

export function clipForPhase(species: number, phase: number, moving: boolean, running = false): ClipRole {
  // A cue is the one phase whose gait the phase alone does not give away: the same walk to
  // the same mark is a stroll or a bolt depending on which the director asked for.
  if (phase === PHASE_CUE) return running ? "run" : "walk";
  // The squirrel file carries {graze, walk, run, alert} and no `idle`, and role `idle`
  // falls back to `graze` — so the old {run, idle} special-case made `alert` unreachable
  // and left a squirrel clinging head-up to the bark playing the grazing clip, neck down
  // 55° (observed in the browser: `Alert` in 0 of 96 samples). It now asks
  // for the three roles it can actually play: anything under way runs (the 6 m/s dash to
  // the trunk, the climb, the descent, a forage step), a still alarmed or treed squirrel
  // holds `alert` — `creatureModel.play` holds that one-shot's last frame, head up — and
  // a settled forager grazes. `moving` is checked FIRST so the dash keeps its "run" clip
  // even though `poseGround` also counts the squirrel's ALERT as moving,
  // precisely because, unlike every other ground species, its ALERT is not a freeze.
  if (species === SPECIES_SQUIRREL) {
    if (moving) return "run";
    return phase === PHASE_ALERT || phase === PHASE_SETTLE ? "alert" : "graze";
  }
  switch (phase) {
    case PHASE_ALERT: return "alert";
    case PHASE_FLEE: return "run";
    case PHASE_RETURN: return "walk";
    default: return moving ? "walk" : "graze";
  }
}

export function createUnitState(unit: WildlifeUnit, tick: number, seed: number): UnitState {
  const u: UnitState = {
    unit, phase: PHASE_REST, episode: 0, phaseStart: tick, lastTick: tick,
    x: unit.x, z: unit.z, y: unit.h, yaw: 0, goalX: unit.x, goalZ: unit.z, dwell: 0, leg: 0, legs: 0,
    climbTarget: 0, climb: 0, alertD: Infinity, resumePhase: PHASE_REST, cueRun: false, slot: -1, prevD: Infinity, poses: [],
    posed: false, memberOffsets: [],
  };
  const offsets: { a: number; r: number; delay: number }[] = [];
  for (let m = 0; m < unit.members; m++) {
    const a = hash3(unit.id, m, SALT_MEMBER, seed) * 2 * Math.PI;
    const r = hash3(unit.id, m, SALT_MEMBER + 1, seed) * WILDLIFE_SPREAD[unit.species]!;
    const delay = Math.round(range(hash3(unit.id, m, SALT_MEMBER + 2, seed), MEMBER_DELAY) * SIM_TICK_HZ);
    offsets.push({ a, r, delay });
    u.poses.push({ x: unit.x + r * Math.cos(a), z: unit.z + r * Math.sin(a), y: unit.h, yaw: a, pitch: 0, scale: 1, clip: "graze", wing: 1 });
  }
  u.memberOffsets = offsets;
  return u;
}

/**
 * The species' effective call interval `[lo, hi]` (s) for the CURRENT `hour` — for elk,
 * the whole interval (not just where a draw lands inside it) shrinks by
 * DAWN_DUSK_BUGLE_BOOST near dawn/dusk, because a boost that only moved the draw earlier
 * inside an unchanged slot would leave the slot length (and so the true firing rate)
 * unchanged — it has to shrink the slot for "×3 as often" to mean anything. `hour` is read
 * at fire time, so this needs no per-unit state. `[0, 0]` marks a
 * silent species (deer, rabbit; elk's bark and squirrel's alarm chatter are pushed
 * directly by their state machines, not scheduled here).
 */
function callIntervalNow(species: number, hour: number): readonly [number, number] {
  if (species === SPECIES_ELK) {
    const nearDawnDusk = Math.abs(hour - DAWN_HOUR) <= DAWN_DUSK_WINDOW || Math.abs(hour - DUSK_HOUR) <= DAWN_DUSK_WINDOW;
    return nearDawnDusk ? [ELK_BUGLE_INTERVAL[0] / DAWN_DUSK_BUGLE_BOOST, ELK_BUGLE_INTERVAL[1] / DAWN_DUSK_BUGLE_BOOST] : ELK_BUGLE_INTERVAL;
  }
  if (species === SPECIES_RAVEN_ROOST || species === SPECIES_RAVEN_PAIR) return RAVEN_CROAK_INTERVAL;
  if (species === SPECIES_GULL) return GULL_CRY_INTERVAL;
  if (species === SPECIES_SQUIRREL) return SQUIRREL_CHATTER_INTERVAL;
  if (species === SPECIES_EAGLE) return EAGLE_CRY_INTERVAL;
  return [0, 0];
}
function callFor(species: number): number {
  switch (species) {
    case SPECIES_ELK: return CALL_ELK_BUGLE;
    case SPECIES_RAVEN_ROOST: case SPECIES_RAVEN_PAIR: return CALL_RAVEN_CROAK;
    case SPECIES_GULL: return CALL_GULL_CRY;
    case SPECIES_SQUIRREL: return CALL_SQUIRREL_CHATTER;
    case SPECIES_EAGLE: return CALL_EAGLE_CRY;
    default: throw new Error(`wildlife: species ${species} has no scheduled call`);
  }
}
/**
 * The scheduled call (bugle/croak/cry/chatter), keyed on the ABSOLUTE tick slot instead of
 * anything carried on `UnitState`: `slot = floor(tick / slotTicks)`
 * (slotTicks = the species' current-hour interval max — see `callIntervalNow`), and the
 * call for that slot fires at `slotStart + hash3(id, slot, SALT_CALL, seed) · range(interval)`.
 * A pure function of (id, seed, tick, hour) — identical on every peer and unaffected by when
 * a unit's state was created or how long it has been off-disc, and it fires only if the unit
 * happens to be in its calling phase on the exact tick the slot's draw lands on (no catch-up
 * retry — a slot's call is simply lost if the unit is mid-flee when it lands).
 */
function scheduledCall(u: UnitState, tick: number, seed: number, hour: number, out: WildlifeEvent[]): void {
  const s = u.unit.species;
  const interval = callIntervalNow(s, hour);
  const maxInterval = interval[1];
  if (maxInterval <= 0) return;
  const slotTicks = Math.round(maxInterval * SIM_TICK_HZ);
  const slot = Math.floor(tick / slotTicks);
  const slotStart = slot * slotTicks;
  const slotDraw = hash3(u.unit.id, slot, SALT_CALL, seed);
  const fireTick = slotStart + Math.round(range(slotDraw, interval) * SIM_TICK_HZ);
  if (tick !== fireTick) return;
  // Which phases a species calls in: ravens perched, gulls and eagles aloft,
  // elk grazing, squirrels treed. Deer and rabbits are silent (maxInterval == 0).
  const calls =
    (s === SPECIES_ELK && u.phase === PHASE_REST) ||
    (s === SPECIES_RAVEN_ROOST && u.phase === PHASE_REST) || s === SPECIES_RAVEN_PAIR || s === SPECIES_GULL || s === SPECIES_EAGLE ||
    (s === SPECIES_SQUIRREL && u.phase === PHASE_SETTLE);
  if (!calls) return;
  // A treed squirrel's mouth is at the climbed height, not the trunk's base — u.x/u.z/u.y
  // stay pinned near the base while climbing.
  const y = s === SPECIES_SQUIRREL && squirrelOnTrunk(u.phase) ? u.unit.homeH + u.climb : u.y;
  // A flier calls from the BIRD, not from the centre of the circle it is flying.
  // `u.x/u.z` is the loop centre for every aloft species, and an eagle's loop
  // radius reaches 140 m — its cry originated up to that far from the only eagle on screen.
  // Ground units keep the unit position: their members are within WILDLIFE_SPREAD (≤ 12 m)
  // of it, which is inside the panner's refDistance. The roost is excluded because it only
  // ever schedules a croak while PERCHED, where the unit position IS the perch.
  //
  // The lead pose is at most one stepUnit's worth of ticks stale (poses are written once,
  // after the catch-up loop, while this runs per sub-tick) — under a metre for a gull, far
  // below the error being fixed. Before the first pose pass there is no seat to read at
  // all; see `posed`.
  if (s >= FIRST_BIRD_SPECIES && s !== SPECIES_RAVEN_ROOST) {
    // Aloft: the call comes from the bird. Skipped rather than faked while `poses` are
    // still their ground seats — one lost slot at most, against a call
    // arriving from a point on the forest floor.
    const lead = u.posed ? u.poses[0] : undefined;
    if (lead !== undefined) out.push({ kind: "call", call: callFor(s), species: s, x: lead.x, y: lead.y, z: lead.z });
    return;
  }
  out.push({ kind: "call", call: callFor(s), species: s, x: u.x, y, z: u.z });
}

/**
 * True when the refuge lies inside the ELK_REFUGE_PLAYER_CONE_DEG cone around the nearest
 * player, as seen from the herd — i.e. when "run to the refuge" and "run at the player"
 * are the same instruction. Compared as a dot product of the two unit
 * bearings rather than as a difference of `atan2` angles, which would have to be unwrapped
 * across ±π. A herd standing on top of the player (len 0) counts as through: there is no
 * meaningful bearing to be outside the cone.
 */
function refugeThroughPlayer(u: UnitState, p: PlayerPoint | null, rdx: number, rdz: number, distToRefuge: number): boolean {
  if (p === null || distToRefuge <= 1e-9) return false;
  const pdx = p.x - u.x, pdz = p.z - u.z;
  const pd = Math.hypot(pdx, pdz);
  if (pd <= 1e-9) return true;
  const cos = (rdx * pdx + rdz * pdz) / (distToRefuge * pd);
  return cos >= Math.cos(ELK_REFUGE_PLAYER_CONE_DEG * Math.PI / 180);
}

/** Elk/deer only. Starts a flee: episode-keyed, refuge-seeking on the FIRST flee out of
 * REST/RETURN, but running away from the nearest player instead — with a seeded ±20°
 * heading jitter — when it is re-triggered out of SETTLE, or when the lead is already
 * within ELK_REFUGE_ARRIVE of the refuge (the refuge is not a useful
 * flee goal once the herd is already there or already fleeing away from it), or when the
 * refuge lies behind the player (see `refugeThroughPlayer`). Also emits
 * the flee-start bark and the cross-species "flee" disturbance event. */
function startElkFlee(u: UnitState, tick: number, seed: number, p: PlayerPoint | null, fromSettle: boolean, out: WildlifeEvent[]): void {
  const rdx = u.unit.refugeX - u.x, rdz = u.unit.refugeZ - u.z;
  const distToRefuge = Math.hypot(rdx, rdz);
  const away = fromSettle || distToRefuge <= ELK_REFUGE_ARRIVE || refugeThroughPlayer(u, p, rdx, rdz, distToRefuge);
  const x0 = u.x, z0 = u.z, y0 = u.y;
  u.episode++;
  enter(u, PHASE_FLEE, tick);
  u.alertD = Infinity;
  if (away) {
    const px = p ? p.x : x0 - Math.sin(u.yaw);
    const pz = p ? p.z : z0 - Math.cos(u.yaw);
    const dx0 = x0 - px, dz0 = z0 - pz;
    const len = Math.hypot(dx0, dz0) || 1;
    const ux = dx0 / len, uz = dz0 / len;
    const jitter = (hash3(u.unit.id, u.episode, SALT_AWAY, seed) - 0.5) * 2 * (ELK_FLEE_AWAY_JITTER_DEG * Math.PI / 180);
    const cosj = Math.cos(jitter), sinj = Math.sin(jitter);
    u.goalX = x0 + (ux * cosj - uz * sinj) * ELK_FLEE_AWAY;
    u.goalZ = z0 + (ux * sinj + uz * cosj) * ELK_FLEE_AWAY;
  } else {
    u.goalX = u.unit.refugeX;
    u.goalZ = u.unit.refugeZ;
  }
  out.push({ kind: "call", call: CALL_ELK_BARK, x: x0, y: y0, z: z0, species: u.unit.species });
  out.push({ kind: "flee", x: x0, z: z0, species: u.unit.species });
}

function stepElk(u: UnitState, tick: number, players: readonly PlayerPoint[], seed: number, out: WildlifeEvent[]): void {
  const { d, p } = nearest(players, u.x, u.z);
  const prevD = u.prevD;
  u.prevD = d;
  // The alert-rearm distance only means anything while the player is still in the
  // neighbourhood; once they leave ELK_SETTLE_CLEAR it is forgotten.
  if (d > ELK_SETTLE_CLEAR) u.alertD = Infinity;
  switch (u.phase) {
    case PHASE_REST: {
      if (d <= ELK_FLEE_RANGE) { startElkFlee(u, tick, seed, p, false, out); break; }
      if (d <= ELK_ALERT_RANGE && u.alertD - d >= ALERT_REARM) {
        u.alertD = d; u.resumePhase = PHASE_REST;
        enter(u, PHASE_ALERT, tick); u.dwell = range(draw(u, SALT_ALERT, seed), ELK_ALERT_SECONDS);
        break;
      }
      restWander(u, tick, seed, ELK_REST_GRID, ELK_WANDER);
      moveToward(u, ELK_WALK_SPEED);
      break;
    }
    case PHASE_ALERT: {
      if (p) u.yaw = Math.atan2(p.x - u.x, p.z - u.z);
      if (d <= ELK_FLEE_RANGE || (seconds(u, tick) >= u.dwell && closing(prevD, d))) {
        startElkFlee(u, tick, seed, p, false, out);
      } else if (seconds(u, tick) >= u.dwell) {
        // Expired without the player closing: resume whatever ALERT interrupted — REST
        // stays REST, RETURN keeps walking to the anchor — never reset to REST outright
        // (an earlier version always reset to REST here, which combined
        // with an unconditional re-alert on the same distance to oscillate forever).
        enter(u, u.resumePhase, tick);
      }
      break;
    }
    case PHASE_FLEE: {
      // Ends ONLY on arrival at the goal — the old `d >= ELK_FLEE_CLEAR`
      // early exit ended the episode at a trajectory-dependent point instead of the seeded
      // one, which is exactly the failure mode the determinism/self-healing tests exist to
      // catch: every episode ends at a seeded point.
      if (moveToward(u, ELK_FLEE_SPEED)) {
        enter(u, PHASE_SETTLE, tick);
        u.dwell = ELK_SETTLE_SECONDS * range(draw(u, SALT_SETTLE, seed), [0.8, 1.2]);
      }
      break;
    }
    case PHASE_SETTLE: {
      // A re-flee out of SETTLE needs MIN_SETTLE_HOLD seconds to have passed —
      // without it, a player parked within ELK_FLEE_RANGE of the refuge re-triggers
      // a flee the instant the herd arrives, which (targeting the same refuge) arrives
      // again the very next tick: a per-tick FLEE⇄SETTLE livelock.
      if (d <= ELK_FLEE_RANGE && seconds(u, tick) >= MIN_SETTLE_HOLD) { startElkFlee(u, tick, seed, p, true, out); break; }
      if (d >= ELK_SETTLE_CLEAR && seconds(u, tick) >= u.dwell) {
        enter(u, PHASE_RETURN, tick); u.goalX = u.unit.x; u.goalZ = u.unit.z; u.alertD = Infinity;
      }
      break;
    }
    case PHASE_RETURN: {
      if (d <= ELK_FLEE_RANGE) { startElkFlee(u, tick, seed, p, false, out); break; }
      if (d <= ELK_ALERT_RANGE && u.alertD - d >= ALERT_REARM) {
        u.alertD = d; u.resumePhase = PHASE_RETURN;
        enter(u, PHASE_ALERT, tick); u.dwell = range(draw(u, SALT_ALERT, seed), ELK_ALERT_SECONDS);
        break;
      }
      if (moveToward(u, ELK_WALK_SPEED)) { enter(u, PHASE_REST, tick); u.slot = -1; }
      break;
    }
  }
}

function stepRabbit(u: UnitState, tick: number, players: readonly PlayerPoint[], seed: number, out: WildlifeEvent[]): void {
  const { d } = nearest(players, u.x, u.z);
  const prevD = u.prevD;
  u.prevD = d;
  const bolt = () => {
    const x0 = u.x, z0 = u.z;
    u.episode++; enter(u, PHASE_FLEE, tick);
    u.legs = Math.round(range(draw(u, SALT_LEGS, seed), RABBIT_LEGS)); u.leg = 0; nextLeg(u, seed);
    out.push({ kind: "flee", x: x0, z: z0, species: u.unit.species });
  };
  switch (u.phase) {
    case PHASE_REST:
      if (d <= RABBIT_BOLT_RANGE) { bolt(); break; }
      if (d <= RABBIT_FREEZE_RANGE) { enter(u, PHASE_ALERT, tick); u.dwell = range(draw(u, SALT_ALERT, seed), RABBIT_FREEZE_SECONDS); break; }
      restWander(u, tick, seed, RABBIT_REST_GRID, RABBIT_HOP);
      moveToward(u, RABBIT_RETURN_SPEED);
      break;
    case PHASE_ALERT:
      if (d <= RABBIT_BOLT_RANGE || (seconds(u, tick) >= u.dwell && closing(prevD, d))) bolt();
      // A freeze that expires with the player still inside RABBIT_FREEZE_RANGE
      // re-arms IN PLACE rather than dropping to REST for the one tick it takes
      // REST to freeze again: the flip ran the clip
      // alert → graze → alert every 1–3 s, and a multi-clip rabbit restarts its
      // held alert pose on that — a visible twitch from a stationary player.
      // The same fix as the elk's re-arm, applied to the rabbit.
      else if (seconds(u, tick) >= u.dwell) enter(u, d <= RABBIT_FREEZE_RANGE ? PHASE_ALERT : PHASE_REST, tick);
      break;
    case PHASE_FLEE:
      if (moveToward(u, RABBIT_BOLT_SPEED)) {
        u.leg++;
        if (u.leg >= u.legs) { u.x = u.unit.refugeX; u.z = u.unit.refugeZ; enter(u, PHASE_SETTLE, tick); u.dwell = range(draw(u, SALT_HIDDEN, seed), RABBIT_HIDDEN_SECONDS); }
        else nextLeg(u, seed);
      }
      break;
    case PHASE_SETTLE:
      if (seconds(u, tick) >= u.dwell && d > RABBIT_FREEZE_RANGE) { enter(u, PHASE_RETURN, tick); u.goalX = u.unit.x; u.goalZ = u.unit.z; }
      break;
    case PHASE_RETURN:
      if (d <= RABBIT_FREEZE_RANGE) { enter(u, PHASE_ALERT, tick); u.dwell = range(draw(u, SALT_ALERT, seed), RABBIT_FREEZE_SECONDS); break; }
      if (moveToward(u, RABBIT_RETURN_SPEED)) { enter(u, PHASE_REST, tick); u.slot = -1; }
      break;
  }
}
/** Zig-zag legs: each leg ends on the straight line to the bush plus a seeded sideways
 * offset that shrinks to zero on the last leg, alternates side by leg parity so the path
 * actually zigs then zags instead of bowing to one side, and is capped
 * at 60% of the remaining distance so it never dominates a short hop. */
function nextLeg(u: UnitState, seed: number): void {
  const f = (u.leg + 1) / u.legs;
  const dx = u.unit.refugeX - u.unit.x;
  const dz = u.unit.refugeZ - u.unit.z;
  const len = Math.hypot(dx, dz) || 1;
  const side = f < 1 ? (hash3(u.unit.id, u.episode, SALT_LEGS + 1 + u.leg, seed) - 0.5) * Math.min(6, 0.6 * len) * (u.leg % 2 ? -1 : 1) : 0;
  u.goalX = u.unit.x + dx * f + (-dz / len) * side;
  u.goalZ = u.unit.z + dz * f + (dx / len) * side;
}

function stepSquirrel(u: UnitState, tick: number, players: readonly PlayerPoint[], seed: number, out: WildlifeEvent[]): void {
  // Squirrel reacts to distance from its fixed home anchor (the trunk), not its own live
  // position — its whole world is the tree, unlike elk/rabbit, which react to the herd's
  // live lead position.
  const { d, p } = nearest(players, u.unit.homeX, u.unit.homeZ);
  switch (u.phase) {
    case PHASE_REST:
      if (d <= SQUIRREL_ALARM_RANGE) {
        const x0 = u.x, z0 = u.z, y0 = u.y;
        u.episode++; enter(u, PHASE_ALERT, tick); u.goalX = u.unit.homeX; u.goalZ = u.unit.homeZ;
        // Alarm chatter fires immediately at the alarm, not just once treed.
        out.push({ kind: "call", call: CALL_SQUIRREL_CHATTER, x: x0, y: y0, z: z0, species: u.unit.species });
        out.push({ kind: "flee", x: x0, z: z0, species: u.unit.species });
        break;
      }
      restWander(u, tick, seed, SQUIRREL_REST_GRID, SQUIRREL_FORAGE_RADIUS);
      moveToward(u, SQUIRREL_FORAGE_SPEED);
      break;
    case PHASE_ALERT:
      if (moveToward(u, SQUIRREL_RUN_SPEED)) { enter(u, PHASE_FLEE, tick); u.climbTarget = range(draw(u, SALT_CLIMB, seed), SQUIRREL_CLIMB); u.climb = 0; }
      break;
    case PHASE_FLEE:
      u.climb = Math.min(u.climbTarget, u.climb + SQUIRREL_CLIMB_SPEED * TICK_DT);
      if (u.climb >= u.climbTarget) { enter(u, PHASE_SETTLE, tick); u.dwell = range(draw(u, SALT_TREED, seed), SQUIRREL_TREED_SECONDS); }
      break;
    case PHASE_SETTLE:
      if (d > SQUIRREL_TREED_CLEAR && seconds(u, tick) >= u.dwell) enter(u, PHASE_RETURN, tick);
      break;
    case PHASE_RETURN:
      if (d <= SQUIRREL_ALARM_RANGE) { enter(u, PHASE_FLEE, tick); u.climbTarget = Math.max(u.climb, SQUIRREL_CLIMB[0]); break; }
      u.climb = Math.max(0, u.climb - SQUIRREL_CLIMB_SPEED * TICK_DT);
      if (u.climb === 0) { enter(u, PHASE_REST, tick); u.slot = -1; }
      break;
  }
  // On the trunk the squirrel sits on the side away from the nearest player. `p` can be
  // null with an empty `players` array; the yaw is simply left as whatever it last was
  // (harmless — it only decides which side of the trunk to render on) rather than reset.
  if (squirrelOnTrunk(u.phase) && p) u.yaw = Math.atan2(u.unit.homeX - p.x, u.unit.homeZ - p.z);
}

/** True if any disturbance point lies within `maxD` of (x, z). A plain indexed loop, not
 * `.some()` with an inline closure — this runs every tick for every roost, including every
 * sub-tick of `stepUnit`'s catch-up loop, so a per-call closure allocation there is exactly
 * the class of per-tick allocation worth avoiding. */
function disturbedNear(disturbances: readonly PlayerPoint[], x: number, z: number, maxD: number): boolean {
  for (let i = 0; i < disturbances.length; i++) {
    const q = disturbances[i]!;
    if (Math.hypot(q.x - x, q.z - z) <= maxD) return true;
  }
  return false;
}

function stepRoost(u: UnitState, tick: number, players: readonly PlayerPoint[], seed: number, disturbances: readonly PlayerPoint[], out: WildlifeEvent[]): void {
  // Roost reacts to distance from its fixed home anchor (the snag), like squirrel — see
  // the comment in stepSquirrel.
  const { d } = nearest(players, u.unit.homeX, u.unit.homeZ);
  const disturbed = disturbedNear(disturbances, u.unit.homeX, u.unit.homeZ, RAVEN_DISTURB_RANGE);
  switch (u.phase) {
    case PHASE_REST:
      if (d <= RAVEN_LIFT_RANGE || disturbed) {
        u.episode++; enter(u, PHASE_FLEE, tick); u.dwell = range(draw(u, SALT_CIRCLE, seed), RAVEN_CIRCLE_SECONDS);
        out.push({ kind: "lift", unit: u });
        out.push({ kind: "call", call: CALL_RAVEN_CROAK, x: u.unit.homeX, y: u.unit.homeH + RAVEN_PERCH_HEIGHT, z: u.unit.homeZ, species: u.unit.species });
        out.push({ kind: "flee", x: u.unit.homeX, z: u.unit.homeZ, species: u.unit.species });
      }
      break;
    case PHASE_FLEE:
      if (seconds(u, tick) >= u.dwell && d > RAVEN_LIFT_RANGE && !disturbed) enter(u, PHASE_RETURN, tick);
      break;
    case PHASE_RETURN: {
      const blend = ravenBlendSeconds(u.unit);
      if (d <= RAVEN_LIFT_RANGE || disturbed) {
        // Startled again mid-landing: RESUME the lift from where the descent had got to
        // rather than restarting it. `enter` resets `phaseStart`, so
        // without this the flock would teleport the remaining tens of metres DOWN to the
        // perch and re-climb — the pop this exists to remove, in the one path that still had
        // it. The landing's weight is linear in its elapsed seconds and the lift's is
        // (1 − k)², so the lift time that carries the same weight is T·(1 − √w).
        const w = clamp01(seconds(u, tick) / blend);
        enter(u, PHASE_FLEE, tick - Math.round(blend * (1 - Math.sqrt(w)) * SIM_TICK_HZ));
        u.dwell = range(draw(u, SALT_CIRCLE, seed), RAVEN_CIRCLE_SECONDS);
        break;
      }
      if (seconds(u, tick) >= blend) enter(u, PHASE_REST, tick);
      break;
    }
  }
}

/**
 * How fast a cue covers the ground: the species' own walk, or the speed it flees at when
 * the director asked for a bolt. A flier has one airspeed and ignores `run`; the
 * fall-through is the corvids', and any flier added beside them states its own.
 *
 * Exported because the director has to know it before it picks a mark. A mark the animal
 * cannot reach while the player is still looking that way is not a cue, so the director
 * budgets the walk in seconds — and seconds are metres only once the speed is known here.
 */
export function cueSpeedFor(species: number, run: boolean): number {
  switch (species) {
    case SPECIES_ELK: case SPECIES_DEER: return run ? ELK_FLEE_SPEED : ELK_WALK_SPEED;
    case SPECIES_RABBIT: return run ? RABBIT_BOLT_SPEED : RABBIT_RETURN_SPEED;
    case SPECIES_SQUIRREL: return run ? SQUIRREL_RUN_SPEED : SQUIRREL_FORAGE_SPEED;
    case SPECIES_GULL: return GULL_SPEED;
    case SPECIES_EAGLE: return EAGLE_SPEED;
    default: return RAVEN_SPEED;
  }
}
function cueSpeed(u: UnitState): number {
  return cueSpeedFor(u.unit.species, u.cueRun);
}

/**
 * Hand a unit a mark to make for. The one door into PHASE_CUE — the shell that applies the
 * director's events comes through here rather than reaching into the phase fields, so the
 * goal, the gait and the phase can never be set half-way.
 */
export function startCue(u: UnitState, goalX: number, goalZ: number, run: boolean, tick: number): void {
  u.goalX = goalX;
  u.goalZ = goalZ;
  u.cueRun = run;
  enter(u, PHASE_CUE, tick);
}

/**
 * A cue overrides the species' own state machine for as long as it lasts: the animal is
 * making for a mark, not reacting to the player. On arrival it hands back to REST — with
 * the wander slot cleared, exactly as PHASE_RETURN does, so the next slot draws a fresh
 * goal instead of resuming one from before the cue. For a ground species the mark is
 * walked to; for a flier `u.x/u.z` IS the loop centre (see `poseBirds`), so the same
 * `moveToward` glides the whole circle across and the bird keeps flying it on arrival.
 */
function stepCue(u: UnitState, tick: number): void {
  if (moveToward(u, cueSpeed(u))) { enter(u, PHASE_REST, tick); u.slot = -1; }
}

/** Members of a ground unit follow the lead's motion with their seeded offset and delay. */
function poseGround(u: UnitState, tick: number, seed: number): void {
  // The squirrel's ALERT is the dash to the trunk at SQUIRREL_RUN_SPEED, not the freeze
  // every other ground species holds there, so for this species it
  // counts as moving — which is what keeps the dash on the `run` clip now that a STILL
  // ALERT resolves to the held `alert` pose.
  const moving = u.phase === PHASE_FLEE || u.phase === PHASE_RETURN || u.phase === PHASE_CUE
    || (u.unit.species === SPECIES_SQUIRREL && u.phase === PHASE_ALERT)
    || (u.phase === PHASE_REST && (u.x !== u.goalX || u.z !== u.goalZ));
  const clip = clipForPhase(u.unit.species, u.phase, moving, u.cueRun);
  for (let m = 0; m < u.poses.length; m++) {
    const pose = u.poses[m]!;
    if (u.unit.species === SPECIES_SQUIRREL) {
      const onTrunk = squirrelOnTrunk(u.phase);
      // Outside the bark, not inside it: the trunk's own radius at this tree's drawn scale
      // plus a fixed clearance. The old flat 0.35 m was less than the radius alone on most
      // giants.
      const cling = GIANT_TRUNK_RADIUS_PER_SCALE * u.unit.homeScale + SQUIRREL_CLING_CLEARANCE;
      pose.x = onTrunk ? u.unit.homeX + cling * Math.sin(u.yaw) : u.x;
      pose.z = onTrunk ? u.unit.homeZ + cling * Math.cos(u.yaw) : u.z;
      pose.y = onTrunk ? u.unit.homeH + u.climb : elevationAt(seed, pose.x, pose.z);
      // Treed: nose toward the axis (u.yaw points away from the player, i.e. outward from
      // the far side), then pitched up — so the BELLY meets the bark and the body hangs
      // outside it. With the outward yaw the pitch rolled the back onto the bark and the
      // body 0.19 m into the wood.
      pose.yaw = onTrunk ? u.yaw + Math.PI : u.yaw; pose.pitch = onTrunk ? Math.PI / 2 : 0; pose.scale = 1; pose.clip = clip;
      continue;
    }
    // Offset angle, spread radius and join-delay are cached on the unit at creation
    // instead of re-drawn from hash3 every frame here.
    const { a, r, delay } = u.memberOffsets[m]!;
    const tx = u.x + r * Math.cos(a);
    const tz = u.z + r * Math.sin(a);
    if (tick - u.phaseStart >= delay || m === 0) {
      const dx = tx - pose.x, dz = tz - pose.z, dd = Math.hypot(dx, dz);
      // A bolting cue moves the lead at the flee speed, so the members have to be allowed to
      // keep up with it — otherwise the herd strings out behind a rabbit crossing at 8 m/s.
      const bolting = u.phase === PHASE_FLEE || (u.phase === PHASE_CUE && u.cueRun);
      const speed = bolting ? (u.unit.species === SPECIES_RABBIT ? RABBIT_BOLT_SPEED : ELK_FLEE_SPEED) : ELK_WALK_SPEED * 1.5;
      const step = speed * TICK_DT;
      if (dd <= step) { pose.x = tx; pose.z = tz; } else { pose.x += (dx / dd) * step; pose.z += (dz / dd) * step; pose.yaw = Math.atan2(dx, dz); }
    }
    pose.y = elevationAt(seed, pose.x, pose.z);
    pose.pitch = 0;
    pose.scale = u.unit.species === SPECIES_RABBIT && u.phase === PHASE_SETTLE ? 0 : 1;
    pose.clip = clip;
  }
  u.y = elevationAt(seed, u.x, u.z);
}

/** Birds on a loop: angle advances at speed/radius; roost members perch or circle. */
function poseBirds(u: UnitState, tick: number, seed: number): void {
  const s = u.unit.species;
  const speed = s === SPECIES_GULL ? GULL_SPEED : s === SPECIES_EAGLE ? EAGLE_SPEED : RAVEN_SPEED;
  const omega = speed / u.unit.radius;
  const t = tick * TICK_DT;
  for (let m = 0; m < u.poses.length; m++) {
    const pose = u.poses[m]!;
    const phase0 = hash3(u.unit.id, m, SALT_MEMBER, seed) * 2 * Math.PI;
    const perched = s === SPECIES_RAVEN_ROOST && u.phase === PHASE_REST;
    if (perched) {
      pose.x = u.unit.homeX + 0.8 * Math.cos(phase0); pose.z = u.unit.homeZ + 0.8 * Math.sin(phase0);
      pose.y = u.unit.homeH + RAVEN_PERCH_HEIGHT; pose.yaw = phase0; pose.wing = 0; pose.scale = 1; pose.pitch = 0; pose.clip = "idle";
      continue;
    }
    const breathe = 1 + 0.15 * Math.sin(t * 0.05 + phase0);
    const r = u.unit.radius * breathe;
    const a = phase0 + omega * t;
    // The loop's CENTRE is carried on the state, not read back off the immutable field
    // unit, so a cued flier can glide its whole circle toward the director's mark and then
    // simply keep flying it from wherever it got to. It starts at the anchor
    // (`createUnitState` seats `u.x/u.z` there for every bird) and nothing but a cue ever
    // moves it, so an uncued bird flies exactly the circle it always did.
    const cx = u.x, cz = u.z;
    let x = cx + r * Math.cos(a), z = cz + r * Math.sin(a);
    let y = u.unit.homeH + u.unit.altitude + 2 * Math.sin(t * 0.3 + phase0);
    // Take-off and landing are the same blend run in opposite directions: `perchWeight`
    // is how much of the perch is still in the pose, and both take `ravenBlendSeconds` —
    // the climb divided by a corvid's climb rate — so the two directions cover the same
    // distance at the same speed however high the canopy pushed the loop.
    // The lift eases OUT as 1 − (1 − k)², so the bird leaves the
    // branch fast and settles onto the loop; the landing keeps its linear ramp.
    let perchWeight = 0;
    if (s === SPECIES_RAVEN_ROOST && (u.phase === PHASE_RETURN || u.phase === PHASE_FLEE)) {
      const k = clamp01(seconds(u, tick) / ravenBlendSeconds(u.unit));
      perchWeight = u.phase === PHASE_RETURN ? k : (1 - k) * (1 - k);
    }
    if (perchWeight > 0) {
      const px = cx + 0.8 * Math.cos(phase0), pz = cz + 0.8 * Math.sin(phase0), py = u.unit.homeH + RAVEN_PERCH_HEIGHT;
      x += (px - x) * perchWeight; z += (pz - z) * perchWeight; y += (py - y) * perchWeight;
    }
    pose.x = x; pose.z = z; pose.y = y; pose.pitch = 0; pose.scale = 1; pose.clip = "idle";
    // Orientation takes the same blend as position: a lift that moved the
    // bird smoothly off the branch while its heading snapped from the perched `phase0` to
    // the loop tangent still read as a cut. Shortest-arc, so the turn never goes the long
    // way round.
    //
    // Yaw faces the loop TANGENT, i.e. the way the bird is actually going.
    // The loop is (cx + r·cos a, cz + r·sin a), so its tangent is (−sin a, cos a); the
    // repo's convention is yaw 0 faces +Z with forward (sin yaw, cos yaw)
    // (`sim/movement.ts`, ARCHITECTURE.md, Model conventions), which makes the tangent-facing yaw exactly −a.
    // The old `a + π/2` gave (cos a, −sin a) — radially outward at a = 0, and
    // counter-rotating around the circle, so every flier crabbed sideways through its loop.
    pose.yaw = perchWeight > 0 ? lerpAngle(-a, phase0, perchWeight) : -a;
    // Wing beat amplitude: eagles glide; gulls alternate by a seeded 2–5 s cadence; ravens
    // beat. A perched raven's wings are folded (amp 0), so the amplitude rides the blend
    // too — the wings come up as the bird leaves the branch and fold as it settles.
    let wing: number;
    if (s === SPECIES_EAGLE) wing = 0;
    else if (s === SPECIES_GULL) { const period = range(hash3(u.unit.id, m, SALT_MEMBER + 3, seed), GULL_GLIDE); wing = Math.floor(t / period) % 2 === 0 ? 1 : 0; }
    else wing = 1;
    pose.wing = wing * (1 - perchWeight);
  }
  // `homeH` stays the height reference even for a flier that has glided away from its
  // anchor: the ground a flier is over is not sampled anywhere on this path, and at 15 m
  // (a gull) to 250 m (an eagle) of altitude a cue's worth of terrain relief is nothing
  // against a per-bird terrain read every frame.
  u.y = u.unit.homeH + (u.phase === PHASE_REST && s === SPECIES_RAVEN_ROOST ? RAVEN_PERCH_HEIGHT : u.unit.altitude);
}

/**
 * `disturbances`: the positions of every unit's flee-start events from the PREVIOUS frame
 * (the shell collects `{ kind: "flee" }` events across all units and feeds them back in
 * here) — currently consumed only by roosts.
 */
export function stepUnit(u: UnitState, tick: number, players: readonly PlayerPoint[], seed: number, hour: number, disturbances: readonly PlayerPoint[], out: WildlifeEvent[]): void {
  if (tick <= u.lastTick) return;
  const from = Math.max(u.lastTick + 1, tick - MAX_CATCHUP_TICKS + 1);
  for (let t = from; t <= tick; t++) {
    // A cue is the same walk for every species, so it is dispatched before the per-species
    // machines rather than repeated as a case inside each of them.
    if (u.phase === PHASE_CUE) stepCue(u, t);
    else switch (u.unit.species) {
      case SPECIES_ELK: case SPECIES_DEER: stepElk(u, t, players, seed, out); break;
      case SPECIES_RABBIT: stepRabbit(u, t, players, seed, out); break;
      case SPECIES_SQUIRREL: stepSquirrel(u, t, players, seed, out); break;
      case SPECIES_RAVEN_ROOST: stepRoost(u, t, players, seed, disturbances, out); break;
      default: break; // loop fliers never react
    }
    scheduledCall(u, t, seed, hour, out);
  }
  u.lastTick = tick;
  if (u.unit.species < FIRST_BIRD_SPECIES) poseGround(u, tick, seed); else poseBirds(u, tick, seed);
  u.posed = true;
}

export type Presence = { ground: number; aloft: number; raven: number; callGain: readonly number[] };

/** `clear` is the identity: every factor is 1 at rain 0, dread 0. The dread ramp
 * runs 0.3→0.5 (not 0.4→0.6) so `dread === 0.5` lands exactly on the threshold row
 * (ground 0 / aloft 0 / raven 2) rather than the ramp's midpoint. */
export function wildlifePresenceUnder(w: WeatherParams): Presence {
  const rain = clamp01(w.rain);
  const dread = clamp01(w.dread);
  const k = clamp01((dread - 0.3) / 0.2);
  const ground = 1 - k;
  const aloft = (1 - k) * (1 - 0.7 * rain);
  const raven = (1 + k) * (1 - 0.5 * rain * (1 - k));
  // One array per call — this function runs once per frame, not once per unit, so that
  // allocation is acceptable; index-assigned rather than push()ed.
  const callGain = new Array<number>(SPECIES_COUNT);
  for (let s = 0; s < SPECIES_COUNT; s++) {
    callGain[s] = s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR ? raven : s >= FIRST_BIRD_SPECIES ? aloft : ground;
  }
  return { ground, aloft, raven, callGain };
}
