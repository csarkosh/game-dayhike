import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { HOLE_CELLS } from "../../src/game/clipmap.js";
import { coastProfilesFor } from "../../src/game/oceanTables.js";
import {
  SEA_HOLE_LOW, SEA_RING_FLOATS, SEA_SIDE, seaBedDepths, seaLattice, seaRingRecords, seaVertexAt, seaWetBounds, type SeaVertex,
} from "../../src/game/seaLattice.js";
import { seedFromToken } from "../../src/game/seed.js";
import { SWASH_FACE_LIFT_M } from "../../src/game/swashRunUp.js";
import {
  WATER_RING_CELLS, WATER_RING_COUNT, createWaterRingSamples, seaFaceZ, updateWaterRingSamples, waterHoleCellsFor, waterRingGeometry, wetBounds,
  type WaterRingSamples,
} from "../../src/game/water.js";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");
const LEVEL = 0;
/** The cove's waterline, where every ring has water. */
const COAST_X = coastProfilesFor(SEED).coastlineX(0);

const ringsAt = (x: number, z: number): WaterRingSamples[] => Array.from({ length: WATER_RING_COUNT }, (_, level) => createWaterRingSamples(SEED, level, x, z));
const holeOf = (rings: WaterRingSamples[], level: number): { x0: number; z0: number } | null =>
  level === 0 ? null : waterHoleCellsFor(rings[level] as WaterRingSamples, rings[level - 1] as WaterRingSamples);

describe("the sea's rings as one lattice", () => {
  const lattice = seaLattice();

  it("lays the seven rings outermost first, every vertex its column, its ring and its row", () => {
    expect(lattice.rings.map((ring) => ring.level)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    const frame = (HOLE_CELLS + 1) ** 2 - (HOLE_CELLS - 1) ** 2;
    let vertices = 0;
    let indices = 0;
    for (const ring of lattice.rings) {
      expect(ring.firstVertex).toBe(vertices);
      expect(ring.firstIndex).toBe(indices);
      expect(ring.vertexCount).toBe(SEA_SIDE * SEA_SIDE + (ring.level > 0 ? frame * 4 : 0));
      const cells = WATER_RING_CELLS * WATER_RING_CELLS - (ring.level > 0 ? (HOLE_CELLS - 1) ** 2 : 0);
      expect(ring.indexCount).toBe(cells * 6);
      for (let v = ring.firstVertex; v < ring.firstVertex + ring.vertexCount; v++) {
        if (lattice.positions[v * 3 + 1] !== ring.level) throw new Error(`vertex ${v} is not of ring ${ring.level}`);
      }
      vertices += ring.vertexCount;
      indices += ring.indexCount;
    }
    expect(lattice.positions.length).toBe(vertices * 3);
    expect(lattice.uvs.length).toBe(vertices * 2);
    expect(lattice.indices.length).toBe(indices);
    for (let v = 0; v < vertices; v++) {
      if (lattice.normals[v * 3] !== 0 || lattice.normals[v * 3 + 1] !== 1 || lattice.normals[v * 3 + 2] !== 0) throw new Error(`vertex ${v}'s normal is not up`);
    }
  });

  it("finds a hole's least corner at column and row 32 or 33, wherever the rings stand", () => {
    const seen = new Set<string>();
    for (const [x, z] of [[COAST_X, 0], [COAST_X + 1, 0.5], [COAST_X - 3, 7], [COAST_X + 130.5, -66], [-1234.5, 987.25], [5, 5]] as const) {
      const rings = ringsAt(x, z);
      for (let level = 1; level < WATER_RING_COUNT; level++) {
        const hole = holeOf(rings, level) as { x0: number; z0: number };
        expect([SEA_HOLE_LOW, SEA_HOLE_LOW + 1]).toContain(hole.x0);
        expect([SEA_HOLE_LOW, SEA_HOLE_LOW + 1]).toContain(hole.z0);
        seen.add(`${hole.x0},${hole.z0}`);
      }
    }
    expect(seen.size).toBe(4);
  });

  /**
   * The lattice under the rings' records against the geometry `water.ts`
   * makes of the same rings: the same triangles in the same order, once the
   * cells the hole covers are dropped, and at each of their vertices the same
   * place, stitch, bump coordinate and depth.
   */
  it("draws what waterRingGeometry draws: the same triangles in the same order, each vertex's place, stitch, coordinate and depth the same", () => {
    const at: SeaVertex = { latticeX: 0, latticeZ: 0, morph: 0, coarseX: 0, coarseZ: 0, u: 0, v: 0, covered: false };
    const depths = new Float32Array(SEA_SIDE * SEA_SIDE);
    const holes = new Set<string>();
    for (const [x, z] of [[COAST_X, 0], [COAST_X + 1, 1], [COAST_X - 2.5, 3], [COAST_X + 3, -5]] as const) {
      const rings = ringsAt(x, z);
      const records = seaRingRecords(rings, new Float32Array(WATER_RING_COUNT * SEA_RING_FLOATS));
      for (const range of lattice.rings) {
        const ring = rings[range.level] as WaterRingSamples;
        const hole = holeOf(rings, range.level);
        if (hole !== null) holes.add(`${hole.x0},${hole.z0}`);
        const geometry = waterRingGeometry(ring, hole, LEVEL);
        seaBedDepths(ring, LEVEL, depths);
        let k = 0;
        for (let t = range.firstIndex; t < range.firstIndex + range.indexCount; t += 3) {
          const corners = [0, 1, 2].map((c) => {
            const v = lattice.indices[t + c] as number;
            const ix = lattice.positions[v * 3] as number;
            const iz = lattice.positions[v * 3 + 2] as number;
            seaVertexAt(ix, range.level, iz, lattice.uvs[v * 2] as number, lattice.uvs[v * 2 + 1] as number, records, at);
            return { ix, iz, ...at };
          });
          // A cell is drawn or not as a whole: its vertices agree.
          expect(new Set(corners.map((c) => c.covered)).size).toBe(1);
          if (corners[0]?.covered === true) continue;
          for (const corner of corners) {
            const g = geometry.indices[k++] as number;
            if (g !== corner.iz * SEA_SIDE + corner.ix) throw new Error(`ring ${range.level}: triangle vertex ${k - 1} is ${corner.ix},${corner.iz}, the geometry's is ${g}`);
            const same =
              geometry.positions[g * 3] === Math.fround(corner.latticeX) && geometry.positions[g * 3 + 2] === Math.fround(corner.latticeZ)
              && geometry.oceanMorph[g] === Math.fround(corner.morph)
              && geometry.oceanCoarse[g * 2] === corner.coarseX && geometry.oceanCoarse[g * 2 + 1] === corner.coarseZ
              && geometry.uvs[g * 2] === Math.fround(corner.u) && geometry.uvs[g * 2 + 1] === Math.fround(corner.v)
              && geometry.bedDepth[g] === depths[g];
            if (!same) throw new Error(`ring ${range.level}: vertex ${corner.ix},${corner.iz} differs from the geometry's`);
          }
        }
        expect(k, `ring ${range.level}`).toBe(geometry.indices.length);
      }
    }
    // More than one place of the hole was drawn.
    expect(holes.size).toBeGreaterThan(1);
  });

  it("boxes a ring's water as wetBounds boxes its geometry's, with the swash's lift along the cove, and finds none in a dry ring", () => {
    const faceZ = seaFaceZ(SEED);
    const wet = new Uint8Array(SEA_SIDE * SEA_SIDE);
    let boxed = 0;
    let dry = 0;
    for (const [x, z] of [[COAST_X, 0], [COAST_X + 40, 100], [COAST_X + 300, -150], [COAST_X + 2000, 30], [COAST_X - 500, 400]] as const) {
      const rings = ringsAt(x, z);
      for (let level = 0; level < WATER_RING_COUNT; level++) {
        const ring = rings[level] as WaterRingSamples;
        const hole = holeOf(rings, level);
        const geometry = waterRingGeometry(ring, hole, LEVEL);
        const want = wetBounds(geometry, ring.h, SWASH_FACE_LIFT_M, faceZ);
        expect(seaWetBounds(ring, hole, LEVEL, SWASH_FACE_LIFT_M, faceZ, wet), `ring ${level} at ${x}, ${z}`).toEqual(want);
        if (want === null) dry++;
        else boxed++;
      }
    }
    expect(boxed).toBeGreaterThan(10);
    expect(dry).toBeGreaterThan(2);
  });

  it("keeps the records and the depths right as the rings move", () => {
    const rings = ringsAt(COAST_X, 0);
    for (const ring of rings) updateWaterRingSamples(ring, SEED, COAST_X + 37, -21);
    const fresh = ringsAt(COAST_X + 37, -21);
    const n = WATER_RING_COUNT * SEA_RING_FLOATS;
    expect([...seaRingRecords(rings, new Float32Array(n))]).toEqual([...seaRingRecords(fresh, new Float32Array(n))]);
    const a = new Float32Array(SEA_SIDE * SEA_SIDE);
    const b = new Float32Array(SEA_SIDE * SEA_SIDE);
    for (let level = 0; level < WATER_RING_COUNT; level++) {
      seaBedDepths(rings[level] as WaterRingSamples, LEVEL, a);
      seaBedDepths(fresh[level] as WaterRingSamples, LEVEL, b);
      expect(a).toEqual(b);
    }
  });
});
