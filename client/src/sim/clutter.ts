/**
 * The ground-clutter fields: nine per-cell jittered scatter grids — grass, rocks, boulders,
 * driftwood, fungus, bushes, meadow carpet, flowers, litter — each a pure point
 * function of (seed, class, cell), the vegetation.ts idiom.
 * Presence is Bernoulli against a biome-keyed density; at most one instance
 * per cell per class. `hash` is a plain [0,1) draw so the RENDERER derives
 * rotation with trig on its side; sim/ emits no angles.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */
import { fbm2, hash3, valueNoise2 } from "./field.js";
import { activeTerrainVariant, elevationSampleAt, type TerrainSample } from "./terrain.js";
import { forestDensity, SLOPE_HI, SLOPE_LO } from "./vegetation.js";
import { NO_FEATURE_MASK, type FeatureMask } from "./features.js";

// ---- Class ids (not tunables) ---------------------------------------------
export const CLUTTER_GRASS = 0;
export const CLUTTER_ROCK = 1;
export const CLUTTER_BOULDER = 2;
export const CLUTTER_DRIFTWOOD = 3;
export const CLUTTER_FUNGUS = 4;
export const CLUTTER_BUSH = 5;
/** Meadow carpet: the under-layer that closes the
 * ground beneath the grass tufts. */
export const CLUTTER_MEADOW = 6;
/** Wildflowers: drift-gated bloom on open ground. */
export const CLUTTER_FLOWER = 7;
/** Litter: pebbles, twigs and torn turf along the trail's loose margin. */
export const CLUTTER_LITTER = 8;
export const CLUTTER_CLASS_COUNT = 9;

// ---- Tunables (every one appears in CLUTTER_TUNABLES) ------------
/** Cell sides (m): at most one instance per cell per class. */
export const CLUTTER_GRASS_CELL = 3;
export const CLUTTER_ROCK_CELL = 9;
export const CLUTTER_BOULDER_CELL = 48;
export const CLUTTER_DRIFT_CELL = 6;
export const CLUTTER_FUNGUS_CELL = 6;
/** Peak instances per square metre where every gate is fully open.
 * Grass sits above the one-per-cell hard cap (1/CELL² ≈ 0.111): presence
 * saturates to ~1 wherever the gates are open, so open fields carry a tuft
 * in essentially every 3 m cell — the "fields always full" tuning,
 * which replaced the launch value 0.08. */
export const CLUTTER_GRASS_D = 0.12;
export const CLUTTER_ROCK_D = 0.012;
export const CLUTTER_BOULDER_D = 0.0002;
export const CLUTTER_DRIFT_D = 0.02;
export const CLUTTER_FUNGUS_D = 0.015;
/** Grass: open lowland. Altitude on above the sand fade, off uphill.
 * HI raised 170 → 200 (the treeline) with the fields-always-full tuning —
 * upland meadows carry grass to where the forest itself gives out. */
export const CLUTTER_GRASS_ALT_LO = 7;
export const CLUTTER_GRASS_ALT_LO_FADE = 4;
export const CLUTTER_GRASS_ALT_HI = 200;
export const CLUTTER_GRASS_ALT_HI_FADE = 30;
/** Grass slope band (rise over run): full below LO, none past HI. Widened
 * 0.35/0.55 → 0.45/0.65 (fields-always-full): rolling field ground keeps
 * its grass; cliff risers (slope ≈ 1+) stay bare as before. */
export const CLUTTER_GRASS_SLOPE_LO = 0.45;
export const CLUTTER_GRASS_SLOPE_HI = 0.65;
/** Grass thins as canopy closes (forestDensity rho band). Raised
 * 0.25/0.6 → 0.4/0.85 (fields-always-full): grass now runs into the
 * forest edge and thins under real canopy instead of stopping at the
 * first scattered tree, so field-to-forest transitions read grown-in. */
export const CLUTTER_GRASS_CANOPY_LO = 0.4;
export const CLUTTER_GRASS_CANOPY_HI = 0.85;
/** Grass returns on the road verge over [NEAR, FAR] of roadDistance (m).
 * NEAR > ROAD_BED_HALF (5.5): asphalt and shoulders stay bare. */
export const CLUTTER_GRASS_ROAD_NEAR = 7.5;
export const CLUTTER_GRASS_ROAD_FAR = 13.5;
/** Grass (and every class sharing its gate) is 0 over the bench — the
 * 0.9 m core plus its 0.3 m loose margin (TRAIL_BED_HALF = 0.75) — and returns
 * over [NEAR, FAR] of trailDistance (m): thin through the band the renderer
 * tramples, full from 2.5 m. Rocks and boulders are NOT gated: a stone on
 * the bench reads as a stone in the path. */
export const CLUTTER_GRASS_TRAIL_NEAR = 0.75;
export const CLUTTER_GRASS_TRAIL_FAR = 2.5;
/** Meadow patchiness. The launch window (0.35–0.65) carved visible bare
 * swathes; under the fields-always-full tuning it is nearly wide open
 * (0.10–0.30) — the noise now only feathers density at the low tail, so a
 * field reads as continuous cover with soft variation instead of patches. */
export const CLUTTER_GRASS_PATCH_WAVELENGTH = 60;
export const CLUTTER_GRASS_PATCH_OCTAVES = 2;
export const CLUTTER_GRASS_PATCH_LO = 0.1;
export const CLUTTER_GRASS_PATCH_HI = 0.3;
/** The canopy ramp bottoms here, not at zero: the forest floor keeps half
 * its sward under the densest canopy, and the litter fills the rest. */
export const CLUTTER_GRASS_CANOPY_FLOOR = 0.5;
/** The patch noise modulates between this and 1 instead of gating: grass
 * is everywhere the floor is grass, with the meadow-shaped variation kept. */
export const CLUTTER_GRASS_PATCH_FLOOR = 0.6;
/** Interior density multiplier, engaged only where every edge ramp is near 1. */
export const CLUTTER_GRASS_BOOST = 1.5;
/** The edge product at which the boost starts rising toward its full value at 1. */
export const CLUTTER_GRASS_BOOST_LO = 0.5;
/** Duff in thin OPEN grass, as a share of the duff under full canopy. */
export const CLUTTER_DUFF_OPEN = 0.15;
/** Duff clears the road over this many metres inside the grass's own road edge. */
export const CLUTTER_DUFF_ROAD_CLEAR = 2;
/** The bed's core (m from the centreline) never opens to grass, so the
 * path always reads however far the margins are overgrown. */
export const CLUTTER_GRASS_TRAIL_CORE = 0.35;
/** The trail ramp's reach varies along the trail between these multiples
 * of its default, by a value noise of this wavelength (m): in places grass
 * creeps across the margin and stands in islands, elsewhere it hangs back. */
export const CLUTTER_GRASS_TRAIL_REACH_LO = 0.35;
export const CLUTTER_GRASS_TRAIL_REACH_HI = 1.3;
export const CLUTTER_GRASS_TRAIL_REACH: readonly [number, number] = [CLUTTER_GRASS_TRAIL_REACH_LO, CLUTTER_GRASS_TRAIL_REACH_HI];
export const CLUTTER_GRASS_TRAIL_REACH_WAVE = 9;
/** Duff on the bed: at most this, gathered where the drift noise is inside
 * its band, fading out this far past the bed's edge. */
export const CLUTTER_DUFF_BED_MAX = 0.8;
export const CLUTTER_DUFF_BED_FADE = 0.5;
export const CLUTTER_DUFF_DRIFT_WAVE = 6;
export const CLUTTER_DUFF_DRIFT_LO = 0.35;
export const CLUTTER_DUFF_DRIFT_HI = 0.65;
export const CLUTTER_DUFF_DRIFT_BAND: readonly [number, number] = [CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI];
/** DECLARED, the CLUTTER_MEADOW_SALT convention: a salt change reshuffles
 * every drift, and peers running different shuffles must refuse each other. */
export const CLUTTER_TRAIL_REACH_SALT = 0x5a17;
export const CLUTTER_DUFF_DRIFT_SALT = 0x6d1f;

export type GroundCover = { grass: number; duff: number };

/** The trail ramp's reach at a point, in [REACH_LO, REACH_HI]: continuous, so the grass it gates is too. */
export function trailReach(seed: number, x: number, z: number): number {
  const n = valueNoise2(x / CLUTTER_GRASS_TRAIL_REACH_WAVE, z / CLUTTER_GRASS_TRAIL_REACH_WAVE, seed ^ CLUTTER_TRAIL_REACH_SALT);
  return CLUTTER_GRASS_TRAIL_REACH_LO + (CLUTTER_GRASS_TRAIL_REACH_HI - CLUTTER_GRASS_TRAIL_REACH_LO) * n;
}

/** The grass trail ramp at reach scale `k`: closed inside the core, open
 * past `near + (FAR − NEAR)·k`, where `near` is the core plus `k` times the
 * default margin. `grassTrailGate(rt)` is this ramp at k = 1. */
export function grassTrailRamp(rt: number, k: number): number {
  const near = CLUTTER_GRASS_TRAIL_CORE + (CLUTTER_GRASS_TRAIL_NEAR - CLUTTER_GRASS_TRAIL_CORE) * k;
  const far = near + (CLUTTER_GRASS_TRAIL_FAR - CLUTTER_GRASS_TRAIL_NEAR) * k;
  return smoothstep(near, far, rt);
}

/** Where litter gathers on the bed: a value noise in [0, 1] the duff reads. */
export function trailDriftNoise(seed: number, x: number, z: number): number {
  return valueNoise2(x / CLUTTER_DUFF_DRIFT_WAVE, z / CLUTTER_DUFF_DRIFT_WAVE, seed ^ CLUTTER_DUFF_DRIFT_SALT);
}

/** Rocks: everywhere above the sand, keener on slopes and altitude. */
export const CLUTTER_ROCK_ALT_LO = 7;
export const CLUTTER_ROCK_ALT_LO_FADE = 4;
export const CLUTTER_ROCK_SLOPE_LO = 0.15;
export const CLUTTER_ROCK_SLOPE_HI = 0.6;
/** Density floor on flat ground: flat = BASE, steep = 1. */
export const CLUTTER_ROCK_BASE = 0.4;
/** Rocks return over [NEAR, FAR] of roadDistance (m). The gate is evaluated
 * at the CELL centre, but jitter can carry an instance up to
 * √2·(CLUTTER_JITTER/2)·CLUTTER_ROCK_CELL ≈ 4.46 m off that centre, so the
 * derived instance floor is NEAR − 4.46, not NEAR itself. NEAR must clear
 * ROAD_BED_HALF (5.5) + 4.46 ≈ 9.96 for that floor to keep every jittered
 * rock off the bed — the derived-floor argument, not just the cell-centre
 * gate. NEAR = 10 clears it (floor ≈ 5.55 > 5.5). */
export const CLUTTER_ROCK_ROAD_NEAR = 10;
export const CLUTTER_ROCK_ROAD_FAR = 13;
/** Boulders: steep high ground; talus on and below the cliff bands. */
export const CLUTTER_BOULDER_ALT_LO = 30;
export const CLUTTER_BOULDER_ALT_HI = 120;
export const CLUTTER_BOULDER_SLOPE_LO = 0.35;
export const CLUTTER_BOULDER_SLOPE_HI = 0.8;
/** Suppressed across the whole corridor (= ROAD_CORRIDOR_HALF; retune together). */
export const CLUTTER_BOULDER_ROAD_NEAR = 30;
export const CLUTTER_BOULDER_ROAD_FAR = 60;
/** Boulders are rejected at the jittered INSTANCE within this trailDistance
 * (m). Boulders are the ONLY clutter class
 * that collides (`passes/clutter.ts`'s own docstring: "rocks, grass,
 * driftwood, fungus — is set dressing you walk through"), on the assumption
 * that the bed's own flattened slope keeps `boulderDensityUnmasked`'s slope
 * gate (CLUTTER_BOULDER_SLOPE_LO 0.35) at zero right where a boulder would
 * block the tread. Found over the 227-seed sweep: a boulder 0.52 m off a stem
 * centreline (seed 24301, edge 27->28, the last edge before the crest — the
 * peak's own steep, rocky ground is exactly where this class is keenest)
 * stood 0.57 m tall — over STEP_HEIGHT (0.5, constants.ts) — and the walk
 * gate could not cross it; the flattened bed evidently does not reach zero
 * slope that close to its own edge. The largest collider (`boulder_b`,
 * passes/clutter.ts: half-extent 1.239 m at scale 1) at CLUTTER_BOULDER_SCALE_MAX
 * (1.39) reaches 1.72 m from its own centre; 4 clears that plus the bed's own
 * half-width (TRAIL_BED_HALF 0.75) with margin, well inside the corridor's outer
 * edge (TRAIL_CORRIDOR_HALF 7) where a boulder still reads as a talus field
 * beside the trail. Mirrors CLUTTER_FUNGUS_TRAIL_CLEAR's own fix for a stump
 * found the same way. */
export const CLUTTER_BOULDER_TRAIL_CLEAR = 4;
/** Driftwood: the wet-sand shelf, near the coastline only. */
export const CLUTTER_DRIFT_ALT_LO = 1;
export const CLUTTER_DRIFT_ALT_LO_FADE = 1;
export const CLUTTER_DRIFT_ALT_HI = 5;
export const CLUTTER_DRIFT_ALT_HI_FADE = 2;
export const CLUTTER_DRIFT_INLAND = 25;
export const CLUTTER_DRIFT_INLAND_FADE = 15;
/** Fungus: under the canopy (forestDensity rho band), above the sand. */
export const CLUTTER_FUNGUS_CANOPY_LO = 0.35;
export const CLUTTER_FUNGUS_CANOPY_HI = 0.7;
/** Fungus (the mushroom cluster AND the cut stump, the class's two models)
 * is rejected at the jittered INSTANCE within this trailDistance (m): the
 * floor is the wear- and junction-widened bench, not the bare sim step —
 * TRAIL_BED_HALF · TRAIL_WEAR_W1 · TRAIL_JUNCTION_W = 0.75 · 1.25 · 1.35 ≈
 * 1.27 m — plus the largest stump's half-width (0.28 × 1.3 ≈ 0.36) and a
 * ≈ 0.5 m step of clear ground beyond it, ≈ 2.13 m in all, which 2.5 clears
 * with margin. A cell-centre gate cannot do it — the 6 m cell's jitter
 * reaches 2.97 m — and a stump standing in the bed was found on 2026-09-10.
 * Rocks stay ungated (a few on the bed read as gravel). */
export const CLUTTER_FUNGUS_TRAIL_CLEAR = 2.5;
/** Fungus is forest floor: it closes over the same slope band as the trees
 * (SLOPE_LO..SLOPE_HI, vegetation.ts), which is also where the ground's own
 * class turns to rock. Declared here under the clutter names so the level-id
 * registry sees them, but taken by reference so the three cannot drift. */
export const CLUTTER_FUNGUS_SLOPE_LO = SLOPE_LO;
export const CLUTTER_FUNGUS_SLOPE_HI = SLOPE_HI;
/** Bushes: mid-height cover everywhere, densest
 * under and around the forest. The habitat weight is a pure function of
 * forestDensity ρ — field floor + edge band + canopy term — so forest EDGE
 * needs no gradient sampling: it is simply intermediate ρ. */
export const CLUTTER_BUSH_CELL = 4;
/** Above the one-per-cell cap (1/16 = 0.0625/m²): cells saturate wherever the
 * habitat weight ≈ 1 — the grass convention. */
export const CLUTTER_BUSH_D = 0.07;
export const CLUTTER_BUSH_FIELD_W = 0.1;
export const CLUTTER_BUSH_EDGE_W = 1;
export const CLUTTER_BUSH_EDGE_ON_LO = 0.03;
export const CLUTTER_BUSH_EDGE_ON_HI = 0.1;
export const CLUTTER_BUSH_EDGE_OFF_LO = 0.4;
export const CLUTTER_BUSH_EDGE_OFF_HI = 0.6;
export const CLUTTER_BUSH_CANOPY_W = 0.85;
export const CLUTTER_BUSH_CANOPY_LO = 0.3;
export const CLUTTER_BUSH_CANOPY_HI = 0.7;
export const CLUTTER_BUSH_ALT_LO = 7;
export const CLUTTER_BUSH_ALT_LO_FADE = 4;
export const CLUTTER_BUSH_ALT_HI = 200;
export const CLUTTER_BUSH_ALT_HI_FADE = 30;
export const CLUTTER_BUSH_SLOPE_LO = 0.5;
export const CLUTTER_BUSH_SLOPE_HI = 0.7;
/** NEAR is gated at the CELL centre; jitter can carry an instance
 * √2·(CLUTTER_JITTER/2)·CLUTTER_BUSH_CELL ≈ 1.98 m off it, so the derived
 * instance floor is 8.5 − 1.98 ≈ 6.5 m > ROAD_BED_HALF (5.5) — the
 * derived-floor argument (the ROCK precedent above). */
export const CLUTTER_BUSH_ROAD_NEAR = 8.5;
export const CLUTTER_BUSH_ROAD_FAR = 14;
export const CLUTTER_BUSH_PATCH_WAVELENGTH = 45;
export const CLUTTER_BUSH_PATCH_OCTAVES = 2;
/** The patch FLOOR is the point: noise varies
 * bush cover but never empties it. */
export const CLUTTER_BUSH_PATCH_FLOOR = 0.5;
export const CLUTTER_BUSH_PATCH_LO = 0.35;
export const CLUTTER_BUSH_PATCH_HI = 0.65;
/** Meadow carpet: the coverage lattice. One clump per
 * 0.7 m cell at saturation ≈ 2.0/m², which with a ~0.5 m clump footprint closes
 * the ground inside the class radius. Gates are the ground-cover field's
 * `grass` reading verbatim — shared code, not a copy, so the two classes
 * cannot drift. */
export const CLUTTER_MEADOW_CELL = 0.7;
/** 0.49 · 2.05 > 1: presence saturates wherever the (shared grass) gates are
 * open — the gates shape the field, not D. The grass-class convention. */
export const CLUTTER_MEADOW_D = 2.05;
export const CLUTTER_MEADOW_SALT = 0x3ead;
/** Flowers: grass gates verbatim, gated further by a
 * low-frequency drift mask so blooms come in patches on roughly a quarter to
 * a third of open ground, not as a uniform sprinkle (see
 * CLUTTER_FLOWER_PATCH_LO/HI for the calibration; a drift-width sanity check
 * against an 8-20 m target —
 * measured widths at WAVELENGTH = 30 run somewhat wider, median ≈ 25 m). */
export const CLUTTER_FLOWER_CELL = 1.5;
/** Retune: flower density — at D = 0.25, in-drift presence was only min(1, 2.25 · 0.25) ≈ 0.56 per
 * 1.5 m cell — blooms vanished between taller grass tufts at eye level,
 * not dense enough to read as a patch. Raised so presence
 * saturates: min(1, 2.25 · 0.5) ≈ 1 wherever the drift gate is fully open
 * (one bloom per 1.5 m cell — the patch reads), feathering out with the
 * drift edge exactly as before (D only scales presence, never the gate
 * shape). The clutterField hard one-per-cell ceiling
 * π·(35 + 0.74)²/1.5² ≈ 1,784 is unchanged by D and still binds — the
 * mean-density ceiling π·35²·0.5 ≈ 1,924 now exceeds it, so the hard
 * ceiling is the binding budget, matching the grass/meadow saturated-
 * presence convention (both already sit above their own one-per-cell cap). */
export const CLUTTER_FLOWER_D = 0.5;
export const CLUTTER_FLOWER_PATCH_WAVELENGTH = 30;
export const CLUTTER_FLOWER_PATCH_OCTAVES = 2;
/** Flower patch-threshold retune: the
 * original LO/HI (0.55/0.7) were calibrated against an assumed
 * n01 ∈ [0, 1) range, but n01 = 0.5 + 0.5·fbm2(...) is actually confined to
 * [0.5, 1) (fbm2 is a convex combination of hashed lattice values, each in
 * [0, 1) — the same property "confirms the patch noise floor" already pins
 * for the bush census) — so 0.55 sat only just above fbm2's real floor and
 * gated almost nothing out (measured 99.7% "bloomed" on open ground, far
 * short of the roughly-quarter-to-a-third target).
 *
 * Re-measured the ACTUAL n01 distribution over a 2D open-ground sweep
 * (x/z ∈ [-20000, 20000], 55480 samples, filtered to clutterDensity(GRASS) >
 * 0.5 — the census's own "open ground" definition; 5705 open-ground samples):
 *   p0 0.511  p10 0.644  p25 0.690  p50 0.748  p75 0.810  p90 0.856
 *   p95 0.879  p99 0.920  p100 0.984   (mean 0.749)
 * Chose LO at ≈p75 so P(n01 > LO) ≈ 0.28 (bloomed fraction near the middle
 * of the quarter-to-a-third target), HI = LO + 0.10 for a feathered
 * edge (a wider percentile span than the original 0.55→0.7 intended, so the
 * transition reads softer, not harder). Verified against the EXACT census
 * sweep (clutter.test.ts's own 4000-point loop, condition grass > 0.5):
 * openGround = 772, inDrift (flower > 0) = 216, fraction = 0.27979 — inside
 * [0.25, 0.333], the quarter-to-a-third target band. */
export const CLUTTER_FLOWER_PATCH_LO = 0.81;
export const CLUTTER_FLOWER_PATCH_HI = 0.91;
export const CLUTTER_FLOWER_SALT = 0xf10a;
/** Decorrelates flower drifts from the grass/bush patch noise (both keyed on
 * CLUTTER_PATCH_SALT) — otherwise flower blooms would land in lockstep with
 * grass's own patchiness instead of forming their own, independent drifts. */
export const CLUTTER_FLOWER_PATCH_SALT = 0xdf17;
/** Natural-size re-derivation: the shipped
 * bush_a mesh (client/assets/models/clutter.bush_a.glb, LOD0) measures
 * 1.919 m tall (via getBounds()), bush_b 1.522 m —
 * bush_a is the larger variant, so it sets the range (neither variant may
 * overshoot the 0.8–2.0 m band). scaleMin = 0.8 / 1.919 = 0.41688 → 0.42;
 * scaleMax = 2.0 / 1.919 = 1.04221 → 1.04. (Was 2.03–5.08, derived against
 * the old, much-shorter mesh — bush_a is now close to
 * natural size, so the factor sits near 1 instead of blowing the mesh up
 * 2-5×.) */
export const CLUTTER_BUSH_SCALE_MIN = 0.42;
export const CLUTTER_BUSH_SCALE_MAX = 1.04;
export const CLUTTER_BUSH_SALT = 0xb5a1;
/** Scale ranges per class, re-derived from the shipped meshes
 * (client/assets/models/clutter.*.glb) against real-world size bands. Formula:
 * scaleMin = bandMin / meshSize, scaleMax = bandMax / meshSize, where
 * meshSize is the LARGER of the two variants' relevant dimension (so neither
 * variant overshoots its band), rounded to two decimals. Fungus is
 * unchanged — it keeps its original simple mesh.
 *
 * Grass — height (y): shipped grass_a 0.323 m, grass_b 0.403 m (larger).
 * Band narrowed to 0.3–0.6 m (knee height): scaleMin = 0.3 / 0.403 = 0.74442 → 0.74; scaleMax =
 * 0.6 / 0.403 = 1.48883 → 1.49. */
export const CLUTTER_GRASS_SCALE_MIN = 0.74;
export const CLUTTER_GRASS_SCALE_MAX = 1.49;
/** Meadow carpet — height (y): the shipped clump (LOD0, all 10 authored cards)
 * measures 0.421 m tall, with card bases sunk ~0.076 m below y = 0 so the cut
 * edge hides in the ground — thus visible above-ground tips run ≈0.20–0.37 m.
 * The scale is derived against the full MEASURED 0.421 m (not the 0.25–0.45 m
 * nominal band, which corresponds to rendered visible height under this sink).
 * Band 0.25–0.45 m (under the grass tips —
 * the carpet is the under-layer): scaleMin = 0.25 / 0.421 = 0.59382 → 0.59;
 * scaleMax = 0.45 / 0.421 = 1.06888 → 1.07. Scale-min is the recorded lever if
 * the carpet needs more rendered height. */
export const CLUTTER_MEADOW_SCALE_MIN = 0.59;
export const CLUTTER_MEADOW_SCALE_MAX = 1.07;
/** Rock — max(x, z): rock_a max(0.168, 0.319) = 0.319 (larger), rock_b
 * max(0.111, 0.112) = 0.112. Band 0.3–1.0 m. scaleMin = 0.3 / 0.319 =
 * 0.9404 → 0.94; scaleMax = 1.0 / 0.319 = 3.1348 → 3.13. */
export const CLUTTER_ROCK_SCALE_MIN = 0.94;
export const CLUTTER_ROCK_SCALE_MAX = 3.13;
/** Boulder — max(x, z): boulder_a max(1.268, 1.829) = 1.829, boulder_b
 * max(2.516, 2.480) = 2.516 (larger — the current boulder_b mesh, still
 * the bigger of the two). Band 1.5–3.5 m. scaleMin = 1.5 / 2.516 = 0.5962 →
 * 0.60; scaleMax = 3.5 / 2.516 = 1.3911 → 1.39 — unchanged from the previous
 * mesh (2.516 vs. 2.514 rounds to the same two-decimal scale factors), so
 * the range still puts both variants in the band; see
 * passes/clutter.ts for what each variant's own collider now derives from
 * this range. */
export const CLUTTER_BOULDER_SCALE_MIN = 0.6;
export const CLUTTER_BOULDER_SCALE_MAX = 1.39;
/** Driftwood — max(x, y, z): the single shipped variant measures
 * max(0.145, 0.097, 0.571) = 0.571 m (its longest extent, along z). Band
 * 0.8–2.5 m. scaleMin = 0.8 / 0.571 = 1.4011 → 1.40; scaleMax =
 * 2.5 / 0.571 = 4.3783 → 4.38. */
export const CLUTTER_DRIFT_SCALE_MIN = 1.4;
export const CLUTTER_DRIFT_SCALE_MAX = 4.38;
/** Flower — height (y): shipped flower_a 0.165 m, flower_b (celandine) 0.186 m
 * (larger). Band 0.15–0.30 m: scaleMin = 0.15 / 0.186 = 0.80645 → 0.81; scaleMax = 0.30 / 0.186 =
 * 1.61290 → 1.61. */
export const CLUTTER_FLOWER_SCALE_MIN = 0.81;
export const CLUTTER_FLOWER_SCALE_MAX = 1.61;
/** Litter lives on a 1 m cell along the trail: a few proud stones on the
 * compacted core, the most over the loose margin and its lip, gone by
 * CLUTTER_LITTER_FADE. D = 0.9 puts about one piece per 1.1 m per side on
 * the margin (presence = min(1, band · 1 · D) per cell). */
export const CLUTTER_LITTER_CELL = 1;
export const CLUTTER_LITTER_D = 0.9;
export const CLUTTER_LITTER_CORE = 0.15;
export const CLUTTER_LITTER_MARGIN_LO = 0.45;
export const CLUTTER_LITTER_MARGIN_HI = 0.9;
export const CLUTTER_LITTER_FADE = 1.6;
/** Of the model's own unit: rock_a/rock_b at this scale are pebbles; the
 * renderer scales the driftwood variant further to twig size. */
export const CLUTTER_LITTER_SCALE_MIN = 0.25;
export const CLUTTER_LITTER_SCALE_MAX = 0.6;
export const CLUTTER_LITTER_SALT = 0x1177;

/** The litter density's band of the trail distance, pure. */
export function litterBand(rt: number): number {
  if (rt < CLUTTER_LITTER_MARGIN_LO) return CLUTTER_LITTER_CORE;
  if (rt < CLUTTER_LITTER_MARGIN_HI) return 1;
  return 1 - smoothstep(CLUTTER_LITTER_MARGIN_HI, CLUTTER_LITTER_FADE, rt);
}
/** Fungus keeps its original simple mesh — NOT
 * part of the scale re-derivation above. */
export const CLUTTER_FUNGUS_SCALE_MIN = 0.8;
export const CLUTTER_FUNGUS_SCALE_MAX = 1.3;
/** Fraction of the cell the jitter may roam (the JITTER_SPAN convention). */
export const CLUTTER_JITTER = 0.7;
/** Per-class hash salts. DECLARED (unlike vegetation's private salts, the
 * cliffs precedent): a salt change reshuffles every instance, and peers
 * running different shuffles must refuse each other — registryDigest only
 * sees what is declared. */
export const CLUTTER_GRASS_SALT = 0x9a55;
export const CLUTTER_ROCK_SALT = 0x70c4;
export const CLUTTER_BOULDER_SALT = 0xb01d;
export const CLUTTER_DRIFT_SALT = 0xd21f;
export const CLUTTER_FUNGUS_SALT = 0xf069;
export const CLUTTER_PATCH_SALT = 0x6a44;

/** Value-only cubic smoothstep, clamped — the vegetation.ts local copy. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/** How far up the rock class's slope band a squared gradient `dx² + dz²`
 * stands: 0 at `CLUTTER_ROCK_SLOPE_LO` and below, 1 at `CLUTTER_ROCK_SLOPE_HI`
 * and above, a smoothstep between. The rock props scale their density by it
 * (over the `CLUTTER_ROCK_BASE` floor), and the cliff modules read it as the
 * rock their ground needs (`cliffField.ts`), so the two stand on one band. */
export function rockSlopeBand(slopeSq: number): number {
  return smoothstep(CLUTTER_ROCK_SLOPE_LO * CLUTTER_ROCK_SLOPE_LO, CLUTTER_ROCK_SLOPE_HI * CLUTTER_ROCK_SLOPE_HI, slopeSq);
}

/** The trail factor of the grass gate, pure: 0 on the bed, 1 from FAR out and
 * for Infinity (outside the bowl, or a variant without a trail). */
export function grassTrailGate(rt: number): number {
  return grassTrailRamp(rt, 1);
}

type ClassConfig = {
  cell: number;
  density: number;
  salt: number;
  scaleMin: number;
  scaleMax: number;
  /** How many models the renderer picks between for this class. */
  variants: number;
  /** Reject the jittered instance within this trailDistance (m); 0 = ungated. */
  trailClear: number;
};

const CLASSES: readonly ClassConfig[] = [
  { cell: CLUTTER_GRASS_CELL, density: CLUTTER_GRASS_D, salt: CLUTTER_GRASS_SALT, scaleMin: CLUTTER_GRASS_SCALE_MIN, scaleMax: CLUTTER_GRASS_SCALE_MAX, variants: 2, trailClear: 0 },
  { cell: CLUTTER_ROCK_CELL, density: CLUTTER_ROCK_D, salt: CLUTTER_ROCK_SALT, scaleMin: CLUTTER_ROCK_SCALE_MIN, scaleMax: CLUTTER_ROCK_SCALE_MAX, variants: 2, trailClear: 0 },
  { cell: CLUTTER_BOULDER_CELL, density: CLUTTER_BOULDER_D, salt: CLUTTER_BOULDER_SALT, scaleMin: CLUTTER_BOULDER_SCALE_MIN, scaleMax: CLUTTER_BOULDER_SCALE_MAX, variants: 2, trailClear: CLUTTER_BOULDER_TRAIL_CLEAR },
  { cell: CLUTTER_DRIFT_CELL, density: CLUTTER_DRIFT_D, salt: CLUTTER_DRIFT_SALT, scaleMin: CLUTTER_DRIFT_SCALE_MIN, scaleMax: CLUTTER_DRIFT_SCALE_MAX, variants: 1, trailClear: 0 },
  { cell: CLUTTER_FUNGUS_CELL, density: CLUTTER_FUNGUS_D, salt: CLUTTER_FUNGUS_SALT, scaleMin: CLUTTER_FUNGUS_SCALE_MIN, scaleMax: CLUTTER_FUNGUS_SCALE_MAX, variants: 2, trailClear: CLUTTER_FUNGUS_TRAIL_CLEAR },
  { cell: CLUTTER_BUSH_CELL, density: CLUTTER_BUSH_D, salt: CLUTTER_BUSH_SALT, scaleMin: CLUTTER_BUSH_SCALE_MIN, scaleMax: CLUTTER_BUSH_SCALE_MAX, variants: 2, trailClear: 0 },
  { cell: CLUTTER_MEADOW_CELL, density: CLUTTER_MEADOW_D, salt: CLUTTER_MEADOW_SALT, scaleMin: CLUTTER_MEADOW_SCALE_MIN, scaleMax: CLUTTER_MEADOW_SCALE_MAX, variants: 1, trailClear: 0 },
  { cell: CLUTTER_FLOWER_CELL, density: CLUTTER_FLOWER_D, salt: CLUTTER_FLOWER_SALT, scaleMin: CLUTTER_FLOWER_SCALE_MIN, scaleMax: CLUTTER_FLOWER_SCALE_MAX, variants: 2, trailClear: 0 },
  { cell: CLUTTER_LITTER_CELL, density: CLUTTER_LITTER_D, salt: CLUTTER_LITTER_SALT, scaleMin: CLUTTER_LITTER_SCALE_MIN, scaleMax: CLUTTER_LITTER_SCALE_MAX, variants: 3, trailClear: 0 },
];

export function clutterCell(cls: number): number {
  return (CLASSES[cls] as ClassConfig).cell;
}

/** The ground-cover field at a point: `grass` in [0, CLUTTER_GRASS_BOOST],
 * `duff` in [0, 1] — dead leaves, twigs and branches wherever grass thins on
 * grass ground. Every factor is a smoothstep of a continuous field, so both
 * numbers are continuous; nothing decides per cell. `fm.clutter` is the
 * trail-system feature mask (a pond's shore, the peak's crest): it is the
 * LAST factor applied to both outputs, so a caller that needs its own
 * factors (meadow's density bonus, flower's drift) interposed between the
 * raw field and the mask — in the exact order it already multiplied them in
 * — must apply `fm.clutter` itself and pass `NO_FEATURE_MASK` here instead,
 * rather than let this function fold the mask in earlier than that order
 * allows. */
function groundCoverAt(seed: number, x: number, z: number, s: TerrainSample, r: number, rt: number, slopeSq: number, fm: FeatureMask): GroundCover {
  const alt =
    smoothstep(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h) *
    (1 - smoothstep(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
  const grade = 1 - smoothstep(
    CLUTTER_GRASS_SLOPE_LO * CLUTTER_GRASS_SLOPE_LO,
    CLUTTER_GRASS_SLOPE_HI * CLUTTER_GRASS_SLOPE_HI,
    slopeSq,
  );
  const onGrass = alt * grade;
  if (onGrass === 0) return { grass: 0, duff: 0 };
  const rho = forestDensity(seed, x, z, s);
  const shade = smoothstep(CLUTTER_GRASS_CANOPY_LO, CLUTTER_GRASS_CANOPY_HI, rho);
  const canopy = CLUTTER_GRASS_CANOPY_FLOOR + (1 - CLUTTER_GRASS_CANOPY_FLOOR) * (1 - shade);
  const road = smoothstep(CLUTTER_GRASS_ROAD_NEAR, CLUTTER_GRASS_ROAD_FAR, r);
  // The ramp's reach varies along the trail (encroachment); the core never opens.
  const trail = grassTrailRamp(rt, trailReach(seed, x, z));
  const patch = CLUTTER_GRASS_PATCH_FLOOR + (1 - CLUTTER_GRASS_PATCH_FLOOR) * smoothstep(
    CLUTTER_GRASS_PATCH_LO,
    CLUTTER_GRASS_PATCH_HI,
    0.5 + 0.5 * fbm2(x / CLUTTER_GRASS_PATCH_WAVELENGTH, z / CLUTTER_GRASS_PATCH_WAVELENGTH, seed ^ CLUTTER_PATCH_SALT, CLUTTER_GRASS_PATCH_OCTAVES),
  );
  const edge = onGrass * canopy * road * trail;
  const boost = 1 + (CLUTTER_GRASS_BOOST - 1) * smoothstep(CLUTTER_GRASS_BOOST_LO, 1, edge);
  const grass = edge * patch * boost;
  // Duff fills what the thinning takes: strongest under dense canopy, a
  // trace in thin open grass, and clear of the asphalt, which is painted by
  // its own system. Inside the core only the bed's own drift shows — the
  // path stays readable — so the floor term ramps in from the core out to
  // the bed's near edge, not from zero: past CORE it climbs while `onBed`
  // (the same [NEAR, NEAR+FADE] ramp the bed drift fades out over) is still
  // fully open, so the two terms genuinely overlap on the margin
  // (rt ∈ (CORE, NEAR+FADE)) and `max` is what keeps the handoff continuous
  // and bounded — never a bare band between "only drift" and "only floor".
  const road2 = smoothstep(CLUTTER_GRASS_ROAD_NEAR - CLUTTER_DUFF_ROAD_CLEAR, CLUTTER_GRASS_ROAD_NEAR, r);
  const onBed = 1 - smoothstep(CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_NEAR + CLUTTER_DUFF_BED_FADE, rt);
  const offCore = smoothstep(CLUTTER_GRASS_TRAIL_CORE, CLUTTER_GRASS_TRAIL_NEAR, rt);
  const floorDuff = onGrass * Math.max(0, 1 - grass / CLUTTER_GRASS_BOOST) * (CLUTTER_DUFF_OPEN + (1 - CLUTTER_DUFF_OPEN) * shade) * offCore * road2;
  const drift = smoothstep(CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI, trailDriftNoise(seed, x, z));
  const bedDuff = onGrass * onBed * drift * CLUTTER_DUFF_BED_MAX * road2;
  return { grass: grass * fm.clutter, duff: Math.max(floorDuff, bedDuff) * fm.clutter };
}

export function groundCover(seed: number, x: number, z: number, sample?: TerrainSample): GroundCover {
  const variant = activeTerrainVariant();
  const s = sample ?? variant.sample(seed, x, z);
  const r = variant.roadDistance?.(seed, x, z) ?? Infinity;
  const rt = variant.trailDistance?.(seed, x, z) ?? Infinity;
  const fm = variant.featureMask?.(seed, x, z, s.h) ?? NO_FEATURE_MASK;
  return groundCoverAt(seed, x, z, s, r, rt, s.dx * s.dx + s.dz * s.dz, fm);
}

/**
 * Gate product for class `cls` at a point (a composed smoothstep chain) —
 * not itself a presence probability. In [0, 1] for every class except
 * `CLUTTER_GRASS`, `CLUTTER_MEADOW` and `CLUTTER_FLOWER`, which read the
 * ground-cover field's `grass` (in [0, CLUTTER_GRASS_BOOST], already carrying
 * the feature mask's own `fm.clutter` — see `groundCoverAt`) and, for meadow
 * and flower, carry a further `(1 + fm.meadow)` inside a made meadow's flat
 * — up to roughly `2 · CLUTTER_GRASS_BOOST` there. `clutterInCell`
 * turns it into a probability via `min(1, gateProduct · CELL² · D_class)`, where
 * `D_class` is the per-class `cfg.density` (the per-m² peak-density
 * tunable). When `sample` is provided it is trusted (tests pass synthetic
 * ground); otherwise the active variant is sampled here. Variants without a
 * coast or road report Infinity, which saturates those gates open (no road
 * to avoid) and shuts driftwood off — the forestDensity convention.
 */
export function clutterDensity(seed: number, cls: number, x: number, z: number, sample?: TerrainSample): number {
  const variant = activeTerrainVariant();
  const s = sample ?? variant.sample(seed, x, z);
  const r = variant.roadDistance?.(seed, x, z) ?? Infinity;
  const c = variant.coastDistance?.(seed, x, z) ?? Infinity;
  const rt = variant.trailDistance?.(seed, x, z) ?? Infinity;
  const slopeSq = s.dx * s.dx + s.dz * s.dz;
  // The trail-system feature mask, read once: bare ground (a pond's
  // shore, the peak's crest) and a meadow's denser carpet and flowers. Rocks,
  // boulders and driftwood are untouched — they read the landmark mask
  // instead (CLUTTER_BOULDER below), or nothing at all.
  const fm = variant.featureMask?.(seed, x, z, s.h) ?? NO_FEATURE_MASK;
  switch (cls) {
    case CLUTTER_GRASS:
      // The field applies fm.clutter itself now (it is the class's only
      // factor beyond the field), so this no longer multiplies by it again.
      return groundCoverAt(seed, x, z, s, r, rt, slopeSq, fm).grass;
    case CLUTTER_ROCK: {
      if (s.h < CLUTTER_ROCK_ALT_LO || r < CLUTTER_ROCK_ROAD_NEAR) return 0;
      const alt = smoothstep(CLUTTER_ROCK_ALT_LO, CLUTTER_ROCK_ALT_LO + CLUTTER_ROCK_ALT_LO_FADE, s.h);
      const grade = CLUTTER_ROCK_BASE + (1 - CLUTTER_ROCK_BASE) * rockSlopeBand(slopeSq);
      const road = smoothstep(CLUTTER_ROCK_ROAD_NEAR, CLUTTER_ROCK_ROAD_FAR, r);
      return alt * grade * road;
    }
    case CLUTTER_BOULDER: {
      const raw = boulderDensityRaw(seed, x, z, s);
      const mask = variant.landmarkMask?.(seed, x, z);
      if (mask === undefined) return raw;
      // See forestDensity: the floor is what lets a CARVED talus exist on ground
      // the slope gate would leave bare.
      return Math.min(1, Math.max(raw * mask.boulder, mask.boulderFloor));
    }
    case CLUTTER_DRIFTWOOD: {
      if (c > CLUTTER_DRIFT_INLAND + CLUTTER_DRIFT_INLAND_FADE) return 0;
      const alt =
        smoothstep(CLUTTER_DRIFT_ALT_LO, CLUTTER_DRIFT_ALT_LO + CLUTTER_DRIFT_ALT_LO_FADE, s.h) *
        (1 - smoothstep(CLUTTER_DRIFT_ALT_HI, CLUTTER_DRIFT_ALT_HI + CLUTTER_DRIFT_ALT_HI_FADE, s.h));
      const inland = 1 - smoothstep(CLUTTER_DRIFT_INLAND, CLUTTER_DRIFT_INLAND + CLUTTER_DRIFT_INLAND_FADE, c);
      return alt * inland;
    }
    case CLUTTER_FUNGUS: {
      const canopy = smoothstep(CLUTTER_FUNGUS_CANOPY_LO, CLUTTER_FUNGUS_CANOPY_HI, forestDensity(seed, x, z, s));
      // forestDensity already gates shore, road and slope; the explicit
      // altitude factor is belt-and-braces and keeps fungus
      // off any future ground where canopy leaks below the sand fade.
      const alt = smoothstep(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h);
      // The trees' own slope gate: no stump or mushroom on ground steep enough
      // that the forest (and the ground's soil class) has given it up.
      const grade = 1 - smoothstep(
        CLUTTER_FUNGUS_SLOPE_LO * CLUTTER_FUNGUS_SLOPE_LO,
        CLUTTER_FUNGUS_SLOPE_HI * CLUTTER_FUNGUS_SLOPE_HI,
        slopeSq,
      );
      return canopy * alt * grade * fm.clutter;
    }
    case CLUTTER_BUSH: {
      if (s.h < CLUTTER_BUSH_ALT_LO || r < CLUTTER_BUSH_ROAD_NEAR) return 0;
      const grade = 1 - smoothstep(
        CLUTTER_BUSH_SLOPE_LO * CLUTTER_BUSH_SLOPE_LO,
        CLUTTER_BUSH_SLOPE_HI * CLUTTER_BUSH_SLOPE_HI,
        slopeSq,
      );
      if (grade === 0) return 0;
      // Habitat weight over forestDensity ρ: field floor + edge
      // band + canopy term, clamped where the terms overlap. Edge IS
      // intermediate ρ — no gradient sampling.
      const rho = forestDensity(seed, x, z, s);
      const habitat = Math.min(
        1,
        CLUTTER_BUSH_FIELD_W +
          CLUTTER_BUSH_EDGE_W *
            smoothstep(CLUTTER_BUSH_EDGE_ON_LO, CLUTTER_BUSH_EDGE_ON_HI, rho) *
            (1 - smoothstep(CLUTTER_BUSH_EDGE_OFF_LO, CLUTTER_BUSH_EDGE_OFF_HI, rho)) +
          CLUTTER_BUSH_CANOPY_W * smoothstep(CLUTTER_BUSH_CANOPY_LO, CLUTTER_BUSH_CANOPY_HI, rho),
      );
      const alt =
        smoothstep(CLUTTER_BUSH_ALT_LO, CLUTTER_BUSH_ALT_LO + CLUTTER_BUSH_ALT_LO_FADE, s.h) *
        (1 - smoothstep(CLUTTER_BUSH_ALT_HI, CLUTTER_BUSH_ALT_HI + CLUTTER_BUSH_ALT_HI_FADE, s.h));
      const road = smoothstep(CLUTTER_BUSH_ROAD_NEAR, CLUTTER_BUSH_ROAD_FAR, r);
      const patch =
        CLUTTER_BUSH_PATCH_FLOOR +
        (1 - CLUTTER_BUSH_PATCH_FLOOR) *
          smoothstep(
            CLUTTER_BUSH_PATCH_LO,
            CLUTTER_BUSH_PATCH_HI,
            0.5 + 0.5 * fbm2(x / CLUTTER_BUSH_PATCH_WAVELENGTH, z / CLUTTER_BUSH_PATCH_WAVELENGTH, seed ^ CLUTTER_PATCH_SALT, CLUTTER_BUSH_PATCH_OCTAVES),
          );
      return habitat * alt * grade * road * patch * fm.clutter;
    }
    case CLUTTER_MEADOW:
      // A meadow's own carpet reads denser inside its flat (1 + fm.meadow,
      // up to 2×) BEFORE clutterInCell's ceiling clamp — the ceiling shapes
      // the field, not this multiplier (the grass-class convention above).
      // The field applies fm.clutter as its own last step, immediately
      // before this multiplies in (1 + fm.meadow) — the same two-step order
      // this case always used, so moving the fm.clutter factor into the
      // field changes nothing about how it composes here.
      return groundCoverAt(seed, x, z, s, r, rt, slopeSq, fm).grass * (1 + fm.meadow);
    case CLUTTER_FLOWER: {
      // Unlike grass and meadow, this case interposes `drift` between the
      // raw field and fm.clutter (`base * drift * fm.clutter`, in that
      // order) — a grouping the field's own internal application of
      // fm.clutter cannot reproduce, since it would have to fold the mask in
      // before `drift` ever multiplies. Floating-point multiplication is not
      // associative, so that reordering would not generally return the same
      // bits. This case therefore asks the field for the RAW, unmasked grass
      // (NO_FEATURE_MASK is the identity mask: multiplying by its `clutter`
      // of 1 changes no bit) and keeps applying fm.clutter itself, in the
      // field's original order, so this class's output is untouched.
      const base = groundCoverAt(seed, x, z, s, r, rt, slopeSq, NO_FEATURE_MASK).grass;
      if (base === 0) return 0;
      // Drift gating: flowers come in 8-20 m
      // patches on roughly a quarter to a third of open ground, not as a
      // uniform sprinkle.
      const drift = smoothstep(
        CLUTTER_FLOWER_PATCH_LO,
        CLUTTER_FLOWER_PATCH_HI,
        0.5 + 0.5 * fbm2(x / CLUTTER_FLOWER_PATCH_WAVELENGTH, z / CLUTTER_FLOWER_PATCH_WAVELENGTH, seed ^ CLUTTER_FLOWER_PATCH_SALT, CLUTTER_FLOWER_PATCH_OCTAVES),
      );
      return base * drift * fm.clutter * (1 + fm.meadow);
    }
    case CLUTTER_LITTER: {
      const band = litterBand(rt);
      if (band === 0) return 0;
      // Below the snow line only. Litter takes no low-altitude floor: the
      // trail leaves the pad a few metres above the tide, inside the grass's
      // own sand fade, and a walked path carries pebbles and twigs there too.
      const snow = 1 - smoothstep(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h);
      return band * snow;
    }
    default:
      return 0;
  }
}

/** Boulder gate product before the landmark mask — altitude, slope and road
 * clearance only (the squared-edge cliff-mask idiom on r²). */
function boulderDensityRaw(seed: number, x: number, z: number, sample?: TerrainSample): number {
  const variant = activeTerrainVariant();
  const s = sample ?? variant.sample(seed, x, z);
  const r = variant.roadDistance?.(seed, x, z) ?? Infinity;
  const slopeSq = s.dx * s.dx + s.dz * s.dz;
  if (r < CLUTTER_BOULDER_ROAD_NEAR) return 0;
  const alt = smoothstep(CLUTTER_BOULDER_ALT_LO, CLUTTER_BOULDER_ALT_HI, s.h);
  if (alt === 0) return 0;
  const grade = smoothstep(
    CLUTTER_BOULDER_SLOPE_LO * CLUTTER_BOULDER_SLOPE_LO,
    CLUTTER_BOULDER_SLOPE_HI * CLUTTER_BOULDER_SLOPE_HI,
    slopeSq,
  );
  // Squared edges on r² — the cliff-mask idiom, as elsewhere in this module.
  const road = smoothstep(
    CLUTTER_BOULDER_ROAD_NEAR * CLUTTER_BOULDER_ROAD_NEAR,
    CLUTTER_BOULDER_ROAD_FAR * CLUTTER_BOULDER_ROAD_FAR,
    r * r,
  );
  return alt * grade * road;
}

/** Boulder density without the landmark mask — what landmark placement reads. */
export function boulderDensityUnmasked(seed: number, x: number, z: number, sample?: TerrainSample): number {
  return boulderDensityRaw(seed, x, z, sample);
}

/** One clutter instance — everything the renderer and the pass need. */
export type ClutterInstance = {
  cls: number;
  x: number;
  z: number;
  groundH: number;
  /** Exact ∂h/∂x at (x, z) — see the note on `TreeInstance.groundDx`. */
  groundDx: number;
  groundDz: number;
  scale: number;
  variant: number;
  hash: number;
};

/**
 * The instance of class `cls` in cell (cellX, cellZ), or null. Presence is
 * Bernoulli with p = min(1, density(cell centre) · CELL²); the instance
 * stands at a hashed offset inside the central CLUTTER_JITTER of the cell,
 * re-sampling ground height at its own spot. Pure per-cell — no
 * neighbourhood reads.
 */
export function clutterInCell(seed: number, cls: number, cellX: number, cellZ: number): ClutterInstance | null {
  const cfg = CLASSES[cls] as ClassConfig;
  const centreX = (cellX + 0.5) * cfg.cell;
  const centreZ = (cellZ + 0.5) * cfg.cell;
  const p = Math.min(1, clutterDensity(seed, cls, centreX, centreZ) * cfg.cell * cfg.cell * cfg.density);
  const salted = seed ^ cfg.salt;
  if (hash3(cellX, cellZ, 0, salted) >= p) return null;
  const x = centreX + (hash3(cellX, cellZ, 1, salted) - 0.5) * CLUTTER_JITTER * cfg.cell;
  const z = centreZ + (hash3(cellX, cellZ, 2, salted) - 0.5) * CLUTTER_JITTER * cfg.cell;
  // A trail is 2 m wide and this cell may be 6 m: the density gate at the
  // centre cannot resolve it, so a class that must stay off the bed rejects
  // the INSTANCE by its own position, the way treeInCell does.
  if (cfg.trailClear > 0) {
    const trail = activeTerrainVariant().trailDistance?.(seed, x, z) ?? Infinity;
    if (trail < cfg.trailClear) return null;
  }
  const ground = elevationSampleAt(seed, x, z);
  const groundH = ground.h;
  const scale = cfg.scaleMin + hash3(cellX, cellZ, 3, salted) * (cfg.scaleMax - cfg.scaleMin);
  const variant = (hash3(cellX, cellZ, 4, salted) * cfg.variants) | 0;
  return {
    cls, x, z, groundH,
    groundDx: ground.dx,
    groundDz: ground.dz,
    scale, variant,
    hash: hash3(cellX, cellZ, 5, salted),
  };
}

/**
 * Every class-`cls` instance whose jittered position lands inside the
 * half-open rect [minX, maxX) × [minZ, maxZ). Jitter never leaves a cell, so
 * only overlapping cells are enumerated — the treesInRect contract.
 */
export function clutterInRect(seed: number, cls: number, minX: number, minZ: number, maxX: number, maxZ: number): ClutterInstance[] {
  const cell = (CLASSES[cls] as ClassConfig).cell;
  const out: ClutterInstance[] = [];
  const c0x = Math.floor(minX / cell);
  const c1x = Math.floor(maxX / cell);
  const c0z = Math.floor(minZ / cell);
  const c1z = Math.floor(maxZ / cell);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const inst = clutterInCell(seed, cls, cx, cz);
      if (inst && inst.x >= minX && inst.x < maxX && inst.z >= minZ && inst.z < maxZ) out.push(inst);
    }
  }
  return out;
}

/** Every clutter constant, by name — the level-id contract. The clutter
 * pass's `tunables` getter spreads this, so registryDigest covers it. */
export const CLUTTER_TUNABLES: Readonly<Record<string, number>> = {
  CLUTTER_GRASS_CELL, CLUTTER_ROCK_CELL, CLUTTER_BOULDER_CELL, CLUTTER_DRIFT_CELL, CLUTTER_FUNGUS_CELL,
  CLUTTER_GRASS_D, CLUTTER_ROCK_D, CLUTTER_BOULDER_D, CLUTTER_DRIFT_D, CLUTTER_FUNGUS_D,
  CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO_FADE, CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI_FADE,
  CLUTTER_GRASS_SLOPE_LO, CLUTTER_GRASS_SLOPE_HI, CLUTTER_GRASS_CANOPY_LO, CLUTTER_GRASS_CANOPY_HI,
  CLUTTER_GRASS_ROAD_NEAR, CLUTTER_GRASS_ROAD_FAR,
  CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_FAR,
  CLUTTER_GRASS_PATCH_WAVELENGTH, CLUTTER_GRASS_PATCH_OCTAVES, CLUTTER_GRASS_PATCH_LO, CLUTTER_GRASS_PATCH_HI,
  CLUTTER_GRASS_CANOPY_FLOOR, CLUTTER_GRASS_PATCH_FLOOR, CLUTTER_GRASS_BOOST, CLUTTER_GRASS_BOOST_LO,
  CLUTTER_DUFF_OPEN, CLUTTER_DUFF_ROAD_CLEAR,
  CLUTTER_GRASS_TRAIL_CORE, CLUTTER_GRASS_TRAIL_REACH_LO, CLUTTER_GRASS_TRAIL_REACH_HI, CLUTTER_GRASS_TRAIL_REACH_WAVE,
  CLUTTER_TRAIL_REACH_SALT,
  CLUTTER_DUFF_BED_MAX, CLUTTER_DUFF_BED_FADE, CLUTTER_DUFF_DRIFT_WAVE, CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI,
  CLUTTER_DUFF_DRIFT_SALT,
  CLUTTER_ROCK_ALT_LO, CLUTTER_ROCK_ALT_LO_FADE, CLUTTER_ROCK_SLOPE_LO, CLUTTER_ROCK_SLOPE_HI,
  CLUTTER_ROCK_BASE, CLUTTER_ROCK_ROAD_NEAR, CLUTTER_ROCK_ROAD_FAR,
  CLUTTER_BOULDER_ALT_LO, CLUTTER_BOULDER_ALT_HI, CLUTTER_BOULDER_SLOPE_LO, CLUTTER_BOULDER_SLOPE_HI,
  CLUTTER_BOULDER_ROAD_NEAR, CLUTTER_BOULDER_ROAD_FAR, CLUTTER_BOULDER_TRAIL_CLEAR,
  CLUTTER_DRIFT_ALT_LO, CLUTTER_DRIFT_ALT_LO_FADE, CLUTTER_DRIFT_ALT_HI, CLUTTER_DRIFT_ALT_HI_FADE,
  CLUTTER_DRIFT_INLAND, CLUTTER_DRIFT_INLAND_FADE,
  CLUTTER_FUNGUS_CANOPY_LO, CLUTTER_FUNGUS_CANOPY_HI, CLUTTER_FUNGUS_TRAIL_CLEAR,
  CLUTTER_FUNGUS_SLOPE_LO, CLUTTER_FUNGUS_SLOPE_HI,
  CLUTTER_BUSH_CELL, CLUTTER_BUSH_D,
  CLUTTER_BUSH_FIELD_W, CLUTTER_BUSH_EDGE_W,
  CLUTTER_BUSH_EDGE_ON_LO, CLUTTER_BUSH_EDGE_ON_HI, CLUTTER_BUSH_EDGE_OFF_LO, CLUTTER_BUSH_EDGE_OFF_HI,
  CLUTTER_BUSH_CANOPY_W, CLUTTER_BUSH_CANOPY_LO, CLUTTER_BUSH_CANOPY_HI,
  CLUTTER_BUSH_ALT_LO, CLUTTER_BUSH_ALT_LO_FADE, CLUTTER_BUSH_ALT_HI, CLUTTER_BUSH_ALT_HI_FADE,
  CLUTTER_BUSH_SLOPE_LO, CLUTTER_BUSH_SLOPE_HI,
  CLUTTER_BUSH_ROAD_NEAR, CLUTTER_BUSH_ROAD_FAR,
  CLUTTER_BUSH_PATCH_WAVELENGTH, CLUTTER_BUSH_PATCH_OCTAVES, CLUTTER_BUSH_PATCH_FLOOR,
  CLUTTER_BUSH_PATCH_LO, CLUTTER_BUSH_PATCH_HI,
  CLUTTER_MEADOW_CELL, CLUTTER_MEADOW_D,
  CLUTTER_FLOWER_CELL, CLUTTER_FLOWER_D,
  CLUTTER_FLOWER_PATCH_WAVELENGTH, CLUTTER_FLOWER_PATCH_OCTAVES, CLUTTER_FLOWER_PATCH_LO, CLUTTER_FLOWER_PATCH_HI,
  CLUTTER_LITTER_CELL, CLUTTER_LITTER_D, CLUTTER_LITTER_CORE, CLUTTER_LITTER_MARGIN_LO, CLUTTER_LITTER_MARGIN_HI,
  CLUTTER_LITTER_FADE, CLUTTER_LITTER_SCALE_MIN, CLUTTER_LITTER_SCALE_MAX, CLUTTER_LITTER_SALT,
  CLUTTER_GRASS_SCALE_MIN, CLUTTER_GRASS_SCALE_MAX, CLUTTER_ROCK_SCALE_MIN, CLUTTER_ROCK_SCALE_MAX,
  CLUTTER_BOULDER_SCALE_MIN, CLUTTER_BOULDER_SCALE_MAX, CLUTTER_DRIFT_SCALE_MIN, CLUTTER_DRIFT_SCALE_MAX,
  CLUTTER_FUNGUS_SCALE_MIN, CLUTTER_FUNGUS_SCALE_MAX, CLUTTER_BUSH_SCALE_MIN, CLUTTER_BUSH_SCALE_MAX,
  CLUTTER_MEADOW_SCALE_MIN, CLUTTER_MEADOW_SCALE_MAX, CLUTTER_FLOWER_SCALE_MIN, CLUTTER_FLOWER_SCALE_MAX,
  CLUTTER_JITTER,
  CLUTTER_GRASS_SALT, CLUTTER_ROCK_SALT, CLUTTER_BOULDER_SALT, CLUTTER_DRIFT_SALT, CLUTTER_FUNGUS_SALT,
  CLUTTER_BUSH_SALT,
  CLUTTER_MEADOW_SALT, CLUTTER_FLOWER_SALT, CLUTTER_FLOWER_PATCH_SALT,
  CLUTTER_PATCH_SALT,
};
