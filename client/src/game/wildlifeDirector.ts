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
import { DAWN_DUSK_WINDOW, DAWN_HOUR, DUSK_HOUR, PHASE_CUE } from "./wildlifeBehaviour.js";
import {
  SPECIES_BUTTERFLY, SPECIES_DEER, SPECIES_EAGLE, SPECIES_ELK, SPECIES_GULL, SPECIES_RABBIT,
  SPECIES_RAVEN_PAIR, SPECIES_SQUIRREL,
} from "./wildlifeField.js";

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
/** The three ways a cue gets an animal in front of the player: a flier crossing the frame,
 * a small mammal breaking cover nearby, and a large one stepping out of the tree line. */
export const STAGING_CROSS = 0, STAGING_COVER = 1, STAGING_TREELINE = 2;
/** Where each staging starts a newly placed animal (m from the eye), and how many seeded
 * candidate positions it tries before giving the beat up and retrying after `RETRY`. */
export const CROSS_RANGE: readonly [number, number] = [20, 40];
export const COVER_RANGE: readonly [number, number] = [6, 15];
export const TREELINE_RANGE: readonly [number, number] = [25, 45];
export const PLACE_TRIES = 8;
/**
 * How far past the frame's edge (rad) a start may be drawn. Just past the shoulder, not
 * anywhere out of sight: the whole cue is the move from there into frame, and an animal
 * started behind the player has to walk around them to make it — half a minute for an elk,
 * by which time the player has walked on and the beat is long gone.
 */
export const OUTSIDE_ARC = 0.25;
/**
 * Where each staging sends the animal, as a share of the frame's half-width: a
 * broken-cover dash crosses the centre line to the other side, while a tree-line walk-in
 * comes only as far in from the edge as it takes to read as in frame, on its own side.
 *
 * Shares of the frame, and of the animal's OWN distance, rather than metres ahead of the
 * player: a mark measured from the player is a mark the animal has to march across the
 * woods to reach, and an elk at 2 m/s spends half a minute getting there while the player
 * walks on past it. What a cue actually needs is the shortest move that crosses the frame
 * edge, which is a move of a few metres.
 */
export const COVER_MARK_SHARE = -0.4;
export const TREELINE_MARK_SHARE = 0.5;
/** A mark sits no further out than this share of what the species can be made out at —
 * walking an animal to a spot it reads as a speck at is not a sighting — and never closer
 * to the eye than this, which is a cue, not an ambush. */
export const MARK_NOTICE_SHARE = 0.7;
export const MARK_MIN_RANGE = 5;
/**
 * Height above the ground (m) the placement test reads a would-be animal at. The event
 * carries a ground point and the shell seats the unit on it, so this is the director's
 * assumption about where that unit's body will be when the line of sight is drawn to it —
 * a standing mammal's chest. A flier's altitude is the shell's to choose and is well above
 * this, so the cross staging leans on BEARING instead — twice the margin clear of the
 * frame's edge, which at a level view holds however high the bird ends up.
 */
export const PLACE_BODY_H = 1;
/** A pool unit off screen and beyond this multiple of the range it could be seen at, held
 * for this long, has left the scene for good and is recycled. */
export const REMOVE_FACTOR = 1.5;
export const REMOVE_SECONDS = 5;
/**
 * Ids at or above this mark a unit the director owns rather than one the field generated:
 * only these are ever recycled, because only these are the director's to take away. The
 * pool behind them belongs to the shell.
 */
export const DIRECTOR_ID_BASE = 1 << 28;

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
/** A unit the director may act on: a `Seen` plus what the shell already knows about it —
 * whether the player can see it this frame (a cheap pre-filter the director would
 * otherwise re-derive) and which phase it is in (a unit mid-cue is already doing the
 * director's work and is left alone). */
export type Candidate = Seen & { onScreen: boolean; phase: number };
/**
 * What the director asks the shell to do. `drive` re-targets a unit that already exists,
 * `place` asks for one of the pool at a start point, and `remove` gives one back. Every
 * one of the three is emitted only where `placementValid` holds (or, for `remove`, where
 * the unit is far past the range it could be seen at), which is the whole promise: no
 * animal is ever seen arriving or leaving.
 */
export type CueEvent =
  | { kind: "drive"; id: number; goalX: number; goalZ: number; run: boolean }
  | { kind: "place"; species: number; x: number; z: number; goalX: number; goalZ: number; run: boolean }
  | { kind: "remove"; id: number };

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
type Clockwork = {
  tick: number; haveView: boolean; viewX: number; viewZ: number;
  /** Whether the sighting now being watched has already been written to the log — see
   * `observe`. Cleared whenever the watched unit changes. */
  counted: boolean;
  /** Per pool unit, how long (s) it has been continuously out of sight and out of range —
   * the clock `REMOVE_SECONDS` runs on. Keyed by id and cleared the moment a unit comes
   * back within range or starts a cue, so it is bounded by the size of the pool, and the
   * next occupant of a slot (which starts its life mid-cue) begins from zero. */
  farFor: Map<number, number>;
};
const clockworks = new WeakMap<DirectorState, Clockwork>();
function clockworkFor(state: DirectorState): Clockwork {
  let c = clockworks.get(state);
  if (c === undefined) {
    c = { tick: 0, haveView: false, viewX: 0, viewZ: 0, counted: false, farFor: new Map() };
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
    clock.counted = false;
  }

  // A sighting is a look, and a look is counted ONCE. The clock still reads zero for every
  // frame the animal is there — the woods owe the player nothing while one is in front of
  // them — but the log gets a single entry per animal watched, not one a second for as
  // long as the player keeps watching. The log exists to be histogrammed into "how long
  // between animals"; a deer grazing in view for a minute writing sixty entries a second
  // apart would put that histogram's median at the dwell rather than at the gap.
  let watching = false;
  if (candidateOnScreen && candidate !== undefined) {
    state.dwell += dt;
    if (state.dwell >= SIGHTING_DWELL) {
      watching = true;
      state.sinceSighting = 0;
      state.dwell = SIGHTING_DWELL; // met is met — the field is a look's progress, not its age.
      if (!clock.counted) {
        clock.counted = true;
        state.lastSpecies = candidate.species;
        state.targetGap = drawGap(seed, clock.tick);
        const slot = (state.logCount % RECYCLE_LOG) * 2;
        state.log[slot] = clock.tick;
        state.log[slot + 1] = candidate.species;
        state.logCount++;
      }
    }
  }
  if (!watching) state.sinceSighting += dt;
}

/**
 * Which species a cue may draw, and how heavily. The ruling is about the two GROUPS, not
 * the individual species — "about six small sightings to one large" — so each group's
 * `SMALL_TO_LARGE`:1 share of the mass is split evenly inside it. Weighting each small
 * species at `SMALL_TO_LARGE` instead would put the groups at twice that, because there
 * are twice as many small species as large ones.
 *
 * The raven roost is absent on purpose, and it is the one small species that is: a roost
 * IS its snag — perched on it, lifting off it, landing back on it — so there is no mark in
 * the world the director could send one to. The pair, the gull, the eagle and the
 * butterfly fly free circles that a cue can glide anywhere, and they carry the flying
 * cues between them.
 */
const CUE_LARGE: readonly number[] = [SPECIES_ELK, SPECIES_DEER, SPECIES_EAGLE];
const CUE_SMALL: readonly number[] = [SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY];
export const CUE_WEIGHT: readonly number[] = buildCueWeights();
function buildCueWeights(): number[] {
  const w = new Array<number>(SPECIES_BUTTERFLY + 1).fill(0);
  for (const s of CUE_LARGE) w[s] = 1 / CUE_LARGE.length;
  for (const s of CUE_SMALL) w[s] = SMALL_TO_LARGE / CUE_SMALL.length;
  return w;
}

/** Salts for the cue's own draws, kept clear of one another across the eight place tries. */
const SALT_SPECIES = 2, SALT_BEARING = 100, SALT_RANGE = 200;

/**
 * The species this cue will be: a weighted draw over `CUE_WEIGHT` with the species of the
 * last sighting struck out, so the woods never show the same animal twice running.
 * `draw` is [0, 1); the final weighted species catches a draw that lands exactly on 1.
 */
export function pickSpecies(state: DirectorState, draw: number): number {
  let total = 0;
  for (let s = 0; s < CUE_WEIGHT.length; s++) if (s !== state.lastSpecies) total += CUE_WEIGHT[s]!;
  let t = clamp01(draw) * total;
  let last = -1;
  for (let s = 0; s < CUE_WEIGHT.length; s++) {
    const w = s === state.lastSpecies ? 0 : CUE_WEIGHT[s]!;
    if (w <= 0) continue;
    last = s;
    t -= w;
    if (t < 0) return s;
  }
  return last;
}

/** How a species is brought into frame: fliers cross it, the small mammals break cover
 * close by, and elk and deer walk in out of the tree line. */
export function stagingFor(species: number): number {
  if (species === SPECIES_RABBIT || species === SPECIES_SQUIRREL) return STAGING_COVER;
  if (species === SPECIES_ELK || species === SPECIES_DEER) return STAGING_TREELINE;
  return STAGING_CROSS;
}

/**
 * The invariant's predicate: true where the director may create or move an animal without
 * the player seeing it happen — outside the view cone WIDENED by `VIEW_MARGIN`, or behind
 * the ground, or past the distance the mist allows anything to be seen at.
 *
 * The widened cone, not the strict one `onScreen` uses: "not on screen" is not enough,
 * because an animal a degree outside the frame edge is one flick of the mouse from being
 * inside it, and the margin is exactly the slack the sighting test already gives the edge.
 */
export function placementValid(view: View, ground: Ground, x: number, y: number, z: number, mist: number): boolean {
  if (!inCone(view, x, y, z, VIEW_MARGIN)) return true;
  if (!lineOfSight(ground, view, x, y, z)) return true;
  return Math.hypot(x - view.x, y - view.y, z - view.z) > hideRange(mist);
}

/** Half-width (rad) of the view cone measured ACROSS the frame, at the given margin —
 * the same widening `inCone` applies, read back as an angle so a bearing can be drawn
 * relative to it. */
function coneHalfAngle(view: View, margin: number): number {
  const halfY = view.fov / 2;
  return Math.atan(Math.tan(halfY) * (1 + margin / halfY) * view.aspect);
}
/** Bearing (rad) of a point from the view's forward direction, positive toward the right
 * of the frame, wrapped to (-pi, pi]. */
function bearingOf(view: View, x: number, z: number): number {
  let b = Math.atan2(x - view.x, z - view.z) - view.yaw;
  const twoPi = 2 * Math.PI;
  b %= twoPi;
  if (b > Math.PI) b -= twoPi;
  else if (b <= -Math.PI) b += twoPi;
  return b;
}
/** Written into, and read straight back out of, within a single call — a cue's mark and
 * its start point, kept across frames so `step` allocates nothing. */
const markScratch = { x: 0, z: 0 };
const startScratch = { x: 0, z: 0 };
/** The point at `range` metres and `bearing` radians from the eye, written into `out`.
 * Forward is (sin yaw, cos yaw), so a bearing is simply added to the yaw. */
function pointAt(view: View, bearing: number, range: number, out: { x: number; z: number }): void {
  out.x = view.x + range * Math.sin(view.yaw + bearing);
  out.z = view.z + range * Math.cos(view.yaw + bearing);
}

/**
 * Where a cue sends its animal, given where the animal is now. Every mark lies inside the
 * frame or straight through it: a cue that ends off screen was not a cue.
 *
 * - Cross: the far edge of the frame at the flier's own range, so the flight runs through
 *   the middle of it and out the other side.
 * - Cover: over the centre line to the other side, at the animal's own range — a dash
 *   across the frame rather than a pop-out that stops.
 * - Tree line: in from the edge on the animal's OWN side. A herd sent down the view axis
 *   would be walking at the player, which is the one approach elk and deer flee from.
 */
function markFor(view: View, species: number, staging: number, fromX: number, fromZ: number, out: { x: number; z: number }): void {
  const bearing = bearingOf(view, fromX, fromZ);
  const side = bearing < 0 ? -1 : 1;
  const range = Math.hypot(fromX - view.x, fromZ - view.z);
  if (staging === STAGING_CROSS) {
    pointAt(view, -side * coneHalfAngle(view, VIEW_MARGIN), Math.max(CROSS_RANGE[0], range), out);
    return;
  }
  // The STRICT frame, the one `onScreen` reads: a mark parked in the margin would leave the
  // animal standing where the director itself does not count it as seen.
  const half = coneHalfAngle(view, -VIEW_MARGIN);
  const share = staging === STAGING_COVER ? COVER_MARK_SHARE : TREELINE_MARK_SHARE;
  const notice = NOTICE[species] ?? Infinity;
  const markRange = Math.max(MARK_MIN_RANGE, Math.min(range, notice * MARK_NOTICE_SHARE));
  pointAt(view, side * share * half, markRange, out);
}

/**
 * The `i`-th seeded start position for a staging, written into `out`; false when that try
 * is not available or would be seen appearing. Every try is put through `placementValid`,
 * so the invariant holds by construction however the geometry below is drawn.
 */
function startFor(
  view: View, ground: Ground, match: MatchState, staging: number, seed: number, tick: number, i: number,
  out: { x: number; z: number },
): boolean {
  const a = hash3(seed, tick, SALT_BEARING + i, 0);
  const b = hash3(seed, tick, SALT_RANGE + i, 0);
  if (staging === STAGING_COVER) {
    // Just past the frame's edge, or — for the last two tries — anywhere in front of the
    // player that the ground happens to hide, which is the other half of "break cover".
    // `placementValid` is what decides whether it really is hidden, so the draw does not
    // have to guess where the dips are.
    const bearing = i < PLACE_TRIES - 2
      ? outsideBearing(coneHalfAngle(view, VIEW_MARGIN), a)
      : (a * 2 - 1) * Math.PI / 2;
    pointAt(view, bearing, COVER_RANGE[0] + b * (COVER_RANGE[1] - COVER_RANGE[0]), out);
  } else if (staging === STAGING_CROSS) {
    // Twice the margin outside the frame, so the flier is clear of the edge by more than
    // the slack the sighting test allows — whatever altitude the shell gives it.
    pointAt(view, outsideBearing(coneHalfAngle(view, 2 * VIEW_MARGIN), a), CROSS_RANGE[0] + b * (CROSS_RANGE[1] - CROSS_RANGE[0]), out);
  } else if (i < PLACE_TRIES - 2) {
    pointAt(view, outsideBearing(coneHalfAngle(view, VIEW_MARGIN), a), TREELINE_RANGE[0] + b * (TREELINE_RANGE[1] - TREELINE_RANGE[0]), out);
  } else {
    // The last two tries walk a herd in out of the fog instead of in from the side. Only
    // worth anything when the fog is close enough that the walk is a cue rather than a
    // hike: in clear air the hide range is 200 m and an elk would spend a minute and a half
    // getting anywhere near being noticed, so those tries are simply skipped.
    const hide = hideRange(match.mist);
    if (hide > TREELINE_RANGE[1]) return false;
    pointAt(view, (a * 2 - 1) * coneHalfAngle(view, -VIEW_MARGIN), hide + 5 + b * 5, out);
  }
  return placementValid(view, ground, out.x, ground(out.x, out.z) + PLACE_BODY_H, out.z, match.mist);
}
/** A bearing drawn just outside the cone's edge, `OUTSIDE_ARC` at most past it, on
 * whichever side the draw's own half picks. */
function outsideBearing(edge: number, draw: number): number {
  const side = draw < 0.5 ? 1 : -1;
  return side * (edge + (draw < 0.5 ? draw : draw - 0.5) * 2 * OUTSIDE_ARC);
}

/**
 * The nearest unit of `species` the director may re-target: off screen, inside `RECYCLE`,
 * not already running a cue, and — the invariant — somewhere the player could not see it
 * turn. Null when there is none, which is what sends `stageCue` to the pool.
 */
function driveable(view: View, ground: Ground, candidates: readonly Candidate[], species: number, mist: number): Candidate | null {
  let best: Candidate | null = null;
  let bestDistance = RECYCLE;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.species !== species || c.onScreen || c.phase === PHASE_CUE) continue;
    const distance = Math.hypot(c.x - view.x, c.y - view.y, c.z - view.z);
    if (distance >= bestDistance) continue;
    if (!placementValid(view, ground, c.x, c.y, c.z, mist)) continue;
    bestDistance = distance;
    best = c;
  }
  return best;
}

/**
 * Arrange one sighting: draw the species, then prefer to re-target an animal that already
 * exists over asking for a new one — it is cheaper, and an animal that was already there
 * cannot be seen arriving. Returns whether an event was emitted; a beat that could find
 * nowhere out of sight to start from is simply dropped and retried after `RETRY`.
 *
 * `RETRY` is also the floor between two cues that DID work, and it is only a floor: what
 * really keeps the director from arranging a second animal on top of the first is that
 * `step` waits for the first to finish walking. The floor covers the frame or two before
 * the shell has applied this event and can report the cue as under way.
 */
export function stageCue(
  state: DirectorState,
  view: View,
  ground: Ground,
  candidates: readonly Candidate[],
  match: MatchState,
  tick: number,
  seed: number,
  out: CueEvent[],
): boolean {
  const species = pickSpecies(state, hash3(seed, tick, SALT_SPECIES, 0));
  const staging = stagingFor(species);
  // Breaking cover is a bolt; a flier's crossing and a herd's walk-in are not.
  const run = staging === STAGING_COVER;
  state.nextTry = tick + Math.round(RETRY * SIM_TICK_HZ);
  const driven = driveable(view, ground, candidates, species, match.mist);
  if (driven !== null) {
    markFor(view, species, staging, driven.x, driven.z, markScratch);
    out.push({ kind: "drive", id: driven.id, goalX: markScratch.x, goalZ: markScratch.z, run });
    return true;
  }
  for (let i = 0; i < PLACE_TRIES; i++) {
    if (!startFor(view, ground, match, staging, seed, tick, i, startScratch)) continue;
    markFor(view, species, staging, startScratch.x, startScratch.z, markScratch);
    out.push({ kind: "place", species, x: startScratch.x, z: startScratch.z, goalX: markScratch.x, goalZ: markScratch.z, run });
    return true;
  }
  return false;
}

/**
 * Give back pool units that have left the scene. A unit past `REMOVE_FACTOR` times the
 * range it could be seen at CANNOT be on screen — `onScreen` gives up at that range
 * itself — so the "never removed in view" half of the invariant holds by construction,
 * with half the range again as slack against a player who turns back. A unit still
 * running its cue is exempt whatever its distance: a herd staged out of the fog is
 * supposed to be far away, and is on its way in.
 */
function sweepRemovals(
  state: DirectorState, view: View, candidates: readonly Candidate[], match: MatchState, dt: number,
  skipId: number, out: CueEvent[],
): void {
  const farFor = clockworkFor(state).farFor;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.id < DIRECTOR_ID_BASE || c.id === skipId) continue;
    const seeable = Math.min(NOTICE[c.species] ?? Infinity, hideRange(match.mist));
    const distance = Math.hypot(c.x - view.x, c.y - view.y, c.z - view.z);
    if (c.phase === PHASE_CUE || distance <= REMOVE_FACTOR * seeable) { farFor.delete(c.id); continue; }
    const far = (farFor.get(c.id) ?? 0) + dt;
    if (far < REMOVE_SECONDS) { farFor.set(c.id, far); continue; }
    farFor.delete(c.id);
    out.push({ kind: "remove", id: c.id });
  }
}

/** Whether an animal is already walking to a mark. One cue at a time: the staging
 * condition below only clears once something has actually been SEEN, so without this the
 * director would arrange a fresh animal every frame the last one spent on its way in and
 * empty its whole pool into the player's back. A cue that arrives unseen ends here, and
 * the next beat is arranged immediately rather than on a timer. */
function cueInFlight(candidates: readonly Candidate[]): boolean {
  for (let i = 0; i < candidates.length; i++) if (candidates[i]!.phase === PHASE_CUE) return true;
  return false;
}

/**
 * One frame of the director: advance the sighting clock, arrange a cue if the woods owe
 * the player one, and recycle whatever has wandered out of the story. Cues stop under
 * every quiet condition `relaxFor` names; recycling does not, because a pool unit left
 * standing through a chase is a unit the director cannot use when the chase ends.
 *
 * Allocation-free on the frames that matter: the only objects made are the events
 * themselves, and those are made on the handful of frames a cue actually fires.
 */
export function step(
  state: DirectorState,
  view: View,
  ground: Ground,
  candidates: readonly Candidate[],
  match: MatchState,
  dt: number,
  tick: number,
  seed: number,
  out: CueEvent[],
): void {
  observe(state, view, ground, candidates, match, dt, seed);
  let drivenId = -1;
  const relax = relaxFor(state, match);
  if (relax < Infinity && state.sinceSighting > state.targetGap * relax - LEAD && tick >= state.nextTry && !cueInFlight(candidates)) {
    const before = out.length;
    if (stageCue(state, view, ground, candidates, match, tick, seed, out)) {
      // A unit told to move this frame is not also given back this frame.
      const event = out[before]!;
      if (event.kind === "drive") drivenId = event.id;
    }
  }
  sweepRemovals(state, view, candidates, match, dt, drivenId, out);
}
