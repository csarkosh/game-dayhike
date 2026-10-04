/**
 * The sky's slices as they arrive, and the sky at any sun altitude blended
 * from them. Slices are made off the main thread (`skyWorker.ts`) in the order
 * the start hour needs them, so the table fills over the first second or two
 * of a page; `has` and `whenReady` say when an altitude can be drawn as it
 * should be, and `blendAt` draws it from whatever is held meanwhile.
 *
 * Pure and Babylon-free: the worker imports `sliceOrder` from here.
 */
import { sunPositionAt } from "./sky.js";
import {
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  buildSkyTables,
  buildSlice,
  type SkySlice,
} from "./skyModel.js";
import type { Rgb } from "./colour.js";

export type SkyTable = {
  /** Holds a slice, replacing one of the same altitude. Throws on a slice of the wrong size or altitude. */
  add(slice: SkySlice): void;
  readonly count: number;
  /** True when the slices at or bracketing altitudeDeg are held (an exact altitude needs one). */
  has(altitudeDeg: number): boolean;
  /** The slice at altitudeDeg, blended linearly (texels, ring, zenith, skyIrradiance, sun) between
   *  the held slices nearest below and above; outside them, a copy of the nearest held slice.
   *  Throws when empty. Never returns a slice object held in the table (callers may keep it). */
  blendAt(altitudeDeg: number): SkySlice;
  whenReady(altitudeDeg: number): Promise<void>;
  /** Called after every add. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
};

/** The noon altitude on the sun's arc, degrees: asin(sunPositionAt(12).y) in degrees (75.96...). */
export const NOON_ALTITUDE_DEG: number = (Math.asin(sunPositionAt(12).y) * 180) / Math.PI;

const TEXEL_COUNT = SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3;
const RING_COUNT = SLICE_AZIMUTHS * 3;
const LAST = SLICE_ALTITUDES_DEG.length - 1;

/**
 * The indices into SLICE_ALTITUDES_DEG of the slices that bracket an
 * altitude: one when it is a slice altitude exactly, or lies beyond either end
 * (the nearest end's), else the two either side, lower first.
 */
export function sliceBracket(altitudeDeg: number): number[] {
  if (!(altitudeDeg > (SLICE_ALTITUDES_DEG[0] as number))) return [0];
  if (!(altitudeDeg < (SLICE_ALTITUDES_DEG[LAST] as number))) return [LAST];
  let upper = 1;
  while ((SLICE_ALTITUDES_DEG[upper] as number) < altitudeDeg) upper++;
  return SLICE_ALTITUDES_DEG[upper] === altitudeDeg ? [upper] : [upper - 1, upper];
}

/** Indices into SLICE_ALTITUDES_DEG in the order to make them: the two bracketing
 *  NOON_ALTITUDE_DEG (lower, upper), then the two bracketing startDeg (lower, upper; skipping any
 *  already listed), then the rest alternately outward from startDeg, below first. Every index once. */
export function sliceOrder(startDeg: number): number[] {
  const order: number[] = [];
  const listed = new Set<number>();
  const list = (index: number): void => {
    if (listed.has(index)) return;
    listed.add(index);
    order.push(index);
  };
  for (const index of sliceBracket(NOON_ALTITUDE_DEG)) list(index);
  const start = sliceBracket(startDeg);
  for (const index of start) list(index);
  let below = (start[0] as number) - 1;
  let above = (start[start.length - 1] as number) + 1;
  while (below >= 0 || above <= LAST) {
    if (below >= 0) list(below--);
    if (above <= LAST) list(above++);
  }
  return order;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function lerpArray(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = (a[k] as number) + ((b[k] as number) - (a[k] as number)) * t;
  return out;
}

/** A copy of a held slice, at the altitude asked for: nothing in it is shared with the table. */
function copyAt(s: SkySlice, altitudeDeg: number): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(s.texels),
    ring: new Float32Array(s.ring),
    zenith: { ...s.zenith },
    skyIrradiance: { ...s.skyIrradiance },
    sun: { ...s.sun },
  };
}

export function createSkyTable(): SkyTable {
  /** Held slices, ascending by altitude. */
  const slices: SkySlice[] = [];
  const listeners = new Set<() => void>();
  let waiting: { altitudeDeg: number; resolve: () => void }[] = [];

  function holds(altitudeDeg: number): boolean {
    return slices.some((s) => s.altitudeDeg === altitudeDeg);
  }

  function has(altitudeDeg: number): boolean {
    if (holds(altitudeDeg)) return true;
    return sliceBracket(altitudeDeg).every((index) => holds(SLICE_ALTITUDES_DEG[index] as number));
  }

  return {
    add(slice) {
      if (!Number.isFinite(slice.altitudeDeg) || slice.texels.length !== TEXEL_COUNT || slice.ring.length !== RING_COUNT) {
        throw new Error(`a sky slice must have a finite altitude, ${TEXEL_COUNT} texels and a ring of ${RING_COUNT}; got ${slice.altitudeDeg}, ${slice.texels.length}, ${slice.ring.length}`);
      }
      const at = slices.findIndex((s) => s.altitudeDeg >= slice.altitudeDeg);
      if (at === -1) slices.push(slice);
      else if ((slices[at] as SkySlice).altitudeDeg === slice.altitudeDeg) slices[at] = slice;
      else slices.splice(at, 0, slice);
      const ready = waiting.filter((w) => has(w.altitudeDeg));
      waiting = waiting.filter((w) => !has(w.altitudeDeg));
      for (const w of ready) w.resolve();
      // A snapshot, so a listener may unsubscribe itself, or another, as it runs.
      for (const listener of [...listeners]) listener();
    },
    get count() {
      return slices.length;
    },
    has,
    blendAt(altitudeDeg) {
      const first = slices[0];
      const last = slices[slices.length - 1];
      if (first === undefined || last === undefined) throw new Error("the sky table holds no slice yet");
      if (!(altitudeDeg > first.altitudeDeg)) return copyAt(first, altitudeDeg);
      if (!(altitudeDeg < last.altitudeDeg)) return copyAt(last, altitudeDeg);
      const upperIndex = slices.findIndex((s) => s.altitudeDeg >= altitudeDeg);
      const upper = slices[upperIndex] as SkySlice;
      if (upper.altitudeDeg === altitudeDeg) return copyAt(upper, altitudeDeg);
      const lower = slices[upperIndex - 1] as SkySlice;
      const t = (altitudeDeg - lower.altitudeDeg) / (upper.altitudeDeg - lower.altitudeDeg);
      return {
        altitudeDeg,
        texels: lerpArray(lower.texels, upper.texels, t),
        ring: lerpArray(lower.ring, upper.ring, t),
        zenith: lerpRgb(lower.zenith, upper.zenith, t),
        skyIrradiance: lerpRgb(lower.skyIrradiance, upper.skyIrradiance, t),
        sun: lerpRgb(lower.sun, upper.sun, t),
      };
    },
    whenReady(altitudeDeg) {
      if (has(altitudeDeg)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiting.push({ altitudeDeg, resolve });
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Builds the tables and the given altitudes (default: all) in this thread. Tests, and pages without Worker. */
export function buildSkyTableSync(altitudesDeg: readonly number[] = SLICE_ALTITUDES_DEG): SkyTable {
  const tables = buildSkyTables();
  const table = createSkyTable();
  for (const altitudeDeg of altitudesDeg) table.add(buildSlice(tables, altitudeDeg));
  return table;
}
