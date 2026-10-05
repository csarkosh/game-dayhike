/**
 * What the lake's dragonflies are doing: the darners patrolling their beats, hovering
 * and chasing their neighbours, the skimmers sallying from their perches and back, the
 * damselflies hopping among the reeds. Pure and Babylon-free: the layout, the clock, the
 * camera, the players and the presence in; poses and wing rustles out. `dragonflies.ts`
 * draws the poses and `waterLifeAudio.ts` sounds the rustles.
 *
 * Every random draw is hash3(unit, episode, salt, seed), the animals' rule
 * (`wildlifeBehaviour.ts`): a unit's episode counts its phases, and a unit coming into
 * range starts its count from the clock's slot (`ACTIVATE_SLOT`), so peers whose cameras
 * reach the lake within the same slot see much the same flight. Motion integrates the
 * frame's seconds, each frame at most `MAX_STEP_S`, so a hitch or a hidden tab never
 * throws a unit off its beat.
 *
 * Only units within `DRAGONFLY_RANGE` of the camera are stepped and posed, and of those
 * only the ones the kind's `seen` share keeps out of cover. Nothing is made per frame: the
 * pose objects, the pose lists and a handful of rustle events are made at creation and
 * rewritten in place.
 *
 * Renderer-only by design: nothing here may migrate into sim/.
 */
import { hash3 } from "../sim/field.js";
import type { DragonflyShare, WaterLifePresence } from "./waterLifeParams.js";
import type { DarnerBeat, HoverPoint, WaterLifeLayout } from "./waterLifeField.js";

export const KIND_DARNER = 0, KIND_SKIMMER = 1, KIND_DAMSELFLY = 2;
/** Units exist within this of the camera (m, across the ground, to the unit's home). */
export const DRAGONFLY_RANGE = 60;
/** A darner's patrol speed (m/s), drawn afresh each time it takes up its beat. */
export const DARNER_SPEED: readonly [number, number] = [1.6, 2.0];
/** The fastest a darner turns (rad/s): 300°/s, a U-turn about 0.7 m across at its patrol speed. */
export const DARNER_TURN = (300 * Math.PI) / 180;
/** Seconds a darner holds at a hover point, facing the shore. */
export const DARNER_HOVER_S: readonly [number, number] = [2, 30];
/** Two neighbouring darners chase at this speed (m/s) for this long (s). */
export const CHASE_SPEED = 3.6, CHASE_S: readonly [number, number] = [1, 3];
/** Seconds a skimmer sits between sallies. */
export const SKIMMER_PERCH_S: readonly [number, number] = [1, 10];
/** How far out over the water a skimmer's sally reaches (m). */
export const SKIMMER_SALLY: readonly [number, number] = [2, 5];
/** A skimmer's top speed (m/s), on a sally and between perches. */
export const SKIMMER_SPEED = 3;
/** Seconds a damselfly sits on a stem between hops. */
export const DAMSEL_PERCH_S: readonly [number, number] = [2, 15];
/** A damselfly's hop (m). */
export const DAMSEL_HOP: readonly [number, number] = [0.3, 1];
/** A damselfly's speed on a hop (m/s). */
export const DAMSEL_SPEED = 1;
/** Anything perched within this of a player (m, across the ground) flushes; a darner's beat bends around it. */
export const FLUSH_RADIUS = 2;
/** How far from its own stem a damselfly's hops take it (m): its share of the bed (`STEM_AREA`, a disc of
 * 1.13 m) with room to overlap its neighbours'. */
export const DAMSEL_BED_RADIUS = 1.5;
/** A flying darner or skimmer this near the camera (m) rustles, once a pass. */
export const RUSTLE_PASS = 2;
/** Two beats are neighbours when an end of one lies within this of an end of the other (m); they meet
 * halfway between those ends. */
export const BEAT_NEIGHBOUR_GAP = 6;
/** Neighbours chase when both are within this of their meeting point (m, across the ground). */
export const CHASE_NEAR = 3;
/** Seconds after a chase before either darner chases again. */
export const CHASE_REARM_S = 20;

export type DragonflyPose = {
  x: number; y: number; z: number; yaw: number; pitch: number; perched: boolean;
  /** The unit's own id, `kind · 4096 + index` in its kind's layout list: the same individual on every
   * frame, whatever its place in the list, so its colour and wing phase can be drawn from it. */
  id: number;
};
export type Dragonflies = {
  /** Units stepped and posed this frame, by kind. */
  readonly count: [number, number, number];
  /** By kind; the first `count[k]` are this frame's. The objects are reused frame to frame. */
  readonly poses: [DragonflyPose[], DragonflyPose[], DragonflyPose[]];
  /** This frame's events: a flying darner or skimmer passing within `RUSTLE_PASS` of the camera, and
   * a chase's start (`loud`). Emptied at the start of each step; the objects are reused, so read them
   * before the next step. */
  readonly rustles: { x: number; y: number; z: number; loud: boolean }[];
  step(tick: number, dt: number, camX: number, camY: number, camZ: number,
    players: readonly { x: number; y: number; z: number }[], presence: WaterLifePresence): void;
};

/** A frame longer than this (s) is stepped as this: a hitch or a hidden tab never flings a unit. */
const MAX_STEP_S = 0.1;
/** Metres along its beat a patrolling darner aims ahead of where it is. */
const LOOKAHEAD = 1;
/** Metres short of its beat's end where a darner turns back. */
const END_MARGIN = 0.5;
/** The share of hover points a passing darner stops at: about one a lap of two legs, so it patrols
 * more than it hovers. */
const HOVER_SHARE = 1 / 3;
/** Within this of its hover point or roost (m) a darner is on it. */
const HOLD = 0.03;
/** A darner closing on a point flies no faster than this times its distance across the ground (1/s);
 * below half its turn rate (5.2/s), so it closes in rather than circling the point. */
const ARRIVE_RATE = 2;
/** The fastest a darner climbs or sinks (m/s). */
const CLIMB = 1;
/** The fastest a darner turns in a chase (rad/s): the field's "often 1000°/s". */
const CHASE_TURN = (900 * Math.PI) / 180;
/** The circle a chase's leader flies about the meeting point (m), and how far ahead on it it aims (rad). */
const CHASE_RADIUS = 1.2;
const CHASE_LEAD = 0.8;
/** A darner roosts this far shoreward of a hover point (m) when it cannot fly. */
const ROOST_IN = 2;
/** Seconds a roosting darner stays once it could fly again. */
const ROOST_S: readonly [number, number] = [1, 10];
/** Perched pitch (rad) by kind: a darner hangs nose up, a skimmer sits nearly level, a damselfly level. */
const PERCH_PITCH: readonly [number, number, number] = [1.2, 0.1, 0];
/** A sally's loop is this share of its reach wide, and rises this high (m) at its far end. */
const SALLY_WIDTH = 0.3;
const SALLY_RISE = 0.4;
/** Radians either side of straight out over the water a sally may head. */
const SALLY_FAN = 0.8;
/** A skimmer rises this much (m) on its way from one perch to another. */
const TRANSFER_LIFT = 0.5;
/** The farthest perch (m) a flushed skimmer makes for; with none clear inside it, it sallies instead. */
const FLUSH_REACH = 15;
/** A perch counts as clear with no player within this (m): a little beyond the flush, so a flushed
 * skimmer does not land just inside the next one. */
const CLEAR_RADIUS = FLUSH_RADIUS + 1;
/** A damselfly's hop rises this much (m). */
const HOP_LIFT = 0.15;
/** Radians either side of straight away from a player a flushed damselfly hops. */
const HOP_SPREAD = 1;
/** A unit must be this far from the camera (m) before its next pass rustles. */
const RUSTLE_CLEAR = 2.5;
/** The most rustles a single frame reports. */
const RUSTLE_EVENTS_MAX = 8;
/** Ticks: a unit coming into range numbers its episodes from this slot of the clock. */
const ACTIVATE_SLOT = 600;
/** A unit's id is `kind · UNIT_STRIDE + index`. */
const UNIT_STRIDE = 4096;
/** The steepest a flying unit pitches (rad). */
const PITCH_MAX = 0.6;

const PERCHED = 0, PATROL = 1, HOVER = 2, CHASE = 3, ROOSTING = 4, ARC = 5, SALLY = 6;

/**
 * Salts, in 70–79 (clear of the wildlife's and of `WATER_LIFE_SALT`'s; `dragonflies.ts` takes 75 and 76):
 * a unit's two lifelong draws against its kind's shares, then the first, second and third draw of an
 * episode. An episode's number tells episodes apart and these tell its own draws apart, so no phase
 * needs a salt of its own: none draws more than three.
 */
const SALT_SEEN = 70, SALT_FLYING = 71, SALT_1 = 72, SALT_2 = 73, SALT_3 = 74;

/** A beat, flattened once for the patrol's arithmetic. */
type Beat = {
  /** x, y, z per point. */
  pts: Float64Array;
  /** Arc length at each point. */
  cum: Float64Array;
  length: number;
  hovers: readonly HoverPoint[];
  /** Each hover point's arc length along the beat. */
  hoverS: Float64Array;
  /** x, y, z per roost: one shoreward of each hover point, or one shoreward of the middle without any. */
  roosts: Float64Array;
};

type Unit = {
  kind: number; uid: number; index: number;
  /** Home across the ground, which the range is measured to. */
  ax: number; az: number;
  /** A skimmer's own perch, a damselfly's own stem. */
  homeX: number; homeY: number; homeZ: number;
  beat: Beat | null;
  /** The unit's draws against its kind's `seen` and `flying` shares. */
  seenDraw: number; flyDraw: number;
  inRange: boolean; live: boolean; near: boolean;
  phase: number; episode: number; t: number; dur: number;
  x: number; y: number; z: number; yaw: number; pitch: number; speed: number;
  /** The perch, stem or roost it sits on or is bound for; `at` its index (a perch's or a roost's). */
  px: number; py: number; pz: number; at: number;
  /** An arc's start and lift; a sally's heading (ox, oz), side (±1) and reach. */
  fx: number; fy: number; fz: number; lift: number;
  ox: number; oz: number; side: number; reach: number;
  /** A darner: its direction along the beat (±1), where along it it was, the hover point it just
   * passed or left, its chase's re-arm time, partner, role and meeting point. */
  dir: number; s: number; skip: number; rearm: number;
  partner: Unit | null; leader: boolean; mx: number; my: number; mz: number;
};

type Pair = { a: Unit; b: Unit; x: number; y: number; z: number };

function lerp(r: readonly [number, number], t: number): number {
  return r[0] + t * (r[1] - r[0]);
}
/** The angle wrapped into (−π, π]. */
function wrap(a: number): number {
  const twoPi = 2 * Math.PI;
  let w = a % twoPi;
  if (w > Math.PI) w -= twoPi;
  else if (w <= -Math.PI) w += twoPi;
  return w;
}
function clampPitch(p: number): number {
  return p > PITCH_MAX ? PITCH_MAX : p < -PITCH_MAX ? -PITCH_MAX : p;
}

function makeBeat(src: DarnerBeat, lakeX: number, lakeZ: number): Beat {
  const n = src.points.length;
  const pts = new Float64Array(n * 3);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = src.points[i]!;
    pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z;
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(p.x - pts[i * 3 - 3]!, p.z - pts[i * 3 - 1]!);
  }
  const beat: Beat = {
    pts, cum, length: n > 0 ? cum[n - 1]! : 0, hovers: src.hovers,
    hoverS: new Float64Array(src.hovers.length), roosts: new Float64Array(Math.max(1, src.hovers.length) * 3),
  };
  for (let k = 0; k < src.hovers.length; k++) {
    const h = src.hovers[k]!;
    beat.hoverS[k] = project(beat, h.x, h.z);
    beat.roosts[k * 3] = h.x + h.faceX * ROOST_IN;
    beat.roosts[k * 3 + 1] = h.y;
    beat.roosts[k * 3 + 2] = h.z + h.faceZ * ROOST_IN;
  }
  if (src.hovers.length === 0) {
    const mid = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
    pointAt(beat, beat.length / 2, mid);
    const ox = mid.x - lakeX, oz = mid.z - lakeZ, ol = Math.hypot(ox, oz);
    beat.roosts[0] = mid.x + (ol > 0 ? (ox / ol) * ROOST_IN : 0);
    beat.roosts[1] = mid.y;
    beat.roosts[2] = mid.z + (ol > 0 ? (oz / ol) * ROOST_IN : 0);
  }
  return beat;
}

/** The arc length of the point on the beat nearest (x, z), across the ground. */
function project(b: Beat, x: number, z: number): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i + 1 < b.cum.length; i++) {
    const ax = b.pts[i * 3]!, az = b.pts[i * 3 + 2]!;
    const hx = b.pts[i * 3 + 3]! - ax, hz = b.pts[i * 3 + 5]! - az;
    const l2 = hx * hx + hz * hz;
    let f = l2 > 0 ? ((x - ax) * hx + (z - az) * hz) / l2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const dx = ax + hx * f - x, dz = az + hz * f - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bestS = b.cum[i]! + f * (b.cum[i + 1]! - b.cum[i]!);
    }
  }
  return bestS;
}

type Aim = { x: number; y: number; z: number; tx: number; tz: number };

/** The point at arc length `s` (clamped to the beat) and the beat's heading there, across the ground. */
function pointAt(b: Beat, s: number, out: Aim): void {
  const n = b.cum.length;
  if (n < 2 || b.length <= 0) {
    out.x = b.pts[0] ?? 0; out.y = b.pts[1] ?? 0; out.z = b.pts[2] ?? 0; out.tx = 0; out.tz = 1;
    return;
  }
  const at = s <= 0 ? 0 : s >= b.length ? b.length : s;
  let i = 0;
  while (i < n - 2 && b.cum[i + 1]! < at) i++;
  const seg = b.cum[i + 1]! - b.cum[i]!;
  const f = seg > 0 ? (at - b.cum[i]!) / seg : 0;
  const ax = b.pts[i * 3]!, ay = b.pts[i * 3 + 1]!, az = b.pts[i * 3 + 2]!;
  const hx = b.pts[i * 3 + 3]! - ax, hy = b.pts[i * 3 + 4]! - ay, hz = b.pts[i * 3 + 5]! - az;
  out.x = ax + hx * f; out.y = ay + hy * f; out.z = az + hz * f;
  const hl = Math.hypot(hx, hz);
  out.tx = hl > 0 ? hx / hl : 0;
  out.tz = hl > 0 ? hz / hl : 1;
}

/** The nearest player within `r` of (x, z) across the ground, or −1. */
function nearestPlayer(players: readonly { x: number; z: number }[], x: number, z: number, r: number): number {
  let best = r * r;
  let found = -1;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= best) {
      best = d2;
      found = i;
    }
  }
  return found;
}

/**
 * Turns `u` toward (tx, tz) at no more than `turn` rad/s and flies it forward `speed`·h, climbing toward
 * `ty` at no more than `CLIMB`. With `arrive` it slows as it closes, so it settles on the point.
 */
function steer(u: Unit, tx: number, ty: number, tz: number, speed: number, turn: number, h: number, arrive: boolean): void {
  const dx = tx - u.x, dz = tz - u.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-6) {
    const d = wrap(Math.atan2(dx, dz) - u.yaw);
    const most = turn * h;
    u.yaw = wrap(u.yaw + (d > most ? most : d < -most ? -most : d));
  }
  const run = (arrive ? Math.min(speed, ARRIVE_RATE * dist) : speed) * h;
  u.x += Math.sin(u.yaw) * run;
  u.z += Math.cos(u.yaw) * run;
  const dy = ty - u.y;
  const most = CLIMB * h;
  const rise = dy > most ? most : dy < -most ? -most : dy;
  u.y += rise;
  u.pitch = run > 0 ? clampPitch(Math.atan2(rise, run)) : 0;
}

export function createDragonflyBehaviour(layout: WaterLifeLayout, seed: number): Dragonflies {
  const lakeX = layout.lake.x, lakeZ = layout.lake.z;
  const byKind: [Unit[], Unit[], Unit[]] = [[], [], []];

  function unit(kind: number, index: number, ax: number, az: number, hx: number, hy: number, hz: number, beat: Beat | null): Unit {
    const uid = kind * UNIT_STRIDE + index;
    return {
      kind, uid, index, ax, az, homeX: hx, homeY: hy, homeZ: hz, beat,
      seenDraw: hash3(uid, 0, SALT_SEEN, seed), flyDraw: hash3(uid, 0, SALT_FLYING, seed),
      inRange: false, live: false, near: false, phase: PERCHED, episode: 0, t: 0, dur: 0,
      x: hx, y: hy, z: hz, yaw: 0, pitch: 0, speed: DARNER_SPEED[0],
      px: hx, py: hy, pz: hz, at: index, fx: hx, fy: hy, fz: hz, lift: 0, ox: 0, oz: 1, side: 1, reach: 0,
      dir: 1, s: 0, skip: -1, rearm: 0, partner: null, leader: false, mx: 0, my: 0, mz: 0,
    };
  }

  const aim: Aim = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
  for (let i = 0; i < layout.beats.length; i++) {
    const src = layout.beats[i]!;
    if (src.points.length === 0) continue;
    const beat = makeBeat(src, lakeX, lakeZ);
    pointAt(beat, beat.length / 2, aim);
    byKind[KIND_DARNER].push(unit(KIND_DARNER, i, aim.x, aim.z, aim.x, aim.y, aim.z, beat));
  }
  for (let i = 0; i < layout.perches.length; i++) {
    const p = layout.perches[i]!;
    byKind[KIND_SKIMMER].push(unit(KIND_SKIMMER, i, p.x, p.z, p.x, p.y, p.z, null));
  }
  for (let i = 0; i < layout.stems.length; i++) {
    const p = layout.stems[i]!;
    byKind[KIND_DAMSELFLY].push(unit(KIND_DAMSELFLY, i, p.x, p.z, p.x, p.y, p.z, null));
  }

  // Neighbouring beats and where they meet: the middle of their two nearest ends.
  const pairs: Pair[] = [];
  const darners = byKind[KIND_DARNER];
  for (let i = 0; i < darners.length; i++) {
    for (let j = i + 1; j < darners.length; j++) {
      const a = darners[i]!.beat!, b = darners[j]!.beat!;
      let best = BEAT_NEIGHBOUR_GAP * BEAT_NEIGHBOUR_GAP;
      let found: Pair | null = null;
      for (const ea of [0, a.cum.length - 1]) {
        for (const eb of [0, b.cum.length - 1]) {
          const ax = a.pts[ea * 3]!, ay = a.pts[ea * 3 + 1]!, az = a.pts[ea * 3 + 2]!;
          const bx = b.pts[eb * 3]!, by = b.pts[eb * 3 + 1]!, bz = b.pts[eb * 3 + 2]!;
          const d2 = (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
          if (d2 <= best) {
            best = d2;
            found = { a: darners[i]!, b: darners[j]!, x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2 };
          }
        }
      }
      if (found !== null) pairs.push(found);
    }
  }

  const newPose = (): DragonflyPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, perched: true, id: 0 });
  const poses: [DragonflyPose[], DragonflyPose[], DragonflyPose[]] = [
    byKind[0].map(newPose), byKind[1].map(newPose), byKind[2].map(newPose),
  ];
  const count: [number, number, number] = [0, 0, 0];
  const rustles: { x: number; y: number; z: number; loud: boolean }[] = [];
  const rustlePool = Array.from({ length: RUSTLE_EVENTS_MAX }, () => ({ x: 0, y: 0, z: 0, loud: false }));
  let rustleCount = 0;

  function draw(u: Unit, salt: number): number {
    return hash3(u.uid, u.episode, salt, seed);
  }

  function rustle(x: number, y: number, z: number, loud: boolean): void {
    if (rustleCount >= RUSTLE_EVENTS_MAX) return;
    const e = rustlePool[rustleCount++]!;
    e.x = x; e.y = y; e.z = z; e.loud = loud;
    rustles.push(e);
  }

  function perch(u: Unit, range: readonly [number, number]): void {
    u.phase = PERCHED;
    u.episode++;
    u.x = u.px; u.y = u.py; u.z = u.pz;
    u.pitch = PERCH_PITCH[u.kind]!;
    u.t = 0;
    u.dur = lerp(range, draw(u, SALT_1));
  }

  /** An arc from where `u` is to (px, py, pz), rising `lift` at its middle, never faster than `speed`. */
  function startArc(u: Unit, px: number, py: number, pz: number, lift: number, speed: number): void {
    u.phase = ARC;
    u.episode++;
    u.fx = u.x; u.fy = u.y; u.fz = u.z;
    u.px = px; u.py = py; u.pz = pz;
    u.lift = lift;
    u.t = 0;
    // The climb and the lift's rise peak together at the start, so this is the arc's top speed.
    const ground = Math.hypot(px - u.x, pz - u.z);
    u.dur = Math.hypot(ground, Math.abs(py - u.y) + lift * Math.PI) / speed;
    if (ground > 1e-6) u.yaw = Math.atan2(px - u.x, pz - u.z);
  }

  function arc(u: Unit, h: number): boolean {
    u.t += h;
    const s = u.dur > 0 ? Math.min(u.t / u.dur, 1) : 1;
    const ground = Math.hypot(u.px - u.fx, u.pz - u.fz);
    u.x = u.fx + (u.px - u.fx) * s;
    u.z = u.fz + (u.pz - u.fz) * s;
    u.y = u.fy + (u.py - u.fy) * s + u.lift * Math.sin(Math.PI * s);
    u.pitch = clampPitch(Math.atan2(u.py - u.fy + u.lift * Math.PI * Math.cos(Math.PI * s), ground));
    return s >= 1;
  }

  // ---- Darners ----

  function startPatrol(u: Unit): void {
    u.phase = PATROL;
    u.episode++;
    u.speed = lerp(DARNER_SPEED, draw(u, SALT_1));
    u.dir = draw(u, SALT_2) < 0.5 ? -1 : 1;
    u.s = project(u.beat!, u.x, u.z);
    u.partner = null;
  }

  function startRoost(u: Unit, k: number): void {
    const r = u.beat!.roosts;
    u.phase = ROOSTING;
    u.episode++;
    u.at = k;
    u.px = r[k * 3]!; u.py = r[k * 3 + 1]!; u.pz = r[k * 3 + 2]!;
    u.partner = null;
  }

  /** The roost nearest (x, z), or with `far` the one farthest from it. */
  function roostBy(b: Beat, x: number, z: number, far: boolean): number {
    let pick = 0;
    let best = far ? -1 : Infinity;
    for (let k = 0; k * 3 < b.roosts.length; k++) {
      const d2 = (b.roosts[k * 3]! - x) ** 2 + (b.roosts[k * 3 + 2]! - z) ** 2;
      if (far ? d2 > best : d2 < best) {
        best = d2;
        pick = k;
      }
    }
    return pick;
  }

  /**
   * The aim point pushed sideways off the beat until it is `FLUSH_RADIUS` from every player, on the
   * side it already lay (the water's side for a player standing on the line), so the darner swings
   * round the player and carries on along its beat.
   */
  function bend(players: readonly { x: number; z: number }[]): void {
    for (let i = 0; i < players.length; i++) {
      const p = players[i]!;
      const dx = aim.x - p.x, dz = aim.z - p.z;
      if (dx * dx + dz * dz >= FLUSH_RADIUS * FLUSH_RADIUS) continue;
      const along = dx * aim.tx + dz * aim.tz;
      let across = dx * aim.tz - dz * aim.tx;
      if (Math.abs(across) < 1e-6) across = (lakeX - aim.x) * aim.tz - (lakeZ - aim.z) * aim.tx >= 0 ? 1 : -1;
      const need = Math.sqrt(FLUSH_RADIUS * FLUSH_RADIUS - along * along);
      const off = across > 0 ? need : -need;
      aim.x = p.x + along * aim.tx + off * aim.tz;
      aim.z = p.z + along * aim.tz - off * aim.tx;
    }
  }

  function patrol(u: Unit, h: number, players: readonly { x: number; z: number }[]): void {
    const b = u.beat!;
    const s = project(b, u.x, u.z);
    if (u.dir > 0 && s >= b.length - END_MARGIN) { u.dir = -1; u.skip = -1; }
    else if (u.dir < 0 && s <= END_MARGIN) { u.dir = 1; u.skip = -1; }
    for (let k = 0; k < b.hoverS.length; k++) {
      if (k === u.skip) continue;
      const hs = b.hoverS[k]!;
      if (!(u.dir > 0 ? u.s < hs && s >= hs : u.s > hs && s <= hs)) continue;
      u.skip = k;
      u.episode++;
      const hp = b.hovers[k]!;
      if (draw(u, SALT_1) < HOVER_SHARE && nearestPlayer(players, hp.x, hp.z, FLUSH_RADIUS) < 0) {
        u.phase = HOVER;
        u.at = k;
        u.t = 0;
        u.dur = lerp(DARNER_HOVER_S, draw(u, SALT_2));
        u.s = s;
        return;
      }
    }
    u.s = s;
    if (u.rearm > 0) u.rearm -= h;
    pointAt(b, s + u.dir * LOOKAHEAD, aim);
    bend(players);
    steer(u, aim.x, aim.y, aim.z, u.speed, DARNER_TURN, h, false);
  }

  function hover(u: Unit, h: number, players: readonly { x: number; z: number }[]): void {
    const hp = u.beat!.hovers[u.at]!;
    if (nearestPlayer(players, hp.x, hp.z, FLUSH_RADIUS) >= 0) {
      startPatrol(u);
      return;
    }
    if (Math.hypot(hp.x - u.x, hp.y - u.y, hp.z - u.z) > HOLD) {
      steer(u, hp.x, hp.y, hp.z, u.speed, DARNER_TURN, h, true);
      return;
    }
    u.x = hp.x; u.y = hp.y; u.z = hp.z; u.pitch = 0;
    const d = wrap(Math.atan2(hp.faceX, hp.faceZ) - u.yaw);
    const most = DARNER_TURN * h;
    u.yaw = wrap(u.yaw + (d > most ? most : d < -most ? -most : d));
    u.t += h;
    if (u.t >= u.dur) startPatrol(u);
  }

  function chase(u: Unit, h: number): void {
    u.t += h;
    if (u.t >= u.dur) {
      startPatrol(u);
      u.rearm = CHASE_REARM_S;
      return;
    }
    let tx: number, tz: number;
    if (u.leader || u.partner === null) {
      const a = Math.atan2(u.x - u.mx, u.z - u.mz) + u.side * CHASE_LEAD;
      tx = u.mx + CHASE_RADIUS * Math.sin(a);
      tz = u.mz + CHASE_RADIUS * Math.cos(a);
    } else {
      tx = u.partner.x;
      tz = u.partner.z;
    }
    steer(u, tx, u.my, tz, CHASE_SPEED, CHASE_TURN, h, false);
  }

  function startChase(u: Unit, partner: Unit, leader: boolean, dur: number, side: number, at: Pair): void {
    u.phase = CHASE;
    u.t = 0;
    u.dur = dur;
    u.partner = partner;
    u.leader = leader;
    u.side = side;
    u.mx = at.x; u.my = at.y; u.mz = at.z;
  }

  function stepDarner(u: Unit, h: number, players: readonly { x: number; z: number }[], flyOk: boolean): void {
    const b = u.beat!;
    switch (u.phase) {
      case PATROL: case HOVER: case CHASE:
        if (!flyOk) startRoost(u, roostBy(b, u.x, u.z, false));
        else if (u.phase === PATROL) patrol(u, h, players);
        else if (u.phase === HOVER) hover(u, h, players);
        else chase(u, h);
        return;
      case ROOSTING:
        if (flyOk) { startPatrol(u); return; }
        if (Math.hypot(u.px - u.x, u.py - u.y, u.pz - u.z) > HOLD) steer(u, u.px, u.py, u.pz, u.speed, DARNER_TURN, h, true);
        else if (nearestPlayer(players, u.px, u.pz, FLUSH_RADIUS) < 0) perch(u, ROOST_S);
        return;
      default: {
        const p = nearestPlayer(players, u.x, u.z, FLUSH_RADIUS);
        if (p >= 0) {
          if (flyOk) startPatrol(u);
          else startRoost(u, roostBy(b, players[p]!.x, players[p]!.z, true));
          return;
        }
        u.t += h;
        if (flyOk && u.t >= u.dur) startPatrol(u);
      }
    }
  }

  // ---- Skimmers ----

  function startSally(u: Unit): void {
    u.phase = SALLY;
    u.episode++;
    u.reach = lerp(SKIMMER_SALLY, draw(u, SALT_1));
    const heading = Math.atan2(lakeX - u.px, lakeZ - u.pz) + (2 * draw(u, SALT_2) - 1) * SALLY_FAN;
    u.ox = Math.sin(heading);
    u.oz = Math.cos(heading);
    u.side = draw(u, SALT_3) < 0.5 ? -1 : 1;
    u.t = 0;
    // Every term of the loop's speed peaks together at its start, so this is its top speed.
    const w = 2 * SALLY_WIDTH;
    u.dur = (Math.PI * Math.sqrt(u.reach * u.reach * (1 + w * w) + SALLY_RISE * SALLY_RISE)) / SKIMMER_SPEED;
  }

  /** A loop out over the water and back to the perch: out along (ox, oz) and back on the other side. */
  function sally(u: Unit, h: number): boolean {
    u.t += h;
    const s = Math.min(u.t / u.dur, 1);
    const a = Math.PI * s;
    const out = u.reach * Math.sin(a);
    const wide = u.side * u.reach * SALLY_WIDTH;
    const side = wide * Math.sin(2 * a);
    u.x = u.px + u.ox * out + u.oz * side;
    u.z = u.pz + u.oz * out - u.ox * side;
    u.y = u.py + SALLY_RISE * Math.sin(a);
    const vo = u.reach * Math.cos(a), vs = 2 * wide * Math.cos(2 * a);
    const vx = u.ox * vo + u.oz * vs, vz = u.oz * vo - u.ox * vs;
    u.yaw = Math.atan2(vx, vz);
    u.pitch = clampPitch(Math.atan2(SALLY_RISE * Math.cos(a), Math.hypot(vx, vz)));
    return s >= 1;
  }

  function clearOf(players: readonly { x: number; z: number }[], x: number, z: number): boolean {
    return nearestPlayer(players, x, z, CLEAR_RADIUS) < 0;
  }

  /** The perch nearest the one `u` is on, other than it, with no player near and within `FLUSH_REACH`; or −1. */
  function clearPerch(u: Unit, players: readonly { x: number; z: number }[]): number {
    let pick = -1;
    let best = FLUSH_REACH * FLUSH_REACH;
    for (let j = 0; j < layout.perches.length; j++) {
      if (j === u.at) continue;
      const p = layout.perches[j]!;
      const d2 = (p.x - u.px) ** 2 + (p.z - u.pz) ** 2;
      if (d2 <= best && clearOf(players, p.x, p.z)) {
        best = d2;
        pick = j;
      }
    }
    return pick;
  }

  function toPerch(u: Unit, j: number): void {
    const p = layout.perches[j]!;
    startArc(u, p.x, p.y, p.z, TRANSFER_LIFT, SKIMMER_SPEED);
    u.at = j;
  }

  function stepSkimmer(u: Unit, h: number, players: readonly { x: number; z: number }[], flyOk: boolean): void {
    switch (u.phase) {
      case SALLY:
        if (sally(u, h)) perch(u, SKIMMER_PERCH_S);
        return;
      case ARC:
        if (arc(u, h)) perch(u, SKIMMER_PERCH_S);
        return;
      default: {
        if (nearestPlayer(players, u.px, u.pz, FLUSH_RADIUS) >= 0) {
          const j = clearPerch(u, players);
          if (j >= 0) toPerch(u, j);
          else startSally(u);
          return;
        }
        u.t += h;
        if (!flyOk || u.t < u.dur) return;
        if (u.at !== u.index && clearOf(players, u.homeX, u.homeZ)) toPerch(u, u.index);
        else startSally(u);
      }
    }
  }

  // ---- Damselflies ----

  /** A hop to another spot in the bed: anywhere, or away from a player; kept within `DAMSEL_BED_RADIUS`. */
  function startHop(u: Unit, from: { x: number; z: number } | null): void {
    u.episode++;
    const len = lerp(DAMSEL_HOP, draw(u, SALT_1));
    const a = from !== null
      ? Math.atan2(u.x - from.x, u.z - from.z) + (2 * draw(u, SALT_2) - 1) * HOP_SPREAD
      : 2 * Math.PI * draw(u, SALT_2);
    let tx = u.x + len * Math.sin(a);
    let tz = u.z + len * Math.cos(a);
    const dx = tx - u.homeX, dz = tz - u.homeZ;
    const r = Math.hypot(dx, dz);
    if (r > DAMSEL_BED_RADIUS) {
      tx = u.homeX + (dx * DAMSEL_BED_RADIUS) / r;
      tz = u.homeZ + (dz * DAMSEL_BED_RADIUS) / r;
    }
    startArc(u, tx, u.homeY, tz, HOP_LIFT, DAMSEL_SPEED);
  }

  function stepDamselfly(u: Unit, h: number, players: readonly { x: number; z: number }[], flyOk: boolean): void {
    if (u.phase === ARC) {
      if (arc(u, h)) perch(u, DAMSEL_PERCH_S);
      return;
    }
    const p = nearestPlayer(players, u.x, u.z, FLUSH_RADIUS);
    if (p >= 0) {
      startHop(u, players[p]!);
      return;
    }
    u.t += h;
    if (flyOk && u.t >= u.dur) startHop(u, null);
  }

  // ---- Range ----

  /** A unit coming into range starts afresh: a darner on its beat (or at a roost if it cannot fly), the
   * others sitting at home part-way through a dwell. */
  function activate(u: Unit, tick: number, flyOk: boolean): void {
    u.episode = Number.isFinite(tick) ? Math.floor(tick / ACTIVATE_SLOT) : 0;
    u.near = false;
    u.partner = null;
    u.rearm = 0;
    u.skip = -1;
    if (u.kind === KIND_DARNER) {
      const b = u.beat!;
      u.speed = lerp(DARNER_SPEED, draw(u, SALT_1));
      if (!flyOk) {
        startRoost(u, Math.floor(draw(u, SALT_2) * (b.roosts.length / 3)));
        perch(u, ROOST_S);
        u.t = draw(u, SALT_2) * u.dur;
        return;
      }
      pointAt(b, draw(u, SALT_2) * b.length, aim);
      u.x = aim.x; u.y = aim.y; u.z = aim.z;
      u.dir = draw(u, SALT_3) < 0.5 ? -1 : 1;
      u.yaw = Math.atan2(aim.tx * u.dir, aim.tz * u.dir);
      u.pitch = 0;
      u.s = project(b, u.x, u.z);
      u.phase = PATROL;
      return;
    }
    u.at = u.index;
    u.px = u.homeX; u.py = u.homeY; u.pz = u.homeZ;
    u.yaw = 2 * Math.PI * draw(u, SALT_1);
    perch(u, u.kind === KIND_SKIMMER ? SKIMMER_PERCH_S : DAMSEL_PERCH_S);
    u.t = draw(u, SALT_2) * u.dur;
  }

  const range2 = DRAGONFLY_RANGE * DRAGONFLY_RANGE;

  return {
    count,
    poses,
    rustles,
    step(tick, dt, camX, camY, camZ, players, presence) {
      const h = dt > 0 ? Math.min(dt, MAX_STEP_S) : 0;
      if (rustles.length !== 0) rustles.length = 0;
      rustleCount = 0;
      for (let k = 0; k < 3; k++) {
        const list = byKind[k]!;
        const share: DragonflyShare = k === KIND_DARNER ? presence.darner : k === KIND_SKIMMER ? presence.skimmer : presence.damselfly;
        const out = poses[k]!;
        let n = 0;
        for (let i = 0; i < list.length; i++) {
          const u = list[i]!;
          const gx = u.ax - camX, gz = u.az - camZ;
          if (!(gx * gx + gz * gz <= range2)) {
            u.inRange = false;
            u.live = false;
            continue;
          }
          const flyOk = u.flyDraw < share.flying;
          if (!u.inRange) {
            u.inRange = true;
            activate(u, tick, flyOk);
          }
          // In cover: neither stepped nor drawn until the share brings it out again.
          u.live = u.seenDraw < share.seen;
          if (!u.live) continue;
          if (k === KIND_DARNER) stepDarner(u, h, players, flyOk);
          else if (k === KIND_SKIMMER) stepSkimmer(u, h, players, flyOk);
          else stepDamselfly(u, h, players, flyOk);
          if (k !== KIND_DAMSELFLY) {
            if (u.phase === PERCHED) u.near = false;
            else {
              const d2 = (u.x - camX) ** 2 + (u.y - camY) ** 2 + (u.z - camZ) ** 2;
              if (!u.near && d2 <= RUSTLE_PASS * RUSTLE_PASS) {
                u.near = true;
                rustle(u.x, u.y, u.z, false);
              } else if (u.near && d2 > RUSTLE_CLEAR * RUSTLE_CLEAR) u.near = false;
            }
          }
          const pose = out[n++]!;
          pose.x = u.x; pose.y = u.y; pose.z = u.z; pose.yaw = u.yaw; pose.pitch = u.pitch;
          pose.perched = u.phase === PERCHED;
          pose.id = u.uid;
        }
        count[k] = n;
      }
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]!;
        const a = pair.a, b = pair.b;
        if (!a.live || !b.live || a.phase !== PATROL || b.phase !== PATROL || a.rearm > 0 || b.rearm > 0) continue;
        if (Math.hypot(a.x - pair.x, a.z - pair.z) > CHASE_NEAR || Math.hypot(b.x - pair.x, b.z - pair.z) > CHASE_NEAR) continue;
        a.episode++;
        const dur = lerp(CHASE_S, draw(a, SALT_1));
        const aLeads = draw(a, SALT_2) < 0.5;
        const side = draw(a, SALT_3) < 0.5 ? -1 : 1;
        startChase(a, b, aLeads, dur, side, pair);
        startChase(b, a, !aLeads, dur, side, pair);
        rustle(pair.x, pair.y, pair.z, true);
      }
    },
  };
}
