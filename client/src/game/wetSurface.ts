/**
 * What water and weather do to a surface, as numbers: the wet line of the
 * nearest body, the swash's cove and table, the weather's wetness and a
 * material's porosity cap, the uniforms the wet look is drawn with by name,
 * and the look itself as the fragment stage makes it, for the tests.
 * `wetPlugin.ts` says what the look is and binds these to a material; this
 * module loads no Babylon.
 */
import { clamp01 } from "./colour.js";
import type { WaterBody } from "./waterShading.js";
import { SWASH_COLUMNS, SWASH_STRIDE } from "./swashTable.js";

export const WET_ALBEDO = 0.4;
export const WET_ROUGHNESS = 0.15;
export const WET_BAND = 0.1;
/** The still swash band above a body's level (spec §6.1). */
export const WET_LINE_ABOVE = 0.3;

/** Radius cap for the sea: 1e6 + 1 and 1e6 + 3 are distinct in fp32, 1e9 + 1 is not (smoothstep needs distinct edges). */
export const WET_RADIUS_MAX = 1e6;

/** The swash's damp ground: its albedo factor and the roughness it is held to at most. */
export const WET_DAMP_ALBEDO = 0.7;
export const WET_DAMP_ROUGHNESS = 0.5;
/** The swash's ground dries over this (s): soaked for WET_SOAKED_S after a
 * sheet, damp by a third of it, dry by all of it (SWASH_DRY_S). */
export const WET_DRY_S = 60;
export const WET_SOAKED_S = 0.5;
/** The foam speckle on the swash's band: its weight toward white, fading
 * over WET_SPECKLE_S after a sheet (SWASH_SPECKLE_S); the share of its
 * WET_SPECKLE_CELL cells it covers, faded to that share between
 * WET_SPECKLE_NEAR and WET_SPECKLE_FAR metres from the eye. */
export const WET_SPECKLE = 0.2;
export const WET_SPECKLE_S = 10;
export const WET_SPECKLE_CELL = 0.05;
export const WET_SPECKLE_COVER = 0.25;
export const WET_SPECKLE_NEAR = 10;
export const WET_SPECKLE_FAR = 25;
/** The cove's swash fades into the bays' still line over ± this about each
 * of its ends, as its ground does (COVE_END_BLEND). */
export const WET_COVE_END = 30;
/** The vec4s of `wetSwash`: two columns of the swash's table each. */
export const WET_SWASH_VECS = SWASH_COLUMNS / 2;
/** No cove: a half-width so far below zero that the cove's share is 0 at every z. */
export const WET_NO_COVE = -1e6;

/** The porosity cap of each kind of material the weather wets. */
export const WET_CAP = {
  bark: 1,
  deadwood: 1,
  duff: 1,
  fungus: 1,
  prop: 1,
  rock: 0.5,
  cliff: 0.5,
  leaf: 0.3,
} as const;

// Module-level like the foliage plugin's wind: every wet surface reads one
// wetness, written once per frame by the renderer.
let weatherWet = 0;

/** Per frame: the weather's wetness in [0, 1], for every attached plugin. */
export function setWetWeather(wetness: number): void {
  weatherWet = clamp01(wetness);
}

// Module-level as the weather's wetness is: one cove and one table for the
// page, read by every wet surface.
const wetCove: [number, number, number, number] = [0, WET_NO_COVE, 0, 0];
const wetSwash = new Float32Array(WET_SWASH_VECS * 4);
for (let i = 1; i < wetSwash.length; i += 2) wetSwash[i] = WET_DRY_S;

/** The cove the swash's table runs along, for every attached plugin: its
 * centre z, its half-width, the face's toe (signed coast distance, m) and the
 * face's grade. No cove when any is not finite. */
export function setWetCove(z0: number, halfWidth: number, toeD: number, faceGrade: number): void {
  const finite = Number.isFinite(z0) && Number.isFinite(halfWidth) && Number.isFinite(toeD) && Number.isFinite(faceGrade);
  wetCove[0] = finite ? z0 : 0;
  wetCove[1] = finite ? halfWidth : WET_NO_COVE;
  wetCove[2] = finite ? toeD : 0;
  wetCove[3] = finite ? faceGrade : 0;
}

/**
 * Per frame: the swash's table (`SwashTable.data`, (front, thickness, reach,
 * age) a column), packed for every attached plugin into the one array they
 * bind: (reach, age) of columns 2i and 2i + 1 in `wetSwash[i]`. A reach that
 * is not a finite number reads as none, an age as dry; nothing is made.
 */
export function setWetSwash(data: Float32Array): void {
  for (let c = 0; c < SWASH_COLUMNS; c++) {
    const reach = data[c * SWASH_STRIDE + 2];
    const age = data[c * SWASH_STRIDE + 3];
    wetSwash[c * 2] = reach !== undefined && Number.isFinite(reach) ? Math.max(0, reach) : 0;
    wetSwash[c * 2 + 1] = age !== undefined && Number.isFinite(age) ? Math.max(0, age) : WET_DRY_S;
  }
}

/** A body as the wet line reads it: its centre, the disc every material
 * but the terrain is held to (a lake's farthest shore point), and how far
 * its ground reaches (a lake's bound; the sea's infinite). */
export type WetBody = WaterBody & { x: number; z: number; radius: number; bound: number };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The medium and low tiers' per-channel darkening by the water above a point,
 * as wetLights.fragment.fx computes it: exp(−2·(kd − mean kd)·depth), capped
 * at 1, where the depth below `level` is held to the body's footprint (1 inside,
 * 0 from 3 m past the rim, blended from 1 m, `wetInside` in wet.fragment.fx).
 * `radius` is capped at WET_RADIUS_MAX as the uniform is.
 */
export function wetResidual(
  kd: readonly [number, number, number],
  level: number,
  y: number,
  centre: readonly [number, number],
  radius: number,
  xz: readonly [number, number],
): [number, number, number] {
  const r = Math.min(radius, WET_RADIUS_MAX);
  const inside = 1 - smoothstep(r + 1, r + 3, Math.hypot(xz[0] - centre[0], xz[1] - centre[1]));
  const depth = Math.max(0, level - y) * inside;
  const mean = (kd[0] + kd[1] + kd[2]) / 3;
  const ch = (k: number): number => Math.min(1, Math.exp(-2 * (k - mean) * depth));
  return [ch(kd[0]), ch(kd[1]), ch(kd[2])];
}

/** GLSL's mix: x · (1 − a) + y · a. */
function mix(x: number, y: number, a: number): number {
  return x * (1 - a) + y * a;
}

/** 1 below the line, 0 above it, blended over WET_BAND: `wetBelow` in wet.fragment.fx. */
export function wetBelowLine(y: number, line: number): number {
  return 1 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);
}

/** The wet look at a point, as wetLights.fragment.fx makes it: how wet (the
 * still line's weight, or the swash's soaked one where higher), how damp,
 * and the speckle's weight before its cells' mask. */
export type WetLook = { wet: number; damp: number; speckle: number };

/**
 * The wet look at height y and world z, as wetLights.fragment.fx makes it
 * from the still line `line`, the body's `level`, the footprint's `inside`
 * and the bound cove and table (`wetCove`, `wetSwash`, as `setWetCove` and
 * `setWetSwash` pack them): the TypeScript twin of `wetShore` and the lines
 * that take it. Refills `out`.
 */
export function wetLookAt(
  y: number, z: number, line: number, level: number, inside: number,
  cove: readonly [number, number, number, number], swash: Float32Array, out: WetLook,
): WetLook {
  const share = 1 - smoothstep(cove[1] - WET_COVE_END, cove[1] + WET_COVE_END, Math.abs(z - cove[0]));
  const c = Math.floor(Math.min(Math.max(z - cove[0] + SWASH_COLUMNS / 2, 0), SWASH_COLUMNS - 1) + 0.5);
  const reach = swash[c * 2] as number;
  const age = swash[c * 2 + 1] as number;
  const band = wetBelowLine(y, level + reach * cove[3]) * share;
  const soaked = 1 - smoothstep(WET_SOAKED_S, WET_DRY_S / 3, age);
  const damp = smoothstep(WET_SOAKED_S, WET_DRY_S / 3, age) - smoothstep(WET_DRY_S / 3, WET_DRY_S, age);
  const fresh = Math.min(1, Math.max(0, 1 - age / WET_SPECKLE_S));
  const above = 1 - wetBelowLine(y, level);
  const still = wetBelowLine(y, line) * inside;
  out.wet = Math.max(still, soaked * band * inside);
  out.damp = damp * band * inside * (1 - still);
  out.speckle = WET_SPECKLE * fresh * above * band * inside;
  return out;
}

/** The albedo factor a look gives (before the speckle and the water above): `mix(1, WET_ALBEDO, wet) · mix(1, WET_DAMP_ALBEDO, damp)`. */
export function wetAlbedoFactor(look: WetLook): number {
  return mix(1, WET_ALBEDO, look.wet) * mix(1, WET_DAMP_ALBEDO, look.damp);
}

/** The roughness a look gives a surface of roughness r, as WET_ROUGHNESS_CODE writes it. */
export function wetRoughnessOf(r: number, look: WetLook): number {
  return mix(mix(r, Math.min(r, WET_DAMP_ROUGHNESS), look.damp), WET_ROUGHNESS, look.wet);
}

/** How far past its bound a lake still claims the wet line over the sea, metres. */
const POND_REACH = 40;

/**
 * The nearest body's wet line and kd for a point. The sea (infinite radius) is
 * everywhere at distance zero, so it is the fallback: a lake wins only
 * within POND_REACH of its bound (spec §10.2), the nearest such lake.
 */
export type WetState = {
  line: number;
  level: number;
  kd: [number, number, number];
  centre: [number, number];
  radius: number;
};

export function wetLineFor(bodies: readonly WetBody[], x: number, z: number): WetState {
  let best: WetBody | null = null;
  let bestD = POND_REACH;
  let fallback: WetBody | null = null;
  for (const b of bodies) {
    if (!Number.isFinite(b.radius)) { fallback ??= b; continue; }
    const d = Math.max(0, Math.hypot(x - b.x, z - b.z) - b.bound);
    if (d <= bestD) { bestD = d; best = b; }
  }
  const pick = best ?? fallback;
  if (pick === null) return { line: -1e6, level: -1e6, kd: [0, 0, 0], centre: [0, 0], radius: 0 };
  return { line: pick.level + WET_LINE_ABOVE, level: pick.level, kd: pick.kd, centre: [pick.x, pick.z], radius: Math.min(pick.radius, WET_RADIUS_MAX) };
}


type V1 = [number];
type V2 = [number, number];
type V3 = [number, number, number];
type V4 = [number, number, number, number];

/** What of the wet look is a surface's own: the wet line it is under
 * (`WetState`, the nearest body's), whether the water above it darkens it a
 * channel (not on the high tier), and its material's porosity cap. */
export type WetSurface = {
  readonly line: number;
  readonly level: number;
  readonly centre: readonly [number, number];
  readonly radius: number;
  readonly kd: readonly [number, number, number];
  readonly attenuate: boolean;
  /** In [0, 1]: 0 leaves the weather's wetness unread. */
  readonly cap: number;
};

/** The wet look's uniforms by name, in the order the plugin declares them. */
export type WetUniforms = {
  wetLine: V1;
  wetLevel: V1;
  wetCentre: V2;
  /** Held to WET_RADIUS_MAX. */
  wetRadius: V1;
  wetKd: V3;
  /** 1 where the water above darkens the surface a channel, else 0. */
  wetAttenuate: V1;
  /** The weather's wetness, [0, 1] (`setWetWeather`). */
  wetWeather: V1;
  wetCap: V1;
  /** (centre z, half-width, toe, face grade) of the swash's cove (`setWetCove`). */
  wetCove: V4;
  /** The swash's table, WET_SWASH_VECS vec4s, (reach, age) of two columns
   * each (`setWetSwash`): the page's one array, not a copy. */
  wetSwash: Float32Array;
};

/** A record of the right shape for `wetUniforms` to fill. */
export function emptyWetUniforms(): WetUniforms {
  return {
    wetLine: [0], wetLevel: [0], wetCentre: [0, 0], wetRadius: [0], wetKd: [0, 0, 0],
    wetAttenuate: [0], wetWeather: [0], wetCap: [0], wetCove: [0, 0, 0, 0], wetSwash,
  };
}

/**
 * The uniforms a surface's wet look is drawn with: its own wet line and cap,
 * and the page's wetness, cove and swash table as last set. Fills and
 * returns `out` (a record of its own when none is given).
 */
export function wetUniforms(surface: WetSurface, out: WetUniforms = emptyWetUniforms()): WetUniforms {
  out.wetLine[0] = surface.line;
  out.wetLevel[0] = surface.level;
  out.wetCentre[0] = surface.centre[0];
  out.wetCentre[1] = surface.centre[1];
  out.wetRadius[0] = Math.min(surface.radius, WET_RADIUS_MAX);
  out.wetKd[0] = surface.kd[0];
  out.wetKd[1] = surface.kd[1];
  out.wetKd[2] = surface.kd[2];
  out.wetAttenuate[0] = surface.attenuate ? 1 : 0;
  out.wetWeather[0] = weatherWet;
  out.wetCap[0] = surface.cap;
  out.wetCove[0] = wetCove[0];
  out.wetCove[1] = wetCove[1];
  out.wetCove[2] = wetCove[2];
  out.wetCove[3] = wetCove[3];
  out.wetSwash = wetSwash;
  return out;
}
