/**
 * Whether the player has actually SEEN an animal — not merely whether one
 * exists nearby, which `wildlifeField.ts` already answers, but whether it
 * currently sits inside the view cone, close enough to notice, and not
 * hidden behind the ground. A later piece uses this clock to decide when the
 * woods owes the player a sighting; this file only keeps the clock and the
 * eye test it runs on.
 *
 * Pure and Babylon-free, like `wildlifeBehaviour.ts`: a `View` is whatever
 * the caller's camera says it is, and a `Ground` is however the caller wants
 * to ask "how high is the terrain here" — production hands in the real
 * heightfield, a test hands in a flat plane or a wall.
 */
import { hash3 } from "../sim/field.js";
import { SIM_TICK_HZ } from "../sim/constants.js";
import { DAWN_DUSK_WINDOW, DAWN_HOUR, DUSK_HOUR } from "./wildlifeBehaviour.js";

/** Half-width (rad) added to the cone before something counts as "off to the
 * side" rather than "on screen" — an animal has to clear the frame edge by
 * this much before the player could plausibly say they saw it. */
export const VIEW_MARGIN = 5 * Math.PI / 180;
/** Seconds a unit has to sit on screen, continuously, before it counts as seen. */
export const SIGHTING_DWELL = 1;
/** Band (s) the gap until the next sighting is redrawn from once one lands. */
export const GAP: readonly [number, number] = [5, 10];
/** How far ahead (s) the director should start arranging the next sighting, and
 * how long (s) a failed arrangement waits before it is retried. */
export const LEAD = 2;
export const RETRY = 1;
/** A small species close enough counts as the large ones' equivalent for gap
 * purposes — the ratio a "big herd far off" and "one rabbit up close" trade at. */
export const SMALL_TO_LARGE = 6;
/** A player who has stopped moving is looking around, not walking past — the
 * gap relaxes once they have held still this long, by this factor. */
export const STILL_RELAX = 1.8;
export const STILL_SECONDS = 3;
export const STILL_SPEED = 0.3;
/** Full dark cuts how often the woods bothers arranging a sighting nobody can see well. */
export const NIGHT_RELAX = 2.5;
/** Inside this of the Hollow (m) the woods stops trying to compete for attention. */
export const HOLLOW_QUIET = 60;
export const RECYCLE = 60;
/** Farthest a unit can still register as seen (m), at mist 0 and mist 1 — fog
 * closes the world in long before `NOTICE` would otherwise let something through. */
export const HIDE_RANGE: readonly [number, number] = [200, 40];
/**
 * How far away (m) each species still reads as noticed, before the hide range
 * even applies. Elk and deer are large enough to pick out at a real distance;
 * rabbits and squirrels are not. Birds have no ceiling of their own — flying
 * species are bounded by the hide range alone. Index 8 is the butterfly's:
 * inert until a unit of that species exists (see `wildlifeField.ts`).
 */
export const NOTICE: readonly number[] = [45, 45, 15, 15, Infinity, Infinity, Infinity, Infinity, Infinity];
/** Points sampled along the ray to a unit, checking for terrain in the way. */
export const LOS_SAMPLES = 4;
const LOS_FRACTIONS: readonly number[] = [0.2, 0.4, 0.6, 0.8];
/** Sightings recorded, most recent RECYCLE_LOG kept — see `createDirectorState`. */
const RECYCLE_LOG = 256;

export type View = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number };
export type MatchState = {
  phase: number;
  hollowDistance: number;
  hollowHunting: boolean;
  inWorld: boolean;
  hour: number;
  mist: number;
};
/** However the caller wants to answer "how high is the ground here" — the
 * real heightfield in play, a flat plane or a wall in a test. */
export type Ground = (x: number, z: number) => number;
export type Seen = { id: number; species: number; x: number; y: number; z: number };

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Farthest a unit can still be seen (m) at the given mist [0, 1]. */
export function hideRange(mist: number): number {
  return HIDE_RANGE[0] + (HIDE_RANGE[1] - HIDE_RANGE[0]) * clamp01(mist);
}

/**
 * Whether (x, y, z) falls inside the view's frustum, widened (or, with a
 * negative margin, narrowed) by `margin` radians on every edge. `fov` is the
 * VERTICAL field of view, so the vertical half-extent per metre of depth is
 * `tan(fov/2)` and the horizontal one carries `aspect` — the standard
 * relationship for a camera with no anamorphic squeeze — rather than the
 * other way around.
 */
export function inCone(view: View, x: number, y: number, z: number, margin: number): boolean {
  const dx = x - view.x, dy = y - view.y, dz = z - view.z;
  const sinYaw = Math.sin(view.yaw), cosYaw = Math.cos(view.yaw);
  const sinPitch = Math.sin(view.pitch), cosPitch = Math.cos(view.pitch);
  // Forward matches sim/view.ts's aimDirection: yaw 0 faces +Z, negative pitch
  // looks up. Right stays horizontal (no roll); up is forward × right, which
  // reduces to world-up at pitch 0.
  const fx = sinYaw * cosPitch, fy = -sinPitch, fz = cosYaw * cosPitch;
  const rx = cosYaw, rz = -sinYaw;
  const ux = sinYaw * sinPitch, uy = cosPitch, uz = cosYaw * sinPitch;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 0) return false;
  const across = dx * rx + dz * rz;
  const up = dx * ux + dy * uy + dz * uz;
  const halfY = view.fov / 2;
  // Margin widens (or narrows) the cone by the same fraction of the half-angle
  // on both axes, so "outside by the margin" means the same thing whichever
  // edge of the frame it happens on.
  const scale = 1 + margin / halfY;
  const boundY = Math.tan(halfY) * scale;
  const boundX = boundY * view.aspect;
  return Math.abs(across / depth) <= boundX && Math.abs(up / depth) <= boundY;
}

/** Whether the ground rises above the straight line from the eye to
 * (x, y, z) at any of `LOS_SAMPLES` points along it. */
export function lineOfSight(ground: Ground, view: View, x: number, y: number, z: number): boolean {
  const dx = x - view.x, dy = y - view.y, dz = z - view.z;
  for (const f of LOS_FRACTIONS) {
    const rayHeight = view.y + dy * f;
    if (ground(view.x + dx * f, view.z + dz * f) > rayHeight) return false;
  }
  return true;
}

/** The full "can the player actually see this unit" test: inside the strict
 * cone (no margin — that is only for how long a sighting is allowed to
 * linger at the frame's edge), closer than both its species' notice range
 * and the mist's hide range, and not behind the ground. */
export function onScreen(view: View, ground: Ground, unit: Seen, mist: number): boolean {
  if (!inCone(view, unit.x, unit.y, unit.z, -VIEW_MARGIN)) return false;
  const dx = unit.x - view.x, dy = unit.y - view.y, dz = unit.z - view.z;
  const distance = Math.hypot(dx, dy, dz);
  const notice = NOTICE[unit.species] ?? Infinity;
  if (distance > Math.min(notice, hideRange(mist))) return false;
  return lineOfSight(ground, view, unit.x, unit.y, unit.z);
}

/**
 * True outside the daylight the calls already know about: `wildlifeBehaviour.ts`
 * treats `[DAWN_HOUR - DAWN_DUSK_WINDOW, DUSK_HOUR + DAWN_DUSK_WINDOW]` as
 * lit enough to matter (its bugle boost fires inside `DAWN_DUSK_WINDOW` of
 * either edge), so night is reusing that same window rather than drawing a
 * second line across the clock: the hours before the earliest hint of dawn
 * and after the last of dusk, when nothing is boosting toward daylight at all.
 */
export function isNight(hour: number): boolean {
  return hour < DAWN_HOUR - DAWN_DUSK_WINDOW || hour > DUSK_HOUR + DAWN_DUSK_WINDOW;
}

export type DirectorState = {
  sinceSighting: number;
  targetGap: number;
  lastSpecies: number;
  stillFor: number;
  lastSeenId: number;
  dwell: number;
  nextTry: number;
  log: Int32Array;
  logCount: number;
};

/** Bookkeeping `observe` needs across frames that isn't part of the public
 * shape above: the running tick (for the log and the gap's redraw) and the
 * view's last position (to tell whether the player has stopped moving). Kept
 * off to the side, keyed by the state object itself, so `DirectorState`
 * stays exactly the fields callers and tests actually read. */
type Clockwork = { tick: number; haveView: boolean; viewX: number; viewZ: number };
const clockworks = new WeakMap<DirectorState, Clockwork>();
function clockworkFor(state: DirectorState): Clockwork {
  let c = clockworks.get(state);
  if (c === undefined) {
    c = { tick: 0, haveView: false, viewX: 0, viewZ: 0 };
    clockworks.set(state, c);
  }
  return c;
}

function drawGap(seed: number, tick: number): number {
  return GAP[0] + hash3(seed, tick, 1, 0) * (GAP[1] - GAP[0]);
}

export function createDirectorState(seed: number): DirectorState {
  return {
    sinceSighting: 0,
    targetGap: drawGap(seed, 0),
    lastSpecies: -1,
    stillFor: 0,
    lastSeenId: -1,
    dwell: 0,
    nextTry: 0,
    log: new Int32Array(RECYCLE_LOG * 2),
    logCount: 0,
  };
}

/**
 * How much longer than the base gap the director should wait before the next
 * sighting, or `Infinity` when it should not be arranging one at all: mid a
 * chase or any other non-play phase, within `HOLLOW_QUIET` of the Hollow or
 * while it hunts, and off the play screen altogether all mean the woods has
 * nothing to prove right now. Standing still and full dark each relax the
 * cadence on their own; held at once, the larger relaxation wins rather than
 * compounding, since either alone is already "the player isn't pressed for time".
 */
export function relaxFor(state: DirectorState, match: MatchState): number {
  if (match.phase !== 0 || match.hollowDistance < HOLLOW_QUIET || match.hollowHunting || !match.inWorld) return Infinity;
  let relax = 1;
  if (state.stillFor > STILL_SECONDS) relax = Math.max(relax, STILL_RELAX);
  if (isNight(match.hour)) relax = Math.max(relax, NIGHT_RELAX);
  return relax;
}

/**
 * Advances the clock by one frame: tracks how long the view itself has sat
 * still, follows whichever unit is currently being watched (switching to any
 * on-screen unit the moment none is), and once that unit's continuous dwell
 * reaches `SIGHTING_DWELL`, records the sighting — resetting `sinceSighting`,
 * redrawing `targetGap`, and appending `(tick, species)` to the log.
 */
export function observe(
  state: DirectorState,
  view: View,
  ground: Ground,
  units: readonly Seen[],
  match: MatchState,
  dt: number,
  seed: number,
): void {
  const clock = clockworkFor(state);
  clock.tick += Math.max(1, Math.round(dt * SIM_TICK_HZ));

  if (clock.haveView) {
    const speed = Math.hypot(view.x - clock.viewX, view.z - clock.viewZ) / dt;
    state.stillFor = speed < STILL_SPEED ? state.stillFor + dt : 0;
  } else {
    state.stillFor += dt;
    clock.haveView = true;
  }
  clock.viewX = view.x;
  clock.viewZ = view.z;

  // Keep dwelling on the same unit for as long as it stays on screen — checked
  // by id, first, regardless of where it sits in `units` — so a second animal
  // merely being visible can never interrupt an accumulating dwell; only the
  // CURRENT candidate leaving does. Without that rule, two animals trading
  // places on screen faster than either holds it alone would restart the
  // dwell forever and never record a sighting, even though something was
  // visible the entire time. Once the current candidate does leave, the
  // nearest on-screen unit becomes the new one — nearest rather than
  // whichever happens to come first in `units`, since a caller has no reason
  // to keep that order stable frame to frame. A unit that leaves loses its
  // dwell outright rather than banking it for a later return: a sighting is
  // a continuous look, not an accumulated one, and discarding a briefly
  // occluded candidate's partial progress is the conservative direction —
  // it can only make the director stage more cues later, never fewer.
  //
  // `onScreen` runs the line-of-sight sampling, so the current candidate is
  // tested at most once a frame rather than re-checked once per branch below.
  let candidate: Seen | undefined;
  let candidateOnScreen = false;
  for (const u of units) {
    if (u.id === state.lastSeenId) { candidate = u; candidateOnScreen = onScreen(view, ground, u, match.mist); break; }
  }
  if (!candidateOnScreen) {
    candidate = undefined;
    let bestDistance = Infinity;
    for (const u of units) {
      if (!onScreen(view, ground, u, match.mist)) continue;
      const distance = Math.hypot(u.x - view.x, u.y - view.y, u.z - view.z);
      if (distance < bestDistance) { bestDistance = distance; candidate = u; }
    }
    candidateOnScreen = candidate !== undefined;
    state.lastSeenId = candidate === undefined ? -1 : candidate.id;
    state.dwell = 0;
  }

  let recorded = false;
  if (candidateOnScreen && candidate !== undefined) {
    state.dwell += dt;
    if (state.dwell >= SIGHTING_DWELL) {
      state.sinceSighting = 0;
      state.lastSpecies = candidate.species;
      state.targetGap = drawGap(seed, clock.tick);
      const slot = (state.logCount % RECYCLE_LOG) * 2;
      state.log[slot] = clock.tick;
      state.log[slot + 1] = candidate.species;
      state.logCount++;
      state.dwell = 0;
      recorded = true;
    }
  }
  if (!recorded) state.sinceSighting += dt;
}
