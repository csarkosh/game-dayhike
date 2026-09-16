/**
 * The trail builder's plumbing, shared by the stages that route on the grid
 * (the stem and the loops in trailBuild.ts, the strands and rungs in
 * trailBraid.ts): the graph as it stands, a planned branch, routing with the
 * composed fine check, the simplifier, and the stem's geometry.
 *
 * Moved out of trailBuild.ts unchanged (2026-09-16) so the braid stage could
 * use it without a circular import. Nothing here decides where a trail goes;
 * the stages do.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { TerrainSample } from "./terrain.js";
import { TRAIL_Z_ANCHOR, BOWL_Z_HALF } from "./bowl.js";
import {
  cellAt, searchFrom, pathCells, TRAIL_GRID_CELL,
  type TrailGrid, type GroundFn,
} from "./trailGrid.js";
import {
  buildProfile, segmentDistance, segmentSegmentDistanceSq, trailCorridorD,
  TRAIL_HARD_SLOPE_MAX, TRAIL_SIMPLIFY_TOL, TRAIL_REROUTE_MAX, TRAIL_EDGE_MIN_GAP, TRAIL_CORRIDOR_HALF,
  type TrailNode, type TrailEdge,
} from "./trail.js";
import { MEADOW_RIM, POND_APRON } from "./features.js";

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
 * The three heights the builder reads: the raw ground (what a profile's
 * interior samples are), the de-clodded height at a world point (a node's), and
 * the same memoised per grid cell — the fine check asks for the same cell
 * centres over and over, and a cell's smoothing is 13 ground samples.
 */
export type Heights = {
  ground: (x: number, z: number) => number;
  point: (x: number, z: number) => number;
  cell: (c: number) => number;
};

export type Attempt = { cells: number[]; worst: number; pathLen: number };

/**
 * The graph as it stands, in the four structures a path reads and writes.
 * `planPath` builds the NEXT one without touching this one, so the fine check
 * can measure the composed field over the geometry `commitPath` would build —
 * the same node positions (pad centre, snapped node, or `splitAt` projection)
 * and the same profiles — rather than over the profile alone.
 */
export type GraphState = {
  nodes: TrailNode[];
  edges: TrailEdge[];
  nodeOfCell: Map<number, number>;
  edgeOfCell: Map<number, number>;
};

/** A branch as it would be built: the state that results, and which of its
 * edges are the branch's own (an edge `splitAt` halved is collinear with the
 * whole it replaced, so only the new ones need measuring). */
export type Plan = { state: GraphState; added: number[] };

/**
 * The stem's geometry, recomputed from the graph as it stands:
 * `restemProgress`'s own chain and length, plus the per-node
 * cumulative length along it and the pad→crest axis a loop's candidate scan
 * and junction picks are measured against. Called once before the loop is
 * placed, then thrown away — cheap next to a grid resample, and always
 * correct after a `splitAt` (or, as it stands, after nothing splits the stem
 * at all: a loop's own junctions reuse existing stem nodes).
 */
export type StemGeometry = {
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

export function stemGeometry(state: GraphState, summit: number): StemGeometry {
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
export function edgeLength(state: GraphState, ei: number): number {
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
export function forEachCellNear(grid: TrailGrid, x: number, z: number, r: number, fn: (c: number, d2: number) => void): void {
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
export function featureReach(f: { kind: string; radius: number }): number {
  return f.radius + (f.kind === "pond" ? POND_APRON : f.kind === "meadow" ? MEADOW_RIM : 0);
}

/** One sampled point on the stem polyline: its position, its cumulative stem
 * length, and its projection on the pad→crest axis. A loop's junctions are
 * chosen among these rather than among the stem's own (few, widely spaced)
 * vertices — the stem is split at the join. */
export type StemSample = { x: number; z: number; arc: number; proj: number };

export function sampleStem(state: GraphState, geom: StemGeometry): StemSample[] {
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
export function routeTo(
  grid: TrailGrid, frame: BuildFrame, H: Heights, ground: GroundFn, state: GraphState,
  tree: Uint8Array, treeEdges: ReadonlyArray<[number, number]>, start: number, target: number,
  marked: number[], weight: Float32Array | null, arriveOnTree = false,
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
    const simp = simplify(grid, frame, H, tree, treeEdges, branch, arriveOnTree ? (branch[branch.length - 1] as number) : null);
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
export const UNION_REACH = 2 * TRAIL_CORRIDOR_HALF;

/** The edges the composed check has to measure for a planned branch: the
 * branch's own, plus every edge already in the graph whose bed its corridors
 * can reach (the departure junction's, above all — including the two halves of
 * the edge it split). */
export function affectedEdges(plan: Plan): number[] {
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
export function composedMaxSlope(state: GraphState, ground: GroundFn, a: TrailNode, b: TrailNode, over: number[] | null = null): number {
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
export function profileMaxSlope(grid: TrailGrid, H: Heights, a: number, b: number): number {
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
export function cellsAlong(grid: TrailGrid, frame: BuildFrame, a: number, b: number): number[] {
  return cellsBetween(grid, frame, grid.x[a] as number, grid.z[a] as number, grid.x[b] as number, grid.z[b] as number);
}

/** The fine-check step along a candidate segment (m). */
export const CHECK_STEP = 2;

/** The same, between two world points (an edge split lands between cell centres). */
export function cellsBetween(grid: TrailGrid, frame: BuildFrame, ax: number, az: number, bx: number, bz: number): number[] {
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
 *
 * `arrive` is the cell a branch ENDS on when it ends on the tree too (a
 * strand, a rung): the tree edges through it are exempt from the gap test the
 * same way the departure's are.
 */
export function simplify(
  grid: TrailGrid, frame: BuildFrame, H: Heights,
  tree: Uint8Array, treeEdges: ReadonlyArray<[number, number]>, cells: readonly number[],
  arrive: number | null = null,
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
  const ax0 = arrive === null ? NaN : (grid.x[arrive] as number), az0 = arrive === null ? NaN : (grid.z[arrive] as number);
  const exempt = treeEdges.map(([ea, eb]) => {
    const eax = grid.x[ea] as number, eaz = grid.z[ea] as number, ebx = grid.x[eb] as number, ebz = grid.z[eb] as number;
    if (segmentDistance(eax, eaz, ebx, ebz, dx0, dz0) <= DEPART_REACH) return true;
    // THE ARRIVAL IS EXEMPT LIKE THE DEPARTURE (2026-09-16): a strand or a rung
    // ends ON an existing bed, so its last segment is 0 m from that bed by
    // construction, exactly as its first is from the one it leaves.
    return arrive !== null && segmentDistance(eax, eaz, ebx, ebz, ax0, az0) <= DEPART_REACH;
  });
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
export function planPath(
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
export function markPath(
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
export function restemProgress(state: GraphState, summit: number): { stem: number[]; stemLen: number } {
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
export const SPLIT_SNAP = 2 * TRAIL_CORRIDOR_HALF;
export function splitAt(cell: number, grid: TrailGrid, frame: BuildFrame, H: Heights, state: GraphState): number {
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
