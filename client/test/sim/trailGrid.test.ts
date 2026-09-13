import { describe, it, expect } from "vitest";
import {
  buildTrailGrid, resampleCells, cellAt, cellNeighbours, searchFrom, pathCells,
  TRAIL_GRID_CELL, TRAIL_GRID_CAP, TRAIL_SLOPE_COST, TRAIL_REUSE_FACTOR, TRAIL_MOVE_GRADE_MAX, TRAIL_GRID_TUNABLES,
  type TrailGrid, type GroundFn,
} from "../../src/sim/trailGrid.js";
import { BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF, TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";

/** A straight road at x = −250, so u = x + 250. */
const ROAD_X = -250;
const roadCenterX = () => ROAD_X;
/** Flat ground: h = 40, no gradient. */
const flat: GroundFn = () => ({ h: 40, dx: 0, dz: 0 });
/**
 * A ridge across the region: for u ∈ [300, 330] the ground is a wall (gradient
 * 3), except through a gap at z ∈ [100, 140] where it is flat. A shortest path
 * from the road to anything inland of u = 330 has to go through the gap.
 */
const ridged: GroundFn = (x, z) => {
  const u = x - ROAD_X;
  if (u >= 300 && u <= 330 && !(z >= 100 && z <= 140)) return { h: 40 + 3 * (u - 300), dx: 3, dz: 0 };
  return { h: 40, dx: 0, dz: 0 };
};
/** A plane rising in +x at grade 0.5: every cell passable, every +x move costs more. */
const ramp: GroundFn = (x) => ({ h: 0.5 * (x - ROAD_X), dx: 0.5, dz: 0 });

function cellOf(grid: TrailGrid, u: number, z: number): number {
  return cellAt(grid, roadCenterX, ROAD_X + u, z);
}

describe("buildTrailGrid", () => {
  it("covers the region in TRAIL_GRID_CELL cells with centres in world space", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    expect(g.nu).toBe(Math.floor((BOWL_U_MAX - BOWL_U_MIN) / TRAIL_GRID_CELL));
    expect(g.nz).toBe(Math.floor((2 * BOWL_Z_HALF) / TRAIL_GRID_CELL));
    expect(g.x[0]).toBeCloseTo(ROAD_X + BOWL_U_MIN + TRAIL_GRID_CELL / 2, 9);
    expect(g.z[0]).toBeCloseTo(TRAIL_Z_ANCHOR - BOWL_Z_HALF + TRAIL_GRID_CELL / 2, 9);
    expect(g.h.every((h) => h === 40)).toBe(true);
    expect(g.pass.every((p) => p === 1)).toBe(true);
  });
  it("marks a cell over the cap impassable, and its eight neighbours with it", () => {
    const g = buildTrailGrid(roadCenterX, ridged);
    const wall = cellOf(g, 315, 0);
    expect(g.pass[wall]).toBe(0);
    // The margin: the cell whose centre (u ≈ 292) is on FLAT ground but whose
    // +u neighbour (u ≈ 300, the ridge's own near edge) is on the ridge is
    // impassable too.
    //
    // 2026-09-11: these two probes moved from
    // (298, 290) to (292, 284) — BOWL_U_MIN 30 → 8 re-phases the grid's cell
    // boundaries against the ridge (cell centres now fall at u = 12, 20, 28,
    // …, not 34, 42, 50, …), so u = 298 no longer lands on a flat margin cell
    // — it lands on the ridge's own near-edge cell (centre 300, grad 3) —
    // and u = 290 no longer lands one cell further seaward of the margin
    // cell. The scenario is unchanged; only the grid's phase moved.
    expect(g.grad[cellOf(g, 292, 0)]).toBe(0);
    expect(g.pass[cellOf(g, 292, 0)]).toBe(0);
    // One more cell seaward (u ≈ 284) no neighbour is steep: passable.
    expect(g.pass[cellOf(g, 284, 0)]).toBe(1);
    // The gap is passable, its margin included: z = 120 sits 20 m from either lip.
    expect(g.pass[cellOf(g, 315, 120)]).toBe(1);
  });
  it("cellAt maps world points to cells and −1 outside the region", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    expect(cellOf(g, BOWL_U_MIN + 1, TRAIL_Z_ANCHOR - BOWL_Z_HALF + 1)).toBe(0);
    expect(cellOf(g, BOWL_U_MIN + 1 + TRAIL_GRID_CELL, TRAIL_Z_ANCHOR - BOWL_Z_HALF + 1)).toBe(1);
    expect(cellOf(g, BOWL_U_MIN - 1, 0)).toBe(-1);
    expect(cellOf(g, 500, BOWL_Z_HALF + 1)).toBe(-1);
    for (const c of [0, 1, g.nu - 1, g.nu, g.nu * g.nz - 1]) {
      expect(cellOf(g, g.x[c]! - ROAD_X, g.z[c]!)).toBe(c);
    }
  });
  it("resampleCells re-reads a disc of cells and their passability", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    const c = cellOf(g, 500, 0);
    resampleCells(g, ridged, g.x[c]!, g.z[c]!, 20); // ridged is flat here: nothing changes
    expect(g.h[c]).toBe(40);
    resampleCells(g, (x, z) => (Math.abs(x - g.x[c]!) < 5 && Math.abs(z - g.z[c]!) < 5 ? { h: 60, dx: 2, dz: 0 } : flat(x, z)), g.x[c]!, g.z[c]!, 20);
    expect(g.h[c]).toBe(60);
    expect(g.pass[c]).toBe(0);
    expect(g.pass[cellOf(g, 500 + TRAIL_GRID_CELL, 0)]).toBe(0); // the margin
    expect(g.pass[cellOf(g, 500 + 3 * TRAIL_GRID_CELL, 0)]).toBe(1);
  });
});

describe("searchFrom", () => {
  it("is a straight line on flat ground, deterministic, with plain lengths beside costs", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    const a = cellOf(g, 100, 0), b = cellOf(g, 500, 0);
    const s1 = searchFrom(g, a, null), s2 = searchFrom(g, a, null);
    expect(s1.dist[b]).toBeCloseTo(400, 6);
    expect(s1.len[b]).toBeCloseTo(400, 6);
    expect(Array.from(s1.prev)).toEqual(Array.from(s2.prev));
    const p = pathCells(s1, b);
    expect(p[0]).toBe(a);
    expect(p[p.length - 1]).toBe(b);
    expect(p.length).toBe(51); // 400 m / 8 m + 1
  });
  it("goes through the gap in a ridge, never through the ridge", () => {
    const g = buildTrailGrid(roadCenterX, ridged);
    const a = cellOf(g, 100, 0), b = cellOf(g, 600, 0);
    const s = searchFrom(g, a, null);
    expect(Number.isFinite(s.dist[b]!)).toBe(true);
    const p = pathCells(s, b);
    for (const c of p) {
      const u = g.x[c]! - ROAD_X;
      if (u >= 300 && u <= 330) expect(g.z[c]!).toBeGreaterThanOrEqual(100 - TRAIL_GRID_CELL);
      if (u >= 300 && u <= 330) expect(g.z[c]!).toBeLessThanOrEqual(140 + TRAIL_GRID_CELL);
    }
  });
  it("charges TRAIL_SLOPE_COST for climbing, so a level detour can beat a climb", () => {
    const g = buildTrailGrid(roadCenterX, ramp);
    const a = cellOf(g, 100, 0), b = cellOf(g, 100 + 8 * TRAIL_GRID_CELL, 0);
    const s = searchFrom(g, a, null);
    // Eight +x moves of 8 m at grade 0.5: cost = 8 · 8 · (1 + 2 · 0.5).
    expect(s.dist[b]).toBeCloseTo(8 * TRAIL_GRID_CELL * (1 + TRAIL_SLOPE_COST * 0.5), 6);
    expect(s.len[b]).toBeCloseTo(8 * TRAIL_GRID_CELL, 6);
  });
  it("discounts moves along the tree and never runs beside it: the two-cell rule", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    const a = cellOf(g, 100, 0);
    // A tree: the straight line from a to (500, 0).
    const tree = new Uint8Array(g.nu * g.nz);
    const first = searchFrom(g, a, null);
    for (const c of pathCells(first, cellOf(g, 500, 0))) tree[c] = 1;
    // A target one cell beside the tree's far end.
    const b = cellOf(g, 500, 2 * TRAIL_GRID_CELL);
    const s = searchFrom(g, a, tree);
    const p = pathCells(s, b);
    // Every cell of the path is on the tree, or is not an 8-neighbour of any
    // tree cell it is not itself part of — unless it was entered FROM the tree.
    for (let k = 1; k < p.length; k++) {
      const c = p[k]!, from = p[k - 1]!;
      if (tree[c] === 1 || tree[from] === 1) continue;
      const adj = cellNeighbours(g, c).some((n) => tree[n] === 1);
      expect(adj, `cell ${c} runs beside the tree`).toBe(false);
    }
    // The discount: the cost to the tree's far end is REUSE × the length.
    expect(s.dist[cellOf(g, 500, 0)]).toBeCloseTo(TRAIL_REUSE_FACTOR * 400, 6);
  });
  it("declares its tunables", () => {
    expect(Object.keys(TRAIL_GRID_TUNABLES).sort()).toEqual(["TRAIL_GRID_CAP", "TRAIL_GRID_CELL", "TRAIL_MOVE_GRADE_MAX", "TRAIL_REUSE_FACTOR", "TRAIL_SLOPE_COST"]);
    expect(TRAIL_GRID_CAP).toBeLessThan(0.9);
  });
  it("forbids a move steeper than TRAIL_MOVE_GRADE_MAX, so a steep cone is switchbacked instead of climbed", () => {
    // A cone of constant radial grade 0.8 (over TRAIL_MOVE_GRADE_MAX 0.7),
    // every cell forced passable (bypassing TRAIL_GRID_CAP entirely, so the
    // only thing that can stop a direct climb is the per-move cap this test
    // is for). A move straight toward the centre has dh/length = 0.8 exactly
    // — forbidden — so the search must find a longer, more tangential route.
    const cx = ROAD_X + 400, cz = 0;
    const cone: GroundFn = (x, z) => {
      const dx = x - cx, dz = z - cz;
      const d = Math.hypot(dx, dz) || 1e-9;
      return { h: 100 - 0.8 * d, dx: -0.8 * (dx / d), dz: -0.8 * (dz / d) };
    };
    const grid = buildTrailGrid(roadCenterX, cone);
    grid.pass.fill(1);
    const rim = cellOf(grid, 300, 0); // 100 m from the centre
    const centre = cellOf(grid, 400, 0);
    const s = searchFrom(grid, rim, null);
    const cells = pathCells(s, centre);
    expect(cells.length).toBeGreaterThan(0);
    let pathLen = 0;
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1]!, b = cells[k]!;
      const length = Math.hypot((grid.x[b]! - grid.x[a]!), (grid.z[b]! - grid.z[a]!));
      const dh = Math.abs(grid.h[b]! - grid.h[a]!);
      expect(dh / length, `move ${a}->${b}`).toBeLessThanOrEqual(TRAIL_MOVE_GRADE_MAX + 1e-9);
      pathLen += length;
    }
    // The straight line is 100 m; a switchbacked route is longer.
    expect(pathLen).toBeGreaterThan(100);
  });
  it("takes the cheap band round a forbidden disc instead of crossing it", () => {
    const grid = buildTrailGrid(roadCenterX, flat);
    const weight = new Float32Array(grid.pass.length).fill(1);
    const centreCell = cellOf(grid, 400, 0), leftOfDisc = cellOf(grid, 320, 0), rightOfDisc = cellOf(grid, 480, 0);
    const cx = grid.x[centreCell] as number, cz = grid.z[centreCell] as number;
    for (let c = 0; c < weight.length; c++) {
      const d = Math.hypot((grid.x[c] as number) - cx, (grid.z[c] as number) - cz);
      if (d < 40) weight[c] = 0;
      else if (d < 52) weight[c] = 0.35;
    }
    const s = searchFrom(grid, leftOfDisc, null, weight);
    const cells = pathCells(s, rightOfDisc);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const d = Math.hypot((grid.x[c] as number) - cx, (grid.z[c] as number) - cz);
      expect(d).toBeGreaterThanOrEqual(40 - 1e-9);
    }
    // Most of the route rides the band, not the open ground beyond it.
    const inBand = cells.filter((c) => Math.hypot((grid.x[c] as number) - cx, (grid.z[c] as number) - cz) < 52).length;
    expect(inBand / cells.length).toBeGreaterThan(0.6);
  });
  it("is the unweighted search when weight is null or all ones", () => {
    const grid = buildTrailGrid(roadCenterX, flat);
    const ones = new Float32Array(grid.pass.length).fill(1);
    const leftOfDisc = cellOf(grid, 320, 0);
    const a = searchFrom(grid, leftOfDisc, null, null), b = searchFrom(grid, leftOfDisc, null, ones);
    expect(Array.from(b.dist)).toEqual(Array.from(a.dist));
  });
});
