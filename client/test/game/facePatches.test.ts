import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  faceMask,
  rockOfSlope,
  rockExtent,
  groundLoudness,
  facePatchCells,
  facePatchGeometry,
  facePatchStitch,
  groundBend,
  patchDepth,
  type FacePatch,
  type PatchCell,
  type PatchStitch,
  OPEN_EAST,
  OPEN_NORTH,
  OPEN_NORTH_EAST,
  OPEN_SOUTH,
  OPEN_SOUTH_EAST,
  OPEN_SOUTH_WEST,
  OPEN_WEST,
  PATCH_BEND_SHARE,
  PATCH_DEPTH,
  PATCH_REACH,
  GROUND_DEPTH,
  GROUND_LOUD_FLOOR,
  GROUND_LOUD_LO,
  GROUND_LOUD_HI,
} from "../../src/game/facePatches.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The scarp by the road: the reference pose's world. */
const SEED = 627994160;
const NONE: PatchStitch = { west: false, east: false, north: false, south: false, open: 0 };
const EAST: PatchStitch = { ...NONE, east: true };

function patch(ci: number, cj: number, spacing: number, stitch: PatchStitch = NONE): FacePatch {
  const p = facePatchGeometry(SEED, ci, cj, spacing, stitch);
  if (p === null) throw new Error(`no patch at (${ci}, ${cj})`);
  return p;
}

function bytes(a: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

describe("facePatchGeometry", () => {
  it("lays every vertex the reliefs leave alone on the field's height", () => {
    // Cell (−23, −57) is the scarp's foot: part flat, part steep, and the
    // ground between painted rock by its slope (2026-10-13), which the
    // walkable rock's relief moves too.
    const p = patch(-23, -57, 0.5);
    let flat = 0;
    let rock = 0;
    let steep = 0;
    for (let iz = 0; iz <= 32; iz++) {
      for (let ix = 0; ix <= 32; ix++) {
        const x = -23 * 16 + ix * 0.5;
        const z = -57 * 16 + iz * 0.5;
        const s = elevationSampleAt(SEED, x, z);
        const at = (iz * 33 + ix) * 3;
        const g = Math.hypot(s.dx, s.dz);
        if (faceMask(g) > 0) {
          steep++;
          continue;
        }
        if (rockOfSlope(g) > 0) {
          rock++;
          continue;
        }
        flat++;
        expect(p.positions[at]).toBe(Math.fround(x));
        expect(p.positions[at + 1]).toBe(Math.fround(s.h));
        expect(p.positions[at + 2]).toBe(Math.fround(z));
      }
    }
    expect(flat + rock).toBe(771);
    expect(rock).toBeGreaterThan(0);
    expect(steep).toBe(318);
  }, timeLimit(20_000));

  it("moves no vertex further than the depth its ground's bend leaves, and none into the ground", () => {
    let largest = 0;
    for (const [ci, cj, spacing] of [[-23, -57, 0.5], [-22, -57, 0.5], [-20, -57, 1]] as const) {
      const p = patch(ci, cj, spacing);
      const side = 16 / spacing + 1;
      for (let iz = 0; iz < side; iz++) {
        for (let ix = 0; ix < side; ix++) {
          const x = ci * 16 + ix * spacing;
          const z = cj * 16 + iz * spacing;
          const s = elevationSampleAt(SEED, x, z);
          const at = (iz * side + ix) * 3;
          const ox = (p.positions[at] as number) - x;
          const oy = (p.positions[at + 1] as number) - s.h;
          const oz = (p.positions[at + 2] as number) - z;
          // Float32 positions a few hundred metres out round within 1e-4 m.
          const push = Math.sqrt(ox * ox + oy * oy + oz * oz);
          if (faceMask(Math.hypot(s.dx, s.dz)) > 0) {
            expect(push).toBeLessThanOrEqual(patchDepth(groundBend(SEED, x, z, s)) + 0.0001);
          }
          largest = Math.max(largest, push);
          // Outward: along the ground's normal (−dx, 1, −dz), never against it.
          expect(-s.dx * ox + oy - s.dz * oz).toBeGreaterThanOrEqual(-0.0001);
        }
      }
    }
    // 2026-10-12: at most 2.0001 before the large forms and the 4 m depth.
    // Measured: 2.93, the bend's cap and the relief's range short of 4 here.
    expect(largest).toBeLessThanOrEqual(4.0001);
    expect(largest).toBeGreaterThan(2.93);
  }, timeLimit(20_000));

  it("keeps the push under half the radius of the ground's bend", () => {
    expect(PATCH_DEPTH).toBe(4);
    expect(PATCH_BEND_SHARE).toBe(0.5);
    expect(patchDepth(0)).toBe(4);
    // A bend of 1 per metre, a radius of 1 m: 4 / (1 + 8).
    expect(patchDepth(1)).toBe(4 / 9);
    for (const bend of [0.01, 0.1, 0.25, 1, 4, 100]) {
      expect(patchDepth(bend)).toBeLessThan(PATCH_DEPTH);
      expect(patchDepth(bend) * bend).toBeLessThan(PATCH_BEND_SHARE);
    }
    // The road's flat at the reference pose barely bends. A sharp ridge on
    // world 42, whose gradient turns from (−2.29, 1.01) to (1.17, −1.40) in
    // half a metre across its crest, bends on the crest and on both flanks,
    // which see it a step away: convex, but the mask that drops to nothing
    // on the crest would notch it.
    const at = (seed: number, x: number, z: number): number =>
      groundBend(seed, x, z, elevationSampleAt(seed, x, z));
    expect(at(SEED, -370, -900)).toBeLessThan(0.001);
    expect(at(42, 401.5, 555)).toBeGreaterThan(3);
    expect(at(42, 401.5, 554.5)).toBeGreaterThan(0.37);
    expect(at(42, 401, 555)).toBeGreaterThan(0.93);
  }, timeLimit(20_000));

  it("gives every vertex a unit normal, stitched or not", () => {
    for (const p of [patch(-23, -57, 0.5), patch(-21, -57, 0.5, EAST), patch(-20, -57, 1)]) {
      for (let v = 0; v < p.vertexCount; v++) {
        const nx = p.normals[v * 3] as number;
        const ny = p.normals[v * 3 + 1] as number;
        const nz = p.normals[v * 3 + 2] as number;
        expect(Math.abs(Math.sqrt(nx * nx + ny * ny + nz * nz) - 1)).toBeLessThan(1e-6);
      }
    }
  }, timeLimit(20_000));

  it("shares a boundary with its neighbour bit for bit", () => {
    // (−23, −57)'s east edge is (−22, −57)'s west edge, x = −352.
    const west = patch(-23, -57, 0.5);
    const east = patch(-22, -57, 0.5);
    for (let iz = 0; iz <= 32; iz++) {
      const a = (iz * 33 + 32) * 3;
      const b = (iz * 33) * 3;
      for (let c = 0; c < 3; c++) {
        expect(west.positions[a + c]).toBe(east.positions[b + c]);
        expect(west.normals[a + c]).toBe(east.normals[b + c]);
      }
    }
  }, timeLimit(20_000));

  /** The paint of vertex `v`: colour, weights, weights2 and cover. */
  function paint(p: FacePatch, v: number): number[] {
    return [
      ...p.colors.subarray(v * 4, v * 4 + 4),
      ...p.weights.subarray(v * 4, v * 4 + 4),
      ...p.weights2.subarray(v * 4, v * 4 + 4),
      p.cover[v] as number,
    ];
  }

  /**
   * A fine patch's edge stitched to a coarse one's: the edge's n + 1 fine
   * vertices from `fineStart` in steps of `fineStride`, and the coarse
   * patch's n / 2 + 1 from `coarseStart` in steps of `coarseStride`. Returns
   * how many midpoints the stitch moved off the relief.
   */
  function checkStitch(
    fine: FacePatch, loose: FacePatch, coarse: FacePatch,
    fineStart: number, fineStride: number, coarseStart: number, coarseStride: number, n = 32,
  ): number {
    let moved = 0;
    for (let i = 0; i <= n; i++) {
      const v = fineStart + i * fineStride;
      const f = v * 3;
      if (i % 2 === 0) {
        // The shared points: the coarse patch's own, position, normal and
        // paint. The normal is the displaced surface's at the world point,
        // from the field's derivatives, so the two spacings give it alike
        // with no special case.
        const cv = coarseStart + (i / 2) * coarseStride;
        for (let k = 0; k < 3; k++) {
          expect(fine.positions[f + k]).toBe(coarse.positions[cv * 3 + k]);
          expect(fine.normals[f + k]).toBe(coarse.normals[cv * 3 + k]);
        }
        expect(paint(fine, v)).toEqual(paint(coarse, cv));
        continue;
      }
      // A midpoint: the mean of its two neighbours on the edge, as the
      // coarse patch interpolates its edge, position and paint.
      const lo = v - fineStride;
      const hi = v + fineStride;
      for (let k = 0; k < 3; k++) {
        expect(fine.positions[f + k]).toBe(Math.fround(((fine.positions[lo * 3 + k] as number) + (fine.positions[hi * 3 + k] as number)) / 2));
      }
      const a = paint(fine, lo);
      const b = paint(fine, hi);
      expect(paint(fine, v)).toEqual(a.map((x, k) => Math.fround((x + (b[k] as number)) / 2)));
      if (fine.positions[f + 1] !== loose.positions[f + 1]) moved++;
    }
    return moved;
  }

  it("lays a fine patch's stitched edge on the coarse patch's, east and west", () => {
    // (−21, −57) is fine; (−20, −57), east of it, is coarse.
    const fine = patch(-21, -57, 0.5, EAST);
    const loose = patch(-21, -57, 0.5);
    const coarse = patch(-20, -57, 1);
    // Of the sixteen midpoints, the relief had lifted every one off the chord.
    expect(checkStitch(fine, loose, coarse, 32, 33, 0, 17)).toBe(16);
    // The rest of the patch is the patch unstitched.
    for (let iz = 0; iz <= 32; iz++) {
      for (let ix = 0; ix < 32; ix++) {
        const at = (iz * 33 + ix) * 3;
        for (let k = 0; k < 3; k++) expect(fine.positions[at + k]).toBe(loose.positions[at + k]);
      }
    }
  }, timeLimit(20_000));

  it("lays a fine patch's stitched edge on the coarse patch's, north and south", () => {
    // (−25, −59) is fine; (−25, −60), south of it, is coarse: the fine
    // patch's row 0 is the coarse patch's row 16.
    const fine = patch(-25, -59, 0.5, { ...NONE, south: true });
    const loose = patch(-25, -59, 0.5);
    const coarse = patch(-25, -60, 1);
    expect(checkStitch(fine, loose, coarse, 0, 1, 16 * 17, 1)).toBe(16);
    for (let at = 33 * 3; at < fine.positions.length; at++) {
      expect(fine.positions[at]).toBe(loose.positions[at]);
    }
  }, timeLimit(20_000));

  it("lays a 1 m patch's stitched edge on a 2 m patch's, east and west", () => {
    // (−20, −66) is at 1 m on the 160 m reach's edge; (−19, −66), east of
    // it, is at 2 m: the 1 m patch's column 16 is the 2 m patch's column 0.
    const fine = patch(-20, -66, 1, EAST);
    const loose = patch(-20, -66, 1);
    const coarse = patch(-19, -66, 2);
    // Of the eight midpoints, the relief had lifted every one off the chord.
    expect(checkStitch(fine, loose, coarse, 16, 17, 0, 9, 16)).toBe(8);
    for (let iz = 0; iz <= 16; iz++) {
      for (let ix = 0; ix < 16; ix++) {
        const at = (iz * 17 + ix) * 3;
        for (let k = 0; k < 3; k++) expect(fine.positions[at + k]).toBe(loose.positions[at + k]);
      }
    }
  }, timeLimit(20_000));

  it("lays a 1 m patch's stitched edge on a 2 m patch's, north and south", () => {
    // (−22, −66) is at 1 m; (−22, −67), south of it, is at 2 m: the 1 m
    // patch's row 0 is the 2 m patch's row 8.
    const fine = patch(-22, -66, 1, { ...NONE, south: true });
    const loose = patch(-22, -66, 1);
    const coarse = patch(-22, -67, 2);
    expect(checkStitch(fine, loose, coarse, 0, 1, 8 * 9, 1, 16)).toBe(8);
    for (let at = 17 * 3; at < fine.positions.length; at++) {
      expect(fine.positions[at]).toBe(loose.positions[at]);
    }
  }, timeLimit(20_000));

  it("fades the relief out toward a cell outside the set", () => {
    // (−22, −66) with its south, south-west and south-east neighbours not
    // drawn, as on a straight run of a reach's southern edge.
    const open = OPEN_SOUTH | OPEN_SOUTH_WEST | OPEN_SOUTH_EAST;
    const edge = patch(-22, -66, 1, { ...NONE, open });
    const whole = patch(-22, -66, 1);
    let lifted = 0;
    for (let ix = 0; ix <= 16; ix++) {
      const x = -22 * 16 + ix;
      const z = -66 * 16;
      const s = elevationSampleAt(SEED, x, z);
      // On the open edge, nothing: the patch meets the ground.
      expect(edge.positions[ix * 3]).toBe(Math.fround(x));
      expect(edge.positions[ix * 3 + 1]).toBe(Math.fround(s.h));
      expect(edge.positions[ix * 3 + 2]).toBe(Math.fround(z));
      if (whole.positions[ix * 3 + 1] !== edge.positions[ix * 3 + 1]) lifted++;
    }
    // The whole patch had lifted the edge there.
    expect(lifted).toBe(17);
    // From PATCH_TAPER (3 m) in, the whole relief.
    for (let at = 3 * 17 * 3; at < edge.positions.length; at++) {
      expect(edge.positions[at]).toBe(whole.positions[at]);
      expect(edge.normals[at]).toBe(whole.normals[at]);
    }
  }, timeLimit(20_000));

  it("leans its normals with the taper's ramp", () => {
    // The same cell at 0.5 m: over the ramp's rows 1 to 6, each vertex's
    // normal against the one its grid neighbours' differences give. The
    // grid cannot resolve a joint, so a few points stay far off; the mean
    // is the ramp's lean. Without the taper's derivative in the normal the
    // mean was 31.6°.
    const p = patch(-22, -66, 0.5, { ...NONE, open: OPEN_SOUTH | OPEN_SOUTH_WEST | OPEN_SOUTH_EAST });
    const q = p.positions;
    const d = (a: number, b: number): number[] => [0, 1, 2].map((k) => (q[a * 3 + k] as number) - (q[b * 3 + k] as number));
    let sum = 0;
    let n = 0;
    for (let iz = 1; iz <= 6; iz++) {
      for (let ix = 1; ix < 32; ix++) {
        const v = iz * 33 + ix;
        const [ux, uy, uz] = d(v + 1, v - 1) as [number, number, number];
        const [wx, wy, wz] = d(v + 33, v - 33) as [number, number, number];
        const nx = wy * uz - wz * uy;
        const ny = wz * ux - wx * uz;
        const nz = wx * uy - wy * ux;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const dot = (nx * (p.normals[v * 3] as number) + ny * (p.normals[v * 3 + 1] as number) + nz * (p.normals[v * 3 + 2] as number)) / len;
        sum += (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
        n++;
      }
    }
    // Measured: 14.7°.
    // 2026-10-12: 12.2° (bar 13°) before the relief's gain.
    expect(n).toBe(186);
    expect(sum / n).toBeLessThan(15.5);
  }, timeLimit(20_000));

  it("meets its neighbour bit for bit where one fades at a side and the other at a corner", () => {
    // At a step of a reach's edge: (−16, −51) with its north, east and
    // north-east neighbours outside the set, (−17, −51), west of it, with
    // only its north-east, which is the other's north. Their shared edge,
    // x = −256, fades toward that square in both.
    // 2026-10-12: (−18, −50) and (−17, −50) before the relief's gain, which
    // holds the three points there at the clamp's −1, a push of nothing with
    // the fade or without it.
    const west = patch(-17, -51, 1, { ...NONE, open: OPEN_NORTH_EAST });
    const east = patch(-16, -51, 1, { ...NONE, open: OPEN_NORTH | OPEN_EAST | OPEN_NORTH_EAST });
    const whole = patch(-17, -51, 1);
    let faded = 0;
    for (let iz = 0; iz <= 16; iz++) {
      const a = (iz * 17 + 16) * 3;
      const b = (iz * 17) * 3;
      for (let c = 0; c < 3; c++) {
        expect(west.positions[a + c]).toBe(east.positions[b + c]);
        expect(west.normals[a + c]).toBe(east.normals[b + c]);
      }
      if (west.positions[a + 1] !== whole.positions[a + 1]) faded++;
    }
    // The three points within PATCH_TAPER of the square.
    expect(faded).toBe(3);
  }, timeLimit(20_000));

  it("has no patch where no point of the cell is steep or painted rock", () => {
    // A cell of the flat south of the scarp, no point of it over a gradient
    // of 0.3. The camera's own cell at the reference pose, the road's flat,
    // had none before the walkable rock; its banks are painted rock.
    expect(facePatchGeometry(SEED, -29, -81, 0.5, NONE)).toBeNull();
    expect(facePatchGeometry(SEED, -29, -81, 1, NONE)).toBeNull();
    expect(facePatchGeometry(SEED, -24, -57, 1, NONE)).not.toBeNull();
  }, timeLimit(20_000));

  it("patches the walkable rock: the rocky slope above the trail, no point of it steep", () => {
    // The hillside at (−168, −1740): rock-of-slope 1 over its 48 m window,
    // no face. Every vertex is pushed out along the normal by at most
    // GROUND_DEPTH at full loudness, and none into the ground.
    const ci = Math.floor(-168 / 16);
    const cj = Math.floor(-1740 / 16);
    const p = patch(ci, cj, 1);
    let moved = 0;
    let most = 0;
    for (let iz = 0; iz <= 16; iz++) {
      for (let ix = 0; ix <= 16; ix++) {
        const x = ci * 16 + ix;
        const z = cj * 16 + iz;
        const s = elevationSampleAt(SEED, x, z);
        expect(faceMask(Math.hypot(s.dx, s.dz))).toBe(0);
        const at = (iz * 17 + ix) * 3;
        const dx = (p.positions[at] as number) - x;
        const dy = (p.positions[at + 1] as number) - s.h;
        const dz = (p.positions[at + 2] as number) - z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 0) moved++;
        most = Math.max(most, d);
        // Out along the normal (−h_x, 1, −h_z): never down into the ground
        // (the positions are float32, at 70 m a step of 8e-6).
        expect(dy).toBeGreaterThanOrEqual(-1e-4);
      }
    }
    expect(moved).toBeGreaterThan(200);
    expect(most).toBeLessThanOrEqual(GROUND_DEPTH + 1e-6);
    expect(most).toBeGreaterThan(GROUND_DEPTH * 0.5);
  }, timeLimit(20_000));

  it("is louder the wider the rock: the extent and its loudness", () => {
    expect(rockExtent(SEED, -168, -1740)).toBe(1);
    expect(groundLoudness(1)).toBe(1);
    // The road under the scarp: no rock-of-slope at the pose or 10 m about it.
    expect(rockExtent(SEED, -370, -900)).toBe(0);
    expect(groundLoudness(0)).toBe(GROUND_LOUD_FLOOR);
    expect(groundLoudness(GROUND_LOUD_LO)).toBe(GROUND_LOUD_FLOOR);
    expect(groundLoudness(GROUND_LOUD_HI)).toBe(1);
    expect(groundLoudness((GROUND_LOUD_LO + GROUND_LOUD_HI) / 2)).toBeCloseTo((1 + GROUND_LOUD_FLOOR) / 2, 12);
    // A corner of the road's cell: part way, between the two.
    const e = rockExtent(SEED, -24 * 16, -57 * 16);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(1);
  }, timeLimit(20_000));

  it("is the same patch whatever was built before it", () => {
    const first = patch(-22, -57, 0.5);
    patch(-20, -56, 1);
    patch(-23, -57, 0.5, { west: true, east: false, north: true, south: false, open: OPEN_NORTH_EAST });
    const again = patch(-22, -57, 0.5);
    expect(bytes(again.positions)).toEqual(bytes(first.positions));
    expect(bytes(again.normals)).toEqual(bytes(first.normals));
    expect(bytes(again.colors)).toEqual(bytes(first.colors));
    expect(bytes(again.weights)).toEqual(bytes(first.weights));
    expect(bytes(again.weights2)).toEqual(bytes(first.weights2));
    expect(bytes(again.cover)).toEqual(bytes(first.cover));
    expect(bytes(again.indices)).toEqual(bytes(first.indices));
  }, timeLimit(20_000));

  it("winds its triangles in the clipmap's order", () => {
    const p = patch(-22, -57, 0.5);
    expect(p.vertexCount).toBe(1089);
    expect(p.triangleCount).toBe(2048);
    expect(p.indices.length).toBe(6144);
    // Each quad from its corner a = (ix, iz): a, a + 1, a + 33, then
    // a + 1, a + 34, a + 33 (`ringGeometry`'s order, which faces up in Babylon).
    for (const [ix, iz] of [[0, 0], [31, 0], [0, 31], [17, 9], [31, 31]] as const) {
      const q = (iz * 32 + ix) * 6;
      const a = iz * 33 + ix;
      expect(Array.from(p.indices.subarray(q, q + 6))).toEqual([a, a + 1, a + 33, a + 1, a + 34, a + 33]);
    }
  }, timeLimit(20_000));
});

/** The reference pose's cells, their stitches and their patches. */
function scarpPatches(): Array<{ cell: PatchCell; stitch: PatchStitch; patch: FacePatch | null }> {
  const cells = facePatchCells(-370, -900, PATCH_REACH.high);
  const stitch = facePatchStitch(cells);
  return cells.map((cell, i) => {
    const st = stitch[i] as PatchStitch;
    return { cell, stitch: st, patch: facePatchGeometry(SEED, cell.ci, cell.cj, cell.spacing, st) };
  });
}

/** The unit normal of triangle (a, b, c) of the positions `p`. */
function facet(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = (p[b * 3] as number) - (p[a * 3] as number);
  const uy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number);
  const uz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
  const vx = (p[c * 3] as number) - (p[a * 3] as number);
  const vy = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number);
  const vz = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / len, ny / len, nz / len];
}

/**
 * Each triangle of patch `p` of `cell` against the same three grid points'
 * facet on the ground of world `seed`: a fold faces the other way. Returns
 * the folds and the least cosine between the two facets.
 */
function foldsOf(seed: number, cell: PatchCell, p: FacePatch): { folds: number; least: number } {
  const side = 16 / cell.spacing + 1;
  const ground = new Float64Array(p.vertexCount * 3);
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = cell.ci * 16 + ix * cell.spacing;
      const z = cell.cj * 16 + iz * cell.spacing;
      const at = (iz * side + ix) * 3;
      ground[at] = x;
      ground[at + 1] = elevationSampleAt(seed, x, z).h;
      ground[at + 2] = z;
    }
  }
  let folds = 0;
  let least = Infinity;
  for (let t = 0; t < p.indices.length; t += 3) {
    const a = p.indices[t] as number;
    const b = p.indices[t + 1] as number;
    const c = p.indices[t + 2] as number;
    const d = facet(p.positions, a, b, c);
    const u = facet(ground, a, b, c);
    const dot = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    if (dot <= 0) folds++;
    least = Math.min(least, dot);
  }
  return { folds, least };
}

describe("facePatchCells and facePatchStitch", () => {
  it("picks the cells within reach, fine near the camera, and stitches each to a coarser one", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    // 2026-10-12: 316 cells, 29 and 287, before the wide band to 400 m.
    expect(cells.length).toBe(1963);
    expect(cells.filter((c) => c.spacing === 0.5).length).toBe(29);
    expect(cells.filter((c) => c.spacing === 1).length).toBe(287);
    expect(cells.filter((c) => c.spacing === 2).length).toBe(1647);
    const stitch = facePatchStitch(cells);
    const at = (ci: number, cj: number): PatchStitch => stitch[cells.findIndex((c) => c.ci === ci && c.cj === cj)] as PatchStitch;
    expect(at(-21, -57)).toEqual({ west: false, east: true, north: false, south: false, open: 0 });
    expect(at(-25, -59)).toEqual({ west: true, east: false, north: false, south: true, open: 0 });
    expect(at(-24, -57)).toEqual(NONE);
    // A 1 m cell among 1 m cells stitches nothing; one beside the 2 m band
    // stitches to it.
    expect(at(-20, -57)).toEqual(NONE);
    expect(at(-20, -66)).toEqual({ west: false, east: true, north: false, south: true, open: 0 });
    // The coarsest band stitches nothing.
    expect(at(-19, -66)).toEqual(NONE);
    // 2026-10-12: 15, the 0.5 m cells alone, before the wide band.
    expect(stitch.filter((s) => s.west || s.east || s.north || s.south).length).toBe(70);
    expect(stitch.filter((s, i) => (cells[i] as PatchCell).spacing === 1 && (s.west || s.east || s.north || s.south)).length).toBe(55);
  });

  it("flags the neighbours outside the set, sides and corners", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    const stitch = facePatchStitch(cells);
    const at = (ci: number, cj: number): PatchStitch => stitch[cells.findIndex((c) => c.ci === ci && c.cj === cj)] as PatchStitch;
    // The wide reach's southern edge, a straight run of it.
    expect(at(-22, -81).open).toBe(OPEN_SOUTH | OPEN_SOUTH_WEST | OPEN_SOUTH_EAST);
    // A step of the edge: south and east open, and the corners beside.
    expect(at(-18, -81).open).toBe(OPEN_EAST | OPEN_SOUTH | OPEN_SOUTH_WEST | OPEN_SOUTH_EAST);
    // Inside the set, nothing, on the 160 m reach's old edge too.
    expect(at(-24, -57).open).toBe(0);
    expect(at(-22, -66).open).toBe(0);
    // The cells on the set's edge: 139 with a side open, and 57 more open
    // only at a corner, where the edge steps in, whose relief fades there too.
    // 2026-10-12: 55 and 21 more, at the 160 m reach, before the wide band.
    const sides = OPEN_WEST | OPEN_EAST | OPEN_SOUTH | OPEN_NORTH;
    expect(stitch.filter((s) => s.open !== 0).length).toBe(196);
    expect(stitch.filter((s) => (s.open & sides) !== 0).length).toBe(139);
    expect(at(-18, -80).open).toBe(OPEN_SOUTH_EAST);
  });

  it("at the scarp, patches the cells with steep or rock-painted ground: the counts", () => {
    let near = 0;
    let far = 0;
    let wide = 0;
    let vertices = 0;
    let triangles = 0;
    for (const { cell, patch: p } of scarpPatches()) {
      if (p === null) continue;
      if (cell.spacing === 0.5) near++;
      else if (cell.spacing === 1) far++;
      else wide++;
      vertices += p.vertexCount;
      triangles += p.triangleCount;
    }
    // 2026-10-13: 20, 121 and 221, 74,650 vertices and 131,200 triangles,
    // before the walkable rock patched the cells painted rock.
    expect(near).toBe(22);
    expect(far).toBe(161);
    expect(wide).toBe(577);
    // 2026-10-12: 56,749 vertices and 102,912 triangles before the wide band.
    expect(vertices).toBe(117224);
    expect(triangles).toBe(201344);
  }, timeLimit(120_000));

  it("at the scarp, turns no triangle over", () => {
    // The worst, at 0.5 m on the scarp's steepest columns, still faces
    // within 80° of the ground's.
    let folds = 0;
    let least = Infinity;
    for (const { cell, patch: p } of scarpPatches()) {
      if (p === null) continue;
      const f = foldsOf(SEED, cell, p);
      folds += f.folds;
      least = Math.min(least, f.least);
    }
    expect(folds).toBe(0);
    // 2026-10-12: 0.390 before the relief's tilted planes and the doubled
    // depth; 0.349 at 2 m before the large forms, the 4 m depth and the cap
    // by the ground's bend; 0.303 before the relief's gain; above 0.215
    // before the relief's cells grew.
    expect(least).toBeCloseTo(0.1853, 4);
  }, timeLimit(60_000));

  it("turns no triangle over on a sharp ridge of another world", () => {
    // World 42's cell (25, 34) at 0.5 m, across the ridge whose crest the
    // mask leaves bare: without the cap by the ground's bend, 12 triangles
    // there turned over at the 4 m depth, the worst to −0.74.
    const cell: PatchCell = { ci: 25, cj: 34, spacing: 0.5 };
    const p = facePatchGeometry(42, cell.ci, cell.cj, cell.spacing, NONE);
    if (p === null) throw new Error("no patch at (25, 34)");
    const f = foldsOf(42, cell, p);
    expect(f.folds).toBe(0);
    // 2026-10-13: 0.2634 before the walkable rock's push on the ridge's
    // flanks. 2026-10-12: 0.3487 before the relief's gain; 0.2664 before the
    // relief's cells grew.
    expect(f.least).toBeCloseTo(0.2641, 4);
  }, timeLimit(20_000));
});
