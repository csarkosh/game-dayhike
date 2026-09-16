/**
 * The braid — the descent below the crest as a web (2026-09-16).
 *
 * At a TOP FORK on the stem the trail splits into 2–3 STRANDS that descend
 * roughly in parallel, BRAID_LATERAL_MIN–MAX apart, and rejoin at a BOTTOM
 * FORK above the pad. RUNGS cross-link adjacent strands at seeded heights (or a
 * strand and a loop's bed, where the strand across cannot be reached).
 * The original stem between the two forks is strand A. Every strand and rung
 * is routed on the walkability grid with the same machinery the loops use
 * (trailPlan.ts): the tree is forbidden except at the endpoints, feature
 * discs are forbidden, the two-cell rule keeps each new bed a corridor away
 * from every other, the simplifier keeps the gap — a rung is measured against
 * that gap once more on the finished graph, where the simplifier's departure
 * exemption cannot hide it (`crowds`) — and the composed fine check accepts or
 * rejects. A strand or rung that cannot route is dropped — the plan shrinks, a
 * seed always gets a legal world.
 *
 * Where along the stem a cell "is" — its arc and its signed lateral offset —
 * comes from the nearest point on the sampled stem and that point's tangent
 * (`stemPose`), not from the global pad→crest axis, so a stem that wanders
 * keeps its strands beside it rather than beside the chord.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import { hash3 } from "./field.js";
import { cellAt, TRAIL_GRID_CELL, type TrailGrid, type GroundFn } from "./trailGrid.js";
import { segmentSegmentDistanceSq, trailCorridorD, TRAIL_EDGE_MIN_GAP, type TrailEdge, type TrailLoop, type TrailNode } from "./trail.js";
import { type Feature } from "./features.js";
import {
  planPath, splitAt, markPath, routeTo, forEachCellNear, featureReach, stemGeometry, sampleStem,
  type BuildFrame, type Heights, type GraphState, type StemSample,
} from "./trailPlan.js";

/** P(two strands); otherwise three. */
export const BRAID_STRANDS_WEIGHT_2 = 0.6;
/** The top fork's drawn stem progress band: the last climb to the crest is one trail. */
export const BRAID_TOP_MIN = 0.75;
export const BRAID_TOP_MAX = 0.85;
/**
 * How far below the peak disc's entry the top fork sits when the drawn band is
 * inside the dome (m of stem). The whole dome is then the one trail the band's
 * own reason asks for. Amended 2026-09-16 (spec §3.2): the band lies inside the
 * dome on most seeds, and the skirt has no walkable ground for a strand to
 * leave the stem on — measured, 76 of 227 seeds could route a strand from no
 * fork anywhere in the band.
 */
export const BRAID_PEAK_MARGIN = 40;
/** The top fork never drops below this stem progress, dome or no dome. */
export const BRAID_TOP_FLOOR = 0.5;
/** The ladder's rung spacing below the top fork (m of stem). */
export const BRAID_LADDER_STEP = 60;
/** The least stem a braid may span: the two forks must leave Task 4's rungs room. */
export const BRAID_MIN_SPAN = 240;
/**
 * The most a strand's bed may stand off the ground it crosses (m), as
 * `maxFlushOff` measures it.
 *
 * A STRAND IS OPTIONAL, SO IT CAN BE HELD TO THIS (2026-09-16, fix round 2).
 * The flush invariant belongs to `trailBed.test.ts`, which caps the finished
 * world's worst bed-to-ground residual at 2 m over the 227-seed sweep; the
 * stem and the loops sit where they sit under it, because they have to exist
 * and a bed cutting a ridgelet narrower than the profile's own 8 m kernel is
 * that gate's documented tail (worst non-strand sample on this sweep:
 * 1.784 m). A strand has no such claim: when its bed would not sit on the
 * ground, the next rung or the other side is tried and the plan shrinks. The
 * value is the stem's own tail rounded down, not the gate's ceiling, so a
 * strand never spends the margin the trail that must exist may need.
 * Measured: the first strand below the dome on seed -663635494 cut 2.059 m
 * through the skirt's foot, 3 % over the gate.
 */
export const BRAID_FLUSH_MAX = 1.5;
/** The bottom fork's stem progress band: the strands rejoin above the pad. */
export const BRAID_BOTTOM_MIN = 0.08;
export const BRAID_BOTTOM_MAX = 0.15;
/** A strand's preferred lateral band off the stem (m). */
export const BRAID_LATERAL_MIN = 80;
export const BRAID_LATERAL_MAX = 200;
/** The search weight outside the lateral band, on the strand's own side. */
export const BRAID_OFF_BAND_COST = 2.5;
/** Within this of either fork a strand may cross the stem's line freely: it has to peel off and rejoin. */
export const BRAID_END_FREE = 40;
/** The tree is cleared this many cells round an arrival so the search can step onto it. */
export const BRAID_ARRIVE_CELLS = 2;
/** Rungs per adjacent strand pair, inclusive. */
export const BRAID_RUNGS_MIN = 2;
export const BRAID_RUNGS_MAX = 3;
/** Least stem arc between two rungs of one pair, and between a rung and a fork (m). */
export const BRAID_RUNG_GAP = 120;
/** A rung's seeded slide off its even spacing, as a fraction of that spacing. */
export const BRAID_RUNG_JITTER = 0.15;
/** A rung's search may wander this far along the stem's arc from its height (m). */
export const BRAID_RUNG_ALONG_HALF = 100;
export const BRAID_SALT = 0xb2a1d;

export const BRAID_TUNABLES: Readonly<Record<string, number>> = {
  BRAID_STRANDS_WEIGHT_2, BRAID_TOP_MIN, BRAID_TOP_MAX, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX,
  BRAID_PEAK_MARGIN, BRAID_TOP_FLOOR, BRAID_LADDER_STEP, BRAID_MIN_SPAN, BRAID_FLUSH_MAX,
  BRAID_LATERAL_MIN, BRAID_LATERAL_MAX, BRAID_OFF_BAND_COST, BRAID_END_FREE, BRAID_ARRIVE_CELLS,
  BRAID_RUNGS_MIN, BRAID_RUNGS_MAX, BRAID_RUNG_GAP, BRAID_RUNG_JITTER, BRAID_RUNG_ALONG_HALF, BRAID_SALT,
};

/** A seeded value in [lo, hi] for braid draw `i`. */
export function braidDraw(seed: number, i: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hash3(i, 0, 0, seed ^ BRAID_SALT);
}

export type Strand = { side: -1 | 0 | 1; top: number; bottom: number; nodes: number[] };
/**
 * What the braid stage decided, apart from the graph it built: the strands
 * (strand A first, every chain top → bottom), the two forks' arcs and the stem
 * samples they were measured against. `buildTrail` hands this back so the
 * braid's own decisions can be read — and tested — without rebuilding the
 * world's grid, tree and heights to call `buildStrands` directly.
 */
export type Braid = { strands: Strand[]; topArc: number; bottomArc: number; samples: StemSample[] };
export type BraidCtx = {
  seed: number; grid: TrailGrid; frame: BuildFrame; H: Heights; ground: GroundFn;
  tree: Uint8Array; treeEdges: Array<[number, number]>; features: readonly Feature[]; summit: number;
  /** The loops the stage before this one committed: a rung may end on one. */
  loops: readonly TrailLoop[];
};

/**
 * Where (x, z) stands relative to the stem: the arc of the NEAREST POINT ON
 * the sampled stem polyline and the signed lateral offset from that point's
 * tangent (left of the pad→crest direction is positive).
 *
 * THE NEAREST POINT, NOT THE NEAREST SAMPLE (2026-09-16). `sampleStem` steps
 * every TRAIL_GRID_CELL, so the nearest sample's own arc is quantised to 8 m
 * — half a step of error, which the band gating can live with but a
 * PROGRESS LABEL cannot: `trailBraid.test.ts` reads a strand edge's
 * `progress` back against `stemProgress` (trailRoute.ts), which projects onto
 * the stem's own segments, and the two disagreed by up to 0.0028 of the stem
 * (measured: 0.72126 against 0.71851 on seed 1, ~4 m of 1450 m). Projecting
 * onto each sample pair costs the same O(samples) pass and agrees with
 * `stemProgress` exactly: consecutive samples lie ON the stem polyline, so
 * this is the same projection over a finer subdivision of the same line.
 */
export function stemPose(samples: readonly StemSample[], x: number, z: number): { arc: number; lat: number } {
  if (samples.length === 0) return { arc: 0, lat: 0 };
  let bestArc = (samples[0] as StemSample).arc, bestLat = 0, bestD2 = Infinity;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i] as StemSample, b = samples[i + 1] as StemSample;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    if (L2 <= 0) continue;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + ex * t, pz = a.z + ez * t;
    const dx = x - px, dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue;
    const L = Math.sqrt(L2);
    bestD2 = d2;
    bestArc = a.arc + (b.arc - a.arc) * t;
    bestLat = (dx * -ez + dz * ex) / L; // the left normal of the segment's direction
  }
  if (bestD2 === Infinity) {
    // A degenerate stem (every sample in one spot): no tangent to measure against.
    const s = samples[0] as StemSample;
    return { arc: s.arc, lat: Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z)) };
  }
  return { arc: bestArc, lat: bestLat };
}

/**
 * Every grid cell's stem pose, read once for the whole braid stage: `arc[c]`
 * and `lat[c]` are what `stemPose` gives at cell `c`'s centre.
 *
 * The stem samples do not move while strands and rungs are built, so a cell's
 * pose is a constant of the stage — but both searches ask for it over the WHOLE
 * grid on every try, which is O(cells x samples) each time, and a braid makes up
 * to twelve strand tries and a rung try per height, side and ladder rung. One
 * pass fills these, and the try loops read them. `stemPose` itself stays: its
 * other callers ask about arbitrary points, not cell centres.
 */
export type CellPose = { arc: Float32Array; lat: Float32Array };

/** `stemPose` at every cell centre of `grid`, as a CellPose. */
export function cellPoses(grid: TrailGrid, samples: readonly StemSample[]): CellPose {
  const n = grid.pass.length;
  const arc = new Float32Array(n), lat = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const p = stemPose(samples, grid.x[c] as number, grid.z[c] as number);
    arc[c] = p.arc;
    lat[c] = p.lat;
  }
  return { arc, lat };
}

/**
 * Where the stem enters the peak's disc, less BRAID_PEAK_MARGIN of stem: the
 * highest the top fork may sit. `Infinity` when there is no peak (a fallback
 * world), so the drawn band stands.
 *
 * Walked from the PAD, so it is the first crossing of the disc's rim, not the
 * last — a stem that grazes the disc and comes out again still forks below it.
 */
export function peakEntryArc(samples: readonly StemSample[], features: readonly Feature[]): number {
  for (const f of features) {
    if (f.kind !== "peak") continue;
    for (const s of samples) {
      const dx = s.x - f.x, dz = s.z - f.z;
      if (Math.sqrt(dx * dx + dz * dz) <= f.radius) return s.arc - BRAID_PEAK_MARGIN;
    }
  }
  return Infinity;
}

/**
 * How far the bed stands off the ground under it, at its worst over `edges`:
 * the corridor union of the WHOLE graph in `state` (`trailCorridorD`, so every
 * bed near the sample is blended in, not just this edge's own profile) minus
 * the ground `ground` gives at the same point, sampled every metre along each
 * edge's centreline, as an absolute value. Cut and fill count the same.
 *
 * This is the braid's OWN measure, not a call into the gate it serves.
 * `trailBed.test.ts`'s flush gate asks the same question of the finished world
 * — composed field against the pre-trail ground with its domes, at 1 m along
 * every centreline — and `trailBraid.test.ts` pins the two together by
 * asserting this function reads under BRAID_FLUSH_MAX on the built worlds.
 * If the gate's step, kernel or ceiling moves, that assertion is what should
 * be re-read before BRAID_FLUSH_MAX is trusted again.
 */
export function maxFlushOff(state: GraphState, ground: GroundFn, edges: readonly number[]): number {
  let worst = 0;
  for (const ei of edges) {
    const e = state.edges[ei] as TrailEdge;
    const a = state.nodes[e.a] as TrailNode, b = state.nodes[e.b] as TrailNode;
    const L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    const n = Math.max(1, Math.ceil(L));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const g = ground(x, z);
      const d = trailCorridorD(state.nodes, state.edges, x, z, g).h - g.h;
      const ad = d < 0 ? -d : d;
      if (ad > worst) worst = ad;
    }
  }
  return worst;
}

/** The nearest sample by arc. */
function sampleAtArc(samples: readonly StemSample[], arc: number): StemSample {
  let best = samples[0] as StemSample;
  for (const s of samples) if (Math.abs(s.arc - arc) < Math.abs(best.arc - arc)) best = s;
  return best;
}

/** A tree copy with the cells within `cells` grid cells of `c` cleared: the arrival's doorway. */
export function clearedAround(grid: TrailGrid, tree: Uint8Array, c: number, cells: number): Uint8Array {
  const out = tree.slice();
  forEachCellNear(grid, grid.x[c] as number, grid.z[c] as number, cells * TRAIL_GRID_CELL, (m) => { out[m] = 0; });
  return out;
}

/** The weight every braid search starts from: feature discs (plus apron and a
 * cell) forbidden, the tree forbidden except the start cell and the arrival's
 * doorway; 1 everywhere else. */
export function baseWeight(ctx: BraidCtx, tree: Uint8Array, start: number, arrival: number): Float32Array {
  const { grid } = ctx;
  const w = new Float32Array(grid.pass.length).fill(1);
  for (const f of ctx.features) {
    if (f.kind === "peak") continue;
    forEachCellNear(grid, f.x, f.z, featureReach(f) + TRAIL_GRID_CELL, (c) => { w[c] = 0; });
  }
  for (let c = 0; c < tree.length; c++) if (tree[c] === 1) w[c] = 0;
  w[start] = 1;
  forEachCellNear(grid, grid.x[arrival] as number, grid.z[arrival] as number, BRAID_ARRIVE_CELLS * TRAIL_GRID_CELL, (c) => {
    if (ctx.tree[c] === 1) w[c] = 1; // the doorway: the bed being joined, not a feature disc
  });
  return w;
}

/** The node chain from `from` along `firstEdge`, following degree-2 nodes until a node of another degree. */
export function chainFrom(state: GraphState, from: number, firstEdge: number): number[] {
  const degree = new Map<number, number>();
  const adj = new Map<number, Array<{ to: number; ei: number }>>();
  state.edges.forEach((e, ei) => {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei });
  });
  const e0 = state.edges[firstEdge] as TrailEdge;
  const chain = [from];
  let prevEi = firstEdge, at = e0.a === from ? e0.b : e0.a;
  chain.push(at);
  while ((degree.get(at) ?? 0) === 2) {
    const next = (adj.get(at) ?? []).find((l) => l.ei !== prevEi);
    if (next === undefined) break;
    prevEi = next.ei;
    at = next.to;
    chain.push(at);
  }
  return chain;
}

/** A fork pair resolved onto a copy of the graph: the two cells, the two nodes
 * and the graph they were split into. */
type Forks = { state: GraphState; T: number; B: number; cTop: number; cBot: number };

/**
 * The two forks for one candidate arc pair, split into a COPY of `base` — a
 * candidate that never routes leaves the graph it was measured against
 * untouched. `null` when the pair is not a legal fork pair.
 */
function forksFor(
  base: GraphState, ctx: BraidCtx, samples: readonly StemSample[], topArc: number, bottomArc: number,
): Forks | null {
  const { grid, frame, H, summit } = ctx;
  const sTop = sampleAtArc(samples, topArc), sBot = sampleAtArc(samples, bottomArc);
  const cTop = cellAt(grid, frame.roadCenterX, sTop.x, sTop.z);
  const cBot = cellAt(grid, frame.roadCenterX, sBot.x, sBot.z);
  if (cTop < 0 || cBot < 0 || cTop === cBot) return null;
  const state = planPath(base, [], grid, frame, H).state;
  const T = state.nodeOfCell.get(cTop) ?? splitAt(cTop, grid, frame, H, state);
  const B = state.nodeOfCell.get(cBot) ?? splitAt(cBot, grid, frame, H, state);
  if (T === B || T === summit || B === 0) return null;
  // BOTH FORKS MUST BE ON THE STEM (2026-09-16). A fork is a cell on the stem
  // BED, and `splitAt` divides the edge that covers it — but `edgeOfCell` is
  // filled along the CELL CENTRES a branch was routed through, while node 0 is
  // the pad CENTRE, so the first stem edge's own geometry runs slightly off
  // the cells recorded for it. A fork drawn low enough to land on that edge
  // can fall in a cell no edge covers, and `splitAt`'s safe answer there is a
  // FRESH node — which the strand then joins instead of the trail, leaving a
  // second dead end. Measured on seed -714954089 of the 227-seed sweep before
  // this check: node 23 at u 84, degree 1, one strand edge and nothing else.
  const g0 = stemGeometry(state, summit);
  if (!g0.stemNodes.includes(T) || !g0.stemNodes.includes(B)) return null;
  return { state, T, B, cTop, cBot };
}

/**
 * The strands. Draws the count, the forks and the first side, then routes each
 * extra strand top → bottom on its own side of the stem. Returns the graph as
 * it stands (the original `state` if no strand built — the fork splits are
 * committed only with a strand) and the strand list with strand A first.
 *
 * THE DRAWN FORK AND SIDE ARE THE FIRST TRY, NOT THE ONLY ONE (2026-09-16,
 * fix round 1). Measured over the 227-seed sweep with a single try: 233 strand
 * attempts failed, 229 of them because the constrained search never REACHED
 * the bottom fork, and the search descended a median 3 % of the way from the
 * top fork before it ran out of walkable ground. The wall is the terrain, not
 * the braid's own rules — relaxing the side, the arc window, the tree forbid,
 * the feature discs or the two-cell rule left 137 of those 229 still
 * unreachable, while making every cell passable freed them — and the terrain
 * in question is the PEAK'S DOME: the drawn top fork sits at a median 0.57 of
 * the peak radius from its centre, where the only walkable ground is the line
 * the stem's own search threaded. So a strand tries, in order, each top fork
 * in a three-rung ladder (the top fork, then BRAID_LADDER_STEP down the stem
 * twice) and, at each rung, its own side then the side no strand has taken.
 * The bottom fork is not laddered: redrawing it unlocked 6 of the 233.
 *
 * The dome itself is answered above the ladder, by where the top fork starts:
 * `peakEntryArc` puts it below the disc (spec §3.2, amended after this
 * measurement).
 */
export function buildStrands(state: GraphState, ctx: BraidCtx): Braid & { state: GraphState; pose: CellPose } {
  const { seed, grid, frame, H, ground, tree, treeEdges, summit } = ctx;
  const geom = stemGeometry(state, summit);
  const samples = sampleStem(state, geom);
  const pose = cellPoses(grid, samples);
  const count = braidDraw(seed, 0, 0, 1) < BRAID_STRANDS_WEIGHT_2 ? 2 : 3;
  const bottomArc = geom.stemLen * braidDraw(seed, 2, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX);
  // THE DRAWN BAND OR BELOW THE DOME, WHICHEVER IS LOWER (spec §3.2, amended
  // 2026-09-16). The drawn band lies inside the peak's disc on most seeds, and
  // the dome's skirt has no walkable ground for a strand to leave the stem on;
  // the fork therefore drops to BRAID_PEAK_MARGIN of stem below where the stem
  // enters the disc, and never below BRAID_TOP_FLOOR of the way up.
  const drawnArc = geom.stemLen * braidDraw(seed, 1, BRAID_TOP_MIN, BRAID_TOP_MAX);
  const floorArc = geom.stemLen * BRAID_TOP_FLOOR;
  const entryArc = peakEntryArc(samples, ctx.features);
  const topArc = Math.max(floorArc, Math.min(drawnArc, entryArc));
  const none = { state, strands: [] as Strand[], topArc, bottomArc, samples, pose };
  // The ladder: the top fork, then BRAID_LADDER_STEP down the stem twice. A
  // rung below the floor, or one that leaves less than BRAID_MIN_SPAN of stem
  // between the forks (Task 4's rungs need the room), is not a fork at all.
  const topLadder = [topArc, topArc - BRAID_LADDER_STEP, topArc - 2 * BRAID_LADDER_STEP]
    .filter((a) => a >= floorArc && a - bottomArc >= BRAID_MIN_SPAN);

  const firstSide: 1 | -1 = braidDraw(seed, 3, 0, 1) < 0.5 ? 1 : -1;
  const built: Strand[] = [];
  const usedSides = new Set<number>();
  let base = state;
  // The committed top fork's arc, -1 until a strand builds: once one has, the
  // braid HAS its forks and every later strand leaves and rejoins at the same
  // two. `forksFor` reuses them rather than splitting again — the split's own
  // node is in `base.nodeOfCell` from the moment it is committed.
  let forkArc = -1;
  let forkT = -1, forkB = -1;
  for (let k = 1; k < count; k++) {
    const drawn: 1 | -1 = k === 1 ? firstSide : (firstSide === 1 ? -1 : 1);
    const other: 1 | -1 = drawn === 1 ? -1 : 1;
    // A strand takes its own side first; the other side is a fallback only
    // while no strand has taken it, so the strands of a three-strand braid
    // still straddle the stem.
    const sides = [drawn, other].filter((s) => !usedSides.has(s));
    const arcs: number[] = forkArc < 0 ? topLadder : [forkArc];
    let done = false;
    for (const tArc of arcs) {
      if (done) break;
      const cand = forksFor(base, ctx, samples, tArc, bottomArc);
      if (cand === null) continue;
      const { T, B, cTop, cBot } = cand;
      const tNode = cand.state.nodes[T] as TrailNode, bNode = cand.state.nodes[B] as TrailNode;
      for (const side of sides) {
        const tS = clearedAround(grid, tree, cBot, BRAID_ARRIVE_CELLS);
        const w = baseWeight(ctx, tree, cTop, cBot);
        for (let c = 0; c < w.length; c++) {
          if ((w[c] as number) === 0) continue;
          const x = grid.x[c] as number, z = grid.z[c] as number;
          const dT = (x - tNode.x) * (x - tNode.x) + (z - tNode.z) * (z - tNode.z);
          const dB = (x - bNode.x) * (x - bNode.x) + (z - bNode.z) * (z - bNode.z);
          if (dT < BRAID_END_FREE * BRAID_END_FREE || dB < BRAID_END_FREE * BRAID_END_FREE) continue;
          const arc = pose.arc[c] as number, lat = pose.lat[c] as number;
          // Only between the forks, and only on this strand's side.
          if (arc < bottomArc - BRAID_END_FREE || arc > tArc + BRAID_END_FREE || lat * side <= 0) { w[c] = 0; continue; }
          const a = lat < 0 ? -lat : lat;
          if (a < BRAID_LATERAL_MIN || a > BRAID_LATERAL_MAX) w[c] = BRAID_OFF_BAND_COST;
        }
        const marked: number[] = [];
        const r = routeTo(grid, frame, H, ground, cand.state, tS, treeEdges, cTop, cBot, marked, w, true);
        for (const c of marked) grid.pass[c] = 1;
        if (!r.ok) continue;
        // A STRAND HAS TO LEAVE THE STEM (2026-09-16). The lateral band is a
        // WEIGHT, not a wall — off-band ground costs BRAID_OFF_BAND_COST rather
        // than being forbidden, and within BRAID_END_FREE of either fork the side
        // rule is waived entirely — so on ground with no room (a walled strip
        // narrower than 2·BRAID_LATERAL_MIN: `narrowFrame` in the tests) the
        // search happily returns a stub that runs beside the stem the whole way.
        // That is not a strand, it is a second bed in the same corridor, and it
        // takes the ground the scenery pass needs. Measured on the narrow frame
        // before this rule: a 3-edge "strand" that never got 59 m off the stem,
        // after which the talus could find no candidate clear of the trail.
        let reach = 0;
        for (const c of r.best.cells) {
          const { lat } = stemPose(samples, grid.x[c] as number, grid.z[c] as number);
          const a = lat < 0 ? -lat : lat;
          if (a > reach) reach = a;
        }
        if (reach < BRAID_LATERAL_MIN) continue;
        const plan = planPath(cand.state, r.best.cells, grid, frame, H);
        if (plan.added.length === 0) continue;
        for (const ei of plan.added) (plan.state.edges[ei] as TrailEdge).kind = "strand";
        // The bed has to sit on the ground, not cut through it: see BRAID_FLUSH_MAX.
        if (maxFlushOff(plan.state, ground, plan.added) > BRAID_FLUSH_MAX) continue;
        markPath(r.best.cells, grid, frame, tree, treeEdges);
        base = plan.state;
        forkArc = tArc;
        forkT = T;
        forkB = B;
        usedSides.add(side);
        built.push({ side, top: T, bottom: B, nodes: chainFrom(base, T, plan.added[0] as number) });
        done = true;
        break;
      }
    }
  }
  if (built.length === 0) return none;

  // Strand A: the stem between the forks, read off the split graph. Every
  // strand's chain runs TOP → BOTTOM (the built ones start at T by
  // construction, `chainFrom(base, T, …)`), and `stemNodes` runs pad → crest,
  // so the slice always comes out bottom-first and always has to be reversed.
  // Asked of the chain itself rather than of the two indices: it is the
  // contract, and the index comparison was written the wrong way round.
  const T = forkT, B = forkB;
  const g2 = stemGeometry(base, summit);
  const iT = g2.stemNodes.indexOf(T), iB = g2.stemNodes.indexOf(B);
  const aNodes = g2.stemNodes.slice(Math.min(iT, iB), Math.max(iT, iB) + 1);
  if ((aNodes[0] as number) !== T) aNodes.reverse();
  return {
    state: base, strands: [{ side: 0, top: T, bottom: B, nodes: aNodes }, ...built],
    topArc: forkArc, bottomArc, samples, pose,
  };
}

/**
 * The point on a bed nearest a stem arc, as a grid cell on the tree (the cell
 * the bed passes through nearest that arc), or -1 when the bed has no tree cell
 * within `limit` of that arc. `segs` are the bed's node-index pairs — a
 * strand's chain, or a loop's edges.
 *
 * Read off node POSITIONS rather than off the bed's cells: `splitAt` puts its
 * node on the centreline of the edge it divides, so the straight segments still
 * lie on the bed after an earlier rung has split one, and a stale node list
 * still describes the same polyline.
 */
function bedCellAtArc(
  grid: TrailGrid, frame: BuildFrame, state: GraphState, tree: Uint8Array,
  samples: readonly StemSample[], segs: ReadonlyArray<readonly [number, number]>, arc: number, limit: number,
): number {
  let best = -1, bestDiff = limit;
  for (const [na, nb] of segs) {
    const a = state.nodes[na] as TrailNode, b = state.nodes[nb] as TrailNode;
    const L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    const n = Math.max(1, Math.ceil(L / TRAIL_GRID_CELL));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const diff = Math.abs(stemPose(samples, x, z).arc - arc);
      if (diff >= bestDiff) continue;
      const c = cellAt(grid, frame.roadCenterX, x, z);
      if (c < 0 || tree[c] !== 1) continue;
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

/** `bedCellAtArc` over a strand's own chain: the nearest arc on it, wherever it is. */
function strandCellAtArc(
  grid: TrailGrid, frame: BuildFrame, state: GraphState, tree: Uint8Array,
  samples: readonly StemSample[], strand: Strand, arc: number,
): number {
  const segs: Array<readonly [number, number]> = [];
  for (let k = 0; k + 1 < strand.nodes.length; k++) segs.push([strand.nodes[k] as number, strand.nodes[k + 1] as number]);
  return bedCellAtArc(grid, frame, state, tree, samples, segs, arc, Infinity);
}

/**
 * Whether any of `added` runs closer than TRAIL_EDGE_MIN_GAP to an edge it does
 * not share a node with — the clear ground two beds keep, measured on the GRAPH
 * rather than on the grid.
 *
 * THE SIMPLIFIER'S OWN GAP CHECK IS NOT THIS CHECK (2026-09-16). That one works
 * in cell pairs and EXEMPTS the tree edges through the departure and the arrival
 * cells, because a branch's first segment starts on the bed it leaves and is 0 m
 * from it by construction. The exemption covers a first step, but a rung that
 * leaves a bed one cell off and then runs a long straight segment keeps its
 * closest approach inside that exempt stretch while the edge it shadows is, as a
 * whole edge, well inside the gap. Measured on seed 32 of the flat frame before
 * this check: the rung's second edge 9.07 m from both halves of the stem edge it
 * departed, against the 16 m two corridors need — and over the 227-seed sweep
 * the 317 rungs this rejects sit a median 8.0 m from a bed they do not meet
 * (p25 6.40, p75 8.03, max 16.0): one grid cell, not the margin. A rung is
 * optional, so it is dropped.
 */
function crowds(state: GraphState, added: readonly number[]): boolean {
  const { nodes, edges } = state;
  for (const ei of added) {
    const e = edges[ei] as TrailEdge;
    const a = nodes[e.a] as TrailNode, b = nodes[e.b] as TrailNode;
    for (let fj = 0; fj < edges.length; fj++) {
      if (fj === ei) continue;
      const f = edges[fj] as TrailEdge;
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      const c = nodes[f.a] as TrailNode, d = nodes[f.b] as TrailNode;
      if (segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) < TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP) return true;
    }
  }
  return false;
}

/**
 * The rungs: for each adjacent strand pair (sorted by side), 2–3 seeded heights
 * between the forks, each at least BRAID_RUNG_GAP of stem apart and from either
 * fork; each rung is routed from the pair's first strand to its second inside a
 * window of ±BRAID_RUNG_ALONG_HALF of its height, tree forbidden except at its
 * ends — or, when that strand cannot be reached at all, onto a loop's bed on the
 * same side of the stem. A rung that cannot route, whose height cannot be found
 * on both strands, whose bed will not sit on the ground or which crowds a bed it
 * does not meet is dropped — the plan shrinks, a seed always gets a legal world.
 *
 * THE DRAWN HEIGHT IS THE FIRST TRY, NOT THE ONLY ONE (2026-09-16), the same
 * answer the top fork's ladder gives for the same reason and at the same step.
 * A rung crosses ground the strands left behind, and where a loop's bed or a
 * fold seals the corridor between two strands at one height it usually does not
 * at the next. Measured over the 227-seed sweep with the drawn height alone: 71
 * rungs on 61 seeds; with the ladder, 120 on 95, for 3 % more sweep time
 * (109.1 s -> 112.6 s). The braid as it now stands — the ladder, and a loop's
 * bed as the arrival of last resort — builds 128 rungs over 237 edges on 101 of
 * the 227 seeds, 162 of which build a strand at all. The seeds that still get
 * none are walled in, not unlucky: on seed 32 of the flat frame every try on
 * the -1-to-A pair failed to REACH the arrival, because that strand's pocket is
 * sealed by a loop bed the rung may not cross.
 */
export function buildRungs(
  state: GraphState, ctx: BraidCtx, strands: readonly Strand[], samples: readonly StemSample[],
  topArc: number, bottomArc: number, pose: CellPose,
): { state: GraphState; rungs: number } {
  const { seed, grid, frame, H, ground, tree, treeEdges } = ctx;
  if (strands.length < 2) return { state, rungs: 0 };
  const ordered = strands.slice().sort((p, q) => p.side - q.side);
  let cur = state;
  let rungs = 0;
  /**
   * One rung from cell `cX` to cell `cY` at stem arc `arc`: the graph it builds,
   * or null with `unreached` saying whether the search never got there at all
   * (as against a rejection on slope, flush or crowding).
   */
  const rungTo = (cX: number, cY: number, arc: number, onLoop: TrailLoop | null): { state: GraphState | null; unreached: boolean } => {
    const no = (unreached = false): { state: null; unreached: boolean } => ({ state: null, unreached });
    // BOTH ENDS MUST LAND ON A BED (2026-09-16). `planPath` splits the edge
    // under the branch's FIRST cell, but every later cell — the arrival
    // included — is looked up in `nodeOfCell` and MINTED as a fresh node when it
    // is not there, which for a rung means a node beside strand Y's bed instead
    // of on it: a second dead end. Measured with the departure split alone, on
    // seed 2 of the flat frame: node 49, degree 1, one rung edge and nothing
    // else. So the arrival is split first, into a COPY of the graph (a rung that
    // never routes leaves `cur` untouched), exactly as `forksFor` splits a
    // strand's two forks; and a cell no edge covers is not a rung end at all.
    if (!cur.nodeOfCell.has(cX) && !cur.edgeOfCell.has(cX)) return no();
    if (!cur.nodeOfCell.has(cY) && !cur.edgeOfCell.has(cY)) return no();
    const staged = planPath(cur, [], grid, frame, H).state;
    const edgesBefore = staged.edges.length;
    splitAt(cY, grid, frame, H, staged);
    // A LOOP IS A RING AND HAS TO STAY ONE. `splitAt` shortens the edge it
    // divides and pushes the far half on as a NEW index, which `loop.edges`
    // does not know about — and that list is what walks the ring (its length,
    // its junction-to-junction path, its paint). The new index is recorded on
    // the loop when the rung commits, and only then.
    const splitEdge = staged.edges.length > edgesBefore ? staged.edges.length - 1 : -1;
    const tS = clearedAround(grid, tree, cY, BRAID_ARRIVE_CELLS);
    const w = baseWeight(ctx, tree, cX, cY);
    for (let c = 0; c < w.length; c++) {
      if ((w[c] as number) === 0) continue;
      const a = pose.arc[c] as number;
      if (a < arc - BRAID_RUNG_ALONG_HALF || a > arc + BRAID_RUNG_ALONG_HALF) w[c] = 0;
    }
    w[cX] = 1;
    const marked: number[] = [];
    const r = routeTo(grid, frame, H, ground, staged, tS, treeEdges, cX, cY, marked, w, true);
    for (const c of marked) grid.pass[c] = 1;
    if (!r.ok) return no(r.best.cells.length === 0);
    const plan = planPath(staged, r.best.cells, grid, frame, H);
    if (plan.added.length === 0) return no();
    for (const ei of plan.added) (plan.state.edges[ei] as TrailEdge).kind = "rung";
    // The bed has to sit on the ground, not cut through it: a rung is as
    // optional as a strand, so it is held to the same BRAID_FLUSH_MAX.
    if (maxFlushOff(plan.state, ground, plan.added) > BRAID_FLUSH_MAX) return no();
    if (crowds(plan.state, plan.added)) return no();
    markPath(r.best.cells, grid, frame, tree, treeEdges);
    if (onLoop !== null && splitEdge >= 0) onLoop.edges.push(splitEdge);
    return { state: plan.state, unreached: false };
  };

  /**
   * A loop's bed at this arc, on `side` of the stem: the arrival of last resort
   * when the pair's own strand cannot be reached. The loop that seals a
   * strand's pocket is exactly the bed that is reachable when the strand behind
   * it is not, and ending a rung on it is a fork on a real trail rather than no
   * rung at all. Held to the same arc window the search is, so a rung never
   * runs off to a loop the ground between could not carry it to anyway.
   */
  const loopCellAtArc = (side: number, arc: number): { cell: number; loop: TrailLoop } | null => {
    if (side === 0) return null;
    for (const loop of ctx.loops) {
      const f = ctx.features.find((g) => g.id === loop.featureId);
      if (f === undefined) continue;
      if (stemPose(samples, f.x, f.z).lat * side <= 0) continue;
      const segs = loop.edges.map((ei) => {
        const e = cur.edges[ei] as TrailEdge;
        return [e.a, e.b] as const;
      });
      const cell = bedCellAtArc(grid, frame, cur, tree, samples, segs, arc, BRAID_RUNG_ALONG_HALF);
      if (cell >= 0) return { cell, loop };
    }
    return null;
  };

  /**
   * One rung of the pair X→Y at stem arc `arc`: the graph it builds, or null.
   *
   * A LOOP'S BED IS THE ARRIVAL OF LAST RESORT (2026-09-16). When the search
   * cannot REACH strand Y at all — measured as the single largest reason a rung
   * is dropped — it is usually walled in rather than merely unlucky, and the
   * wall is a bed: on seed 32 of the flat frame the -1 strand's pocket is
   * sealed by a loop that runs from the stem out past it. That loop is
   * reachable when the strand behind it is not, so the rung ends there instead,
   * on the side of the stem the pair straddles (a pair is always one strand and
   * strand A, so the side is whichever of the two is not the stem's own 0).
   */
  const rungAt = (X: Strand, Y: Strand, arc: number): GraphState | null => {
    const cX = strandCellAtArc(grid, frame, cur, tree, samples, X, arc);
    const cY = strandCellAtArc(grid, frame, cur, tree, samples, Y, arc);
    if (cX < 0 || cY < 0 || cX === cY) return null;
    const first = rungTo(cX, cY, arc, null);
    if (first.state !== null) return first.state;
    if (!first.unreached) return null;
    const onLoop = loopCellAtArc(X.side !== 0 ? X.side : Y.side, arc);
    if (onLoop === null || onLoop.cell === cX) return null;
    return rungTo(cX, onLoop.cell, arc, onLoop.loop).state;
  };
  for (let pi = 0; pi + 1 < ordered.length; pi++) {
    const X = ordered[pi] as Strand, Y = ordered[pi + 1] as Strand;
    const draw = braidDraw(seed, 10 + pi, 0, 1);
    const n = BRAID_RUNGS_MIN + Math.floor(draw * (BRAID_RUNGS_MAX - BRAID_RUNGS_MIN + 1));
    const lo = bottomArc + BRAID_RUNG_GAP, hi = topArc - BRAID_RUNG_GAP;
    if (hi - lo < BRAID_RUNG_GAP) continue;
    const spacing = (hi - lo) / (n + 1);
    let lastArc = -Infinity;
    for (let i = 0; i < n; i++) {
      const jitter = (braidDraw(seed, 20 + pi * 8 + i, 0, 1) - 0.5) * 2 * BRAID_RUNG_JITTER * spacing;
      const drawn = lo + spacing * (i + 1) + jitter;
      for (const arc of [drawn, drawn - BRAID_LADDER_STEP, drawn + BRAID_LADDER_STEP]) {
        if (arc < lo || arc > hi || arc - lastArc < BRAID_RUNG_GAP) continue;
        const next = rungAt(X, Y, arc);
        if (next === null) continue;
        cur = next;
        lastArc = arc;
        rungs++;
        break;
      }
    }
  }
  return { state: cur, rungs };
}
