/**
 * The walkability grid and the search on it.
 *
 * A grid of TRAIL_GRID_CELL cells over the region, each holding the ground's
 * height and gradient magnitude at its centre. A cell is passable when its own
 * gradient and every 8-neighbour's are under TRAIL_GRID_CAP — one cell of
 * margin, because a centre gradient under-reads the ground between centres.
 * The cap is deliberately under the fine check's TRAIL_HARD_SLOPE_MAX (0.9):
 * pre-flight over 55 seeds found beds over the fine cap at 0.9 and 0.7 and
 * none at 0.6.
 *
 * `searchFrom` is Dijkstra over 8-connected moves. A move that would climb
 * steeper than TRAIL_MOVE_GRADE_MAX is forbidden outright (a per-MOVE cap,
 * distinct from TRAIL_GRID_CAP's per-CELL one — a cell a dome's
 * keep-passability rule kept passable can still be too steep to climb
 * directly, forcing the search to switchback instead of walking the fall
 * line); otherwise a move costs its length times (1 + TRAIL_SLOPE_COST ·
 * grade). A move that lands on a cell of the caller's TREE costs
 * TRAIL_REUSE_FACTOR of that, so later paths coalesce onto earlier ones; and
 * a cell that is an 8-neighbour of the tree but not on it can be entered only
 * FROM the tree — the two-cell rule that keeps two branches from running one
 * cell apart (2 cells = 16 m ≥ the 12 m spacing invariant). Deterministic:
 * cells in index order, a binary heap keyed by (cost, index). No RNG, no
 * trig; Math.SQRT2 is a constant.
 *
 * Generic: the road frame arrives as a callback, the ground as a sampler.
 */
import type { TerrainSample } from "./terrain.js";
import { BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF, TRAIL_Z_ANCHOR } from "./bowl.js";

export const TRAIL_GRID_CELL = 8;
export const TRAIL_GRID_CAP = 0.6;
export const TRAIL_SLOPE_COST = 2;
export const TRAIL_REUSE_FACTOR = 0.35;
/**
 * A single grid move may not climb steeper than this — a flank cell the dome's keep-passability rule
 * kept passable is still reachable, but only by a move under the cap: on an
 * 8 m grid a diagonal on a 0.8 flank is 0.4, so the search switchbacks
 * instead of climbing the fall line; the fine check's 0.9 is then something
 * the route was PLANNED under, not corrected against. `resampleAround`'s
 * keep-passability rule was written for the old 18 m / 45 m carved-overlook
 * dome (flank max 0.75); the peak's 300 m / up-to-80 m dome has flank cells
 * up to 0.8, and with no per-move cap the plain length + 2·|dh| cost let the
 * search walk straight up that fall line, composing past 0.9 with the base
 * grade underneath it — a reroute only ever varied the approach, never the
 * climb.
 */
export const TRAIL_MOVE_GRADE_MAX = 0.7;
/** Folded into TRAIL_TUNABLES by trail.ts. */
export const TRAIL_GRID_TUNABLES: Readonly<Record<string, number>> = {
  TRAIL_GRID_CELL, TRAIL_GRID_CAP, TRAIL_SLOPE_COST, TRAIL_REUSE_FACTOR, TRAIL_MOVE_GRADE_MAX,
};

export type GroundFn = (x: number, z: number) => TerrainSample;

export type TrailGrid = {
  nu: number;
  nz: number;
  /** Cell centres in world space. */
  x: Float64Array;
  z: Float64Array;
  h: Float64Array;
  grad: Float64Array;
  pass: Uint8Array;
};

/** (du, dz, length factor) of the eight moves, in a fixed order. */
const MOVES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export function buildTrailGrid(roadCenterX: (z: number) => number, ground: GroundFn): TrailGrid {
  const nu = Math.floor((BOWL_U_MAX - BOWL_U_MIN) / TRAIL_GRID_CELL);
  const nz = Math.floor((2 * BOWL_Z_HALF) / TRAIL_GRID_CELL);
  const n = nu * nz;
  const grid: TrailGrid = {
    nu, nz,
    x: new Float64Array(n), z: new Float64Array(n), h: new Float64Array(n), grad: new Float64Array(n),
    pass: new Uint8Array(n),
  };
  for (let j = 0; j < nz; j++) {
    const zj = TRAIL_Z_ANCHOR - BOWL_Z_HALF + (j + 0.5) * TRAIL_GRID_CELL;
    const rx = roadCenterX(zj);
    for (let i = 0; i < nu; i++) {
      const c = j * nu + i;
      const xi = rx + BOWL_U_MIN + (i + 0.5) * TRAIL_GRID_CELL;
      grid.x[c] = xi;
      grid.z[c] = zj;
      sampleCell(grid, ground, c);
    }
  }
  recomputePass(grid);
  return grid;
}

function sampleCell(grid: TrailGrid, ground: GroundFn, c: number): void {
  const s = ground(grid.x[c] as number, grid.z[c] as number);
  grid.h[c] = s.h;
  grid.grad[c] = Math.sqrt(s.dx * s.dx + s.dz * s.dz);
}

/** Passability from the gradients: under the cap, and every 8-neighbour under it. */
export function recomputePass(grid: TrailGrid): void {
  const { nu, nz } = grid;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nu; i++) {
      let ok = (grid.grad[j * nu + i] as number) <= TRAIL_GRID_CAP;
      for (let dj = -1; dj <= 1 && ok; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nu || jj >= nz) continue;
          if ((grid.grad[jj * nu + ii] as number) > TRAIL_GRID_CAP) { ok = false; break; }
        }
      }
      grid.pass[j * nu + i] = ok ? 1 : 0;
    }
  }
}

/** Re-read every cell within `radius` of a world point (a dome was carved),
 * then recompute passability. Passability is recomputed for the whole grid:
 * it is 18k compares, and the alternative — a disc plus its one-cell rim —
 * is a second place for the margin rule to live. */
export function resampleCells(grid: TrailGrid, ground: GroundFn, cx: number, cz: number, radius: number): void {
  const r2 = radius * radius;
  for (let c = 0; c < grid.h.length; c++) {
    const dx = (grid.x[c] as number) - cx, dz = (grid.z[c] as number) - cz;
    if (dx * dx + dz * dz <= r2) sampleCell(grid, ground, c);
  }
  recomputePass(grid);
}

/** The cell holding a world point, or −1 outside the region. */
export function cellAt(grid: TrailGrid, roadCenterX: (z: number) => number, x: number, z: number): number {
  const u = x - roadCenterX(z);
  const i = Math.floor((u - BOWL_U_MIN) / TRAIL_GRID_CELL);
  const j = Math.floor((z - (TRAIL_Z_ANCHOR - BOWL_Z_HALF)) / TRAIL_GRID_CELL);
  if (i < 0 || j < 0 || i >= grid.nu || j >= grid.nz) return -1;
  return j * grid.nu + i;
}

/** The in-bounds 8-neighbours of a cell, in MOVES order. */
export function cellNeighbours(grid: TrailGrid, c: number): number[] {
  const i = c % grid.nu, j = (c - i) / grid.nu;
  const out: number[] = [];
  for (const [di, dj] of MOVES) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= grid.nu || jj >= grid.nz) continue;
    out.push(jj * grid.nu + ii);
  }
  return out;
}

/** Binary min-heap keyed by (cost, cell index): equal costs pop in index order,
 * which is what makes the search deterministic across engines. */
class CellHeap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number { return this.k.length; }
  private less(a: number, b: number): boolean {
    const ka = this.k[a] as number, kb = this.k[b] as number;
    return ka < kb || (ka === kb && (this.v[a] as number) < (this.v[b] as number));
  }
  private swap(a: number, b: number): void {
    const tk = this.k[a] as number, tv = this.v[a] as number;
    this.k[a] = this.k[b] as number; this.v[a] = this.v[b] as number;
    this.k[b] = tk; this.v[b] = tv;
  }
  push(key: number, value: number): void {
    this.k.push(key); this.v.push(value);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const top = this.v[0] as number;
    const lk = this.k.pop() as number, lv = this.v.pop() as number;
    if (this.k.length > 0) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

export type Search = {
  /** Cost from the start (Infinity = unreachable). */
  dist: Float64Array;
  /** Plain path length from the start, for the landmark rules. */
  len: Float64Array;
  prev: Int32Array;
};

/**
 * Dijkstra from `start` over passable cells. `tree` (1 = on the tree) turns on
 * the reuse discount and the two-cell rule; null is a plain search. A move
 * from c to n: forbidden if n is impassable; if a tree is given and n is off
 * the tree, forbidden when c is off the tree too and n touches the tree
 * (the two-cell rule — an off-tree path may not approach the tree except by
 * leaving it); forbidden if |Δh| exceeds TRAIL_MOVE_GRADE_MAX · length (a
 * per-move cap, distinct from the per-cell TRAIL_GRID_CAP baked into
 * `pass` — a cell can be passable and still too steep to climb directly);
 * otherwise cost = length · (1 + TRAIL_SLOPE_COST · |Δh| / length), times
 * TRAIL_REUSE_FACTOR when n is on the tree. `weight` is the ring cost of the
 * loop builder: 0 forbids a cell, RING_COST favours
 * the band; a move's cost is multiplied by (weight[c] + weight[m]) / 2.
 */
export function searchFrom(grid: TrailGrid, start: number, tree: Uint8Array | null, weight: Float32Array | null = null): Search {
  const { nu, nz } = grid;
  const n = nu * nz;
  const dist = new Float64Array(n).fill(Infinity);
  const len = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new CellHeap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const c = heap.pop();
    if (done[c] === 1) continue;
    done[c] = 1;
    const i = c % nu, j = (c - i) / nu;
    const cOnTree = tree !== null && tree[c] === 1;
    for (const [di, dj, f] of MOVES) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nu || jj >= nz) continue;
      const m = jj * nu + ii;
      if (grid.pass[m] === 0 || done[m] === 1) continue;
      if (weight !== null) {
        const wm = weight[m] as number;
        if (wm === 0) continue;
      }
      let reuse = false;
      if (tree !== null) {
        if (tree[m] === 1) reuse = true;
        else if (!cOnTree && touchesTree(grid, tree, ii, jj)) continue;
      }
      const length = f * TRAIL_GRID_CELL;
      const dh = Math.abs((grid.h[m] as number) - (grid.h[c] as number));
      if (dh > TRAIL_MOVE_GRADE_MAX * length) continue;
      let cost = length + TRAIL_SLOPE_COST * dh;
      if (reuse) cost *= TRAIL_REUSE_FACTOR;
      if (weight !== null) cost *= ((weight[c] as number) + (weight[m] as number)) / 2;
      const nd = (dist[c] as number) + cost;
      if (nd < (dist[m] as number)) {
        dist[m] = nd;
        len[m] = (len[c] as number) + length;
        prev[m] = c;
        heap.push(nd, m);
      }
    }
  }
  return { dist, len, prev };
}

function touchesTree(grid: TrailGrid, tree: Uint8Array, i: number, j: number): boolean {
  for (const [di, dj] of MOVES) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= grid.nu || jj >= grid.nz) continue;
    if (tree[jj * grid.nu + ii] === 1) return true;
  }
  return false;
}

/** The cells from the search's start to `target`, or [] if unreachable. */
export function pathCells(search: Search, target: number): number[] {
  if (!Number.isFinite(search.dist[target] as number)) return [];
  const out: number[] = [];
  for (let c = target; c !== -1; c = search.prev[c] as number) out.push(c);
  out.reverse();
  return out;
}
