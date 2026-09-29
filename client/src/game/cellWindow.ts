/**
 * The square of lattice cells a field's collector walks, kept between walks
 * so that a step walks only the cells that came into it.
 *
 * The blade, duff and clutter collectors each walk the square of cells that
 * circumscribes their disc, row by row, and list the value each non-empty
 * cell holds. After a one-cell step the square differs from the last by a
 * strip. A window holds the last square's non-empty cells in that same row
 * order, so a move samples only the cells the new square adds — and those an
 * eviction let go while they were still inside it — and the walk that
 * follows reads the held cells, in the order a walk of every cell would
 * reach them, without looking a single one up again.
 *
 * `sample` is the collector's own memoised lookup, so a cell is the same
 * object whether the window or a whole walk reaches it. Pure and
 * Babylon-free.
 */
import type { Slices } from "./syncJobs.js";

export type CellWindow<T> = {
  /** The square, inclusive, in cells; NaN before the first move. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Row `r` (cz = z0 + r): each non-empty cell's value, in cx order. */
  rows: T[][];
  /** The cx of each entry of `rows`. */
  cxs: number[][];
  /** Cells the sweep let go while inside the square, as cx, cz pairs: the
   * next move samples them again. */
  refresh: number[];
  /** Cells the last move sampled. */
  walked: number;
};

export function createCellWindow<T>(): CellWindow<T> {
  return { x0: NaN, x1: NaN, z0: NaN, z1: NaN, rows: [], cxs: [], refresh: [], walked: 0 };
}

/** Whether cell (cx, cz) is inside the window's square. */
export function inWindow<T>(w: CellWindow<T>, cx: number, cz: number): boolean {
  return cx >= w.x0 && cx <= w.x1 && cz >= w.z0 && cz <= w.z1;
}

/**
 * The rows of a cell square as a band walk reads them: row by row (cz
 * ascending), each row's non-empty cells by cx ascending — the order a walk
 * of every cell reaches them. `cls` is the clutter's class, which picks the
 * grid; a field with one grid ignores it. A generator, so a source that
 * samples can do so in slices.
 */
export type CellRows<T> = (cls: number, x0: number, x1: number, z0: number, z1: number) => Slices<readonly (readonly T[])[]>;

/** Rows from a walk of every cell of the square through `sample`: what the
 * pure one-shot collects read. */
export function walkEveryCell<T>(sample: (cls: number, cx: number, cz: number) => T | null): CellRows<T> {
  return function* (cls, x0, x1, z0, z1) {
    const rows: T[][] = [];
    for (let cz = z0; cz <= z1; cz++) {
      const row: T[] = [];
      for (let cx = x0; cx <= x1; cx++) {
        const v = sample(cls, cx, cz);
        if (v !== null) row.push(v);
      }
      rows.push(row);
    }
    return rows;
  };
}

/** Cells a slice of a move samples before it yields. */
const MOVE_SLICE_CELLS = 16;

/**
 * Moves the window to the square [x0, x1] × [z0, z1], in slices: the rows are
 * built anew, each from the held cells still inside and the cells the square
 * adds on either side, and replace the old in the last slice, so a move
 * dropped half done leaves the window as it was. A square of another size,
 * or one that does not overlap the last, is sampled whole.
 */
export function* moveWindow<T>(
  w: CellWindow<T>,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  sample: (cx: number, cz: number) => T | null,
): Slices {
  let walked = 0;
  let sinceYield = 0;
  const rows: T[][] = [];
  const cxs: number[][] = [];
  const kept = x1 - x0 === w.x1 - w.x0 && z1 - z0 === w.z1 - w.z0 &&
    x0 <= w.x1 && x1 >= w.x0 && z0 <= w.z1 && z1 >= w.z0;
  for (let cz = z0; cz <= z1; cz++) {
    const row: T[] = [];
    const rowCx: number[] = [];
    const old = kept && cz >= w.z0 && cz <= w.z1 ? cz - w.z0 : -1;
    // The cells left of the held span, the held span, the cells right of it;
    // a row the last square did not have is all "left".
    const heldLo = old >= 0 ? Math.max(x0, w.x0) : x1 + 1;
    const heldHi = old >= 0 ? Math.min(x1, w.x1) : x1;
    for (let cx = x0; cx < heldLo; cx++) {
      const v = sample(cx, cz);
      if (v !== null) {
        row.push(v);
        rowCx.push(cx);
      }
      walked++;
      if (++sinceYield >= MOVE_SLICE_CELLS) {
        sinceYield = 0;
        yield;
      }
    }
    if (old >= 0) {
      const values = w.rows[old] as T[];
      const at = w.cxs[old] as number[];
      for (let i = 0; i < at.length; i++) {
        const cx = at[i] as number;
        if (cx < heldLo || cx > heldHi) continue;
        row.push(values[i] as T);
        rowCx.push(cx);
      }
      for (let cx = heldHi + 1; cx <= x1; cx++) {
        const v = sample(cx, cz);
        if (v !== null) {
          row.push(v);
          rowCx.push(cx);
        }
        walked++;
        if (++sinceYield >= MOVE_SLICE_CELLS) {
          sinceYield = 0;
          yield;
        }
      }
    }
    rows.push(row);
    cxs.push(rowCx);
  }
  // The cells a sweep let go while they were held: sampled again where they
  // are still inside, their held entry replaced by what the lookup now
  // returns. A cell sampled above is already fresh; a held one is found by
  // its cx, the rows being in cx order.
  for (let i = 0; i < w.refresh.length; i += 2) {
    const cx = w.refresh[i] as number;
    const cz = w.refresh[i + 1] as number;
    if (!kept || cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
    if (cz < w.z0 || cz > w.z1 || cx < w.x0 || cx > w.x1) continue;
    const r = cz - z0;
    const row = rows[r] as T[];
    const rowCx = cxs[r] as number[];
    const v = sample(cx, cz);
    walked++;
    if (++sinceYield >= MOVE_SLICE_CELLS) {
      sinceYield = 0;
      yield;
    }
    const at = lowerBound(rowCx, cx);
    const held = at < rowCx.length && rowCx[at] === cx;
    if (v === null) {
      if (held) {
        row.splice(at, 1);
        rowCx.splice(at, 1);
      }
    } else if (held) {
      row[at] = v;
    } else {
      row.splice(at, 0, v);
      rowCx.splice(at, 0, cx);
    }
  }
  w.rows = rows;
  w.cxs = cxs;
  w.x0 = x0;
  w.x1 = x1;
  w.z0 = z0;
  w.z1 = z1;
  w.refresh = [];
  w.walked = walked;
}

/** The first index in the sorted `list` whose value is at least `v`. */
function lowerBound(list: number[], v: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
