/**
 * Seating a fallen log: where the trunk's underside is in the model, and the
 * pitch and height that lay that underside on the ground.
 *
 * `deadwood.snag` is a trunk with a root flare at one end and branch stubs
 * along it, and the trunk is not level in its own frame: its underside climbs
 * about 0.3 m from the flare to the tip. Its bounding box's lowest point is
 * the flare, 0.3 to 0.6 m below the trunk's underside over the rest of its
 * length, so a log seated by its box rests on the flare alone and the trunk
 * hangs in the air, by up to 1.5 m at full scale. A log is seated by its
 * trunk here: the underside is a line fitted through the model, robust to the
 * flare, and the ground a line fitted through the heights under it.
 *
 * Pure and Babylon-free; the trig is the renderer's (`game/` may use it).
 */

/** The trunk's underside in the model's frame, `y = a + b·x`, and its diameter (m). */
export type TrunkSeat = { a: number; b: number; diameter: number };

/** Stations along the trunk where the model's underside is measured. */
const SEAT_BINS = 8;
/** A station's underside is this quantile of its vertices' heights, not their
 * minimum: one stub hanging under the trunk does not move it. */
const SEAT_QUANTILE = 0.1;
/** Stations along the log where the ground is sampled (`logStationOffsets`). */
export const LOG_STATIONS = 5;
/** A fallen log has settled into the floor: its underside lies this share of
 * the trunk's diameter under the ground's line. */
export const LOG_SINK = 0.2;
/** Where the ground falls away under the log (a hollow it would bridge), the
 * log comes down with it, by at most this share of the trunk's diameter. */
export const LOG_DROP_MAX = 0.5;

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The underside line of a trunk lying along local X, from its vertex
 * positions (xyz triples): the low quantile of each station's heights, and
 * through those the Theil-Sen line (the median of the pairwise slopes), which
 * a root flare at one end does not tilt. The diameter is the median station's
 * smaller extent across the trunk.
 */
export function trunkSeat(positions: ArrayLike<number>): TrunkSeat {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const span = maxX - minX;
  if (!(span > 0)) return { a: 0, b: 0, diameter: 0 };
  const ys: number[][] = Array.from({ length: SEAT_BINS }, () => []);
  const zLo = new Array<number>(SEAT_BINS).fill(Infinity);
  const zHi = new Array<number>(SEAT_BINS).fill(-Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const bin = Math.min(SEAT_BINS - 1, Math.floor((((positions[i] as number) - minX) / span) * SEAT_BINS));
    (ys[bin] as number[]).push(positions[i + 1] as number);
    const z = positions[i + 2] as number;
    if (z < (zLo[bin] as number)) zLo[bin] = z;
    if (z > (zHi[bin] as number)) zHi[bin] = z;
  }
  const xs: number[] = [];
  const lows: number[] = [];
  const widths: number[] = [];
  for (let bin = 0; bin < SEAT_BINS; bin++) {
    const heights = ys[bin] as number[];
    if (heights.length === 0) continue;
    heights.sort((p, q) => p - q);
    xs.push(minX + ((bin + 0.5) / SEAT_BINS) * span);
    lows.push(heights[Math.floor((heights.length - 1) * SEAT_QUANTILE)] as number);
    widths.push(Math.min((heights[heights.length - 1] as number) - (heights[0] as number), (zHi[bin] as number) - (zLo[bin] as number)));
  }
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      slopes.push(((lows[j] as number) - (lows[i] as number)) / ((xs[j] as number) - (xs[i] as number)));
    }
  }
  const b = slopes.length === 0 ? 0 : median(slopes);
  const a = median(lows.map((y, i) => y - b * (xs[i] as number)));
  return { a, b, diameter: median(widths) };
}

/** The stations' places along the trunk, in the model's own X (m at scale 1), written into `out`. */
export function logStationOffsets(minX: number, maxX: number, out: number[]): void {
  for (let i = 0; i < LOG_STATIONS; i++) out[i] = minX + (i / (LOG_STATIONS - 1)) * (maxX - minX);
}

/**
 * The pitch (rad, local +X rising) and the origin's height that lay a log's
 * underside on the ground. `offsets` are the stations' places along the trunk
 * in the model's X, `heights` the ground under each, `scale` the instance's,
 * and `roll` its turn about its own axis (the cross-slope's), which shortens
 * the reach from the origin down to the underside.
 *
 * The ground's line is the least-squares one through the stations, so a log
 * follows the slope along its whole length and not its two ends alone. Where
 * a station's ground lies under that line the log would stand off it, so the
 * log comes down by the deepest such gap, up to `LOG_DROP_MAX` of its
 * diameter, and then by `LOG_SINK` of it: settled into the floor.
 */
export function seatLog(
  seat: TrunkSeat,
  offsets: readonly number[],
  heights: readonly number[],
  scale: number,
  roll: number,
): { pitch: number; y: number } {
  const n = offsets.length;
  let sx = 0;
  let sh = 0;
  for (let i = 0; i < n; i++) {
    sx += (offsets[i] as number) * scale;
    sh += heights[i] as number;
  }
  const mx = sx / n;
  const mh = sh / n;
  let sxx = 0;
  let sxh = 0;
  for (let i = 0; i < n; i++) {
    const dx = (offsets[i] as number) * scale - mx;
    sxx += dx * dx;
    sxh += dx * ((heights[i] as number) - mh);
  }
  const slope = sxx > 0 ? sxh / sxx : 0;
  // The ground's line at the origin (local x = 0).
  const atOrigin = mh - slope * mx;
  let gap = 0;
  for (let i = 0; i < n; i++) {
    const line = atOrigin + slope * (offsets[i] as number) * scale;
    gap = Math.max(gap, line - (heights[i] as number));
  }
  const girth = seat.diameter * scale;
  const drop = Math.min(gap, LOG_DROP_MAX * girth) + LOG_SINK * girth;
  // The model's underside climbs at `b`, so the model turns by the ground's
  // angle less its own.
  const pitch = Math.atan(slope) - Math.atan(seat.b);
  // The underside at local x = 0 stands `a` over the origin; turned by the
  // pitch and the roll it reaches down a·cos(pitch)·cos(roll).
  const y = atOrigin - drop - seat.a * scale * Math.cos(pitch) * Math.cos(roll);
  return { pitch, y };
}
