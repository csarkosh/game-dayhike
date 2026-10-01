import type { TerrainSample } from "./terrain.js";
import { fbm2d, hash3 } from "./field.js";

/**
 * The made features of the trail system: one peak per
 * world, and N ∈ {1, 2, 3} loop features drawn from {meadow, pond}. Each is an
 * elevation stage on the composed field with exact derivatives, and a mask the
 * vegetation, the clutter and the ground paint read. Every number here folds
 * into the level id through FEATURE_TUNABLES.
 */
export type FeatureKind = "peak" | "meadow" | "pond";
export type LoopKind = Exclude<FeatureKind, "peak">;
export type Feature = {
  id: number;
  kind: FeatureKind;
  x: number;
  z: number;
  /** Disc radius (m): the peak's dome, the meadow's flat, the pond's rim. */
  radius: number;
  /** peak: the dome's rise above the base ground at its centre. meadow: the
   * plateau height (absolute). pond: the rim height (absolute). */
  height: number;
  /** peak only: the crest's absolute height, written by the builder once the
   * dome is placed — the treeline is a height, so the mask needs it. */
  crestH?: number;
  /** pond only: 0 clear .. 1 murky, by where the lake lies on the climb
   * (`murkFor`). Written by the builder after the whole bowl is placed. */
  murk?: number;
  /** pond only: the marsh on a murky lake's shelf at one end, or null for
   * none. Written by the builder after the whole bowl is placed. */
  lobe?: Lobe | null;
};

/** A murky lake's marsh: its shelf at one end, silted up to the water's
 * level, in the direction (dirX, dirZ) from the lake's centre (a unit
 * vector), `width` metres across. */
export type Lobe = { dirX: number; dirZ: number; width: number };

// ---- Peak --------------------------------------------------------------
/**
 * An earlier target was a 220 m dome with 60–90 m of rise; 300 m and 50–80 m
 * is what the 227-seed sweep would take (see the diagnosis below). The
 * 700–1000 m inland band is unchanged.
 *
 * The flank's grade is what the stem has to climb, and it scales as
 * 1.78·rise/(R − PEAK_CREST_RADIUS): 0.55–0.82 at 220 m and 60–90 m of rise,
 * 0.32–0.52 at 300 m and 50–80 m (measured — see `crestProfileD`). The first
 * of those is OVER the grid's own TRAIL_GRID_CAP of 0.6, so `resampleAround`'s
 * keep-passability rule had to punch the skirt back open, and the stem then
 * climbed ground running at 0.66–0.87 — where the union of its OWN corridors
 * at every bend runs at roughly 1.6× the ground's own grade and sails past the
 * fine check's 0.9 (measured at the failing samples: the edge's own corridor
 * alone 0.41–0.70, the union of it and its two neighbours 0.92–1.40). The
 * second stays under the grid cap, so the search plans on ground the union can
 * actually take. Measured over the 227-seed sweep: 77 of 227 seeds fell back at 220/60–90,
 * 9 at 300/50–80.
 */
export const PEAK_RADIUS_MIN = 300;
export const PEAK_RADIUS_MAX = 300;
export const PEAK_RISE_MIN = 50;
export const PEAK_RISE_MAX = 80;
/** The bare crest disc (no clutter, rock class). */
export const PEAK_CREST_RADIUS = 25;
/** Crest sharpness: 0 is the old flat-topped dome (the quintic smootherstep
 * alone, zero grade at the exact centre), 1 the full cone — the cone term
 * alone gives the crest a grade of k·rise/R near the centre, but crossed with
 * the dome the flank steepens well past that, to ≈1.78·k·rise/(R − c) at
 * its mid-radius peak (c = PEAK_CREST_RADIUS). See `crestProfileD`. */
export const PEAK_SHARPNESS = 1.0;
export const PEAK_INLAND_MIN = 700;
export const PEAK_INLAND_MAX = 1000;
/** How far onto the dome's own skirt a loop feature may sit: a loop
 * candidate's disc must clear the crest by at least
 * PEAK_SHOULDER · radius + the candidate's own radius, not the peak's full
 * radius plus the candidate's — the dome's outer 40 % (r ∈ [0.6R, R]) is a
 * shoulder gentle enough (the "peak stage" tests in features.test.ts: the skirt
 * never exceeds 0.517 even at its steepest, well inside MEADOW_SLOPE_MAX's
 * own candidate gate at the shallower radii out here) for a meadow or pond to
 * stand on, and forbidding the whole dome would push every loop's candidate
 * band needlessly far inland on a small world. */
export const PEAK_SHOULDER = 0.6;
/** When no walkable route reaches the crest: how much rise one retry gives up.
 * 5 → 10. PEAK_LOWER_TRIES stays at 3, so the retry
 * budget is 30 m of rise rather than 15. Measured over the 227-seed sweep at
 * radius 300: 9 fallbacks at a 5 m step, 3 at 8 m, 0 at 10, 12 and 15 — a
 * plateau, not a lucky point. 193 of the 227 seeds never lower at all, 4 spend
 * all three tries, and the lowest rise any seed ends on is 24 m. */
export const PEAK_LOWER_STEP = 10;
/** When no walkable route reaches the crest: lower the rise by this and retry.
 * 3 → 20 → 3. An earlier pass measured 58 of 227 sweep seeds falling through to
 * the fallback at 3 tries and raised this to 20 to cover them — but the root
 * cause was the POINTED apex (crossed with a node-pinned, smoothed bed) reading
 * a fine-check gradient that tracked the dome height closely, so lowering the
 * rise eventually cleared it by brute force. Replacing the point with a
 * flat summit platform (PEAK_CREST_RADIUS) instead removes the
 * gradient spike at its source; see `peakD`. Restored to 3 and re-measured
 * against the same 227-seed sweep — still 68 of 227, because the platform was
 * never the blocker (measured only 1 of 41 over-cap samples within
 * 35 m of the crest; the rest were out on the skirt). STAYS AT 3: gentling
 * the flank and doubling PEAK_LOWER_STEP instead brought the fallback count to 0
 * of 227, with 193 seeds never lowering at all. */
export const PEAK_LOWER_TRIES = 3;
/** How many candidate CENTRES the builder tries before a world gets no peak
 * at all. The highest reachable cell in
 * the inland band, then the next two by the same order, each with its own
 * PEAK_LOWER_TRIES budget. It steers the graph — a world whose first centre
 * cannot be routed to gets a different summit rather than none — so it is a
 * tunable and folds into the level id, the same way LOOP_TRIES does below. */
export const PEAK_CENTRE_TRIES = 3;
/** The treeline sits this far under the crest; trees thin over TREELINE_BAND
 * below it. 35/60 -> 15/35.
 *
 * THE BAND HAS TO FIT INSIDE THE DOME'S OWN RISE. The height ramp needs
 * `below = crestH - h` to reach TREELINE_BELOW_CREST + TREELINE_BAND before
 * trees come back to full density, and inside the disc the largest `below`
 * achievable is the dome's own rise — which the peak-radius retune above
 * capped at PEAK_RISE_MAX 80, and PEAK_RISE_MIN is 50. The old sum was 95, so the ramp could not complete
 * anywhere inside the disc on ANY world: the tree mask was still 0.08-0.90
 * at the rim (measured, five seeds, 36 bearings) where the `d >= f.radius`
 * clip threw it straight back to 1 — a 600 m bald disc with a razor edge, not
 * a treeline. The new sum is 50, exactly PEAK_RISE_MIN, so the ramp completes
 * at the foot of the shallowest dome the builder ships and every deeper one
 * completes earlier. */
export const TREELINE_BELOW_CREST = 15;
export const TREELINE_BAND = 35;
/** The peak's mask and its paint both fade out over the outer PEAK_RIM_FADE
 * metres of the dome: a radial
 * `1 - smoothstep(R - PEAK_RIM_FADE, R, d)` multiplying the height ramp's own
 * THINNING, so the peak's term reaches the rim already at nothing and the
 * `d >= f.radius` clip is a formality rather than a cliff. `featurePaint.ts`
 * multiplies its rock term by the SAME fade from the same table — the
 * paint used to be a bare height test with no distance
 * gate at all, so the whole inland range above the treeline read as rock
 * under a full forest. 40 m of a 300 m disc: wide enough that the step across
 * the rim is under 0.002 (measured, 36 bearings), narrow enough that the bare
 * crest the ramp makes is still the mountain's own top. */
export const PEAK_RIM_FADE = 40;

// ---- Meadow ------------------------------------------------------------
/** 70-110 -> 50-90. The
 * radii are levers, and a smaller disc has a shorter ring to walk and a smaller
 * footprint to place: measured over the 227-seed sweep, at the moment this lever went on
 * (after FEATURE_SPACING, LOOP_LATERAL_MAX and the bands), loops built 186 -> 190 of
 * 426 planned, zero-candidate attempts 55 -> 45, and loops rejected for running past
 * the length band 81 -> 46. */
export const MEADOW_RADIUS_MIN = 50;
export const MEADOW_RADIUS_MAX = 90;
/** The apron: the levelled flat blends back to the hillside over MEADOW_RIM OUTSIDE
 * the radius (`flatD`; it used to
 * be the outer MEADOW_RIM of the radius itself). 25 -> 35: the
 * loop walks this ramp, not the disc's raw ground, so it needs enough width for a real
 * ring corridor — RING_BAND (12) plus slack, not just a cosmetic blend. The value is
 * unchanged from that move; only which side of the radius it lies on. */
export const MEADOW_RIM = 35;
export const MEADOW_TREE_MARGIN = 6;
/** Candidate ground must be at most this steep (rise/run) before flattening. 0.12 ->
 * 0.35: the candidate filter used
 * to judge the RAW disc a meadow would flatten, but the flattening is the whole
 * point — what actually has to be walkable is the LEVELLED rim the loop routes on,
 * not the untouched hillside underneath it. Measured against the 227-seed sweep: real
 * off-corridor ground reads a mean gradient of 0.18-0.44 over a candidate's own disc
 * even where every cell is individually passable, so 0.12 admitted almost nothing. */
export const MEADOW_SLOPE_MAX = 0.35;

// ---- Pond --------------------------------------------------------------
export const POND_RADIUS_MIN = 25;
export const POND_RADIUS_MAX = 40;
export const POND_DEPTH = 0.6;
/** The shore ramp from the rim to the hillside; at the 0.08 candidate slope it
 * is at most a 0.3 grade. */
export const POND_APRON = 12;
/** Bare floor from the rim out to POND_SHORE; no trees to POND_TREE_MARGIN. */
export const POND_SHORE = 4;
export const POND_TREE_MARGIN = 8;
/** 0.08 -> 0.25: same reasoning
 * as MEADOW_SLOPE_MAX above — the candidate filter judges the raw disc, but a pond's
 * own basin+apron stage does the levelling; the loop needs the LEVELLED apron
 * walkable, not the raw hillside. */
export const POND_SLOPE_MAX = 0.25;

// ---- Lake ----------------------------------------------------------------
/** Murk by where the lake lies on the climb from the pad to the crest: the
 * lowest quarter fully murky, the highest fully clear, a gradient between. */
export const MURK_LO = 0.25;
export const MURK_HI = 0.75;

/** A lake's murk from its rim height `h`, the pad's height and the crest's.
 * With no crest, or one not above the pad, the middle of the range. */
export function murkFor(h: number, padH: number, crestH: number | undefined): number {
  if (crestH === undefined || !(crestH > padH)) return 0.5;
  return 1 - smoothstep(MURK_LO, MURK_HI, (h - padH) / (crestH - padH));
}

/** The shelf: from the rim the bed falls to LAKE_SHELF_DEPTH at
 * LAKE_SHELF_WIDTH in (the depth a lake survey found at a shore's shelf,
 * research §5.1), deep enough to wade to the waist and no deeper. */
export const LAKE_SHELF_DEPTH = 0.9;
export const LAKE_SHELF_WIDTH = 10;
/** From the shelf's edge down to the flat middle. */
export const LAKE_SLOPE_WIDTH = 8;
/** The middle's depth: a murky lake's, and a clear lake's, whose bed then
 * reads to about 5 m as the research's subalpine lakes do (§5.5). */
export const LAKE_DEPTH_MURKY = 3;
export const LAKE_DEPTH_CLEAR = 6;

export function lakeMiddleDepth(murk: number): number {
  return LAKE_DEPTH_CLEAR + (LAKE_DEPTH_MURKY - LAKE_DEPTH_CLEAR) * murk;
}

/**
 * Depth below the rim at `s` metres in from the rim, and ∂depth/∂s: two
 * quintic steps, the shelf's and the drop's, each flat to second order at
 * both ends, so the bed is C² at the rim, at the shelf's edge and at the
 * middle's. The shelf levels out at its edge before the drop begins: the
 * ledge a real lake's shore has.
 */
export function lakeDepthD(s: number, murk: number): { v: number; d: number } {
  const shelf = smootherstepD(0, LAKE_SHELF_WIDTH, s);
  const drop = smootherstepD(LAKE_SHELF_WIDTH, LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH, s);
  const extra = lakeMiddleDepth(murk) - LAKE_SHELF_DEPTH;
  return { v: LAKE_SHELF_DEPTH * shelf.v + extra * drop.v, d: LAKE_SHELF_DEPTH * shelf.d + extra * drop.d };
}

/**
 * A pond's lake bed. Inside the rim it replaces the build's dish (`basinD`
 * ignores its base there, and so does this); at and outside the rim the
 * ground is returned untouched, and meets the apron with value, slope and
 * curvature all continuous. Applied to the composed field only
 * (`lakeStageD`), never while the bowl is built.
 */
export function lakeD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const rx = x - f.x, rz = z - f.z;
  const q2 = rx * rx + rz * rz;
  if (q2 >= f.radius * f.radius) return base;
  const q = Math.sqrt(q2);
  const depth = lakeDepthD(f.radius - q, f.murk ?? 0.5);
  // h = height − D(R − q), so ∂h/∂q = D'(R − q). D' is zero across the flat
  // middle, which holds the centre on every pond, so q → 0 never divides.
  if (depth.d === 0) return { h: f.height - depth.v, dx: 0, dz: 0 };
  return { h: f.height - depth.v, dx: (depth.d * rx) / q, dz: (depth.d * rz) / q };
}

// ---- The marsh ---------------------------------------------------------------
/** A lake gets a marsh on its shelf above this murk. */
export const MARSH_MURK_MIN = 0.5;
/** Across, as a fraction of R: just above MARSH_MURK_MIN, and at murk 1. */
export const MARSH_WIDTH_MIN = 0.6;
export const MARSH_WIDTH_MAX = 1.0;
/** The marsh ground's swing about the level (m): standing water and tussocks. */
export const MARSH_AMP = 0.05;
/** The swing's noise wavelength (m). */
export const MARSH_NOISE_WAVE = 4;
/** The marsh's metric where it starts giving way to the bed around it. */
export const MARSH_EDGE = 0.55;
/** Where a direction's shore's scoring starts, outside the rim (m). */
export const MARSH_SHORE_START = 2;
/** A direction's shore is scored out to this far outside the rim (m),
 * across the marsh's width, on a MARSH_SCORE_STEP grid. */
export const MARSH_SHORE_SCAN = 20;
export const MARSH_SCORE_STEP = 3;
export const MARSH_SALT = 0x3a75;

/** The 16 directions a marsh may take, every 22.5°, as literals: the sim
 * takes no trigonometric function. */
const MARSH_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [0.9238795325112867, 0.3826834323650898], [0.7071067811865476, 0.7071067811865476],
  [0.3826834323650898, 0.9238795325112867], [0, 1], [-0.3826834323650898, 0.9238795325112867],
  [-0.7071067811865476, 0.7071067811865476], [-0.9238795325112867, 0.3826834323650898], [-1, 0],
  [-0.9238795325112867, -0.3826834323650898], [-0.7071067811865476, -0.7071067811865476],
  [-0.3826834323650898, -0.9238795325112867], [0, -1], [0.3826834323650898, -0.9238795325112867],
  [0.7071067811865476, -0.7071067811865476], [0.9238795325112867, -0.3826834323650898],
];

/** What the marsh's functions need of a lake: a pond feature or a `LakeSource`. */
type LakeShape = { x: number; z: number; radius: number; lobe?: Lobe | null };

export function marshWidth(radius: number, murk: number): number {
  const t = (murk - MARSH_MURK_MIN) / (1 - MARSH_MURK_MIN);
  return (MARSH_WIDTH_MIN + (MARSH_WIDTH_MAX - MARSH_WIDTH_MIN) * t) * radius;
}

/**
 * A murky lake's marsh: on the shelf, in the direction whose shore (the
 * ground just outside the rim, before the lake) stands least far off the
 * level on average, since a marsh is flat ground the water spreads over. On a
 * tie the first of MARSH_DIRECTIONS. Null at murk MARSH_MURK_MIN and below.
 * `ground` is the pre-feature field; the builder calls this once per pond
 * after the whole bowl is placed.
 */
export function chooseLobe(f: Feature, murk: number, ground: (x: number, z: number) => number): Lobe | null {
  if (!(murk > MARSH_MURK_MIN)) return null;
  const width = marshWidth(f.radius, murk);
  let best: Lobe | null = null;
  let bestOff = Infinity;
  for (const [dirX, dirZ] of MARSH_DIRECTIONS) {
    let sum = 0;
    let n = 0;
    for (let t = f.radius + MARSH_SHORE_START; t <= f.radius + MARSH_SHORE_SCAN; t += MARSH_SCORE_STEP) {
      for (let b = -width / 2; b <= width / 2; b += MARSH_SCORE_STEP) {
        const off = ground(f.x + dirX * t - dirZ * b, f.z + dirZ * t + dirX * b) - f.height;
        sum += off < 0 ? -off : off;
        n++;
      }
    }
    const mean = sum / n;
    if (mean < bestOff) {
      bestOff = mean;
      best = { dirX, dirZ, width };
    }
  }
  return best;
}

/**
 * The marsh's metric at (x, z), below 1 inside it, and its gradient: an
 * ellipse in the shelf's own coordinates, `s = R − q` in from the rim (1 at
 * the rim and at the shelf's edge) and the offset across the marsh's
 * direction (1 at half its width).
 */
function marshMetricD(f: LakeShape, lobe: Lobe, x: number, z: number): { v: number; dx: number; dz: number } {
  const rx = x - f.x, rz = z - f.z;
  // Only the marsh's own side of the lake. Every point it covers lies at
  // least 8 m along its direction (q > R − 10 ≥ 15, the offset across under
  // R/2), so this gate sits where the metric is already ≥ 1.
  if (rx * lobe.dirX + rz * lobe.dirZ <= 0) return { v: Infinity, dx: 0, dz: 0 };
  const q = Math.sqrt(rx * rx + rz * rz);
  const half = LAKE_SHELF_WIDTH / 2;
  const a = (f.radius - q - half) / half;
  const B = lobe.width / 2;
  const b = (-rx * lobe.dirZ + rz * lobe.dirX) / B;
  // ∂s/∂x = −rx/q, ∂s/∂z = −rz/q; the offset across is linear.
  return {
    v: a * a + b * b,
    dx: (2 * a * (-rx / q)) / half - (2 * b * lobe.dirZ) / B,
    dz: (2 * a * (-rz / q)) / half + (2 * b * lobe.dirX) / B,
  };
}

/** How much of the marsh is at (x, z): 1 in its core, 0 outside it. */
export function marshWeightAt(f: LakeShape, x: number, z: number): number {
  if (!f.lobe) return 0;
  const e = marshMetricD(f, f.lobe, x, z).v;
  if (e >= 1) return 0;
  return 1 - smootherstepD(MARSH_EDGE, 1, e).v;
}

/**
 * The marsh stage: the ground held at the lake's level, give or take
 * MARSH_AMP of seeded noise, so standing water and tussocks alternate;
 * blended C² into the bed around it over the metric's MARSH_EDGE..1.
 */
export function marshD(seed: number, f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const lobe = f.lobe;
  if (!lobe) return base;
  const e = marshMetricD(f, lobe, x, z);
  if (e.v >= 1) return base;
  const s = smootherstepD(MARSH_EDGE, 1, e.v);
  const w = 1 - s.v;
  const wDx = -s.d * e.dx, wDz = -s.d * e.dz;
  const n = fbm2d(x / MARSH_NOISE_WAVE, z / MARSH_NOISE_WAVE, seed ^ MARSH_SALT, 2);
  const mh = f.height + MARSH_AMP * n.v;
  const mDx = (MARSH_AMP * n.dx) / MARSH_NOISE_WAVE, mDz = (MARSH_AMP * n.dz) / MARSH_NOISE_WAVE;
  return {
    h: (1 - w) * base.h + w * mh,
    dx: (1 - w) * base.dx + w * mDx + wDx * (mh - base.h),
    dz: (1 - w) * base.dz + w * mDz + wDz * (mh - base.h),
  };
}

/** Points of the marsh on a `step` grid in its own coordinates, for tests and
 * scans: every one lies between the wall and the rim. */
export function lobePoints(f: LakeShape, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lobe = f.lobe;
  if (!lobe) return out;
  const half = LAKE_SHELF_WIDTH / 2, B = lobe.width / 2;
  for (let s = step / 2; s < LAKE_SHELF_WIDTH; s += step) {
    for (let lat = -B + step / 2; lat < B; lat += step) {
      const a = (s - half) / half, b = lat / B;
      if (a * a + b * b >= 1) continue;
      const q = f.radius - s;
      const along = Math.sqrt(q * q - lat * lat);
      out.push([f.x + lobe.dirX * along - lobe.dirZ * lat, f.z + lobe.dirZ * along + lobe.dirX * lat]);
    }
  }
  return out;
}

/** The water terrain's stage over the composed field: every pond's lake bed,
 * then its marsh. After `featureStageD` in the olympic variant's sample, and
 * never in the bowl's build, so nothing the build places can move. */
export function lakeStageD(seed: number, features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample {
  let s = base;
  for (const f of features) {
    if (f.kind !== "pond") continue;
    s = lakeD(f, x, z, s);
    s = marshD(seed, f, x, z, s);
  }
  return s;
}

// ---- The plan ----------------------------------------------------------
export const LOOP_WEIGHT_1 = 0.3;
export const LOOP_WEIGHT_2 = 0.5;
export const LOOP_WEIGHT_3 = 0.2;
/** Where along the pad→crest line the i-th loop's feature is sought (fractions). */
/** The i-th loop's feature sits in this fraction of the pad->crest distance. The three
 * bands WIDEN and OVERLAP (0.25-0.4 / 0.45-0.6 / 0.65-0.8 -> 0.20-0.50 / 0.35-0.70 /
 * 0.55-0.85). A 0.15-wide band on a
 * 900 m axis is a 135 m strip, and after the lateral window, the road, the spacing, the
 * stem clearance and the slope cap it routinely held no candidate cell at all. Measured
 * over the 227-seed sweep at the moment this lever went on: zero-candidate attempts 108 -> 55 of
 * 426, loops built 168 -> 186, seeds with at least one loop 57.7 % -> 63.4 %. Loops
 * keep their stem order, and FEATURE_SPACING still keeps two features apart where the
 * bands now overlap. */
export const LOOP_BAND_LO_1 = 0.20;
export const LOOP_BAND_HI_1 = 0.50;
export const LOOP_BAND_LO_2 = 0.35;
export const LOOP_BAND_HI_2 = 0.70;
export const LOOP_BAND_LO_3 = 0.55;
export const LOOP_BAND_HI_3 = 0.85;
/** Lateral offset of a loop feature from the pad→crest line (m). */
export const LOOP_LATERAL_MIN = 60;
/** How far off the pad->crest line a loop feature's NEAR EDGE may sit.
 * 120 -> 200: the corridor within
 * 120 m of the line is the one the stem itself already occupies, so the cells left
 * after the stem-clearance filter were few and steep. Measured over the 227-seed sweep at the
 * moment this lever went on: zero-candidate attempts 171 -> 108 of 426, loops built
 * 129 -> 168, seeds with at least one loop 44.5 % -> 57.7 %. It lengthens loops (the
 * feature can stand further out), which LOOP_LEN_MAX's own band bounds. */
export const LOOP_LATERAL_MAX = 200;
/** A feature centre keeps this far from the road centreline, and this far from other centres. */
export const FEATURE_ROAD_CLEAR = 150;
/** Centre-to-centre spacing between any two features. 250 -> 180:
 * with the loop bands now overlapping, 250 m
 * let an earlier loop's feature blank out the next band. It is the weakest of the
 * four placement levers around it and was re-measured with the other three on rather
 * than alone — loops built 188 -> 190 of 426, zero-candidate attempts 54 -> 45, seeds
 * with at least one loop unchanged at 63.4 %. Kept because it buys candidates and
 * costs nothing; 180 m still leaves a clear gap between two 90 m meadows. */
export const FEATURE_SPACING = 180;
/** The ring cost: impassable inside the disc, RING_COST × inside the band [R, R + RING_BAND]. */
export const RING_BAND = 12;
export const RING_COST = 0.35;
/** Junction B sits at least this much stem length above junction A. */
export const LOOP_JUNCTION_GAP = 120;
/** A loop whose halves share more than this fraction of cells (with each other or the stem) is rejected. */
export const LOOP_OVERLAP_MAX = 0.2;
/** A half-loop's join into a stem junction runs 18-26 m along the stem's buffer —
 * measured across the sweep seeds — so cells within this reach of junction
 * A or B never count as shared; a genuine retrace runs longer. */
export const LOOP_JOIN_REACH = 30;
export const LOOP_LEN_MIN = 250;
/** 500 -> 700. This
 * budget is a lever, and 500 was never reachable at the module's own other numbers: a loop
 * round a MEADOW_RADIUS_MAX (110 m) disc has to walk the ring band the builder puts at
 * R + TRAIL_GRID_CELL + RING_BAND, so even the tightest legal placement — the disc's
 * near edge right against the trail's own clearance — is 2·(lat - R) + pi·(R + 14) of
 * about 400-510 m before a metre of detour. Measured over the 227-seed sweep with the
 * builder's own band at 1.5x this constant: at 500 the band rejected 107 otherwise
 * clean loops and 92 of 426 built (12.3 % of seeds got their full plan); at 700, 31
 * rejected and 131 built (20.3 %). The distribution that ships: 253 m shortest, 620 m
 * median, 1040 m longest. */
export const LOOP_LEN_MAX = 700;
/**
 * How many candidate discs a loop may try before its kind is dropped.
 * `LANDMARK_TRIES` (3) was reused for this initially, when almost every loop
 * died at the candidate scan and a bigger budget bought nothing. With the scan
 * now finding candidates on 400 of 426 planned loops, the budget is what decides
 * how many of them build. Measured over the 227-seed sweep with the code THIS FILE
 * ships (seeds with at least one loop / loops built of loops planned / mean
 * `bowlFor` ms):
 *
 *      3 → 71.8 % / 54.2 % / 262 ms      24 → 78.0 % / 62.2 % / 460 ms
 *      8 → 74.9 % / 58.2 % / 322 ms      40 → 79.7 % / 64.1 % / 558 ms
 *     16 → 75.8 % / 60.3 % / 399 ms      64 → 80.2 % / 65.3 % / 643 ms
 *
 * A smooth trade of world-build time for loops, with no cliff either way.
 * 24 is what ships. The target is a loop on ≥ 80 % of seeds and ≥ 50 % of
 * planned loops built: the second is met with room at 24, the first needs 64 —
 * which costs 643 ms a world against 460. Closing the meadow's own disc to the
 * loop search is what moved the first number from 80.2 % to 78.0 % at this
 * budget; buying it back with tries is the trade. Nothing else depends
 * on this number.
 */
export const LOOP_TRIES = 24;
/** The stem itself is not forbidden to a half-loop's search but PENALISED —
 * 8x, against the 0.35x reuse discount the search gives a tree cell, so
 * riding an existing bed costs about 2.8 times fresh ground instead of a
 * third of it. Forbidden outright it walls the map: 131 candidate turns on
 * the 227-seed sweep are reachable only through ground the stem's own corridor
 * occupies. Penalised, the search leaves the junction immediately where it
 * can and still has a way through a chokepoint where it must. Declared here
 * rather than inside the loop builder for the same reason as LOOP_TRIES
 * above: it decides whether a half-loop
 * can pass a chokepoint, i.e. which world a seed gets. */
export const TREE_PENALTY = 8;
/** The loop-feature candidate scan strides the grid's flat index by this.
 * The grid is row-major, so a stride
 * of 2 samples every other COLUMN — feature centres are drawn from a
 * 16 m x 8 m lattice rather than 8 x 8, and which columns depends on the
 * parity of grid.nu. Deterministic, and it halves an O(cells) scan that runs
 * once per loop against two whole-grid Dijkstras per try; it shipped as a
 * bare `c += 2` with no name, which is the same Global-Constraint breach as
 * LOOP_TRIES. The value is unchanged; only that it is named and folded into
 * the level id. The measured candidate ceiling ("noCand 181/426") was
 * taken with this stride on, so it is the ceiling of a half-sampled grid. */
export const LOOP_SCAN_STRIDE = 2;
export const STEM_LEN_MIN = 900;
export const STEM_LEN_MAX = 1400;
export const FEATURE_SALT = 0xfea7;

export const FEATURE_TUNABLES: Readonly<Record<string, number>> = {
  PEAK_RADIUS_MIN, PEAK_RADIUS_MAX, PEAK_RISE_MIN, PEAK_RISE_MAX, PEAK_CREST_RADIUS, PEAK_SHARPNESS,
  PEAK_INLAND_MIN, PEAK_INLAND_MAX, PEAK_SHOULDER, PEAK_LOWER_STEP, PEAK_LOWER_TRIES, PEAK_CENTRE_TRIES,
  TREELINE_BELOW_CREST, TREELINE_BAND, PEAK_RIM_FADE,
  MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX, MEADOW_RIM, MEADOW_TREE_MARGIN, MEADOW_SLOPE_MAX,
  POND_RADIUS_MIN, POND_RADIUS_MAX, POND_DEPTH, POND_APRON, POND_SHORE, POND_TREE_MARGIN, POND_SLOPE_MAX,
  MURK_LO, MURK_HI,
  LAKE_SHELF_DEPTH, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH, LAKE_DEPTH_MURKY, LAKE_DEPTH_CLEAR,
  MARSH_MURK_MIN, MARSH_WIDTH_MIN, MARSH_WIDTH_MAX, MARSH_AMP, MARSH_NOISE_WAVE, MARSH_EDGE,
  MARSH_SHORE_START, MARSH_SHORE_SCAN, MARSH_SCORE_STEP, MARSH_SALT,
  LOOP_WEIGHT_1, LOOP_WEIGHT_2, LOOP_WEIGHT_3,
  LOOP_BAND_LO_1, LOOP_BAND_HI_1, LOOP_BAND_LO_2, LOOP_BAND_HI_2, LOOP_BAND_LO_3, LOOP_BAND_HI_3,
  LOOP_LATERAL_MIN, LOOP_LATERAL_MAX, FEATURE_ROAD_CLEAR, FEATURE_SPACING,
  RING_BAND, RING_COST, LOOP_JUNCTION_GAP, LOOP_OVERLAP_MAX, LOOP_JOIN_REACH, LOOP_LEN_MIN, LOOP_LEN_MAX,
  LOOP_TRIES, TREE_PENALTY, LOOP_SCAN_STRIDE,
  STEM_LEN_MIN, STEM_LEN_MAX, FEATURE_SALT,
};

/** The i-th loop's stem band, 0-based. */
export function loopBand(i: number): { lo: number; hi: number } {
  if (i === 0) return { lo: LOOP_BAND_LO_1, hi: LOOP_BAND_HI_1 };
  if (i === 1) return { lo: LOOP_BAND_LO_2, hi: LOOP_BAND_HI_2 };
  return { lo: LOOP_BAND_LO_3, hi: LOOP_BAND_HI_3 };
}

/**
 * The seed's loop plan: N from the weights, kinds from {meadow, pond} with
 * replacement, never two ponds (the second pond becomes a meadow). Draw i of
 * the plan is hash3(i, 0, 0, seed ^ FEATURE_SALT) so the plan is a pure
 * function of the seed and independent of anything the builder does later.
 */
export function planFeatures(seed: number): { loops: LoopKind[] } {
  const salted = seed ^ FEATURE_SALT;
  const r = hash3(0, 0, 0, salted);
  const n = r < LOOP_WEIGHT_1 ? 1 : r < LOOP_WEIGHT_1 + LOOP_WEIGHT_2 ? 2 : 3;
  const loops: LoopKind[] = [];
  let ponds = 0;
  for (let i = 0; i < n; i++) {
    let kind: LoopKind = hash3(i + 1, 0, 0, salted) < 0.5 ? "meadow" : "pond";
    if (kind === "pond" && ponds >= 1) kind = "meadow";
    if (kind === "pond") ponds++;
    loops.push(kind);
  }
  return { loops };
}

/** A seeded value in [lo, hi] for draw index `i` of feature `id`. */
export function featureDraw(seed: number, id: number, i: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hash3(id + 16, i, 0, seed ^ FEATURE_SALT);
}

function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return { v: t * t * t * (t * (t * 6 - 15) + 10), d: (30 * t * t * (t - 1) * (t - 1)) / span };
}

/**
 * A cone crossed with the quintic dome, remapped onto [PEAK_CREST_RADIUS, R]
 * (`peakD` holds a base-parallel platform inside PEAK_CREST_RADIUS): the cone gives
 * the crest its grade just past the platform (k·rise/(R−c), 0.18–0.29 for
 * the rises 50–80), the dome gives the rim a smooth landing; skirt max ≈
 * 1.78·rise/(R−c) = 0.32–0.52 at R 300, c 25 — measured directly over
 * r ∈ [0.01, R) at 0.05 m steps: 0.323 at rise 50, 0.420 at rise 65, 0.517 at
 * rise 80, each of them at r = 117. Under the 0.9 walkable cap AND under the
 * grid's conservative 0.6 cap, so the skirt is walkable ground in its own
 * right rather than something the keep-passability rule has to punch back open
 * (at the earlier R 220 and rises 60–90 the same maxima were
 * 0.547/0.684/0.821, all over the grid cap — see PEAK_RADIUS_MIN's comment
 * for what that cost the stem).
 */
function crestProfileD(q: number, R: number, s: { v: number; d: number }): { v: number; d: number } {
  const k = PEAK_SHARPNESS;
  const cone = 1 - (k * q) / R;
  return { v: cone * (1 - s.v), d: -(k / R) * (1 - s.v) - cone * s.d };
}

/**
 * The summit platform: a
 * pointed apex under a node-pinned, smoothed bed put the builder between two
 * gates with no value that cleared both (a de-clodded node reads measurably
 * below the true tip; the true tip smoothed into the profile disagrees with
 * the profile's own interior samples). The design answer is somewhere to
 * stand: inside PEAK_CREST_RADIUS (the bare-crest disc — no
 * clutter, rock class already) the dome is OFFSET FROM THE BASE BY THE FULL
 * RISE, so the crest cell's own de-clodding disc has no curvature of its own
 * and a node there is exact, not an average. It is not LEVEL — it carries
 * the base hillside's derivatives, so on a montane grade the 25 m summit
 * still tilts.
 * Outside it the cone×dome profile is the same shape as before, remapped
 * from [PEAK_CREST_RADIUS, R] onto [0, R] so it still lands flush at the rim.
 * C⁰ at the platform's edge (the value matches exactly: the cone term is 1 at
 * its own q = 0) but not C¹ — the platform's base-only gradient meets the
 * skirt's k·rise/(R−c) there, a real corner a player crossing it would feel,
 * traded for a node the bed can pin to without a flush error or a spike.
 */
export function peakD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const rx = x - f.x, rz = z - f.z;
  const q2 = rx * rx + rz * rz;
  const R = f.radius, c = PEAK_CREST_RADIUS;
  if (q2 >= R * R) return base;
  const q = Math.sqrt(q2);
  // The summit platform: the base offset by the full rise over the crest disc
  // — somewhere to stand (it carries the base's own grade, it is not level),
  // and a node height the bed can pin to without a flush error or a spike.
  if (q <= c) return { h: base.h + f.height, dx: base.dx, dz: base.dz };
  // The cone×dome profile, remapped onto [c, R].
  const scale = R / (R - c);
  const qe = (q - c) * scale;
  const s = smootherstepD(0, R, qe);
  const p = crestProfileD(qe, R, s);
  const qx = rx / q, qz = rz / q;
  const dq = f.height * p.d * scale;
  return { h: base.h + f.height * p.v, dx: base.dx + dq * qx, dz: base.dz + dq * qz };
}

/**
 * The flat: the WHOLE disc `[0, R]` is levelled to `f.height`, and the ramp
 * back to the hillside lies OUTSIDE it, over the apron `[R, R + MEADOW_RIM]` —
 * the pond's own shape (`basinD`) mirrored. Outside the apron the input sample
 * passes through unchanged, as the same object.
 *
 * The rim used to be INSIDE the radius. A loop has to walk ground the stage
 * has levelled — untouched montane hillside just outside a disc is as steep
 * as it ever was — but every edge must stay at least `f.radius`
 * from a non-peak feature's centre. With the ramp inside the radius those two
 * cannot both hold; with it outside, the loop walks the apron and clears the
 * disc. Measured over the 227-seed sweep: the two half-loops failed to reach their
 * turn on 479 candidate tries before this, 270 after.
 */
export function flatD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const rx = x - f.x, rz = z - f.z;
  const R = f.radius;
  const outer = R + MEADOW_RIM;
  const q2 = rx * rx + rz * rz;
  if (q2 >= outer * outer) return base;
  const q = Math.sqrt(q2);
  if (q < R) return { h: f.height, dx: 0, dz: 0 };
  const s = smootherstepD(R, outer, q);
  const w = 1 - s.v; // 1 at the rim, 0 where the apron meets the hillside
  const qx = rx / q, qz = rz / q;
  const wDx = -s.d * qx, wDz = -s.d * qz;
  return {
    h: (1 - w) * base.h + w * f.height,
    dx: -wDx * base.h + (1 - w) * base.dx + wDx * f.height,
    dz: -wDz * base.h + (1 - w) * base.dz + wDz * f.height,
  };
}

/**
 * The basin: inside the rim (q < R) the ground IS the dish — a surface
 * `height − POND_DEPTH·(1 − (q/R)²)²`, zero slope at the centre and zero
 * slope at the rim, so it meets the flat water without a step and holds the
 * feature's `height` all the way to the rim. Over the apron
 * [R, R + POND_APRON) that rim height blends back to the hillside, so the
 * rim is the feature's `height` everywhere around the circle and not the
 * (possibly sloped) candidate ground underneath it. Outside the apron the
 * input sample passes through unchanged, as the same object.
 */
export function basinD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const rx = x - f.x, rz = z - f.z;
  const R = f.radius;
  const outer = R + POND_APRON;
  const q2 = rx * rx + rz * rz;
  if (q2 >= outer * outer) return base;
  const q = Math.sqrt(q2);
  const qx = q > 1e-9 ? rx / q : 0, qz = q > 1e-9 ? rz / q : 0;
  if (q < R) {
    const t = q / R;
    const u = 1 - t * t;
    const dhDq = (4 * POND_DEPTH * u * t) / R;
    return { h: f.height - POND_DEPTH * u * u, dx: dhDq * qx, dz: dhDq * qz };
  }
  const s = smootherstepD(R, outer, q);
  const w = 1 - s.v; // 1 at the rim, 0 at the outer edge of the apron
  const wDx = -s.d * qx, wDz = -s.d * qz;
  return {
    h: (1 - w) * base.h + w * f.height,
    dx: -wDx * base.h + (1 - w) * base.dx + wDx * f.height,
    dz: -wDz * base.h + (1 - w) * base.dz + wDz * f.height,
  };
}

export function featureStageD(features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample {
  let s = base;
  for (const f of features) {
    if (f.kind === "peak") s = peakD(f, x, z, s);
    else if (f.kind === "meadow") s = flatD(f, x, z, s);
    else s = basinD(f, x, z, s);
  }
  return s;
}

export type FeatureMask = {
  /** Multiplier on tree density. */
  tree: number;
  /** Multiplier on ground clutter (grass, meadow carpet, flowers, fungus, bushes). */
  clutter: number;
  /** 1 inside a meadow's flat: the meadow ground class and denser flowers. */
  meadow: number;
  /** 1 on a pond's shore band and the peak's crest: bare floor / rock, no clutter. */
  bare: number;
};
/** The mask when no feature reaches a point — frozen so every caller shares
 * one object; a later task (the ground paint) imports it by this name. */
export const NO_FEATURE_MASK: FeatureMask = Object.freeze({ tree: 1, clutter: 1, meadow: 0, bare: 0 });

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * `h` is the ground height at (x, z) AFTER the feature stage — the peak's
 * treeline is a height, not a radius, so callers that have the sample pass its
 * `h`; the pure-disc parts do not need it.
 */
export function featureMaskAt(features: readonly Feature[], x: number, z: number, h?: number): FeatureMask {
  let tree = 1, clutter = 1, meadow = 0, bare = 0;
  let touched = false;
  for (const f of features) {
    const dx = x - f.x, dz = z - f.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (f.kind === "meadow") {
      // The meadow's flat is the WHOLE disc and its apron lies outside it,
      // so the ground class fills the disc and the tree margin starts where the apron ends.
      const reach = f.radius + MEADOW_RIM + MEADOW_TREE_MARGIN + 10;
      if (d >= reach) continue;
      touched = true;
      tree *= smoothstep(f.radius + MEADOW_RIM + MEADOW_TREE_MARGIN, reach, d);
      meadow = Math.max(meadow, 1 - smoothstep(f.radius, f.radius + MEADOW_RIM, d));
    } else if (f.kind === "pond") {
      const reach = f.radius + POND_TREE_MARGIN + 10;
      if (d >= reach) continue;
      touched = true;
      tree *= smoothstep(f.radius + POND_TREE_MARGIN, reach, d);
      const shore = 1 - smoothstep(f.radius + POND_SHORE, f.radius + POND_SHORE + 2, d);
      bare = Math.max(bare, shore);
      clutter *= 1 - shore;
    } else {
      if (d >= f.radius) continue;
      touched = true;
      if (h !== undefined) {
        // The treeline is a height: crestH − TREELINE_BELOW_CREST, thinning
        // over TREELINE_BAND — times a RADIAL FADE over the dome's outer
        // PEAK_RIM_FADE. It is the THINNING that fades, not the
        // ramp: at the rim the fade is 0, so the multiplier is 1 and the mask
        // meets the untouched forest outside the disc continuously instead of
        // jumping the whole amplitude at `d = f.radius`. `featurePaint.ts`'s
        // rock term is the same product, from the same table.
        const crest = f.crestH ?? Number.POSITIVE_INFINITY;
        const below = crest - h;
        const ramp = smoothstep(TREELINE_BELOW_CREST, TREELINE_BELOW_CREST + TREELINE_BAND, below);
        const fade = 1 - smoothstep(f.radius - PEAK_RIM_FADE, f.radius, d);
        tree *= 1 - fade * (1 - ramp);
      }
      if (d < PEAK_CREST_RADIUS) { bare = 1; clutter = 0; }
    }
  }
  return touched ? { tree, clutter, meadow, bare } : NO_FEATURE_MASK;
}

export function treelineOf(peak: Feature): number {
  return (peak.crestH ?? 0) - TREELINE_BELOW_CREST;
}
