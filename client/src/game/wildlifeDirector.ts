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
import { DAWN_DUSK_WINDOW, DAWN_HOUR, DUSK_HOUR, PHASE_CUE, cueSpeedFor } from "./wildlifeBehaviour.js";
import {
  FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY, SPECIES_COUNT, SPECIES_DEER, SPECIES_ELK, SPECIES_GULL,
  SPECIES_RABBIT, SPECIES_RAVEN_PAIR, SPECIES_SQUIRREL,
} from "./wildlifeField.js";

/** Half-width (rad) added to the cone before something counts as "off to the
 * side" rather than "on screen" — an animal has to clear the frame edge by
 * this much before the player could plausibly say they saw it. */
export const VIEW_MARGIN = 5 * Math.PI / 180;
/** Seconds a unit has to sit on screen, continuously, before it counts as seen. */
export const SIGHTING_DWELL = 1;
/** Band (s) the gap until the next sighting is redrawn from once one lands. */
export const GAP: readonly [number, number] = [5, 10];
/**
 * The longest (s) the woods may go without showing the player an animal while they are
 * walking. Not a lever — the ceiling the whole feature exists to keep under, from the
 * design's own gate: the gaps' median inside `GAP` AND nothing over this while moving.
 * The band on its own says nothing about the tail, and it was the tail that read as
 * lifeless: a median of seven seconds is no comfort in the ninety-six a player once spent
 * walking through empty woods.
 */
export const GAP_CEILING = 20;
/**
 * How far ahead (s) the director starts arranging the next sighting. `targetGap` is meant
 * to describe what the PLAYER gets — the interval between animals appearing — so `LEAD`
 * has to cover everything between the director deciding it wants one and the player
 * actually seeing it, or every gap comes out that much longer than the band says.
 *
 * MEASURED, not chosen, and measured on the RIGHT quantity: the walk from a cue being
 * staged to its sighting being logged, which over seven seeds of a thousand seconds each
 * runs 1.5 to 1.8 s — a cue reaches the frame in about 0.7 s and the player then has to
 * hold it for `SIGHTING_DWELL`.
 *
 * It is NOT the walk from the beat falling due to the next sighting, which used to be much
 * longer because it also counted the beats spent on cues that never landed. Setting the
 * lead from that figure buys the failures instead of the walk: it fires every successful
 * cue far too early — a quarter of all gaps came out under the band's floor — while doing
 * nothing at all for the runs of failures that made the long ones. Cues now land; if they
 * ever stop, the fix is the cue, not this.
 *
 * It is under `GAP[0]`, so the director is not permanently mid-cue; and it could be over
 * it safely anyway, because what stops two cues going out at once is `cueUnpaid`, not the
 * width of this window.
 */
export const LEAD = 2;
/** How long (s) a beat that could arrange nothing waits before trying again. */
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
 * rabbits and squirrels are not. The birds have no ceiling of their own — a flying
 * species is bounded by the hide range alone.
 *
 * The butterfly at index 8 is the exception among the fliers, and the shortest range here:
 * eight centimetres of wing is gone as a thing you could name well before a rabbit is, so
 * it sits under the rabbit's and the squirrel's fifteen. Left at the fliers' unbounded
 * range it would have counted as a sighting out to the two hundred metres of the hide
 * range, which is not a sighting of a butterfly — and, since the director measures its own
 * cadence off these, would have quietly flattered every gap it reports.
 */
export const NOTICE: readonly number[] = [45, 45, 15, 15, Infinity, Infinity, Infinity, Infinity, 12];
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
const CROSS_RANGE: readonly [number, number] = [20, 40];
const COVER_RANGE: readonly [number, number] = [6, 15];
const TREELINE_RANGE: readonly [number, number] = [25, 45];
const PLACE_TRIES = 8;
/** Distinct species a single beat may try before giving up and waiting out `RETRY`. */
const CUE_DRAWS = 4;
/**
 * How far past the frame's edge (rad) a start may be drawn. Just past the shoulder, not
 * anywhere out of sight: the whole cue is the move from there into frame, and an animal
 * started behind the player has to walk around them to make it — half a minute for an elk,
 * by which time the player has walked on and the beat is long gone.
 */
const OUTSIDE_ARC = 0.25;
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
const COVER_MARK_SHARE = -0.4;
const TREELINE_MARK_SHARE = 0.75;
/**
 * The longest walk (s) a cue may be: a mark the animal is still on its way to when the
 * player has looked elsewhere is not a sighting, it is an animal standing in an empty
 * frame.
 *
 * MEASURED. A cue that the player did see took a median of 2.9 s from staging to the
 * frame; one that missed took 12.5 s, and 94 % of the misses arrived OUTSIDE the cone —
 * not hidden, not too far, simply aimed at where the frame used to be. The frame is not a
 * fixed target: the player walks at 1.4 m/s and turns, so a mark thirty metres out slides
 * sideways several metres a second, and an elk walking at two will never catch a frame it
 * set off after twelve seconds ago. Anything that cannot make it inside this budget is not
 * cued from where it stands — the beat redraws and finds an animal that can.
 *
 * Set at the bottom of the gap band rather than the top: a cue that takes longer than the
 * beat it was arranged for is late before it starts.
 */
const CUE_FLIGHT = 5;
/**
 * How long (s) the beat waits on a cue that has yet to be seen before arranging another.
 *
 * A BACKSTOP, not the fix, and it should not be read as one. A cue holds the beat so the
 * woods do not empty their whole pool into the player's back; held without a deadline,
 * that interlock turns every miss into a silence as long as the animal's walk, and a run
 * of misses into a minute and a half of dead woods. That is what the tail used to be made
 * of. What removed it was the miss rate going to about one cue in a thousand, and the
 * proof is that raising this to a billion reproduces the whole distribution to the decimal
 * on both committed walks: nothing waits this long any more.
 *
 * It stays because the day something does — a species that cannot reach its mark, a
 * heightfield that hides one mid-walk — the beat should move on rather than stand still.
 * `CUE_FLIGHT` is how long a cue may take; this is that plus the dwell the player has to
 * hold it for, so a cue that has used its whole budget and the look that was supposed to
 * follow has had its chance.
 */
export const CUE_PATIENCE = CUE_FLIGHT + SIGHTING_DWELL;
/**
 * How far ahead (s) a mark is aimed, and the most (rad) that aim may swing the frame.
 *
 * A mark is a point on the ground, but the frame it has to be inside is attached to a
 * player who is walking and turning. Aim at the frame as it stands and the animal arrives
 * at where the player WAS looking: measured over seven thousand seconds, that was the
 * whole miss — 94 % of cues the player never saw reached their mark outside the cone,
 * rather than hidden or too far. So the mark is taken against the view carried forward by
 * however the player has been moving, over about the walk it takes to get there.
 *
 * The cap is on how much of that carry-forward is trusted. A flick of the mouse says
 * nothing about where the player will be looking in four seconds, and an uncapped
 * extrapolation of one would throw the mark round behind them.
 */
const AIM_AHEAD = 3;
const AIM_YAW_CAP = 0.5;
/** A mark sits no further out than this share of what the species can be made out at —
 * walking an animal to a spot it reads as a speck at is not a sighting — and never closer
 * to the eye than this, which is a cue, not an ambush. */
const MARK_NOTICE_SHARE = 0.7;
/** The near end of a crossing's range band, as a share of what the species reads at. */
const CROSS_NOTICE_SHARE = 0.5;
const MARK_MIN_RANGE = 5;
/**
 * Height above the ground (m) a placed animal's body is taken to sit at — a standing
 * mammal's chest, and near enough the middle of the band a butterfly wanders in. The
 * `place` event carries the resulting height outright rather than leaving it to the shell:
 * the whole placement test is a line of sight to a POINT, and a point whose height the
 * director guessed and the shell then chose differently is a test of nothing.
 */
export const PLACE_BODY_H = 1;
/** A pool unit off screen and beyond this multiple of the range it could be seen at, held
 * for this long, has left the scene for good and is recycled. */
export const REMOVE_FACTOR = 1.5;
export const REMOVE_SECONDS = 5;
/**
 * The id namespace the shell draws a placed unit's id from — `DIRECTOR_ID_BASE + species *
 * stride + slot` — kept apart from the field's own so that any position a player could
 * plausibly reach never produces a colliding `states` map key. NOT literally disjoint from
 * the field's own range, though, and not a boundary the director itself tests any unit's id
 * against: an id is a name, not a magnitude, and reading ownership off it was the bug.
 * `wildlifeField.ts`'s packed field id biases every cell by `CELL_ID_BIAS` (8192) before the
 * species bits, so a unit anywhere near the world's own origin already carries an id north of
 * 2^30 — comfortably past this constant on its own, which is what `sweepRemovals` used to test
 * with a bare `>=`. Measured on the disc around (2000, -500): every one of 54 real units came
 * out between 1.075 and 1.085 billion. But the field's id range still touches this one at its
 * far edge: `unitId(SPECIES_SQUIRREL, -6144, -4093)` packs to exactly `DIRECTOR_ID_BASE + 3 *
 * 16 + 3` — a squirrel cell 6144 cells (147 km, at the squirrel's 24 m cell) out on X alone —
 * "orders of magnitude beyond anywhere a player reaches" per `unitId`'s own doc, but not
 * impossible on the number line, and this comment should not claim otherwise. Ownership is
 * carried explicitly on `Candidate.owned` instead — the shell knows exactly which units it
 * placed, and the director is told rather than left to guess from a number that was never a
 * reliable signal of it, collision or none. If this ever needs to be exact rather than
 * practically safe, the clean fix is drawing pool ids negative: a real field id is always a
 * positive int32 (`unitId`'s own doc), so a negative one would make the two namespaces provably
 * disjoint instead of merely improbable to collide.
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
/**
 * A unit the director may act on. It carries TWO positions, and which is which matters:
 *
 * - `x/y/z` is where the ANIMAL is — for a flier the bird itself, not the centre of the
 *   circle it happens to be flying, which can be a hundred metres from any of its birds.
 *   Every judgement about what the player can see reads this: on screen, safe to turn,
 *   far enough gone to recycle.
 * - `moveX/moveZ` is the unit's own ANCHOR: the point a cue's goal replaces, and the point
 *   the unit then walks or glides from. For a ground animal it is the same place as
 *   `x/z`; for a flier it is the loop centre, because a cue moves the whole circle and
 *   cannot move a bird along it. In the running game both are `UnitState.x/z`, while
 *   `x/y/z` comes off the lead pose.
 * - `moveR` is how far the unit's OTHER members reach from that anchor: the loop radius for
 *   a flier, zero for anything the player sees as one body. A cue moves the anchor, so it
 *   moves every metre of `moveR` with it, and the invariant has to hold over all of it —
 *   see `extentHidden`. In the running game it is `UnitState.unit.radius`.
 *
 * A `drive` goal is in `moveX/moveZ`'s space, so the mark is computed there too, and so is
 * the reach that decides whether the unit is close enough to be worth cueing. Mixing the
 * two is the bug this split exists to prevent: a mark aimed at a gull and applied to its
 * loop centre lands the bird up to fifty metres from where it was aimed.
 *
 * `onScreen` and `phase` are what the shell already knows — the first a cheap pre-filter
 * the director would otherwise re-derive, the second so a unit already mid-cue is left to
 * finish it.
 *
 * `owned` is told, not inferred: true for a unit the shell itself placed from its pool,
 * false for one the field generated. `sweepRemovals` is the one place this matters — only an
 * owned unit is ever the director's to take back — and it used to read `id >= DIRECTOR_ID_BASE`
 * as a stand-in for this, which real ids do not support: a field-generated id is a packed
 * (species, cell) name that can land anywhere in a 31-bit range, routinely well past
 * `DIRECTOR_ID_BASE` for a cell no distance from the origin at all. That let the director
 * believe an ordinary elk grazing off screen was a pool unit and ask for it back outright,
 * which the shell would have had no way to refuse without a guess of its own — the shell
 * knows which units came from its pool, so it says so here instead.
 */
export type Candidate = Seen & { onScreen: boolean; phase: number; moveX: number; moveZ: number; moveR: number; owned: boolean };
/**
 * What the director asks the shell to do. `drive` re-targets a unit that already exists,
 * `place` asks for one of the pool at a start point, and `remove` gives one back. Every
 * one of the three is emitted only where `placementValid` holds (or, for `remove`, where
 * the unit is far past the range it could be seen at), which is the whole promise: no
 * animal is ever seen arriving or leaving.
 */
export type CueEvent =
  | { kind: "drive"; id: number; goalX: number; goalZ: number; run: boolean }  // goal in the candidate's `moveX/moveZ` space
  | { kind: "place"; species: number; x: number; y: number; z: number; goalX: number; goalZ: number; run: boolean }
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
  // Indexed, like every other loop on a per-frame path here: this one runs for each unit
  // the eye test looks at, on every frame, and an iterator object per call is exactly the
  // allocation the director is not allowed to make. (The two `for…of` loops left in this
  // file build the weight table once, at module load.)
  for (let i = 0; i < LOS_FRACTIONS.length; i++) {
    const f = LOS_FRACTIONS[i]!;
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
  tick: number; haveView: boolean; viewX: number; viewZ: number; viewYaw: number;
  /** The view's own drift, per second, smoothed over the last frame: where the player is
   * walking and how fast they are turning. `markFor` carries the frame forward by it. */
  driftX: number; driftZ: number; driftYaw: number;
  /** The units on screen the player has already been credited with seeing, and how many of
   * the slots are in use. An id stays here only while its unit stays in view, so coming
   * back later is a fresh look. See `observe`. */
  counted: Int32Array;
  countedOn: Uint8Array;
  countedN: number;
  /** `DirectorState.logCount` as it stood when the cue now under way was arranged. While
   * it has not moved, that cue has yet to put anything in front of the player and still
   * holds the beat; the moment it does, the beat is free again. See `cueUnpaid`. */
  logAtStage: number;
  /** `tick` when that cue was arranged, so the beat can give up on it. See `cueUnpaid`. */
  stageTick: number;
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
    c = {
      tick: 0, haveView: false, viewX: 0, viewZ: 0, viewYaw: 0, driftX: 0, driftZ: 0, driftYaw: 0,
      counted: new Int32Array(SEEN_SLOTS), countedOn: new Uint8Array(SEEN_SLOTS), countedN: 0,
      logAtStage: -1, stageTick: 0, farFor: new Map(),
    };
    clockworks.set(state, c);
  }
  return c;
}
/** Animals the player may be looking at at once before the director stops keeping track of
 * which it has already counted. More than this in frame is not a cadence problem. */
const SEEN_SLOTS = 16;
function countedSlot(clock: Clockwork, id: number): number {
  for (let i = 0; i < clock.countedN; i++) if (clock.counted[i] === id) return i;
  return -1;
}
function markCounted(clock: Clockwork, id: number): void {
  if (clock.countedN >= SEEN_SLOTS) {
    for (let i = 1; i < SEEN_SLOTS; i++) clock.counted[i - 1] = clock.counted[i]!;
    clock.countedN = SEEN_SLOTS - 1;
  }
  clock.counted[clock.countedN++] = id;
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
    clock.driftX = (view.x - clock.viewX) / dt;
    clock.driftZ = (view.z - clock.viewZ) / dt;
    clock.driftYaw = wrapPi(view.yaw - clock.viewYaw) / dt;
    state.stillFor = Math.hypot(clock.driftX, clock.driftZ) < STILL_SPEED ? state.stillFor + dt : 0;
  } else {
    state.stillFor += dt;
    clock.haveView = true;
  }
  clock.viewX = view.x;
  clock.viewZ = view.z;
  clock.viewYaw = view.yaw;

  // Keep dwelling on the same unit for as long as it stays on screen — checked
  // by id, first, regardless of where it sits in `units` — so a second animal
  // merely being visible can never interrupt an accumulating dwell; only the
  // CURRENT candidate leaving does. Without that rule, two animals trading
  // places on screen faster than either holds it alone would restart the
  // dwell forever and never record a sighting, even though something was
  // visible the entire time. Once the current candidate leaves — or has been
  // counted, and so owes the player nothing more — the watch passes to the
  // nearest unit still uncounted: nearest rather than whichever happens to
  // come first in `units`, since a caller has no reason to keep that order
  // stable frame to frame. A unit that leaves loses its dwell outright rather
  // than banking it for a later return: a sighting is a continuous look, not
  // an accumulated one, and discarding a briefly occluded candidate's partial
  // progress is the conservative direction — it can only make the director
  // stage more cues later, never fewer.
  //
  // One pass over the units, and one only: it finds the current candidate, marks
  // which of the already-counted are still in view, and picks the nearest that
  // is not among them. `onScreen` runs the line-of-sight sampling, so no unit
  // pays for it twice. The pass no longer stops at the current candidate the way
  // it used to, because the director now has to know what ELSE is in frame to
  // credit it — a cone test per unit, and the ray only for the few it lets past.
  let candidate: Seen | undefined;
  let candidateOnScreen = false;
  let best: Seen | undefined;
  let bestDistance = Infinity;
  for (let i = 0; i < clock.countedN; i++) clock.countedOn[i] = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const visible = onScreen(view, ground, u, match.mist);
    if (u.id === state.lastSeenId) { candidate = u; candidateOnScreen = visible; }
    if (!visible) continue;
    const slot = countedSlot(clock, u.id);
    if (slot >= 0) { clock.countedOn[slot] = 1; continue; }
    const distance = Math.hypot(u.x - view.x, u.y - view.y, u.z - view.z);
    if (distance < bestDistance) { bestDistance = distance; best = u; }
  }
  // An id that has left the screen drops out, so the same animal coming back is a fresh
  // look rather than one the player is never credited with again.
  let kept = 0;
  for (let i = 0; i < clock.countedN; i++) if (clock.countedOn[i] === 1) clock.counted[kept++] = clock.counted[i]!;
  clock.countedN = kept;

  if (!candidateOnScreen || countedSlot(clock, state.lastSeenId) >= 0) {
    if (best !== undefined) {
      candidate = best;
      candidateOnScreen = true;
      state.lastSeenId = best.id;
      state.dwell = 0;
    } else if (!candidateOnScreen) {
      candidate = undefined;
      state.lastSeenId = -1;
      state.dwell = 0;
    }
  }

  // A sighting is a look, and a look is counted ONCE: the clock resets and the gap is
  // redrawn at the moment the dwell is met, and then runs again from there even while the
  // animal is still in view. That is the cadence the design asks for — an animal on screen
  // every five to ten seconds, arranged on a steady beat rather than only once the woods
  // have emptied — and holding the clock at zero for as long as the player keeps watching
  // pushes every gap out by however long they watched.
  //
  // Counted once PER ANIMAL, though, for as long as that animal stays in view. A deer
  // grazing in frame for a minute writing sixty entries a second apart would put the
  // histogram's median at the dwell rather than at the gap — but the deer standing there
  // must not silence the log either, because an elk that walks in beside it is a second
  // animal the player saw and the histogram is supposed to say so. Counting only the one
  // unit the director happened to latch onto first left the log reading twenty seconds of
  // empty woods over stretches when two and three animals came and went in frame.
  let recorded = false;
  if (candidateOnScreen && candidate !== undefined && countedSlot(clock, candidate.id) < 0) {
    state.dwell += dt;
    if (state.dwell >= SIGHTING_DWELL) {
      // Clamped, not left wherever the last frame's dt put it: `dwell` is a public field
      // and "the dwell was met" is the only thing its value at rest should say.
      state.dwell = SIGHTING_DWELL;
      markCounted(clock, candidate.id);
      recorded = true;
      state.sinceSighting = 0;
      state.lastSpecies = candidate.species;
      state.targetGap = drawGap(seed, clock.tick);
      const slot = (state.logCount % RECYCLE_LOG) * 2;
      state.log[slot] = clock.tick;
      state.log[slot + 1] = candidate.species;
      state.logCount++;
    }
  }
  if (!recorded) state.sinceSighting += dt;
}

/**
 * Which species a cue may draw, and how heavily. The ruling is about the two GROUPS, not
 * the individual species — "about six small sightings to one large" — so each group's
 * `SMALL_TO_LARGE`:1 share of the mass is split evenly inside it. Weighting each small
 * species at `SMALL_TO_LARGE` instead would put the groups at twice that, because there
 * are twice as many small species as large ones.
 *
 * Two species are absent on purpose, and both would otherwise look like oversights.
 *
 * The raven ROOST, because a roost IS its snag — perched on it, lifting off it, landing
 * back on it — so there is no mark in the world the director could send one to.
 *
 * The EAGLE, because it cannot be seen. It cruises at `EAGLE_ALT`, 120 to 250 metres up,
 * and a flying species' notice distance is bounded by the hide range, 200 metres in clear
 * air — so an eagle at its own altitude is at or beyond the distance anything registers as
 * a sighting at, before the frame is even considered. Cueing one would spend a beat on
 * something the player cannot see. Do NOT fix that by lengthening the ranges: the eagle
 * being scenery rather than a cue is the correct reading of how high it flies. Its share
 * of the large group goes to the elk and the deer.
 *
 * The BUTTERFLY was a third, briefly, for exactly as long as nothing could render one:
 * `wildlifeMeshes.ts`'s `SPECIES_ASSET` and `BIRD_ASSET` both stopped short of it, and
 * `DIRECTOR_POOL[SPECIES_BUTTERFLY]` held at 0 for the same reason. Weighting it here
 * anyway once cost the beat itself: `placeable()` still let a butterfly be drawn,
 * `poolSlotFor` then always declined it, and `applyPlace` returned having done nothing —
 * but the beat had already recorded itself as staged (`logAtStage`/`stageTick`), so
 * `cueUnpaid` held it idle for the rest of `CUE_PATIENCE` regardless. That was roughly one
 * draw in six spent on nothing until it shipped a real, code-built asset alongside
 * `DIRECTOR_POOL`'s own reversal — it now takes its share of the small group like any of
 * the other four.
 */
const CUE_LARGE: readonly number[] = [SPECIES_ELK, SPECIES_DEER];
const CUE_SMALL: readonly number[] = [SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY];
/** Exported as a test seam: `CUE_WEIGHT[s] > 0` is exactly "the director may draw this
 * species for a cue", which a table-consistency check needs without duplicating
 * `CUE_LARGE`/`CUE_SMALL` (and so risking drifting out of step with them) elsewhere.
 *
 * Sized by `SPECIES_COUNT`, and that is the whole point: `pickSpecies` walks this array's
 * own length, so a table pinned to whichever species happened to be last when it was
 * written would silently stop drawing the next one added — no throw, no failing test, just
 * a species the woods never show. It is held to `SPECIES_COUNT` by the same
 * per-species-table check in `wildlifeMeshes.test.ts` that holds the other nine. */
export const CUE_WEIGHT: readonly number[] = buildCueWeights();
function buildCueWeights(): number[] {
  const w = new Array<number>(SPECIES_COUNT).fill(0);
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
  return pickSpeciesExcept(state, draw, 0);
}
/** As `pickSpecies`, with a bit set per species already tried this beat also struck out.
 * -1 when nothing is left to draw. */
function pickSpeciesExcept(state: DirectorState, draw: number, tried: number): number {
  let total = 0;
  for (let s = 0; s < CUE_WEIGHT.length; s++) if (s !== state.lastSpecies && (tried & (1 << s)) === 0) total += CUE_WEIGHT[s]!;
  if (total <= 0) return -1;
  let t = clamp01(draw) * total;
  let last = -1;
  for (let s = 0; s < CUE_WEIGHT.length; s++) {
    const w = s === state.lastSpecies || (tried & (1 << s)) !== 0 ? 0 : CUE_WEIGHT[s]!;
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
/** An angle folded into (-pi, pi], so a difference of headings is the short way round. */
function wrapPi(a: number): number {
  const twoPi = 2 * Math.PI;
  let b = a % twoPi;
  if (b > Math.PI) b -= twoPi;
  else if (b <= -Math.PI) b += twoPi;
  return b;
}
/** Bearing (rad) of a point from the view's forward direction, positive toward the right
 * of the frame, wrapped to (-pi, pi]. */
function bearingOf(view: View, x: number, z: number): number {
  return wrapPi(Math.atan2(x - view.x, z - view.z) - view.yaw);
}
/** Written into, and read straight back out of, within a single call — a cue's mark, its
 * start point and the frame it is aimed at, kept across frames so `step` allocates nothing. */
const markScratch = { x: 0, z: 0 };
const startScratch = { x: 0, y: 0, z: 0 };
const aimScratch: View = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 1, aspect: 1 };
/**
 * The frame as it will stand about `AIM_AHEAD` from now, if the player keeps walking and
 * turning the way they have been. Marks are measured against this rather than against the
 * frame at staging — see `AIM_AHEAD`. Everything the INVARIANT is judged on stays on the
 * real view: only where a cue is sent is predicted, never where it is allowed to start.
 */
function aimFrame(state: DirectorState, view: View): View {
  const clock = clockworkFor(state);
  const swing = Math.max(-AIM_YAW_CAP, Math.min(AIM_YAW_CAP, clock.driftYaw * AIM_AHEAD));
  aimScratch.x = view.x + clock.driftX * AIM_AHEAD;
  aimScratch.y = view.y;
  aimScratch.z = view.z + clock.driftZ * AIM_AHEAD;
  aimScratch.yaw = view.yaw + swing;
  aimScratch.pitch = view.pitch;
  aimScratch.fov = view.fov;
  aimScratch.aspect = view.aspect;
  return aimScratch;
}
/** The point at `range` metres and `bearing` radians from the eye, written into `out`.
 * Forward is (sin yaw, cos yaw), so a bearing is simply added to the yaw. */
function pointAt(view: View, bearing: number, range: number, out: { x: number; z: number }): void {
  out.x = view.x + range * Math.sin(view.yaw + bearing);
  out.z = view.z + range * Math.cos(view.yaw + bearing);
}

/**
 * Which way across the frame a cue sends its animal, for an animal currently on `side` of
 * it. The range is `markFor`'s half of the answer; this is the bearing, on its own because
 * the start draw needs it too — a start is only worth drawing where the walk back to the
 * mark is one the animal can make.
 *
 * - Cross: the far edge, so the flight runs through the middle of the frame and out the
 *   other side.
 * - Cover: over the centre line to the other side — a dash across the frame rather than a
 *   pop-out that stops.
 * - Tree line: in from the edge on the animal's OWN side, and not far in. A herd sent down
 *   the view axis would be walking at the player, which is the one approach elk and deer
 *   flee from; and a herd sent to the middle of the frame is a herd walking for half a
 *   minute, by which time the player is looking somewhere else.
 */
function markBearing(view: View, staging: number, side: number): number {
  // The STRICT frame, the one `onScreen` reads: a mark parked in the margin would leave the
  // animal standing where the director itself does not count it as seen.
  if (staging === STAGING_CROSS) return -side * coneHalfAngle(view, VIEW_MARGIN);
  const share = staging === STAGING_COVER ? COVER_MARK_SHARE : TREELINE_MARK_SHARE;
  return side * share * coneHalfAngle(view, -VIEW_MARGIN);
}
/**
 * Where a cue sends its animal, given where the animal is now. Every mark lies inside the
 * frame or straight through it: a cue that ends off screen was not a cue. Measured against
 * whatever frame the caller hands in, which at staging is the one carried forward — see
 * `aimFrame`.
 */
function markFor(view: View, species: number, staging: number, fromX: number, fromZ: number, out: { x: number; z: number }): void {
  const bearing = bearingOf(view, fromX, fromZ);
  const side = bearing < 0 ? -1 : 1;
  const range = Math.hypot(fromX - view.x, fromZ - view.z);
  const notice = NOTICE[species] ?? Infinity;
  if (staging === STAGING_CROSS) {
    // Flown at the animal's own range, so the crossing is all sideways and none of it
    // toward or away — inside the same band the start was drawn from, which is scaled to
    // what the species reads at. The near end has to be scaled too, not just the far one:
    // `CROSS_RANGE[0]` is twenty metres because that is where a gull crosses, and a
    // butterfly is gone as a thing you could name at twelve, so a bare floor of twenty
    // sent every butterfly OUTWARD to the one range it could still just be seen at — the
    // opposite of all sideways, on the only species that gets a crossing at all.
    const near = Math.max(MARK_MIN_RANGE, Math.min(CROSS_RANGE[0], notice * CROSS_NOTICE_SHARE));
    const far = Math.max(near, notice);
    pointAt(view, markBearing(view, staging, side), Math.min(Math.max(near, range), far), out);
    return;
  }
  const markRange = Math.max(MARK_MIN_RANGE, Math.min(range, notice * MARK_NOTICE_SHARE));
  pointAt(view, markBearing(view, staging, side), markRange, out);
}

/** Points sampled along a cue's path, checking that some part of it is in frame. */
const PATH_SAMPLES = 6;
/**
 * Whether the cue lands: whether the animal, somewhere between where it starts and the
 * mark, is a thing the player is looking at — in frame, close enough for its species, and
 * not behind the ground.
 *
 * The one question a cue exists to answer, and until now it was only ever answered by
 * proxy. A mark inside the frame implies it for the two stagings that end in frame, but a
 * CROSSING ends at the far edge on purpose and is seen on the way, so nothing checked it
 * at all: a butterfly driven from behind the player's shoulder was sent to the far edge
 * along a line that passes BEHIND them, sweeping from out of frame one way to out of frame
 * the other without once being in it. That was a fifth of every crossing staged.
 *
 * Judged against the frame the mark was aimed at, since that is where the player is
 * expected to be looking by the time the animal is there.
 */
function cueLands(
  aim: View, ground: Ground, species: number, y: number, mist: number,
  fromX: number, fromZ: number, mark: { x: number; z: number },
): boolean {
  const notice = Math.min(NOTICE[species] ?? Infinity, hideRange(mist));
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const f = i / PATH_SAMPLES;
    const x = fromX + (mark.x - fromX) * f, z = fromZ + (mark.z - fromZ) * f;
    if (!inCone(aim, x, y, z, -VIEW_MARGIN)) continue;
    if (Math.hypot(x - aim.x, y - aim.y, z - aim.z) > notice) continue;
    if (lineOfSight(ground, aim, x, y, z)) return true;
  }
  return false;
}

/** Whether the animal can cover the ground between where it is and the mark inside
 * `CUE_FLIGHT`, at the gait this cue asked for. */
function reachable(species: number, run: boolean, fromX: number, fromZ: number, mark: { x: number; z: number }): boolean {
  return Math.hypot(mark.x - fromX, mark.z - fromZ) <= cueSpeedFor(species, run) * CUE_FLIGHT;
}
/**
 * The furthest out (m) an animal on this bearing may start and still reach its mark inside
 * the budget. The mark sits on the same circle about the eye, so the two are `sweep`
 * radians apart on a circle of radius `r` and the walk between them is the chord
 * `2 r sin(sweep / 2)` — which is linear in `r`, so the budget reads straight back as a
 * range.
 *
 * Without this the draw spends its tries on starts that are simply too far round, or too
 * far out, for the animal that has to walk in from them: an elk covers ten metres in the
 * budget, and a quarter of a radian at forty metres is ten on its own before the frame's
 * edge is even crossed. Capping the draw instead of rejecting it afterwards is what keeps
 * the slow species cueable at all — every try that comes back is one the animal can make.
 */
function reachRange(species: number, run: boolean, sweep: number): number {
  const chordPerMetre = 2 * Math.sin(Math.min(Math.PI, Math.abs(sweep)) / 2);
  if (chordPerMetre <= 0) return Infinity;
  return cueSpeedFor(species, run) * CUE_FLIGHT / chordPerMetre;
}
/** Draws a range in [lo, hi] capped at what `reachRange` allows — negative when nothing in
 * the band is close enough to walk in from. */
function drawRange(lo: number, hi: number, cap: number, b: number): number {
  const top = Math.min(hi, cap);
  return top < lo ? -1 : lo + b * (top - lo);
}
/**
 * How far past the frame's edge (rad) this species may usefully be started, given that it
 * has to walk back in. `OUTSIDE_ARC` at most — and, for a slow animal, much less: an elk
 * covers ten metres, which at the twenty-five it starts from is four tenths of a radian
 * all in, and the mark is already most of that away. Drawing across the full arc regardless
 * spends three quarters of a beat's tries on starts no elk could walk in from, which is
 * how the large species came to be cued half as often as their share of the draw.
 */
function outsideArcFor(aim: View, species: number, run: boolean, staging: number, edge: number, nearRange: number): number {
  const budget = cueSpeedFor(species, run) * CUE_FLIGHT;
  const sweepMax = 2 * Math.asin(Math.min(1, budget / (2 * nearRange)));
  return Math.max(0, Math.min(OUTSIDE_ARC, markBearing(aim, staging, 1) + sweepMax - edge));
}

/**
 * The `i`-th seeded start position for a staging, written into `out`; false when that try
 * is not available, would be seen appearing, or is somewhere this species could not walk
 * in from in time. Every try is put through `placementValid`, so the invariant holds by
 * construction however the geometry below is drawn.
 */
function startFor(
  view: View, aim: View, ground: Ground, match: MatchState, species: number, staging: number, run: boolean,
  seed: number, tick: number, i: number,
  out: { x: number; y: number; z: number },
): boolean {
  const a = hash3(seed, tick, SALT_BEARING + i, 0);
  const b = hash3(seed, tick, SALT_RANGE + i, 0);
  // Every start below is drawn on a bearing first and a range second, so the range can be
  // held to what the animal can walk from there — see `reachRange`.
  // Both ends as world headings, because the mark is measured against the frame carried
  // forward and the start against the frame as it stands.
  const sweepTo = (bearing: number): number => {
    const fromWorld = view.yaw + bearing;
    const rel = wrapPi(fromWorld - aim.yaw);
    return wrapPi(fromWorld - (aim.yaw + markBearing(aim, staging, rel < 0 ? -1 : 1)));
  };
  if (staging === STAGING_COVER) {
    // Just past the frame's edge, or — for the last two tries — anywhere in front of the
    // player that the ground happens to hide, which is the other half of "break cover".
    // `placementValid` is what decides whether it really is hidden, so the draw does not
    // have to guess where the dips are.
    const edge = coneHalfAngle(view, VIEW_MARGIN);
    const bearing = i < PLACE_TRIES - 2
      ? outsideBearing(edge, outsideArcFor(aim, species, run, staging, edge, COVER_RANGE[0]), a)
      : (a * 2 - 1) * Math.PI / 2;
    const range = drawRange(COVER_RANGE[0], COVER_RANGE[1], reachRange(species, run, sweepTo(bearing)), b);
    if (range < 0) return false;
    pointAt(view, bearing, range, out);
  } else if (staging === STAGING_CROSS) {
    // Twice the margin outside the frame: a crossing is the one staging that ends by
    // leaving the frame again, so it gets the widest berth going in as well.
    const notice = NOTICE[species] ?? Infinity;
    const crossLo = Math.min(CROSS_RANGE[0], notice * CROSS_NOTICE_SHARE);
    const edge = coneHalfAngle(view, 2 * VIEW_MARGIN);
    const bearing = outsideBearing(edge, outsideArcFor(aim, species, run, staging, edge, crossLo), a);
    // A crossing is the one staging whose sighting happens on the way rather than at the
    // mark, so what matters is how close the flight passes: in and out across a frame this
    // wide, the nearest the path comes to the eye is about half the range it is flown at.
    // Drawn further out than the species reads at, the whole crossing is a speck the
    // player never registers — which is what a butterfly, noticeable at twelve metres,
    // did on a fifth of its cues while the gulls beside it were fine.
    const range = drawRange(crossLo, Math.min(CROSS_RANGE[1], notice), reachRange(species, run, sweepTo(bearing)), b);
    if (range < 0) return false;
    pointAt(view, bearing, range, out);
  } else if (i < PLACE_TRIES - 2) {
    const edge = coneHalfAngle(view, VIEW_MARGIN);
    const bearing = outsideBearing(edge, outsideArcFor(aim, species, run, staging, edge, TREELINE_RANGE[0]), a);
    const range = drawRange(TREELINE_RANGE[0], TREELINE_RANGE[1], reachRange(species, run, sweepTo(bearing)), b);
    if (range < 0) return false;
    pointAt(view, bearing, range, out);
  } else {
    // The last two tries walk a herd in out of the fog instead of in from the side. Only
    // worth anything when the fog is close enough that the walk is a cue rather than a
    // hike: in clear air the hide range is 200 m and an elk would spend a minute and a half
    // getting anywhere near being noticed, so those tries are simply skipped.
    const hide = hideRange(match.mist);
    if (hide > TREELINE_RANGE[1]) return false;
    pointAt(view, (a * 2 - 1) * coneHalfAngle(view, -VIEW_MARGIN), hide + 5 + b * 5, out);
  }
  out.y = ground(out.x, out.z) + PLACE_BODY_H;
  return placementValid(view, ground, out.x, out.y, out.z, match.mist);
}

/**
 * Whether a unit of this species can be put into the world unseen at all.
 *
 * The three loop fliers cannot. A raven pair, a gull flock or an eagle is not a point: it
 * is a circle of 20 to 140 metres with birds spread around it, and the frame is 118 degrees
 * wide. For every bird on such a circle to start outside that frame, the circle's centre
 * has to sit several times its own radius away — hundreds of metres for an eagle, which is
 * a speck in the sky rather than a cue, and further than the mist lets anything be seen
 * anyway. There is no placement for them that the invariant allows, so there is none.
 *
 * Nor, as it turns out, is there a DRIVE — but for a different reason than the circle, and
 * it is worth being exact about which, because the obvious guess is wrong. Swept over every
 * altitude and loop radius the field draws, at every bearing out to four hundred metres,
 * there are no drives at all; and the predicate that refuses them is `reachable`, not
 * `extentHidden` and not the reach against `RECYCLE`. A crossing's mark is the far edge of
 * the frame, so the walk is a chord right across it — a hundred metres at the range a
 * flier flies at — and `CUE_FLIGHT` buys a gull sixty. Raising `RECYCLE` to 250 changes
 * nothing whatever; raising `CUE_FLIGHT` is what makes flier drives appear, and only then
 * does `RECYCLE` start to bind. The loop radius is not the cause either: a bird with no
 * circle at all, `moveR` zero, is refused under the same constants.
 *
 * So do NOT lengthen the reach hoping to get flier cues back; it is the flight budget or
 * the shape of the crossing. A loop flier draw always redraws, and the crossing the player
 * actually gets is the butterfly's: a point at head height with no loop, placed like any
 * mammal.
 */
function placeable(species: number): boolean {
  return species < FIRST_BIRD_SPECIES || species === SPECIES_BUTTERFLY;
}
/** A bearing drawn just outside the cone's edge, `arc` at most past it, on whichever side
 * the draw's own half picks. */
function outsideBearing(edge: number, arc: number, draw: number): number {
  const side = draw < 0.5 ? 1 : -1;
  return side * (edge + (draw < 0.5 ? draw : draw - 0.5) * 2 * arc);
}

/** Points probed around a loop flier's circle, on top of its centre and its lead bird. */
const EXTENT_PROBES = 8;
/**
 * Whether EVERY part of a unit is somewhere the player could not see it move.
 *
 * For an animal the player reads as one body that is just its own position. For a loop
 * flier it is not: `moveR` metres of circle carry birds too, a cue moves the anchor, and
 * the anchor takes the whole circle with it. Checking the lead bird alone would clear a
 * flock whose far side is dead ahead — the player watches that patch of sky and the whole
 * formation swings. This is the same argument `placeable` makes about starting a flier
 * from nothing, and it holds just as hard for turning one that is already flying; the
 * difference is only that here the circle is where it already is, so it can be measured
 * rather than ruled out.
 *
 * The circle is probed at the lead bird's height: every bird of a loop flies the one
 * altitude, so the bird the shell reports is the right height for all of them.
 */
function extentHidden(view: View, ground: Ground, c: Candidate, mist: number): boolean {
  if (!placementValid(view, ground, c.x, c.y, c.z, mist)) return false;
  if (c.moveR <= 0) return true;
  if (!placementValid(view, ground, c.moveX, c.y, c.moveZ, mist)) return false;
  for (let i = 0; i < EXTENT_PROBES; i++) {
    const a = (i / EXTENT_PROBES) * 2 * Math.PI;
    if (!placementValid(view, ground, c.moveX + c.moveR * Math.cos(a), c.y, c.moveZ + c.moveR * Math.sin(a), mist)) return false;
  }
  return true;
}

/**
 * The nearest unit of `species` the director may re-target: off screen, inside `RECYCLE`,
 * not already running a cue, able to reach a mark inside `CUE_FLIGHT`, and — the invariant
 * — somewhere the player could not see any part of it turn. Null when there is none, which
 * is what sends `stageCue` to the pool.
 */
function driveable(
  view: View, aim: View, ground: Ground, candidates: readonly Candidate[], species: number, staging: number, run: boolean, mist: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestDistance = RECYCLE;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.species !== species || c.onScreen || c.phase === PHASE_CUE) continue;
    // From the ANCHOR, because the anchor is the thing that travels — the same point the
    // mark is measured from and against. A gull's bird can sit fifty metres from its loop
    // centre, so reading the reach off the bird asks how far the wrong thing has to go.
    //
    // And measured ACROSS THE GROUND, not through the air: a raven pair forty metres up and
    // ten metres away is right on top of the player in the only sense a cue cares about,
    // and a straight-line distance would rule it out for being high rather than for being far.
    const distance = Math.hypot(c.moveX - view.x, c.moveZ - view.z);
    if (distance >= bestDistance) continue;
    if (!extentHidden(view, ground, c, mist)) continue;
    markFor(aim, species, staging, c.moveX, c.moveZ, markScratch);
    if (!reachable(species, run, c.moveX, c.moveZ, markScratch)) continue;
    if (!cueLands(aim, ground, species, c.y, mist, c.moveX, c.moveZ, markScratch)) continue;
    bestDistance = distance;
    best = c;
  }
  return best;
}

/**
 * Arrange one sighting: draw the species, then prefer to re-target an animal that already
 * exists over asking for a new one — it is cheaper, and an animal that was already there
 * cannot be seen arriving.
 *
 * A species the woods cannot produce right now — one of the loop fliers with none in reach
 * to drive (see `placeable`), or one with nowhere out of sight to start from — costs the
 * beat a REDRAW, not the beat itself: up to `CUE_DRAWS` distinct species are tried before
 * the whole beat is given up and retried after `RETRY`. Spending a full second of the
 * cadence because the first draw happened to be a gull is how the gap band gets missed.
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
  state.nextTry = tick + Math.round(RETRY * SIM_TICK_HZ);
  const clock = clockworkFor(state);
  const aim = aimFrame(state, view);
  let tried = 0;
  for (let attempt = 0; attempt < CUE_DRAWS; attempt++) {
    const species = pickSpeciesExcept(state, hash3(seed, tick, SALT_SPECIES + attempt, 0), tried);
    if (species < 0) break;
    tried |= 1 << species;
    const staging = stagingFor(species);
    // Breaking cover is a bolt; a flier's crossing and a herd's walk-in are not.
    const run = staging === STAGING_COVER;
    const driven = driveable(view, aim, ground, candidates, species, staging, run, match.mist);
    if (driven !== null) {
      // From the ANCHOR, not from the animal: the goal replaces the anchor, so a mark
      // measured anywhere else is a mark the mover cannot honour.
      markFor(aim, species, staging, driven.moveX, driven.moveZ, markScratch);
      out.push({ kind: "drive", id: driven.id, goalX: markScratch.x, goalZ: markScratch.z, run });
      clock.logAtStage = state.logCount;
      clock.stageTick = clock.tick;
      return true;
    }
    if (!placeable(species)) continue;
    for (let i = 0; i < PLACE_TRIES; i++) {
      if (!startFor(view, aim, ground, match, species, staging, run, seed, tick, i, startScratch)) continue;
      // A placed animal is its own anchor, so the two spaces coincide here.
      markFor(aim, species, staging, startScratch.x, startScratch.z, markScratch);
      // A start the animal cannot walk in from in time is no better than no start at all —
      // the next try draws one closer in, or shallower against the frame's edge. Nor is one
      // whose whole walk stays out of frame.
      if (!reachable(species, run, startScratch.x, startScratch.z, markScratch)) continue;
      if (!cueLands(aim, ground, species, startScratch.y, match.mist, startScratch.x, startScratch.z, markScratch)) continue;
      out.push({
        kind: "place", species, x: startScratch.x, y: startScratch.y, z: startScratch.z,
        goalX: markScratch.x, goalZ: markScratch.z, run,
      });
      clock.logAtStage = state.logCount;
      clock.stageTick = clock.tick;
      return true;
    }
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
 *
 * Only a unit `owned` marks as the shell's own is ever a candidate for this at all — a
 * field-generated animal is never the director's to take away, however far off screen it
 * wanders, however this frame's caller happened to number it.
 */
function sweepRemovals(
  state: DirectorState, view: View, candidates: readonly Candidate[], match: MatchState, dt: number,
  skipId: number, out: CueEvent[],
): void {
  const farFor = clockworkFor(state).farFor;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (!c.owned || c.id === skipId) continue;
    const seeable = Math.min(NOTICE[c.species] ?? Infinity, hideRange(match.mist));
    const distance = Math.hypot(c.x - view.x, c.y - view.y, c.z - view.z);
    if (c.phase === PHASE_CUE || distance <= REMOVE_FACTOR * seeable) { farFor.delete(c.id); continue; }
    const far = (farFor.get(c.id) ?? 0) + dt;
    if (far < REMOVE_SECONDS) { farFor.set(c.id, far); continue; }
    farFor.delete(c.id);
    out.push({ kind: "remove", id: c.id });
  }
}

/**
 * Whether a cue is still walking AND has yet to pay for itself, AND is still young enough
 * to be worth waiting on. One UNPAID cue at a time, for at most `CUE_PATIENCE`:
 * the staging condition only clears once something has been seen, so with no gate at all
 * the director would arrange a fresh animal every frame the last one spent on its way in
 * and empty its whole pool into the player's back.
 *
 * Unpaid is the operative word, and it was the whole cadence. A cue's job is done the
 * moment the player SEES the animal, not when the animal reaches its mark: an elk crosses
 * the frame's edge seconds into a walk it spends twenty seconds finishing, and gating on
 * arrival let that tail swallow two or three whole beats. Measured over a thousand
 * seconds, gating on arrival blocked 6909 of the 6967 frames on which a cue was due —
 * the cadence was not being set by the gap at all, but by how long animals took to stop
 * walking. Once a sighting lands the cue has delivered and the next beat may be arranged
 * over the top of it, which is what the woods look like when they are busy.
 *
 * And for at most `CUE_PATIENCE`, which is the ceiling on the whole tail. Waiting on a cue
 * with no deadline means a cue that misses costs its entire walk in silence, and two or
 * three misses running cost a minute and a half — the woods fall dead for exactly as long
 * as the player keeps looking somewhere else. Past the deadline the beat stops waiting and
 * arranges another animal; the one still walking is welcome to arrive and be seen, it just
 * no longer holds the floor.
 */
function cueUnpaid(state: DirectorState, candidates: readonly Candidate[]): boolean {
  const clock = clockworkFor(state);
  if (state.logCount !== clock.logAtStage) return false;
  if (clock.tick - clock.stageTick > CUE_PATIENCE * SIM_TICK_HZ) return false;
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
  if (relax < Infinity && state.sinceSighting > state.targetGap * relax - LEAD && tick >= state.nextTry && !cueUnpaid(state, candidates)) {
    const before = out.length;
    if (stageCue(state, view, ground, candidates, match, tick, seed, out)) {
      // A unit told to move this frame is not also given back this frame.
      const event = out[before]!;
      if (event.kind === "drive") drivenId = event.id;
    }
  }
  sweepRemovals(state, view, candidates, match, dt, drivenId, out);
}
