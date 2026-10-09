/**
 * The plunging breaker on the cove's face (the sea's edge, spec §4): Babylon-
 * free, on BABYLON_FREE_FILES. On the 1:12 pebble face the swell's crests,
 * which reach the face's toe mostly unbroken, plunge; the bays' gentle sand
 * spills them as before. How much a column plunges is its share
 * (`plungeShare`): the face's Iribarren number, faceGrade over the root of the
 * offshore steepness, through smoothstep(0.4, 0.6), less the onshore wind's
 * weight. How far a crest has come through the plunge is its progress
 * (`progressOf`), the break rule's own ratio of its height to Weggel's index
 * times its depth carried over the cap's window, 1.0 to OCEAN_BREAK_FULL: the
 * face steepens from 0, the lip is thrown by LIP_THROW, the curl has closed and
 * collapsed by 1. A crest moving up the face into shallower water makes that
 * progress rise with time, so nothing is carried from frame to frame but which
 * crest is which and which crests came to the face already broken.
 *
 * The high tier draws the curl with a strip of geometry swept along the face
 * (`oceanLip.ts`): two slots a column, each a cross-section of
 * LIP_PROFILE_VERTS vertices whose shape at a progress is read from the baked
 * keyframes (`lipProfile`). `LipTracker` fills what the strip reads, a crest
 * in each slot with its place, progress, height and share, and the plunge
 * events the surf's sound plays, from the swell's own sum at the shared clock,
 * so every peer sees the same wave plunge.
 */
import { OCEAN_G } from "./oceanPhysics.js";
import {
  OCEAN_BREAK_FULL, atlasRead, coastRead, swellAtInto, swellBreakInto, swellScratch, type OceanField,
} from "./oceanWaves.js";
import { OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COVE_PROFILE } from "./oceanTables.js";
import type { SwashCove } from "./swashTable.js";
import { COVE_END_BLEND } from "../sim/olympic.js";

/** The strip's columns, a metre apart about the cove's centre (column 0 at z0 − LIP_COLUMNS / 2), as the swash table's. */
export const LIP_COLUMNS = 512;
/** Crests a column holds at once: the face is under a wavelength wide, so two cover it. */
export const LIP_SLOTS = 2;
/** Vertices in the cross-section: from the back face's foot over the crest, out along the lip, under the tube to the trough. */
export const LIP_PROFILE_VERTS = 24;
/** The cross-section's baked keyframes over the progress (`lipKey`). */
export const LIP_KEYFRAMES = 8;
/** The thrown lip's speed over the wave's: 1.3 to 1.5 (Longuet-Higgins's jet). */
export const LIP_SPEED_MIN = 1.3;
export const LIP_SPEED_MAX = 1.5;
/** The tube at full throw: its length along the travel over its height (Mead and Black, 2 to 3). */
export const LIP_TUBE_RATIO = 2.55;
/** The Iribarren numbers over which a column turns from spilling to plunging. */
export const LIP_FACE_IRIBARREN_LO = 0.4;
export const LIP_FACE_IRIBARREN_HI = 0.6;
/** Within this of the camera (m) the strip's columns are a metre apart, beyond it two. */
export const LIP_RANGE_M = 150;
/** The progress at which the curl has collapsed, the lip is thrown, and the stretch of shore (m) a plunge is heard over. */
export const LIP_COLLAPSE = 1.0;
export const LIP_THROW = 0.6;
export const LIP_STRETCH_M = 20;
/** The tracker watches the face every this many columns (m) and carries the crests between, four a stretch. */
export const LIP_PROBE_M = 5;
/** The points it watches up each probe's face, evenly from the toe to the still waterline: two metres apart on the cove's 24 m face. */
export const LIP_FACE_POINTS = 13;
/** Two crests in one column closer than this (m) are one crest numbered twice: the swell's crests on the face stand a wavelength, ten metres and more, apart. */
export const LIP_APART_M = 6;
/** A crest first seen within this of the toe (m) is judged there: broken already, it is a bore and gets no lip. */
export const LIP_ENTRY_M = 2;
/** The keyframe at the throw: the keyframes lie at 0, 0.15, 0.3, 0.45 and 0.6, then thirds of the rest to 1. */
export const LIP_KEY_THROW = 4;
/**
 * The crest's travel up the face (in units of its height) from the lip
 * leaving it, at progress 0.3, to the throw at 0.6: the ratio runs 1.15 to
 * 1.3, so the depth under the crest falls by an eighth, about a ninth of the
 * height at the break (γ_b about 0.9 on the face), 1.33 heights of travel up
 * a 1:12 face. Over it the lip, thrown at LIP_SPEED_MIN to LIP_SPEED_MAX the
 * wave's speed, gains 0.3 to 0.5 of it on the crest.
 */
export const LIP_CREST_TRAVEL = 1.33;
/** The most plunge events one update reports. */
export const LIP_PLUNGES = 32;
/** A step longer than this (s), a stalled page or a jump of the clock, reports no plunge: a crest's collapse is only seen across a frame. */
export const LIP_STEP_MAX_S = 1;

const TWO_PI = 2 * Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A column's plunge share: smoothstep(0.4, 0.6) of its face's Iribarren number, less the onshore wind's weight (0 to 1); 0 for a value that is not finite. */
export function plungeShare(iribarren: number, onshoreWeight: number): number {
  if (!Number.isFinite(iribarren) || !Number.isFinite(onshoreWeight)) return 0;
  return smoothstep(LIP_FACE_IRIBARREN_LO, LIP_FACE_IRIBARREN_HI, iribarren) * (1 - Math.min(1, Math.max(0, onshoreWeight)));
}

/** The Iribarren number of a face of `faceGrade` under a swell of significant height `hs` (m) and peak period `tp` (s): the grade over the root of the offshore steepness hs / (g·tp²/2π). */
export function faceIribarren(hs: number, tp: number, faceGrade: number): number {
  const offshoreLength = (OCEAN_G * tp * tp) / TWO_PI;
  return faceGrade / Math.sqrt(Math.max(hs, 1e-6) / offshoreLength);
}

/** A crest's progress through the plunge from its ratio (unbroken over Weggel's index times the depth): the cap's window, 1 to OCEAN_BREAK_FULL, as 0 to 1; 0 for a ratio that is not finite. */
export function progressOf(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, (ratio - 1) / (OCEAN_BREAK_FULL - 1)));
}

/** How far behind a sample (m, along the swell's travel, +x) the crest nearest it lies: its crest phase's share of a turn of its wavelength; negative when the crest is ahead. */
export function crestOffset(crestPhase: number, wavelength: number): number {
  return (crestPhase / TWO_PI) * wavelength;
}

/** The keyframe (0 to LIP_KEYFRAMES − 1, fractional) at progress p: four keyframes to the throw, three after it. */
export function lipKey(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  if (q < LIP_THROW) return (q / LIP_THROW) * LIP_KEY_THROW;
  return LIP_KEY_THROW + ((q - LIP_THROW) / (1 - LIP_THROW)) * (LIP_KEYFRAMES - 1 - LIP_KEY_THROW);
}

/**
 * The baked cross-section, LIP_KEYFRAMES rows of LIP_PROFILE_VERTS vertices,
 * each (across, up, tangent across, tangent up). `across` runs along the
 * swell's travel from the crest (shoreward positive) and `up` is the height
 * above the swell's own surface at that point, both in units of the crest's
 * height times its share, so the back face's foot (vertex 0) and the trough's
 * (vertex 23) sit on the sea's surface at every progress. Vertices 0 to 6 climb
 * the back face to the crest, 6 to 16 run out along the lip's top to its tip,
 * 16 to 19 come back under it as the tube's roof, and 19 to 23 go down the
 * face, the tube's back wall, to the trough. The tangent is the unit chord of
 * the two neighbours, for the normal.
 *
 * The shape: at progress 0 the face just steepens, no vertex ahead of the
 * next; by 0.3 the face is upright and the lip leaves the crest at 0.3 of the
 * height ahead of it; by the throw, 0.6, the tip (vertex 16) has gained 0.532
 * on the crest, 0.4 of LIP_CREST_TRAVEL (thrown at 1.4 times the wave's
 * speed), and the tube under it, from the face (vertex 21) to the tip, is 0.752
 * long and 0.295 high under its roof (vertex 19): 2.55 times longer than wide.
 * By 0.73 the tip is down on the water 1.15 ahead and the tube is closed; by 1
 * the curl has fallen to a few hundredths of the height, the burst's foam
 * over it.
 */
const LIP_PROFILE: readonly number[] = [
  // p 0, a steep face and no overhang
  -1.6, 0, 0.999, 0.034, -1.333, 0.009, 0.999, 0.034, -1.067, 0.018, 0.999, 0.039, -0.8, 0.03, 0.998, 0.062,
  -0.485, 0.054, 0.996, 0.087, -0.169, 0.085, 0.996, 0.094, 0, 0.1, 0.998, 0.067, 0.039, 0.099, 0.997, -0.076,
  0.066, 0.095, 0.981, -0.192, 0.085, 0.09, 0.962, -0.275, 0.101, 0.085, 0.962, -0.275, 0.12, 0.08, 0.974, -0.225,
  0.14, 0.076, 0.974, -0.225, 0.159, 0.071, 0.972, -0.236, 0.177, 0.067, 0.967, -0.254, 0.197, 0.061, 0.963, -0.269,
  0.22, 0.055, 0.956, -0.294, 0.249, 0.045, 0.949, -0.316, 0.28, 0.035, 0.959, -0.283, 0.31, 0.027, 0.972, -0.235,
  0.338, 0.021, 0.977, -0.212, 0.37, 0.014, 0.984, -0.18, 0.42, 0.006, 0.994, -0.107, 0.5, 0, 0.997, -0.075,
  // p 0.15, the face steepening, the crest peaking up
  -1.6, 0, 0.997, 0.079, -1.335, 0.021, 0.997, 0.077, -1.07, 0.041, 0.996, 0.091, -0.8, 0.07, 0.987, 0.162,
  -0.468, 0.14, 0.972, 0.236, -0.13, 0.233, 0.965, 0.261, 0.05, 0.28, 0.98, 0.2, 0.09, 0.278, 0.995, -0.104,
  0.117, 0.273, 0.973, -0.233, 0.136, 0.267, 0.919, -0.394, 0.152, 0.258, 0.894, -0.447, 0.17, 0.25, 0.909, -0.418,
  0.189, 0.241, 0.87, -0.494, 0.207, 0.229, 0.803, -0.596, 0.224, 0.215, 0.759, -0.651, 0.242, 0.199, 0.717, -0.697,
  0.26, 0.18, 0.629, -0.778, 0.28, 0.152, 0.555, -0.832, 0.3, 0.12, 0.574, -0.819, 0.32, 0.095, 0.586, -0.81,
  0.334, 0.073, 0.555, -0.832, 0.35, 0.05, 0.67, -0.743, 0.38, 0.022, 0.814, -0.581, 0.42, 0, 0.876, -0.482,
  // p 0.3, the face upright, the lip leaving the crest
  -1.6, 0, 0.991, 0.135, -1.336, 0.036, 0.991, 0.133, -1.072, 0.071, 0.988, 0.155, -0.8, 0.12, 0.964, 0.266,
  -0.459, 0.24, 0.927, 0.376, -0.109, 0.4, 0.914, 0.407, 0.08, 0.48, 0.945, 0.326, 0.123, 0.48, 1, -0.027,
  0.153, 0.478, 0.997, -0.078, 0.174, 0.476, 0.991, -0.13, 0.191, 0.473, 0.986, -0.164, 0.21, 0.47, 0.978, -0.21,
  0.233, 0.464, 0.94, -0.34, 0.257, 0.453, 0.862, -0.506, 0.279, 0.437, 0.746, -0.666, 0.294, 0.42, 0.494, -0.87,
  0.3, 0.4, -0.022, -1, 0.293, 0.374, -0.316, -0.949, 0.28, 0.34, -0.407, -0.913, 0.26, 0.3, -0.425, -0.905,
  0.241, 0.257, -0.287, -0.958, 0.23, 0.2, -0.006, -1, 0.24, 0.09, 0.33, -0.944, 0.3, 0, 0.555, -0.832,
  // p 0.45, the lip thrown out over the face
  -1.6, 0, 0.986, 0.165, -1.337, 0.044, 0.986, 0.167, -1.074, 0.089, 0.981, 0.194, -0.8, 0.15, 0.943, 0.334,
  -0.461, 0.306, 0.884, 0.468, -0.11, 0.515, 0.873, 0.488, 0.1, 0.62, 0.939, 0.344, 0.174, 0.619, 0.999, -0.032,
  0.226, 0.616, 0.997, -0.077, 0.265, 0.612, 0.993, -0.121, 0.3, 0.607, 0.987, -0.158, 0.34, 0.6, 0.979, -0.202,
  0.392, 0.588, 0.955, -0.295, 0.45, 0.566, 0.911, -0.411, 0.505, 0.537, 0.835, -0.551, 0.544, 0.504, 0.634, -0.773,
  0.56, 0.47, -0.166, -0.986, 0.531, 0.427, -0.707, -0.707, 0.47, 0.38, -0.866, -0.499, 0.38, 0.34, -0.951, -0.31,
  0.246, 0.307, -0.949, -0.316, 0.14, 0.26, -0.588, -0.809, 0.11, 0.12, 0.152, -0.988, 0.18, 0, 0.504, -0.864,
  // p 0.6, the full throw: the tube 2.55 times longer than wide
  -1.6, 0, 0.984, 0.176, -1.337, 0.047, 0.984, 0.176, -1.075, 0.094, 0.979, 0.206, -0.8, 0.16, 0.935, 0.354,
  -0.463, 0.326, 0.871, 0.491, -0.112, 0.548, 0.868, 0.497, 0.12, 0.66, 0.954, 0.301, 0.23, 0.656, 0.997, -0.083,
  0.312, 0.644, 0.981, -0.194, 0.377, 0.627, 0.954, -0.3, 0.436, 0.605, 0.934, -0.357, 0.5, 0.58, 0.877, -0.481,
  0.58, 0.526, 0.755, -0.656, 0.668, 0.434, 0.661, -0.751, 0.749, 0.334, 0.615, -0.789, 0.809, 0.253, 0.589, -0.808,
  0.832, 0.22, -0.99, 0.139, 0.759, 0.26, -0.936, 0.353, 0.62, 0.3, -0.993, 0.115, 0.456, 0.295, -0.996, -0.093,
  0.225, 0.263, -0.97, -0.245, 0.08, 0.2, -0.642, -0.766, 0.08, 0.09, 0.287, -0.958, 0.14, 0, 0.555, -0.832,
  // p 0.73, the lip down on the water ahead, the tube closed
  -1.6, 0, 0.987, 0.158, -1.337, 0.042, 0.988, 0.156, -1.074, 0.083, 0.984, 0.18, -0.8, 0.14, 0.951, 0.309,
  -0.477, 0.277, 0.9, 0.436, -0.142, 0.459, 0.904, 0.428, 0.1, 0.55, 0.976, 0.22, 0.24, 0.545, 0.998, -0.068,
  0.349, 0.533, 0.987, -0.159, 0.439, 0.513, 0.968, -0.249, 0.524, 0.488, 0.96, -0.281, 0.62, 0.46, 0.921, -0.389,
  0.742, 0.396, 0.834, -0.551, 0.882, 0.287, 0.765, -0.644, 1.014, 0.167, 0.727, -0.686, 1.112, 0.07, 0.705, -0.71,
  1.15, 0.03, -0.962, -0.275, 1.091, 0.064, -0.876, 0.482, 0.95, 0.14, -0.909, 0.417, 0.62, 0.28, -0.99, 0.141,
  0.264, 0.238, -0.978, -0.21, 0.06, 0.16, -0.756, -0.655, 0.07, 0.07, 0.351, -0.936, 0.12, 0, 0.581, -0.814,
  // p 0.87, the curl collapsing
  -1.6, 0, 0.995, 0.101, -1.335, 0.027, 0.995, 0.102, -1.071, 0.054, 0.993, 0.117, -0.8, 0.09, 0.978, 0.207,
  -0.49, 0.177, 0.952, 0.306, -0.172, 0.292, 0.954, 0.3, 0.06, 0.35, 0.989, 0.149, 0.199, 0.348, 0.999, -0.036,
  0.307, 0.341, 0.996, -0.091, 0.397, 0.33, 0.99, -0.14, 0.484, 0.316, 0.987, -0.162, 0.58, 0.3, 0.969, -0.247,
  0.704, 0.26, 0.923, -0.385, 0.846, 0.189, 0.879, -0.476, 0.981, 0.11, 0.854, -0.52, 1.081, 0.046, 0.839, -0.544,
  1.12, 0.02, -0.962, -0.275, 1.06, 0.04, -0.958, 0.287, 0.92, 0.08, -0.977, 0.212, 0.6, 0.14, -0.998, 0.062,
  0.29, 0.119, -0.992, -0.124, 0.12, 0.08, -0.885, -0.465, 0.13, 0.035, 0.53, -0.848, 0.17, 0, 0.753, -0.659,
  // p 1, collapsed into the burst
  -1.6, 0, 1, 0.03, -1.337, 0.008, 1, 0.029, -1.074, 0.015, 0.999, 0.032, -0.8, 0.025, 0.999, 0.053,
  -0.471, 0.047, 0.997, 0.076, -0.13, 0.076, 0.997, 0.075, 0.1, 0.09, 0.999, 0.038, 0.214, 0.089, 1, -0.02,
  0.298, 0.086, 0.999, -0.053, 0.365, 0.081, 0.996, -0.084, 0.428, 0.075, 0.997, -0.081, 0.5, 0.07, 0.997, -0.079,
  0.593, 0.062, 0.996, -0.091, 0.698, 0.052, 0.995, -0.097, 0.798, 0.042, 0.994, -0.109, 0.871, 0.033, 0.993, -0.117,
  0.9, 0.03, -0.989, -0.148, 0.851, 0.03, -1, 0, 0.75, 0.03, -1, 0.02, 0.6, 0.035, -1, 0.007,
  0.444, 0.032, -0.999, -0.036, 0.32, 0.025, -0.994, -0.108, 0.26, 0.012, -0.979, -0.204, 0.2, 0, -0.981, -0.196,
];

/** The baked cross-section as an RGBA32F texture's data: LIP_PROFILE_VERTS wide, LIP_KEYFRAMES high, row k the keyframe. */
export function lipProfile(): Float32Array {
  return Float32Array.from(LIP_PROFILE);
}

/** The profile's point (across, up) at progress p and vertex v (0 to 23), between the two keyframes about p: what the strip's vertex stage reads. */
export function profileAt(profile: Float32Array, p: number, v: number, out: { across: number; up: number }): void {
  const k = lipKey(p);
  const k0 = Math.min(Math.floor(k), LIP_KEYFRAMES - 2);
  const f = k - k0;
  const a = (k0 * LIP_PROFILE_VERTS + v) * 4;
  const b = a + LIP_PROFILE_VERTS * 4;
  out.across = (profile[a] as number) + ((profile[b] as number) - (profile[a] as number)) * f;
  out.up = (profile[a + 1] as number) + ((profile[b + 1] as number) - (profile[a + 1] as number)) * f;
}

/** What the strip reads: LIP_SLOTS rows of LIP_COLUMNS texels, (crest d, progress, height, share); a free slot all zeros. */
export type LipState = { data: Float32Array };

/**
 * The crests on the cove's face, a column at a time, and the plunges they
 * make. Every LIP_PROBE_M columns it watches LIP_FACE_POINTS points up the
 * face, from the toe to the still waterline. Each point's swell is split once,
 * at construction, into what does not change with time: each component's
 * amplitude and phase there (`swellAtInto` under zero phases), the depth and
 * Weggel's coefficients. Each update then sums every point's envelope from
 * the frame's phases by angle addition, a sine and cosine a component for
 * the whole face, and takes the break from it (`swellBreakInto`): the same
 * envelope, crest phase and ratio `swellAtInto` gives there.
 *
 * The crest phase, unwrapped up the face from the toe, along the shore from
 * probe to probe and through time at the first probe, numbers the crests:
 * crest n stands where the phase has turned n whole times, found between the
 * two points it lies between, with its ratio, so its progress, and its
 * unbroken height read between them too. Slot n mod 2 holds crest n, so the
 * two slots never hold one crest and a crest keeps its slot along the whole
 * face. A crest already broken when first seen at the toe (D1) is a bore and
 * gets no lip. The columns between probes take a crest's place, progress and
 * height between the two probes that both see it. A slot is filled while its
 * crest's progress is in (0, 1) and the share is above 0, and freed once the
 * progress reaches 1. A plunge is a crest whose progress, the most over a
 * stretch's probes, reaches LIP_COLLAPSE this update from below, across a
 * step of no more than LIP_STEP_MAX_S (a longer step, or a clock run back,
 * reports none).
 *
 * The unwrapping and which crests were bores are the only state carried from
 * one update to the next. Nothing is made after construction.
 */
export class LipTracker {
  readonly state: LipState;
  readonly plunges: { count: number; d: Float32Array; z: Float32Array; height: Float32Array };
  private readonly field: OceanField;
  private readonly cove: SwashCove;
  /** The face's Iribarren number, the swell's for the whole world. */
  private readonly iribarren: number;
  /** The first and last column the cove's width and its end blends reach. */
  private readonly first: number;
  private readonly last: number;
  private readonly probes: number;
  private readonly stretches: number;
  /** Each probe's z. */
  private readonly probeZ: Float64Array;
  /** The cove's weight at each column and at each probe (the coast row's), which fades the share over the cove's ends. */
  private readonly columnWeight: Float64Array;
  private readonly probeWeight: Float64Array;
  /** Each point's time-invariant part, a point every LIP_FACE_POINTS a probe: each component's amplitude times
   * the cosine and the sine of its phase, and the depth and Weggel's coefficients. */
  private readonly pointRe: Float64Array;
  private readonly pointIm: Float64Array;
  private readonly pointDepth: Float64Array;
  private readonly pointA: Float64Array;
  private readonly pointB: Float64Array;
  /** The frame's phases' cosines and sines, and one probe's face as the update reads it: each point's crest
   * phase unwrapped (turns), ratio and unbroken height. */
  private readonly cosTheta: Float64Array;
  private readonly sinTheta: Float64Array;
  private readonly faceTurns: Float64Array;
  private readonly faceRatio: Float64Array;
  private readonly faceUnbroken: Float64Array;
  private readonly brk = { ratio: 0, scale: 1 };
  /** The face's profile from the toe a texel of the atlas apart, the bay's and the cove's, (depth, Weggel's a, b)
   * each: a column's is the two blended by its cove weight, as the swell's sum blends them. */
  private readonly profilePoints: number;
  private readonly faceBay: Float64Array;
  private readonly faceCove: Float64Array;
  /** One column's two slots as they are worked out: (d, progress, height, share, whether both probes saw the crest) each. */
  private readonly slotScratch = new Float64Array(10);
  /** Each probe's crest of each parity: its number (NaN for none on the face), d, progress, height, and whether it was a bore at the toe. */
  private readonly crestN: Float64Array;
  private readonly crestD: Float64Array;
  private readonly crestP: Float64Array;
  private readonly crestH: Float64Array;
  private readonly crestBore: Uint8Array;
  /** Each stretch's crest of each parity at the last update: its number and its progress. */
  private readonly lastN: Float64Array;
  private readonly lastP: Float64Array;
  /** The toe's crest phase at the first probe (turns, wrapped) at the last update, and the whole turns added to it since. */
  private lastToe = Number.NaN;
  private wraps = 0;
  /** The shared seconds of the last update, NaN before the first and after a time that was not finite. */
  private lastSeconds = Number.NaN;

  constructor(field: OceanField, cove: SwashCove) {
    this.field = field;
    this.cove = cove;
    this.iribarren = faceIribarren(field.hs, field.tp, cove.faceGrade);
    const half = LIP_COLUMNS / 2;
    const reach = cove.halfWidth + COVE_END_BLEND;
    this.first = Math.max(0, Math.ceil(half - reach));
    this.last = Math.min(LIP_COLUMNS - 1, Math.floor(half + reach));
    this.probes = Math.max(2, Math.ceil((this.last - this.first) / LIP_PROBE_M) + 1);
    this.stretches = Math.ceil(this.probes / (LIP_STRETCH_M / LIP_PROBE_M));
    this.probeZ = new Float64Array(this.probes);
    this.probeWeight = new Float64Array(this.probes);
    this.columnWeight = new Float64Array(LIP_COLUMNS);
    for (let i = this.first; i <= this.last; i++) this.columnWeight[i] = coastRead(field.tables, cove.z0 - half + i)[2];
    const n = field.count;
    const points = this.probes * LIP_FACE_POINTS;
    this.pointRe = new Float64Array(points * n);
    this.pointIm = new Float64Array(points * n);
    this.pointDepth = new Float64Array(points);
    this.pointA = new Float64Array(points);
    this.pointB = new Float64Array(points);
    const scratch = swellScratch(field);
    const still = new Float32Array(Math.max(n, 12));
    const step = -cove.toeD / (LIP_FACE_POINTS - 1);
    for (let j = 0; j < this.probes; j++) {
      const z = cove.z0 - half + this.first + j * LIP_PROBE_M;
      const coast = coastRead(field.tables, z);
      this.probeZ[j] = z;
      this.probeWeight[j] = coast[2];
      for (let i = 0; i < LIP_FACE_POINTS; i++) {
        const at = j * LIP_FACE_POINTS + i;
        const s = swellAtInto(field, still, coast[0] + cove.toeD + i * step, z, scratch);
        this.pointDepth[at] = s.depth;
        this.pointA[at] = scratch.weggelA;
        this.pointB[at] = scratch.weggelB;
        for (let c = 0; c < n; c++) {
          const amp = scratch.amp[c] as number;
          const phase = scratch.phase[c] as number;
          this.pointRe[at * n + c] = amp * Math.cos(phase);
          this.pointIm[at * n + c] = amp * Math.sin(phase);
        }
      }
    }
    this.profilePoints = Math.max(2, Math.ceil(-cove.toeD / OCEAN_D_STEP) + 1);
    this.faceBay = new Float64Array(this.profilePoints * 3);
    this.faceCove = new Float64Array(this.profilePoints * 3);
    for (let i = 0; i < this.profilePoints; i++) {
      const column = (cove.toeD + i * OCEAN_D_STEP - OCEAN_D_MIN) / OCEAN_D_STEP;
      const bay = atlasRead(field.tables, OCEAN_ROW_BAY_PROFILE, column);
      const own = atlasRead(field.tables, OCEAN_ROW_COVE_PROFILE, column);
      for (let k = 0; k < 3; k++) {
        this.faceBay[i * 3 + k] = bay[k] as number;
        this.faceCove[i * 3 + k] = own[k] as number;
      }
    }
    this.cosTheta = new Float64Array(n);
    this.sinTheta = new Float64Array(n);
    this.faceTurns = new Float64Array(LIP_FACE_POINTS);
    this.faceRatio = new Float64Array(LIP_FACE_POINTS);
    this.faceUnbroken = new Float64Array(LIP_FACE_POINTS);
    this.crestN = new Float64Array(this.probes * 2).fill(Number.NaN);
    this.crestD = new Float64Array(this.probes * 2);
    this.crestP = new Float64Array(this.probes * 2);
    this.crestH = new Float64Array(this.probes * 2);
    this.crestBore = new Uint8Array(this.probes * 2);
    this.lastN = new Float64Array(this.stretches * 2).fill(Number.NaN);
    this.lastP = new Float64Array(this.stretches * 2);
    this.state = { data: new Float32Array(LIP_COLUMNS * LIP_SLOTS * 4) };
    this.plunges = {
      count: 0, d: new Float32Array(LIP_PLUNGES), z: new Float32Array(LIP_PLUNGES), height: new Float32Array(LIP_PLUNGES),
    };
  }

  /**
   * Advance to the shared seconds and the frame's phases (`swellPhases` at
   * them), under the wind's onshore weight (0 to 1): refills the state and the
   * plunges in place. A time or a weight that is not finite frees every slot,
   * forgets every crest and reports no plunge.
   */
  update(seconds: number, phases: Float32Array, onshoreWeight: number): void {
    this.plunges.count = 0;
    if (!Number.isFinite(seconds) || !Number.isFinite(onshoreWeight)) {
      this.state.data.fill(0);
      this.crestN.fill(Number.NaN);
      this.lastN.fill(Number.NaN);
      this.lastToe = Number.NaN;
      this.lastSeconds = Number.NaN;
      return;
    }
    const step = seconds - this.lastSeconds;
    const watch = step >= 0 && step <= LIP_STEP_MAX_S;
    this.lastSeconds = seconds;
    const share = plungeShare(this.iribarren, onshoreWeight);
    for (let c = 0; c < this.field.count; c++) {
      const theta = phases[c] as number;
      this.cosTheta[c] = Math.cos(theta);
      this.sinTheta[c] = Math.sin(theta);
    }
    for (let j = 0; j < this.probes; j++) this.watch(j);
    this.fill(share);
    this.listen(share, watch);
  }

  /** One probe's face: each point's envelope from the frame's phases, the crest phase unwrapped up it, and the crests that stand on it. */
  private watch(j: number): void {
    const n = this.field.count;
    const tp = this.field.tp;
    const toe = this.cove.toeD;
    const step = -toe / (LIP_FACE_POINTS - 1);
    let raw = 0;
    for (let i = 0; i < LIP_FACE_POINTS; i++) {
      const at = j * LIP_FACE_POINTS + i;
      let re = 0;
      let im = 0;
      for (let c = 0; c < n; c++) {
        const a = this.pointRe[at * n + c] as number;
        const b = this.pointIm[at * n + c] as number;
        const cos = this.cosTheta[c] as number;
        const sin = this.sinTheta[c] as number;
        re += a * cos - b * sin;
        im += a * sin + b * cos;
      }
      const unbroken = 2 * Math.hypot(re, im);
      swellBreakInto(unbroken, this.pointDepth[at] as number, this.pointA[at] as number, this.pointB[at] as number, tp, this.brk);
      this.faceRatio[i] = this.brk.ratio;
      this.faceUnbroken[i] = unbroken;
      const turn = Math.atan2(im, re) / TWO_PI;
      if (i === 0) {
        let turns: number;
        if (j === 0) {
          // Through time: the phase at a point falls as the crests pass, a
          // whole turn a period, and wraps from −½ to +½ as one does.
          if (Number.isFinite(this.lastToe)) {
            const change = turn - this.lastToe;
            if (change > 0.5) this.wraps -= 1;
            else if (change < -0.5) this.wraps += 1;
          }
          this.lastToe = turn;
          turns = turn + this.wraps;
        } else {
          // Along the shore: the turn nearest the last probe's toe, the
          // crests running nearly along the shore.
          const prev = this.faceTurns[0] as number;
          turns = turn + Math.round(prev - turn);
        }
        this.faceTurns[0] = turns;
      } else {
        // Up the face: the phase grows shoreward by under a turn a metre.
        let change = turn - raw;
        change -= Math.round(change);
        this.faceTurns[i] = (this.faceTurns[i - 1] as number) + change;
      }
      raw = turn;
    }
    // The crests between each two points, at most one of each parity kept: the one in mid-plunge, the furthest on.
    const keptAt = j * 2;
    const hadN0 = this.crestN[keptAt] as number;
    const hadN1 = this.crestN[keptAt + 1] as number;
    const hadBore0 = this.crestBore[keptAt] as number;
    const hadBore1 = this.crestBore[keptAt + 1] as number;
    this.crestN[keptAt] = Number.NaN;
    this.crestN[keptAt + 1] = Number.NaN;
    for (let i = 0; i < LIP_FACE_POINTS - 1; i++) {
      const lo = this.faceTurns[i] as number;
      const hi = this.faceTurns[i + 1] as number;
      if (!(hi > lo)) continue;
      for (let crest = Math.ceil(lo); crest < hi; crest++) {
        const f = (crest - lo) / (hi - lo);
        const d = toe + (i + f) * step;
        const ratio = (this.faceRatio[i] as number) + ((this.faceRatio[i + 1] as number) - (this.faceRatio[i] as number)) * f;
        const height = (this.faceUnbroken[i] as number) + ((this.faceUnbroken[i + 1] as number) - (this.faceUnbroken[i] as number)) * f;
        const p = progressOf(ratio);
        const parity = crest & 1;
        const at = keptAt + parity;
        const kept = this.crestN[at] as number;
        if (!Number.isNaN(kept)) {
          const keptLive = (this.crestP[at] as number) > 0 && (this.crestP[at] as number) < 1;
          const live = p > 0 && p < 1;
          if (keptLive && !live) continue;
          if (keptLive === live && p <= (this.crestP[at] as number)) continue;
        }
        // A crest seen before keeps its verdict; a new one at the toe is judged there.
        const had = parity === 0 ? hadN0 : hadN1;
        const hadBore = parity === 0 ? hadBore0 : hadBore1;
        this.crestN[at] = crest;
        this.crestD[at] = d;
        this.crestP[at] = p;
        this.crestH[at] = height;
        this.crestBore[at] = had === crest ? hadBore : d - toe <= LIP_ENTRY_M && ratio > 1 ? 1 : 0;
      }
    }
  }

  /** Each column's two slots from the probes either side. */
  private fill(share: number): void {
    const data = this.state.data;
    const toe = this.cove.toeD;
    const slot = this.slotScratch;
    for (let i = this.first; i <= this.last; i++) {
      const t = (i - this.first) / LIP_PROBE_M;
      const j = Math.min(Math.floor(t), this.probes - 2);
      const w = t - j;
      const columnShare = share * (this.columnWeight[i] as number);
      for (let parity = 0; parity < 2; parity++) {
        const a = j * 2 + parity;
        const b = a + 2;
        const na = this.crestN[a] as number;
        const nb = this.crestN[b] as number;
        const hasA = !Number.isNaN(na);
        const hasB = !Number.isNaN(nb);
        let d = 0;
        let p = 0;
        let h = 0;
        let bore = true;
        let matched = 0;
        if (hasA && hasB && na === nb) {
          d = (this.crestD[a] as number) + ((this.crestD[b] as number) - (this.crestD[a] as number)) * w;
          h = (this.crestH[a] as number) + ((this.crestH[b] as number) - (this.crestH[a] as number)) * w;
          p = this.progressAt(i, d, h);
          bore = this.crestBore[a] === 1 || this.crestBore[b] === 1;
          matched = 1;
        } else if (hasA || hasB) {
          // Two crests, or one seen from one side: the nearer probe's.
          const at = hasA && (w < 0.5 || !hasB) ? a : b;
          d = this.crestD[at] as number;
          h = this.crestH[at] as number;
          p = this.progressAt(i, d, h);
          bore = this.crestBore[at] === 1;
        }
        const live = !bore && d >= toe && d <= 0 && p > 0 && p < 1 && h > 0 && columnShare > 0;
        const o = parity * 5;
        slot[o] = live ? d : 0;
        slot[o + 1] = live ? p : 0;
        slot[o + 2] = live ? h : 0;
        slot[o + 3] = live ? columnShare : 0;
        slot[o + 4] = matched;
      }
      // Two live crests closer than any two the swell makes are one crest
      // numbered apart by the probes either side, where the envelope's phase
      // slips at a node of the sets: the one the two probes agree on stays,
      // else the one further on.
      if ((slot[1] as number) > 0 && (slot[6] as number) > 0 && Math.abs((slot[0] as number) - (slot[5] as number)) < LIP_APART_M) {
        const keepFirst = slot[4] !== slot[9] ? (slot[4] as number) > (slot[9] as number) : (slot[1] as number) >= (slot[6] as number);
        slot.fill(0, keepFirst ? 5 : 0, keepFirst ? 9 : 4);
      }
      for (let parity = 0; parity < 2; parity++) {
        const o = (parity * LIP_COLUMNS + i) * 4;
        for (let k = 0; k < 4; k++) data[o + k] = slot[parity * 5 + k] as number;
      }
    }
  }

  /** A crest's progress at d in column i from its unbroken height: the break on the column's own depth and
   * Weggel's coefficients there, the face's profiles blended by the column's cove weight. */
  private progressAt(i: number, d: number, unbroken: number): number {
    const last = this.profilePoints - 1;
    const f = Math.min(Math.max((d - this.cove.toeD) / OCEAN_D_STEP, 0), last);
    const i0 = Math.min(Math.floor(f), last - 1);
    const t = f - i0;
    const wc = this.columnWeight[i] as number;
    const bay = this.faceBay;
    const own = this.faceCove;
    const o = i0 * 3;
    const bayH = (bay[o] as number) + ((bay[o + 3] as number) - (bay[o] as number)) * t;
    const bayA = (bay[o + 1] as number) + ((bay[o + 4] as number) - (bay[o + 1] as number)) * t;
    const bayB = (bay[o + 2] as number) + ((bay[o + 5] as number) - (bay[o + 2] as number)) * t;
    const coveH = (own[o] as number) + ((own[o + 3] as number) - (own[o] as number)) * t;
    const coveA = (own[o + 1] as number) + ((own[o + 4] as number) - (own[o + 1] as number)) * t;
    const coveB = (own[o + 2] as number) + ((own[o + 5] as number) - (own[o + 2] as number)) * t;
    swellBreakInto(unbroken, bayH + (coveH - bayH) * wc, bayA + (coveA - bayA) * wc, bayB + (coveB - bayB) * wc, this.field.tp, this.brk);
    return progressOf(this.brk.ratio);
  }

  /** The plunges: each stretch's crest of each parity whose progress reached the collapse this update, none across a step `watch` rules out. */
  private listen(share: number, watch: boolean): void {
    const per = LIP_STRETCH_M / LIP_PROBE_M;
    for (let s = 0; s < this.stretches; s++) {
      for (let parity = 0; parity < 2; parity++) {
        let best = -1;
        for (let j = s * per; j < Math.min((s + 1) * per, this.probes); j++) {
          const at = j * 2 + parity;
          if (Number.isNaN(this.crestN[at] as number) || this.crestBore[at] === 1) continue;
          if (share * (this.probeWeight[j] as number) <= 0) continue;
          if (best < 0 || (this.crestP[at] as number) > (this.crestP[best] as number)) best = at;
        }
        const slot = s * 2 + parity;
        if (best < 0) {
          this.lastN[slot] = Number.NaN;
          this.lastP[slot] = 0;
          continue;
        }
        const crest = this.crestN[best] as number;
        const p = this.crestP[best] as number;
        const plunged = watch && this.lastN[slot] === crest && (this.lastP[slot] as number) < LIP_COLLAPSE && p >= LIP_COLLAPSE;
        if (plunged && this.plunges.count < LIP_PLUNGES) {
          const e = this.plunges.count++;
          this.plunges.d[e] = this.crestD[best] as number;
          this.plunges.z[e] = this.probeZ[(best - parity) / 2] as number;
          this.plunges.height[e] = this.crestH[best] as number;
        }
        this.lastN[slot] = crest;
        this.lastP[slot] = p;
      }
    }
  }
}
