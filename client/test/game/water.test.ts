import { beforeAll, describe, it, expect } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  createWaterRingSamples, updateWaterRingSamples, waterHoleCellsFor,
  waterRingGeometry, waterRingSpacing, wetBounds,
  OCEAN_BOUND, WATER_RING_CELLS, WATER_RING_COUNT,
  type WaterGeometry, type WaterRingSamples,
} from "../../src/game/water.js";
import { HOLE_CELLS, RING_CELLS, blendWeight } from "../../src/game/clipmap.js";
import { SWASH_FACE_LIFT_M, SWASH_REACH_MAX_M } from "../../src/game/swashRunUp.js";
import { COVE_FACE_GRADE } from "../../src/sim/olympic.js";

const SEED = 0x5eed;
setActiveTerrainVariant("olympic");

/** The seven rings around a camera, finest first, as the shell builds them. */
function ringsAt(camX: number, camZ: number): WaterRingSamples[] {
  return Array.from({ length: WATER_RING_COUNT }, (_, level) => createWaterRingSamples(SEED, level, camX, camZ));
}

/** Each ring's hole: the finer ring's footprint, none for ring 0. */
function holeOf(rings: WaterRingSamples[], level: number): { x0: number; z0: number } | null {
  return level === 0 ? null : waterHoleCellsFor(rings[level] as WaterRingSamples, rings[level - 1] as WaterRingSamples);
}

/** What a ring's box fails to hold of the sea the vertex stage draws: each
 * vertex of a wet triangle (the triangles the box is made of), moved to
 * p - oceanMorph * oceanCoarse as the vertex stage does, and then OCEAN_BOUND
 * off that on every axis, the farthest the waves take it. */
function outsideBox(g: WaterGeometry, box: { min: number[]; max: number[] }): { outside: string[]; checked: number } {
  const outside: string[] = [];
  let checked = 0;
  for (let t = 0; t < g.indices.length; t += 3) {
    const tri = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
    if (tri.every((v) => (g.bedDepth[v] as number) <= 0)) continue;
    for (const v of tri) {
      const m = g.oceanMorph[v]!;
      const at = [
        g.positions[v * 3]! - m * g.oceanCoarse[v * 2]!,
        g.positions[v * 3 + 1]!,
        g.positions[v * 3 + 2]! - m * g.oceanCoarse[v * 2 + 1]!,
      ];
      for (let axis = 0; axis < 3; axis++) {
        if (at[axis]! - OCEAN_BOUND < box.min[axis]! || at[axis]! + OCEAN_BOUND > box.max[axis]!) outside.push(`vertex ${v}, axis ${axis}`);
      }
      checked++;
    }
  }
  return { outside, checked };
}

describe("water rings", () => {
  it("keeps the same cell count as the terrain clipmap", () => {
    // The borrowed `snapOrigin` centres rings using clipmap's RING_CELLS, so
    // if the two counts ever diverge, water rings silently miscentre.
    expect(WATER_RING_CELLS).toBe(RING_CELLS);
  });

  it("runs seven rings a vertex every 1, 2, 4, 8, 16, 32 and 64 m, spanning at least 8 km", () => {
    expect(WATER_RING_COUNT).toBe(7);
    expect(Array.from({ length: WATER_RING_COUNT }, (_, level) => waterRingSpacing(level))).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(waterRingSpacing(WATER_RING_COUNT - 1) * WATER_RING_CELLS).toBe(8192);
    expect(waterRingSpacing(WATER_RING_COUNT - 1) * WATER_RING_CELLS).toBeGreaterThanOrEqual(8000);
  });

  it("nests every ring in the hole of the next and covers the view around the camera", () => {
    for (const [camX, camZ] of [[0, 0], [-500, 300], [1234.5, -987.25]] as const) {
      const rings = ringsAt(camX, camZ);
      // The camera at least 62 m inside the finest ring on every side, and the
      // coarsest reaching at least 3,968 m from it every way.
      const first = rings[0] as WaterRingSamples;
      const last = rings[WATER_RING_COUNT - 1] as WaterRingSamples;
      const reach = (r: WaterRingSamples) => Math.min(
        camX - r.originX, r.originX + WATER_RING_CELLS * r.spacing - camX,
        camZ - r.originZ, r.originZ + WATER_RING_CELLS * r.spacing - camZ,
      );
      expect(reach(first)).toBeGreaterThanOrEqual(62);
      expect(reach(last)).toBeGreaterThanOrEqual(3968);
      for (let level = 1; level < WATER_RING_COUNT; level++) {
        const ring = rings[level] as WaterRingSamples;
        const finer = rings[level - 1] as WaterRingSamples;
        const hole = waterHoleCellsFor(ring, finer);
        // whole cells, strictly inside the ring
        for (const at of [hole.x0, hole.z0]) {
          expect(Number.isInteger(at)).toBe(true);
          expect(at).toBeGreaterThanOrEqual(1);
          expect(at + HOLE_CELLS).toBeLessThanOrEqual(WATER_RING_CELLS - 1);
        }
        // exactly the finer ring's footprint
        expect(ring.originX + hole.x0 * ring.spacing).toBe(finer.originX);
        expect(ring.originZ + hole.z0 * ring.spacing).toBe(finer.originZ);
        expect(HOLE_CELLS * ring.spacing).toBe(WATER_RING_CELLS * finer.spacing);
      }
    }
  }, timeLimit(60_000));

  it("draws 180,224 triangles over 116,487 vertices in its seven rings", () => {
    const rings = ringsAt(-500, 0);
    let vertices = 0;
    let triangles = 0;
    const perRing: number[] = [];
    for (let level = 0; level < WATER_RING_COUNT; level++) {
      const g = waterRingGeometry(rings[level] as WaterRingSamples, holeOf(rings, level), 0);
      vertices += g.positions.length / 3;
      triangles += g.indices.length / 3;
      perRing.push(g.indices.length / 3);
    }
    expect(perRing).toEqual([32768, 24576, 24576, 24576, 24576, 24576, 24576]);
    expect(triangles).toBe(180224);
    expect(vertices).toBe(116487);
  }, timeLimit(30_000));

  it("scroll equals fresh build", () => {
    const scrolled = createWaterRingSamples(SEED, 0, 0, 0);
    updateWaterRingSamples(scrolled, SEED, 100, -60);
    const fresh = createWaterRingSamples(SEED, 0, 100, -60);
    expect(scrolled.originX).toBe(fresh.originX);
    expect(scrolled.originZ).toBe(fresh.originZ);
    expect(Array.from(scrolled.h)).toEqual(Array.from(fresh.h));
  }, timeLimit(30_000));

  it("returns false when the snapped origin has not moved", () => {
    const ring = createWaterRingSamples(SEED, 2, 0, 0);
    expect(updateWaterRingSamples(ring, SEED, 3, 3)).toBe(false); // level-2 snap step is 8 m
  });

  it("cuts a hole exactly where the finer ring sits", () => {
    const fine = createWaterRingSamples(SEED, 0, -500, 0);
    const coarse = createWaterRingSamples(SEED, 1, -500, 0);
    const hole = waterHoleCellsFor(coarse, fine);
    const g = waterRingGeometry(coarse, hole, 0);
    const cells = WATER_RING_CELLS * WATER_RING_CELLS - (WATER_RING_CELLS / 2) * (WATER_RING_CELLS / 2);
    expect(g.indices.length).toBe(cells * 6);
  });

  it("puts every vertex at the water level with an up normal and a UV", () => {
    const ring = createWaterRingSamples(SEED, 0, -500, 0);
    const g = waterRingGeometry(ring, null, 0);
    expect(g.positions[1]).toBe(0);
    expect(g.normals.slice(0, 3)).toEqual(new Float32Array([0, 1, 0]));
    expect(g.uvs.length * 3).toBe(g.positions.length * 2);
  });

  it("writes the bed depth per vertex, clamped at zero on land", () => {
    const ring = createWaterRingSamples(SEED, 0, 0, 0);
    const g = waterRingGeometry(ring, null, 10);
    expect(g.bedDepth.length).toBe(g.positions.length / 3);
    expect((g as unknown as { colors?: unknown }).colors).toBeUndefined();
    for (let i = 0; i < g.bedDepth.length; i++) {
      const expected = Math.max(0, 10 - (ring.h[i] as number));
      expect(g.bedDepth[i]).toBeCloseTo(expected, 5);
    }
  });

  describe("the box a ring's water can be drawn in (wetBounds)", () => {
    const SIDE = WATER_RING_CELLS + 1;

    it("is null for a ring with no wet vertex", () => {
      const ring = createWaterRingSamples(SEED, 1, 0, 0);
      ring.h.fill(50);
      expect(wetBounds(waterRingGeometry(ring, null, 0))).toBeNull();
    });

    it("is the box of the cells around the wet vertices, at the water level", () => {
      const ring = createWaterRingSamples(SEED, 0, 0, 0);
      ring.h.fill(50);
      // two wet vertices: (10, 20) and (30, 25)
      ring.h[20 * SIDE + 10] = -5;
      ring.h[25 * SIDE + 30] = -1;
      const b = wetBounds(waterRingGeometry(ring, null, 3))!;
      const s = ring.spacing;
      // each wet vertex's four cells draw water up to their dry corners, and
      // the waves may carry the surface OCEAN_BOUND off them every way; across,
      // the stitch's move of a vertex, up to a cell (here 1 m), as well
      expect(OCEAN_BOUND).toBe(12);
      expect(s).toBe(1);
      expect(b.min).toEqual([ring.originX + 9 * s - 12 - s, 3 - 12, ring.originZ + 19 * s - 12 - s]);
      expect(b.max).toEqual([ring.originX + 31 * s + 12 + s, 3 + 12, ring.originZ + 26 * s + 12 + s]);
    });

    it("holds the stitched surface of a coarse ring: each vertex moved by oceanMorph times oceanCoarse, a cell of 16 m, and the waves' bound past it", () => {
      const rings = ringsAt(0, 0);
      const ring = rings[4] as WaterRingSamples;
      ring.h.fill(50);
      // two wet vertices, out in the ring's band: (10, 20) and (115, 100)
      ring.h[20 * SIDE + 10] = -5;
      ring.h[100 * SIDE + 115] = -1;
      const g = waterRingGeometry(ring, holeOf(rings, 4), 3);
      const b = wetBounds(g)!;
      const s = ring.spacing;
      expect(s).toBe(16);
      // the wet vertices' dry corners are odd ones, which the stitch moves by
      // oceanMorph * 16 m along x or z, outward at the edge of the box
      const held = outsideBox(g, b);
      expect(held.outside).toEqual([]);
      expect(held.checked).toBe(36);
      // the box reaches a cell of 16 m beyond the waves' 12 m
      expect(b.min).toEqual([ring.originX + 9 * s - 12 - s, 3 - 12, ring.originZ + 19 * s - 12 - s]);
      expect(b.max).toEqual([ring.originX + 116 * s + 12 + s, 3 + 12, ring.originZ + 101 * s + 12 + s]);
    });

    it("holds the stitched surface of every wet ring around a coast: each vertex of a wet triangle moved by oceanMorph times oceanCoarse, and the waves' bound past it", () => {
      const rings = ringsAt(-500, 0);
      let wetRings = 0;
      let checked = 0;
      for (let level = 0; level < WATER_RING_COUNT; level++) {
        const g = waterRingGeometry(rings[level] as WaterRingSamples, holeOf(rings, level), 0);
        const b = wetBounds(g);
        if (b === null) continue;
        wetRings++;
        const held = outsideBox(g, b);
        expect(held.outside).toEqual([]);
        checked += held.checked;
      }
      expect(wetRings).toBe(7);
      expect(checked).toBe(380925);
    }, timeLimit(30_000));

    it("counts a vertex wet only when its depth is above zero, and a cell in the hole for nothing", () => {
      const fine = createWaterRingSamples(SEED, 0, 0, 0);
      const coarse = createWaterRingSamples(SEED, 1, 0, 0);
      const hole = waterHoleCellsFor(coarse, fine);
      coarse.h.fill(50);
      // exactly at the level: depth 0, dry
      coarse.h[10 * SIDE + 10] = 0;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      // wet, but every cell around it is in the hole (not drawn)
      const inside = (hole.z0 + 5) * SIDE + hole.x0 + 5;
      coarse.h[inside] = -5;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      expect(wetBounds(waterRingGeometry(coarse, null, 0))).not.toBeNull();
    });

    it("lifts the swash's face into the sea's wet cells: the farthest reach up the face and the sheet over it, 1.6 m", () => {
      expect(SWASH_FACE_LIFT_M).toBe(1.6);
      expect(SWASH_REACH_MAX_M * COVE_FACE_GRADE + 0.6).toBe(1.6);
    });

    it("keeps a sea ring that covers only the cove's face, ground up to 1 m above the level, and none 2 m above it", () => {
      const ring = createWaterRingSamples(SEED, 0, 0, 0);
      // face ground from 0.05 m to 1 m above a level of 3, rising along x: none of it under the level
      for (let iz = 0; iz < SIDE; iz++) {
        for (let ix = 0; ix < SIDE; ix++) ring.h[iz * SIDE + ix] = 3.05 + (0.95 * ix) / WATER_RING_CELLS;
      }
      const g = waterRingGeometry(ring, null, 3);
      expect(Math.max(...g.bedDepth)).toBe(0);
      // a lake's rule, the depth's: dry, off
      expect(wetBounds(g)).toBeNull();
      expect(wetBounds(g, ring.h, 0)).toBeNull();
      // the sea's: every cell wet, the whole ring and the waves' bound past it
      const b = wetBounds(g, ring.h, SWASH_FACE_LIFT_M)!;
      expect(b).not.toBeNull();
      const s = ring.spacing;
      expect(s).toBe(1);
      expect(b.min).toEqual([ring.originX - 12 - s, 3 - 12, ring.originZ - 12 - s]);
      expect(b.max).toEqual([ring.originX + 128 * s + 12 + s, 3 + 12, ring.originZ + 128 * s + 12 + s]);
      // 2 m above the level is past any swash: off
      ring.h.fill(5);
      expect(wetBounds(waterRingGeometry(ring, null, 3), ring.h, SWASH_FACE_LIFT_M)).toBeNull();
      // one vertex 1.5 m above: its cells only
      ring.h[20 * SIDE + 10] = 4.5;
      const one = wetBounds(waterRingGeometry(ring, null, 3), ring.h, SWASH_FACE_LIFT_M)!;
      expect(one.min).toEqual([ring.originX + 9 * s - 12 - s, 3 - 12, ring.originZ + 19 * s - 12 - s]);
      expect(one.max).toEqual([ring.originX + 11 * s + 12 + s, 3 + 12, ring.originZ + 21 * s + 12 + s]);
    });

    it("holds every wet vertex of a real ring and is no larger than the cells around them", () => {
      const ring = createWaterRingSamples(SEED, 1, -500, 0);
      const g = waterRingGeometry(ring, null, 0);
      const b = wetBounds(g)!;
      expect(b).not.toBeNull();
      let wet = 0;
      let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.bedDepth.length; i++) {
        if ((g.bedDepth[i] as number) <= 0) continue;
        wet++;
        const x = g.positions[i * 3] as number;
        const z = g.positions[i * 3 + 2] as number;
        [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)];
      }
      expect(wet).toBeGreaterThan(0);
      expect(wet).toBeLessThan(g.bedDepth.length); // a shore: some of it is land
      const s = ring.spacing;
      // across, past the cells by the waves' bound and the stitch's move: a cell (here 2 m)
      const across = OCEAN_BOUND + s;
      expect(s).toBe(2);
      expect(b.min[0]).toBeLessThanOrEqual(minX - across);
      expect(b.min[0]).toBeGreaterThanOrEqual(minX - s - across);
      expect(b.min[2]).toBeLessThanOrEqual(minZ - across);
      expect(b.min[2]).toBeGreaterThanOrEqual(minZ - s - across);
      expect(b.max[0]).toBeGreaterThanOrEqual(maxX + across);
      expect(b.max[0]).toBeLessThanOrEqual(maxX + s + across);
      expect(b.max[2]).toBeGreaterThanOrEqual(maxZ + across);
      expect(b.max[2]).toBeLessThanOrEqual(maxZ + s + across);
      // the crest and the trough: the level, 0 here, give or take OCEAN_BOUND
      expect(b.min[1]).toBe(-12);
      expect(b.max[1]).toBe(12);
    }, timeLimit(30_000));
  });

  // At two cameras. The second is an odd multiple of 2 m on each axis where the
  // first is an even one, so every ring's origin falls on the other parity of
  // its coarser neighbour's cells: ring 1's hole starts at an even cell index
  // of ring 1 for the first, an odd one for the second.
  for (const [camX, camZ, holeParity] of [[-500, 0, 0], [-498, 302, 1]] as const) describe(`what the vertex stage stitches a ring's waves to the coarser ring's with, the camera at (${camX}, ${camZ})`, () => {
    const SIDE = WATER_RING_CELLS + 1;
    let rings: WaterRingSamples[] = [];
    let geometries: WaterGeometry[] = [];
    beforeAll(() => {
      rings = ringsAt(camX, camZ);
      geometries = rings.map((ring, level) => waterRingGeometry(ring, holeOf(rings, level), 0));
    }, timeLimit(30_000));
    it("puts ring 1's hole at the cell index of its parity: even for the first camera, odd for the second", () => {
      const hole = holeOf(rings, 1)!;
      expect([hole.x0 % 2, hole.z0 % 2]).toEqual([holeParity, holeParity]);
    });
    const onOuterEdge = (ix: number, iz: number): boolean =>
      ix === 0 || iz === 0 || ix === WATER_RING_CELLS || iz === WATER_RING_CELLS;
    // Any value the waves give a point: a displacement, here made up.
    const f = (x: number, z: number): number => Math.sin(0.37 * x) + Math.cos(0.11 * z) + 0.001 * x;

    /** The coarser ring's surface at (px, pz) as it draws it, over its full
     * triangulation (`full`, built with no hole) and by barycentric weights:
     * the value there, the weights, and the two vertices `oceanCoarse` named. */
    function coarserAt(level: number, full: WaterGeometry, edges: Map<string, number>, px: number, pz: number, ex: number, ez: number):
      { value: number; weights: number[]; a: number; b: number } | string {
      const coarse = rings[level + 1]!;
      const vertexAt = (x: number, z: number): number | null => {
        const ix = (x - coarse.originX) / coarse.spacing;
        const iz = (z - coarse.originZ) / coarse.spacing;
        if (!Number.isInteger(ix) || !Number.isInteger(iz) || ix < 0 || iz < 0 || ix > WATER_RING_CELLS || iz > WATER_RING_CELLS) return null;
        return iz * SIDE + ix;
      };
      const a = vertexAt(px - ex, pz - ez);
      const b = vertexAt(px + ex, pz + ez);
      if (a === null || b === null) return "off the coarser lattice";
      const ax = full.positions[a * 3]!, az = full.positions[a * 3 + 2]!;
      if (a === b) return ax === px && az === pz ? { value: f(ax, az), weights: [1], a, b } : "not on its coarser vertex";
      const c = edges.get(`${Math.min(a, b)},${Math.max(a, b)}`);
      if (c === undefined) return "not a drawn edge of the coarser ring";
      const bx = full.positions[b * 3]!, bz = full.positions[b * 3 + 2]!;
      const cx = full.positions[c * 3]!, cz = full.positions[c * 3 + 2]!;
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const wa = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / area;
      const wb = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / area;
      const wc = ((ax - px) * (bz - pz) - (az - pz) * (bx - px)) / area;
      return { value: wa * f(ax, az) + wb * f(bx, bz) + wc * f(cx, cz), weights: [wa, wb, wc], a, b };
    }

    /** A ring's drawn edges, each to a third vertex of a triangle it bounds. */
    function edgesOf(g: WaterGeometry): Map<string, number> {
      const edges = new Map<string, number>();
      for (let t = 0; t < g.indices.length; t += 3) {
        const tri = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
        for (let k = 0; k < 3; k++) {
          const a = tri[k]!, b = tri[(k + 1) % 3]!;
          edges.set(`${Math.min(a, b)},${Math.max(a, b)}`, tri[(k + 2) % 3]!);
        }
      }
      return edges;
    }

    it("blends as the terrain does: the clipmap's blendWeight, 0 at the hole's edge and ring 0's centre, 1 on the outer edge", () => {
      const wrong: string[] = [];
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const hole = holeOf(rings, level);
        for (let iz = 0; iz < SIDE; iz++) {
          for (let ix = 0; ix < SIDE; ix++) {
            const m = g.oceanMorph[iz * SIDE + ix] as number;
            if (m !== Math.fround(blendWeight(hole, ix, iz))) wrong.push(`ring ${level} (${ix}, ${iz}): ${m}`);
            if (onOuterEdge(ix, iz) && m !== 1) wrong.push(`ring ${level} outer (${ix}, ${iz}): ${m}`);
          }
        }
        if (hole === null) {
          if (g.oceanMorph[64 * SIDE + 64] !== 0) wrong.push("ring 0's centre");
        } else {
          for (let i = 0; i <= HOLE_CELLS; i++) {
            for (const [ix, iz] of [[hole.x0 + i, hole.z0], [hole.x0 + i, hole.z0 + HOLE_CELLS], [hole.x0, hole.z0 + i], [hole.x0 + HOLE_CELLS, hole.z0 + i]] as const) {
              if (g.oceanMorph[iz * SIDE + ix] !== 0) wrong.push(`ring ${level} hole edge (${ix}, ${iz})`);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it("leaves the outermost ring unstitched: it draws its own waves throughout", () => {
      const g = geometries[WATER_RING_COUNT - 1]!;
      expect(g.oceanMorph.every((m) => m === 0)).toBe(true);
      expect(g.oceanCoarse.every((c) => c === 0)).toBe(true);
    });

    it("names, at every vertex, two coarser vertices whose mean is the coarser ring's linear interpolation there", () => {
      const wrong: string[] = [];
      let checked = 0;
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const full = waterRingGeometry(rings[level + 1]!, null, 0);
        const edges = edgesOf(full);
        for (let v = 0; v < SIDE * SIDE; v++) {
          const px = g.positions[v * 3]!, pz = g.positions[v * 3 + 2]!;
          const ex = g.oceanCoarse[v * 2]!, ez = g.oceanCoarse[v * 2 + 1]!;
          const at = coarserAt(level, full, edges, px, pz, ex, ez);
          if (typeof at === "string") { wrong.push(`ring ${level} vertex ${v}: ${at}`); continue; }
          // the middle of the edge: weights one half, one half, nothing
          if (at.a !== at.b && (at.weights[0] !== 0.5 || at.weights[1] !== 0.5 || at.weights[2] !== 0)) {
            wrong.push(`ring ${level} vertex ${v}: weights ${at.weights.join(", ")}`);
          }
          const mean = 0.5 * (f(px - ex, pz - ez) + f(px + ex, pz + ez));
          if (mean !== at.value) wrong.push(`ring ${level} vertex ${v}: ${mean} is not ${at.value}`);
          checked++;
        }
      }
      expect(wrong).toEqual([]);
      expect(checked).toBe(99846);
    }, timeLimit(30_000));

    it("collapses its outer edge onto the coarser ring's: moved by oceanMorph times oceanCoarse, edge for edge the coarser ring's, its linear interpolation exact", () => {
      const wrong: string[] = [];
      let collapsed = 0;
      let segments = 0;
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const coarse = rings[level + 1]!;
        // the coarser ring as drawn, its hole cut for this ring
        const drawn = geometries[level + 1]!;
        const edges = edgesOf(drawn);
        // The outer edge's 512 vertices in order round the ring.
        const loop: number[] = [];
        for (let i = 0; i < WATER_RING_CELLS; i++) loop.push(i);
        for (let i = 0; i < WATER_RING_CELLS; i++) loop.push(i * SIDE + WATER_RING_CELLS);
        for (let i = WATER_RING_CELLS; i > 0; i--) loop.push(WATER_RING_CELLS * SIDE + i);
        for (let i = WATER_RING_CELLS; i > 0; i--) loop.push(i * SIDE);
        // Where the vertex stage puts each before the waves: p - oceanMorph * oceanCoarse.
        const moved = loop.map((v) => {
          const m = g.oceanMorph[v]!;
          if (m !== 1) wrong.push(`ring ${level} vertex ${v}: oceanMorph ${m}`);
          return [g.positions[v * 3]! - m * g.oceanCoarse[v * 2]!, g.positions[v * 3 + 2]! - m * g.oceanCoarse[v * 2 + 1]!] as const;
        });
        const coarseVertex = (x: number, z: number): number | null => {
          const ix = (x - coarse.originX) / coarse.spacing;
          const iz = (z - coarse.originZ) / coarse.spacing;
          return Number.isInteger(ix) && Number.isInteger(iz) && ix >= 0 && iz >= 0 && ix <= WATER_RING_CELLS && iz <= WATER_RING_CELLS ? iz * SIDE + ix : null;
        };
        for (let i = 0; i < moved.length; i++) {
          const [px, pz] = moved[i]!;
          const [qx, qz] = moved[(i + 1) % moved.length]!;
          const a = coarseVertex(px, pz);
          const b = coarseVertex(qx, qz);
          // on a coarser vertex, which the coarser ring draws unblended, where it is
          if (a === null || b === null) { wrong.push(`ring ${level} step ${i}: off the coarser lattice`); continue; }
          if (drawn.oceanMorph[a] !== 0) wrong.push(`ring ${level} step ${i}: the coarser vertex is blended`);
          collapsed++;
          if (a === b) continue;
          const c = edges.get(`${Math.min(a, b)},${Math.max(a, b)}`);
          if (c === undefined) { wrong.push(`ring ${level} step ${i}: not a drawn edge of the coarser ring`); continue; }
          segments++;
          const cx = drawn.positions[c * 3]!, cz = drawn.positions[c * 3 + 2]!;
          // Along the segment the finer ring draws, the coarser ring's
          // linear interpolation over its triangle, by barycentric weights.
          for (const t of [0.25, 0.5, 0.75]) {
            const x = px + t * (qx - px);
            const z = pz + t * (qz - pz);
            const fine = (1 - t) * f(px, pz) + t * f(qx, qz);
            const area = (qx - px) * (cz - pz) - (qz - pz) * (cx - px);
            const wa = ((qx - x) * (cz - z) - (qz - z) * (cx - x)) / area;
            const wb = ((cx - x) * (pz - z) - (cz - z) * (px - x)) / area;
            const wc = ((px - x) * (qz - z) - (pz - z) * (qx - x)) / area;
            const coarser = wa * f(px, pz) + wb * f(qx, qz) + wc * f(cx, cz);
            if (fine !== coarser) wrong.push(`ring ${level} step ${i} at ${t}: ${fine} is not ${coarser}`);
          }
        }
      }
      expect(wrong).toEqual([]);
      // six stitched rings, 512 outer-edge vertices each, half of whose steps join two coarser vertices
      expect(collapsed).toBe(3072);
      expect(segments).toBe(1536);
    }, timeLimit(30_000));
  });
});
