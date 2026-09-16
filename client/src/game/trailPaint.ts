/**
 * The trail's paint, evaluated per fragment.
 *
 * The graph is a polyline with many short edges — up to ~180 on a world once
 * the bed follows the ground — so the segments are BUCKETED: a 16 × 16 index
 * texture over the graph's bounding box (100 m buckets, one empty ring around
 * it so a clamped lookup outside reads nothing) holds (start, count) per
 * bucket, and a 512-entry list holds the segments, each entered in every
 * bucket its corridor-grown box touches. A fragment reads its bucket and
 * loops at most TRAIL_PAINT_BUCKET_MAX segments.
 *
 * The bed paints as the gravel layer under a wet-earth tint; the bank — bare
 * forest floor — goes on the side where the ground RISES AWAY from the bed,
 * read from the vertex normal, which is what a bench cut into a hillside
 * exposes. There is no cut-depth model any more: the bed is the ground. The
 * bank paints only in proportion to the SOIL under it — the vertex's grass +
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
import { TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, type TrailGraph } from "../sim/trail.js";

export type Rgb = { r: number; g: number; b: number };

export const TRAIL_PAINT_BUCKET = 100;
export const TRAIL_PAINT_BUCKET_MAX = 32;
export const TRAIL_PAINT_MAX_SEGMENTS = 512;
export const TRAIL_PAINT_GRID = 16;
/** The walked margin beyond the bed that is also gravel. */
export const TRAIL_PAINT_MARGIN = 0.5;
export const TRAIL_PAINT_EDGE = 0.4;
/** Multiplies the gravel layer's albedo on the bed: wet earth, not sand. */
export const TRAIL_DIRT_TINT: Rgb = { r: 0.34, g: 0.29, b: 0.24 };
/** Scales the gravel layer's own brightness so its stones read as stone in dirt. */
export const TRAIL_GRAVEL_GAIN = 0.6;
/** Ground slope away from the bed at which the bank paint is at full strength. */
export const TRAIL_BANK_SLOPE = 0.15;

const BED = TRAIL_BED_HALF + TRAIL_PAINT_MARGIN;
const GROW = TRAIL_CORRIDOR_HALF;

export type Segment = { ax: number; az: number; bx: number; bz: number };
export type TrailTable = {
  /** TRAIL_PAINT_GRID² × RGBA: (start, count, 0, 0) per bucket, row-major in z then x. */
  index: Float32Array;
  /** TRAIL_PAINT_MAX_SEGMENTS × RGBA: (ax, az, bx, bz). */
  list: Float32Array;
  x0: number;
  z0: number;
  /** Entries used in the list (duplicates included). */
  count: number;
  bucketMax: number;
  overflow: boolean;
};

export function trailSegments(graph: TrailGraph): Segment[] {
  return graph.edges.map((e) => {
    const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
  });
}

export function buildTrailTable(segments: Segment[]): TrailTable {
  const N = TRAIL_PAINT_GRID;
  const index = new Float32Array(N * N * 4);
  const list = new Float32Array(TRAIL_PAINT_MAX_SEGMENTS * 4);
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

/** Nearest segment among the point's bucket: the distance and the unit vector
 * AWAY from the bed (zero on the bed). Infinity when the bucket is empty. */
export function trailNearest(table: TrailTable, x: number, z: number): { d: number; ex: number; ez: number } {
  const b = bucketOf(table, x, z);
  const start = table.index[b * 4]!, n = table.index[b * 4 + 1]!;
  let d = Infinity, qx = 0, qz = 0;
  for (let i = 0; i < n; i++) {
    const k = (start + i) * 4;
    const ax = table.list[k]!, az = table.list[k + 1]!, bx = table.list[k + 2]!, bz = table.list[k + 3]!;
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    const px = x - ax, pz = z - az;
    const t = L2 > 0 ? clamp01((px * ex + pz * ez) / L2) : 0;
    const ox = px - t * ex, oz = pz - t * ez;
    const dd = Math.sqrt(ox * ox + oz * oz);
    if (dd < d) { d = dd; qx = ox; qz = oz; }
  }
  if (!Number.isFinite(d) || d < 1e-9) return { d, ex: 0, ez: 0 };
  return { d, ex: qx / d, ez: qz / d };
}

/** Bed band weight at a world point; `aa` is the fragment footprint (fwidth), 0 for analytic. */
export function trailBand(x: number, z: number, table: TrailTable, aa = 0): number {
  const { d } = trailNearest(table, x, z);
  const e = Math.max(TRAIL_PAINT_EDGE, aa);
  return 1 - smoothstep(BED, BED + e, d);
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
  return smoothstep(0, TRAIL_BANK_SLOPE, rise) * (1 - smoothstep(BED, TRAIL_CORRIDOR_HALF, d)) * soil;
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
#endif
`;

/**
 * Injected after the road paint inside CUSTOM_FRAGMENT_BEFORE_LIGHTS. The
 * bucket coordinate is clamped into the grid rather than branched on, so the
 * loop and the fwidth run in uniform control flow; the ring of empty buckets
 * makes a clamped lookup outside the box read count 0. The loop bound is the
 * compile-time constant TRAIL_PAINT_BUCKET_MAX; the break on the bucket's count
 * stops at the live entries. The bank side comes from vNormalW, the vertex
 * normal, before any detail normal has been folded into normalW.
 */
export const TRAIL_FRAGMENT_PAINT = `
#ifdef TRAILPAINT
{
  vec2 tb = clamp((vPositionW.xz - trailInfo.xy) * trailInfo.z, 0.0, trailInfo.w - 1.0);
  vec2 tIdx = texture2D(trailIndex, (floor(tb) + 0.5) / trailInfo.w).xy;
  float tdBest = 1.0e9;
  vec2 tOff = vec2(0.0);
  for (int ti = 0; ti < ${TRAIL_PAINT_BUCKET_MAX}; ti++) {
    if (float(ti) >= tIdx.y) break;
    float tu = (tIdx.x + float(ti) + 0.5) / ${TRAIL_PAINT_MAX_SEGMENTS}.0;
    vec4 ts = texture2D(trailSegs, vec2(tu, 0.5));
    vec2 te = ts.zw - ts.xy;
    vec2 tp = vPositionW.xz - ts.xy;
    float tl2 = dot(te, te);
    float tt = tl2 > 0.0 ? clamp(dot(tp, te) / tl2, 0.0, 1.0) : 0.0;
    vec2 to = tp - tt * te;
    float td = length(to);
    if (td < tdBest) { tdBest = td; tOff = to; }
  }
  float taa = fwidth(tdBest);
  // The texture2D calls below (gravel/floor albedo, normals, RAH) run inside
  // this branch, so their implicit-LOD derivatives are formally non-uniform
  // control flow. Pre-existing structure carried over from the wall removal;
  // it compiled and rendered correctly on Metal when checked in the browser.
  if (tdBest < ${f(TRAIL_CORRIDOR_HALF)} + taa) {
    float tk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
    float tE = max(${f(TRAIL_PAINT_EDGE)}, taa);
    float tBed = 1.0 - smoothstep(${f(BED)}, ${f(BED)} + tE, tdBest);
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
    float tBank = smoothstep(0.0, ${f(TRAIL_BANK_SLOPE)}, tRise) * (1.0 - smoothstep(${f(BED)}, ${f(TRAIL_CORRIDOR_HALF)}, tdBest)) * tSoil * (1.0 - tSnow);
    vec2 tuvP = vPositionW.xz * terrainTiling.w;
    vec2 tuvF = vPositionW.xz * terrainTiling.y;
    // Gravel: the pebble layer (index 4) planar at its own tiling, its albedo
    // scaled and tinted to wet earth; forest floor: layer 1. Normals/RAH from
    // the same arrays the ground blend reads, mixed the way the road mixes asphalt.
    vec3 tGravelTex = mix(vec3(1.0), texture2D(terrainPebble, tuvP).rgb / terrainRock2.y, tk) * ${f(TRAIL_GRAVEL_GAIN)};
    vec3 tFloorTex = mix(vec3(1.0), texture2D(terrainFloor, tuvF).rgb / terrainRock2.y, tk);
    vec3 tGravelN = texture2D(terrainNormals, vec3(tuvP, 4.0)).rgb * 2.0 - 1.0;
    vec3 tGravelRAH = texture2D(terrainRAH, vec3(tuvP, 4.0)).rgb;
    vec3 tFloorN = texture2D(terrainNormals, vec3(tuvF, 1.0)).rgb * 2.0 - 1.0;
    vec3 tFloorRAH = texture2D(terrainRAH, vec3(tuvF, 1.0)).rgb;
    // The bank is this ground with the floor texture in place of the blend, so
    // it takes the VERTEX colour (the palette's darkness and canopy tint) —
    // vAlbedoColor is the material's constant, and under it alone the floor
    // texture painted at full brightness beside the bed (2026-09-10).
#ifdef VERTEXCOLOR
    vec3 tBankBase = vColor.rgb;
#else
    vec3 tBankBase = vAlbedoColor.rgb;
#endif
    vec3 tCol = mix(surfaceAlbedo, tFloorTex * mix(1.0, tFloorRAH.g / 0.5, tk) * tBankBase, tBank);
    normalW = normalize(mix(normalW, normalize(normalW + vec3(tFloorN.x, 0.0, tFloorN.y)), tBank * tk));
    terrainRough = mix(terrainRough, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tBank);
    terrainF0 = mix(terrainF0, terrainLayerF0.y, tBank);
    vec3 tDirt = vec3(${f(TRAIL_DIRT_TINT.r)}, ${f(TRAIL_DIRT_TINT.g)}, ${f(TRAIL_DIRT_TINT.b)}) * tGravelTex * mix(1.0, tGravelRAH.g / 0.5, tk) * vAlbedoColor.rgb;
    vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);
    tCol = mix(tCol, mix(tDirt, tPacked, tSnow), tBed);
    float tGravel = tBed * (1.0 - tSnow);
    normalW = normalize(mix(normalW, normalize(normalW + vec3(tGravelN.x, 0.0, tGravelN.y)), tGravel * tk));
    terrainRough = mix(terrainRough, clamp(terrainLayerRough2.x * mix(1.0, tGravelRAH.r / 0.5, tk), 0.0, 1.0), tGravel);
    terrainF0 = mix(terrainF0, terrainLayerF02.x, tGravel);
    surfaceAlbedo = tCol;
  }
}
#endif
`;
