import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  faceMask,
  facePatchCells,
  facePatchGeometry,
  facePatchStitch,
  type FacePatch,
  type PatchStitch,
  PATCH_REACH,
} from "../../src/game/facePatches.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** The scarp by the road: the reference pose's world. */
const SEED = 627994160;
const NONE: PatchStitch = { west: false, east: false, north: false, south: false };

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
          expect(Math.sqrt(ox * ox + oy * oy + oz * oz)).toBeLessThanOrEqual(1.2001);
          // Outward: along the ground's normal (−dx, 1, −dz), never against it.
          expect(-s.dx * ox + oy - s.dz * oz).toBeGreaterThanOrEqual(-0.0001);
        }
      }
    }
  }, timeLimit(20_000));

  it("gives every vertex a unit normal, stitched or not", () => {
    const stitched = { west: false, east: true, north: false, south: false };
    for (const p of [patch(-23, -57, 0.5), patch(-21, -57, 0.5, stitched), patch(-20, -57, 1)]) {
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

  it("lays a fine patch's stitched edge on the coarse patch's", () => {
    // (−21, −57) is fine; (−20, −57), east of it, is coarse.
    const fine = patch(-21, -57, 0.5, { west: false, east: true, north: false, south: false });
    const loose = patch(-21, -57, 0.5);
    const coarse = patch(-20, -57, 1);
    let moved = 0;
    for (let iz = 0; iz <= 32; iz++) {
      const f = (iz * 33 + 32) * 3;
      if (iz % 2 === 0) {
        // The shared points: the coarse patch's own, position and normal.
        const c = (iz / 2) * 17 * 3;
        for (let k = 0; k < 3; k++) {
          expect(fine.positions[f + k]).toBe(coarse.positions[c + k]);
          expect(fine.normals[f + k]).toBe(coarse.normals[c + k]);
        }
        continue;
      }
      // A midpoint: the mean of its two neighbours on the edge.
      const lo = f - 33 * 3;
      const hi = f + 33 * 3;
      for (let k = 0; k < 3; k++) {
        expect(fine.positions[f + k]).toBe(Math.fround(((fine.positions[lo + k] as number) + (fine.positions[hi + k] as number)) / 2));
      }
      if (fine.positions[f + 1] !== loose.positions[f + 1]) moved++;
    }
    // Of the sixteen midpoints, the relief had lifted every one off the chord.
    expect(moved).toBe(16);
    // The rest of the patch is the patch unstitched.
    for (let iz = 0; iz <= 32; iz++) {
      for (let ix = 0; ix < 32; ix++) {
        const at = (iz * 33 + ix) * 3;
        for (let k = 0; k < 3; k++) expect(fine.positions[at + k]).toBe(loose.positions[at + k]);
      }
    }
  }, timeLimit(20_000));

  it("has no patch where no point of the cell is steep", () => {
    // The camera's own cell at the reference pose: the road's flat.
    expect(facePatchGeometry(SEED, -24, -57, 0.5, NONE)).toBeNull();
    expect(facePatchGeometry(SEED, -24, -57, 1, NONE)).toBeNull();
  }, timeLimit(20_000));

  it("is the same patch whatever was built before it", () => {
    const first = patch(-22, -57, 0.5);
    patch(-20, -56, 1);
    patch(-23, -57, 0.5, { west: true, east: false, north: true, south: false });
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

describe("facePatchCells and facePatchStitch", () => {
  it("picks the cells within reach, fine near the camera, and stitches fine to coarse", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    expect(cells.length).toBe(316);
    expect(cells.filter((c) => c.spacing === 0.5).length).toBe(29);
    expect(cells.filter((c) => c.spacing === 1).length).toBe(287);
    const stitch = facePatchStitch(cells);
    const at = (ci: number, cj: number): PatchStitch => stitch[cells.findIndex((c) => c.ci === ci && c.cj === cj)] as PatchStitch;
    expect(at(-21, -57)).toEqual({ west: false, east: true, north: false, south: false });
    expect(at(-25, -59)).toEqual({ west: true, east: false, north: false, south: true });
    expect(at(-24, -57)).toEqual(NONE);
    // A coarse cell stitches nothing.
    expect(at(-20, -57)).toEqual(NONE);
    expect(stitch.filter((s) => s.west || s.east || s.north || s.south).length).toBe(15);
  });

  it("at the scarp, patches the cells with steep ground: the counts", () => {
    const cells = facePatchCells(-370, -900, PATCH_REACH.high);
    const stitch = facePatchStitch(cells);
    let near = 0;
    let far = 0;
    let vertices = 0;
    let triangles = 0;
    cells.forEach((c, i) => {
      const p = facePatchGeometry(SEED, c.ci, c.cj, c.spacing, stitch[i] as PatchStitch);
      if (p === null) return;
      if (c.spacing === 0.5) near++;
      else far++;
      vertices += p.vertexCount;
      triangles += p.triangleCount;
    });
    expect(near).toBe(20);
    expect(far).toBe(121);
    expect(vertices).toBe(56749);
    expect(triangles).toBe(102912);
  }, timeLimit(60_000));
});
