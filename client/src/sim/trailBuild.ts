/**
 * The trail graph on the ground — superseding the earlier fork-and-chord
 * builder (2026-09-11).
 *
 * THE GRAPH IS A STEM NOW, NOT A FAN. The grid says where the ground can be
 * walked, a Dijkstra tree from the trailhead says where the trail goes, and
 * the stem is routed to a made PEAK — one dome, placed inland of the pad and
 * lowered and retried until a walkable route reaches its crest, which becomes
 * the graph's only dead end. Loops around the other made features (a meadow
 * flat, a pond basin) are handled separately; this module leaves `graph.loops` empty.
 * Two more landmarks — a stand and a talus — are placed as SCENERY once the
 * stem is committed: found or carved exactly as before, but no longer routed
 * to and never a graph node.
 *
 * The ground function composes `featureStageD` over the built-so-far feature
 * list (the peak, and later the loop features), not landmark domes — there is
 * no dome left in `landmarks.ts`.
 *
 * This module is the one place that composes trailGrid.ts, trail.ts,
 * features.ts and landmarks.ts; trail.ts never imports landmarks.ts or
 * features.ts.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { TerrainSample } from "./terrain.js";
import { hash3 } from "./field.js";
import {
  BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF, TRAIL_Z_ANCHOR, TRAILHEAD_U, TRAILHEAD_RADIUS, TRAILHEAD_FADE,
} from "./bowl.js";
import {
  buildTrailGrid, resampleCells, cellAt, searchFrom, pathCells, TRAIL_GRID_CELL,
  type TrailGrid, type Search, type GroundFn,
} from "./trailGrid.js";
import {
  buildProfile, segmentDistance, segmentSegmentDistanceSq, trailCorridorD,
  TRAIL_HARD_SLOPE_MAX, TRAIL_SIMPLIFY_TOL, TRAIL_REROUTE_MAX, TRAIL_EDGE_MIN_GAP, TRAIL_SALT,
  TRAIL_PROFILE_STEP, TRAIL_PROFILE_SMOOTH, TRAIL_CORRIDOR_HALF,
  type TrailGraph, type TrailNode, type TrailEdge, type TrailLoop, type LandmarkType,
} from "./trail.js";
import {
  scoreCandidate, scoredDisc, landmarkThreshold,
  LANDMARK_ORDER, LANDMARK_SCENERY_MIN_PATH, LANDMARK_SPACING, LANDMARK_CANDIDATE_STRIDE,
  LANDMARK_BOWL_MARGIN, LANDMARK_DISC_RADIUS,
  type Landmark, type Samplers,
} from "./landmarks.js";
import {
  featureDraw, featureStageD, planFeatures, loopBand,
  PEAK_RADIUS_MIN, PEAK_RADIUS_MAX, PEAK_RISE_MIN, PEAK_RISE_MAX,
  PEAK_INLAND_MIN, PEAK_INLAND_MAX, PEAK_SHOULDER, PEAK_LOWER_STEP, PEAK_LOWER_TRIES, PEAK_CENTRE_TRIES,
  LOOP_TRIES, TREE_PENALTY, LOOP_SCAN_STRIDE,
  MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX, MEADOW_SLOPE_MAX, MEADOW_RIM,
  POND_RADIUS_MIN, POND_RADIUS_MAX, POND_SLOPE_MAX, POND_APRON,
  LOOP_LATERAL_MIN, LOOP_LATERAL_MAX, FEATURE_ROAD_CLEAR, FEATURE_SPACING,
  RING_BAND, RING_COST, LOOP_JUNCTION_GAP, LOOP_OVERLAP_MAX, LOOP_JOIN_REACH,
  LOOP_BAND_LO_1, LOOP_BAND_HI_3,
  LOOP_LEN_MIN, LOOP_LEN_MAX,
  type Feature,
} from "./features.js";


export type BuildFrame = {
  roadCenterX(z: number): number;
  /** The pre-trail field: base → cliffs → dunes → pad → road corridor. No
   * feature stage, no trail corridor. */
  sample(x: number, z: number): TerrainSample;
  treeDensity(x: number, z: number): number;
  boulderDensity(x: number, z: number): number;
  /**
   * The gradient at or below which `boulderDensity` is EXACTLY zero — the
   * composer's own constant (`CLUTTER_BOULDER_SLOPE_LO`), so the builder can
   * answer `Samplers.mayHaveBoulders` from the grid's cached gradients instead
   * of sampling a disc it already knows is empty. The talus is scored on eight
   * discs per candidate and the great majority of them are flat ground.
   */
  boulderSlopeMin: number;
};

/**
 * A NODE'S HEIGHT IS THE DE-CLODDED GROUND, not the raw ground (a departure
 * from how this used to work, 2026-09-09) — the same smoothing the profile applies
 * along an edge, applied as a disc of the same reach.
 *
 * Every profile is pinned to its two node heights, so a node standing on a clod
 * is the one bump the smoothing cannot take out: both edges are dragged up to
 * it, one arriving up it and one leaving down it, and their linear
 * extrapolations past the shared node then disagree by twice the clod over the
 * corridor's own reach — which is exactly what the union blends, 1–3 m out,
 * where the blend weight's own gradient is steepest. Measured over the 219-seed
 * sweep with raw node heights: 15 samples over MAX_WALKABLE_GRADIENT on 15
 * seeds, EVERY ONE of them 2.8–3.0 m from a node on an edge whose own profile
 * was running at 0.32–0.57 (the worst, seed 487185649's node 37: a 0.62 m clod,
 * the two profiles 2.8 m apart 3 m out, composed gradient 1.324).
 */
const NODE_SMOOTH_R = TRAIL_PROFILE_STEP * TRAIL_PROFILE_SMOOTH;
const NODE_SMOOTH_STEP = 4;
function smoothedH(groundH: (x: number, z: number) => number, x: number, z: number): number {
  let sum = 0, wsum = 0;
  for (let dz = -NODE_SMOOTH_R; dz <= NODE_SMOOTH_R; dz += NODE_SMOOTH_STEP) {
    for (let dx = -NODE_SMOOTH_R; dx <= NODE_SMOOTH_R; dx += NODE_SMOOTH_STEP) {
      const r2 = dx * dx + dz * dz;
      if (r2 > NODE_SMOOTH_R * NODE_SMOOTH_R) continue;
      // Triangular in the radius, as the profile's kernel is triangular in the
      // sample index; the +STEP keeps the rim's weight positive.
      const w = 1 - Math.sqrt(r2) / (NODE_SMOOTH_R + NODE_SMOOTH_STEP);
      sum += w * groundH(x + dx, z + dz);
      wsum += w;
    }
  }
  return sum / wsum;
}

/**
 * The three heights the builder reads: the raw ground (what a profile's
 * interior samples are), the de-clodded height at a world point (a node's), and
 * the same memoised per grid cell — the fine check asks for the same cell
 * centres over and over, and a cell's smoothing is 13 ground samples.
 */
type Heights = {
  ground: (x: number, z: number) => number;
  point: (x: number, z: number) => number;
  cell: (c: number) => number;
};

type Candidate = { cell: number; score: number; found: boolean };
type Attempt = { cells: number[]; worst: number; pathLen: number };

/**
 * The graph as it stands, in the four structures a path reads and writes.
 * `planPath` builds the NEXT one without touching this one, so the fine check
 * can measure the composed field over the geometry `commitPath` would build —
 * the same node positions (pad centre, snapped node, or `splitAt` projection)
 * and the same profiles — rather than over the profile alone.
 */
type GraphState = {
  nodes: TrailNode[];
  edges: TrailEdge[];
  nodeOfCell: Map<number, number>;
  edgeOfCell: Map<number, number>;
};
/** A branch as it would be built: the state that results, and which of its
 * edges are the branch's own (an edge `splitAt` halved is collinear with the
 * whole it replaced, so only the new ones need measuring). */
type Plan = { state: GraphState; added: number[] };

export function buildTrail(seed: number, frame: BuildFrame): { graph: TrailGraph; landmarks: Landmark[]; features: Feature[] } {
  const features: Feature[] = [];
  const ground: GroundFn = (x, z) => featureStageD(features, x, z, frame.sample(x, z));
  const groundH = (x: number, z: number): number => ground(x, z).h;
  const grid = buildTrailGrid(frame.roadCenterX, ground);
  const smoothCache = new Map<number, number>();
  const H: Heights = {
    ground: groundH,
    point: (x, z) => smoothedH(groundH, x, z),
    cell: (c) => {
      let h = smoothCache.get(c);
      if (h === undefined) {
        h = smoothedH(groundH, grid.x[c] as number, grid.z[c] as number);
        smoothCache.set(c, h);
      }
      return h;
    },
  };

  // The trailhead: the pad centre, node 0. The search starts from its cell,
  // which is forced passable — the pad is flat, and the one-cell margin must
  // not seal the start because a neighbour beyond the pad is steep.
  const thZ = TRAIL_Z_ANCHOR;
  const thX = frame.roadCenterX(thZ) + TRAILHEAD_U;
  const start = cellAt(grid, frame.roadCenterX, thX, thZ);
  if (start < 0) throw new Error("trailhead outside the trail grid");
  /**
   * THE PAD IS THE DOORWAY, and the grid must not read it as a wall. `padD`
   * levels a disc at its own centre height and blends it out over
   * TRAILHEAD_FADE, so on any real hillside the ring it leaves is ~1.9 × the
   * local grade — over TRAIL_GRID_CAP, over MAX_WALKABLE_GRADIENT, and it
   * surrounds the car completely. The ring is the pad's own step, not the
   * hillside's, and the bed's profile is what smooths it (this is the
   * trail's first edge); whether the ground BEYOND the doorway can be walked
   * is still the fine check's question and the bed scan's.
   */
  const doorway = (): void => {
    const R = TRAILHEAD_RADIUS + TRAILHEAD_FADE + TRAIL_GRID_CELL;
    for (let c = 0; c < grid.pass.length; c++) {
      const dx = (grid.x[c] as number) - thX, dz = (grid.z[c] as number) - thZ;
      if (dx * dx + dz * dz <= R * R) grid.pass[c] = 1;
    }
  };
  doorway();
  /**
   * Re-read the cells a feature's dome just raised (or just took away), then
   * put back the passability the dome is not allowed to take: A DOME NEVER
   * SEALS GROUND THAT WAS WALKABLE. The peak's steepest ring (measured)
   * is 0.606 — under the fine check's 0.9 and well under
   * MAX_WALKABLE_GRADIENT, but OVER the grid's deliberately conservative
   * TRAIL_GRID_CAP of 0.6, so `recomputePass` marks the whole skirt and its
   * one-cell margin impassable and the search cannot reach the crest itself.
   * Cells that were already impassable stay impassable — the dome adds
   * height, it does not repair a cliff.
   */
  const resampleAround = (f: Feature): void => {
    // A pond's own basin stage (`basinD`) blends the rim back to the
    // hillside over an OUTER APRON, [R, R + POND_APRON] — ground out to
    // R + POND_APRON is still the pond's, not just R + TRAIL_GRID_CELL.
    // Missing this (the "popped-but-retried ghost" a later loop's candidate
    // scan or slope check could read): a REJECTED pond candidate got pushed, resampled
    // (levelling ground out to its true apron edge), then popped and
    // resampled again with too SHORT a reach — cells in
    // [R + TRAIL_GRID_CELL, R + POND_APRON] never got recomputed, so they
    // kept reading the levelled-and-abandoned pond's height/gradient/
    // passability even though `f` was no longer in `features` at all. A
    // A meadow's flat now blends over an outer apron too, [R, R + MEADOW_RIM],
    // so it needs the same
    // margin. A peak's dome is remapped onto [PEAK_CREST_RADIUS, f.radius] and
    // stops at its own radius, so it does not.
    const apron = f.kind === "pond" ? POND_APRON : f.kind === "meadow" ? MEADOW_RIM : 0;
    const reach = f.radius + apron + TRAIL_GRID_CELL;
    const keep: number[] = [];
    for (let c = 0; c < grid.pass.length; c++) {
      const dx = (grid.x[c] as number) - f.x, dz = (grid.z[c] as number) - f.z;
      if (dx * dx + dz * dz <= reach * reach && grid.pass[c] === 1) keep.push(c);
    }
    resampleCells(grid, ground, f.x, f.z, reach);
    for (const c of keep) grid.pass[c] = 1;
    doorway();
    smoothCache.clear(); // the dome moved the ground under every cached height
  };

  let state: GraphState = {
    nodes: [{ x: thX, z: thZ, h: H.point(thX, thZ), u: TRAILHEAD_U }],
    edges: [],
    nodeOfCell: new Map<number, number>([[start, 0]]),
    edgeOfCell: new Map<number, number>(),
  };
  const tree = new Uint8Array(grid.pass.length);
  tree[start] = 1;
  /** Every accepted edge as cells, for the simplifier's gap check. */
  const treeEdges: Array<[number, number]> = [];

  const samplers: Samplers = {
    treeDensity: frame.treeDensity,
    boulderDensity: frame.boulderDensity,
    // Every cell whose centre is within r + one cell of the disc reads flatter
    // than the density's own hard-zero gradient ⇒ the disc is empty. The extra
    // cell is margin: the grid's gradients are at cell centres and the disc's
    // samples are not, so a claim about the disc has to cover the cells around
    // it too. Conservative in the right direction — a `true` only costs a scan.
    mayHaveBoulders: (cx, cz, r) => {
      const reach = r + TRAIL_GRID_CELL;
      const z0 = TRAIL_Z_ANCHOR - BOWL_Z_HALF;
      const j0 = Math.max(0, Math.floor((cz - reach - z0) / TRAIL_GRID_CELL));
      const j1 = Math.min(grid.nz - 1, Math.floor((cz + reach - z0) / TRAIL_GRID_CELL));
      for (let j = j0; j <= j1; j++) {
        const row = j * grid.nu;
        // The row's own first cell centre carries the road's offset at this z,
        // so the u index comes out of it without a second road lookup.
        const base = grid.x[row] as number;
        const i0 = Math.max(0, Math.ceil((cx - reach - base) / TRAIL_GRID_CELL));
        const i1 = Math.min(grid.nu - 1, Math.floor((cx + reach - base) / TRAIL_GRID_CELL));
        for (let i = i0; i <= i1; i++) {
          const c = row + i;
          const dx = (grid.x[c] as number) - cx, dz = (grid.z[c] as number) - cz;
          if (dx * dx + dz * dz > reach * reach) continue;
          if ((grid.grad[c] as number) > frame.boulderSlopeMin) return true;
        }
      }
      return false;
    },
  };
  const first = searchFrom(grid, start, null);
  const salted = seed ^ TRAIL_SALT;

  // ---- The peak: the stem's target -----------------------------------------
  /**
   * The peak's centre: the highest reachable cell
   * (by `first`, the unconstrained search) inside the inland band
   * u ∈ [TRAILHEAD_U + PEAK_INLAND_MIN, min(TRAILHEAD_U + PEAK_INLAND_MAX,
   * BOWL_U_MAX − TRAIL_GRID_CELL)] (so the crest cell is on the grid) with
   * |z − TRAIL_Z_ANCHOR| ≤ BOWL_Z_HALF − radius (so the dome stays inside the
   * bowl's z range), ranked by height then a seeded hash tie-break.
   *
   * ON A TERRACED WORLD THE BAND CAN BE ENTIRELY UNREACHABLE (measured over
   * the 227-seed sweep: 216 of 227 have a reachable cell in the band; on the
   * other 11 the terraces wall the grid off and the farthest reachable u is
   * as low as 218 m). Rather than throw, this falls back to the reachable
   * cell with the GREATEST u under the same z limit, ties by height then
   * hash — the peak is then "as far in as the world allows". This is NOT
   * `graph.fallbacks`, which is reserved for the other fallback below (no
   * walkable route to the crest even after lowering the rise).
   *
   * PEAK_CENTRE_TRIES CENTRES, BEST FIRST (2026-09-11): the caller tries
   * each in turn with its own lowering budget before it
   * gives up on a peak entirely, so the ranking is a list rather than a
   * winner. The band fallback above yields one centre and only one — "as far
   * in as the world allows" has no runner-up.
   */
  const peakCentres = (radius: number): Array<{ cell: number; x: number; z: number }> => {
    const zLimit = BOWL_Z_HALF - radius;
    const lo = TRAILHEAD_U + PEAK_INLAND_MIN;
    const hi = Math.min(TRAILHEAD_U + PEAK_INLAND_MAX, BOWL_U_MAX - TRAIL_GRID_CELL);
    const tie = (c: number): number => hash3(c % grid.nu, (c - (c % grid.nu)) / grid.nu, 7, salted);
    // The top PEAK_CENTRE_TRIES by (height, hash, cell index), kept sorted by
    // insertion — a total order, and the list never exceeds three, so this is
    // cheaper than sorting every reachable band cell.
    const top: Array<{ c: number; h: number; t: number }> = [];
    let fb = -1, fbU = -Infinity, fbH = -Infinity, fbTie = -Infinity;
    for (let c = 0; c < grid.pass.length; c++) {
      if (!Number.isFinite(first.dist[c] as number)) continue;
      const x = grid.x[c] as number, z = grid.z[c] as number;
      if (Math.abs(z - TRAIL_Z_ANCHOR) > zLimit) continue;
      const u = x - frame.roadCenterX(z);
      const h = grid.h[c] as number;
      const t = tie(c);
      if (u > fbU || (u === fbU && (h > fbH || (h === fbH && t > fbTie)))) { fb = c; fbU = u; fbH = h; fbTie = t; }
      if (u < lo || u > hi) continue;
      const above = (a: { h: number; t: number; c: number }, b: { h: number; t: number; c: number }): boolean =>
        a.h > b.h || (a.h === b.h && (a.t > b.t || (a.t === b.t && a.c > b.c)));
      const entry = { c, h, t };
      let at = top.length;
      while (at > 0 && above(entry, top[at - 1] as { h: number; t: number; c: number })) at--;
      if (at < PEAK_CENTRE_TRIES) {
        top.splice(at, 0, entry);
        if (top.length > PEAK_CENTRE_TRIES) top.pop();
      }
    }
    const cells = top.length > 0 ? top.map((e) => e.c) : fb >= 0 ? [fb] : [];
    if (cells.length === 0) throw new Error("no reachable ground for the peak");
    return cells.map((cell) => ({ cell, x: grid.x[cell] as number, z: grid.z[cell] as number }));
  };

  const rise0 = featureDraw(seed, 0, 0, PEAK_RISE_MIN, PEAK_RISE_MAX);
  const radius = featureDraw(seed, 0, 1, PEAK_RADIUS_MIN, PEAK_RADIUS_MAX);
  const centres = peakCentres(radius);

  /**
   * For each candidate centre in turn: place the dome, then route to its
   * crest cell; if the route fails, lower the rise by PEAK_LOWER_STEP and
   * retry, up to PEAK_LOWER_TRIES times.
   *
   * IF EVERY CENTRE FAILS, THE WORLD HAS NO PEAK FEATURE AT ALL (2026-09-11).
   * The stem still ends at the highest reachable
   * node, exactly as before — that part of the fallback was always right —
   * but nothing is pushed into `features`. What used to be pushed was a
   * `height: 0` dome, which made `peakD` a numeric no-op while leaving the
   * MASK and the PAINT a full-radius peak with a `crestH` equal to the
   * ordinary hillside there: `below = crestH − h ≈ 0` across the whole disc,
   * so the trees were masked out and the ground painted rock — a 300 m bald
   * grey flat with no mountain under it, measured on 73–96 % of the disc's
   * sample points. It fired on 6 of 120 fresh seeds (5.0 %) while the 227-seed
   * sweep, which asserts `fallbacks === 0` over its 227 curated seeds, reported
   * none. `featureTable` and `featureMaskAt` both cope with no peak by
   * construction (they iterate `features`).
   *
   * `graph.fallbacks` still counts it, and the 227-seed sweep still requires
   * 0 there; the fresh-seed rate is measured and reported instead of
   * asserted.
   */
  let stemAttempt: Attempt | null = null;
  let fallbacks = 0;
  for (const pc of centres) {
    for (let t = 0; t <= PEAK_LOWER_TRIES && stemAttempt === null; t++) {
      const f: Feature = { id: 0, kind: "peak", x: pc.x, z: pc.z, radius, height: rise0 - t * PEAK_LOWER_STEP };
      features.push(f);
      resampleAround(f);
      f.crestH = ground(f.x, f.z).h;
      const marked: number[] = [];
      const r = routeTo(grid, frame, H, ground, state, tree, treeEdges, start, pc.cell, marked, null);
      for (const c of marked) grid.pass[c] = 1;
      if (r.ok) { stemAttempt = r.best; break; }
      features.pop();
      resampleAround(f);
    }
    if (stemAttempt !== null) break;
  }
  if (stemAttempt === null) {
    fallbacks++;
    const marked: number[] = [];
    const pc = centres[0] as { cell: number; x: number; z: number };
    const r = routeTo(grid, frame, H, ground, state, tree, treeEdges, start, pc.cell, marked, null);
    for (const c of marked) grid.pass[c] = 1;
    stemAttempt = r.best;
  }

  state = planPath(state, stemAttempt.cells, grid, frame, H).state;
  markPath(stemAttempt.cells, grid, frame, tree, treeEdges);
  const summit = state.nodeOfCell.get(stemAttempt.cells[stemAttempt.cells.length - 1] as number) as number;
  /**
   * THE CREST NODE IS H.cell LIKE EVERY OTHER NODE (2026-09-11):
   * an earlier version pinned the crest to a de-clodded/raw blend,
   * because a POINTED apex under a node-pinned, smoothed bed put the flush
   * ceiling and the walkable-gradient cap in direct tension (de-clodding the
   * tip read measurably below it; un-clodding it disagreed with the profile's
   * own smoothed interior samples, a local kink). `peakD` now holds a flat
   * platform over PEAK_CREST_RADIUS instead of a point, so the crest cell's
   * own de-clodding disc sits on FLAT ground — exact, not an average — and
   * no special-casing is needed here at all.
   */
  // ---- Loops: two half-loops round each made feature, rejoining the stem ---
  /**
   * For each kind `planFeatures(seed).loops` calls for, in order: find a
   * candidate disc beside the stem (flat ground for a meadow, gentle ground
   * for a pond), then route TWO HALVES, each from the stem to a turn node on
   * the disc's far side — one leaving at a junction A below the feature, the
   * other at a junction B at least LOOP_JUNCTION_GAP of stem above it — and
   * reject on the first thing that goes wrong (no candidate, no legal A/B,
   * either half fails to route, the junctions too close, the halves not
   * connected, the loop not actually round its feature, or its length outside
   * the band) by popping the pushed feature and moving to the next candidate —
   * the plan SHRINKS rather than throwing. Both junctions are read back off
   * the branches the routes actually produced, not assumed.
   *
   * `stemGeometry` is called fresh at the top of every iteration, and again on
   * the candidate's own graph once both halves are planned. It has to be:
   * a junction is a POINT on the stem, not one of its vertices, so `planPath`'s
   * `splitAt` DIVIDES a stem edge at A and again at B on every accepted loop —
   * the stem's edge list, its node list and every edge's `progress` all move
   * underneath this loop. (An earlier design drew A and B from `stemNodes` and
   * so never split anything; the recompute was defensive then and is load-
   * bearing now. See "JUNCTIONS ARE POINTS ON THE STEM" below.)
   */
  const loops: TrailLoop[] = [];
  const plan = planFeatures(seed).loops;
  for (let li = 0; li < plan.length; li++) {
    const geom = stemGeometry(state, summit);
    const { padN, ux, uz, nx, nz } = geom;
    const stemSample = sampleStem(state, geom);
    // The cells the tree occupies, listed once per loop rather than found by a
    // full grid pass inside every candidate try (2026-09-11). `tree` only
    // changes when a loop is ACCEPTED, and accepting one ends this loop's tries.
    const treeCells: number[] = [];
    for (let c = 0; c < tree.length; c++) if (tree[c] === 1) treeCells.push(c);
    const kind = plan[li] as "meadow" | "pond";
    const id = features.length;
    const band = loopBand(li);
    const radius = kind === "meadow"
      ? featureDraw(seed, id, 0, MEADOW_RADIUS_MIN, MEADOW_RADIUS_MAX)
      : featureDraw(seed, id, 0, POND_RADIUS_MIN, POND_RADIUS_MAX);
    const slopeMax = kind === "meadow" ? MEADOW_SLOPE_MAX : POND_SLOPE_MAX;

    // Candidates: cells whose projection on the pad→crest axis lands in this
    // loop's band, whose lateral offset (either side) is in
    // [LOOP_LATERAL_MIN, LOOP_LATERAL_MAX], clear of the road, clear of every
    // placed feature (FEATURE_SPACING; the peak by its shoulder rule instead),
    // clear of the stem, and flat enough for the disc. Score: flattest
    // first, tie by a seeded hash, tie by cell index.
    // A loop that finds nothing in its OWN band widens to the whole loop range
    // before it is dropped (2026-09-11) — the
    // same shape as the scenery pass's own spacing ladder below. The i-th
    // feature goes in the i-th band so the loops are spread along the stem,
    // and that is what the first pass does; dropping the loop entirely rather
    // than placing it somewhere else on the stem serves nothing. Stem order and
    // FEATURE_SPACING both still hold. Measured over the 227-seed sweep: seeds with
    // at least one loop 75.8 % → 80.2 %, loops built 260 → 272 of 426.
    const cands: Array<{ c: number; score: number }> = [];
    for (const wide of [false, true]) {
    if (cands.length > 0) break;
    const lo = wide ? LOOP_BAND_LO_1 : band.lo, hi = wide ? LOOP_BAND_HI_3 : band.hi;
    // LOOP_SCAN_STRIDE, not a bare `c += 2` (2026-09-11): the grid is
    // row-major, so striding the flat index samples every
    // other COLUMN, and which columns depends on the parity of grid.nu. It is
    // deterministic either way, but it is a literal that steers where features
    // stand, and the measured candidate ceiling below was taken with it on.
    for (let c = 0; c < grid.pass.length; c += LOOP_SCAN_STRIDE) {
      if (grid.pass[c] === 0) continue;
      const x = grid.x[c] as number, z = grid.z[c] as number;
      const px = x - padN.x, pz = z - padN.z;
      const along = (px * ux + pz * uz) / geom.axL;
      if (along < lo || along > hi) continue;
      const lat = Math.abs(px * nx + pz * nz);
      // The lateral window measures the disc's NEAR EDGE, not its centre
      // (2026-09-11). The
      // feature stands "60-120 m lateral of that line", and every feature
      // disc must be disjoint from every edge: a 110 m-radius meadow whose CENTRE
      // is at most 120 m off the pad→crest line always swallows the trail, so
      // the two sentences can only both hold if the 120 m is to the near edge.
      // Measured over the 227-seed sweep: at a centre cap of 120 the scan found no
      // candidate at all on 234 of 426 loop attempts, at `radius + 120` on 178.
      if (lat < LOOP_LATERAL_MIN || lat > LOOP_LATERAL_MAX + radius) continue;
      if (x - frame.roadCenterX(z) < FEATURE_ROAD_CLEAR) continue;
      let ok = true;
      const ownReach = featureReach({ kind, radius });
      for (const f of features) {
        const dx = x - f.x, dz = z - f.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < FEATURE_SPACING * FEATURE_SPACING) { ok = false; break; }
        if (f.kind === "peak") {
          const shoulder = PEAK_SHOULDER * f.radius + radius;
          if (d2 < shoulder * shoulder) { ok = false; break; }
        } else {
          const apart = ownReach + featureReach(f);
          if (d2 < apart * apart) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // The clearance a candidate owes the stem includes its own APRON: a
      // feature's ground influence reaches `radius + apron`, and the stem was
      // routed and its bed pinned BEFORE this feature existed (2026-09-11).
      // Measured when the meadow's apron moved
      // outside its radius without this: 529 stem-edge samples in the sweep
      // read more than a metre off their own ground, worst 5.98 m, every one of
      // them a stem edge lying 20-23 m past a meadow's rim — inside the 35 m
      // apron the meadow had just dropped on top of it. A pond's apron was
      // always outside its radius and had the same hole, one sample wide.
      const apronOf = kind === "meadow" ? MEADOW_RIM : POND_APRON;
      const clear = radius + apronOf + TRAIL_CORRIDOR_HALF;
      for (const ei of geom.stem) {
        const e = state.edges[ei] as TrailEdge;
        const a = state.nodes[e.a] as TrailNode, b = state.nodes[e.b] as TrailNode;
        if (segmentDistance(a.x, a.z, b.x, b.z, x, z) < clear) { ok = false; break; }
      }
      if (!ok) continue;
      const g = meanGradientInDisc(grid, x, z, radius);
      if (g > slopeMax) continue;
      const blocked = 1 - ringPassFraction(grid, x, z, radius, kind === "meadow" ? MEADOW_RIM : POND_APRON);
      cands.push({ c, score: g + blocked + 1e-4 * hash3(c % grid.nu, (c - (c % grid.nu)) / grid.nu, 11 + li, salted) });
    }
    }
    cands.sort((p, q) => p.score - q.score || p.c - q.c);

    let built = false;
    for (let ci = 0; ci < Math.min(cands.length, LOOP_TRIES) && !built; ci++) {
      const cell = cands[ci]!.c;
      const fx = grid.x[cell] as number, fz = grid.z[cell] as number;
      // FEATURE_SPACING (and the peak's own shoulder rule) re-checked against
      // `features` AS IT STANDS RIGHT NOW, at TRY time (2026-09-11) — not
      // only at the scan above,
      // which is a single snapshot taken before ANY of this loop's own
      // candidates were tried. A popped feature must not count: every
      // rejection path below pops its own pushed feature before the next
      // `ci`, so this reads the array with exactly the currently-standing
      // features, never a retried-and-abandoned one.
      let spacingOk = true;
      const tryReach = featureReach({ kind, radius });
      for (const g of features) {
        const dx = fx - g.x, dz = fz - g.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < FEATURE_SPACING * FEATURE_SPACING) { spacingOk = false; break; }
        if (g.kind === "peak") {
          const shoulder = PEAK_SHOULDER * g.radius + radius;
          if (d2 < shoulder * shoulder) { spacingOk = false; break; }
        } else {
          const apart = tryReach + featureReach(g);
          if (d2 < apart * apart) { spacingOk = false; break; }
        }
      }
      if (!spacingOk) continue;
      // The feature's height is the MEAN pre-feature ground height over the
      // WHOLE disc, not the centre's own height (2026-09-11): the centre
      // reads however the candidate
      // happened to score, but the rim has to ramp both up and down to meet
      // real ground all the way round — using only the centre's height
      // routinely put the whole disc on one side of the true grade (all cut
      // or all fill), when the mean over the disc is what actually splits
      // the ramp between cut and fill.
      const baseH = meanPreFeatureHeight(grid, frame, fx, fz, radius);
      const f: Feature = { id, kind, x: fx, z: fz, radius, height: baseH };
      features.push(f);
      resampleAround(f);

      // JUNCTIONS ARE POINTS ON THE STEM, NOT STEM VERTICES — the
      // mechanism is "junctions split the stem edge at the join (`splitAt` node
      // sharing)" (2026-09-11). Two
      // things were wrong with the earlier rule:
      //
      // (a) It looked a node up by CUMULATIVE STEM LENGTH from a target
      //     computed as an AXIS PROJECTION. The stem is always longer than its
      //     own chord, so the two metrics diverge by however far it wanders
      //     (4-45 m measured on the diagnosed seeds, far more at a switchback),
      //     and on four of the nine sampled cases that put A PAST the feature —
      //     on 0x5eed/flatFrame loop 0 the feature projected at 310 and A at
      //     383, both junctions above it, nothing to ring.
      // (b) It could only pick an EXISTING vertex, and a simplified stem
      //     carries 6-33 of them over a kilometre. The nearest one to a tangent
      //     can be hundreds of metres away, which makes the "loop" a detour of
      //     the whole hillside (measured before this change: a 3182 m loop).
      //
      // So the stem is sampled densely, and the junction is the SAMPLE nearest
      // the tangent: A nearest the lower tangent among samples at or below the
      // feature's own projection (A is always on the pad side of it), B the
      // first sample past the upper tangent that is also LOOP_JUNCTION_GAP of
      // stem above A. `planPath` splits the stem at A's cell by itself (a
      // branch's first cell); B's is split up front, on the candidate's own
      // copy of the graph, because half two TARGETS it and `planPath` only
      // splits at a branch's start.
      const alongLen = (fx - padN.x) * ux + (fz - padN.z) * uz;
      const lowT = alongLen - radius - RING_BAND, hiT = alongLen + radius + RING_BAND;
      let sA = -1;
      for (let i = 0; i < stemSample.length; i++) {
        const sp = stemSample[i] as StemSample;
        if (sp.proj > alongLen) continue;
        if (sA < 0 || Math.abs(sp.proj - lowT) < Math.abs((stemSample[sA] as StemSample).proj - lowT)) sA = i;
      }
      let sB = -1;
      if (sA >= 0) {
        const arcA0 = (stemSample[sA] as StemSample).arc;
        for (let i = sA + 1; i < stemSample.length; i++) {
          const sp = stemSample[i] as StemSample;
          // One grid cell of margin over LOOP_JUNCTION_GAP: the junctions end
          // up at the CELLS these samples fall in, and the gap is re-measured
          // on the split stem afterwards.
          if (sp.proj < hiT || sp.arc - arcA0 < LOOP_JUNCTION_GAP + TRAIL_GRID_CELL) continue;
          sB = i;
          break;
        }
      }
      // The summit is the world's ONLY dead end: a junction within
      // a split's own snap reach of it would give it a second edge.
      if (sA < 0 || sB < 0 || (stemSample[sB] as StemSample).arc > geom.stemLen - SPLIT_SNAP) { features.pop(); resampleAround(f); continue; }
      const cA = cellAt(grid, frame.roadCenterX, (stemSample[sA] as StemSample).x, (stemSample[sA] as StemSample).z);
      const cB = cellAt(grid, frame.roadCenterX, (stemSample[sB] as StemSample).x, (stemSample[sB] as StemSample).z);
      if (cA < 0 || cB < 0 || cA === cB) { features.pop(); resampleAround(f); continue; }
      // The candidate's own copy of the graph: B is split into it before
      // anything routes, so a rejected candidate leaves `state` untouched.
      const base = planPath(state, [], grid, frame, H).state;
      const B = base.nodeOfCell.get(cB) ?? splitAt(cB, grid, frame, H, base);
      const bn = base.nodes[B] as TrailNode;
      // A's own point on the stem — the sample, not a node: `planPath` has not
      // split there yet (it does it when half one's branch is planned), so
      // there is no node to read. It is what the turn's side is measured from.
      const an = { x: (stemSample[sA] as StemSample).x, z: (stemSample[sA] as StemSample).z };

      // The ring weight. The disc plus ONE GRID CELL of margin is forbidden
      // (weight 0 — `searchFrom` skips the cell outright), and RING_COST runs
      // across the band just outside it: cells
      // inside the feature disc are impassable; cells in the band [R, R + 12 m]
      // cost × 0.35, with the extra cell so that a chord the simplifier draws
      // ACROSS the band still clears the disc — this task's
      // own test cases require `segmentDistance(edge, centre) ≥ f.radius` for
      // every edge and every non-peak feature.
      //
      // This SUPERSEDES an earlier rule that put a meadow's ring on the stage's own
      // rim ramp — RING_COST on [R − MEADOW_RIM, R + RING_BAND], forbidden only
      // below R − MEADOW_RIM − TRAIL_GRID_CELL, i.e. INSIDE the radius
      // (2026-09-11). While no loop ever
      // built, that was invisible; the first meadow loop to build under it
      // would have failed the disjointness gate. The ground just outside the
      // disc is not arbitrary either: the feature is levelled to the MEAN
      // pre-feature height over its own disc, so the stage's ramp meets real
      // ground at R and the band immediately outside is the gentlest ground
      // anywhere near the feature.
      // A MEADOW'S LOOP WALKS ITS OWN APRON (2026-09-11): the flat is the whole disc and the ramp to the
      // hillside lies OUTSIDE it over [R, R + MEADOW_RIM], so the band the loop
      // prefers is that ramp — levelled ground, and outside the radius, which
      // is what keeps every disc disjoint from every edge.
      //
      // BOTH KINDS FORBID THE DISC PLUS ONE CELL, and the ring starts where the
      // forbidding stops. The meadow's forbidden radius was `R − TRAIL_GRID_CELL`
      // (2026-09-11): a cell short of
      // the true boundary on the INSIDE, where the pond's mirror-image formula is
      // a cell PAST it on the outside. The asymmetry left an ~10 m band
      // straddling the radius at ordinary weight 1 — neither forbidden nor
      // discounted — and where cutting across it beat going round the ring, the
      // search took it. Measured over the 227-seed sweep: 41 of 164 built meadow
      // loops had an edge inside their own feature's disc, worst penetration
      // 8.12 m ≈ one TRAIL_GRID_CELL, exactly the shortfall; 0 of 108 pond loops.
      // Every feature disc must be disjoint from every edge, and the loop
      // walks the apron beyond R anyway, so nothing legitimate is lost.
      const meadowApron = kind === "meadow";
      const forbidR = radius + TRAIL_GRID_CELL;
      const ringLo = forbidR;
      const ringHi = meadowApron ? radius + MEADOW_RIM + RING_BAND : forbidR + RING_BAND;
      // Only the window the feature can reach is written; every cell outside it
      // keeps the initialised 1.
      const weight = new Float32Array(grid.pass.length).fill(1);
      forEachCellNear(grid, fx, fz, ringHi, (c, d2) => {
        if (d2 < forbidR * forbidR) weight[c] = 0;
        else if (d2 >= ringLo * ringLo) weight[c] = RING_COST;
      });
      // The turn node: the middle of that band, on the far side of the disc
      // from the stem, along the LOCAL A→B normal — not the global pad→crest
      // axis (a deliberate deviation from an earlier version): the
      // axis is only ever a straight-line approximation, and a stem that
      // wanders can leave B on the SAME lateral side of the axis as the
      // feature, which puts the turn on the wrong side of the stretch the two
      // halves actually straddle. With A and B now chosen to straddle the
      // feature's own projection, the A→B normal is the feature's true lateral
      // direction.
      let lux = bn.x - an.x, luz = bn.z - an.z;
      const luL = Math.sqrt(lux * lux + luz * luz);
      if (luL > 1e-6) { lux /= luL; luz /= luL; } else { lux = ux; luz = uz; }
      const lnx = -luz, lnz = lux;
      const side = ((fx - an.x) * lnx + (fz - an.z) * lnz) >= 0 ? 1 : -1;
      const turnOff = meadowApron ? radius + MEADOW_RIM / 2 : (ringLo + ringHi) / 2;
      const tx = fx + side * lnx * turnOff, tz = fz + side * lnz * turnOff;
      // The turn is the PASSABLE ring cell nearest that ideal point, not the
      // cell the ideal point happens to land in (2026-09-11). Measured over the
      // 227-seed sweep: of 255 candidates
      // whose first half could not reach its turn at all, the turn's own cell
      // was impassable in 127 — half the failures were a target standing on a
      // boulder or a scarp, with the ring band around it 70-100% passable. The
      // band is an annulus, so "nearest passable cell in it" slides the turn a
      // few metres round the rim rather than abandoning the candidate.
      let turn = -1, turnD2 = Infinity;
      forEachCellNear(grid, fx, fz, ringHi, (c, q2) => {
        if (q2 < ringLo * ringLo) return;
        if (grid.pass[c] === 0 || (weight[c] as number) <= 0) return;
        const ex = (grid.x[c] as number) - tx, ez = (grid.z[c] as number) - tz;
        const d2 = ex * ex + ez * ez;
        if (d2 < turnD2 || (d2 === turnD2 && c < turn)) { turnD2 = d2; turn = c; }
      });
      // THE TREE IS FORBIDDEN TO A LOOP SEARCH, THROUGH THE WEIGHT ARRAY
      // (2026-09-11) — this is what turns that rule on.
      //
      // `searchFrom` DISCOUNTS a cell already on the tree (TRAIL_REUSE_FACTOR
      // 0.35: running along an existing bed costs a third of fresh ground) and
      // `routeTo` then keeps only the BRANCH — the suffix of the path after the
      // LAST tree cell on it. Both rules are right for the stem, whose search
      // starts on the tree and ends on fresh ground. For a half-loop they
      // compose into a trap, measured on nine sampled candidates across three
      // real seeds and both synthetic worlds: the cheapest route from A rode
      // the STEM at 0.35× before striking out, so the trim threw the ridden
      // part away and half one's branch began 8-208 m from A (with `planPath`
      // inventing a fresh `splitAt` node there, so `junctionA` named a node the
      // loop never touched); and the cheapest route from the turn RETRACED half
      // one and rode the stem to B, so half two's branch was a 2-cell stub at
      // B, its start 148-319 m from the turn. That stub is what earlier tuning
      // was chasing with an overlap exemption — hence `shared/total =
      // 0/0` on 410 of 417 rejections.
      //
      // A cell whose weight is 0 is skipped by `searchFrom` OUTRIGHT, which is
      // what "cannot reuse the first half's cells" actually asks
      // for. So each half forbids every tree cell but its own endpoints, and
      // half two forbids half one's cells too. The only tree cell left on
      // either path is its first, the trim keeps the whole route, and each half
      // runs between the nodes the design names. The two-cell rule then does
      // the rest: a route that has left the tree may not come back near it,
      // which is the separation from the stem a loop wants anyway.
      //
      // It costs reach: over the 227-seed sweep 131 candidate turns that a
      // tree-riding search could reach become unreachable. Letting the search
      // ride and reading the junction back off the branch instead was measured
      // too — it departs at the stem's CLOSEST APPROACH to the turn, which is
      // beside the feature rather than below it, and the loop then fails to
      // enclose the feature at all (ring rejections 74 → 161, loops built
      // 89 → 52). Departing from the junction the placement rule chose is what
      // makes the two halves straddle the disc.
      // THE TWO HALVES TAKE OPPOSITE ENDS OF THE DISC (2026-09-11 — "the two
      // halves must lie on opposite sides of
      // the line from the centre to the stem"). Split the world on the line
      // through the feature's centre PERPENDICULAR to the A→B stretch, which is
      // the line from the centre to the stem: half one may only walk the side A
      // is on, half two only the side B is on, with one grid cell of overlap at
      // the turn where they meet. Without it both halves take whichever end is
      // cheaper — measured on seed 0 / shortStemFrame, both wrapped the pond's
      // east end and the "loop" was a there-and-back that enclosed nothing.
      // Nothing else in the search knows which way round a disc to go.
      const luT = ((grid.x[turn] as number) - fx) * lux + ((grid.z[turn] as number) - fz) * luz;
      // The rule applies within the neighbourhood the two halves actually round
      // the feature in — the ring band itself, plus a cell. Beyond that a half
      // is free to detour either way and `enclosesPoint` below is the gate.
      // As a whole-map wall it cost 44 more routes than it saved rings (loops
      // built 131 → 127 over the sweep); `radius + LOOP_LATERAL_MAX`
      // was the first windowing, and once the meadow's forbidden disc grew to
      // `R + TRAIL_GRID_CELL` that slab was wide enough
      // to close the corridor the halves need — narrowing it to the ring's own
      // reach reads 78.0 % / 62.2 % over the sweep against 75.8 % / 59.9 %, with
      // the rings it lets through caught by the enclosure test (rejections for
      // not ringing the feature 1 → 34, all of them correctly refused).
      const nearR = ringHi + TRAIL_GRID_CELL;
      const luOf = (c: number): number => ((grid.x[c] as number) - fx) * lux + ((grid.z[c] as number) - fz) * luz;
      // The stem itself is not forbidden but PENALISED (TREE_PENALTY, see
      // features.ts) rather than walled off.
      // Written in two passes over the only cells that can change — the tree's
      // own (listed once per loop) and the half-plane window — rather than a
      // pass over the whole grid. The half-plane runs SECOND because it wins:
      // a tree cell on the far side of the line is forbidden, not penalised.
      const w1 = weight.slice();
      for (const c of treeCells) w1[c] = TREE_PENALTY;
      forEachCellNear(grid, fx, fz, nearR, (c) => { if (luOf(c) > luT + TRAIL_GRID_CELL) w1[c] = 0; });
      w1[cA] = weight[cA] as number;
      const marked: number[] = [];
      const h1 = turn >= 0 ? routeTo(grid, frame, H, ground, base, tree, treeEdges, cA, turn, marked, w1) : null;
      const plan1 = h1 !== null && h1.ok ? planPath(base, h1.best.cells, grid, frame, H) : null;
      let h2: { ok: boolean; best: Attempt } | null = null;
      if (plan1 !== null) {
        // Half two runs the SAME WAY ROUND as half one: from the stem to the
        // turn. Both halves therefore start on the tree and end on fresh
        // ground, which is the shape `routeTo`'s branch trim, `simplify`'s
        // departure exemption and `planPath`'s `splitAt` were all written for;
        // an earlier turn → B direction inverted it, and the trim then throws
        // the whole route away and keeps a stub at B.
        //
        // Half one's own cells ARE forbidden to it (weight 0), so it cannot
        // retrace them and has to come round the other side of the disc. The
        // TURN's own neighbourhood is exempt in both the tree copy and the
        // weight — the turn is half one's last cell, so every cell beside it
        // "touches the tree" through it and the two-cell rule would forbid the
        // final step onto it from outside. The two exemptions use the same
        // radius on purpose: a cell exempt in one but not the other would
        // become the "last tree cell" the trim cuts the branch at.
        const t2 = tree.slice();
        const w2 = weight.slice();
        for (const c of treeCells) w2[c] = TREE_PENALTY;
        forEachCellNear(grid, fx, fz, nearR, (c) => { if (luOf(c) < luT - TRAIL_GRID_CELL) w2[c] = 0; });
        for (let m = 0; m + 1 < h1!.best.cells.length; m++) {
          for (const c of cellsAlong(grid, frame, h1!.best.cells[m] as number, h1!.best.cells[m + 1] as number)) { t2[c] = 1; w2[c] = 0; }
        }
        const tX = grid.x[turn] as number, tZ = grid.z[turn] as number;
        const clearR = 2 * TRAIL_GRID_CELL;
        forEachCellNear(grid, tX, tZ, clearR, (c) => { t2[c] = 0; w2[c] = weight[c] as number; });
        h2 = (w2[cB] as number) > 0
          ? routeTo(grid, frame, H, ground, plan1.state, t2, treeEdges, cB, turn, marked, w2)
          : { ok: false, best: { cells: [], worst: Infinity, pathLen: 0 } };
      }
      for (const c of marked) grid.pass[c] = 1;
      if (plan1 === null || h2 === null || !h2.ok) { features.pop(); resampleAround(f); continue; }

      const plan2 = planPath(plan1.state, h2.best.cells, grid, frame, H);
      const allAdded = [...plan1.added, ...plan2.added];
      // The edges are labelled `loop` BEFORE the stem is re-derived: with both
      // halves added the graph carries a CYCLE, and `restemProgress` walks
      // `kind === "stem"` edges from the pad to the summit — left labelled
      // `stem` (what `planPath` gives every edge it makes) the walk could come
      // back down the loop and call it the stem. `progress` is filled in after,
      // from the geometry that walk returns.
      for (const ei of allAdded) (plan2.state.edges[ei] as TrailEdge).kind = "loop";
      const gF = stemGeometry(plan2.state, summit);
      // The junctions the two branches ACTUALLY used, read back off the graph
      // rather than assumed: half one's first node, half two's last.
      const jA = plan1.state.nodeOfCell.get(h1!.best.cells[0] as number) ?? -1;
      const jB = plan2.state.nodeOfCell.get(h2.best.cells[0] as number) ?? -1;
      const iA = gF.stemNodes.indexOf(jA), iB = gF.stemNodes.indexOf(jB);
      if (jA < 0 || jB < 0 || iA < 0 || iB < 0 || iA === iB) { features.pop(); resampleAround(f); continue; }
      const lo = Math.min(iA, iB), hi = Math.max(iA, iB);
      // The summit is the world's ONLY dead end: a junction there
      // would give it a second edge and take that away.
      if ((gF.stemNodes[hi] as number) === summit) { features.pop(); resampleAround(f); continue; }
      const gap = (gF.stemAcc[hi] as number) - (gF.stemAcc[lo] as number);
      if (gap < LOOP_JUNCTION_GAP - 1e-9) { features.pop(); resampleAround(f); continue; }
      const nA = gF.stemNodes[lo] as number, nB = gF.stemNodes[hi] as number;
      const anF = plan2.state.nodes[nA] as TrailNode, bnF = plan2.state.nodes[nB] as TrailNode;

      // Overlap: a cheap regression guard, no longer the gate. Both halves are
      // trimmed to the branch after their last tree cell, so a shared cell can
      // now only arise at the join itself; the tally reads 0 on a healthy
      // candidate and would catch a regression in the weight construction.
      // What it no longer does is REJECT on an empty tally (`total === 0`),
      // which used to reject 410 of 417 candidates purely because the
      // route it was measuring was a 2-cell stub (see the diagnosis).
      const cells1 = new Set<number>();
      for (let m = 0; m + 1 < h1!.best.cells.length; m++) {
        for (const c of cellsAlong(grid, frame, h1!.best.cells[m] as number, h1!.best.cells[m + 1] as number)) cells1.add(c);
      }
      let shared = 0, total = 0;
      for (let m = 0; m + 1 < h2.best.cells.length; m++) {
        for (const c of cellsAlong(grid, frame, h2.best.cells[m] as number, h2.best.cells[m + 1] as number)) {
          // Cells within LOOP_JOIN_REACH of either junction are the JOIN, not a
          // retrace, and are not counted.
          const cx = grid.x[c] as number, cz = grid.z[c] as number;
          const dA2 = (cx - anF.x) * (cx - anF.x) + (cz - anF.z) * (cz - anF.z);
          const dB2 = (cx - bnF.x) * (cx - bnF.x) + (cz - bnF.z) * (cz - bnF.z);
          if (dA2 < LOOP_JOIN_REACH * LOOP_JOIN_REACH || dB2 < LOOP_JOIN_REACH * LOOP_JOIN_REACH) continue;
          total++;
          if (cells1.has(c) || tree[c] === 1) shared++;
        }
      }
      if (total > 0 && shared / total > LOOP_OVERLAP_MAX) { features.pop(); resampleAround(f); continue; }

      // Connectivity guard: the NEW edges alone (never the pre-existing stem,
      // which already joins the two junctions and would make the check vacuous)
      // must walk from one junction to the other — the loop must be
      // connected. `routeTo`'s trim can anchor a branch on a cell that never
      // reaches the node the other half ended on, and `h2.ok` alone does not
      // say otherwise; measured over the 227-seed sweep before this guard existed,
      // the one loop that ever built was silently disconnected (a node with an
      // incoming edge and no outgoing one).
      const bfsAdj = new Map<number, number[]>();
      for (const ei of allAdded) {
        const e = plan2.state.edges[ei] as TrailEdge;
        (bfsAdj.get(e.a) ?? bfsAdj.set(e.a, []).get(e.a)!).push(e.b);
        (bfsAdj.get(e.b) ?? bfsAdj.set(e.b, []).get(e.b)!).push(e.a);
      }
      const seen = new Set<number>([nA]);
      const stack = [nA];
      while (stack.length > 0) {
        const n = stack.pop() as number;
        for (const m of bfsAdj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      if (!seen.has(nB)) { features.pop(); resampleAround(f); continue; }

      // THE LOOP MUST RING ITS FEATURE — the geometric rule that replaces the
      // shared-cell fraction as the real gate (2026-09-11). A loop is "two
      // half-loops round it"; this is that idea as a predicate. Close the polygon — the
      // first half out to the turn, the second half back from it, and the stem
      // between the two junctions — and ask whether the feature's centre lies
      // inside, by crossing number: no transcendental, no tunable, no
      // tolerance. Nothing a there-and-back, a lollipop, or two halves on the
      // same side of the disc can satisfy, whatever their cell fraction reads.
      // The disc plus a cell is forbidden to both searches, so a polygon that
      // contains the centre genuinely encircles the whole feature.
      const ring: TrailNode[] = [];
      const pushChain = (ids: readonly number[], reverse: boolean): void => {
        const pts: TrailNode[] = [];
        for (const ei of ids) {
          const e = plan2.state.edges[ei] as TrailEdge;
          if (pts.length === 0) pts.push(plan2.state.nodes[e.a] as TrailNode);
          pts.push(plan2.state.nodes[e.b] as TrailNode);
        }
        if (reverse) pts.reverse();
        for (const q of pts) if (ring.length === 0 || ring[ring.length - 1] !== q) ring.push(q);
      };
      pushChain(plan1.added, false);          // junction A → the turn
      pushChain(plan2.added, true);           // the turn → junction B
      for (let i = hi - 1; i > lo; i--) ring.push(plan2.state.nodes[gF.stemNodes[i] as number] as TrailNode);
      if (!enclosesPoint(ring, fx, fz)) { features.pop(); resampleAround(f); continue; }

      // The loop's own length band. The budget is 250-500 m a loop; this
      // task's own test case takes [LOOP_LEN_MIN/2, LOOP_LEN_MAX·1.5] on a
      // synthetic world, and that is the band enforced here. Without it a
      // junction the search chose far down the stem can produce a "loop" three
      // kilometres round (measured over the sweep: a 3181 m one).
      let loopLen = 0;
      for (const ei of allAdded) {
        const e = plan2.state.edges[ei] as TrailEdge;
        const a = plan2.state.nodes[e.a] as TrailNode, b = plan2.state.nodes[e.b] as TrailNode;
        loopLen += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      }
      if (loopLen < LOOP_LEN_MIN / 2 || loopLen > (LOOP_LEN_MAX * 3) / 2) { features.pop(); resampleAround(f); continue; }

      state = plan2.state;
      markPath(h1!.best.cells, grid, frame, tree, treeEdges);
      markPath(h2.best.cells, grid, frame, tree, treeEdges);
      const pA = (gF.stemAcc[lo] as number) / gF.stemLen, pB = (gF.stemAcc[hi] as number) / gF.stemLen;
      const p1p = jA === nA ? pA : pB, p2p = jB === nA ? pA : pB;
      for (const ei of plan1.added) { const e = state.edges[ei] as TrailEdge; e.progress0 = p1p; e.progress1 = p1p; }
      for (const ei of plan2.added) { const e = state.edges[ei] as TrailEdge; e.progress0 = p2p; e.progress1 = p2p; }
      loops.push({ kind, featureId: id, edges: allAdded, junctionA: nA, junctionB: nB });
      built = true;
    }
    // No candidate, or every candidate's route failed: the plan shrinks by
    // one loop. Every failure path above already popped its own pushed
    // feature and re-sampled the grid, so there is nothing left to undo here.
  }
  const { stem, stemLen } = stemGeometry(state, summit);

  // ---- Scenery: a stand and a talus, clear of the stem ---------------------
  /**
   * `LANDMARK_ORDER`'s two types, ranked exactly as before (`rankCandidates`,
   * unchanged) but never routed to: the first ranked candidate that clears
   * every graph node and edge by LANDMARK_DISC_RADIUS + TRAIL_CORRIDOR_HALF
   * (`segmentDistance` over the committed edges) is taken as scenery.
   */
  const landmarks: Landmark[] = [];
  const sceneryClear = LANDMARK_DISC_RADIUS + TRAIL_CORRIDOR_HALF;
  for (let li = 0; li < LANDMARK_ORDER.length; li++) {
    const type = LANDMARK_ORDER[li] as LandmarkType;
    let candidates: Candidate[] = [];
    for (const spacing of [LANDMARK_SPACING, LANDMARK_SPACING / 2, 0]) {
      candidates = rankCandidates(grid, frame, first, type, samplers, landmarks, salted, spacing);
      if (candidates.length > 0) break;
    }
    let chosen: { cand: Candidate; x: number; z: number } | null = null;
    for (const cand of candidates) {
      const x = grid.x[cand.cell] as number, z = grid.z[cand.cell] as number;
      let clear = true;
      for (const n of state.nodes) {
        const dx = x - n.x, dz = z - n.z;
        if (dx * dx + dz * dz < sceneryClear * sceneryClear) { clear = false; break; }
      }
      if (clear) {
        for (const e of state.edges) {
          const a = state.nodes[e.a] as TrailNode, b = state.nodes[e.b] as TrailNode;
          if (segmentDistance(a.x, a.z, b.x, b.z, x, z) < sceneryClear) { clear = false; break; }
        }
      }
      if (clear) { chosen = { cand, x, z }; break; }
    }
    if (chosen === null) throw new Error(`no candidate for ${type} clears the trail`);
    const disc = scoredDisc(type, chosen.x, chosen.z, samplers);
    landmarks.push({ type, x: chosen.x, z: chosen.z, carved: !chosen.cand.found, discX: disc.x, discZ: disc.z });
  }

  return {
    graph: {
      nodes: state.nodes, edges: state.edges, trailhead: { x: thX, z: thZ, u: TRAILHEAD_U },
      summit, stem, loops, features, stemLen, fallbacks,
    },
    landmarks,
    features,
  };
}

/**
 * The stem's geometry, recomputed from the graph as it stands:
 * `restemProgress`'s own chain and length, plus the per-node
 * cumulative length along it and the pad→crest axis a loop's candidate scan
 * and junction picks are measured against. Called once before the loop is
 * placed, then thrown away — cheap next to a grid resample, and always
 * correct after a `splitAt` (or, as it stands, after nothing splits the stem
 * at all: a loop's own junctions reuse existing stem nodes).
 */
type StemGeometry = {
  stem: number[];
  stemLen: number;
  stemNodes: number[];
  stemAcc: number[];
  padN: TrailNode;
  axL: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
};
function stemGeometry(state: GraphState, summit: number): StemGeometry {
  const { stem, stemLen } = restemProgress(state, summit);
  const stemNodes: number[] = [0];
  const stemAcc: number[] = [0];
  for (const ei of stem) {
    const e = state.edges[ei] as TrailEdge;
    stemNodes.push(e.b);
    stemAcc.push((stemAcc[stemAcc.length - 1] as number) + edgeLength(state, ei));
  }
  const padN = state.nodes[0] as TrailNode, crestN = state.nodes[summit] as TrailNode;
  const axX = crestN.x - padN.x, axZ = crestN.z - padN.z;
  const axL = Math.sqrt(axX * axX + axZ * axZ);
  const ux = axL > 0 ? axX / axL : 1, uz = axL > 0 ? axZ / axL : 0; // pad→crest unit
  const nx = -uz, nz = ux; // its left normal
  // `progressOfStemNode` and `stemNodeNearestLen` were built here on every
  // call and never called (2026-09-11). `stemGeometry`
  // runs once per loop index AND once per accepted candidate, each time
  // re-walking `restemProgress`, so they were not free.
  return { stem, stemLen, stemNodes, stemAcc, padN, axL, ux, uz, nx, nz };
}

/** An edge's own XZ length, from its two node positions. */
function edgeLength(state: GraphState, ei: number): number {
  const e = state.edges[ei] as TrailEdge;
  const a = state.nodes[e.a] as TrailNode, b = state.nodes[e.b] as TrailNode;
  return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
}

/**
 * Walk every grid cell within `r` of (x, z) — the row/column window
 * `meanGradientInDisc` and friends already use, factored out so the loop
 * builder's per-candidate arrays can use it too. A full pass over the grid per
 * candidate try, times LOOP_TRIES, times the loops in a world, was most of this
 * task's per-seed cost (2026-09-11).
 */
function forEachCellNear(grid: TrailGrid, x: number, z: number, r: number, fn: (c: number, d2: number) => void): void {
  const z0 = TRAIL_Z_ANCHOR - BOWL_Z_HALF;
  const j0 = Math.max(0, Math.floor((z - r - z0) / TRAIL_GRID_CELL));
  const j1 = Math.min(grid.nz - 1, Math.floor((z + r - z0) / TRAIL_GRID_CELL));
  for (let j = j0; j <= j1; j++) {
    const row = j * grid.nu;
    const base = grid.x[row] as number;
    const i0 = Math.max(0, Math.ceil((x - r - base) / TRAIL_GRID_CELL));
    const i1 = Math.min(grid.nu - 1, Math.floor((x + r - base) / TRAIL_GRID_CELL));
    for (let i = i0; i <= i1; i++) {
      const c = row + i;
      const dx = (grid.x[c] as number) - x, dz = (grid.z[c] as number) - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r * r) fn(c, d2);
    }
  }
}

/**
 * The fraction of the cells in a candidate's own ring band that are passable
 * BEFORE the feature stage is applied — the loop has to walk that band, and a
 * band a scarp or a boulder field cuts in half is a candidate whose halves will
 * not reach their turn however flat its disc reads (2026-09-11). Scored
 * alongside the mean disc gradient so the flattest
 * disc with a WALKABLE ring wins, not merely the flattest disc.
 */
function ringPassFraction(grid: TrailGrid, x: number, z: number, radius: number, apron: number): number {
  const lo = radius, hi = radius + apron + RING_BAND;
  let n = 0, pass = 0;
  forEachCellNear(grid, x, z, hi, (c, d2) => {
    if (d2 < lo * lo) return;
    n++;
    if (grid.pass[c] === 1) pass++;
  });
  return n === 0 ? 0 : pass / n;
}


/**
 * The centre-to-centre distance two features must keep. `FEATURE_SPACING` is
 * the floor, but a feature's ground reaches past its own radius — a pond's
 * apron by POND_APRON, and a meadow's by MEADOW_RIM — and two STAGES
 * that overlap leave ground neither of them levelled, which the bed cannot sit
 * flush on (2026-09-11; measured before this
 * rule: two meadows 180 m apart with 90 m and 78 m radii overlapped 58 m of
 * apron and left a 2.72 m residual under the loop that walked it). The peak is
 * exempt and keeps its own PEAK_SHOULDER rule: a loop feature is MEANT to
 * be able to stand on the dome's outer skirt.
 */
function featureReach(f: { kind: string; radius: number }): number {
  return f.radius + (f.kind === "pond" ? POND_APRON : f.kind === "meadow" ? MEADOW_RIM : 0);
}

/** One sampled point on the stem polyline: its position, its cumulative stem
 * length, and its projection on the pad→crest axis. A loop's junctions are
 * chosen among these rather than among the stem's own (few, widely spaced)
 * vertices — the stem is split at the join. */
type StemSample = { x: number; z: number; arc: number; proj: number };
function sampleStem(state: GraphState, geom: StemGeometry): StemSample[] {
  const out: StemSample[] = [];
  const { padN, ux, uz } = geom;
  let arc = 0;
  for (let k = 0; k + 1 < geom.stemNodes.length; k++) {
    const a = state.nodes[geom.stemNodes[k] as number] as TrailNode;
    const b = state.nodes[geom.stemNodes[k + 1] as number] as TrailNode;
    const L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    const n = Math.max(1, Math.ceil(L / TRAIL_GRID_CELL));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push({ x, z, arc: arc + L * t, proj: (x - padN.x) * ux + (z - padN.z) * uz });
    }
    arc += L;
  }
  const last = state.nodes[geom.stemNodes[geom.stemNodes.length - 1] as number] as TrailNode;
  out.push({ x: last.x, z: last.z, arc, proj: (last.x - padN.x) * ux + (last.z - padN.z) * uz });
  return out;
}

/**
 * Crossing-number point-in-polygon over a closed ring of nodes (the last point
 * is joined back to the first). Used by the loop builder to ask the one
 * question that actually matters — does this loop go ROUND its feature —
 * without an angle, a tunable or a tolerance: a ray along +x from (px, pz)
 * crosses an odd number of edges exactly when the point is inside.
 */
function enclosesPoint(ring: readonly TrailNode[], px: number, pz: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as TrailNode, b = ring[j] as TrailNode;
    if ((a.z > pz) === (b.z > pz)) continue;
    if (px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The mean grid gradient over the cells within `r` of (x, z), impassable ones
 * included (2026-09-11) — the
 * candidate filter is judging ground a feature stage is about to LEVEL, not
 * ground the loop walks raw: a cell reading over TRAIL_GRID_CAP on the
 * UNLEVELLED field says nothing about whether it stays impassable once the
 * feature's own flat/basin stage has run over it (`resampleAround` recomputes
 * passability from the levelled field before any candidate is tried). The old
 * "any impassable cell vetoes the whole disc" rule is gone with it — on real
 * montane ground a candidate's own disc almost always contains at least one
 * over-cap cell before levelling, which is exactly why it needed levelling.
 * Windowed over the grid's row/column range the disc can reach, same shape as
 * `Samplers.mayHaveBoulders`.
 */
function meanGradientInDisc(grid: TrailGrid, x: number, z: number, r: number): number {
  const z0 = TRAIL_Z_ANCHOR - BOWL_Z_HALF;
  const j0 = Math.max(0, Math.floor((z - r - z0) / TRAIL_GRID_CELL));
  const j1 = Math.min(grid.nz - 1, Math.floor((z + r - z0) / TRAIL_GRID_CELL));
  let sum = 0, n = 0;
  for (let j = j0; j <= j1; j++) {
    const row = j * grid.nu;
    const base = grid.x[row] as number;
    const i0 = Math.max(0, Math.ceil((x - r - base) / TRAIL_GRID_CELL));
    const i1 = Math.min(grid.nu - 1, Math.floor((x + r - base) / TRAIL_GRID_CELL));
    for (let i = i0; i <= i1; i++) {
      const c = row + i;
      const dx = (grid.x[c] as number) - x, dz = (grid.z[c] as number) - z;
      if (dx * dx + dz * dz > r * r) continue;
      sum += grid.grad[c] as number;
      n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

/**
 * The mean of the PRE-FEATURE field's own height (`frame.sample`, not
 * `grid.h` — the grid may already carry an earlier feature's stage) over the
 * grid cells within `radius` of (x, z) (2026-09-11) — see the call site's
 * comment for why the mean, not the
 * centre. Same windowing shape as `meanGradientInDisc`.
 */
function meanPreFeatureHeight(grid: TrailGrid, frame: BuildFrame, x: number, z: number, radius: number): number {
  const z0 = TRAIL_Z_ANCHOR - BOWL_Z_HALF;
  const j0 = Math.max(0, Math.floor((z - radius - z0) / TRAIL_GRID_CELL));
  const j1 = Math.min(grid.nz - 1, Math.floor((z + radius - z0) / TRAIL_GRID_CELL));
  let sum = 0, n = 0;
  for (let j = j0; j <= j1; j++) {
    const row = j * grid.nu;
    const base = grid.x[row] as number;
    const i0 = Math.max(0, Math.ceil((x - radius - base) / TRAIL_GRID_CELL));
    const i1 = Math.min(grid.nu - 1, Math.floor((x + radius - base) / TRAIL_GRID_CELL));
    for (let i = i0; i <= i1; i++) {
      const c = row + i;
      const cx = grid.x[c] as number, cz = grid.z[c] as number;
      const dx = cx - x, dz = cz - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      sum += frame.sample(cx, cz).h;
      n++;
    }
  }
  return n > 0 ? sum / n : frame.sample(x, z).h;
}

/**
 * Candidate cells for a landmark type, best first: every STRIDE-th cell in
 * each axis that the first search reaches, at least LANDMARK_SCENERY_MIN_PATH
 * of path from the trailhead, `spacing` in plan from every landmark placed, and
 * LANDMARK_BOWL_MARGIN inside the region. Found candidates (score at the
 * threshold) come before carved ones; within each group by score, then by a
 * seeded hash of the cell so equal scores do not always fall to the lowest
 * index.
 */
function rankCandidates(
  grid: TrailGrid, frame: BuildFrame, first: Search, type: LandmarkType, s: Samplers,
  placed: readonly Landmark[], salted: number, spacing: number,
): Candidate[] {
  const out: Candidate[] = [];
  const threshold = landmarkThreshold(type);
  for (let j = 0; j < grid.nz; j += LANDMARK_CANDIDATE_STRIDE) {
    for (let i = 0; i < grid.nu; i += LANDMARK_CANDIDATE_STRIDE) {
      const c = j * grid.nu + i;
      if (!Number.isFinite(first.dist[c] as number)) continue;
      if ((first.len[c] as number) < LANDMARK_SCENERY_MIN_PATH) continue;
      const x = grid.x[c] as number, z = grid.z[c] as number;
      const u = x - frame.roadCenterX(z);
      if (u < BOWL_U_MIN + LANDMARK_BOWL_MARGIN || u > BOWL_U_MAX - LANDMARK_BOWL_MARGIN) continue;
      if (Math.abs(z - TRAIL_Z_ANCHOR) > BOWL_Z_HALF - LANDMARK_BOWL_MARGIN) continue;
      let clear = true;
      for (const lm of placed) {
        const dx = x - lm.x, dz = z - lm.z;
        if (dx * dx + dz * dz < spacing * spacing) { clear = false; break; }
      }
      if (!clear) continue;
      const score = scoreCandidate(type, x, z, s);
      out.push({ cell: c, score, found: score >= threshold });
    }
  }
  const tie = (c: number): number => hash3(c % grid.nu, (c - (c % grid.nu)) / grid.nu, 0, salted);
  out.sort((p, q) => (Number(q.found) - Number(p.found)) || (q.score - p.score) || (tie(p.cell) - tie(q.cell)) || (p.cell - q.cell));
  return out;
}

/**
 * Route from the trailhead to a target cell: search with the tree rules, take
 * the branch (the suffix after the last tree cell), simplify it, then FINE-CHECK
 * WHAT THE PLAYER WOULD WALK; on a failure mark the cells the failing edges
 * cross impassable and try again, up to TRAIL_REROUTE_MAX times. Returns the
 * accepted attempt, or the least-steep one with ok = false (its `cells` are
 * empty only when no attempt ever reached the target).
 *
 * THE FINE CHECK IS ON THE COMPOSED FIELD. The path is PLANNED first, exactly
 * as `commitPath` would build it — same node positions (the pad centre, a
 * snapped node, or a `splitAt` projection), same profiles — and then
 * `trailCorridorD` is evaluated over the whole graph (the tree's edges and the
 * candidate's together) along every new edge's centreline at 1 m, against the
 * same TRAIL_HARD_SLOPE_MAX. `profileMaxSlope` stays in the simplifier as the
 * cheap per-segment filter.
 *
 * `weight` is the loop builder's ring cost, passed straight to
 * `searchFrom`; the stem passes `null`.
 */
function routeTo(
  grid: TrailGrid, frame: BuildFrame, H: Heights, ground: GroundFn, state: GraphState,
  tree: Uint8Array, treeEdges: ReadonlyArray<[number, number]>, start: number, target: number,
  marked: number[], weight: Float32Array | null,
): { ok: boolean; best: Attempt } {
  let best: Attempt | null = null;
  for (let attempt = 0; attempt <= TRAIL_REROUTE_MAX; attempt++) {
    const search = searchFrom(grid, start, tree, weight);
    const cells = pathCells(search, target);
    if (cells.length === 0) break;
    const pathLen = search.len[target] as number;
    // The branch: from the last tree cell on the path to the target.
    let k = cells.length - 1;
    while (k > 0 && tree[cells[k - 1] as number] === 0) k--;
    const branch = cells.slice(Math.max(0, k - 1));
    const simp = simplify(grid, frame, H, tree, treeEdges, branch);
    const plan = planPath(state, simp, grid, frame, H);
    const bad: number[] = [];
    let worst = 0;
    // The branch's own beds, AND every bed already in the graph that this one
    // comes close enough to disturb — a corridor reaches TRAIL_CORRIDOR_HALF,
    // so two beds share a union only within twice that. In practice those are
    // the edges at the departure junction (the two halves of the edge `splitAt`
    // just divided, and whatever else meets it).
    for (const ei of affectedEdges(plan)) {
      const e = plan.state.edges[ei] as TrailEdge;
      const a = plan.state.nodes[e.a] as TrailNode, b = plan.state.nodes[e.b] as TrailNode;
      const spots: number[] = [];
      const g = composedMaxSlope(plan.state, ground, a, b, spots);
      worst = Math.max(worst, g);
      if (g <= TRAIL_HARD_SLOPE_MAX) continue;
      // BLAME THE OVER-CAP SAMPLES, NOT THE WHOLE BRANCH (2026-09-11, fix
      // round 3). The rule here used to mark every cell of every new edge
      // within UNION_REACH of the failing one; on the stem's climb that is
      // the whole approach — 30–110 cells at a stroke, measured — and the
      // NEXT search then found the crest unreachable and gave up, so the
      // reroute budget was spent on one attempt out of TRAIL_REROUTE_MAX.
      // The cells UNDER the over-cap samples are what the next attempt has
      // to go around; the rest of the route is not at fault.
      for (let k = 0; k < spots.length; k += 2) {
        const cc = cellAt(grid, frame.roadCenterX, spots[k] as number, spots[k + 1] as number);
        if (cc >= 0 && cc !== target && cc !== start && tree[cc] === 0) bad.push(cc);
      }
    }
    const current: Attempt = { cells: simp, worst, pathLen };
    // The CAP decides, not the blame list. A sample over TRAIL_HARD_SLOPE_MAX
    // can leave nothing to mark — a two-cell branch whose over-cap sample sits
    // on the start, the target or a tree cell has no blamable cell of its
    // own. An attempt over the cap is never accepted; when there is nothing to
    // reroute around, the loop stops and the caller's own fallback is the
    // answer.
    if (worst <= TRAIL_HARD_SLOPE_MAX) return { ok: true, best: current };
    if (best === null || worst < best.worst) best = current;
    if (bad.length === 0) break;
    let flipped = false;
    for (const c of bad) if (grid.pass[c] === 1) { grid.pass[c] = 0; marked.push(c); flipped = true; }
    // NO PROGRESS, NO RETRY (2026-09-11): if every
    // blamed cell was already impassable, the next iteration runs a
    // bit-identical whole-grid Dijkstra, produces a bit-identical path and a
    // bit-identical blame list, and does it again to TRAIL_REROUTE_MAX. Never
    // a correctness bug — an over-cap attempt is never accepted — but the loop
    // builder runs `routeTo` twice per candidate, LOOP_TRIES times, on up to
    // three loops, so up to three free whole-grid searches per candidate is
    // the branch's own headline 460 ms.
    if (!flipped) break;
  }
  return { ok: false, best: best ?? { cells: [], worst: Infinity, pathLen: 0 } };
}

/** How close two beds must come before they share a union at all: each corridor
 * reaches TRAIL_CORRIDOR_HALF from its own centreline. */
const UNION_REACH = 2 * TRAIL_CORRIDOR_HALF;

/** The edges the composed check has to measure for a planned branch: the
 * branch's own, plus every edge already in the graph whose bed its corridors
 * can reach (the departure junction's, above all — including the two halves of
 * the edge it split). */
function affectedEdges(plan: Plan): number[] {
  const out = plan.added.slice();
  const isNew = new Set(plan.added);
  for (let ei = 0; ei < plan.state.edges.length; ei++) {
    if (isNew.has(ei)) continue;
    const e = plan.state.edges[ei] as TrailEdge;
    const a = plan.state.nodes[e.a] as TrailNode, b = plan.state.nodes[e.b] as TrailNode;
    for (const aj of plan.added) {
      const f = plan.state.edges[aj] as TrailEdge;
      const c = plan.state.nodes[f.a] as TrailNode, d = plan.state.nodes[f.b] as TrailNode;
      if (segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) <= UNION_REACH * UNION_REACH) {
        out.push(ei);
        break;
      }
    }
  }
  return out;
}

/** The steepest |∇h| of the COMPOSED field along one edge's centreline, at 1 m
 * — the union of every corridor in `state` over the ground with its domes. The
 * corridor's own AABB early-out is what keeps this affordable. When `over` is
 * given, every sample above TRAIL_HARD_SLOPE_MAX is appended to it as an (x, z)
 * pair — the reroute's blame list. */
function composedMaxSlope(state: GraphState, ground: GroundFn, a: TrailNode, b: TrailNode, over: number[] | null = null): number {
  const L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  const n = Math.max(1, Math.ceil(L));
  let worst = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const s = trailCorridorD(state.nodes, state.edges, x, z, ground(x, z));
    const g = Math.sqrt(s.dx * s.dx + s.dz * s.dz);
    if (g > worst) worst = g;
    if (over !== null && g > TRAIL_HARD_SLOPE_MAX) over.push(x, z);
  }
  return worst;
}

/** The max |slope| of the smoothed profile between two cell centres, sampled at
 * the profile's own step. */
function profileMaxSlope(grid: TrailGrid, H: Heights, a: number, b: number): number {
  const ax = grid.x[a] as number, az = grid.z[a] as number, bx = grid.x[b] as number, bz = grid.z[b] as number;
  const L = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  if (L === 0) return 0;
  const p = buildProfile(H.ground, ax, az, H.cell(a), bx, bz, H.cell(b));
  const n = p.length - 1;
  let worst = 0;
  for (let k = 1; k <= n; k++) worst = Math.max(worst, Math.abs((p[k] as number) - (p[k - 1] as number)) / (L / n));
  return worst;
}

/** The cells a straight segment between two cell centres passes through, sampled every CHECK_STEP. */
function cellsAlong(grid: TrailGrid, frame: BuildFrame, a: number, b: number): number[] {
  return cellsBetween(grid, frame, grid.x[a] as number, grid.z[a] as number, grid.x[b] as number, grid.z[b] as number);
}

/** The fine-check step along a candidate segment (m). */
const CHECK_STEP = 2;

/** The same, between two world points (an edge split lands between cell centres). */
function cellsBetween(grid: TrailGrid, frame: BuildFrame, ax: number, az: number, bx: number, bz: number): number[] {
  const L = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  const n = Math.max(1, Math.ceil(L / CHECK_STEP));
  const out: number[] = [];
  let last = -2;
  for (let k = 0; k <= n; k++) {
    const c = cellAt(grid, frame.roadCenterX, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    if (c !== last) { if (c >= 0) out.push(c); last = c; }
  }
  return out;
}

/**
 * Douglas–Peucker over a branch's cells, keeping a vertex where the merged
 * segment would (a) deviate more than TRAIL_SIMPLIFY_TOL from the path,
 * (b) cross an impassable cell, (c) come within TRAIL_EDGE_MIN_GAP of a tree
 * edge it does not share a node with, or (d) carry a profile over
 * TRAIL_HARD_SLOPE_MAX. The first cell of a branch is on the tree (its node
 * exists already) and is always kept.
 */
function simplify(
  grid: TrailGrid, frame: BuildFrame, H: Heights,
  tree: Uint8Array, treeEdges: ReadonlyArray<[number, number]>, cells: readonly number[],
): number[] {
  const keep = new Uint8Array(cells.length);
  keep[0] = 1;
  keep[cells.length - 1] = 1;
  /** The cell the branch leaves the tree at — its first. */
  const depart = cells[0] as number;
  const dx0 = grid.x[depart] as number, dz0 = grid.z[depart] as number;
  /**
   * The tree edges the gap test must not fire on: the ones the branch DEPARTS
   * from. Every branch leaves the trail partway along an existing bed, so its
   * first segment starts ON that bed and is 0 m from it by construction.
   *
   * "Departs from" is CONTAINS THE DEPARTURE CELL, not "ends at it". A tree
   * edge is a pair of cell centres; it contains the departure cell when its
   * segment passes within half a cell's diagonal of that cell's centre, which
   * is the furthest a segment crossing a cell can be from the middle of it.
   */
  const DEPART_REACH = TRAIL_GRID_CELL * Math.SQRT1_2;
  const exempt = treeEdges.map(([ea, eb]) =>
    segmentDistance(grid.x[ea] as number, grid.z[ea] as number, grid.x[eb] as number, grid.z[eb] as number, dx0, dz0) <= DEPART_REACH);
  const X = (k: number) => grid.x[cells[k] as number] as number;
  const Z = (k: number) => grid.z[cells[k] as number] as number;
  const violates = (a: number, b: number): boolean => {
    const ca = cells[a] as number, cb = cells[b] as number;
    for (const c of cellsAlong(grid, frame, ca, cb)) if (grid.pass[c] === 0 && tree[c] === 0) return true;
    for (let i = 0; i < treeEdges.length; i++) {
      const [ea, eb] = treeEdges[i] as [number, number];
      if (ea === ca || eb === ca || ea === cb || eb === cb) continue; // adjacent: shares a node
      if (exempt[i] === true) continue; // the bed this branch is leaving
      const d2 = segmentSegmentDistanceSq(X(a), Z(a), X(b), Z(b), grid.x[ea] as number, grid.z[ea] as number, grid.x[eb] as number, grid.z[eb] as number);
      if (d2 < TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP) return true;
    }
    return profileMaxSlope(grid, H, ca, cb) > TRAIL_HARD_SLOPE_MAX;
  };
  const rec = (a: number, b: number): void => {
    if (b - a < 2) return;
    let worst = -1, wi = -1;
    const ax = X(a), az = Z(a), ex = X(b) - ax, ez = Z(b) - az, L2 = ex * ex + ez * ez;
    for (let k = a + 1; k < b; k++) {
      const px = X(k) - ax, pz = Z(k) - az;
      const t = L2 > 0 ? Math.min(1, Math.max(0, (px * ex + pz * ez) / L2)) : 0;
      const dx = px - t * ex, dz = pz - t * ez;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > worst) { worst = d; wi = k; }
    }
    if (worst > TRAIL_SIMPLIFY_TOL || violates(a, b)) {
      keep[wi] = 1;
      rec(a, wi);
      rec(wi, b);
    }
  };
  rec(0, cells.length - 1);
  const out: number[] = [];
  for (let k = 0; k < cells.length; k++) if (keep[k] === 1) out.push(cells[k] as number);
  return out;
}

/**
 * The branch a set of simplified cells would become: the NEXT graph state
 * (nodes deduplicated by cell, edges with their profiles, an edge split where
 * the branch departs partway along one) and which of its edges are new.
 *
 * Every edge is created as `kind: "stem"` with placeholder `progress0: 0,
 * progress1: 0` — `restemProgress` fills in the real values once a path is
 * committed (the loop stage overwrites `kind` on its own edges after
 * `planPath` returns).
 *
 * PURE in `base`: it clones the four structures rather than mutating them, so
 * `routeTo` can measure the composed field over exactly this geometry and
 * then either commit to it or drop it and try elsewhere without having
 * mutated `base`. Committing re-plans from the same pure inputs (`buildTrail`
 * calls `planPath` again on the winning cells) rather than taking
 * `plan.state` itself, but since `planPath` is pure and deterministic in
 * `base` and `cells`, the re-plan reproduces exactly what was measured. The
 * clone is shallow: `splitAt` REPLACES an edge entry rather than mutating the
 * object, and nothing else writes through a shared reference.
 */
function planPath(
  base: GraphState, cells: readonly number[], grid: TrailGrid, frame: BuildFrame, H: Heights,
): Plan {
  const state: GraphState = {
    nodes: base.nodes.slice(),
    edges: base.edges.slice(),
    nodeOfCell: new Map(base.nodeOfCell),
    edgeOfCell: new Map(base.edgeOfCell),
  };
  const added: number[] = [];
  if (cells.length === 0) return { state, added };
  const nodeFor = (c: number): number => {
    let n = state.nodeOfCell.get(c);
    if (n === undefined) {
      const x = grid.x[c] as number, z = grid.z[c] as number;
      state.nodes.push({ x, z, h: H.cell(c), u: x - frame.roadCenterX(z) });
      n = state.nodes.length - 1;
      state.nodeOfCell.set(c, n);
    }
    return n;
  };
  // A branch's first cell is on the tree already: the trailhead's cell (which
  // buildTrail mapped to node 0, the pad centre — so the first edge runs from
  // the car to the first grid vertex), a vertex an earlier path laid down, or —
  // the common case, once the tree is marked along the whole bed — a cell
  // PARTWAY along an existing edge, where the edge is split (`splitAt`).
  const first = cells[0] as number;
  let prevNode: number = state.nodeOfCell.get(first) ?? splitAt(first, grid, frame, H, state);
  for (let m = 1; m < cells.length; m++) {
    const a = prevNode, b = nodeFor(cells[m] as number);
    if (a === b) continue;
    const na = state.nodes[a] as TrailNode, nb = state.nodes[b] as TrailNode;
    state.edges.push({
      a, b, kind: "stem", profile: buildProfile(H.ground, na.x, na.z, na.h, nb.x, nb.z, nb.h),
      progress0: 0, progress1: 0,
    });
    const ei = state.edges.length - 1;
    added.push(ei);
    state.edgeOfCell.set(cells[m] as number, ei);
    for (const c of cellsAlong(grid, frame, cells[m - 1] as number, cells[m] as number)) state.edgeOfCell.set(c, ei);
    prevNode = b;
  }
  return { state, added };
}

/**
 * The marks a committed branch leaves outside the graph itself: the tree, and
 * the tree-edge list the simplifier's gap check reads.
 *
 * The tree is marked along the whole BED, not only at the vertices the
 * simplifier kept: a tree of isolated vertices leaves the reuse discount with
 * nothing to coalesce onto, and the two-cell rule's halo around those
 * isolated cells can seal a gap after a path has crossed it. A CONNECTED tree
 * is what both rules were written for: a later path follows the trail cheaply
 * and, where it leaves, leaves properly.
 */
function markPath(
  cells: readonly number[], grid: TrailGrid, frame: BuildFrame,
  tree: Uint8Array, treeEdges: Array<[number, number]>,
): void {
  if (cells.length === 0) return;
  const touched = new Set<number>();
  touched.add(cells[0] as number);
  for (let m = 0; m + 1 < cells.length; m++) {
    for (const c of cellsAlong(grid, frame, cells[m] as number, cells[m + 1] as number)) touched.add(c);
    treeEdges.push([cells[m] as number, cells[m + 1] as number]);
  }
  for (const c of touched) tree[c] = 1;
}

/**
 * Rebuilds the STEM edge list — the chain of `kind === "stem"` edges from
 * node 0 to `summit` — and assigns each edge's `progress0`/`progress1` along
 * it (0 at the pad, 1 at the crest) and the chain's total length. Walked from
 * the graph itself rather than carried incrementally, because a later loop's
 * junction can SPLIT a stem edge (`splitAt` keeps the split edge's kind on
 * both halves), which changes the edge-index list without changing the
 * chain's shape or length; the loop stage calls this again after each loop is
 * stitched in.
 */
function restemProgress(state: GraphState, summit: number): { stem: number[]; stemLen: number } {
  const adj = new Map<number, Array<{ to: number; ei: number }>>();
  for (let ei = 0; ei < state.edges.length; ei++) {
    const e = state.edges[ei] as TrailEdge;
    if (e.kind !== "stem") continue;
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    (adj.get(e.a) as Array<{ to: number; ei: number }>).push({ to: e.b, ei });
    (adj.get(e.b) as Array<{ to: number; ei: number }>).push({ to: e.a, ei });
  }
  const cameFrom = new Map<number, { from: number; ei: number }>();
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    const n = stack.pop() as number;
    if (n === summit) break;
    for (const { to, ei } of adj.get(n) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      cameFrom.set(to, { from: n, ei });
      stack.push(to);
    }
  }
  const chain: number[] = [];
  let cur = summit;
  while (cur !== 0) {
    const step = cameFrom.get(cur);
    if (step === undefined) throw new Error("the stem does not connect the pad to the summit");
    chain.push(step.ei);
    cur = step.from;
  }
  chain.reverse();
  const lens: number[] = chain.map((ei) => {
    const e = state.edges[ei] as TrailEdge;
    const a = state.nodes[e.a] as TrailNode, b = state.nodes[e.b] as TrailNode;
    return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  });
  const stemLen = lens.reduce((s, l) => s + l, 0);
  let acc = 0;
  for (let i = 0; i < chain.length; i++) {
    const ei = chain[i] as number;
    const e = state.edges[ei] as TrailEdge;
    const len = lens[i] as number;
    const p0 = stemLen > 0 ? acc / stemLen : 0;
    const p1 = stemLen > 0 ? (acc + len) / stemLen : 1;
    state.edges[ei] = { ...e, progress0: p0, progress1: p1 };
    acc += len;
  }
  return { stem: chain, stemLen };
}

/**
 * Where a branch leaves an existing edge partway along it, that edge is SPLIT
 * at the point of departure and the branch starts from the new node.
 *
 * The new node sits on the edge's own centreline — the PROJECTION of the
 * departure cell's centre, not the centre itself — so the split is exactly
 * collinear: the two halves cover the same ground the whole edge did and
 * nothing bends. The geometry is unchanged, but both halves get NEW profiles
 * pinned to `H.point(px, pz)` at the split node, so the bed height AT the
 * split can still move from what the one whole edge's profile gave there —
 * that is why the composed check measures both halves (`affectedEdges`
 * includes both) rather than trusting the old edge's invariants to carry
 * over. Both halves keep the whole edge's `kind` (a stem edge splits into two
 * stem edges); `progress0`/`progress1` on both are placeholders, corrected by
 * the next `restemProgress` call.
 *
 * Within SPLIT_SNAP of either end the existing node is used instead. That is
 * not just a degeneracy guard: two nodes closer than the corridor's own width
 * are one junction, and the stub between them carries four overlapping
 * corridors whose profiles all extrapolate away from it in different
 * directions.
 */
const SPLIT_SNAP = 2 * TRAIL_CORRIDOR_HALF;
function splitAt(cell: number, grid: TrailGrid, frame: BuildFrame, H: Heights, state: GraphState): number {
  const { nodes, edges, nodeOfCell, edgeOfCell } = state;
  const ei = edgeOfCell.get(cell);
  if (ei === undefined) {
    // A tree cell no edge covers cannot arise from a committed path; if it ever
    // did, a fresh node is the safe answer (the branch would hang, and the
    // reachability gate would say so, rather than the field going NaN).
    const x = grid.x[cell] as number, z = grid.z[cell] as number;
    nodes.push({ x, z, h: H.cell(cell), u: x - frame.roadCenterX(z) });
    nodeOfCell.set(cell, nodes.length - 1);
    return nodes.length - 1;
  }
  const e = edges[ei] as TrailEdge;
  const a = nodes[e.a] as TrailNode, b = nodes[e.b] as TrailNode;
  const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
  const cx = grid.x[cell] as number, cz = grid.z[cell] as number;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((cx - a.x) * ex + (cz - a.z) * ez) / L2)) : 0;
  const L = Math.sqrt(L2);
  if (t * L < SPLIT_SNAP) { nodeOfCell.set(cell, e.a); return e.a; }
  if ((1 - t) * L < SPLIT_SNAP) { nodeOfCell.set(cell, e.b); return e.b; }
  const px = a.x + ex * t, pz = a.z + ez * t;
  nodes.push({ x: px, z: pz, h: H.point(px, pz), u: px - frame.roadCenterX(pz) });
  const n = nodes.length - 1;
  const nn = nodes[n] as TrailNode;
  edges[ei] = {
    a: e.a, b: n, kind: e.kind, profile: buildProfile(H.ground, a.x, a.z, a.h, px, pz, nn.h),
    progress0: 0, progress1: 0,
  };
  edges.push({
    a: n, b: e.b, kind: e.kind, profile: buildProfile(H.ground, px, pz, nn.h, b.x, b.z, b.h),
    progress0: 0, progress1: 0,
  });
  const ej = edges.length - 1;
  for (const c of cellsBetween(grid, frame, a.x, a.z, px, pz)) edgeOfCell.set(c, ei);
  for (const c of cellsBetween(grid, frame, px, pz, b.x, b.z)) edgeOfCell.set(c, ej);
  nodeOfCell.set(cell, n);
  return n;
}
