/**
 * The trail's paint, evaluated per fragment.
 *
 * The graph is a polyline with many short edges — up to ~180 on a world once
 * the bed follows the ground — so the segments are BUCKETED: a 16 × 16 index
 * grid over the graph's bounding box (100 m buckets, one empty ring around
 * it so a clamped lookup outside reads nothing) holds (start, count) per
 * bucket, and a 512-entry, two-row list holds the segments: row 0 is
 * (ax, az, bx, bz), row 1 is (ua, ub, wa, wb) — the along-trail arc length and
 * the junction width factor at each end. Both live in ONE texture, 512 wide
 * by TRAIL_PAINT_TABLE_ROWS (18) high: rows 0 and 1 the list, rows 2 to 17
 * the grid in the first 16 columns (the rest of each row zero), so the paint
 * takes one of the terrain's sixteen samplers rather than two. The arc length
 * is computed HERE (`edgeArcLengths`), walking the stem from the pad and each
 * loop from its first junction, rather than read off `TrailNode.u` — the
 * road-relative coordinate (`x − roadCenterX(z)`) the route builder uses to
 * shape the search, which runs parallel to the road rather than along the
 * trail and is never read by the paint. A fragment reads its bucket and loops at
 * most TRAIL_PAINT_BUCKET_MAX segments over row 0 to find the nearest one,
 * then reads row 1 once, at the winner's index, to paint it: every band below
 * is a function of that segment's along-length wear and width, and of the
 * across distance shifted by the ragged edge and the pebble height.
 *
 * The bed paints as four bands from the centreline out — core, margin,
 * trample, then bare ground — each darkened, widened and shifted by
 * along-length wear noise, with a ragged edge added to the across distance
 * and a wet core that puddles with the weather. The bank — bare forest
 * floor — goes on the side where the ground RISES AWAY from the bed, read
 * from the vertex normal, which is what a bench cut into a hillside exposes.
 * There is no cut-depth model any more: the bed is the ground. The bank
 * paints only in proportion to the SOIL under it — the vertex's grass +
 * forest-floor class weight: a cut through rock exposes rock, which the base
 * albedo already is, and a beach or a snowfield has no floor to expose. The
 * floor texture times a rock-grey or sand-tan vertex albedo read as a bright
 * golden wedge beside the bed wherever the class changed (2026-09-10).
 *
 * Pure and Babylon-free (architecture test): the table and a TypeScript
 * mirror of the arithmetic the terrain's fragment stage runs after the
 * road's (`lite/terrainPlugins.ts`, the trail's block), so the tests pin
 * the bands.
 */
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "../sim/trail.js";
import {
  TRAIL_JUNCTION_W, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_HEIGHT_SHIFT, TRAIL_PAINT_EDGE,
  trailWear, trailEdgeNoise, trailBands,
} from "./trailBenchParams.js";

export type Rgb = { r: number; g: number; b: number };

export const TRAIL_PAINT_BUCKET = 100;
export const TRAIL_PAINT_BUCKET_MAX = 32;
export const TRAIL_PAINT_MAX_SEGMENTS = 512;
export const TRAIL_PAINT_GRID = 16;
/** The first row of the table texture holding the bucket grid: rows 0 and 1 are the segment list. */
export const TRAIL_PAINT_INDEX_ROW = 2;
/** The table texture's height: the list's two rows and the grid's sixteen. */
export const TRAIL_PAINT_TABLE_ROWS = TRAIL_PAINT_INDEX_ROW + TRAIL_PAINT_GRID;
/** Floats per row of the table texture: TRAIL_PAINT_MAX_SEGMENTS texels of RGBA. */
const ROW_STRIDE = TRAIL_PAINT_MAX_SEGMENTS * 4;
/** Re-exported so existing importers of the old local constant keep working;
 * the value now lives in trailBenchParams.ts beside the bands it edges. */
export { TRAIL_PAINT_EDGE } from "./trailBenchParams.js";
/** Ground slope away from the bed at which the bank paint is at full strength. */
export const TRAIL_BANK_SLOPE = 0.15;

const GROW = TRAIL_CORRIDOR_HALF;

export type Segment = { ax: number; az: number; bx: number; bz: number; ua: number; ub: number; wa: number; wb: number };
export type TrailTable = {
  /** The whole texture, TRAIL_PAINT_MAX_SEGMENTS × TRAIL_PAINT_TABLE_ROWS × RGBA,
   * row-major: row 0 (ax, az, bx, bz) and row 1 (ua, ub, wa, wb) per segment
   * entry; from row TRAIL_PAINT_INDEX_ROW on, one grid row (z) each, (start,
   * count, 0, 0) per bucket in the first TRAIL_PAINT_GRID columns (x). */
  data: Float32Array;
  x0: number;
  z0: number;
  /** Entries used in the list (duplicates included). */
  count: number;
  bucketMax: number;
  overflow: boolean;
};

/** Width factor per node: TRAIL_JUNCTION_W at degree ≥ 3 and at the trailhead (node 0), else 1. */
export function nodeWidths(graph: TrailGraph): number[] {
  const degree = new Array<number>(graph.nodes.length).fill(0);
  for (const e of graph.edges) { degree[e.a]!++; degree[e.b]!++; }
  return degree.map((d, i) => (d >= 3 || i === 0 ? TRAIL_JUNCTION_W : 1));
}

/**
 * The along-trail arc length at each edge's own `a` and `b` ends, one entry
 * per edge index. The stem walks from node 0 (the pad, `s = 0`) to the
 * summit, following `graph.stem` in its own pad → summit order; each loop
 * then walks from `junctionA` (the arc length a touching stem edge already
 * carries) to `junctionB`, so a loop has exactly one seam, at the junction
 * where its arc rejoins the stem's own.
 *
 * A loop's `edges` are its two half-loops concatenated — the first half
 * junctionA → the turn, the second half junctionB → the turn — which is NOT
 * a chain in that stored order (`trailBuild.ts`'s own loop-closing code walks
 * the second half in reverse for the same reason). So the walk here follows
 * ADJACENCY within a loop's own edges, starting at `junctionA`, rather than
 * the array order: at every node along the way exactly one unwalked edge
 * leads on (the loop's own edges form a simple path, junctionA to junctionB,
 * with no branching), so the walk is unambiguous.
 *
 * An edge whose `a` is not the node the walk just arrived at has its roles
 * swapped so `ua`/`ub` still land on the edge's own `a`/`b` ends rather than
 * on "the end the walk saw first" — `trailSegments`' `ax, az, bx, bz` are
 * always `a`, then `b`, so the paint's `mix(ua, ub, t)` must agree. Any edge
 * the walk never reaches (there should be none — the stem plus every loop's
 * edges cover the whole graph) is left at `ua = ub = 0`.
 */
export function edgeArcLengths(graph: TrailGraph): { ua: number; ub: number }[] {
  const out: { ua: number; ub: number }[] = graph.edges.map(() => ({ ua: 0, ub: 0 }));
  const edgeLength = (ei: number): number => {
    const e = graph.edges[ei]!;
    const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  // The stem: pad (node 0) to the summit, in the stored order.
  let s = 0;
  let at = 0;
  for (const ei of graph.stem) {
    const e = graph.edges[ei]!;
    const len = edgeLength(ei);
    if (e.a === at) { out[ei] = { ua: s, ub: s + len }; at = e.b; }
    else { out[ei] = { ua: s + len, ub: s }; at = e.a; }
    s += len;
  }
  // Each loop: from junctionA's own stem arc length, following the loop's
  // OWN edges by adjacency (never the stored array order — see above).
  for (const loop of graph.loops) {
    let sLoop = 0;
    for (const ei of graph.stem) {
      const e = graph.edges[ei]!;
      if (e.a === loop.junctionA) { sLoop = out[ei]!.ua; break; }
      if (e.b === loop.junctionA) { sLoop = out[ei]!.ub; break; }
    }
    const adj = new Map<number, { ei: number; other: number }[]>();
    for (const ei of loop.edges) {
      const e = graph.edges[ei]!;
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ ei, other: e.b });
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ ei, other: e.a });
    }
    const walked = new Set<number>();
    let cur = loop.junctionA;
    while (cur !== loop.junctionB) {
      const next = (adj.get(cur) ?? []).find((o) => !walked.has(o.ei));
      if (next === undefined) break; // defensive: a malformed loop should not hang the walk
      walked.add(next.ei);
      const e = graph.edges[next.ei]!;
      const len = edgeLength(next.ei);
      if (e.a === cur) out[next.ei] = { ua: sLoop, ub: sLoop + len };
      else out[next.ei] = { ua: sLoop + len, ub: sLoop };
      sLoop += len;
      cur = next.other;
    }
  }
  return out;
}

export function trailSegments(graph: TrailGraph): Segment[] {
  const w = nodeWidths(graph);
  const arcs = edgeArcLengths(graph);
  return graph.edges.map((e, i) => {
    const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, ua: arcs[i]!.ua, ub: arcs[i]!.ub, wa: w[e.a]!, wb: w[e.b]! };
  });
}

export function buildTrailTable(segments: Segment[]): TrailTable {
  const N = TRAIL_PAINT_GRID;
  const data = new Float32Array(ROW_STRIDE * TRAIL_PAINT_TABLE_ROWS);
  const ROW1 = ROW_STRIDE;
  let minX = Infinity, minZ = Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.ax, s.bx);
    minZ = Math.min(minZ, s.az, s.bz);
  }
  if (segments.length === 0) { minX = 0; minZ = 0; }
  const x0 = minX - GROW - TRAIL_PAINT_BUCKET;
  const z0 = minZ - GROW - TRAIL_PAINT_BUCKET;
  let count = 0, bucketMax = 0, overflow = false;
  for (let bj = 0; bj < N; bj++) {
    for (let bi = 0; bi < N; bi++) {
      const bx0 = x0 + bi * TRAIL_PAINT_BUCKET, bz0 = z0 + bj * TRAIL_PAINT_BUCKET;
      const bx1 = bx0 + TRAIL_PAINT_BUCKET, bz1 = bz0 + TRAIL_PAINT_BUCKET;
      const start = count;
      let n = 0;
      for (const s of segments) {
        if (Math.max(s.ax, s.bx) + GROW < bx0 || Math.min(s.ax, s.bx) - GROW >= bx1) continue;
        if (Math.max(s.az, s.bz) + GROW < bz0 || Math.min(s.az, s.bz) - GROW >= bz1) continue;
        if (n >= TRAIL_PAINT_BUCKET_MAX || count >= TRAIL_PAINT_MAX_SEGMENTS) { overflow = true; break; }
        data[count * 4] = s.ax; data[count * 4 + 1] = s.az; data[count * 4 + 2] = s.bx; data[count * 4 + 3] = s.bz;
        data[ROW1 + count * 4] = s.ua; data[ROW1 + count * 4 + 1] = s.ub;
        data[ROW1 + count * 4 + 2] = s.wa; data[ROW1 + count * 4 + 3] = s.wb;
        count++; n++;
      }
      const b = bucketTexel(bj * N + bi);
      data[b] = start; data[b + 1] = n;
      bucketMax = Math.max(bucketMax, n);
    }
  }
  // A segment past the far edge of the grid is silently unpainted: flag it.
  for (const s of segments) {
    if (Math.max(s.ax, s.bx) + GROW >= x0 + (N - 1) * TRAIL_PAINT_BUCKET) overflow = true;
    if (Math.max(s.az, s.bz) + GROW >= z0 + (N - 1) * TRAIL_PAINT_BUCKET) overflow = true;
  }
  return { data, x0, z0, count, bucketMax, overflow };
}

/** Where bucket `b` (row-major in z then x, as `bucketOf` numbers them) sits
 * in `TrailTable.data`: the first float of its texel, on grid row z of the
 * table's rows from TRAIL_PAINT_INDEX_ROW, column x. */
export function bucketTexel(b: number): number {
  const N = TRAIL_PAINT_GRID;
  return (TRAIL_PAINT_INDEX_ROW + Math.floor(b / N)) * ROW_STRIDE + (b % N) * 4;
}

function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The bucket a world point falls in, clamped to the grid (the ring is empty). */
export function bucketOf(table: TrailTable, x: number, z: number): number {
  const N = TRAIL_PAINT_GRID;
  const bi = Math.min(N - 1, Math.max(0, Math.floor((x - table.x0) / TRAIL_PAINT_BUCKET)));
  const bj = Math.min(N - 1, Math.max(0, Math.floor((z - table.z0) / TRAIL_PAINT_BUCKET)));
  return bj * N + bi;
}

/** Nearest segment among the point's bucket: the distance, the unit vector
 * AWAY from the bed (zero on the bed), the winning entry's list index `k`
 * (−1 when the bucket is empty) and the parameter `t` along it. */
export function trailNearest(table: TrailTable, x: number, z: number): { d: number; ex: number; ez: number; k: number; t: number } {
  const b = bucketTexel(bucketOf(table, x, z));
  const start = table.data[b]!, n = table.data[b + 1]!;
  let d = Infinity, qx = 0, qz = 0, bestK = -1, bestT = 0;
  for (let i = 0; i < n; i++) {
    const k = start + i;
    const kk = k * 4;
    const ax = table.data[kk]!, az = table.data[kk + 1]!, bx = table.data[kk + 2]!, bz = table.data[kk + 3]!;
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    const px = x - ax, pz = z - az;
    const t = L2 > 0 ? clamp01((px * ex + pz * ez) / L2) : 0;
    const ox = px - t * ex, oz = pz - t * ez;
    const dd = Math.sqrt(ox * ox + oz * oz);
    if (dd < d) { d = dd; qx = ox; qz = oz; bestK = k; bestT = t; }
  }
  if (!Number.isFinite(d) || d < 1e-9) return { d, ex: 0, ez: 0, k: bestK, t: bestT };
  return { d, ex: qx / d, ez: qz / d, k: bestK, t: bestT };
}

/** Bed band weight at a world point; `aa` is the fragment footprint (fwidth), 0 for analytic. */
export function trailBand(x: number, z: number, table: TrailTable, aa = 0): number {
  const { d } = trailNearest(table, x, z);
  const e = Math.max(TRAIL_PAINT_EDGE, aa);
  return 1 - smoothstep(TRAIL_BED_HALF, TRAIL_BED_HALF + e, d);
}

/** The ground's slope AWAY from the bed: the gradient dotted with the unit
 * away-vector. Positive where the ground rises away (the cut side). The shader
 * forms the same number from the vertex normal, −n.xz / n.y. */
export function bankRise(gradX: number, gradZ: number, ex: number, ez: number): number {
  return gradX * ex + gradZ * ez;
}

/** Bank band from the distance to the bed, the rise away from it and the
 * soil fraction (grass + forest-floor weight, [0, 1]) of the ground: bare
 * forest floor across the cut side, nothing where the ground falls away, and
 * nothing where there is no soil to expose. */
export function trailBankBand(d: number, rise: number, soil = 1): number {
  return smoothstep(0, TRAIL_BANK_SLOPE, rise) * (1 - smoothstep(TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, d)) * soil;
}

export type TrailPaintOpts = { edgeNoise: number; height: number };
/** The band weights the shader computes at (x, z): edgeNoise is the metres the ragged
 * edge adds (the shader's own comes from trailEdgeNoise), height the pebble height in
 * [0, 1]. `opts` defaults to the shader's own edge noise at (x, z) and a level pebble
 * (0.5), so a caller with no reason to override either can omit it. */
export function trailPaintAt(x: number, z: number, table: TrailTable, opts?: TrailPaintOpts): { core: number; margin: number; trample: number; wear: number; u: number; widthK: number } {
  const edgeNoise = opts?.edgeNoise ?? trailEdgeNoise(x, z);
  const height = opts?.height ?? 0.5;
  const n = trailNearest(table, x, z);
  if (n.k < 0) return { core: 0, margin: 0, trample: 0, wear: 0, u: 0, widthK: 1 };
  const row1 = ROW_STRIDE + n.k * 4;
  const u = table.data[row1]! + (table.data[row1 + 1]! - table.data[row1]!) * n.t;
  const wj = table.data[row1 + 2]! + (table.data[row1 + 3]! - table.data[row1 + 2]!) * n.t;
  const wear = trailWear(u);
  const widthK = (TRAIL_WEAR_W0 + (TRAIL_WEAR_W1 - TRAIL_WEAR_W0) * wear) * wj;
  const dB = (n.d + edgeNoise) / widthK - TRAIL_HEIGHT_SHIFT * (height - 0.5);
  return { ...trailBands(dB), wear, u, widthK };
}
