import { hash3 } from "../sim/field.js";
import { LAKE_SHELF_WIDTH, marshWeightAt } from "../sim/features.js";
import { elevationAt, type LakeSource } from "../sim/terrain.js";
import { COHORT_SNAG, treesInRect } from "../sim/vegetation.js";
import {
  CLUTTER_BUSH, CLUTTER_DRIFTLOG, CLUTTER_REED, CLUTTER_SHRUB, CLUTTER_WETPLANT, clutterDensity, clutterInRect,
} from "../sim/clutter.js";

/**
 * Where the lake's life is, Babylon-free: a pure function of the world's seed
 * and its lake, laid out once a world, so every player has the same lake.
 * The midges' swarm markers over the shore's shrubs, reeds, logs and snags and
 * over open water, the darners' beats along the rim, the skimmers' perches,
 * the damselflies' stems in the reed beds and the chorus frogs' voices at the
 * water's edge. Reads the sim's fields and never adds to them.
 *
 * The shore band is the ring from SHORE_BAND_IN inside the rim to
 * SHORE_BAND_OUT outside it, with the marsh wherever it reaches. Everything
 * lies in it but a swarm over a snag, which may stand to SNAG_REACH outside
 * the rim. Angles run from +x toward +z round the lake's centre, and the rim
 * is cut into stretches from angle 0: marker i holds stretch i of the
 * markers', beat b stretch b of the beats', whose ends meet their neighbours'.
 */

export const SHORE_BAND_IN = 8;
export const SHORE_BAND_OUT = 15;
/** Metres of rim per swarm marker: 16 for a 25 m lake, 25 for a 40 m one. */
export const MARKER_SPACING = 10;
/** Metres of rim per darner beat, one male a stretch of shore. */
export const BEAT_LENGTH = 20;
/** Metres of rim per skimmer perch. */
export const PERCH_SPACING = 8;
/** Square metres of reed bed per damselfly stem, and the most in a lake. */
export const STEM_AREA = 4;
export const STEMS_MAX = 40;
/** Metres of rim per frog voice; along the marsh at 2/3 of it, half again its share. */
export const FROG_SPACING = 25;
export const FROGS_MIN = 6, FROGS_MAX = 12;

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
/** A darner's beat: a line 1–3 m out over the water along about 20 m of rim. */
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

const TAU = 2 * Math.PI;
/** A snag this far outside the rim still holds a swarm (m). */
const SNAG_REACH = 20;
/** A marker's candidates by preference, and each one's top above its ground (m). */
const RANK_SHRUB = 0, RANK_REED = 1, RANK_DRIFTLOG = 2, RANK_SNAG = 3;
const CANDIDATE_TOP: readonly number[] = [1.5, 1.5, 0.6, 6];
/** A swarm's centre over its candidate's top, and over open water (m). */
const MARKER_LIFT: readonly [number, number] = [1, 4];
const WATER_LIFT: readonly [number, number] = [1, 2];
/** One marker in three goes over open water, this far in from the rim (m). */
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
/** The marsh's middle, in from the rim, where its frogs call (m). */
export const MARSH_MID = LAKE_SHELF_WIDTH / 2;
const FROG_MARSH_SHARE = 1.5;
/** A frog's place about the rim (± m) and its slip along it (± a share of the spacing). */
const FROG_EDGE = 0.5;
const FROG_SLIP = 0.15;
/** Metres of rim a step of the frogs' walk. */
const RIM_STEP = 1;

type Candidate = { x: number; z: number; ground: number; rank: number; angle: number };

/** What a reed's perch or a stem stands up from at (x, z): the water's level
 * where there is water under it, inside the rim or on the marsh, if the
 * ground is below it; anywhere else its own ground, a plant on dry land. */
function footingOf(lake: LakeSource, x: number, z: number, ground: number): number {
  const wet = Math.hypot(x - lake.x, z - lake.z) < lake.radius || marshWeightAt(lake, x, z) > 0;
  return wet ? Math.max(ground, lake.level) : ground;
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

function angleOf(lake: LakeSource, x: number, z: number): number {
  const a = Math.atan2(z - lake.z, x - lake.x);
  return a < 0 ? a + TAU : a;
}

/** The stretch of `n` round the rim an angle falls in. */
function stretchOf(angle: number, n: number): number {
  return Math.min(n - 1, Math.floor((angle / TAU) * n));
}

export function inShoreBand(lake: LakeSource, x: number, z: number): boolean {
  const r = Math.hypot(x - lake.x, z - lake.z);
  return (r >= lake.radius - SHORE_BAND_IN && r <= lake.radius + SHORE_BAND_OUT) || marshWeightAt(lake, x, z) > 0;
}

/** Every shrub, bush, reed and drift log in the band, and every snag within SNAG_REACH of the rim. */
function candidatesOf(seed: number, lake: LakeSource): Candidate[] {
  const out: Candidate[] = [];
  const reach = lake.radius + SHORE_BAND_OUT;
  const classes: readonly (readonly [number, number])[] = [
    [CLUTTER_SHRUB, RANK_SHRUB], [CLUTTER_BUSH, RANK_SHRUB], [CLUTTER_REED, RANK_REED], [CLUTTER_DRIFTLOG, RANK_DRIFTLOG],
  ];
  for (const [cls, rank] of classes) {
    for (const c of clutterInRect(seed, cls, lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach)) {
      if (inShoreBand(lake, c.x, c.z)) out.push({ x: c.x, z: c.z, ground: c.groundH, rank, angle: angleOf(lake, c.x, c.z) });
    }
  }
  const snagReach = lake.radius + SNAG_REACH;
  for (const t of treesInRect(seed, lake.x - snagReach, lake.z - snagReach, lake.x + snagReach, lake.z + snagReach)) {
    if (t.cohort !== COHORT_SNAG || Math.hypot(t.x - lake.x, t.z - lake.z) > snagReach) continue;
    out.push({ x: t.x, z: t.z, ground: t.groundH, rank: RANK_SNAG, angle: angleOf(lake, t.x, t.z) });
  }
  return out;
}

/** The candidate of stretch `i` of `n` nearest (px, pz), up to `maxRank`; by
 * preference first when `ranked`. */
function pick(
  list: readonly Candidate[], i: number, n: number, px: number, pz: number, maxRank: number, ranked: boolean,
): Candidate | null {
  let best: Candidate | null = null;
  let bestRank = Infinity, bestD = Infinity;
  for (const c of list) {
    if (c.rank > maxRank || stretchOf(c.angle, n) !== i) continue;
    const rank = ranked ? c.rank : 0;
    const d = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz);
    if (rank < bestRank || (rank === bestRank && d < bestD)) {
      best = c; bestRank = rank; bestD = d;
    }
  }
  return best;
}

function markersOf(seed: number, lake: LakeSource, cands: readonly Candidate[]): SwarmMarker[] {
  const out: SwarmMarker[] = [];
  const n = Math.max(1, Math.round((TAU * lake.radius) / MARKER_SPACING));
  for (let i = 0; i < n; i++) {
    const draw = (j: number): number => hash3(i, j, WATER_LIFE_SALT.marker, seed);
    const at = ((i + draw(1)) / n) * TAU;
    const cos = Math.cos(at), sin = Math.sin(at);
    const c = draw(0) < WATER_SHARE ? null : pick(cands, i, n, lake.x + lake.radius * cos, lake.z + lake.radius * sin, RANK_SNAG, true);
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
      const r = lake.radius - lerp(WATER_IN, draw(5));
      marker.x = lake.x + r * cos; marker.z = lake.z + r * sin;
      marker.y = lake.level + lerp(WATER_LIFT, draw(3));
    }
    out.push(marker);
  }
  return out;
}

function beatsOf(seed: number, lake: LakeSource): DarnerBeat[] {
  const out: DarnerBeat[] = [];
  const n = Math.max(1, Math.round((TAU * lake.radius) / BEAT_LENGTH));
  const span = TAU / n;
  for (let b = 0; b < n; b++) {
    const draw = (j: number): number => hash3(b, j, WATER_LIFE_SALT.beat, seed);
    const a0 = b * span;
    const points: { x: number; y: number; z: number }[] = [];
    for (let k = 0; k < BEAT_POINTS; k++) {
      const a = a0 + (span * k) / (BEAT_POINTS - 1);
      const r = lake.radius - lerp(BEAT_OUT, draw(10 + 2 * k));
      points.push({ x: lake.x + r * Math.cos(a), y: lake.level + lerp(BEAT_UP, draw(11 + 2 * k)), z: lake.z + r * Math.sin(a) });
    }
    const hovers: HoverPoint[] = [];
    const count = draw(0) < 0.5 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      const a = a0 + (span * (k + 0.2 + 0.6 * draw(30 + 3 * k))) / count;
      const r = lake.radius - lerp(BEAT_OUT, draw(31 + 3 * k));
      const faceX = Math.cos(a), faceZ = Math.sin(a);
      hovers.push({ x: lake.x + r * faceX, y: lake.level + lerp(BEAT_UP, draw(32 + 3 * k)), z: lake.z + r * faceZ, faceX, faceZ });
    }
    out.push({ points, hovers, seed: Math.floor(draw(1) * SEED_RANGE) });
  }
  return out;
}

function perchesOf(seed: number, lake: LakeSource, cands: readonly Candidate[]): Perch[] {
  const out: Perch[] = [];
  const n = Math.max(1, Math.round((TAU * lake.radius) / PERCH_SPACING));
  const perchable = cands.filter((c) => c.rank === RANK_REED || c.ground >= lake.level - PERCH_BANK_DROP);
  for (let p = 0; p < n; p++) {
    const draw = (j: number): number => hash3(p, j, WATER_LIFE_SALT.perch, seed);
    const at = ((p + draw(0)) / n) * TAU;
    const c = pick(perchable, p, n, lake.x + lake.radius * Math.cos(at), lake.z + lake.radius * Math.sin(at), RANK_DRIFTLOG, false);
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
  const reach = lake.radius + SHORE_BAND_OUT;
  const c0x = Math.floor((lake.x - reach) / step), c1x = Math.floor((lake.x + reach) / step);
  const c0z = Math.floor((lake.z - reach) / step), c1z = Math.floor((lake.z + reach) / step);
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

/** True where the marsh's middle lies along angle `a`. */
function marshAlong(lake: LakeSource, a: number): boolean {
  const r = lake.radius - MARSH_MID;
  return marshWeightAt(lake, lake.x + r * Math.cos(a), lake.z + r * Math.sin(a)) > 0;
}

function voicesOf(seed: number, lake: LakeSource): FrogVoice[] {
  const samples = Math.max(16, Math.ceil((TAU * lake.radius) / RIM_STEP));
  const ds = (TAU * lake.radius) / samples;
  // The rim's length weighted by the marsh's half again, walked a step at a time.
  const walked = new Float64Array(samples + 1);
  for (let s = 0; s < samples; s++) {
    const weight = marshAlong(lake, ((s + 0.5) / samples) * TAU) ? FROG_MARSH_SHARE : 1;
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
    const a = ((s + Math.min(1, Math.max(0, (target - from) / (to - from)))) / samples) * TAU;
    const marsh = marshAlong(lake, a);
    const r = marsh ? lake.radius - MARSH_MID : lake.radius + FROG_EDGE * (2 * draw(2) - 1);
    out.push({ x: lake.x + r * Math.cos(a), y: lake.level, z: lake.z + r * Math.sin(a), seed: Math.floor(draw(3) * SEED_RANGE), marsh });
  }
  return out;
}

/** The lake's life laid out: a pure function of (seed, lake). */
export function waterLifeLayout(seed: number, lake: LakeSource): WaterLifeLayout {
  const cands = candidatesOf(seed, lake);
  return {
    lake,
    markers: markersOf(seed, lake, cands),
    beats: beatsOf(seed, lake),
    perches: perchesOf(seed, lake, cands),
    stems: stemsOf(seed, lake),
    voices: voicesOf(seed, lake),
  };
}
