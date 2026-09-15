/**
 * The olympic variant: the dense montane config
 * composed with a Pacific coastline west of spawn — sandy bays,
 * headland bluffs, an offshore shelf and jittered-grid sea stacks —
 * then cliff bands, then
 * beach dunes, then the highway road. Inland of the blend window
 * the pre-cliff base is the dense sample UNCHANGED (bit-identity);
 * offshore it never evaluates dense at all. Cliff bands and dunes may
 * then perturb that base — the composed field is bit-identical to dense
 * inland only where BOTH the cliff mask and the dune window are cold. In
 * practice inland is where the dune window is coldest (it shuts above
 * DUNE_ALT_OUT_HI = 8 m) and the cliff mask is hottest, so the two
 * conditions rarely bind at the same place, but the identity claim now
 * depends on both.
 *
 * Same contract as montane.ts: dx/dz are the EXACT analytic derivatives of h.
 * Every piece here is C² in signed coast distance d, so the numeric-vs-analytic
 * harness needs no special pleading at band edges. sim/ determinism rules:
 * no trig, no Math.pow, no `**`, no hypot.
 */
import { fbm2d, hash3 } from "./field.js";
import { DENSE_VARIANT_TUNABLES, denseSample } from "./montane.js";
import {
  ROAD_WINDOW_FRACTION, ROAD_WOBBLE, ROAD_WOBBLE_WAVELENGTH, ROAD_WOBBLE_OCTAVES,
  ROAD_SALT, ROAD_LATTICE, ROAD_BED_HALF, ROAD_CORRIDOR_HALF,
  roadOffsetD, gradeSplineD, corridorD,
} from "./road.js";
import {
  CLIFF_PERIOD, CLIFF_BENCH, CLIFF_RISER_HALF,
  CLIFF_PHASE_AMP, CLIFF_PHASE_WAVELENGTH, CLIFF_PHASE_OCTAVES, CLIFF_PHASE_SALT,
  CLIFF_ALT_LO, CLIFF_ALT_HI,
  CLIFF_MTN_STRENGTH, CLIFF_MTN_WAVELENGTH, CLIFF_MTN_OCTAVES,
  CLIFF_MTN_LO, CLIFF_MTN_HI, CLIFF_MTN_SALT,
  CLIFF_OUT_STRENGTH, CLIFF_OUT_WAVELENGTH, CLIFF_OUT_OCTAVES,
  CLIFF_OUT_LO, CLIFF_OUT_HI, CLIFF_OUT_ALT_LO, CLIFF_OUT_ALT_HI, CLIFF_OUT_SALT,
  CLIFF_ROAD_NEAR, CLIFF_ROAD_FAR,
  cliffD,
} from "./cliffs.js";
import { registerTerrainVariant, type TerrainSample } from "./terrain.js";
import {
  BOWL_TUNABLES, BOWL_Z_HALF, TRAIL_Z_ANCHOR,
  inBowl, padD, apronWindowD, apronKeepD, APRON_BLEND_END,
} from "./bowl.js";
import {
  TRAIL_TUNABLES, trailCorridorD, trailDistance as graphTrailDistance,
  type TrailGraph,
} from "./trail.js";
import { buildTrail } from "./trailBuild.js";
import {
  LANDMARK_TUNABLES, landmarkMaskAt, type Landmark, type LandmarkMask,
} from "./landmarks.js";
import { FEATURE_TUNABLES, featureStageD, featureMaskAt, type Feature, type FeatureMask } from "./features.js";
import { forestDensityUnmasked } from "./vegetation.js";
import { boulderDensityUnmasked, CLUTTER_BOULDER_SLOPE_LO } from "./clutter.js";

// ---- Tunables ---------------------------------------------------------------
export const SEA_LEVEL = 0;
export const COAST_X = -400;
export const COAST_WARP_WAVELENGTH = 1100;
export const COAST_WARP_AMPLITUDE = 220;
export const COAST_WARP_OCTAVES = 2;
export const BLEND_START = 25;
export const BLEND_END_BAY = 500;
export const BLEND_END_HEADLAND = 40;
export const BEACH_GRADE = 0.025;
export const SURF_GRADE = 0.015;
export const GRADE_MORPH = 6;
export const SHELF_BREAK_DEPTH = 8;
export const FLOOR_DEPTH = 25;
export const SHELF_BREAK_WIDTH = 400;
export const STACK_BAND_NEAR = -40;
export const STACK_BAND_FAR = -280;
export const STACK_BAND_FADE = 60;
export const STACK_CELL = 180;
export const STACK_DENSITY = 0.35;
export const STACK_RADIUS_MIN = 12;
export const STACK_RADIUS_MAX = 24;
export const STACK_HEIGHT_MIN = 12;
export const STACK_HEIGHT_MAX = 38;

const STACK_SALT = 0x57ac;

// ---- Dunes --------------------------------------------------------------
/** Peak-to-peak ceiling of the foredune field, metres — the value the noise
 * would reach if the road window, the altitude window and the noise itself
 * were all simultaneously extremal, which they never are. DELIVERED relief is
 * what matters and is much smaller: measured over 1500 shore-normal traverses
 * spanning 15 km of coastline (each 0-120 m inland, sampled at 1 m, composed
 * through `variantOrThrow("olympic").sample`), crest-to-trough across the
 * sand band is p50 0.195 m, p90 0.312 m, max 0.492 m. That is the number to
 * compare against the ~4 m sand band `terrainSurface.ts` paints over. */
export const DUNE_AMPLITUDE = 1.2;
/** Shore-normal wavelength. Shorter than DUNE_WAVELENGTH_Z on purpose: real
 * foredunes elongate ALONG the shore, so ridges must be anisotropic or they
 * read as generic lumps. */
export const DUNE_WAVELENGTH_X = 30;
/** Shore-parallel wavelength — 3x the shore-normal one. */
export const DUNE_WAVELENGTH_Z = 90;
export const DUNE_OCTAVES = 3;
/** Altitude window, metres: rise over [IN_LO, IN_HI], fall over [OUT_LO,
 * OUT_HI]. The rise tracks `terrainSurface.ts`'s own wet-to-dry sand mix
 * (`smoothstep(0, 0.7, altitude)`, terrainSurface.ts:196) so dunes build as
 * the sand dries, and being strictly positive it excludes everything at or
 * below the waterline by construction. The fall starts at SAND_TOP = 4
 * exactly; it ends at 8, which is NOT COAST_FADE_END = 9 — dunes finish
 * fading a metre before the sand paint does, so no dune survives into ground
 * that is no longer painted sand. Closing below CLIFF_OUT_ALT_LO (12) keeps
 * dunes and cliffs disjoint.
 *
 * IN_LO/IN_HI are also the sea-level safety lever. A trough is at worst
 * `0.5·DUNE_AMPLITUDE·rise(h)` below the pre-dune height `h`, so
 * `0.5·DUNE_AMPLITUDE·rise(h) < h` must hold across the whole rise or dunes
 * would pit dry beach below sea level and fill it with water. At
 * DUNE_AMPLITUDE = 1.2 over [0.1, 1.0] the worst case is a trough reaching
 * 69.4% of `h` (at h = 0.777 m), a 1.44x margin, and the absolute margin at
 * the window's own bottom edge is IN_LO = 0.1 m. Raising DUNE_AMPLITUDE
 * requires widening this rise in step. */
export const DUNE_ALT_IN_LO = 0.1;
export const DUNE_ALT_IN_HI = 1.0;
export const DUNE_ALT_OUT_LO = 4;
export const DUNE_ALT_OUT_HI = 8;
/** Road suppression, mirroring CLIFF_ROAD_NEAR/FAR: dunes are absent inside
 * the corridor and fade in outside it, so the earthworks meet flat sand.
 *
 * The fade is deliberately NARROW (10 m, where CLIFF_ROAD_FAR uses 60). The
 * window is already largely redundant: `olympicSample` hands everything
 * inside |u| < ROAD_CORRIDOR_HALF to `corridorD`, which overwrites it, and
 * DUNE_ROAD_NEAR == ROAD_CORRIDOR_HALF — so the only thing the fade width
 * buys is a gentler shoulder, at the cost of deleting dunes from real beach.
 * The highway runs close to and roughly parallel with the shore here, so a
 * wide fade eats the inland half of the beach, which is exactly where the
 * altitude window is open. Measured p50 crest-to-trough across the sand band
 * over 15 km of coastline: 0.035 m at +40, 0.138 m at +10 with nothing else
 * changed. `smootherstepD` is C² at both edges whatever the width, so
 * narrowing costs no continuity. */
export const DUNE_ROAD_NEAR = ROAD_CORRIDOR_HALF;
export const DUNE_ROAD_FAR = ROAD_CORRIDOR_HALF + 10;

/** In the tunables below, unlike STACK_SALT and COAST_WARP_SALT above.
 * A salt change moves the field, so it must move the level id, and the
 * cliff and road modules already export CLIFF_PHASE_SALT, CLIFF_OUT_SALT
 * and ROAD_SALT into it for exactly that reason. (vegetation.ts:108 records
 * the older montane convention of keeping salts module-private; this is the
 * newer one. The two older salts in this file predate the change and are
 * left alone rather than folded in as a drive-by level-id bump.) */
const DUNE_SALT = 0xd0e5;

const COAST_WARP_SALT = 0x0cea;
/** Fixed first coordinate for the 1-D use of fbm2d — off-lattice on purpose. */
const WARP_LINE_X = 0.318;
/** Where the surf grade would reach the shelf-break depth. */
const SHELF_BREAK_D = -(SHELF_BREAK_DEPTH / SURF_GRADE);

/** Quintic smootherstep with derivative — C² at both edges. */
function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return {
    v: t * t * t * (t * (t * 6 - 15) + 10),
    d: (30 * t * t * (t - 1) * (t - 1)) / span,
  };
}

/** C² softened max(0, d): 0 below −m, exactly d above +m, quintic-derived ramp
 * between (its derivative is the cubic smoothstep of d). Morphs the surf grade
 * into the beach grade without a crease at the waterline. */
function smoothPosD(d: number, m: number): { v: number; d: number } {
  if (d <= -m) return { v: 0, d: 0 };
  if (d >= m) return { v: d, d: 1 };
  const t = (d + m) / (2 * m);
  return { v: m * t * t * t * (2 - t), d: t * t * (3 - 2 * t) };
}

/** Re-centres the grade morph so the waterline sits on d = 0 exactly. */
const SHORE_TRIM = ((BEACH_GRADE - SURF_GRADE) * GRADE_MORPH * 3) / 16;

/**
 * The shore profile as a function of signed coast distance alone: beach rising
 * at BEACH_GRADE inland, surf falling at SURF_GRADE seaward, the two morphing
 * C²-smoothly over ±GRADE_MORPH, then a smootherstep blend down to the flat
 * open-water floor across [SHELF_BREAK_D − SHELF_BREAK_WIDTH, SHELF_BREAK_D].
 * Monotone: `near + FLOOR_DEPTH > 0` throughout the blend, so both terms of
 * the derivative are non-negative.
 */
function shoreProfileD(d: number): { v: number; dd: number } {
  const ramp = smoothPosD(d, GRADE_MORPH);
  const near = SURF_GRADE * d + (BEACH_GRADE - SURF_GRADE) * ramp.v - SHORE_TRIM;
  const nearDd = SURF_GRADE + (BEACH_GRADE - SURF_GRADE) * ramp.d;
  const w = smootherstepD(SHELF_BREAK_D - SHELF_BREAK_WIDTH, SHELF_BREAK_D, d);
  return {
    v: w.v * near + (1 - w.v) * -FLOOR_DEPTH,
    dd: w.v * nearDd + w.d * (near + FLOOR_DEPTH),
  };
}

/** The stack field and its exact gradient, BEFORE the band window. Sums C²
 * columns from the 3×3 cell neighbourhood; STACK_RADIUS_MAX ≤ STACK_CELL / 2
 * guarantees no column escapes it. */
function stackFieldD(seed: number, x: number, z: number): { v: number; dx: number; dz: number } {
  const cellX = Math.floor(x / STACK_CELL);
  const cellZ = Math.floor(z / STACK_CELL);
  let v = 0;
  let dx = 0;
  let dz = 0;
  for (let cz = cellZ - 1; cz <= cellZ + 1; cz++) {
    for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
      if (hash3(cx, cz, 0, seed ^ STACK_SALT) >= STACK_DENSITY) continue;
      const px = (cx + 0.2 + 0.6 * hash3(cx, cz, 1, seed ^ STACK_SALT)) * STACK_CELL;
      const pz = (cz + 0.2 + 0.6 * hash3(cx, cz, 2, seed ^ STACK_SALT)) * STACK_CELL;
      const radius =
        STACK_RADIUS_MIN + (STACK_RADIUS_MAX - STACK_RADIUS_MIN) * hash3(cx, cz, 3, seed ^ STACK_SALT);
      const height =
        STACK_HEIGHT_MIN + (STACK_HEIGHT_MAX - STACK_HEIGHT_MIN) * hash3(cx, cz, 4, seed ^ STACK_SALT);
      const rx = x - px;
      const rz = z - pz;
      const u = (rx * rx + rz * rz) / (radius * radius);
      if (u >= 1) continue;
      const s = 1 - u;
      // column = height·(1 − u)³;  ∂column/∂x = −3·height·(1 − u)²·(2·rx/R²)
      v += height * s * s * s;
      const dPerR = (-6 * height * s * s) / (radius * radius);
      dx += dPerR * rx;
      dz += dPerR * rz;
    }
  }
  return { v, dx, dz };
}

/**
 * Foredunes on the beach. Windowed on the
 * pre-dune base HEIGHT rather than on coast distance: that confines dunes to
 * exactly the altitude band `terrainSurface.ts` paints sand over, self-adjusts
 * around bays and headlands with no reference to `blendEnd`, and excludes
 * everything below the waterline by construction.
 *
 * Takes `uDz` (unlike a first draft of this function, which dropped it):
 * `u` enters through an absolute-value road-suppression window — not a
 * squared one like `cliffMaskD`'s, so its chain-rule term is `sign(u)` rather
 * than `2u` — and that window is transitioning (`road.d ≠ 0`) throughout the
 * annulus `DUNE_ROAD_NEAR..DUNE_ROAD_FAR`. `olympicSample` only applies
 * `corridorD` for `|u| < ROAD_CORRIDOR_HALF`, and `DUNE_ROAD_NEAR ==
 * ROAD_CORRIDOR_HALF`, so that whole annulus sits outside the corridor with
 * nothing else to correct the approximation — the term is required, not an
 * acceptable simplification.
 */
export function duneD(
  seed: number,
  x: number,
  z: number,
  u: number,
  uDz: number,
  base: TerrainSample,
): TerrainSample {
  const absU = u < 0 ? -u : u;
  const signU = u < 0 ? -1 : 1;
  const road = smootherstepD(DUNE_ROAD_NEAR, DUNE_ROAD_FAR, absU);
  if (road.v === 0) return base;
  // d(road.v)/d(x,z), through |u|: ∂|u|/∂x = sign(u), ∂|u|/∂z = sign(u)·uDz.
  const roadDx = road.d * signU;
  const roadDz = road.d * signU * uDz;

  // Altitude window: rise over [IN_LO, IN_HI], fall over [OUT_LO, OUT_HI].
  const rise = smootherstepD(DUNE_ALT_IN_LO, DUNE_ALT_IN_HI, base.h);
  const fall = smootherstepD(DUNE_ALT_OUT_LO, DUNE_ALT_OUT_HI, base.h);
  const w = rise.v * (1 - fall.v);
  if (w === 0) return base;
  // d(window)/d(base.h)
  const wDh = rise.d * (1 - fall.v) - rise.v * fall.d;

  const f = fbm2d(x / DUNE_WAVELENGTH_X, z / DUNE_WAVELENGTH_Z, seed ^ DUNE_SALT, DUNE_OCTAVES);
  // fbm2d is already zero-centred — it sums gradientNoise2 and is normalized
  // to [-1, 1] (field.ts:218), unlike fbm2 (sums valueNoise2, [0, 1]). Halving
  // it gives exactly the [-0.5, 0.5] this field wants, so dunes cut troughs as
  // well as raising crests without an additive re-centring term.
  const v = 0.5 * f.v;
  const a = DUNE_AMPLITUDE * road.v;
  const aDx = DUNE_AMPLITUDE * roadDx;
  const aDz = DUNE_AMPLITUDE * roadDz;

  // Δh = a(u)·w(base.h)·v(x, z) — the DUNE'S CONTRIBUTION, added to base.h
  // below, not the height itself. All three factors' gradients are live:
  // the road window's through u, the altitude window's through base.h, and
  // the noise field's own. Same product-rule shape as the sea-stack block
  // above, with one more live factor. v = 0.5·f.v, so ∂v/∂x = 0.5·f.dx /
  // DUNE_WAVELENGTH_X and likewise for z.
  return {
    h: base.h + a * w * v,
    dx: base.dx + aDx * w * v + a * wDh * base.dx * v + a * (w * (0.5 * f.dx)) / DUNE_WAVELENGTH_X,
    dz: base.dz + aDz * w * v + a * wDh * base.dz * v + a * (w * (0.5 * f.dz)) / DUNE_WAVELENGTH_Z,
  };
}

/**
 * Signed coast distance for the variant registry — the same `d` that
 * `coastFrame` derives (`x − coastlineX`), duplicated as two lines rather
 * than calling `coastFrame` and discarding the rest: `coastFrame` also
 * computes `dDz`, `blendEnd` and `blendEndDz`, none of which this needs, so
 * sharing would mean carrying an unused wider return shape here.
 */
function signedCoastDistance(seed: number, x: number, z: number): number {
  const warp = fbm2d(WARP_LINE_X, z / COAST_WARP_WAVELENGTH, seed ^ COAST_WARP_SALT, COAST_WARP_OCTAVES);
  return x - (COAST_X + COAST_WARP_AMPLITUDE * warp.v);
}

/** The pre-road field: shore profile + stacks + dense blend. Extracted
 * unchanged from the old olympicSample so its arithmetic is untouched —
 * the montane-family snapshots and the outside-corridor bit-identity test
 * both pin this. */
function olympicBaseFrom(
  seed: number, x: number, z: number,
  d: number, dDz: number, blendEnd: number, blendEndDz: number,
): TerrainSample {
  // Short-circuit: inland of the window, dense bit-identically.
  if (d >= blendEnd) return denseSample(seed, x, z);

  const shore = shoreProfileD(d);

  // Sea stacks: the field windowed by a C² band in d, so stacks
  // fade in past the surf and out again before the shelf break. The window
  // depends on position only through d, so its gradient rides ∂d/∂x = 1 and
  // ∂d/∂z = dDz. Band support ends at d = STACK_BAND_NEAR < BLEND_START, so
  // stacks never reach the montane blend region.
  const bIn = smootherstepD(STACK_BAND_FAR, STACK_BAND_FAR + STACK_BAND_FADE, d);
  const bOut = smootherstepD(STACK_BAND_NEAR - STACK_BAND_FADE, STACK_BAND_NEAR, d);
  const band = bIn.v * (1 - bOut.v);
  const bandDd = bIn.d * (1 - bOut.v) - bIn.v * bOut.d;
  let stackH = 0;
  let stackDx = 0;
  let stackDz = 0;
  if (band > 0) {
    const st = stackFieldD(seed, x, z);
    stackH = band * st.v;
    stackDx = band * st.dx + bandDd * st.v;        // ∂band/∂x = bandDd·(∂d/∂x = 1)
    stackDz = band * st.dz + bandDd * dDz * st.v;
  }

  const baseH = shore.v + stackH;
  const baseDx = shore.dd + stackDx;
  const baseDz = shore.dd * dDz + stackDz;

  const span = blendEnd - BLEND_START;
  const t = (d - BLEND_START) / span;
  if (t <= 0) return { h: baseH, dx: baseDx, dz: baseDz };

  // Blend region: quintic smootherstep of t, whose z-derivative carries both
  // the coastline's movement and the window's own z-dependence:
  //   ∂t/∂x = 1/span,  ∂t/∂z = (dDz·span − (d − BLEND_START)·blendEndDz)/span².
  const m = denseSample(seed, x, z);
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  const sDt = 30 * t * t * (t - 1) * (t - 1);
  const tDx = 1 / span;
  const tDz = (dDz * span - (d - BLEND_START) * blendEndDz) / (span * span);
  return {
    h: baseH + s * (m.h - baseH),
    dx: baseDx + s * (m.dx - baseDx) + sDt * tDx * (m.h - baseH),
    dz: baseDz + s * (m.dz - baseDz) + sDt * tDz * (m.h - baseH),
  };
}

/**
 * The coastline-warp preamble: coast x, its z-derivative, and the blend
 * window's endpoint and z-derivative — TWO of the latter. Shared by the
 * sample, the pre-road base export, and the road lattice so all three see the
 * same warp.
 *
 * `blendEnd` is the APRONED window: inside
 * the trail's z-window it is pulled out to APRON_BLEND_END so the shore→montane
 * climb happens over ~500 m rather than a headland's 100. ONLY
 * `olympicBaseFrom`'s terrain blend may read it.
 *
 * `roadBlendEnd` is the headland/bay value the coast has always had, and EVERY
 * `roadOffsetD` caller reads it — the sample, the pre-trail sample, the pre-pad
 * sample, the road frame, the road distance, the centreline and the grade
 * lattice — because `roadOffsetD`'s coast offset is a FRACTION
 * (ROAD_WINDOW_FRACTION) of the blend window, so a window pulled out to 600 m
 * moves the highway itself inland with it.
 *
 * 2026-09-09: the apron shifted
 * the road 32–50 m inland inside its z-window (seed 24301 at z = 0:
 * −230 → −198) and put a 45° jog in the centreline across the window's fade at
 * z ≈ ±660 (|d roadCenterX / dz| up to 1.020, against 0.479 anywhere on the
 * pre-apron road itself — on the coast warp, well outside the apron's window).
 * The apron is a TERRAIN change; the highway is not part of it.
 * `apron.test.ts` pins the centreline bit-identical to the pre-apron formula
 * and holds its drift under 0.5, which is the control's own worst plus a
 * margin.
 */
function coastFrame(seed: number, z: number): {
  coastlineX: number; dDz: number; blendEnd: number; blendEndDz: number;
  roadBlendEnd: number; roadBlendEndDz: number;
} {
  // Coastline: 1-D fbm along z. fbm2d's derivatives are w.r.t. its own inputs,
  // so ∂/∂z of warp(z / λ) is warp.dz / λ.
  const warp = fbm2d(WARP_LINE_X, z / COAST_WARP_WAVELENGTH, seed ^ COAST_WARP_SALT, COAST_WARP_OCTAVES);
  const coastlineX = COAST_X + COAST_WARP_AMPLITUDE * warp.v;
  const dDz = (-COAST_WARP_AMPLITUDE * warp.dz) / COAST_WARP_WAVELENGTH; // ∂d/∂z; ∂d/∂x = 1

  // Blend window, narrowed on headlands: warp seaward ⇒ v < 0 ⇒
  // window toward BLEND_END_HEADLAND; deepest bay ⇒ v ≈ +1 ⇒ BLEND_END_BAY.
  const head = 0.5 + 0.5 * warp.v;
  const headDz = (0.5 * warp.dz) / COAST_WARP_WAVELENGTH;

  // The apron: inside the trail's z-window
  // the blend end is pulled out to APRON_BLEND_END so the shore→montane climb
  // happens over ~500 m rather than a headland's 100. Outside the window
  // this is the headland/bay value exactly (W = 0). Product rule through W(z).
  const b0 = BLEND_END_HEADLAND + (BLEND_END_BAY - BLEND_END_HEADLAND) * head;
  const b0Dz = (BLEND_END_BAY - BLEND_END_HEADLAND) * headDz;
  const W = apronWindowD(z);
  return {
    coastlineX,
    dDz,
    blendEnd: b0 + (APRON_BLEND_END - b0) * W.v,
    blendEndDz: b0Dz * (1 - W.v) + (APRON_BLEND_END - b0) * W.dz,
    roadBlendEnd: b0,
    roadBlendEndDz: b0Dz,
  };
}

/** The pre-road field, exported for census purposes and any future tooling
 * that needs terrain without the highway cut into it. */
export function olympicBaseSample(seed: number, x: number, z: number): TerrainSample {
  const f = coastFrame(seed, z);
  return olympicBaseFrom(seed, x, z, x - f.coastlineX, f.dDz, f.blendEnd, f.blendEndDz);
}

/** Pre-road heights at road-centerline lattice points, memoized per seed.
 * Pure memoization of a pure function — bit-transparent, and the
 * query-order test pins that. Growth is one entry per ROAD_LATTICE (480 m)
 * of travelled z: negligible. Deliberately samples the pre-cliff field: at
 * the centerline u = 0, cliffD is the identity, so the lattice cannot see
 * cliffs by construction. */
const LATTICE_CACHE = new Map<number, Map<number, number>>();

function latticeHFor(seed: number): (i: number) => number {
  let perSeed = LATTICE_CACHE.get(seed);
  if (perSeed === undefined) {
    perSeed = new Map();
    LATTICE_CACHE.set(seed, perSeed);
  }
  const cache = perSeed;
  return (i: number): number => {
    let h = cache.get(i);
    if (h === undefined) {
      const z = i * ROAD_LATTICE;
      const f = coastFrame(seed, z);
      const { dr } = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
      // The centerline point: x = coastlineX + dr, so x − coastlineX is dr
      // only up to the float rounding of that addition — consistent to
      // ~1 ulp (~4e-14 m measured), not bit-exactly. The independent-oracle
      // test below re-derives d as x − coastlineX and checks agreement with
      // a tolerance rather than toBe for exactly this reason.
      h = olympicBaseFrom(seed, f.coastlineX + dr, z, dr, f.dDz, f.blendEnd, f.blendEndDz).h;
      cache.set(i, h);
    }
    return h;
  };
}

/** The road's grade line height and z-slope at a given z. */
export function roadGradeAt(seed: number, z: number): { h: number; dz: number } {
  return gradeSplineD(latticeHFor(seed), z);
}

/** The road frame at a world point: signed offset u and its z-derivative. */
export function roadFrameAt(seed: number, x: number, z: number): { u: number; uDz: number } {
  const f = coastFrame(seed, z);
  const d = x - f.coastlineX;
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  return { u: d - road.dr, uDz: f.dDz - road.drDz };
}

/** The pad sits on the road's shoulder: its height is
 * the road grade at the anchor, which corridorD already imposes there. */
function padHeightFor(seed: number): number {
  return roadGradeAt(seed, TRAIL_Z_ANCHOR).h;
}

/**
 * The field the graph builder and landmark placement sample for heights:
 * base → cliffs → dunes → trailhead pad → road corridor. The road corridor
 * joins this field so the builder's own field matches
 * the composed one inside |u| < ROAD_CORRIDOR_HALF — the pad sits on the
 * road's shoulder now, so the ground the builder routes from must already be
 * cut to the road grade there. No trail, no landmarks — it must not read
 * the graph.
 */
export function olympicPreTrailSample(seed: number, x: number, z: number): TerrainSample {
  const f = coastFrame(seed, z);
  const d = x - f.coastlineX;
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  const u = d - road.dr;
  const uDz = f.dDz - road.drDz;
  const base = olympicBaseFrom(seed, x, z, d, f.dDz, f.blendEnd, f.blendEndDz);
  const duned = duneD(seed, x, z, u, uDz, cliffD(seed, x, z, u, uDz, base, apronKeepD(u, uDz, z)));
  const padded = inBowl(u, z) ? padD(u, uDz, z, padHeightFor(seed), duned) : duned;
  if (Math.abs(u) >= ROAD_CORRIDOR_HALF) return padded;
  return corridorD(u, uDz, roadGradeAt(seed, z), padded);
}

/** Everything the bowl owns for one seed: the trail graph, its made features
 * (the peak, and the loop features) and its two scenery
 * landmarks — found where the seed's terrain provides, carved where it does
 * not. All three come out of one build (`buildTrail`): the landmarks are
 * chosen among the cells the trail can actually reach, so there is no second
 * pass to place them. */
export type Bowl = { graph: TrailGraph; landmarks: Landmark[]; features: Feature[] };
const BOWL_CACHE = new Map<number, Bowl>();
export function bowlFor(seed: number): Bowl {
  let b = BOWL_CACHE.get(seed);
  if (b === undefined) {
    // Placement reads UNMASKED densities over the pre-trail field: the mask is
    // derived from these placements, so reading it here would be circular.
    b = buildTrail(seed, {
      roadCenterX: (z) => roadCenterX(seed, z),
      sample: (x, z) => olympicPreTrailSample(seed, x, z),
      treeDensity: (x, z) => forestDensityUnmasked(seed, x, z, olympicPreTrailSample(seed, x, z)),
      boulderDensity: (x, z) => boulderDensityUnmasked(seed, x, z, olympicPreTrailSample(seed, x, z)),
      boulderSlopeMin: CLUTTER_BOULDER_SLOPE_LO,
    });
    BOWL_CACHE.set(seed, b);
  }
  return b;
}

/**
 * Distance to the nearest trail edge, or `Infinity` outside the bowl.
 *
 * `treeInCell` calls this for every surviving tree ANYWHERE in the world, and
 * without the gate each call loops the graph's edges and builds the bowl for
 * the seed. Every node of the graph is a walkability-grid cell centre, which is
 * at least half a cell (4 m) inside the region's box, and every landmark is
 * LANDMARK_BOWL_MARGIN (50 m) inside it — so a query outside `inBowl` is more
 * than 4 m from every edge, and every consumer of this hook is a threshold test
 * at 6 m or less. Cheapest test first: the z band costs two compares, the road
 * frame costs a coast lookup.
 */
function trailDistanceHook(seed: number, x: number, z: number): number {
  if (Math.abs(z - TRAIL_Z_ANCHOR) > BOWL_Z_HALF) return Infinity;
  const { u } = roadFrameAt(seed, x, z);
  if (!inBowl(u, z)) return Infinity;
  return graphTrailDistance(bowlFor(seed).graph, x, z);
}
function trailGraphHook(seed: number): TrailGraph {
  return bowlFor(seed).graph;
}
function landmarkMaskHook(seed: number, x: number, z: number): LandmarkMask {
  return landmarkMaskAt(bowlFor(seed).landmarks, x, z);
}
/** The made-feature mask hook: samples the composed field itself only
 * when the caller doesn't already hold the ground height at (x, z) — the
 * peak's treeline is a height, not a radius, so `featureMaskAt` needs it, but
 * a caller that already sampled the ground should not
 * pay for a second `olympicSample`. */
function featureMaskHook(seed: number, x: number, z: number, h?: number): FeatureMask {
  return featureMaskAt(bowlFor(seed).features, x, z, h ?? olympicSample(seed, x, z).h);
}

function olympicSample(seed: number, x: number, z: number): TerrainSample {
  const f = coastFrame(seed, z);
  const d = x - f.coastlineX;
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  const u = d - road.dr;
  const uDz = f.dDz - road.drDz;
  const base = olympicBaseFrom(seed, x, z, d, f.dDz, f.blendEnd, f.blendEndDz);
  // Cliff bands sit between the pre-road field and the corridor: the road
  // then cuts through cliffed ground, and the
  // mask's road suppression keeps the corridor and grade lattice untouched
  // (cliffD is the identity for |u| ≤ CLIFF_ROAD_NEAR = ROAD_CORRIDOR_HALF).
  const cliffed = cliffD(seed, x, z, u, uDz, base, apronKeepD(u, uDz, z));
  // Dunes AFTER cliffs so cliffD reads the exact base it read before this
  // feature existed (its own early-out is base.h < 12, and the dune window is
  // cold above 8, so the two are disjoint either way — this ordering just
  // makes that bit-exact rather than merely true). BEFORE the corridor, so
  // road earthworks still flatten whatever dunes would have been there.
  //
  // This placement does NOT keep dune noise off the grade spline — an
  // earlier version of this comment claimed it did; that was wrong. The
  // spline is immune independent of where duneD is called: latticeHFor
  // samples exactly the road centerline (u = 0), and DUNE_ROAD_NEAR ==
  // ROAD_CORRIDOR_HALF, so duneD's own road-suppression window is already
  // stone cold at u = 0, whatever the call site. See the "keeps duneD out
  // of olympicBaseFrom" guard in olympic.test.ts: it checks the call site
  // textually rather than numerically for exactly this reason — moving
  // duneD into olympicBaseFrom leaves every lattice point in that test's
  // sweep numerically unchanged.
  const duned = duneD(seed, x, z, u, uDz, cliffed);
  let staged = duned;
  if (inBowl(u, z)) {
    // The trailhead pad — bit-identity outside its own small window.
    // Cheaply gated by `inBowl` like every bowl
    // stage: the pad's own disc + fade never reaches the bowl's edge.
    staged = padD(u, uDz, z, padHeightFor(seed), duned);
  }
  // The made features: applied for EVERY point,
  // not only inside `inBowl` — the peak's 300 m dome is centred up to
  // BOWL_U_MAX − TRAIL_GRID_CELL in and can reach past u = 1000, and a
  // straight cut at the bowl's own edge would slice through its skirt.
  // `featureStageD` is its own cheap gate (one distance test per feature,
  // `base` back unchanged outside every disc), and `bowlFor` is memoised per
  // seed, so this costs one map lookup plus a few compares everywhere else in
  // the world.
  const bowl = bowlFor(seed);
  staged = featureStageD(bowl.features, x, z, staged);
  if (inBowl(u, z)) {
    // The trail corridor over every edge: every edge's own grid cell lies
    // inside the bowl, so its corridor never needs to reach past this gate.
    staged = trailCorridorD(bowl.graph.nodes, bowl.graph.edges, x, z, staged);
  }
  if (Math.abs(u) >= ROAD_CORRIDOR_HALF) return staged;
  return corridorD(u, uDz, roadGradeAt(seed, z), staged);
}

/** Absolute distance to the road centerline — the |u| the road math uses. */
function roadDistance(seed: number, x: number, z: number): number {
  const f = coastFrame(seed, z);
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  return Math.abs(x - f.coastlineX - road.dr);
}

/** World x of the road centerline at z — where `roadDistance` is zero. The
 * same two calls `roadDistance` makes, minus the subtraction. A function
 * hook rather than a tunable, so the level id does not move; the renderer
 * bakes it into a 1-D table for per-fragment road paint. */
function roadCenterX(seed: number, z: number): number {
  const f = coastFrame(seed, z);
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  return f.coastlineX + road.dr;
}

registerTerrainVariant({
  name: "olympic",
  tunables: {
    ...DENSE_VARIANT_TUNABLES,
    SEA_LEVEL,
    COAST_X,
    COAST_WARP_WAVELENGTH,
    COAST_WARP_AMPLITUDE,
    COAST_WARP_OCTAVES,
    BLEND_START,
    BLEND_END_BAY,
    BLEND_END_HEADLAND,
    BEACH_GRADE,
    SURF_GRADE,
    GRADE_MORPH,
    SHELF_BREAK_DEPTH,
    FLOOR_DEPTH,
    SHELF_BREAK_WIDTH,
    STACK_BAND_NEAR,
    STACK_BAND_FAR,
    STACK_BAND_FADE,
    STACK_CELL,
    STACK_DENSITY,
    STACK_RADIUS_MIN,
    STACK_RADIUS_MAX,
    STACK_HEIGHT_MIN,
    STACK_HEIGHT_MAX,
    DUNE_AMPLITUDE,
    DUNE_WAVELENGTH_X,
    DUNE_WAVELENGTH_Z,
    DUNE_OCTAVES,
    DUNE_ALT_IN_LO,
    DUNE_ALT_IN_HI,
    DUNE_ALT_OUT_LO,
    DUNE_ALT_OUT_HI,
    DUNE_ROAD_NEAR,
    DUNE_ROAD_FAR,
    DUNE_SALT,
    ROAD_WINDOW_FRACTION,
    ROAD_WOBBLE,
    ROAD_WOBBLE_WAVELENGTH,
    ROAD_WOBBLE_OCTAVES,
    ROAD_SALT,
    ROAD_LATTICE,
    ROAD_BED_HALF,
    ROAD_CORRIDOR_HALF,
    CLIFF_PERIOD,
    CLIFF_BENCH,
    CLIFF_RISER_HALF,
    CLIFF_PHASE_AMP,
    CLIFF_PHASE_WAVELENGTH,
    CLIFF_PHASE_OCTAVES,
    CLIFF_PHASE_SALT,
    CLIFF_ALT_LO,
    CLIFF_ALT_HI,
    CLIFF_MTN_STRENGTH,
    CLIFF_MTN_WAVELENGTH,
    CLIFF_MTN_OCTAVES,
    CLIFF_MTN_LO,
    CLIFF_MTN_HI,
    CLIFF_MTN_SALT,
    CLIFF_OUT_STRENGTH,
    CLIFF_OUT_WAVELENGTH,
    CLIFF_OUT_OCTAVES,
    CLIFF_OUT_LO,
    CLIFF_OUT_HI,
    CLIFF_OUT_ALT_LO,
    CLIFF_OUT_ALT_HI,
    CLIFF_OUT_SALT,
    CLIFF_ROAD_NEAR,
    CLIFF_ROAD_FAR,
    ...BOWL_TUNABLES,
    ...TRAIL_TUNABLES,
    ...LANDMARK_TUNABLES,
    ...FEATURE_TUNABLES,
  },
  waterLevel: SEA_LEVEL,
  coastDistance: signedCoastDistance,
  roadDistance,
  roadCenterX,
  trailDistance: trailDistanceHook,
  trailGraph: trailGraphHook,
  sceneryLandmarks: (seed) => bowlFor(seed).landmarks,
  landmarkMask: landmarkMaskHook,
  featureMask: featureMaskHook,
  sample: olympicSample,
});
