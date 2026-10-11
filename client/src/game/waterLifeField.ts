import { hash3 } from "../sim/field.js";
import { marshWeightAt } from "../sim/features.js";
import { lakeOutline, lakeShelfWidth, lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";
import { elevationAt, type LakeSource } from "../sim/terrain.js";
import { COHORT_SNAG, treesInRect } from "../sim/vegetation.js";
import {
  CLUTTER_BUSH, CLUTTER_DRIFTLOG, CLUTTER_REED, CLUTTER_SHRUB, CLUTTER_WETPLANT, clutterDensity, clutterInRect,
} from "../sim/clutter.js";

/**
 * Where the lake's life is, Babylon-free: a pure function of the world's seed
 * and its lake, laid out once a world, so every player has the same lake.
 * The midges' swarm markers over the shore's shrubs, reeds, logs and snags and
 * over open water, the darners' beats along the shore, the skimmers' perches,
 * the damselflies' stems in the reed beds and the chorus frogs' voices at the
 * water's edge. Reads the sim's fields and never adds to them.
 *
 * The shore band is where the shore distance s lies from SHORE_BAND_OUT
 * outside the shore to SHORE_BAND_IN inside it (spec §10.2), with the marsh
 * wherever it reaches. Everything lies in it but a swarm over a snag, which
 * may stand to SNAG_REACH outside the shore. The shore is walked along the
 * lake's outline marched every SHORE_STEP metres (`shoreWalk`), by arc length
 * from the outline's first point, and cut into stretches from there: marker
 * i holds stretch i of the markers', beat b stretch b of the beats', whose
 * ends meet their neighbours'. A point on the walk is offset along the
 * shore's own normal there, `−∇s / |∇s|`, outward from the water.
 */

export const SHORE_BAND_IN = 8;
export const SHORE_BAND_OUT = 15;
/** Metres of shore per swarm marker, 16 for a round lake of 25 m; and the
 * most in a lake, the swarms' table's marker rows (`midgeMotion.ts`
 * `HEAD_ROW0`), so a long shore spaces its markers wider. */
export const MARKER_SPACING = 10;
export const MARKERS_MAX = 25;
/** Metres of shore per darner beat, one male a stretch of shore. */
export const BEAT_LENGTH = 20;
/** Metres of shore per skimmer perch. */
export const PERCH_SPACING = 8;
/** Square metres of reed bed per damselfly stem, and the most in a lake. */
export const STEM_AREA = 4;
export const STEMS_MAX = 40;
/** Metres of shore per frog voice; along the marsh at 2/3 of it, half again its share. */
export const FROG_SPACING = 25;
export const FROGS_MIN = 6, FROGS_MAX = 12;
/** The outline the shore is walked along, marched every this many metres. */
export const SHORE_STEP = 2;

/** The salts of every draw here and of the swarms over the players' heads:
 * `hash3(unit, draw, salt, seed)`. Clear of the animals' salts. */
export const WATER_LIFE_SALT = Object.freeze({
  marker: 60, beat: 61, perch: 62, bed: 63, stem: 64, stemDraw: 65, voice: 66, head: 67,
});

export type SwarmMarker = {
  /** The swarm's centre, absolute. */
  x: number; y: number; z: number;
  /** 60–400, skewed small. */
  midges: number;
  /** Horizontal, m: 0.3 + 0.0012 a midge (0.37–0.78). */
  radius: number;
  /** Vertical half-extent, m: the radius for a ball, 1–1.5 for a column. */
  height: number;
  /** Above 200 midges. */
  column: boolean;
  /** 0–4095, small enough for the shader's float hash. */
  seed: number;
  /** Over open water rather than a shrub, reed, log or snag. */
  water: boolean;
};
/** A darner's hover point, facing the shore along (faceX, faceZ), a unit vector. */
export type HoverPoint = { x: number; y: number; z: number; faceX: number; faceZ: number };
/** A darner's beat: a line 1–3 m out over the water along about 20 m of shore. */
export type DarnerBeat = { points: { x: number; y: number; z: number }[]; hovers: HoverPoint[]; seed: number };
export type Perch = { x: number; y: number; z: number; seed: number };
export type FrogVoice = { x: number; y: number; z: number; seed: number; marsh: boolean };
export type WaterLifeLayout = {
  lake: LakeSource;
  markers: SwarmMarker[];
  beats: DarnerBeat[];
  /** The skimmers'. */
  perches: Perch[];
  /** The damselflies'. */
  stems: Perch[];
  voices: FrogVoice[];
};

/** The shore walked by arc length: the outline's points and, at each, the length walked to it from the first; `total` the whole loop. */
export type ShoreWalk = { xs: readonly number[]; zs: readonly number[]; at: Float64Array; total: number };
/** A point on the walk and the shore's outward unit normal there. */
export type ShorePoint = { x: number; z: number; nx: number; nz: number };

/** A snag this far outside the shore still holds a swarm (m). */
const SNAG_REACH = 20;
/** A marker's candidates by preference, and each one's top above its ground (m). */
const RANK_SHRUB = 0, RANK_REED = 1, RANK_DRIFTLOG = 2, RANK_SNAG = 3;
const CANDIDATE_TOP: readonly number[] = [1.5, 1.5, 0.6, 6];
/** A swarm's centre over its candidate's top, and over open water (m). */
const MARKER_LIFT: readonly [number, number] = [1, 4];
const WATER_LIFT: readonly [number, number] = [1, 2];
/** One marker in three goes over open water, this far in from the shore (m). */
const WATER_SHARE = 1 / 3;
const WATER_IN: readonly [number, number] = [2, 8];
/** A swarm's midges: MIDGES_MIN + MIDGES_SPAN · u², and a column above COLUMN_FROM. */
const MIDGES_MIN = 60, MIDGES_SPAN = 340, COLUMN_FROM = 200;
const RADIUS_BASE = 0.3, RADIUS_PER_MIDGE = 0.0012;
const COLUMN_HEIGHT: readonly [number, number] = [1, 1.5];
/** Seeds handed on to the shaders stay below this. */
const SEED_RANGE = 4096;
/** A beat's line, its points out over the water and up from it (m). */
const BEAT_POINTS = 5;
const BEAT_OUT: readonly [number, number] = [1, 3];
const BEAT_UP: readonly [number, number] = [0.5, 2];
/** A skimmer's perch above its footing: the candidate's ground, or for a reed where there is water under it, the water (m). */
const PERCH_UP: readonly [number, number] = [0.3, 1.5];
/** A shrub, bush or drift log whose ground lies more than this below the water (m) is no perch: a
 * skimmer sallying from it toward the lake would fly into the bank. */
const PERCH_BANK_DROP = 1;
/** A reed bed: reeds or wet plants above this density. Stems fill whole
 * patches of BED_PATCH × BED_PATCH cells before the next, so the
 * damselflies stand together in a few beds. */
const STEM_DENSITY = 0.3;
const BED_PATCH = 4;
const STEM_UP: readonly [number, number] = [0.3, 1];
const FROG_MARSH_SHARE = 1.5;
/** A frog's place about the shore (± m) and its slip along it (± a share of the spacing). */
const FROG_EDGE = 0.5;
const FROG_SLIP = 0.15;
/** Metres of shore a step of the frogs' walk. */
const RIM_STEP = 1;

type Candidate = { x: number; z: number; ground: number; rank: number; arc: number };

const SHORE = newLakeShore();

/** The marsh's middle, in from the shore, where its frogs call (m): half the lake's shelf. */
export function marshMid(shape: LakeShape): number {
  return lakeShelfWidth(shape.sMax) / 2;
}

/** The lake's outline marched every SHORE_STEP metres, walked by arc length. */
export function shoreWalk(shape: LakeShape): ShoreWalk {
  const o = lakeOutline(shape, SHORE_STEP);
  const n = o.xs.length;
  const at = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    at[i] = total;
    const j = (i + 1) % n;
    total += Math.hypot((o.xs[j] as number) - (o.xs[i] as number), (o.zs[j] as number) - (o.zs[i] as number));
  }
  return { xs: o.xs, zs: o.zs, at, total };
}

/** The point `arc` metres along the walk, round the loop, and the shore's outward normal there; into `out`. */
export function walkPoint(walk: ShoreWalk, shape: LakeShape, arc: number, out: ShorePoint): ShorePoint {
  const n = walk.xs.length;
  const a = arc - Math.floor(arc / walk.total) * walk.total;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((walk.at[mid] as number) <= a) lo = mid;
    else hi = mid - 1;
  }
  const j = (lo + 1) % n;
  const len = (j === 0 ? walk.total : (walk.at[j] as number)) - (walk.at[lo] as number);
  const t = len > 0 ? (a - (walk.at[lo] as number)) / len : 0;
  out.x = (walk.xs[lo] as number) + ((walk.xs[j] as number) - (walk.xs[lo] as number)) * t;
  out.z = (walk.zs[lo] as number) + ((walk.zs[j] as number) - (walk.zs[lo] as number)) * t;
  const r = lakeShoreInto(SHORE, shape, out.x, out.z);
  const g = Math.hypot(r.sx, r.sz);
  out.nx = g > 0 ? -r.sx / g : 1;
  out.nz = g > 0 ? -r.sz / g : 0;
  return out;
}

/** The arc length along the walk of its point nearest (x, z). */
export function arcOf(walk: ShoreWalk, x: number, z: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < walk.xs.length; i++) {
    const dx = (walk.xs[i] as number) - x, dz = (walk.zs[i] as number) - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return walk.at[best] as number;
}

/** The walk's point farthest from (x, z). */
export function farthestOnWalk(walk: ShoreWalk, x: number, z: number): { x: number; z: number } {
  let best = 0, bestD = -1;
  for (let i = 0; i < walk.xs.length; i++) {
    const dx = (walk.xs[i] as number) - x, dz = (walk.zs[i] as number) - z;
    const d = dx * dx + dz * dz;
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return { x: walk.xs[best] as number, z: walk.zs[best] as number };
}

/** What a reed's perch or a stem stands up from at (x, z): the water's level
 * where there is water under it, inside the shore or on the marsh, if the
 * ground is below it; anywhere else its own ground, a plant on dry land. */
function footingOf(lake: LakeSource, x: number, z: number, ground: number): number {
  const wet = lakeShoreInto(SHORE, lake.shape, x, z).s > 0 || marshWeightAt(lake.shape, lake.lobe, x, z) > 0;
  return wet ? Math.max(ground, lake.level) : ground;
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/** The stretch of `n` along the shore an arc length falls in. */
function stretchOf(arc: number, total: number, n: number): number {
  return Math.min(n - 1, Math.floor((arc / total) * n));
}

export function inShoreBand(lake: LakeSource, x: number, z: number): boolean {
  const s = lakeShoreInto(SHORE, lake.shape, x, z).s;
  return (s >= -SHORE_BAND_OUT && s <= SHORE_BAND_IN) || marshWeightAt(lake.shape, lake.lobe, x, z) > 0;
}

/** Every shrub, bush, reed and drift log in the band, and every snag within SNAG_REACH outside the shore. */
function candidatesOf(seed: number, lake: LakeSource, walk: ShoreWalk): Candidate[] {
  const out: Candidate[] = [];
  const shape = lake.shape;
  const reach = shape.shoreMax + SHORE_BAND_OUT;
  const classes: readonly (readonly [number, number])[] = [
    [CLUTTER_SHRUB, RANK_SHRUB], [CLUTTER_BUSH, RANK_SHRUB], [CLUTTER_REED, RANK_REED], [CLUTTER_DRIFTLOG, RANK_DRIFTLOG],
  ];
  for (const [cls, rank] of classes) {
    for (const c of clutterInRect(seed, cls, shape.cx - reach, shape.cz - reach, shape.cx + reach, shape.cz + reach)) {
      if (inShoreBand(lake, c.x, c.z)) out.push({ x: c.x, z: c.z, ground: c.groundH, rank, arc: arcOf(walk, c.x, c.z) });
    }
  }
  const snagReach = shape.shoreMax + SNAG_REACH;
  for (const t of treesInRect(seed, shape.cx - snagReach, shape.cz - snagReach, shape.cx + snagReach, shape.cz + snagReach)) {
    if (t.cohort !== COHORT_SNAG || lakeShoreInto(SHORE, shape, t.x, t.z).s < -SNAG_REACH) continue;
    out.push({ x: t.x, z: t.z, ground: t.groundH, rank: RANK_SNAG, arc: arcOf(walk, t.x, t.z) });
  }
  return out;
}

/** The candidate of stretch `i` of `n` nearest (px, pz), up to `maxRank`; by
 * preference first when `ranked`. */
function pick(
  list: readonly Candidate[], total: number, i: number, n: number, px: number, pz: number, maxRank: number, ranked: boolean,
): Candidate | null {
  let best: Candidate | null = null;
  let bestRank = Infinity, bestD = Infinity;
  for (const c of list) {
    if (c.rank > maxRank || stretchOf(c.arc, total, n) !== i) continue;
    const rank = ranked ? c.rank : 0;
    const d = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz);
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      best = c; bestRank = rank; bestD = d;
    }
  }
  return best;
}

function markersOf(seed: number, lake: LakeSource, walk: ShoreWalk, cands: readonly Candidate[]): SwarmMarker[] {
  const out: SwarmMarker[] = [];
  const n = Math.min(MARKERS_MAX, Math.max(1, Math.round(walk.total / MARKER_SPACING)));
  const p: ShorePoint = { x: 0, z: 0, nx: 1, nz: 0 };
  for (let i = 0; i < n; i++) {
    const draw = (j: number): number => hash3(i, j, WATER_LIFE_SALT.marker, seed);
    walkPoint(walk, lake.shape, ((i + draw(1)) / n) * walk.total, p);
    const c = draw(0) < WATER_SHARE ? null : pick(cands, walk.total, i, n, p.x, p.z, RANK_SNAG, true);
    const u = draw(2);
    const midges = Math.round(MIDGES_MIN + MIDGES_SPAN * u * u);
    const column = midges > COLUMN_FROM;
    const radius = RADIUS_BASE + RADIUS_PER_MIDGE * midges;
    const height = column ? lerp(COLUMN_HEIGHT, (midges - COLUMN_FROM) / (MIDGES_MIN + MIDGES_SPAN - COLUMN_FROM)) : radius;
    const marker = { x: 0, y: 0, z: 0, midges, radius, height, column, seed: Math.floor(draw(4) * SEED_RANGE), water: c === null };
    if (c !== null) {
      marker.x = c.x; marker.z = c.z;
      marker.y = c.ground + (CANDIDATE_TOP[c.rank] as number) + lerp(MARKER_LIFT, draw(3));
    } else {
      const inward = lerp(WATER_IN, draw(5));
      marker.x = p.x - p.nx * inward; marker.z = p.z - p.nz * inward;
      marker.y = lake.level + lerp(WATER_LIFT, draw(3));
    }
    out.push(marker);
  }
  return out;
}

function beatsOf(seed: number, lake: LakeSource, walk: ShoreWalk): DarnerBeat[] {
  const out: DarnerBeat[] = [];
  const n = Math.max(1, Math.round(walk.total / BEAT_LENGTH));
  const span = walk.total / n;
  const p: ShorePoint = { x: 0, z: 0, nx: 1, nz: 0 };
  for (let b = 0; b < n; b++) {
    const draw = (j: number): number => hash3(b, j, WATER_LIFE_SALT.beat, seed);
    const a0 = b * span;
    const points: { x: number; y: number; z: number }[] = [];
    for (let k = 0; k < BEAT_POINTS; k++) {
      walkPoint(walk, lake.shape, a0 + (span * k) / (BEAT_POINTS - 1), p);
      const inward = lerp(BEAT_OUT, draw(10 + 2 * k));
      points.push({ x: p.x - p.nx * inward, y: lake.level + lerp(BEAT_UP, draw(11 + 2 * k)), z: p.z - p.nz * inward });
    }
    const hovers: HoverPoint[] = [];
    const count = draw(0) < 0.5 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      walkPoint(walk, lake.shape, a0 + (span * (k + 0.2 + 0.6 * draw(30 + 3 * k))) / count, p);
      const inward = lerp(BEAT_OUT, draw(31 + 3 * k));
      hovers.push({ x: p.x - p.nx * inward, y: lake.level + lerp(BEAT_UP, draw(32 + 3 * k)), z: p.z - p.nz * inward, faceX: p.nx, faceZ: p.nz });
    }
    out.push({ points, hovers, seed: Math.floor(draw(1) * SEED_RANGE) });
  }
  return out;
}

function perchesOf(seed: number, lake: LakeSource, walk: ShoreWalk, cands: readonly Candidate[]): Perch[] {
  const out: Perch[] = [];
  const n = Math.max(1, Math.round(walk.total / PERCH_SPACING));
  const perchable = cands.filter((c) => c.rank === RANK_REED || c.ground >= lake.level - PERCH_BANK_DROP);
  const p: ShorePoint = { x: 0, z: 0, nx: 1, nz: 0 };
  for (let i = 0; i < n; i++) {
    const draw = (j: number): number => hash3(i, j, WATER_LIFE_SALT.perch, seed);
    walkPoint(walk, lake.shape, ((i + draw(0)) / n) * walk.total, p);
    const c = pick(perchable, walk.total, i, n, p.x, p.z, RANK_DRIFTLOG, false);
    if (c === null) continue;
    // A reed stands up out of the water where there is water under it; a shrub, bush or drift log
    // stands on its own ground, though the bank falls away from the lake.
    const footing = c.rank === RANK_REED ? footingOf(lake, c.x, c.z, c.ground) : c.ground;
    out.push({ x: c.x, y: footing + lerp(PERCH_UP, draw(1)), z: c.z, seed: Math.floor(draw(2) * SEED_RANGE) });
  }
  return out;
}

function stemsOf(seed: number, lake: LakeSource): Perch[] {
  const step = Math.sqrt(STEM_AREA);
  const shape = lake.shape;
  const reach = shape.shoreMax + SHORE_BAND_OUT;
  const c0x = Math.floor((shape.cx - reach) / step), c1x = Math.floor((shape.cx + reach) / step);
  const c0z = Math.floor((shape.cz - reach) / step), c1z = Math.floor((shape.cz + reach) / step);
  const beds: { cx: number; cz: number; patch: number; own: number }[] = [];
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const x = (cx + 0.5) * step, z = (cz + 0.5) * step;
      if (!inShoreBand(lake, x, z)) continue;
      if (clutterDensity(seed, CLUTTER_REED, x, z) <= STEM_DENSITY && clutterDensity(seed, CLUTTER_WETPLANT, x, z) <= STEM_DENSITY) continue;
      beds.push({
        cx, cz,
        patch: hash3(Math.floor(cx / BED_PATCH), Math.floor(cz / BED_PATCH), WATER_LIFE_SALT.bed, seed),
        own: hash3(cx, cz, WATER_LIFE_SALT.stem, seed),
      });
    }
  }
  beds.sort((a, b) => a.patch - b.patch || a.own - b.own);
  const out: Perch[] = [];
  for (let k = 0; k < beds.length && k < STEMS_MAX; k++) {
    const cell = beds[k] as (typeof beds)[number];
    const draw = (j: number): number => hash3(k, j, WATER_LIFE_SALT.stemDraw, seed);
    const x = (cell.cx + 0.5 + 0.8 * (draw(0) - 0.5)) * step;
    const z = (cell.cz + 0.5 + 0.8 * (draw(1) - 0.5)) * step;
    out.push({ x, y: footingOf(lake, x, z, elevationAt(seed, x, z)) + lerp(STEM_UP, draw(2)), z, seed: Math.floor(draw(3) * SEED_RANGE) });
  }
  return out;
}

/** True where the marsh's middle lies in from the shore at `p`. */
function marshAlong(lake: LakeSource, p: ShorePoint, mid: number): boolean {
  return marshWeightAt(lake.shape, lake.lobe, p.x - p.nx * mid, p.z - p.nz * mid) > 0;
}

function voicesOf(seed: number, lake: LakeSource, walk: ShoreWalk): FrogVoice[] {
  const samples = Math.max(16, Math.ceil(walk.total / RIM_STEP));
  const ds = walk.total / samples;
  const mid = marshMid(lake.shape);
  const p: ShorePoint = { x: 0, z: 0, nx: 1, nz: 0 };
  // The shore's length weighted by the marsh's half again, walked a step at a time.
  const walked = new Float64Array(samples + 1);
  for (let s = 0; s < samples; s++) {
    const weight = marshAlong(lake, walkPoint(walk, lake.shape, (s + 0.5) * ds, p), mid) ? FROG_MARSH_SHARE : 1;
    walked[s + 1] = (walked[s] as number) + weight * ds;
  }
  const total = walked[samples] as number;
  const n = Math.min(FROGS_MAX, Math.max(FROGS_MIN, Math.round(total / FROG_SPACING)));
  const offset = hash3(0, 0, WATER_LIFE_SALT.voice, seed);
  const out: FrogVoice[] = [];
  for (let v = 0; v < n; v++) {
    const draw = (j: number): number => hash3(v, j, WATER_LIFE_SALT.voice, seed);
    const along = (v + offset + 2 * FROG_SLIP * (draw(1) - 0.5)) / n;
    const target = (along - Math.floor(along)) * total;
    let s = 0;
    while (s < samples - 1 && (walked[s + 1] as number) < target) s++;
    const from = walked[s] as number, to = walked[s + 1] as number;
    walkPoint(walk, lake.shape, (s + Math.min(1, Math.max(0, (target - from) / (to - from)))) * ds, p);
    const marsh = marshAlong(lake, p, mid);
    const edge = marsh ? -mid : FROG_EDGE * (2 * draw(2) - 1);
    out.push({ x: p.x + p.nx * edge, y: lake.level, z: p.z + p.nz * edge, seed: Math.floor(draw(3) * SEED_RANGE), marsh });
  }
  return out;
}

/** The lake's life laid out: a pure function of (seed, lake). */
export function waterLifeLayout(seed: number, lake: LakeSource): WaterLifeLayout {
  const walk = shoreWalk(lake.shape);
  const cands = candidatesOf(seed, lake, walk);
  return {
    lake,
    markers: markersOf(seed, lake, walk, cands),
    beats: beatsOf(seed, lake, walk),
    perches: perchesOf(seed, lake, walk, cands),
    stems: stemsOf(seed, lake),
    voices: voicesOf(seed, lake, walk),
  };
}
