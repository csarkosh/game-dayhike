import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { depenetrate, raycast, sweepBox } from "../../src/sim/collision.js";
import { PLAYER_HALF } from "../../src/sim/constants.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { elevationAt } from "../../src/sim/terrain.js";
import type { Vec3 } from "../../src/sim/types.js";
import type { Aabb } from "../../src/sim/level.js";

const SEED = 0xf0e57;

describe("createChunkGrid", () => {
  it("generates lazily", () => {
    const grid = createChunkGrid(SEED);
    expect(grid.generatedCount()).toBe(0);
    grid.near({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(grid.generatedCount()).toBe(1);
  });

  it("reuses a generated chunk rather than regenerating it", () => {
    const grid = createChunkGrid(SEED);
    grid.near({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    grid.near({ x: 2, y: 0, z: 2 }, { x: 3, y: 1, z: 3 });
    expect(grid.generatedCount()).toBe(1);
  });

  it("generates every chunk a query spans", () => {
    const grid = createChunkGrid(SEED);
    grid.near({ x: CHUNK_SIZE - 1, y: -20, z: 0 }, { x: CHUNK_SIZE + 1, y: 20, z: 1 });
    expect(grid.generatedCount()).toBe(2);
  });

  it("returns boxes covering the queried region", () => {
    // A chunk's worth, not a 2 m window: the grid carries props only — the
    // ground is the analytic field in `ground.ts` — and trunks are metres
    // apart, so a small window legitimately holds none.
    const grid = createChunkGrid(SEED);
    const out = grid.near(
      { x: -CHUNK_SIZE / 2, y: -Infinity, z: -CHUNK_SIZE / 2 },
      { x: CHUNK_SIZE / 2, y: Infinity, z: CHUNK_SIZE / 2 },
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it("reuses one scratch buffer, so results must not be retained", () => {
    // Documented in boxSource.ts. Asserted here so the contract is visible
    // rather than folklore: a caller that holds the array across a second query
    // is reading the wrong geometry, not a stale copy of the right geometry.
    const grid = createChunkGrid(SEED);
    const first = grid.near({ x: 0, y: -20, z: 0 }, { x: 1, y: 20, z: 1 });
    const second = grid.near({ x: 0, y: -20, z: 0 }, { x: 1, y: 20, z: 1 });
    expect(second).toBe(first);
  });

  it("orders output by geometry, not by chunk visit history", () => {
    // sweepBox breaks ties on iteration order, and peers load chunks in whatever
    // order they happened to walk. If visit history leaked into ordering, two
    // players could resolve the same sweep against different surfaces.
    const a = createChunkGrid(SEED);
    const b = createChunkGrid(SEED);
    const lo: Vec3 = { x: -10, y: -20, z: -10 };
    const hi: Vec3 = { x: 10, y: 20, z: 10 };

    a.near({ x: -10, y: -20, z: -10 }, { x: -9, y: 20, z: -9 });
    a.near({ x: 9, y: -20, z: 9 }, { x: 10, y: 20, z: 10 });
    b.near({ x: 9, y: -20, z: 9 }, { x: 10, y: 20, z: 10 });
    b.near({ x: -10, y: -20, z: -10 }, { x: -9, y: 20, z: -9 });

    expect(a.near(lo, hi)).toEqual(b.near(lo, hi));
  });

  it("agrees with a flat scan of the same geometry", () => {
    // The correctness property for a broadphase: it may over-report, never
    // under-report. Any disagreement here means a mover can pass through
    // something the flat scan would have stopped it on.
    const grid = createChunkGrid(SEED);
    const flat = grid.allBoxesIn(-2, -2, 2, 2);
    // Props only now, so this is trunks rather than the old ground columns —
    // hundreds, not tens of thousands.
    expect(flat.length).toBeGreaterThan(100);

    let h = 0x1234567;
    const rand = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2545f491);
      h ^= h >>> 13;
      return (h >>> 0) / 4294967296;
    };

    // Probes have to straddle the geometry to prove anything, and trunks stand
    // on the terrain surface — around y = 160 at this seed, not around y = 0.
    // Sampling a fixed y band (what this test did while the ground was boxes,
    // which spanned every height) would now put every probe in open air, and
    // the whole comparison would pass by agreeing that nothing is anywhere.
    // `hits` below is the guard against exactly that.
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const x = rand() * 40 - 20;
      const z = rand() * 40 - 20;
      const surface = elevationAt(SEED, x, z);
      const center: Vec3 = { x, y: surface + rand() * 3, z };
      const delta: Vec3 = { x: rand() * 0.4 - 0.2, y: rand() * 0.4 - 0.2, z: rand() * 0.4 - 0.2 };
      const swept = sweepBox(center, PLAYER_HALF, delta, grid);
      expect(swept).toEqual(sweepBox(center, PLAYER_HALF, delta, flat));
      if (swept !== null) hits++;

      const dx = rand() * 2 - 1;
      const dy = rand() * 2 - 1;
      const dz = rand() * 2 - 1;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) continue;
      const unit: Vec3 = { x: dx / len, y: dy / len, z: dz / len };
      const cast = raycast(center, unit, 30, grid);
      expect(cast).toEqual(raycast(center, unit, 30, flat));
      if (cast !== null) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it("agrees with a flat scan on depenetration into props", () => {
    // Bounded to shallow penetration on purpose, because that is the whole of
    // depenetrate's contract: it exists to undo the 1-3 mm that snapshot
    // quantization leaves a client inside the surface it is resting against.
    //
    // Measured disagreement against a flat scan, by depth:
    //   0 mm 0/4000, 3 mm 0/4000, 5 cm 0/4000, 50 cm 8/4000, 150 cm 27/4000
    //
    // Beyond a few centimetres the least-penetration push can exceed the
    // `center +/- 2*half` query region, so the grid cannot see a box the flat
    // scan does. Tightening that would mean collision.ts knowing the largest box
    // extent a source can return, which would couple it to generation constants
    // for a regime the game never produces — movement resolves every tick, and
    // chunk content never changes under a standing player.
    //
    // Probes sit inside trunks rather than in the ground. The ground is no
    // longer a box and depenetrate never sees it: a hull left below the surface
    // is lifted onto it by `resolveGround` instead, exactly rather than by
    // least-penetration push.
    const grid = createChunkGrid(SEED);
    const flat = grid.allBoxesIn(-1, -1, 1, 1);
    expect(flat.length).toBeGreaterThan(0);
    let h = 0x7654321;
    const rand = (): number => {
      h = Math.imul(h ^ (h >>> 15), 0x2545f491);
      h ^= h >>> 13;
      return (h >>> 0) / 4294967296;
    };
    let displaced = 0;
    for (let i = 0; i < 300; i++) {
      const box = flat[Math.floor(rand() * flat.length)] as Aabb;
      const depth = rand() * 0.05;
      // Just inside the box's -x face, centred on it otherwise.
      const p: Vec3 = {
        x: box.min.x - PLAYER_HALF.x + depth,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
      };
      const viaGrid = depenetrate(p, PLAYER_HALF, grid);
      expect(viaGrid).toEqual(depenetrate(p, PLAYER_HALF, flat));
      if (viaGrid.x !== p.x || viaGrid.y !== p.y || viaGrid.z !== p.z) displaced++;
    }
    // Guards against the guard: probes that never overlap anything would make
    // every comparison above a comparison of two no-ops.
    expect(displaced).toBeGreaterThan(0);
  });
});
