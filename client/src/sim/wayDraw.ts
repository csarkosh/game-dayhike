/**
 * Drawing the way down (docs/gameplay/2026-11-13-the-way-down.md): the one
 * path from the crest to the pad that the chase holds a player to. A meander
 * about the straight line, sized so its length is the design's aim, then a
 * search over the ground for the cheapest line that keeps to it: off the
 * lakes, the sea and the slopes a player slides on, round every trunk, log,
 * rock and cliff a runner could not step over, a little cheaper along the
 * trail. Where nothing gets through, the
 * trail's stem, flagged.
 *
 * Every peer draws it from the seed alone, long before the find, a slice at a
 * time (`drawWay` yields), and the host's rules and a client's light must be
 * the same line: only arithmetic every browser rounds alike (+ − × ÷, sqrt,
 * floor, round, comparisons), as wayDown.ts.
 */
import type { World } from "./world.js";
import type { Vec3 } from "./types.js";
import type { TrailNode } from "./trail.js";
import { GROUND_NORMAL_Y, PLAYER_HALF, STEP_HEIGHT } from "./constants.js";
import { activeTerrainVariant } from "./terrain.js";
import { lakeShoreInto, newLakeShore } from "./lakeShape.js";
import { boxesNear } from "./boxSource.js";
import { hash2 } from "./field.js";
import { stemAhead, stemNodes } from "./trailRoute.js";
import { makeWay, type WayDown } from "./wayDown.js";

/** Metres a clean run aims at: two minutes at the sprint's 7 m/s. */
export const WAY_TARGET_M = 840;
/** The most the way may be of the straight line, and the least (what leaves it room to bend). */
export const WAY_MAX_RATIO = 2;
export const WAY_MIN_RATIO = 1.12;
/** No way is longer than this while its straight line allows: a line over 1,027 m winds less than WAY_MIN_RATIO to keep under it, and one over 1,095 m is WAY_LONG_RATIO of itself. */
export const WAY_MAX_M = 1150;
export const WAY_LONG_RATIO = 1.05;
/** The shape's rules, held by the tests: the longest straight stretch, the most the distance to the car may grow, the least two stretches stand apart. */
export const WAY_STRAIGHT_MAX_M = 40;
/**
 * The longest a drawn line's stretch may measure straight before the draw
 * bends it, and the cells round the stretch's middle it walls to do so. A
 * stretch is straight while its segments' headings all lie within 8 degrees
 * of each other (STRAIGHT_COS is that angle's cosine): a line wound least
 * measures 44 to 48 m by that, which stands; a line crossing from the meander
 * to one of its copies, or back, ran straight for 60 m and more.
 */
export const WAY_STRAIGHT_MOST_M = 46;
export const WAY_BEND_CELLS = 2;
const STRAIGHT_COS = 0.9902680687415704;
export const WAY_BACK_MAX_M = 10;
export const WAY_APART_M = 25;
/** Metres of a whole wave of the meander at its straightest (the least ratio), and at its widest (the most): wide waves keep a long way's bends gentle. */
export const WAY_WAVE_M = 100;
export const WAY_WAVE_WIDE_M = 220;
/** Metres a cell of the search spans. */
export const WAY_CELL_M = 3;
/** Metres down the stem from the crest the way begins: where a party stands at the find (summit.ts DISCOVERY_RADIUS; a test holds the two equal). */
export const WAY_START_M = 12;
/** Metres from the body no part of the way comes within, and the metres from it that are refused on the side away from the party, where the Hollow steps out. */
export const WAY_BODY_CLEAR_M = 8;
export const WAY_CREST_CLEAR_M = 22;

/** The least upward normal a cell's ground may have: over GROUND_NORMAL_Y (0.7) by a margin, so the line never skirts a slide. */
const CELL_NORMAL_Y = 0.8;
/** How far over the least normal a player can stand on each of the line's own points must be. */
const STAND_MARGIN = 0.03;
/** Metres outside a lake's shore, and over the sea's level, that are still refused. */
const LAKE_MARGIN_M = 3;
const SEA_MARGIN_M = 0.5;
/** Metres the search's grid reaches past the meander, each way: the first that finds a way through is kept, so a lake or a cliff band across the near ground is gone round. */
const GRID_MARGINS_M = [40, 160, 400] as const;
/** A cell's cost a metre grows by this for each metre it is off the meander or the nearest of its copies, which lie 2 × OFF_MEANDER_MAX_M apart: so to OFF_MEANDER_MAX_M at the most. */
const OFF_MEANDER_COST = 0.25;
const OFF_MEANDER_MAX_M = 40;
/** A cell the trail passes is this much of its cost. */
const TRAIL_COST = 0.95;
/** Rounds of the search for what stands on the line (each round finds a few more: a wood is full of trunks), and of the whole for the length. */
const BOX_ROUNDS = 24;
const LENGTH_ROUNDS = 3;
/** Points either side a point is averaged with. */
const SMOOTH_REACH = 3;
/** Cells priced between two yields: a cell is five to nine reads of the ground (the walkable rock's layer), some 50 µs on a laptop, so a slice is well under a millisecond there. */
const SLICE_CELLS = 8;
/** Samples of the meander its length is measured by. */
const MEANDER_SAMPLES = 400;

/** What the way's length aims at for a straight line of `straight` metres. */
export function wayTarget(straight: number): number {
  const aim = Math.max(WAY_MIN_RATIO * straight, Math.min(WAY_TARGET_M, WAY_MAX_RATIO * straight));
  // A line so long that its least winding passes the most a way may be winds less, down to WAY_LONG_RATIO.
  return Math.min(aim, Math.max(WAY_MAX_M, WAY_LONG_RATIO * straight));
}

type Meander = { halfWaves: number; flip: number; amplitude: number };

/** The meander's lateral offset at `t` of the way along the line: parabola arches, alternate sides, a little less at the ends. */
function offsetAt(m: Meander, t: number): number {
  const u = m.halfWaves * t;
  let k = Math.floor(u);
  if (k >= m.halfWaves) k = m.halfWaves - 1;
  const f = u - k;
  const sign = (k + m.flip) % 2 === 0 ? 1 : -1;
  const taper = Math.min(1, 0.5 + 5 * t, 0.5 + 5 * (1 - t));
  return m.amplitude * taper * sign * 4 * f * (1 - f);
}

function meanderLength(m: Meander, straight: number): number {
  let length = 0, pa = 0, po = 0;
  for (let i = 1; i <= MEANDER_SAMPLES; i++) {
    const t = i / MEANDER_SAMPLES;
    const a = t * straight, o = offsetAt(m, t);
    length += Math.sqrt((a - pa) * (a - pa) + (o - po) * (o - po));
    pa = a;
    po = o;
  }
  return length;
}

/** The amplitude at which the meander is `target` metres long, by bisection. */
function amplitudeFor(m: Meander, straight: number, target: number, most: number): number {
  let lo = 0, hi = most;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (meanderLength({ ...m, amplitude: mid }, straight) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The middle point of the line's longest straight stretch, where that
 * stretch measures over WAY_STRAIGHT_MOST_M, or -1. Headings are compared as
 * unit vectors (a square root is rounded alike everywhere, a tangent is not):
 * a stretch holds while the two of its headings furthest apart are within
 * the angle.
 */
function longStraightMiddle(way: WayDown): number {
  const n = way.xs.length - 1;
  const hx = new Float64Array(n), hz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (way.xs[i + 1] as number) - (way.xs[i] as number), dz = (way.zs[i + 1] as number) - (way.zs[i] as number);
    const len = Math.sqrt(dx * dx + dz * dz);
    hx[i] = len > 0 ? dx / len : 0;
    hz[i] = len > 0 ? dz / len : 0;
  }
  let longest = WAY_STRAIGHT_MOST_M, middle = -1;
  for (let i = 0; i < n; i++) {
    // The headings furthest to the left and to the right of the first's, by the sine of each one's turn from it.
    let lo = i, hi = i, sLo = 0, sHi = 0, j = i;
    while (j + 1 < n) {
      const k = j + 1;
      const turn = (hx[i] as number) * (hz[k] as number) - (hz[i] as number) * (hx[k] as number);
      const nLo = turn < sLo ? k : lo, nHi = turn > sHi ? k : hi;
      const ahead = (hx[i] as number) * (hx[k] as number) + (hz[i] as number) * (hz[k] as number);
      if (ahead <= 0 || (hx[nLo] as number) * (hx[nHi] as number) + (hz[nLo] as number) * (hz[nHi] as number) < STRAIGHT_COS) break;
      if (nLo === k) { lo = k; sLo = turn; }
      if (nHi === k) { hi = k; sHi = turn; }
      j = k;
    }
    const run = (way.cum[j + 1] as number) - (way.cum[i] as number);
    if (run > longest) {
      longest = run;
      middle = (i + j + 1) >> 1;
    }
  }
  return middle;
}

const SHORE = newLakeShore();
const NORMAL: Vec3 = { x: 0, y: 0, z: 0 };
const BOX_MIN: Vec3 = { x: 0, y: 0, z: 0 };
const BOX_MAX: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The way from the crest to the pad, drawn a slice at a time: each `next()`
 * prices SLICE_CELLS cells. Null for a world with no trail or no ground.
 */
export function* drawWay(world: World): Generator<void, WayDown | null, void> {
  const graph = world.trail, ground = world.ground;
  if (graph === null || ground === null) return null;
  const crest = graph.nodes[graph.summit] as TrailNode;
  // The way begins where a party coming up the stem stands at the find, not at the body: on the stem,
  // WAY_START_M down it from the crest. The Hollow steps out past the body from there (summit.ts
  // `emergePoint`), so the ground round the body and behind it is never the way's: its mouth is on the party's
  // side, whichever side of the crest the pad lies.
  const stand = stemAhead(graph, crest.x, crest.z, -WAY_START_M) ?? crest;
  const S = { x: stand.x, z: stand.z }, E = { x: graph.trailhead.x, z: graph.trailhead.z };
  const straight = Math.sqrt((E.x - S.x) * (E.x - S.x) + (E.z - S.z) * (E.z - S.z));
  // The party's side of the body, as a direction from it.
  const sideX = S.x - crest.x, sideZ = S.z - crest.z;
  const stem = (): WayDown => {
    // The stem from the party's place down: its nodes from the first that is further from the crest than they stand.
    const down = stemNodes(graph).reverse().map((i) => graph.nodes[i] as TrailNode);
    let k = 0;
    while (k < down.length - 1 && (((down[k] as TrailNode).x - crest.x) * ((down[k] as TrailNode).x - crest.x) + ((down[k] as TrailNode).z - crest.z) * ((down[k] as TrailNode).z - crest.z)) <= WAY_START_M * WAY_START_M) k++;
    return makeWay([S, ...down.slice(k)], straight, true);
  };
  if (straight < WAY_CELL_M * 4) return makeWay([S, E], straight, false);

  const seed = world.forest?.seed ?? 0;
  const lakes = (world.forest === null ? undefined : activeTerrainVariant().waterBodies?.(world.forest.seed)) ?? [];
  const sea = world.waterLevel;
  // The line's own axes: `a` metres along it from the crest, `l` metres to its left.
  const ux = (E.x - S.x) / straight, uz = (E.z - S.z) / straight;
  const px = -uz, pz = ux;
  const target = wayTarget(straight);
  const ratio = target / straight;
  // Wider waves the more the way must wind, so its bends stay gentle.
  const wave = WAY_WAVE_M + ((WAY_WAVE_WIDE_M - WAY_WAVE_M) * Math.max(0, ratio - WAY_MIN_RATIO)) / (WAY_MAX_RATIO - WAY_MIN_RATIO);
  const halfWaves = Math.max(2, Math.round(straight / (wave / 2)));
  const most = (1.2 * straight) / halfWaves;
  const meander: Meander = { halfWaves, flip: hash2(S.x, S.z, seed) < 0.5 ? 0 : 1, amplitude: 0 };
  meander.amplitude = amplitudeFor(meander, straight, target, most);

  let priced = 0, sliced = 0;
  let best: WayDown | null = null;
  let widened = 0;
  for (let round = 0; round < LENGTH_ROUNDS; ) {
    // The grid, in the line's axes: columns along it, rows across it.
    const GRID_MARGIN_M = GRID_MARGINS_M[widened] as number;
    const reach = meander.amplitude + GRID_MARGIN_M;
    const cols = Math.ceil((straight + 2 * GRID_MARGIN_M) / WAY_CELL_M) + 1;
    const rows = Math.ceil((2 * reach) / WAY_CELL_M) + 1;
    const count = cols * rows;
    const alongOf = (i: number): number => i * WAY_CELL_M - GRID_MARGIN_M;
    const acrossOf = (j: number): number => j * WAY_CELL_M - reach;
    const worldX = (i: number, j: number): number => S.x + ux * alongOf(i) + px * acrossOf(j);
    const worldZ = (i: number, j: number): number => S.z + uz * alongOf(i) + pz * acrossOf(j);
    const cellOf = (x: number, z: number): number => {
      const a = (x - S.x) * ux + (z - S.z) * uz, l = (x - S.x) * px + (z - S.z) * pz;
      const i = Math.round((a + GRID_MARGIN_M) / WAY_CELL_M), j = Math.round((l + reach) / WAY_CELL_M);
      return i < 0 || i >= cols || j < 0 || j >= rows ? -1 : j * cols + i;
    };
    // A cell's cost a metre: 0 not yet priced, Infinity refused.
    const cost = new Float64Array(count);
    const onTrail = new Uint8Array(count);
    for (const e of graph.edges) {
      const a = graph.nodes[e.a] as TrailNode, b = graph.nodes[e.b] as TrailNode;
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      const steps = Math.max(1, Math.ceil(len / (WAY_CELL_M / 2)));
      for (let k = 0; k <= steps; k++) {
        const c = cellOf(a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps);
        if (c >= 0) onTrail[c] = 1;
      }
    }
    const walled = new Uint8Array(count);
    const price = (c: number): number => {
      const known = cost[c] as number;
      if (known !== 0) return known;
      priced++;
      const i = c % cols, j = (c - i) / cols;
      const x = worldX(i, j), z = worldZ(i, j);
      let value = Infinity;
      let dry = walled[c] === 0;
      if (dry) {
        // The crest is the Hollow's: nothing of the way within WAY_BODY_CLEAR_M of the body, nor within
        // WAY_CREST_CLEAR_M of it on the side away from the party.
        const bx = x - crest.x, bz = z - crest.z;
        const b2 = bx * bx + bz * bz;
        if (b2 < WAY_BODY_CLEAR_M * WAY_BODY_CLEAR_M || (b2 < WAY_CREST_CLEAR_M * WAY_CREST_CLEAR_M && bx * sideX + bz * sideZ < 0)) dry = false;
      }
      if (dry && sea !== null && ground.heightAt(x, z) < sea + SEA_MARGIN_M) dry = false;
      if (dry) {
        for (const b of lakes) {
          if (b.kind === "lake" && lakeShoreInto(SHORE, b.shape, x, z).s > -LAKE_MARGIN_M) {
            dry = false;
            break;
          }
        }
      }
      if (dry) {
        ground.normalAt(x, z, NORMAL);
        // The trail's own cells are never refused for their slope: its bed is cut level through ground a centre beside it may not be.
        if (NORMAL.y >= CELL_NORMAL_Y || onTrail[c] === 1) {
          let t = alongOf(i) / straight;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          // Off the meander, or off the nearest of its copies every 2 × OFF_MEANDER_MAX_M to either side: a line
          // gone wide round a lake still winds as the meander does, where a flat cost out there let it run straight.
          let off = acrossOf(j) - offsetAt(meander, t);
          off -= 2 * OFF_MEANDER_MAX_M * Math.round(off / (2 * OFF_MEANDER_MAX_M));
          value = (1 + OFF_MEANDER_COST * Math.abs(off)) * (onTrail[c] === 1 ? TRAIL_COST : 1);
        }
      }
      cost[c] = value;
      return value;
    };

    const from = cellOf(S.x, S.z), to = cellOf(E.x, E.z);
    let drawn: WayDown | null = null;
    for (let boxRound = 0; boxRound < BOX_ROUNDS; boxRound++) {
      // A*: the cheapest line of cells from the crest's to the pad's.
      const gScore = new Float64Array(count).fill(Infinity);
      const parent = new Int32Array(count).fill(-1);
      const closed = new Uint8Array(count);
      const heapF: number[] = [], heapC: number[] = [];
      const less = (a: number, b: number): boolean =>
        (heapF[a] as number) < (heapF[b] as number) || ((heapF[a] as number) === (heapF[b] as number) && (heapC[a] as number) < (heapC[b] as number));
      const swap = (a: number, b: number): void => {
        const f = heapF[a] as number, c = heapC[a] as number;
        heapF[a] = heapF[b] as number;
        heapC[a] = heapC[b] as number;
        heapF[b] = f;
        heapC[b] = c;
      };
      const push = (f: number, c: number): void => {
        let at = heapF.length;
        heapF.push(f);
        heapC.push(c);
        while (at > 0) {
          const up = (at - 1) >> 1;
          if (!less(at, up)) break;
          swap(at, up);
          at = up;
        }
      };
      const pop = (): number => {
        const top = heapC[0] as number;
        const lastF = heapF.pop() as number, lastC = heapC.pop() as number;
        if (heapF.length > 0) {
          heapF[0] = lastF;
          heapC[0] = lastC;
          let at = 0;
          for (;;) {
            const l = 2 * at + 1, r = l + 1;
            let least = at;
            if (l < heapF.length && less(l, least)) least = l;
            if (r < heapF.length && less(r, least)) least = r;
            if (least === at) break;
            swap(at, least);
            at = least;
          }
        }
        return top;
      };
      const ti = to % cols, tj = (to - ti) / cols;
      const estimate = (c: number): number => {
        const i = c % cols, j = (c - i) / cols;
        return Math.sqrt((i - ti) * (i - ti) + (j - tj) * (j - tj)) * WAY_CELL_M * TRAIL_COST;
      };
      let found = false;
      // The start's and the pad's own cells are never refused: the way starts and ends there whatever the ground.
      if (price(from) === Infinity) cost[from] = 1;
      if (price(to) === Infinity) cost[to] = 1;
      gScore[from] = 0;
      push(estimate(from), from);
      while (heapF.length > 0) {
        const c = pop();
        if (closed[c] === 1) continue;
        closed[c] = 1;
        if (c === to) {
          found = true;
          break;
        }
        const i = c % cols, j = (c - i) / cols;
        const here = price(c), g = gScore[c] as number;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di, nj = j + dj;
            if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
            const n = nj * cols + ni;
            if (closed[n] === 1) continue;
            const there = price(n);
            if (there === Infinity) continue;
            const step = (di !== 0 && dj !== 0 ? 1.4142135623730951 : 1) * WAY_CELL_M;
            const next = g + step * 0.5 * (here + there);
            if (next < (gScore[n] as number)) {
              gScore[n] = next;
              parent[n] = c;
              push(next + estimate(n), n);
            }
          }
        }
        if (priced - sliced >= SLICE_CELLS) {
          sliced = priced;
          yield;
        }
      }
      if (!found) {
        drawn = null;
        break;
      }
      const cells: number[] = [];
      for (let c = to; c !== -1; c = parent[c] as number) cells.push(c);
      cells.reverse();
      // Boxes, only along what was found: anything a runner could not step over (a trunk, a fallen one, a rock, a
      // cliff) walls its cell, and the search goes again, so the line itself is clear ground.
      let blocked = 0;
      for (const c of cells) {
        if (c === from || c === to) continue;
        const i = c % cols, j = (c - i) / cols;
        const x = worldX(i, j), z = worldZ(i, j);
        const h = ground.heightAt(x, z);
        const half = WAY_CELL_M / 2 + PLAYER_HALF.x;
        BOX_MIN.x = x - half; BOX_MIN.y = h - 1; BOX_MIN.z = z - half;
        BOX_MAX.x = x + half; BOX_MAX.y = h + 2 * PLAYER_HALF.y; BOX_MAX.z = z + half;
        for (const box of boxesNear(world.boxes, BOX_MIN, BOX_MAX)) {
          if (box.max.x < BOX_MIN.x || box.min.x > BOX_MAX.x || box.max.z < BOX_MIN.z || box.min.z > BOX_MAX.z) continue;
          if (box.max.y - h <= STEP_HEIGHT || box.min.y > BOX_MAX.y) continue;
          walled[c] = 1;
          cost[c] = Infinity;
          blocked++;
          break;
        }
        priced++;
        if (priced - sliced >= SLICE_CELLS) {
          sliced = priced;
          yield;
        }
      }
      // The last round's line stands with whatever is still on it: a trunk to run round, never a reason for no way.
      if (blocked > 0 && boxRound < BOX_ROUNDS - 1) continue;

      // The cells' centres, the ends the crest and the pad themselves, each averaged with its neighbours; a point
      // the averaging put on refused ground is its cell's own again.
      const raw = cells.map((c) => {
        const i = c % cols, j = (c - i) / cols;
        return { x: worldX(i, j), z: worldZ(i, j) };
      });
      raw[0] = S;
      raw[raw.length - 1] = E;
      const smooth = raw.map((p, k) => {
        if (k === 0 || k === raw.length - 1) return p;
        const reachK = Math.min(SMOOTH_REACH, k, raw.length - 1 - k);
        let x = 0, z = 0;
        for (let d = -reachK; d <= reachK; d++) {
          x += (raw[k + d] as { x: number; z: number }).x;
          z += (raw[k + d] as { x: number; z: number }).z;
        }
        const q = { x: x / (2 * reachK + 1), z: z / (2 * reachK + 1) };
        const c = cellOf(q.x, q.z);
        return c < 0 || price(c) === Infinity ? p : q;
      });
      drawn = makeWay(smooth, straight, false);
      // The line's own points, between the cells' centres: one on ground a player could not stand on (a bank
      // the centres straddle) walls its cell, and the search goes again.
      let slid = 0;
      for (let k = 1; k + 1 < drawn.xs.length; k++) {
        const x = drawn.xs[k] as number, z = drawn.zs[k] as number;
        ground.normalAt(x, z, NORMAL);
        if (NORMAL.y > (ground.standNormalY?.(x, z) ?? GROUND_NORMAL_Y) + STAND_MARGIN) continue;
        const c = cellOf(x, z);
        if (c < 0 || c === from || c === to || walled[c] === 1) continue;
        walled[c] = 1;
        cost[c] = Infinity;
        slid++;
      }
      // A stretch that runs straight for too long is bent: the cells round its middle are walled, as if a boulder
      // stood there, and the search goes again and round them.
      let bent = 0;
      if (slid === 0) {
        const middle = longStraightMiddle(drawn);
        const c = middle < 0 ? -1 : cellOf(drawn.xs[middle] as number, drawn.zs[middle] as number);
        if (c >= 0) {
          const ci = c % cols, cj = (c - ci) / cols;
          for (let dj = -WAY_BEND_CELLS; dj <= WAY_BEND_CELLS; dj++) {
            for (let di = -WAY_BEND_CELLS; di <= WAY_BEND_CELLS; di++) {
              const ni = ci + di, nj = cj + dj;
              if (di * di + dj * dj > WAY_BEND_CELLS * WAY_BEND_CELLS || ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
              const b = nj * cols + ni;
              if (b === from || b === to || walled[b] === 1) continue;
              walled[b] = 1;
              cost[b] = Infinity;
              bent++;
            }
          }
        }
      }
      yield;
      if ((slid === 0 && bent === 0) || boxRound === BOX_ROUNDS - 1) break;
    }
    if (drawn === null) {
      // Nothing got through this much ground: more of it, or no more to try.
      if (widened + 1 >= GRID_MARGINS_M.length) break;
      widened++;
      continue;
    }
    round++;
    if (best === null || Math.abs(drawn.length - target) < Math.abs(best.length - target)) best = drawn;
    if (drawn.length >= 0.95 * target && drawn.length <= 1.05 * target) break;
    // Wind more or less by as much as the length missed, and go again.
    meander.amplitude = Math.min(most, Math.max(0, meander.amplitude * (1 + 1.5 * (target / drawn.length - 1))));
    yield;
  }
  return best ?? stem();
}

/**
 * Advances the world's draw until `budgetMs` of `now`'s clock is spent or it
 * is done: true once the way is settled (drawn, or none to draw). The app
 * calls it a frame at a time from early in the climb, so the find never
 * waits on it; `now` is the caller's clock, the sim reads none.
 */
export function stepWay(world: World, budgetMs: number, now: () => number): boolean {
  const draw = world.wayDraw;
  if (draw === null) return true;
  const until = now() + budgetMs;
  do {
    const r = draw.next();
    if (r.done === true) {
      world.way = r.value;
      world.wayDraw = null;
      return true;
    }
  } while (now() < until);
  return false;
}

/** The world's way, what is left of its draw run to its end first: for the tick that cannot go on without it. */
export function wayOf(world: World): WayDown | null {
  const draw = world.wayDraw;
  if (draw !== null) {
    let r = draw.next();
    while (r.done !== true) r = draw.next();
    world.way = r.value;
    world.wayDraw = null;
  }
  return world.way;
}

/** The way, drawn to its end in one go. */
export function drawWayNow(world: World): WayDown | null {
  const gen = drawWay(world);
  let r = gen.next();
  while (r.done !== true) r = gen.next();
  return r.value;
}
