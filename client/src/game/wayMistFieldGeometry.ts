/**
 * The mist beyond the way's banks (docs/gameplay/2026-11-13-the-way-down.md):
 * on the tiers with no marched ground mist, the chase's mist goes on past the
 * way's own banks over all the ground round the eye, thicker than the banks,
 * so the way is the thinner lane through it. This file is its geometry and
 * its numbers, computed with no engine so it is tested as arithmetic;
 * wayMistField.ts follows the eye with it and `lite/wayFieldMesh.ts` makes the
 * mesh and the material.
 *
 * It is a square of FIELD_CELLS cells of FIELD_CELL_M round the eye, moved a
 * cell at a time as the eye moves, never by less, so nothing of it swims:
 * every vertex is a place in the world. On it lie sheets that follow the
 * ground (FIELD_SHEETS_M over it) and stand fins, on every FIELD_FIN_EVERY-th
 * line of the lattice both ways, which are what an eye looking level sees.
 * All of them read the way's own field of noise (wayLight.ts).
 *
 * The ground's height and the metres to the way are asked for a cell at a
 * time, a few a frame, the nearest the eye first, and kept by the cell's
 * place in the world: a step of one cell asks for one new row.
 *
 * Vertices, in order: each sheet's FIELD_CELLS × FIELD_CELLS, lowest first;
 * then each fin line's FIELD_CELLS feet and heads in pairs, a line along x
 * then a line along z for each FIELD_FIN_EVERY-th row and column. Each
 * carries FIELD_FLOATS numbers: its metres from the way's line (-1 where its
 * cell is not yet known, which draws nothing), its metres over the ground,
 * its kind (0 a sheet, 1 a fin), and the metres a fin's mist stands to.
 */
import { WAY_HEAD, WAY_LIFT_M } from "./wayLightGeometry.js";

export const FIELD_CELL_M = 3;
export const FIELD_CELLS = 25;
export const FIELD_SHEETS_M: readonly number[] = [0.25, 0.7, 1.25];
export const FIELD_FIN_EVERY = 2;
export const FIELD_FIN_TOP_M = 3;
/** Numbers a vertex carries. */
export const FIELD_FLOATS = 4;
/** Cells asked for in one frame, and the most metres from the way a cell remembers. */
export const FIELD_FILL_A_FRAME = 40;
export const FIELD_FAR_M = 12;
/** Metres off the way's line the field comes in over (where the way's own mist goes out: wayLightGeometry.ts WAY_EDGE_M, a test holds the two equal), and metres from the eye it fades out over. */
export const FIELD_FROM_M = 7;
export const FIELD_WHOLE_M = 10.5;
export const FIELD_RIM_M: readonly [number, number] = [22, 34];
/** How much a sheet and a fin veil at their thickest (the way's banks: 0.28 and 0.21), and the metres the sheets' mist stands to. */
export const FIELD_SHEET_STRENGTH = 0.8;
export const FIELD_FIN_STRENGTH = 0.6;
export const FIELD_TOP_M = 3.6;

const N = FIELD_CELLS, PER = N * N, HALF = (N - 1) / 2;
/** The fin lines: along x at a row, along z at a column. */
const LINES: readonly { along: "x" | "z"; at: number }[] = (() => {
  const lines: { along: "x" | "z"; at: number }[] = [];
  for (let q = 0; q < N; q += FIELD_FIN_EVERY) {
    lines.push({ along: "x", at: q });
    lines.push({ along: "z", at: q });
  }
  return lines;
})();
export const FIELD_SHEET_VERTICES = PER * FIELD_SHEETS_M.length;
export const FIELD_VERTICES = FIELD_SHEET_VERTICES + LINES.length * N * 2;
/** The square's cells, the nearest its middle first. */
const ORDER: readonly number[] = Array.from({ length: PER }, (_, c) => c).sort((a, b) => {
  const da = ((a % N) - HALF) ** 2 + (Math.floor(a / N) - HALF) ** 2, db = ((b % N) - HALF) ** 2 + (Math.floor(b / N) - HALF) ** 2;
  return da - db || a - b;
});
const UNKNOWN = 0x7fffffff;

/** What is known of the ground, a cell each, kept by the cell's place in the world wrapped onto the square. */
export type FieldCache = { h: Float32Array; dist: Float32Array; keyX: Int32Array; keyZ: Int32Array };
export function newFieldCache(): FieldCache {
  return { h: new Float32Array(PER), dist: new Float32Array(PER), keyX: new Int32Array(PER).fill(UNKNOWN), keyZ: new Int32Array(PER).fill(UNKNOWN) };
}
const slot = (cx: number, cz: number): number => (((cz % N) + N) % N) * N + (((cx % N) + N) % N);

/**
 * Asks for the cells of the square round cell (cellX, cellZ) that are not
 * known, the nearest its middle first, `most` at the most: each one's
 * ground and its metres to the way (FIELD_FAR_M at the most). Returns how
 * many it asked for: 0 once the square is whole.
 */
export function refreshField(cache: FieldCache, cellX: number, cellZ: number, heightAt: (x: number, z: number) => number, distanceAt: (x: number, z: number) => number, most: number): number {
  let filled = 0;
  for (let o = 0; o < PER && filled < most; o++) {
    const c = ORDER[o] as number, i = c % N, j = (c - i) / N;
    const wx = cellX - HALF + i, wz = cellZ - HALF + j, s = slot(wx, wz);
    if (cache.keyX[s] === wx && cache.keyZ[s] === wz) continue;
    cache.keyX[s] = wx;
    cache.keyZ[s] = wz;
    cache.h[s] = heightAt(wx * FIELD_CELL_M, wz * FIELD_CELL_M);
    const d = distanceAt(wx * FIELD_CELL_M, wz * FIELD_CELL_M);
    cache.dist[s] = d < FIELD_FAR_M ? d : FIELD_FAR_M;
    filled++;
  }
  return filled;
}

/** A fin at `run` metres along its line, the line `across` metres over: how far it wanders off the line and the metres its mist stands to. By the place in the world, so it is the same wherever the eye is. */
export function fieldFinAt(run: number, across: number): { wander: number; top: number } {
  return {
    wander: 1.4 * Math.sin(run * 0.19 + across * 1.7) + 0.8 * Math.sin(run * 0.071 - across * 0.9),
    top: FIELD_FIN_TOP_M * (1 + 0.22 * Math.sin(run * 0.13 + across * 0.7) + 0.14 * Math.sin(run * 0.31 + across)),
  };
}

/** The field's vertices for the square round cell (cellX, cellZ), from what `cache` knows: a cell not yet known stands by the eye's own height (`eyeY`) and says -1 metres from the way. */
export function fillField(out: { positions: Float32Array; field: Float32Array }, cellX: number, cellZ: number, cache: FieldCache, eyeY: number): void {
  const { positions, field } = out;
  const put = (v: number, x: number, z: number, s: number, wx: number, wz: number, up: number, kind: number, top: number): void => {
    const have = cache.keyX[s] === wx && cache.keyZ[s] === wz;
    positions[v * 3] = x;
    positions[v * 3 + 1] = (have ? (cache.h[s] as number) : eyeY - 1.7) + WAY_LIFT_M + up;
    positions[v * 3 + 2] = z;
    field[v * FIELD_FLOATS] = have ? (cache.dist[s] as number) : -1;
    field[v * FIELD_FLOATS + 1] = up;
    field[v * FIELD_FLOATS + 2] = kind;
    field[v * FIELD_FLOATS + 3] = top;
  };
  for (let k = 0; k < FIELD_SHEETS_M.length; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const wx = cellX - HALF + i, wz = cellZ - HALF + j;
        put(k * PER + j * N + i, wx * FIELD_CELL_M, wz * FIELD_CELL_M, slot(wx, wz), wx, wz, FIELD_SHEETS_M[k] as number, 0, 0);
      }
    }
  }
  for (let l = 0; l < LINES.length; l++) {
    const line = LINES[l] as { along: "x" | "z"; at: number };
    for (let q = 0; q < N; q++) {
      const i = line.along === "x" ? q : line.at, j = line.along === "x" ? line.at : q;
      const wx = cellX - HALF + i, wz = cellZ - HALF + j, s = slot(wx, wz);
      const run = (line.along === "x" ? wx : wz) * FIELD_CELL_M, across = (line.along === "x" ? wz : wx) * FIELD_CELL_M;
      const { wander, top } = fieldFinAt(run, across);
      const x = wx * FIELD_CELL_M + (line.along === "z" ? wander : 0), z = wz * FIELD_CELL_M + (line.along === "x" ? wander : 0);
      const v = FIELD_SHEET_VERTICES + (l * N + q) * 2;
      put(v, x, z, s, wx, wz, 0, 1, top);
      put(v + 1, x, z, s, wx, wz, top * WAY_HEAD, 1, top);
    }
  }
}

/** The triangles: each sheet's quads between its cells, and each fin line's quads between its pairs. */
export function fieldIndices(): Uint32Array {
  const out = new Uint32Array((FIELD_SHEETS_M.length * (N - 1) * (N - 1) + LINES.length * (N - 1)) * 6);
  let n = 0;
  const quad = (a: number, b: number, c: number, d: number): void => {
    out[n++] = a; out[n++] = c; out[n++] = b;
    out[n++] = b; out[n++] = c; out[n++] = d;
  };
  for (let k = 0; k < FIELD_SHEETS_M.length; k++) {
    for (let j = 0; j + 1 < N; j++) for (let i = 0; i + 1 < N; i++) {
      const a = k * PER + j * N + i;
      quad(a, a + 1, a + N, a + N + 1);
    }
  }
  for (let l = 0; l < LINES.length; l++) {
    for (let q = 0; q + 1 < N; q++) {
      const a = FIELD_SHEET_VERTICES + (l * N + q) * 2;
      quad(a, a + 1, a + 2, a + 3);
    }
  }
  return out;
}
