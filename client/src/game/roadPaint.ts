/**
 * The highway's paint, evaluated per fragment. The
 * centerline x is a pure function of z (the olympic variant's `roadCenterX`
 * hook), so it is baked into a 1-D table over the drawn extent and the
 * terrain fragment shader computes the signed road offset u per pixel. The
 * bands are the ones `classifySurface` used to bake into vertex colours,
 * now exact at every distance: verge tint, gravel shoulder over the pebble
 * texture, asphalt over its own texture in the road's (u, z) frame, and a
 * dashed centerline with per-dash wear. Asphalt also takes its own slice
 * (layer index 5) of `terrainTexture.ts`'s relief arrays — normal
 * perturbation, roughness and F0 — mixed
 * into the `normalW`/`terrainRough`/`terrainF0` locals the ground blend
 * already wrote, so a road never reverts to flat asphalt where the ground
 * layers around it show relief.
 *
 * Pure and Babylon-free (architecture test): the GLSL lives here as strings
 * beside a TypeScript mirror of the same arithmetic, so the tests can pin
 * the bands and the two cannot drift apart — the `groundConformPlugin.ts`
 * idiom. `terrainTexture.ts` owns the textures, samplers and uniforms and
 * injects these strings after its ground blend.
 *
 * Renderer-only by construction: nothing here is a tunable. `ROAD_PAINT_END`
 * mirrors sim/road.ts's ROAD_CORRIDOR_HALF (30) — retune both together or
 * the paint band desyncs from the earthworks.
 *
 * COMMENT PROSE IN THE GLSL STRINGS IS NOT INERT — never spell a hashed
 * preprocessor keyword inside a comment there (terrainTexture.ts, note 2).
 */
import { clamp01, mixRgb, type Rgb } from "./colour.js";

export const ROAD_PAINT_END = 30;
export const ROAD_ASPHALT_HALF = 3.5;
export const ROAD_SHOULDER_HALF = 5.5;
export const ROAD_LINE_HALF = 0.15;
export const ROAD_DASH_PERIOD = 12;
export const ROAD_DASH_ON = 3;
/** Fraction of dashes that survived the years. */
export const ROAD_DASH_KEEP = 0.65;
/** Design soft-edge half-widths (m). The shader widens each to the fragment
 * derivative of |u| so the band does not alias at range, never narrower. */
export const ROAD_ASPHALT_EDGE = 0.4;
export const ROAD_LINE_EDGE = 0.2;
export const ROAD_LINE_STRENGTH = 0.55;
export const ROAD_VERGE_STRENGTH = 0.5;

export const ASPHALT: Rgb = { r: 0.14, g: 0.14, b: 0.15 };
export const CENTERLINE: Rgb = { r: 0.42, g: 0.36, b: 0.18 };
export const GRAVEL: Rgb = { r: 0.3, g: 0.28, b: 0.24 };
export const VERGE: Rgb = { r: 0.17, g: 0.14, b: 0.1 };

/** Centerline table: 2560 texels at 4 m, ±5120 m about a centre, recentred
 * after 768 m of drift. Ring 6 reaches 4096 + 128 m from the camera, so
 * 768 + 4224 = 4992 m stays inside the half span with 128 m to spare. */
export const ROAD_TABLE_N = 2560;
export const ROAD_TABLE_STEP = 4;
export const ROAD_TABLE_HALF_SPAN = (ROAD_TABLE_N / 2) * ROAD_TABLE_STEP;
export const ROAD_TABLE_RECENTRE = 768;

export type RoadCenterX = (seed: number, z: number) => number;

/** World z of texel 0 for a table centred on `centreZ`. */
export function roadTableZ0(centreZ: number): number {
  return centreZ - ROAD_TABLE_HALF_SPAN;
}

/** Fill (or refill) the table: texel i holds the hook at z0 + i·step. */
export function buildRoadTable(seed: number, centreZ: number, centerX: RoadCenterX, out?: Float32Array): Float32Array {
  const table = out ?? new Float32Array(ROAD_TABLE_N);
  const z0 = roadTableZ0(centreZ);
  for (let i = 0; i < ROAD_TABLE_N; i++) table[i] = centerX(seed, z0 + i * ROAD_TABLE_STEP);
  return table;
}

export function roadTableStale(centreZ: number, camZ: number): boolean {
  return Math.abs(camZ - centreZ) > ROAD_TABLE_RECENTRE;
}

/**
 * Per-dash wear: does dash `dashIndex` (floor(z / 12)) survive? The same
 * 32-bit unsigned multiply/xor-shift the shader runs — `Math.imul` and `>>>`
 * reproduce uint arithmetic exactly, including the two's-complement wrap of
 * a negative index. Cosmetic and seedless: nothing in sim/ consumes it.
 */
export function dashKeeps(dashIndex: number): boolean {
  let h = Math.imul(dashIndex | 0, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h & 0xffff) / 65536 < ROAD_DASH_KEEP;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export type RoadBands = { verge: number; gravel: number; asphalt: number; line: number };

/**
 * Band weights at signed offset `u` (m) and world `z`. `aa` is the fragment
 * footprint in u (the shader's fwidth), 0 for the analytic answer. Mirrors
 * ROAD_FRAGMENT_PAINT line for line.
 */
export function roadBands(u: number, z: number, aa = 0): RoadBands {
  const au = Math.abs(u);
  if (au >= ROAD_PAINT_END) return { verge: 0, gravel: 0, asphalt: 0, line: 0 };
  const verge = ROAD_VERGE_STRENGTH * (1 - smoothstep(ROAD_SHOULDER_HALF, ROAD_PAINT_END, au));
  const gravel = 1 - smoothstep(ROAD_ASPHALT_HALF, ROAD_SHOULDER_HALF, au);
  const e = Math.max(ROAD_ASPHALT_EDGE, aa);
  const asphalt = 1 - smoothstep(ROAD_ASPHALT_HALF - e, ROAD_ASPHALT_HALF + e, au);
  const phase = ((z % ROAD_DASH_PERIOD) + ROAD_DASH_PERIOD) % ROAD_DASH_PERIOD;
  const on = phase < ROAD_DASH_ON && dashKeeps(Math.floor(z / ROAD_DASH_PERIOD));
  const le = Math.max(ROAD_LINE_EDGE, aa);
  const line = on ? ROAD_LINE_STRENGTH * (1 - smoothstep(ROAD_LINE_HALF, ROAD_LINE_HALF + le, au)) : 0;
  return { verge, gravel, asphalt, line };
}

const WHITE: Rgb = { r: 1, g: 1, b: 1 };

function mulRgb(a: Rgb, b: Rgb): Rgb {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b };
}

/** The composition order classifySurface used: verge tint, then gravel,
 * asphalt and the line replace in turn. Textures multiply their own layer. */
export function roadAlbedo(ground: Rgb, bands: RoadBands, asphaltTex: Rgb = WHITE, gravelTex: Rgb = WHITE): Rgb {
  let c = mixRgb(ground, VERGE, bands.verge);
  c = mixRgb(c, mulRgb(GRAVEL, gravelTex), bands.gravel);
  c = mixRgb(c, mulRgb(ASPHALT, asphaltTex), bands.asphalt);
  return mixRgb(c, CENTERLINE, bands.line);
}

/** GLSL float literal: `30` must become `30.0` or the shader sees an int. */
function f(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}
function rgb(c: Rgb): string {
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
}

/** Declarations for the fragment stage; `terrainTexture.ts` declares the
 * `roadTable` vec4 = (z0, step, N, asphalt repeats per metre) alongside its
 * own uniforms, both UBO and non-UBO paths. */
export const ROAD_FRAGMENT_DEFS = `
#ifdef ROADPAINT
uniform sampler2D roadCenter;
uniform sampler2D roadAsphalt;
#endif
`;

/**
 * Injected after the ground-texture blend, inside the same
 * CUSTOM_FRAGMENT_BEFORE_LIGHTS block, so terrainFade/terrainEye/
 * terrainTiling/terrainRock2/terrainPebble are in scope. The centerline is
 * fetched nearest and lerped by hand, so no float-linear extension is
 * needed. fwidth runs BEFORE the branch: a derivative inside non-uniform
 * control flow is undefined. Colours are multiplied by the material albedo
 * so applyWetness's luminance scale still darkens a wet road. The
 * `texture2D` fetches for `rGravelTex`/`rAsphaltTex` sit inside the
 * `rau < ROAD_PAINT_END` branch too, with implicit LOD, which GLSL ES 3.00
 * leaves undefined at a non-uniform branch edge; it is harmless here
 * because at |u| = 30 (the branch's own edge) both `rGravel` and `rAsphalt`
 * are exactly 0, so any undefined sample there is multiplied away before it
 * reaches `surfaceAlbedo`.
 */
export const ROAD_FRAGMENT_PAINT = `
#ifdef ROADPAINT
{
  float rfi = (vPositionW.z - roadTable.x) / roadTable.y;
  float rfl = clamp(floor(rfi), 0.0, roadTable.z - 2.0);
  float rft = clamp(rfi - rfl, 0.0, 1.0);
  float rx0 = texture2D(roadCenter, vec2((rfl + 0.5) / roadTable.z, 0.5)).r;
  float rx1 = texture2D(roadCenter, vec2((rfl + 1.5) / roadTable.z, 0.5)).r;
  float ru = vPositionW.x - mix(rx0, rx1, rft);
  float rau = abs(ru);
  float raa = fwidth(rau);
  if (rau < ${f(ROAD_PAINT_END)}) {
    float rk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
    vec3 rGravelTex = mix(vec3(1.0), texture2D(terrainPebble, vPositionW.xz * terrainTiling.w).rgb / terrainRock2.y, rk);
    vec3 rAsphaltTex = mix(vec3(1.0), texture2D(roadAsphalt, vec2(ru, vPositionW.z) * roadTable.w).rgb / terrainRock2.y, rk);
    // Asphalt's slice of the relief arrays:
    // the road's u axis is world X across the centreline, so it shares the
    // ground's planar frame — the same (ru, z) * roadTable.w coordinate the
    // asphalt albedo above was fetched with, on layer index 5.
    vec3 rAsphaltN = texture2D(terrainNormals, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb * 2.0 - 1.0;
    vec3 rAsphaltRAH = texture2D(terrainRAH, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb;
    // AO, the same mean-1 form as the ground
    // blend's own AO term in terrainTexture.ts: the packed channel is
    // normalised to mean 0.5 when the texture was made, so dividing by 0.5 turns it
    // into a multiplier centred on 1.0 rather than on asphalt's own raw mean.
    rAsphaltTex *= mix(1.0, rAsphaltRAH.g / 0.5, rk);
    float rVerge = ${f(ROAD_VERGE_STRENGTH)} * (1.0 - smoothstep(${f(ROAD_SHOULDER_HALF)}, ${f(ROAD_PAINT_END)}, rau));
    float rGravel = 1.0 - smoothstep(${f(ROAD_ASPHALT_HALF)}, ${f(ROAD_SHOULDER_HALF)}, rau);
    float rE = max(${f(ROAD_ASPHALT_EDGE)}, raa);
    float rAsphalt = 1.0 - smoothstep(${f(ROAD_ASPHALT_HALF)} - rE, ${f(ROAD_ASPHALT_HALF)} + rE, rau);
    // Normal/roughness/F0 blend toward the asphalt's own relief, faded by rk
    // the same way its albedo is, then gated by the asphalt band's coverage.
    float rRelief = rAsphalt * rk;
    normalW = normalize(mix(normalW, normalize(normalW + vec3(rAsphaltN.x, 0.0, rAsphaltN.y)), rRelief));
    terrainRough = mix(terrainRough, clamp(terrainLayerRough2.y * mix(1.0, rAsphaltRAH.r / 0.5, rk), 0.0, 1.0), rAsphalt);
    terrainF0 = mix(terrainF0, terrainLayerF02.y, rAsphalt);
    float rPhase = mod(vPositionW.z, ${f(ROAD_DASH_PERIOD)});
    uint rh = uint(int(floor(vPositionW.z / ${f(ROAD_DASH_PERIOD)}))) * 2654435761u;
    rh ^= rh >> 15u;
    rh *= 2246822519u;
    rh ^= rh >> 13u;
    float rKeep = float(rh & 65535u) / 65536.0;
    float rOn = (rPhase < ${f(ROAD_DASH_ON)} && rKeep < ${f(ROAD_DASH_KEEP)}) ? 1.0 : 0.0;
    float rLe = max(${f(ROAD_LINE_EDGE)}, raa);
    float rLine = rOn * ${f(ROAD_LINE_STRENGTH)} * (1.0 - smoothstep(${f(ROAD_LINE_HALF)}, ${f(ROAD_LINE_HALF)} + rLe, rau));
    vec3 rCol = mix(surfaceAlbedo, ${rgb(VERGE)} * vAlbedoColor.rgb, rVerge);
    rCol = mix(rCol, ${rgb(GRAVEL)} * rGravelTex * vAlbedoColor.rgb, rGravel);
    rCol = mix(rCol, ${rgb(ASPHALT)} * rAsphaltTex * vAlbedoColor.rgb, rAsphalt);
    rCol = mix(rCol, ${rgb(CENTERLINE)} * vAlbedoColor.rgb, rLine);
    surfaceAlbedo = rCol;
  }
}
#endif
`;
