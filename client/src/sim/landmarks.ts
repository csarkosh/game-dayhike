/**
 * The two scenery landmarks: a stand and a talus,
 * one of each, every run. Each is FOUND where the seed's terrain already
 * satisfies its predicate near a cell the trail's own stem reaches, and
 * CARVED at the best-scoring such cell where it does not. Carving is a mask
 * (tree and boulder density multipliers) — there is no dome any more.
 *
 * NEITHER IS ROUTED TO: the overlook and
 * the clearing, and the whole idea of a landmark being a trail END, went with
 * the fork-and-chord graph. A stand or a talus is scenery beside the stem
 * (and beside the loops) — placed on ground the trail already reached,
 * clear of every node and edge by construction, never a graph node itself.
 *
 * This module owns the PREDICATES (what makes a cell a stand, a talus), the
 * mask; the builder scores candidates with `scoreCandidate`, compares against
 * `landmarkThreshold`, and decides.
 *
 * Generic: densities and heights arrive through `Samplers`, and the tree
 * density it reads must be the UNMASKED one — the mask is derived from these
 * placements, so reading a masked density here would be circular.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { LandmarkType } from "./trail.js";

// ---- Tunables --------------------------------------------------
export const LANDMARK_DISC_RADIUS = 30;
export const LANDMARK_DISC_FADE = 10;
export const LANDMARK_FILL = 0.7;
export const STAND_BOOST = 1.5;
export const TALUS_BOOST = 3.0;
/** Grid step (m) of `discFill`'s sampling of a candidate's disc. */
export const LANDMARK_SCAN_STEP = 10;
/** The two disc predicates' thresholds: a stand is dense forest, a talus is
 * boulder field. */
export const STAND_TREE_MIN = 0.9;
export const TALUS_BOULDER_MIN = 0.5;
/** Density a CARVED stand / talus is raised to inside its disc (scaled by the
 * disc weight). A multiplier cannot create presence where the raw gate is a
 * hard zero — measured: seeds 12345 and 777 carve talus on ground flatter than
 * CLUTTER_BOULDER_SLOPE_LO, where TALUS_BOOST × 0 = 0. The floors sit above
 * the predicates (stand ρ ≥ 0.9, talus ≥ 0.5) so a carve always satisfies them. */
export const STAND_CARVED_DENSITY = 0.95;
export const TALUS_CARVED_DENSITY = 0.8;
/** Placement keeps every landmark this far inside the bowl, so its whole
 * footprint — the 30 + 10 m disc — lies inside `inBowl`, the only gate the
 * composer applies. A footprint that crossed the gate would be truncated
 * there rather than faded: a seam at the bowl edge. */
export const LANDMARK_BOWL_MARGIN = 50;

/** Landmark placement on the grid.
 * Renamed from LANDMARK_MIN_PATH: a
 * landmark is scenery now, not a trail end, so this floor keeps it a real
 * walk from the PAD rather than off the edge of the pad's own fade ring —
 * `first.len`, the plain search distance, is still what it is measured
 * against. */
export const LANDMARK_SCENERY_MIN_PATH = 250;
export const LANDMARK_SPACING = 200;
/** Candidates are every STRIDE-th grid cell in each axis: the disc scan is 29
 * samples per candidate and every reachable cell would cost a second a world. */
export const LANDMARK_CANDIDATE_STRIDE = 4;
/** Candidates tried, best first, before a landmark is kept on a failing path. */
export const LANDMARK_TRIES = 3;
/** The order the builder places them in — no longer load-bearing (there is no
 * dome to raise before a later path crosses it), kept for a stable, legible
 * placement order. */
export const LANDMARK_ORDER: readonly LandmarkType[] = ["stand", "talus"];

export const LANDMARK_TUNABLES: Readonly<Record<string, number>> = {
  LANDMARK_DISC_RADIUS, LANDMARK_DISC_FADE, LANDMARK_FILL,
  STAND_BOOST, TALUS_BOOST, LANDMARK_SCAN_STEP,
  STAND_TREE_MIN, TALUS_BOULDER_MIN,
  STAND_CARVED_DENSITY, TALUS_CARVED_DENSITY, LANDMARK_BOWL_MARGIN,
  LANDMARK_SCENERY_MIN_PATH, LANDMARK_SPACING, LANDMARK_CANDIDATE_STRIDE, LANDMARK_TRIES,
};

export type Landmark = {
  type: LandmarkType;
  x: number;
  z: number;
  carved: boolean;
  /**
   * The centre of the disc this landmark was SCORED on — the same point as
   * (x, z) for every type but the talus, whose disc sits a disc-radius to one
   * side (see `scoreCandidate`). (x, z) is where the scenery sits and what
   * `landmarkMaskAt` carves around; this is what the seed's own ground
   * satisfies, and what a "last seen near" reads.
   *
   * For a CARVED talus, `discX/discZ` is still `scoredDisc`'s pick — the
   * best-scoring of the eight neighbour discs the seed offered, even though
   * its fill fell short of `LANDMARK_FILL` (that is what carving means) — NOT
   * where the boulders actually get carved, which is around (x, z) like every
   * other type.
   */
  discX: number;
  discZ: number;
};

export type Samplers = {
  treeDensity(x: number, z: number): number;
  boulderDensity(x: number, z: number): number;
  /**
   * OPTIONAL HINT: "could any point within `r` of (x, z) carry a boulder at
   * all?" A caller that can answer cheaply — the builder can, from the
   * walkability grid's cached gradients — lets `talusScan` drop a disc without
   * sampling it. Answering `true` is always safe; answering `false` claims the
   * disc's fill is exactly 0, which is only true where the density's own slope
   * gate is a hard zero (clutter.ts's boulder grade is
   * `smoothstep(LO², HI², |∇h|²)`, so it is). Omitted ⇒ every disc is scanned.
   */
  mayHaveBoulders?(x: number, z: number, r: number): boolean;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Fraction of disc samples (LANDMARK_SCAN_STEP grid) passing `pred`. Zero
 * rather than NaN on an empty disc: a candidate with no evidence must not win
 * a `>` comparison. */
function discFill(x: number, z: number, pred: (px: number, pz: number) => boolean): number {
  let n = 0;
  let ok = 0;
  for (let dz = -LANDMARK_DISC_RADIUS; dz <= LANDMARK_DISC_RADIUS; dz += LANDMARK_SCAN_STEP) {
    for (let dx = -LANDMARK_DISC_RADIUS; dx <= LANDMARK_DISC_RADIUS; dx += LANDMARK_SCAN_STEP) {
      if (dx * dx + dz * dz > LANDMARK_DISC_RADIUS * LANDMARK_DISC_RADIUS) continue;
      n++;
      if (pred(x + dx, z + dz)) ok++;
    }
  }
  return n > 0 ? ok / n : 0;
}

/**
 * THE TALUS IS SCORED AT THE FOOT. A boulder field is a property of STEEP ground:
 * `boulderDensityUnmasked` ramps in over CLUTTER_BOULDER_SLOPE_LO/HI =
 * 0.35/0.8, so TALUS_BOULDER_MIN = 0.5 needs a grade of about 0.6 — and
 * TRAIL_GRID_CAP is 0.6, with a one-cell margin on top, so every cell that
 * could satisfy the predicate is a cell the trail may not stand on. Measured
 * over 25 seeds: the best fill on any REACHABLE cell was 0.07–0.52 against the
 * 0.7 threshold, while unreachable discs scored 0.72–1.00 — so the talus carved
 * on 501 of 501 worlds, a conflict between the predicate and the grid rather
 * than anything about the seed.
 *
 * So a talus candidate is scored on the best disc a DISC RADIUS away, in the
 * eight compass directions: the scenery sits on walkable ground at the foot of
 * the field, and the field itself is beside it, which is what a talus looks
 * like from a trail anyway. The stand is scored where it stands.
 *
 * The disc is scored on the ground AS IT IS — the trail's own 2 m tread through
 * a 60 m disc is not worth an exclusion rule, and the old one had to model the
 * bed before the bed existed.
 */
const R2 = Math.SQRT1_2;
const TALUS_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [R2, R2], [R2, -R2], [-R2, R2], [-R2, -R2],
];

/** The best of a talus candidate's eight discs: its fill and its centre. */
function talusScan(x: number, z: number, s: Samplers): { fill: number; x: number; z: number } {
  let best = { fill: -1, x, z };
  for (const [ux, uz] of TALUS_DIRS) {
    const cx = x + ux * LANDMARK_DISC_RADIUS, cz = z + uz * LANDMARK_DISC_RADIUS;
    const fill = s.mayHaveBoulders !== undefined && !s.mayHaveBoulders(cx, cz, LANDMARK_DISC_RADIUS)
      ? 0
      : discFill(cx, cz, (px, pz) => s.boulderDensity(px, pz) >= TALUS_BOULDER_MIN);
    if (fill > best.fill) best = { fill, x: cx, z: cz };
  }
  return best;
}

/** How well a candidate cell serves a type: a fill fraction for both disc types. */
export function scoreCandidate(type: LandmarkType, x: number, z: number, s: Samplers): number {
  switch (type) {
    case "stand": return discFill(x, z, (px, pz) => s.treeDensity(px, pz) >= STAND_TREE_MIN);
    case "talus": return talusScan(x, z, s).fill;
  }
}

/** Where the disc `scoreCandidate` scored actually sits: the candidate itself,
 * except for the talus, whose field is a disc radius to one side. Called once
 * per placed landmark, not per candidate. */
export function scoredDisc(type: LandmarkType, x: number, z: number, s: Samplers): { x: number; z: number } {
  if (type !== "talus") return { x, z };
  const best = talusScan(x, z, s);
  return { x: best.x, z: best.z };
}

/** What a candidate's score must reach to be FOUND rather than carved: both
 * remaining types score a fill fraction against the same floor. */
export function landmarkThreshold(type: LandmarkType): number {
  switch (type) {
    case "stand": return LANDMARK_FILL;
    case "talus": return LANDMARK_FILL;
  }
}

export type LandmarkMask = { tree: number; boulder: number; treeFloor: number; boulderFloor: number };

/**
 * Multipliers and floors at a point from every CARVED landmark's disc.
 * Consumers apply min(1, max(raw · mult, floor)).
 *
 * Discs CAN overlap, and nothing in the builder forbids it. Each disc
 * contributes INDEPENDENTLY: `tree` is a running PRODUCT over the stand discs
 * that reach the point (1 + (BOOST−1)·m), `boulder` the same for talus discs,
 * and `treeFloor`/`boulderFloor` are running MAXIMA — so overlapping discs
 * compound multiplicatively and the larger floor wins.
 */
export function landmarkMaskAt(landmarks: readonly Landmark[], x: number, z: number): LandmarkMask {
  let tree = 1;
  let boulder = 1;
  let treeFloor = 0;
  let boulderFloor = 0;
  for (const lm of landmarks) {
    if (!lm.carved) continue;
    const dx = x - lm.x;
    const dz = z - lm.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= LANDMARK_DISC_RADIUS + LANDMARK_DISC_FADE) continue;
    const m = 1 - smoothstep(LANDMARK_DISC_RADIUS, LANDMARK_DISC_RADIUS + LANDMARK_DISC_FADE, d);
    if (lm.type === "stand") {
      tree *= 1 + (STAND_BOOST - 1) * m;
      treeFloor = Math.max(treeFloor, STAND_CARVED_DENSITY * m);
    } else if (lm.type === "talus") {
      boulder *= 1 + (TALUS_BOOST - 1) * m;
      boulderFloor = Math.max(boulderFloor, TALUS_CARVED_DENSITY * m);
    }
  }
  return { tree, boulder, treeFloor, boulderFloor };
}
