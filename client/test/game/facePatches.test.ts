import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  faceMask,
  facePatchCells,
  facePatchGeometry,
  facePatchStitch,
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
  PATCH_REACH,
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
  it("lays every vertex the relief leaves alone on the field's height", () => {
    // Cell (−23, −57) is the scarp's foot: part flat, part steep.
    const p = patch(-23, -57, 0.5);
    let flat = 0;
    let steep = 0;
    for (let iz = 0; iz <= 32; iz++) {
      for (let ix = 0; ix <= 32; ix++) {
        const x = -23 * 16 + ix * 0.5;
        const z = -57 * 16 + iz * 0.5;
        const s = elevationSampleAt(SEED, x, z);
        const at = (iz * 33 + ix) * 3;
        if (faceMask(Math.hypot(s.dx, s.dz)) > 0) {
          steep++;
          continue;
        }
        flat++;
        expect(p.positions[at]).toBe(Math.fround(x));
        expect(p.positions[at + 1]).toBe(Math.fround(s.h));
        expect(p.positions[at + 2]).toBe(Math.fround(z));
      }
    }
    expect(flat).toBe(771);
    expect(steep).toBe(318);
  }, timeLimit(20_000));

  it("moves no vertex further than the relief's depth, and none into the ground", () => {
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
          // 2026-10-12: 1.2001 before the depth was doubled to 2 m.
          expect(Math.sqrt(ox * ox + oy * oy + oz * oz)).toBeLessThanOrEqual(2.0001);
          // Outward: along the ground's normal (−dx, 1, −dz), never against it.
          expect(-s.dx * ox + oy - s.dz * oz).toBeGreaterThanOrEqual(-0.0001);
        }
      }
    }
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
   * A fine patch's edge stitched to a coarse one's: the edge's 33 fine
   * vertices from `fineStart` in steps of `fineStride`, and the coarse
   * patch's 17 from `coarseStart` in steps of `coarseStride`. Returns how
   * many midpoints the stitch moved off the relief.
   */
  function checkStitch(
    fine: FacePatch, loose: FacePatch, coarse: FacePatch,
    fineStart: number, fineStride: number, coarseStart: number, coarseStride: number,
  ): number {
    let moved = 0;
    for (let i = 0; i <= 32; i++) {
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

  it("fades the relief out toward a cell outside the set", () => {
    // (−22, −66) is on the far reach's southern edge: its south, south-west
    // and south-east neighbours are not drawn.
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

  it("meets its neighbour bit for bit where one fades at a side and the other at a corner", () => {
    // At a step of the far reach's edge: (−17, −50) has its north, east and
    // north-east neighbours outside the set, (−18, −50), west of it, only its
    // north-east, which is the other's north. Their shared edge, x = −272,
    // fades toward that square in both.
    const west = patch(-18, -50, 1, { ...NONE, open: OPEN_NORTH_EAST });
    const east = patch(-17, -50, 1, { ...NONE, open: OPEN_NORTH | OPEN_EAST | OPEN_NORTH_EAST });
    const whole = patch(-18, -50, 1);
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

  it("has no patch where no point of the cell is steep", () => {
    // The camera's own cell at the reference pose: the road's flat.
    expect(facePatchGeometry(SEED, -24, -57, 0.5, NONE)).toBeNull();
    expect(facePatchGeometry(SEED, -24, -57, 1, NONE)).toBeNull();
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

describe("facePatchCells and facePatchStitch", () => {
  it("picks the cells within reach, fine near the camera, and stitches fine to coarse", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    expect(cells.length).toBe(316);
    expect(cells.filter((c) => c.spacing === 0.5).length).toBe(29);
    expect(cells.filter((c) => c.spacing === 1).length).toBe(287);
    const stitch = facePatchStitch(cells);
    const at = (ci: number, cj: number): PatchStitch => stitch[cells.findIndex((c) => c.ci === ci && c.cj === cj)] as PatchStitch;
    expect(at(-21, -57)).toEqual({ west: false, east: true, north: false, south: false, open: 0 });
    expect(at(-25, -59)).toEqual({ west: true, east: false, north: false, south: true, open: 0 });
    expect(at(-24, -57)).toEqual(NONE);
    // A coarse cell stitches nothing.
    expect(at(-20, -57)).toEqual(NONE);
    expect(stitch.filter((s) => s.west || s.east || s.north || s.south).length).toBe(15);
  });

  it("flags the neighbours outside the set, sides and corners", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    const stitch = facePatchStitch(cells);
    const at = (ci: number, cj: number): PatchStitch => stitch[cells.findIndex((c) => c.ci === ci && c.cj === cj)] as PatchStitch;
    // The far reach's southern edge, a straight run of it.
    expect(at(-22, -66).open).toBe(OPEN_SOUTH | OPEN_SOUTH_WEST | OPEN_SOUTH_EAST);
    // A step of the edge: north and east open, and the corner between.
    expect(at(-17, -50).open).toBe(OPEN_EAST | OPEN_NORTH | OPEN_NORTH_EAST);
    // Inside the set, nothing.
    expect(at(-24, -57).open).toBe(0);
    // The cells on the set's edge: 55 with a side open, and 21 more open only
    // at a corner, where the edge steps in, whose relief fades there too.
    const sides = OPEN_WEST | OPEN_EAST | OPEN_SOUTH | OPEN_NORTH;
    expect(stitch.filter((s) => s.open !== 0).length).toBe(76);
    expect(stitch.filter((s) => (s.open & sides) !== 0).length).toBe(55);
    expect(at(-18, -50).open).toBe(OPEN_NORTH_EAST);
  });

  it("at the scarp, patches the cells with steep ground: the counts", () => {
    let near = 0;
    let far = 0;
    let vertices = 0;
    let triangles = 0;
    for (const { cell, patch: p } of scarpPatches()) {
      if (p === null) continue;
      if (cell.spacing === 0.5) near++;
      else far++;
      vertices += p.vertexCount;
      triangles += p.triangleCount;
    }
    expect(near).toBe(20);
    expect(far).toBe(121);
    expect(vertices).toBe(56749);
    expect(triangles).toBe(102912);
  }, timeLimit(60_000));

  it("at the scarp, turns no triangle over", () => {
    // Each triangle's facet against the same three grid points' facet on the
    // ground: a fold faces the other way. The worst, at 0.5 m on the scarp's
    // steepest columns, still faces within 70° of the ground's.
    let folds = 0;
    let least = Infinity;
    for (const { cell, patch: p } of scarpPatches()) {
      if (p === null) continue;
      const side = 16 / cell.spacing + 1;
      const ground = new Float64Array(p.vertexCount * 3);
      for (let iz = 0; iz < side; iz++) {
        for (let ix = 0; ix < side; ix++) {
          const x = cell.ci * 16 + ix * cell.spacing;
          const z = cell.cj * 16 + iz * cell.spacing;
          const at = (iz * side + ix) * 3;
          ground[at] = x;
          ground[at + 1] = elevationSampleAt(SEED, x, z).h;
          ground[at + 2] = z;
        }
      }
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
    }
    expect(folds).toBe(0);
    // 2026-10-12: 0.390 before the relief's tilted planes and the doubled depth.
    expect(least).toBeGreaterThan(0.349);
  }, timeLimit(60_000));
});
