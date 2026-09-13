/**
 * The forest density field ρ ∈ [0, 1] — where conifers can stand, and how
 * thickly. A pure point function of (seed, x, z) like everything in `sim/`:
 * five smoothstep gates (treeline altitude, slope, shore, road clearance, and a low-frequency
 * "raggedness" noise that breaks the forest into stands) multiplied together,
 * with a mild valley-floor density boost.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 * Math.sqrt is IEEE-exact and allowed.
 */
import { fbm2, hash3 } from "./field.js";
import { activeTerrainVariant, elevationSampleAt, type TerrainSample } from "./terrain.js";
import { TRAIL_CLEAR } from "./trail.js";

// ---- Tunables (every one of these must appear in VEGETATION_TUNABLES) ------
/** Below this altitude (m) the treeline gate is fully open. Re-anchored for
 * the dense field: chosen so the fraction of the
 * census window above it stays near the sparse field's 8.8 % — measured
 * 0.113 at 200 m. HI − LO stays 40. */
export const TREELINE_LO = 200;
/** Above this altitude (m) trees cannot grow at all. */
export const TREELINE_HI = 240;
/** Slope (rise over run) below which grade is unrestricted. */
export const SLOPE_LO = 0.55;
/** Slope at and past which no tree can hold. */
export const SLOPE_HI = 0.75;
/** Altitude (m) below which ground counts as beach — bare of trees. */
export const SHORE_ALT = 4;
/** Altitude fade width (m): forest ramps in over [SHORE_ALT, SHORE_ALT + this]. */
export const SHORE_ALT_FADE = 3;
/** Coast distance (m) inside which ground is bare regardless of altitude. */
export const SHORE_D = 10;
/** Coast-distance fade width (m): forest ramps in over [SHORE_D, SHORE_D + this]. */
export const SHORE_D_FADE = 30;
/** No vegetation within this distance of the road centerline (m) — the
 * highway's cleared verge. */
export const ROAD_CLEAR = 12;
/** Density ramps back in over [ROAD_CLEAR, ROAD_CLEAR + this] (m). */
export const ROAD_CLEAR_FADE = 15;
/** Wavelength (m) of the stand-breaking raggedness noise. */
export const RAG_WAVELENGTH = 220;
export const RAG_OCTAVES = 2;
/** fbm2 band mapped to [0, 1] density — below LO bare, above HI full.
 * Re-anchored: was 0.25 / 0.75 — the narrower
 * band fills stand interiors contiguously instead of leaving ragged gaps. */
export const RAG_LO = 0.15;
export const RAG_HI = 0.6;
/** Peak trees per square metre where every gate is fully open.
 * Re-anchored: was 0.006 — saturates the CELL-10
 * cap at ρ = 1. Pulled back at a frame-time gate:
 * peak density is now 1.33× the pre-retune 0.006, and the ceiling
 * 1/CELL² = 0.01 is intentionally NOT saturated — the frame-time gate bound
 * it, not the geometric cap. Total tree count still lands ≈1.7× pre-retune
 * because the widened RAG window (RAG_LO/RAG_HI above) fills stand
 * interiors that the old raggedness left bare. */
export const TREE_DENSITY_MAX = 0.008;
/** Density multiplier on the valley floor (fades to 1 at TREELINE_HI). */
export const VALLEY_DENSITY_BOOST = 1.3;
/** Trunk-scale multiplier on the valley floor (consumed by the tree field). */
export const VALLEY_SCALE_BOOST = 1.25;
/** Side (m) of a jittered-grid cell: at most one tree per cell.
 * Re-anchored: was 12 — the real density lever:
 * cap 1/CELL² rises 0.0069 → 0.01 /m². */
export const TREE_CELL = 10;
/** Trunk scale range before the valley boost multiplies in. */
export const TREE_SCALE_MIN = 0.8;
export const TREE_SCALE_MAX = 1.3;
/** How many conifer species the renderer can pick between. */
export const SPECIES_COUNT = 2;
/** Fraction of the cell the jitter may roam — trees keep a 0.15-cell margin
 * from every cell border, so a tree can never leave its own cell. */
export const JITTER_SPAN = 0.7;

/** Cohort ids. Orthogonal to `species`: a giant and a sapling can both be
 * species 0. Widening SPECIES_COUNT instead would repartition the understory,
 * which pairs off it. */
export const COHORT_GIANT = 0;
export const COHORT_SAPLING = 1;
export const COHORT_SNAG = 2;
export const COHORT_LOG = 3;

/** ρ band over which the cohort ramps from regeneration to canopy giant:
 * giants hold the dense heart of a stand, regeneration the ragged edges and
 * canopy gaps the raggedness noise already carves. Re-anchored:
 * was 0.35 / 0.75 — cohort split shifts toward
 * saplings. */
export const GIANT_RHO_LO = 0.45;
export const GIANT_RHO_HI = 0.85;
/** Hashed blend width on that boundary, so the rule never reads as a clean
 * contour — some saplings stand under giants, some giants at the edge. */
export const COHORT_JITTER = 0.25;
/** Fraction of canopy-cohort cells standing dead. */
export const SNAG_SHARE = 0.05;
/** Fraction lying fallen as nurse logs. */
export const LOG_SHARE = 0.05;
/** Giant scale spread, derived from the models that actually shipped rather
 * than from a higher-poly source variant's dimensions: the shipped giants
 * measure 17.18 m (pine) and 14.70 m (fir), so
 * a ~15.9 m mean needs ~2.8-4.1x for the 45-65 m canopy this aims for.
 * Pine lands 48-70 m, fir 41-60 m — the species differing in mature height
 * is what a real mixed stand does. VALLEY_SCALE_BOOST multiplies on top, so
 * valley-bottom giants run taller still, which is also the real pattern. */
export const GIANT_SCALE_MIN = 2.8;
export const GIANT_SCALE_MAX = 4.1;
/** Deadwood scale spread: ~1.5-2x a 4.1 m model gives a 6-8 m snag or log. */
export const DEADWOOD_SCALE_MIN = 1.5;
export const DEADWOOD_SCALE_MAX = 2;

// Salts stay module-private and out of the tunables — the montane convention.
const RAG_SALT = 0x4e57;
const TREE_SALT = 0x7ee5;

/** Cubic smoothstep, clamped to [0, 1] outside the band. Value-only local
 * copy of the shape in `montane.ts`'s `smoothstepD` — sim imports nothing
 * from `game/`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/**
 * ρ without the landmark mask — what landmark placement reads: the
 * mask is derived from these placements, so reading it here would be
 * circular. When `sample` is provided it is trusted (the clipmap already has
 * it); otherwise the active variant is sampled here.
 */
export function forestDensityUnmasked(seed: number, x: number, z: number, sample?: TerrainSample): number {
  const variant = activeTerrainVariant();
  const s = sample ?? variant.sample(seed, x, z);
  // Variants without a coast report d = Infinity: exact and deterministic,
  // it fails `d < SHORE_D` and saturates smoothstep(SHORE_D, SHORE_D+30, d)
  // to 1, so both shore gates pass wide open — infinitely inland, as designed.
  const d = variant.coastDistance?.(seed, x, z) ?? Infinity;
  // Variants without a road report r = Infinity: exact and deterministic,
  // it fails `r < ROAD_CLEAR` and saturates smoothstep(ROAD_CLEAR,
  // ROAD_CLEAR+ROAD_CLEAR_FADE, r) to 1, so the road gate passes wide open —
  // infinitely far from any road, as designed.
  const r = variant.roadDistance?.(seed, x, z) ?? Infinity;
  if (s.h < SHORE_ALT || d < SHORE_D || r < ROAD_CLEAR) return 0;
  const slope = Math.sqrt(s.dx * s.dx + s.dz * s.dz);
  const alt = 1 - smoothstep(TREELINE_LO, TREELINE_HI, s.h);
  const grade = 1 - smoothstep(SLOPE_LO, SLOPE_HI, slope);
  const shore =
    smoothstep(SHORE_ALT, SHORE_ALT + SHORE_ALT_FADE, s.h) *
    smoothstep(SHORE_D, SHORE_D + SHORE_D_FADE, d);
  const road = smoothstep(ROAD_CLEAR, ROAD_CLEAR + ROAD_CLEAR_FADE, r);
  const rag = smoothstep(RAG_LO, RAG_HI, fbm2(x / RAG_WAVELENGTH, z / RAG_WAVELENGTH, seed ^ RAG_SALT, RAG_OCTAVES));
  const valley = 1 + (VALLEY_DENSITY_BOOST - 1) * (1 - Math.min(1, s.h / TREELINE_HI));
  return Math.min(1, alt * grade * shore * road * rag * valley);
}

/**
 * ρ at a world coordinate, with the carved-landmark tree mask applied:
 * a carved clearing zeroes it, a carved stand boosts it — with a
 * floor, since a multiplier alone cannot raise ρ = 0. The trail-system
 * feature mask is applied AFTER the landmark stand
 * floor — a made meadow or pond beats a carved stand, not the other way
 * round — and multiplies rather than floors: a feature only ever thins the
 * canopy (mask.tree ≤ 1), never conjures one.
 */
export function forestDensity(seed: number, x: number, z: number, sample?: TerrainSample): number {
  const variant = activeTerrainVariant();
  // Held once and threaded through — the featureMask hook takes the height
  // so it need not re-sample the field itself.
  const s = sample ?? variant.sample(seed, x, z);
  const rho = forestDensityUnmasked(seed, x, z, s);
  const mask = variant.landmarkMask?.(seed, x, z);
  // The floor lets a CARVED stand exist where the raw gates said zero. Carved
  // discs lie at least LANDMARK_BOWL_MARGIN inside the bowl (u ≥ BOWL_U_MIN +
  // margin), far past the shore and road gates this bypasses; the trail is
  // protected separately by treeInCell's TRAIL_CLEAR rejection.
  const withLandmark = mask === undefined ? rho : Math.min(1, Math.max(rho * mask.tree, mask.treeFloor));
  const fm = variant.featureMask?.(seed, x, z, s.h);
  return fm === undefined ? withLandmark : withLandmark * fm.tree;
}

/** One tree of the discrete field — everything the renderer and the
 * collision pass need. `hash` is a plain [0,1) draw so the RENDERER can
 * derive a rotation with trig on its side; sim/ emits no angles. */
export type TreeInstance = {
  x: number;
  z: number;
  groundH: number;
  /** Exact ∂h/∂x at (x, z), from the very sample `groundH` came from. Renderer
   * business: the base conform and the tilt both need the local ground plane,
   * and re-sampling the field in `game/` would cost roughly 6 µs per instance
   * per rebuild — about 50 ms on a 9k-instance clutter rebuild that happens
   * every 3 m of travel. */
  groundDx: number;
  groundDz: number;
  species: number;
  scale: number;
  cohort: number;
  hash: number;
};

/**
 * The tree of cell (cellX, cellZ), or null if the density gate keeps the
 * cell bare. Jittered grid: presence is Bernoulli with
 * p = clamp01(ρ(cell centre) · TREE_CELL² · TREE_DENSITY_MAX), and the tree
 * stands at a hashed offset inside the central `JITTER_SPAN` of the cell.
 * A pure point function of (seed, cellX, cellZ) — no neighbourhood reads.
 */
export function treeInCell(seed: number, cellX: number, cellZ: number): TreeInstance | null {
  const centreX = (cellX + 0.5) * TREE_CELL;
  const centreZ = (cellZ + 0.5) * TREE_CELL;
  const rho = forestDensity(seed, centreX, centreZ);
  const p = Math.min(1, rho * TREE_CELL * TREE_CELL * TREE_DENSITY_MAX);
  const salted = seed ^ TREE_SALT;
  if (hash3(cellX, cellZ, 0, salted) >= p) return null;
  const x = centreX + (hash3(cellX, cellZ, 1, salted) - 0.5) * JITTER_SPAN * TREE_CELL;
  const z = centreZ + (hash3(cellX, cellZ, 2, salted) - 0.5) * JITTER_SPAN * TREE_CELL;
  // A trail is 2 m wide and a tree cell is 10 m: the density gate cannot
  // resolve it, so reject the INSTANCE by its own position.
  const trail = activeTerrainVariant().trailDistance?.(seed, x, z) ?? Infinity;
  if (trail < TRAIL_CLEAR) return null;
  // Re-sample at the jittered position: the cell-centre sample gated
  // presence, but the tree stands (and roots) at its own spot.
  const ground = elevationSampleAt(seed, x, z);
  const groundH = ground.h;
  const species = (hash3(cellX, cellZ, 3, salted) * SPECIES_COUNT) | 0;
  // Cohort from the LOCAL density: ρ was already computed for presence.
  // Hash slots 6-8 are new; 0-5 are taken by presence, jitter, species and
  // the renderer's rotation draw.
  const jitter = (hash3(cellX, cellZ, 6, salted) - 0.5) * COHORT_JITTER;
  const giantness = smoothstep(GIANT_RHO_LO, GIANT_RHO_HI, rho + jitter);
  let cohort = hash3(cellX, cellZ, 7, salted) < giantness ? COHORT_GIANT : COHORT_SAPLING;
  if (cohort === COHORT_GIANT) {
    // Snags and logs are dead members of the CANOPY cohort, so they stand
    // where a giant actually grew rather than on their own field.
    const dead = hash3(cellX, cellZ, 8, salted);
    if (dead < SNAG_SHARE) cohort = COHORT_SNAG;
    else if (dead < SNAG_SHARE + LOG_SHARE) cohort = COHORT_LOG;
  }

  let scaleMin = TREE_SCALE_MIN;
  let scaleMax = TREE_SCALE_MAX;
  if (cohort === COHORT_GIANT) {
    scaleMin = GIANT_SCALE_MIN;
    scaleMax = GIANT_SCALE_MAX;
  } else if (cohort !== COHORT_SAPLING) {
    scaleMin = DEADWOOD_SCALE_MIN;
    scaleMax = DEADWOOD_SCALE_MAX;
  }
  const valley = 1 + (VALLEY_SCALE_BOOST - 1) * (1 - Math.min(1, groundH / TREELINE_HI));
  const scale = (scaleMin + hash3(cellX, cellZ, 4, salted) * (scaleMax - scaleMin)) * valley;
  return {
    x, z, groundH,
    groundDx: ground.dx,
    groundDz: ground.dz,
    species, scale, cohort,
    hash: hash3(cellX, cellZ, 5, salted),
  };
}

/**
 * Every tree whose JITTERED position lands inside the half-open rect
 * [minX, maxX) × [minZ, maxZ) — half-open so a tree on a chunk border is
 * emitted by exactly one chunk. Jitter never leaves a tree's own cell, so
 * only cells overlapping the rect need enumerating.
 */
export function treesInRect(
  seed: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): TreeInstance[] {
  const out: TreeInstance[] = [];
  const c0x = Math.floor(minX / TREE_CELL);
  const c1x = Math.floor(maxX / TREE_CELL);
  const c0z = Math.floor(minZ / TREE_CELL);
  const c1z = Math.floor(maxZ / TREE_CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const t = treeInCell(seed, cx, cz);
      if (t && t.x >= minX && t.x < maxX && t.z >= minZ && t.z < maxZ) out.push(t);
    }
  }
  return out;
}

/** Every vegetation constant, by name — the level-id contract (a later
 * pass spreads this into its tunables). */
export const VEGETATION_TUNABLES: Readonly<Record<string, number>> = {
  TREELINE_LO,
  TREELINE_HI,
  SLOPE_LO,
  SLOPE_HI,
  SHORE_ALT,
  SHORE_ALT_FADE,
  SHORE_D,
  SHORE_D_FADE,
  ROAD_CLEAR,
  ROAD_CLEAR_FADE,
  RAG_WAVELENGTH,
  RAG_OCTAVES,
  RAG_LO,
  RAG_HI,
  TREE_DENSITY_MAX,
  VALLEY_DENSITY_BOOST,
  VALLEY_SCALE_BOOST,
  TREE_CELL,
  TREE_SCALE_MIN,
  TREE_SCALE_MAX,
  SPECIES_COUNT,
  JITTER_SPAN,
  GIANT_RHO_LO,
  GIANT_RHO_HI,
  COHORT_JITTER,
  SNAG_SHARE,
  LOG_SHARE,
  GIANT_SCALE_MIN,
  GIANT_SCALE_MAX,
  DEADWOOD_SCALE_MIN,
  DEADWOOD_SCALE_MAX,
  TRAIL_CLEAR,
};
