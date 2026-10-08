/**
 * The lake's ripples as two states (spec §7): the cat's-paw mask that switches
 * the surface between glass and the rippled octaves, and the rain's rings
 * near the eye. The GLSL lives in `shaders/lakeRipples.fragment.fx`: every
 * function here but `lakeRingHeight` (the height whose derivative
 * `lakeRingDh` is, kept for its tests) has a GLSL twin of the same name and
 * arguments, and the GLSL's `lakeRipple2`, which samples the bump, has none
 * here. Every `const float` there is one of the constants here or in
 * `windParams.ts`, a lockstep test holding them equal. Babylon-free and on
 * BABYLON_FREE_FILES.
 *
 * Both read the lake's time: the shared seconds wrapped at WIND_TIME_WRAP, as
 * the wind's are, so peers see the same paws and rings. Every rate here is a
 * whole number of cycles in the wrap, and the paws' drift is crossed over the
 * wrap's last life (`lakePaw`), so the wrap moves nothing.
 */
import { WIND_DIR_PERIOD, WIND_TIME_WRAP, gustAt, type WindRecord } from "./windParams.js";
import { midgeHash } from "./midgeMotion.js";

/** The paws' features (m), their drift downwind (m/s, the gusts' own), their soft edge (m) and a patch's life (s). */
export const PAW_FEATURE_M = 10;
export const PAW_SPEED = 1.5;
export const PAW_EDGE_M = 0.5;
export const PAW_LIFE_S = 6;
/** The share of the paws' field left where no gust blows: a paw is likelier
 * where a gust crosses, and a lake rough all over (cover 1) is rough whatever the gust. */
export const PAW_GUST_FLOOR = 0.5;
/**
 * The paws' threshold on the gust-raised field at cover 0, 1/8, 2/8 … 1: the
 * field's values crowd about the middle and the floor halves it where no gust
 * blows, so a threshold of 1 − cover covers far less than the cover (0.14 of
 * the lake at cover 0.5). Each knot is the threshold at which the paws cover
 * that share of the lake under the real gusts (`lakeGust` at each point, the
 * wind turning), measured over 120 m squares and the wind's wrap; linear
 * between, so the covered share follows the cover.
 */
export const PAW_COVER_TABLE = [1, 0.521, 0.404, 0.343, 0.294, 0.246, 0.198, 0.144, 0] as const;

/** The rain's rings: drawn within LAKE_RING_REACH metres of the eye, fading
 * over the last LAKE_RING_FADE_M; one drop a LAKE_RING_CELL cell a second; the
 * ring's front at LAKE_RING_SPEED m/s, its crests LAKE_RING_LAMBDA apart,
 * dying over LAKE_RING_TAU seconds from an amplitude of LAKE_RING_AMP metres. */
export const LAKE_RING_REACH = 8;
export const LAKE_RING_FADE_M = 2;
export const LAKE_RING_CELL = 0.18;
export const LAKE_RING_SPEED = 0.18;
export const LAKE_RING_LAMBDA = 0.03;
export const LAKE_RING_TAU = 0.3;
export const LAKE_RING_AMP = 0.004;
/** Live rings a square metre at 0.5, 1 and 2 mm/h and above (Marshall and Palmer's drops of 1 mm and over, living half a second). */
export const LAKE_RINGS_PER_M2 = [35, 77, 150] as const;
/** mm/h of rain at the weather's rain of 1. */
export const LAKE_RAIN_MM_H = 4;
/** The rings' cells fold to this many a side before the hash, which keeps its inputs in the hundreds. */
export const LAKE_RING_FOLD = 512;
/** The wind's turn, rad/s: one turn a WIND_DIR_PERIOD (`directionAt`). */
export const LAKE_WIND_TURN = (2 * Math.PI) / WIND_DIR_PERIOD;

const TAU = 2 * Math.PI;

function fract(v: number): number {
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** GLSL's mod: the remainder with the divisor's sign. */
function mod(v: number, m: number): number {
  return v - m * Math.floor(v / m);
}

/** The record `lakeGust` hands `gustAt`, filled in place. */
const gustRecord: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };

/** The wind's gust at world (x, z) at the wind's time t: `gustAt`, the trees' own, in [-1.5, 1.5]. */
export function lakeGust(x: number, z: number, t: number, dirX: number, dirZ: number): number {
  gustRecord.dirX = dirX;
  gustRecord.dirZ = dirZ;
  gustRecord.time = t;
  return gustAt(gustRecord, x, z);
}

/**
 * How far the paws have drifted over the last `span` seconds (negative: the
 * next), at PAW_SPEED along the wind, which turns at LAKE_WIND_TURN and points
 * along (dirX, dirZ) now: the drift's integral in closed form, so the paws
 * move at PAW_SPEED along the wind of the moment.
 */
export function lakePawDrift(dirX: number, dirZ: number, span: number): [number, number] {
  const c = Math.cos(LAKE_WIND_TURN * span);
  const s = Math.sin(LAKE_WIND_TURN * span);
  const k = PAW_SPEED / LAKE_WIND_TURN;
  return [k * (dirZ * (1 - c) + dirX * s), k * (dirX * (c - 1) + dirZ * s)];
}

/** A lattice node's value at time t: it rises and falls over PAW_LIFE_S from a phase its hash sets. */
function pawNode(ix: number, iz: number, t: number): number {
  return 0.5 - 0.5 * Math.cos(TAU * (t / PAW_LIFE_S + midgeHash(ix, iz)));
}

/** Value noise of the living nodes at p (lattice units): the value and its gradient, per lattice unit. */
function pawNoise(px: number, pz: number, t: number, out: [number, number, number], weight: number, scale: number): void {
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const dux = 6 * fx * (1 - fx);
  const duz = 6 * fz * (1 - fz);
  const a = pawNode(ix, iz, t);
  const b = pawNode(ix + 1, iz, t);
  const c = pawNode(ix, iz + 1, t);
  const d = pawNode(ix + 1, iz + 1, t);
  const k = a - b - c + d;
  out[0] += weight * (a + (b - a) * ux + (c - a) * uz + k * ux * uz);
  out[1] += weight * scale * dux * (b - a + k * uz);
  out[2] += weight * scale * duz * (c - a + k * ux);
}

/** The paws' field, 0 to 1, and its gradient (per metre), drifted by `span` seconds. */
function pawField(x: number, z: number, t: number, dirX: number, dirZ: number, span: number): [number, number, number] {
  const [ox, oz] = lakePawDrift(dirX, dirZ, span);
  const px = (x - ox) / PAW_FEATURE_M;
  const pz = (z - oz) / PAW_FEATURE_M;
  const out: [number, number, number] = [0, 0, 0];
  pawNoise(px, pz, t, out, 2 / 3, 1 / PAW_FEATURE_M);
  pawNoise(2 * px + 37, 2 * pz + 17, t, out, 1 / 3, 2 / PAW_FEATURE_M);
  return out;
}

/**
 * The cat's-paw mask at world (x, z), 0 on glass to 1 in a paw: two octaves
 * of living value noise, PAW_FEATURE_M a feature, drifting downwind; raised
 * where the gust blows (`gust`, `lakeGust` at the pixel); thresholded at
 * `lakePawThreshold(cover)`, so the paws cover about `cover` of the lake,
 * with an edge PAW_EDGE_M metres wide, measured along the field's own
 * gradient. Over the wrap's last PAW_LIFE_S the drift crosses to the next
 * wrap's, so the pattern runs on through it.
 */
export function lakePaw(x: number, z: number, t: number, windDirX: number, windDirZ: number, cover: number, gust: number): number {
  const a = pawField(x, z, t, windDirX, windDirZ, t);
  const b = pawField(x, z, t, windDirX, windDirZ, t - WIND_TIME_WRAP);
  const w = smoothstep(WIND_TIME_WRAP - PAW_LIFE_S, WIND_TIME_WRAP, t);
  const g = PAW_GUST_FLOOR + (1 - PAW_GUST_FLOOR) * clamp01(gust);
  const f = (a[0] + (b[0] - a[0]) * w) * g;
  const gx = (a[1] + (b[1] - a[1]) * w) * g;
  const gz = (a[2] + (b[2] - a[2]) * w) * g;
  const slope = Math.max(Math.hypot(gx, gz), 1e-4);
  return clamp01((f - lakePawThreshold(cover)) / (slope * PAW_EDGE_M));
}

/** The paws' threshold at a cover (0 to 1): PAW_COVER_TABLE, linear between its knots, summed as ramps as the GLSL does. */
export function lakePawThreshold(cover: number): number {
  const c = (PAW_COVER_TABLE.length - 1) * clamp01(cover);
  let theta: number = PAW_COVER_TABLE[0];
  for (let i = 0; i < PAW_COVER_TABLE.length - 1; i++) {
    theta += ((PAW_COVER_TABLE[i + 1] as number) - (PAW_COVER_TABLE[i] as number)) * clamp01(c - i);
  }
  return theta;
}

/** The octaves' amplitude under the mask: 1 in a paw, 0 on glass, smooth over the edge. */
export function octaveAmplitude(paw: number): number {
  return smoothstep(0, 1, paw);
}

/** Live rings a square metre at the weather's rain (0 to 1, LAKE_RAIN_MM_H mm/h at 1): LAKE_RINGS_PER_M2, linear between. */
export function lakeLiveRings(rate: number): number {
  const mmh = LAKE_RAIN_MM_H * rate;
  const [r0, r1, r2] = LAKE_RINGS_PER_M2;
  return r0 * clamp01(mmh / 0.5) + (r1 - r0) * clamp01((mmh - 0.5) / 0.5) + (r2 - r1) * clamp01(mmh - 1);
}

/** One ring's height (m) at r metres from its drop, `age` seconds after it: a train behind a front at LAKE_RING_SPEED·age. */
export function lakeRingHeight(r: number, age: number): number {
  const k = TAU / LAKE_RING_LAMBDA;
  const front = LAKE_RING_SPEED * age - r;
  return LAKE_RING_AMP * Math.exp(-age / LAKE_RING_TAU) * Math.sin(k * (r - LAKE_RING_SPEED * age)) * smoothstep(0, LAKE_RING_LAMBDA, front);
}

/** The ring's height's derivative along r, in closed form. */
export function lakeRingDh(r: number, age: number): number {
  const k = TAU / LAKE_RING_LAMBDA;
  const phase = k * (r - LAKE_RING_SPEED * age);
  const s = clamp01((LAKE_RING_SPEED * age - r) / LAKE_RING_LAMBDA);
  const window = s * s * (3 - 2 * s);
  const windowDr = (-6 * s * (1 - s)) / LAKE_RING_LAMBDA;
  return LAKE_RING_AMP * Math.exp(-age / LAKE_RING_TAU) * (k * Math.cos(phase) * window + Math.sin(phase) * windowDr);
}

/** `splashHash` (rainSplash.ts), Hoskins' sine-free hash22, of (px, py): two values in [0, 1). */
export function lakeRingHash(px: number, py: number): [number, number] {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.103);
  let z = fract(px * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return [fract((x + y) * z), fract((x + z) * y)];
}

/**
 * The rain's rings at world (x, z) at the lake's time t, `dist` metres from
 * the eye: the tilt they give the normal, −∇h. One drop a cell a second at
 * the cell's own phase, its point in the cell hashed anew each second, the
 * 3 × 3 cells about the point summed (a ring dies before it leaves them);
 * scaled by the live rings the rain gives, at most LAKE_RINGS_PER_M2[1]'s
 * worth, and faded out over the last LAKE_RING_FADE_M before LAKE_RING_REACH.
 */
export function lakeRainSlope(x: number, z: number, t: number, rate: number, dist: number): [number, number] {
  const bx = Math.floor(x / LAKE_RING_CELL);
  const bz = Math.floor(z / LAKE_RING_CELL);
  let sx = 0;
  let sz = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = bx + i;
      const cz = bz + j;
      const hx = mod(cx, LAKE_RING_FOLD);
      const hz = mod(cz, LAKE_RING_FOLD);
      const s = t + lakeRingHash(hx, hz)[0];
      const age = fract(s);
      const cycle = mod(Math.floor(s), WIND_TIME_WRAP);
      const [qx, qz] = lakeRingHash(hx + cycle, hz + cycle);
      const dx = x - (cx + qx) * LAKE_RING_CELL;
      const dz = z - (cz + qz) * LAKE_RING_CELL;
      const r = Math.hypot(dx, dz);
      const dh = lakeRingDh(r, age) / Math.max(r, 1e-5);
      sx -= dh * dx;
      sz -= dh * dz;
    }
  }
  const scale =
    Math.min(lakeLiveRings(rate) / LAKE_RINGS_PER_M2[1], 1) *
    (1 - smoothstep(LAKE_RING_REACH - LAKE_RING_FADE_M, LAKE_RING_REACH, dist));
  return [sx * scale, sz * scale];
}
