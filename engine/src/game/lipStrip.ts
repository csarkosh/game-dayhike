/**
 * The plunging lip's strip as it is drawn, with no engine (the sea's edge,
 * spec §4.3): two static strips of columns across the cove's width and its
 * end blends, a metre apart near the camera and two metres beyond
 * LIP_RANGE_M, each column LIP_SLOTS cross-sections of LIP_PROFILE_VERTS
 * vertices. A vertex's position is not a place: it carries the column's
 * world z, the slot and the section's vertex, and the vertex stage places it
 * from the slot's crest (the tracker's state, `oceanBreaker.ts`), the baked
 * profile and the sea's own surface there. Here: the strips' vertices and
 * triangles, the box that holds every place a vertex can take, which strip
 * a camera is handed, and the tracker's state as the strip reads it.
 * What draws the strip (`lite/lipMeshes.ts`) reads them here.
 */
import { COVE_END_BLEND } from "../sim/olympic.js";
import { LIP_COLUMNS, LIP_PROFILE_VERTS, LIP_RANGE_M, LIP_SLOTS } from "./oceanBreaker.js";
import type { SwashCove } from "./swashTable.js";
import { OCEAN_BOUND } from "./water.js";

/** The strip's column spacing (m) within LIP_RANGE_M of the camera, and beyond it. */
export const LIP_FINE_M = 1;
export const LIP_COARSE_M = 2;

/** The columns the strip covers, every `step` of them: the cove's width and its end blends, as the tracker's. */
export function lipColumns(cove: SwashCove, step: number): number[] {
  const half = LIP_COLUMNS / 2;
  const reach = cove.halfWidth + COVE_END_BLEND;
  const first = Math.max(0, Math.ceil(half - reach));
  const last = Math.min(LIP_COLUMNS - 1, Math.floor(half + reach));
  const columns: number[] = [];
  for (let i = first; i <= last; i += step) columns.push(i);
  return columns;
}

/** The strip's vertices, (column z, slot, vertex) each, a slot's sections joined column to column in quads. */
export function lipStripGeometry(cove: SwashCove, step: number): { positions: Float32Array; indices: Uint16Array } {
  const columns = lipColumns(cove, step);
  const count = columns.length;
  const positions = new Float32Array(count * LIP_SLOTS * LIP_PROFILE_VERTS * 3);
  const indices = new Uint16Array((count - 1) * LIP_SLOTS * (LIP_PROFILE_VERTS - 1) * 6);
  const vertex = (c: number, slot: number, v: number): number => (slot * count + c) * LIP_PROFILE_VERTS + v;
  let k = 0;
  for (let slot = 0; slot < LIP_SLOTS; slot++) {
    for (let c = 0; c < count; c++) {
      const z = cove.z0 - LIP_COLUMNS / 2 + (columns[c] as number);
      for (let v = 0; v < LIP_PROFILE_VERTS; v++) {
        const o = vertex(c, slot, v) * 3;
        positions[o] = z;
        positions[o + 1] = slot;
        positions[o + 2] = v;
      }
      if (c === count - 1) continue;
      for (let v = 0; v < LIP_PROFILE_VERTS - 1; v++) {
        const a = vertex(c, slot, v);
        const b = vertex(c + 1, slot, v);
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = a + 1;
        indices[k++] = b;
        indices[k++] = b + 1;
        indices[k++] = a + 1;
      }
    }
  }
  return { positions, indices };
}

/** How far along the shore (columns) a free slot looks for a live one of the same slot to close the strip on. */
const LIP_CAP_COLUMNS = 2;

/** Whether the slot at offset o holds a crest in mid-plunge: progress in (0, 1) and a size. */
function slotLive(data: Float32Array, o: number): boolean {
  const p = data[o + 1] as number;
  return p > 0 && p < 1 && (data[o + 2] as number) * (data[o + 3] as number) > 0;
}

/**
 * What the strip is handed, `out`: the tracker's state, with each free slot
 * that has a live one of the same slot within LIP_CAP_COLUMNS columns moved
 * to the nearest such slot's crest d (the nearer side first, the lower
 * column on a tie) and given no size. A free slot's section is one point,
 * and the quad from a live column to it would otherwise run to that point
 * wherever the slot left it, the coastline for an empty one: with the point
 * at the live crest the strip closes there on the swell's surface, a short
 * end. Free slots with no live one near keep what they hold. Returns whether
 * any slot is live.
 */
export function closeFreeSlots(data: Float32Array, out: Float32Array): boolean {
  out.set(data);
  let any = false;
  for (let s = 0; s < LIP_SLOTS; s++) {
    const row = s * LIP_COLUMNS;
    for (let i = 0; i < LIP_COLUMNS; i++) {
      const o = (row + i) * 4;
      if (slotLive(data, o)) {
        any = true;
        continue;
      }
      for (let k = 1; k <= LIP_CAP_COLUMNS; k++) {
        const from = i - k >= 0 && slotLive(data, o - 4 * k) ? o - 4 * k : i + k < LIP_COLUMNS && slotLive(data, o + 4 * k) ? o + 4 * k : -1;
        if (from < 0) continue;
        out[o] = data[from] as number;
        out[o + 2] = 0;
        out[o + 3] = 0;
        break;
      }
    }
  }
  return any;
}

/** Where the strip can be: the box that holds every place a vertex can take, and the face's middle a column. */
export type LipReach = {
  /** The box's least and greatest corner. */
  min: [number, number, number];
  max: [number, number, number];
  /** The first and the last column's world z. */
  zFirst: number;
  zLast: number;
  /** The face's middle (world x) at each fine column. */
  faceX: Float64Array;
};

/**
 * The strip's reach over `cove` at the sea's `level`: the face from the toe
 * to the waterline, the section's reach about its crest and the sea's own
 * movement each way. The strip's positions are not places, so this box is
 * what a view is tested against.
 */
export function lipReach(cove: SwashCove, level: number): LipReach {
  const columns = lipColumns(cove, LIP_FINE_M);
  const zFirst = cove.z0 - LIP_COLUMNS / 2 + (columns[0] as number);
  const zLast = cove.z0 - LIP_COLUMNS / 2 + (columns[columns.length - 1] as number);
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  const faceX = new Float64Array(columns.length);
  columns.forEach((column, c) => {
    const x = cove.coastX(cove.z0 - LIP_COLUMNS / 2 + column);
    faceX[c] = x + cove.toeD / 2;
    xMin = Math.min(xMin, x + cove.toeD);
    xMax = Math.max(xMax, x);
  });
  const reach = 2 * OCEAN_BOUND;
  return {
    min: [xMin - reach, level - OCEAN_BOUND, zFirst - reach],
    max: [xMax + reach, level + reach, zLast + reach],
    zFirst,
    zLast,
    faceX,
  };
}

/** Whether a camera at (`camX`, `camZ`) is handed the fine strip: within LIP_RANGE_M of the face's middle at its nearest column. */
export function lipNear(reach: LipReach, camX: number, camZ: number): boolean {
  const c = Math.round(Math.min(Math.max(camZ - reach.zFirst, 0), reach.zLast - reach.zFirst));
  return Math.hypot(camX - (reach.faceX[c] as number), camZ - (reach.zFirst + c)) <= LIP_RANGE_M;
}
