/**
 * The surf as heard: one record a frame, refilled in place, that the audio
 * shell (`surfAudio.ts`) voices. What the sea does is decided elsewhere: the
 * breaker's tracker (`oceanBreaker.ts`) gives the plunges and each crest's
 * progress, the swash table (`swashTable.ts`) the fronts on the face and the
 * backwash; both are functions of the shared clock and the seed, so every
 * peer hears a thud on the same wave. Babylon-free (on BABYLON_FREE_FILES).
 *
 * - The set envelope: the share of the cove's columns that are surfing this
 *   frame, a column surfing when either of its tracker's slots holds a crest
 *   with progress in (0, 1] or its table column holds a front above 0, the
 *   cove's columns being those from `columnOf(z0 − halfWidth)` to
 *   `columnOf(z0 + halfWidth)`. The record keeps its running mean over
 *   `SURF_ENVELOPE_S`, the exponential one: each fill moves it toward this
 *   frame's share by `1 − exp(−dt / SURF_ENVELOPE_S)`, so a share held for
 *   `SURF_ENVELOPE_S` brings it 63 % of the way. A step of no time, or of a
 *   time that is not a number, leaves it.
 * - The nearest point: on the face's toe line, at the listener's z held to
 *   the cove's width, x = coastX(z) + toeD, y = the sea's level.
 * - Present: the listener within `SURF_RANGE_M` of that point. Absent, the
 *   record lists no events.
 * - Events: the tracker's plunges at x = coastX(z) + d on the level, and the
 *   nearest `SURF_EVENTS` of the table's backwash at the front's reach up the
 *   face from the toe, on the face where it stands above the level.
 *
 * Positions are in Babylon's left-handed frame; the shell mirrors z.
 */
import { LIP_COLUMNS, LIP_SLOTS, type LipTracker } from "./oceanBreaker.js";
import { SWASH_COLUMNS, SWASH_STRIDE, type SwashCove, type SwashTable } from "./swashTable.js";

/** The seconds the set envelope's running mean spans. */
export const SURF_ENVELOPE_S = 4;
/** The surf is heard to this distance (m) from the nearest point on the toe line. */
export const SURF_RANGE_M = 400;
/** Each event list's capacity. */
export const SURF_EVENTS = 32;

export type SurfSound = {
  /** False with no sea, no cove, or the listener beyond `SURF_RANGE_M` of the toe line. */
  present: boolean;
  /** The listener's nearest point on the face's toe line (Babylon's frame). */
  nearX: number; nearY: number; nearZ: number;
  /** The running mean, over `SURF_ENVELOPE_S`, of the share of the cove's columns surfing: 0 to 1. */
  envelope: number;
  /** The listener's signed coast distance (m): positive inland of the waterline. */
  inland: number;
  /** The listener's canopy cover, 0 to 1. */
  canopy: number;
  /** The swell's significant height (m). */
  hs: number;
  /** This frame's plunges, the first `count` valid. */
  plunges: { count: number; x: Float32Array; y: Float32Array; z: Float32Array; height: Float32Array };
  /** This frame's backwash nearest the listener, nearest first, the first `count` valid. */
  backwash: { count: number; x: Float32Array; y: Float32Array; z: Float32Array; reach: Float32Array };
};

function record(capacity: number): SurfSound {
  return {
    present: false, nearX: 0, nearY: 0, nearZ: 0, envelope: 0, inland: 0, canopy: 0, hs: 0,
    plunges: {
      count: 0, x: new Float32Array(capacity), y: new Float32Array(capacity), z: new Float32Array(capacity),
      height: new Float32Array(capacity),
    },
    backwash: {
      count: 0, x: new Float32Array(capacity), y: new Float32Array(capacity), z: new Float32Array(capacity),
      reach: new Float32Array(capacity),
    },
  };
}

/** A silent record with room for `SURF_EVENTS` of each event: made once, refilled by `fillSurfSound`. */
export function createSurfSound(): SurfSound {
  return record(SURF_EVENTS);
}

/**
 * What a world without the sea sounds like, and a frame that did not fill
 * the record: nothing. Frozen through; its event lists hold no room, as a
 * typed array with elements cannot be frozen.
 */
export const SILENT_SURF_SOUND: SurfSound = (() => {
  const silent = record(0);
  for (const list of [silent.plunges, silent.backwash]) {
    for (const held of Object.values(list)) if (typeof held === "object") Object.freeze(held);
    Object.freeze(list);
  }
  return Object.freeze(silent);
})();

/** The backwash kept so far this fill, by distance from the listener: nearest first. */
const backwashDist = new Float64Array(SURF_EVENTS);

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/**
 * Refills `out` from the tracker's plunges and progress, the table's fronts
 * and backwash, the listener (Babylon's frame) and the sea: the cove, its
 * level, the swell's height and the listener's canopy cover. `dt` is the
 * frame's seconds, for the envelope. Allocates nothing.
 */
export function fillSurfSound(
  out: SurfSound,
  listener: { x: number; y: number; z: number },
  tracker: Pick<LipTracker, "state" | "plunges">,
  table: Pick<SwashTable, "data" | "columnOf" | "backwash">,
  cove: SwashCove,
  level: number,
  hs: number,
  canopy: number,
  dt: number,
): void {
  // The share of the cove's columns surfing this frame.
  const c0 = table.columnOf(cove.z0 - cove.halfWidth);
  const c1 = table.columnOf(cove.z0 + cove.halfWidth);
  const lip = tracker.state.data;
  let surfing = 0;
  for (let c = c0; c <= c1; c++) {
    let on = table.data[c * SWASH_STRIDE]! > 0;
    for (let s = 0; s < LIP_SLOTS && !on; s++) {
      const p = lip[(s * LIP_COLUMNS + c) * 4 + 1]!;
      on = p > 0 && p <= 1;
    }
    if (on) surfing++;
  }
  const share = c1 >= c0 ? surfing / (c1 - c0 + 1) : 0;
  if (dt > 0 && Number.isFinite(dt)) out.envelope += (share - out.envelope) * (1 - Math.exp(-dt / SURF_ENVELOPE_S));

  // The nearest point on the toe line, and where the listener stands.
  const zNear = Math.min(cove.z0 + cove.halfWidth, Math.max(cove.z0 - cove.halfWidth, listener.z));
  out.nearX = cove.coastX(zNear) + cove.toeD;
  out.nearY = level;
  out.nearZ = zNear;
  out.inland = listener.x - cove.coastX(listener.z);
  out.canopy = clamp01(canopy);
  out.hs = hs > 0 && Number.isFinite(hs) ? hs : 0;
  // Written as "within" so a listener or a point that is not a number is absent.
  out.present = Math.hypot(listener.x - out.nearX, listener.y - out.nearY, listener.z - out.nearZ) <= SURF_RANGE_M;

  const plunges = out.plunges;
  const backwash = out.backwash;
  plunges.count = 0;
  backwash.count = 0;
  if (!out.present) return;

  const from = tracker.plunges;
  const n = Math.min(from.count, plunges.x.length);
  for (let i = 0; i < n; i++) {
    const z = from.z[i]!;
    plunges.x[i] = cove.coastX(z) + from.d[i]!;
    plunges.y[i] = level;
    plunges.z[i] = z;
    plunges.height[i] = from.height[i]!;
  }
  plunges.count = n;

  // The backwash nearest the listener, kept sorted by insertion.
  const cap = backwash.x.length;
  const events = table.backwash;
  let kept = 0;
  for (let i = 0; i < events.count; i++) {
    const reach = events.reach[i]!;
    const z = cove.z0 - SWASH_COLUMNS / 2 + events.column[i]!;
    const up = cove.toeD + reach;
    const x = cove.coastX(z) + up;
    const y = level + Math.max(0, up) * cove.faceGrade;
    const d = Math.hypot(listener.x - x, listener.y - y, listener.z - z);
    if (!(d < Infinity)) continue;
    if (kept === cap && d >= backwashDist[cap - 1]!) continue;
    let at = kept < cap ? kept : cap - 1;
    while (at > 0 && backwashDist[at - 1]! > d) {
      backwashDist[at] = backwashDist[at - 1]!;
      backwash.x[at] = backwash.x[at - 1]!;
      backwash.y[at] = backwash.y[at - 1]!;
      backwash.z[at] = backwash.z[at - 1]!;
      backwash.reach[at] = backwash.reach[at - 1]!;
      at--;
    }
    backwashDist[at] = d;
    backwash.x[at] = x;
    backwash.y[at] = y;
    backwash.z[at] = z;
    backwash.reach[at] = reach;
    if (kept < cap) kept++;
  }
  backwash.count = kept;
}
