/**
 * The way down (docs/gameplay/2026-11-13-the-way-down.md): the one path the
 * chase holds a player to, from the crest to the pad, as a line of points
 * WAY_STEP_M apart, with what the rules and the light ask of it: how far off
 * it a place is, how far along it, and the point and direction at a distance
 * along. Drawn by wayDraw.ts; every peer draws the same one from the seed.
 *
 * Only arithmetic every browser rounds alike (+ − × ÷, sqrt, comparisons):
 * the host's rules and a client's light must be the same line.
 */

/** Metres between the way's points. */
export const WAY_STEP_M = 2;
/** Metres either side of the line that are the channel's floor, and to its walls' rims: within the rim a player is on the way. */
export const WAY_FLOOR_M = 4;
export const WAY_RIM_M = 5.5;

/** Metres a cell of the way's index spans. */
const CELL_M = 16;
/** Rings of cells searched before the whole way is scanned instead. */
const RINGS_MAX = 8;

export type WayDown = {
  /** The points, from the crest (index 0) to the pad. */
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  /** Metres along the way at each point. */
  readonly cum: Float32Array;
  readonly length: number;
  /** The straight line from its first point to its last, metres. */
  readonly straight: number;
  /** True when nothing got through and this is the trail's stem instead. */
  readonly fallback: boolean;
  /** Segment indices (segment i runs from point i to i + 1) by the cell either end is in. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
};

function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** The way through `points`, resampled WAY_STEP_M apart; its first and last points are theirs. */
export function makeWay(points: readonly { x: number; z: number }[], straight: number, fallback: boolean): WayDown {
  const xs: number[] = [], zs: number[] = [];
  const first = points[0];
  if (first !== undefined) {
    xs.push(first.x);
    zs.push(first.z);
    // Metres still to go to the next point to keep.
    let need = WAY_STEP_M;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; z: number }, b = points[i] as { x: number; z: number };
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      let at = 0;
      while (len - at >= need) {
        at += need;
        xs.push(a.x + (dx * at) / len);
        zs.push(a.z + (dz * at) / len);
        need = WAY_STEP_M;
      }
      need -= len - at;
    }
    const last = points[points.length - 1] as { x: number; z: number };
    const n = xs.length - 1;
    const ex = last.x - (xs[n] as number), ez = last.z - (zs[n] as number);
    // The last point is theirs: moved onto it when a step ended within a hair of it, added otherwise.
    if (ex * ex + ez * ez < 1e-6) {
      xs[n] = last.x;
      zs[n] = last.z;
    } else {
      xs.push(last.x);
      zs.push(last.z);
    }
  }
  const count = xs.length;
  const cum = new Float32Array(count);
  const cells = new Map<number, number[]>();
  const put = (key: number, i: number): void => {
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [i]);
    else if (list[list.length - 1] !== i) list.push(i);
  };
  let length = 0;
  for (let i = 0; i + 1 < count; i++) {
    const ax = xs[i] as number, az = zs[i] as number, bx = xs[i + 1] as number, bz = zs[i + 1] as number;
    length += Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    cum[i + 1] = length;
    put(cellKey(Math.floor(ax / CELL_M), Math.floor(az / CELL_M)), i);
    put(cellKey(Math.floor(bx / CELL_M), Math.floor(bz / CELL_M)), i);
  }
  return { xs: Float32Array.from(xs), zs: Float32Array.from(zs), cum, length, straight, fallback, cells };
}

/** The last search's answer: metres along and the square of the metres off. One search at a time; nothing is kept across calls. */
let foundS = 0;
let foundD2 = Infinity;

function trySegment(way: WayDown, i: number, x: number, z: number): void {
  const ax = way.xs[i] as number, az = way.zs[i] as number;
  const vx = (way.xs[i + 1] as number) - ax, vz = (way.zs[i + 1] as number) - az;
  const len2 = vx * vx + vz * vz;
  let u = len2 > 0 ? ((x - ax) * vx + (z - az) * vz) / len2 : 0;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const ox = x - (ax + vx * u), oz = z - (az + vz * u);
  const d2 = ox * ox + oz * oz;
  if (d2 < foundD2) {
    foundD2 = d2;
    foundS = (way.cum[i] as number) + ((way.cum[i + 1] as number) - (way.cum[i] as number)) * u;
  }
}

/** Fills `foundS` and `foundD2` with the way's nearest place to (x, z). */
function nearest(way: WayDown, x: number, z: number): void {
  foundS = 0;
  foundD2 = Infinity;
  const count = way.xs.length;
  if (count === 0) return;
  if (count === 1) {
    const ox = x - (way.xs[0] as number), oz = z - (way.zs[0] as number);
    foundD2 = ox * ox + oz * oz;
    return;
  }
  const cx = Math.floor(x / CELL_M), cz = Math.floor(z / CELL_M);
  for (let ring = 1; ring <= RINGS_MAX; ring++) {
    for (let j = -ring; j <= ring; j++) {
      for (let i = -ring; i <= ring; i++) {
        // Only the ring's own cells: the ones inside it were searched already.
        if (ring > 1 && Math.abs(i) < ring && Math.abs(j) < ring) continue;
        const list = way.cells.get(cellKey(cx + i, cz + j));
        if (list === undefined) continue;
        for (let k = 0; k < list.length; k++) trySegment(way, list[k] as number, x, z);
      }
    }
    // Anything nearer than the searched cells reach (less a segment's own span) would have been found in them.
    const sure = ring * CELL_M - WAY_STEP_M;
    if (foundD2 <= sure * sure) return;
  }
  for (let i = 0; i + 1 < count; i++) trySegment(way, i, x, z);
}

/** Where (x, z) is by the way: `s` metres along it, `d` metres off it. */
export function wayProject(way: WayDown, x: number, z: number): { s: number; d: number } {
  nearest(way, x, z);
  return { s: foundS, d: Math.sqrt(foundD2) };
}

/** Metres from (x, z) to the way's line. */
export function wayDistance(way: WayDown, x: number, z: number): number {
  nearest(way, x, z);
  return Math.sqrt(foundD2);
}

/**
 * Metres from (x, z) to the way's line where that is `within` metres or
 * less, Infinity where it is more: only the cells that far can reach are
 * searched, so a place far from the way costs a few lookups. For a map of
 * many places most of which are nowhere near it (the mist's, renderer.ts).
 */
export function wayDistanceWithin(way: WayDown, x: number, z: number, within: number): number {
  foundS = 0;
  foundD2 = Infinity;
  const count = way.xs.length;
  if (count === 0) return Infinity;
  if (count === 1) {
    const ox = x - (way.xs[0] as number), oz = z - (way.zs[0] as number);
    foundD2 = ox * ox + oz * oz;
  } else {
    const cx = Math.floor(x / CELL_M), cz = Math.floor(z / CELL_M);
    // A segment within reach has an end within reach and a segment's span, and is listed in that end's cell.
    const rings = Math.ceil((within + WAY_STEP_M) / CELL_M);
    for (let j = -rings; j <= rings; j++) {
      for (let i = -rings; i <= rings; i++) {
        const list = way.cells.get(cellKey(cx + i, cz + j));
        if (list === undefined) continue;
        for (let k = 0; k < list.length; k++) trySegment(way, list[k] as number, x, z);
      }
    }
  }
  return foundD2 <= within * within ? Math.sqrt(foundD2) : Infinity;
}

/** The index of the segment `s` metres along lies in: the last i with cum[i] <= s, kept inside the way. */
function segmentAt(way: WayDown, s: number): number {
  const last = way.xs.length - 2;
  if (last < 0) return -1;
  let lo = 0, hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((way.cum[mid] as number) <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The way's point `s` metres along, into `out`; before its start or past its end, the end. */
export function wayPoint(way: WayDown, s: number, out: { x: number; z: number }): { x: number; z: number } {
  const i = segmentAt(way, s);
  if (i < 0) {
    out.x = way.xs[0] ?? 0;
    out.z = way.zs[0] ?? 0;
    return out;
  }
  const a = way.cum[i] as number, b = way.cum[i + 1] as number;
  let u = b > a ? (s - a) / (b - a) : 0;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  out.x = (way.xs[i] as number) + ((way.xs[i + 1] as number) - (way.xs[i] as number)) * u;
  out.z = (way.zs[i] as number) + ((way.zs[i + 1] as number) - (way.zs[i] as number)) * u;
  return out;
}

/** The unit vector down the way `s` metres along, into `out`; (0, 0) for a way with no length. */
export function wayDirection(way: WayDown, s: number, out: { x: number; z: number }): { x: number; z: number } {
  const i = segmentAt(way, s);
  out.x = 0;
  out.z = 0;
  if (i < 0) return out;
  const vx = (way.xs[i + 1] as number) - (way.xs[i] as number), vz = (way.zs[i + 1] as number) - (way.zs[i] as number);
  const len = Math.sqrt(vx * vx + vz * vz);
  if (len > 0) {
    out.x = vx / len;
    out.z = vz / len;
  }
  return out;
}
