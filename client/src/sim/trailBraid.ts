/**
 * The braid — the descent below the crest as a web (2026-09-16).
 *
 * At a TOP FORK on the stem the trail splits into 2–3 STRANDS that descend
 * roughly in parallel, BRAID_LATERAL_MIN–MAX apart, and rejoin at a BOTTOM
 * FORK above the pad. RUNGS cross-link adjacent strands at seeded heights.
 * The original stem between the two forks is strand A. Every strand and rung
 * is routed on the walkability grid with the same machinery the loops use
 * (trailPlan.ts): the tree is forbidden except at the endpoints, feature
 * discs are forbidden, the two-cell rule keeps each new bed a corridor away
 * from every other, the simplifier keeps the gap, and the composed fine check
 * accepts or rejects. A strand or rung that cannot route is dropped — the
 * plan shrinks, a seed always gets a legal world.
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
import { trailCorridorD, type TrailEdge, type TrailNode } from "./trail.js";
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
 * The most a strand's bed may stand off the ground it crosses (m).
 *
 * A STRAND IS OPTIONAL, SO IT CAN BE HELD TO THIS (2026-09-16, fix round 2).
 * `trailBed.test.ts`'s flush gate caps |composed − ground| along every
 * centreline at 2 m over the 227-seed sweep, and the stem and the loops sit
 * where they sit — they have to exist, and a bed cutting a ridgelet narrower
 * than the profile's own 8 m kernel is the documented tail (worst non-strand
 * sample on this sweep: 1.784 m). A strand has no such claim: when its bed
 * would not sit on the ground, the next rung or the other side is tried and
 * the plan shrinks. Measured: the first strand below the dome on seed
 * -663635494 cut 2.059 m through the skirt's foot, 3 % over the gate.
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
export const BRAID_SALT = 0xb2a1d;

export const BRAID_TUNABLES: Readonly<Record<string, number>> = {
  BRAID_STRANDS_WEIGHT_2, BRAID_TOP_MIN, BRAID_TOP_MAX, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX,
  BRAID_PEAK_MARGIN, BRAID_TOP_FLOOR, BRAID_LADDER_STEP, BRAID_MIN_SPAN, BRAID_FLUSH_MAX,
  BRAID_LATERAL_MIN, BRAID_LATERAL_MAX, BRAID_OFF_BAND_COST, BRAID_END_FREE, BRAID_ARRIVE_CELLS, BRAID_SALT,
};

/** A seeded value in [lo, hi] for braid draw `i`. */
export function braidDraw(seed: number, i: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hash3(i, 0, 0, seed ^ BRAID_SALT);
}

export type Strand = { side: -1 | 0 | 1; top: number; bottom: number; nodes: number[] };
export type BraidCtx = {
  seed: number; grid: TrailGrid; frame: BuildFrame; H: Heights; ground: GroundFn;
  tree: Uint8Array; treeEdges: Array<[number, number]>; features: readonly Feature[]; summit: number;
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
 * The most the bed of `edges` stands off the ground under it, sampled at 1 m
 * along each centreline — the same measure as `trailBed.test.ts`'s flush gate,
 * over the corridor union of the whole planned graph.
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
export function buildStrands(state: GraphState, ctx: BraidCtx): {
  state: GraphState; strands: Strand[]; topArc: number; bottomArc: number; samples: StemSample[];
} {
  const { seed, grid, frame, H, ground, tree, treeEdges, summit } = ctx;
  const geom = stemGeometry(state, summit);
  const samples = sampleStem(state, geom);
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
  const none = { state, strands: [] as Strand[], topArc, bottomArc, samples };
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
          const { arc, lat } = stemPose(samples, x, z);
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

  // Strand A: the stem between the forks, read off the split graph.
  const T = forkT, B = forkB;
  const g2 = stemGeometry(base, summit);
  const iT = g2.stemNodes.indexOf(T), iB = g2.stemNodes.indexOf(B);
  const aNodes = g2.stemNodes.slice(Math.min(iT, iB), Math.max(iT, iB) + 1);
  if (iT < iB) aNodes.reverse();
  return {
    state: base, strands: [{ side: 0, top: T, bottom: B, nodes: aNodes }, ...built],
    topArc: forkArc, bottomArc, samples,
  };
}
