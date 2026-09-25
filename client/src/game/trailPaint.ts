/**
 * The trail's paint, evaluated per fragment.
 *
 * The graph is a polyline with many short edges — up to ~180 on a world once
 * the bed follows the ground — so the segments are BUCKETED: a 16 × 16 index
 * texture over the graph's bounding box (100 m buckets, one empty ring around
 * it so a clamped lookup outside reads nothing) holds (start, count) per
 * bucket, and a 512-entry, two-row list holds the segments: row 0 is
 * (ax, az, bx, bz), row 1 is (ua, ub, wa, wb) — the along-trail arc length and
 * the junction width factor at each end. The arc length is computed HERE
 * (`edgeArcLengths`), walking the stem from the pad and each loop from its
 * first junction, rather than read off `TrailNode.u` — the road-relative
 * coordinate (`x − roadCenterX(z)`) the route builder uses to shape the
 * search, which runs parallel to the road rather than along the trail and is
 * never read by the paint. A fragment reads its bucket and loops at
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
 * Pure and Babylon-free (architecture test): GLSL as strings beside the
 * TypeScript mirror, so the tests pin the bands.
 *
 * COMMENT PROSE IN THE GLSL STRINGS IS NOT INERT — never spell a hashed
 * preprocessor keyword inside a comment there.
 */
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, TRAIL_SINK, TRAIL_SINK_RAMP, type TrailGraph } from "../sim/trail.js";
import { NEEDLE_BED } from "./terrainSurface.js";
import {
  TRAIL_JUNCTION_W,
  TRAIL_WEAR_WAVE, TRAIL_WEAR_WEIGHT, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1,
  TRAIL_EDGE_NOISE, TRAIL_EDGE_WAVE, TRAIL_EDGE_WEIGHT, TRAIL_HEIGHT_SHIFT,
  TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE,
  TRAIL_CORE_GAIN, TRAIL_CORE_TINT, TRAIL_MARGIN_GAIN, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT, TRAIL_BENCH_SHADE, TRAIL_BED_EARTH, TRAIL_BED_FLOOR,
  TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE,
  TRAIL_DRIFT_BAND, TRAIL_DRIFT_TINT, TRAIL_WASH_WAVE, TRAIL_WASH_BAND, TRAIL_WASH_DARK_OPEN, TRAIL_WASH_DARK_LITTER, TRAIL_WASH_ROUGH,
  trailWear, trailEdgeNoise, trailBands,
} from "./trailBenchParams.js";

export type Rgb = { r: number; g: number; b: number };

export const TRAIL_PAINT_BUCKET = 100;
export const TRAIL_PAINT_BUCKET_MAX = 32;
export const TRAIL_PAINT_MAX_SEGMENTS = 512;
export const TRAIL_PAINT_GRID = 16;
/** Re-exported so existing importers of the old local constant keep working;
 * the value now lives in trailBenchParams.ts beside the bands it edges. */
export { TRAIL_PAINT_EDGE } from "./trailBenchParams.js";
/** Ground slope away from the bed at which the bank paint is at full strength. */
export const TRAIL_BANK_SLOPE = 0.15;

const GROW = TRAIL_CORRIDOR_HALF;

export type Segment = { ax: number; az: number; bx: number; bz: number; ua: number; ub: number; wa: number; wb: number };
export type TrailTable = {
  /** TRAIL_PAINT_GRID² × RGBA: (start, count, 0, 0) per bucket, row-major in z then x. */
  index: Float32Array;
  /** Two rows of TRAIL_PAINT_MAX_SEGMENTS × RGBA: row 0 (ax, az, bx, bz), row 1 (ua, ub, wa, wb). */
  list: Float32Array;
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
  const index = new Float32Array(N * N * 4);
  const list = new Float32Array(TRAIL_PAINT_MAX_SEGMENTS * 4 * 2);
  const ROW1 = TRAIL_PAINT_MAX_SEGMENTS * 4;
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
        list[count * 4] = s.ax; list[count * 4 + 1] = s.az; list[count * 4 + 2] = s.bx; list[count * 4 + 3] = s.bz;
        list[ROW1 + count * 4] = s.ua; list[ROW1 + count * 4 + 1] = s.ub;
        list[ROW1 + count * 4 + 2] = s.wa; list[ROW1 + count * 4 + 3] = s.wb;
        count++; n++;
      }
      const b = (bj * N + bi) * 4;
      index[b] = start; index[b + 1] = n;
      bucketMax = Math.max(bucketMax, n);
    }
  }
  // A segment past the far edge of the grid is silently unpainted: flag it.
  for (const s of segments) {
    if (Math.max(s.ax, s.bx) + GROW >= x0 + (N - 1) * TRAIL_PAINT_BUCKET) overflow = true;
    if (Math.max(s.az, s.bz) + GROW >= z0 + (N - 1) * TRAIL_PAINT_BUCKET) overflow = true;
  }
  return { index, list, x0, z0, count, bucketMax, overflow };
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
  const b = bucketOf(table, x, z);
  const start = table.index[b * 4]!, n = table.index[b * 4 + 1]!;
  let d = Infinity, qx = 0, qz = 0, bestK = -1, bestT = 0;
  for (let i = 0; i < n; i++) {
    const k = start + i;
    const kk = k * 4;
    const ax = table.list[kk]!, az = table.list[kk + 1]!, bx = table.list[kk + 2]!, bz = table.list[kk + 3]!;
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
  const row1 = TRAIL_PAINT_MAX_SEGMENTS * 4 + n.k * 4;
  const u = table.list[row1]! + (table.list[row1 + 1]! - table.list[row1]!) * n.t;
  const wj = table.list[row1 + 2]! + (table.list[row1 + 3]! - table.list[row1 + 2]!) * n.t;
  const wear = trailWear(u);
  const widthK = (TRAIL_WEAR_W0 + (TRAIL_WEAR_W1 - TRAIL_WEAR_W0) * wear) * wj;
  const dB = (n.d + edgeNoise) / widthK - TRAIL_HEIGHT_SHIFT * (height - 0.5);
  return { ...trailBands(dB), wear, u, widthK };
}

/** How a shader literal is printed below: an integer gets a decimal point
 * (GLSL floats need one), anything else prints as JS would. Exported so a
 * test that checks a literal made it into the shader source formats it the
 * same way the shader does, rather than assuming every value round-trips
 * through `toFixed(1)`. */
export function glslFloat(n: number): string { return Number.isInteger(n) ? n.toFixed(1) : String(n); }
const f = glslFloat;

/** Declarations; `terrainTexture.ts` declares `trailInfo` (x0, z0, 1/bucket, grid) beside its own uniforms. */
export const TRAIL_FRAGMENT_DEFS = `
#ifdef TRAILPAINT
uniform sampler2D trailIndex;
uniform sampler2D trailSegs;
float trailValueNoise1(float u, float wave) {
  float q = u / wave;
  float c = floor(q);
  float f = smoothstep(0.0, 1.0, q - c);
  return mix(latticeHash(vec2(c, 0.0)), latticeHash(vec2(c + 1.0, 0.0)), f);
}
#endif
`;

/**
 * Injected after the road paint inside CUSTOM_FRAGMENT_BEFORE_LIGHTS. The
 * bucket coordinate is clamped into the grid rather than branched on, so the
 * loop and the fwidth run in uniform control flow; the ring of empty buckets
 * makes a clamped lookup outside the box read count 0. The loop bound is the
 * compile-time constant TRAIL_PAINT_BUCKET_MAX; the break on the bucket's count
 * stops at the live entries. Row 0 of the 512 × 2 segment texture is read once
 * per candidate to find the nearest one; row 1 is read once more, at the
 * winner's index, for the node parameter and junction width the bands below
 * are shaped by. The bank side comes from vNormalW, the vertex normal, before
 * any detail normal has been folded into normalW.
 */
export const TRAIL_FRAGMENT_PAINT = `
#ifdef TRAILPAINT
{
  vec2 tb = clamp((vPositionW.xz - trailInfo.xy) * trailInfo.z, 0.0, trailInfo.w - 1.0);
  vec2 tIdx = texture2D(trailIndex, (floor(tb) + 0.5) / trailInfo.w).xy;
  float tdBest = 1.0e9;
  vec2 tOff = vec2(0.0);
  float tuBest = 0.0;
  float ttBest = 0.0;
  for (int ti = 0; ti < ${TRAIL_PAINT_BUCKET_MAX}; ti++) {
    if (float(ti) >= tIdx.y) break;
    float tu = (tIdx.x + float(ti) + 0.5) / ${TRAIL_PAINT_MAX_SEGMENTS}.0;
    vec4 ts = texture2D(trailSegs, vec2(tu, 0.25));
    vec2 te = ts.zw - ts.xy;
    vec2 tp = vPositionW.xz - ts.xy;
    float tl2 = dot(te, te);
    float tt = tl2 > 0.0 ? clamp(dot(tp, te) / tl2, 0.0, 1.0) : 0.0;
    vec2 to = tp - tt * te;
    float td = length(to);
    if (td < tdBest) { tdBest = td; tOff = to; tuBest = tu; ttBest = tt; }
  }
  float taa = fwidth(tdBest);
  // The texture2D calls below (gravel/floor albedo, normals, RAH) run inside
  // this branch, so their implicit-LOD derivatives are formally non-uniform
  // control flow. Pre-existing structure carried over from the wall removal;
  // it compiled and rendered correctly on Metal when checked in the browser.
  if (tdBest < ${f(TRAIL_CORRIDOR_HALF)} + taa) {
    float tk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
    vec2 tAway = tdBest > 1.0e-4 ? tOff / tdBest : vec2(0.0);
    float tRise = dot(-vNormalW.xz, tAway) / max(vNormalW.y, 1.0e-3);
    // Soil fraction: the grass + forest-floor class weights the ground blend
    // already carries (TRAILPAINT is only ever defined alongside TERRAINTEX).
    float tSoil = clamp(vTerrainW.x + vTerrainW.y, 0.0, 1.0);
    // Snow fraction: the ground blend's detail weight (vTerrainW2.y) is 1 on
    // bare ground and falls to 0 through the snow band, the only thing that
    // lowers it (terrainSurface.ts). Above the snow line a trail is packed
    // snow, not a strip of bright dirt (seen in a captured clip): the bed
    // blends to a slightly darker, bluer snow, keeps the snow's normal and
    // roughness, and the bare-floor bank fades out with the soil under it.
    float tSnow = 1.0 - clamp(vTerrainW2.y, 0.0, 1.0);
    vec4 tRow = texture2D(trailSegs, vec2(tuBest, 0.75));
    float tU = mix(tRow.x, tRow.y, ttBest);
    float tWj = mix(tRow.z, tRow.w, ttBest);
    float tWear = ${f(TRAIL_WEAR_WEIGHT[0])} * trailValueNoise1(tU, ${f(TRAIL_WEAR_WAVE[0])}) + ${f(TRAIL_WEAR_WEIGHT[1])} * trailValueNoise1(tU, ${f(TRAIL_WEAR_WAVE[1])});
    float tWidthK = mix(${f(TRAIL_WEAR_W0)}, ${f(TRAIL_WEAR_W1)}, tWear) * tWj;
    float tDarkK = mix(${f(TRAIL_WEAR_D0)}, ${f(TRAIL_WEAR_D1)}, tWear);
    float tEdgeN = ${f(TRAIL_EDGE_WEIGHT[0])} * macroValueNoise(vPositionW.xz, ${f(TRAIL_EDGE_WAVE[0])}) + ${f(TRAIL_EDGE_WEIGHT[1])} * macroValueNoise(vPositionW.xz, ${f(TRAIL_EDGE_WAVE[1])});
    float tdN = tdBest + ${f(TRAIL_EDGE_NOISE)} * (2.0 * tEdgeN - 1.0);
    vec2 tuvP = vPositionW.xz * terrainTiling.w;
    vec2 tuvF = vPositionW.xz * terrainTiling.y;
    vec3 tGravelTex = mix(vec3(1.0), texture2D(terrainPebble, tuvP).rgb / terrainRock2.y, tk);
    vec3 tFloorTex = mix(vec3(1.0), texture2D(terrainFloor, tuvF).rgb / terrainRock2.y, tk);
    // The bed is earth: the floor texture over the pebbles, so the trail
    // wears the colour of the ground beside it with grit in it.
    vec3 tBedTex = mix(tGravelTex, tFloorTex, ${f(TRAIL_BED_EARTH)});
    vec3 tGravelN = texture2D(terrainNormals, vec3(tuvP, 4.0)).rgb * 2.0 - 1.0;
    vec3 tGravelRAH = texture2D(terrainRAH, vec3(tuvP, 4.0)).rgb;
    vec3 tFloorN = texture2D(terrainNormals, vec3(tuvF, 1.0)).rgb * 2.0 - 1.0;
    vec3 tFloorRAH = texture2D(terrainRAH, vec3(tuvF, 1.0)).rgb;
    // The bed's relief is earth too: a brown tint over a cobble mosaic still
    // shades as cobbles if the normal, the occlusion and the roughness stay
    // the pebble texture's. The same share that mixes the colour mixes them.
    vec3 tBedN = mix(tGravelN, tFloorN, ${f(TRAIL_BED_EARTH)});
    vec3 tBedRAH = mix(tGravelRAH, tFloorRAH, ${f(TRAIL_BED_EARTH)});
    float tdB = tdN / tWidthK - ${f(TRAIL_HEIGHT_SHIFT)} * (mix(0.5, tGravelRAH.b, tk) - 0.5);
    float tE = max(${f(TRAIL_PAINT_EDGE)}, taa / tWidthK);
    float tInCore = 1.0 - smoothstep(${f(TRAIL_CORE_HALF)}, ${f(TRAIL_CORE_HALF)} + tE, tdB);
    float tInMargin = 1.0 - smoothstep(${f(TRAIL_MARGIN_HALF)}, ${f(TRAIL_MARGIN_HALF)} + tE, tdB);
    float tCore = tInCore * (1.0 - tSnow);
    float tTrample = (1.0 - tInMargin) * (1.0 - smoothstep(${f(TRAIL_MARGIN_HALF)}, ${f(TRAIL_TRAMPLE_HALF)}, tdB)) * tSoil * (1.0 - tSnow);
    float tBank = smoothstep(0.0, ${f(TRAIL_BANK_SLOPE)}, tRise) * (1.0 - smoothstep(${f(TRAIL_BED_HALF)}, ${f(TRAIL_CORRIDOR_HALF)}, tdN)) * tSoil * (1.0 - tSnow) * (1.0 - tInMargin);
#ifdef VERTEXCOLOR
    vec3 tBankBase = vColor.rgb;
#else
    vec3 tBankBase = vAlbedoColor.rgb;
#endif
    // The bed carries no litter of its own, so the vertex-colour mix above
    // never lifted it the way the litter floor beside it rose: mix the same
    // NEEDLE_BED colour in by the vertex's own forest-floor weight, so the
    // bed under the canopy reads as the floor continuing under it. In the
    // open the weight is near zero and nothing changes.
    tBankBase = mix(tBankBase, vec3(${f(NEEDLE_BED.r)}, ${f(NEEDLE_BED.g)}, ${f(NEEDLE_BED.b)}), ${f(TRAIL_BED_FLOOR)} * clamp(vTerrainW.y, 0.0, 1.0));
    // The bench takes 80 % of the ground's own vertex colour rather than the
    // material's flat white, so it wears the hue of the ground it runs
    // through — brown under canopy, tan in the meadow — the way packed
    // earth does.
    vec3 tBenchBase = mix(vec3(1.0), tBankBase, ${f(TRAIL_BENCH_SHADE)});
    // The trampled band: this ground, dried and stained toward the bench.
    vec3 tCol = surfaceAlbedo * mix(vec3(1.0), vec3(${f(TRAIL_TRAMPLE_TINT.r)}, ${f(TRAIL_TRAMPLE_TINT.g)}, ${f(TRAIL_TRAMPLE_TINT.b)}), tTrample);
    // The bank: bare forest floor on the uphill side, under the vertex colour.
    tCol = mix(tCol, tFloorTex * mix(1.0, tFloorRAH.g / 0.5, tk) * tBankBase, tBank);
    normalW = normalize(mix(normalW, normalize(normalW + vec3(tFloorN.x, 0.0, tFloorN.y)), tBank * tk));
    terrainRough = mix(terrainRough, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tBank);
    terrainF0 = mix(terrainF0, terrainLayerF0.y, tBank);
    // Core and margin: the earth bed under two tints on the bench's own
    // shaded base, the core compacted and darkened by wear, the margin loose
    // and pale at about twice the core's brightness. Wet: the core darkens
    // and glosses, the margin half as much; puddles sit in the low spots of
    // the 6 m noise inside the core.
    float tAo = mix(1.0, tBedRAH.g / 0.5, tk);
    vec3 tCoreCol = vec3(${f(TRAIL_CORE_TINT.r)}, ${f(TRAIL_CORE_TINT.g)}, ${f(TRAIL_CORE_TINT.b)}) * tDarkK * tBedTex * ${f(TRAIL_CORE_GAIN)} * tAo * tBenchBase;
    vec3 tMarginCol = vec3(${f(TRAIL_MARGIN_TINT.r)}, ${f(TRAIL_MARGIN_TINT.g)}, ${f(TRAIL_MARGIN_TINT.b)}) * tBedTex * ${f(TRAIL_MARGIN_GAIN)} * tAo * tBenchBase;
    // Neglect: leaf and needle drifts where the ground cover says litter lies
    // (the vertex's own duff weight, so a painted drift always has pieces
    // standing on it), and gravel washed out to bare dirt in patches of the
    // bed's own noise. Both are smoothsteps and neither touches the band
    // weights above: the bed's core stays traceable however much lies on it.
    float tDrift = smoothstep(${f(TRAIL_DRIFT_BAND[0])}, ${f(TRAIL_DRIFT_BAND[1])}, clamp(vTerrainW2.z, 0.0, 1.0));
    float tWash = smoothstep(${f(TRAIL_WASH_BAND[0])}, ${f(TRAIL_WASH_BAND[1])}, macroValueNoise(vPositionW.xz, ${f(TRAIL_WASH_WAVE)}));
    tDrift *= 1.0 - tWash;
    vec3 tDriftCol = tFloorTex * vec3(${f(TRAIL_DRIFT_TINT.r)}, ${f(TRAIL_DRIFT_TINT.g)}, ${f(TRAIL_DRIFT_TINT.b)}) * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    // Keyed on the ground class, not the litter weight: the litter weight is
    // high beside a meadow trail too (drifts reach every bed margin there),
    // which would lift the meadow's wash-out toward the litter floor's
    // darkness. vTerrainW.y is the forest-floor class itself.
    float tWashDark = mix(${f(TRAIL_WASH_DARK_OPEN)}, ${f(TRAIL_WASH_DARK_LITTER)}, clamp(vTerrainW.y, 0.0, 1.0));
    vec3 tWashCol = tFloorTex * tWashDark * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash);
    tMarginCol = mix(mix(tMarginCol, tDriftCol, tDrift), tWashCol, tWash);
    float tPuddleLow = smoothstep(${f(TRAIL_PUDDLE_LOW[0])}, ${f(TRAIL_PUDDLE_LOW[1])}, 1.0 - macroValueNoise(vPositionW.xz, ${f(TRAIL_PUDDLE_WAVE)}));
    float tPuddle = smoothstep(${f(TRAIL_PUDDLE_WET[0])}, ${f(TRAIL_PUDDLE_WET[1])}, terrainWet) * tPuddleLow * tCore;
    tCoreCol *= 1.0 - ${f(TRAIL_WET_DARK)} * terrainWet;
    tMarginCol *= 1.0 - ${f(TRAIL_WET_DARK)} * 0.5 * terrainWet;
    tCoreCol = mix(tCoreCol, tCoreCol * 0.5, tPuddle);
    vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);
    float tOnBench = tInMargin;
    tCol = mix(tCol, mix(mix(tMarginCol, tCoreCol, tInCore), tPacked, tSnow), tOnBench);
    float tGravel = tOnBench * (1.0 - tSnow);
    vec3 tBenchN = normalize(normalW + vec3(tBedN.x, 0.0, tBedN.y) * mix(1.0, 0.5, tInCore) * (1.0 - tDrift) * (1.0 - tWash) + vec3(tFloorN.x, 0.0, tFloorN.y) * tDrift);
    // The lip: over the sink ramp outside the bench the normal tilts outward
    // and down by the ramp's slope, so a low sun draws the edge as a line.
    // Reads the width-scaled distance, like the bands above it, so the drawn
    // edge follows the painted bench's own wear-and-junction width; the
    // sim's sink ramp (trailSinkD) has no such width term and always steps
    // at the bare TRAIL_BED_HALF, so the two can disagree by up to about
    // 0.5 m at a scuffed, widened junction — accepted rather than chased.
    float tRamp = smoothstep(${f(TRAIL_BED_HALF)}, ${f(TRAIL_BED_HALF + TRAIL_SINK_RAMP)}, tdN / tWidthK);
    float tLip = 4.0 * tRamp * (1.0 - tRamp) * (1.0 - tSnow);
    vec3 tLipN = normalize(normalW - vec3(tAway.x, 0.0, tAway.y) * ${f(TRAIL_SINK / TRAIL_SINK_RAMP)} * tLip);
    normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), vec3(0.0, 1.0, 0.0), tPuddle));
    float tRoughBench = clamp(terrainLayerRough2.x * mix(1.0, tBedRAH.r / 0.5, tk), 0.0, 1.0);
    tRoughBench = mix(tRoughBench, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tDrift);
    tRoughBench = mix(tRoughBench, clamp(tRoughBench * ${f(TRAIL_WASH_ROUGH)}, 0.0, 1.0), tWash);
    tRoughBench *= 1.0 - ${f(TRAIL_WET_GLOSS)} * terrainWet * mix(0.5, 1.0, tInCore);
    terrainRough = mix(mix(terrainRough, tRoughBench, tGravel), 0.05, tPuddle);
    terrainF0 = mix(terrainF0, terrainLayerF02.x, tGravel);
    surfaceAlbedo = tCol;
  }
}
#endif
`;
