import { describe, expect, it } from "vitest";
import {
  FIELD_CELLS, FIELD_CELL_M, FIELD_FAR_M, FIELD_FILL_A_FRAME, FIELD_FIN_EVERY, FIELD_FIN_STRENGTH, FIELD_FIN_TOP_M, FIELD_FLOATS, FIELD_FROM_M, FIELD_RIM_M,
  FIELD_SHEETS_M, FIELD_SHEET_STRENGTH, FIELD_SHEET_VERTICES, FIELD_TOP_M, FIELD_VERTICES, FIELD_WHOLE_M,
  fieldFinAt, fieldIndices, fillField, newFieldCache, refreshField,
} from "../../src/game/wayMistFieldGeometry.js";
import { WAY_FIN_SHARE, WAY_HEAD, WAY_LIFT_M, WAY_SHEET_STRENGTH, WAY_VEIL_STRENGTH } from "../../src/game/wayLightGeometry.js";

const N = FIELD_CELLS, PER = N * N, HALF = (N - 1) / 2;
const ground = (x: number, z: number): number => 5 + 0.1 * x - 0.05 * z;
const off = (x: number, z: number): number => Math.abs(z);

describe("the mist beyond the way: its numbers", () => {
  it("is a square of 3 m cells round the eye, three sheets over the ground and a fin on every second line both ways", () => {
    expect([FIELD_CELL_M, FIELD_CELLS, FIELD_FIN_EVERY, FIELD_FIN_TOP_M, FIELD_FLOATS, FIELD_FILL_A_FRAME, FIELD_FAR_M]).toEqual([3, 25, 2, 3, 4, 40, 12]);
    expect(FIELD_SHEETS_M).toEqual([0.25, 0.7, 1.25]);
    expect(FIELD_SHEET_VERTICES).toBe(PER * 3);
    // Thirteen lines each way, a foot and a head at each of a line's 25 cells.
    expect(FIELD_VERTICES).toBe(PER * 3 + 26 * N * 2);
  });

  it("is thicker than the way's own banks, comes in where they go out, and fades out well short of its own edge", () => {
    expect([FIELD_SHEET_STRENGTH, FIELD_FIN_STRENGTH, FIELD_TOP_M]).toEqual([0.8, 0.6, 3.6]);
    // The owner's word: thicker beyond the way than the way's walls.
    expect(FIELD_SHEET_STRENGTH).toBeGreaterThan(WAY_SHEET_STRENGTH * 2);
    expect(FIELD_FIN_STRENGTH).toBeGreaterThan(WAY_VEIL_STRENGTH * WAY_FIN_SHARE * 2);
    // The banks are whole from 3.1 m off the line and gone by 6.4 m (wayLight.fragment.fx): the field fills as they fade.
    expect([FIELD_FROM_M, FIELD_WHOLE_M]).toEqual([3, 6.5]);
    expect(FIELD_RIM_M).toEqual([22, 34]);
    expect(FIELD_RIM_M[1]).toBeLessThan(HALF * FIELD_CELL_M);
  });
});

describe("the mist beyond the way: the ground it stands on", () => {
  it("asks for a few cells a call, the nearest to the eye first, each cell once", () => {
    const cache = newFieldCache();
    const asked: [number, number][] = [];
    const h = (x: number, z: number): number => { asked.push([x, z]); return ground(x, z); };
    expect(refreshField(cache, 10, -4, h, off, FIELD_FILL_A_FRAME)).toBe(FIELD_FILL_A_FRAME);
    expect(asked.length).toBe(FIELD_FILL_A_FRAME);
    // The first is the eye's own cell, and every one of the first forty is within four cells of it.
    expect(asked[0]).toEqual([10 * FIELD_CELL_M, -4 * FIELD_CELL_M]);
    for (const [x, z] of asked) expect(Math.hypot(x / FIELD_CELL_M - 10, z / FIELD_CELL_M + 4)).toBeLessThan(4.6);
    let calls = 1;
    while (refreshField(cache, 10, -4, h, off, FIELD_FILL_A_FRAME) > 0) calls++;
    expect(calls).toBe(Math.ceil(PER / FIELD_FILL_A_FRAME));
    expect(asked.length).toBe(PER);
    expect(new Set(asked.map(([x, z]) => `${x},${z}`)).size).toBe(PER);
    // The eye in the same cell: nothing more is asked.
    expect(refreshField(cache, 10, -4, h, off, FIELD_FILL_A_FRAME)).toBe(0);
    // A step of one cell: the one new row, no more.
    asked.length = 0;
    expect(refreshField(cache, 11, -4, h, off, FIELD_FILL_A_FRAME)).toBe(N);
    expect(asked.every(([x]) => x === (11 + HALF) * FIELD_CELL_M)).toBe(true);
  });

  it("stands each sheet's vertex on its cell's ground at its height, knowing how far off the way it is", () => {
    const cache = newFieldCache();
    while (refreshField(cache, 2, 3, ground, off, 1000) > 0) { /* fill */ }
    const out = { positions: new Float32Array(FIELD_VERTICES * 3), field: new Float32Array(FIELD_VERTICES * FIELD_FLOATS) };
    fillField(out, 2, 3, cache, 99);
    for (let k = 0; k < 3; k++) for (const [i, j] of [[0, 0], [12, 12], [24, 7]] as const) {
      const v = k * PER + j * N + i, x = (2 - HALF + i) * FIELD_CELL_M, z = (3 - HALF + j) * FIELD_CELL_M;
      expect([out.positions[v * 3], out.positions[v * 3 + 2]]).toEqual([x, z]);
      expect(out.positions[v * 3 + 1]).toBeCloseTo(ground(x, z) + WAY_LIFT_M + FIELD_SHEETS_M[k]!, 4);
      expect([...out.field.slice(v * 4, v * 4 + 4)]).toEqual([Math.fround(Math.min(FIELD_FAR_M, off(x, z))), Math.fround(FIELD_SHEETS_M[k]!), 0, 0]);
    }
  });

  it("a cell not yet asked for is drawn at nothing: its metres off the way are -1", () => {
    const cache = newFieldCache();
    refreshField(cache, 0, 0, ground, off, 1);
    const out = { positions: new Float32Array(FIELD_VERTICES * 3), field: new Float32Array(FIELD_VERTICES * FIELD_FLOATS) };
    fillField(out, 0, 0, cache, 50);
    const centre = HALF * N + HALF, corner = 0;
    expect(out.field[centre * 4]).toBeGreaterThanOrEqual(0);
    expect(out.field[corner * 4]).toBe(-1);
    expect(Number.isFinite(out.positions[corner * 3 + 1]!)).toBe(true);
  });

  it("a fin stands on every second line both ways, wandering off it by where it is in the world, its head built over its mist", () => {
    const cache = newFieldCache();
    while (refreshField(cache, 0, 0, ground, off, 1000) > 0) { /* fill */ }
    const out = { positions: new Float32Array(FIELD_VERTICES * 3), field: new Float32Array(FIELD_VERTICES * FIELD_FLOATS) };
    fillField(out, 0, 0, cache, 99);
    // The first line runs along x at the first row: its vertices are pairs, a foot and a head.
    for (const q of [0, 9, 24]) {
      const foot = FIELD_SHEET_VERTICES + q * 2, head = foot + 1;
      const run = (0 - HALF + q) * FIELD_CELL_M, across = (0 - HALF) * FIELD_CELL_M;
      const at = fieldFinAt(run, across);
      expect(out.positions[foot * 3]).toBeCloseTo(run, 4);
      expect(out.positions[foot * 3 + 2]).toBeCloseTo(across + at.wander, 4);
      expect(out.positions[head * 3 + 1]! - out.positions[foot * 3 + 1]!).toBeCloseTo(at.top * WAY_HEAD, 4);
      expect(out.field[foot * 4 + 2]).toBe(1);
      expect(out.field[head * 4 + 1]).toBeCloseTo(at.top * WAY_HEAD, 4);
      expect(out.field[head * 4 + 3]).toBeCloseTo(at.top, 4);
    }
    // It wanders no more than a cell's width either way and stands within two fifths of its height, the same wherever the eye is.
    for (let run = -200; run < 200; run += 3) {
      const at = fieldFinAt(run, 42);
      expect(Math.abs(at.wander)).toBeLessThanOrEqual(2.2 + 1e-9);
      expect(Math.abs(at.top / FIELD_FIN_TOP_M - 1)).toBeLessThanOrEqual(0.36 + 1e-9);
    }
    expect(fieldFinAt(30, 42)).toEqual(fieldFinAt(30, 42));
    expect(fieldFinAt(30, 42)).not.toEqual(fieldFinAt(33, 42));
  });

  it("every index is inside the mesh and no triangle is degenerate", () => {
    const indices = fieldIndices();
    // 24 by 24 quads a sheet, and 24 quads a fin.
    expect(indices.length).toBe((3 * 24 * 24 + 26 * 24) * 6);
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      expect(Math.max(a, b, c)).toBeLessThan(FIELD_VERTICES);
      expect(new Set([a, b, c]).size).toBe(3);
    }
  });
});
