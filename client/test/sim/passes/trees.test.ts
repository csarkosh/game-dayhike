import { describe, it, expect } from "vitest";
import "../../../src/sim/passes/index.js";
import { generateChunk, registeredPasses } from "../../../src/sim/chunk.js";
import { registryDigest } from "../../../src/sim/forest.js";
import { CHUNK_SIZE } from "../../../src/sim/forestConstants.js";
import { groundSpawn } from "../../../src/sim/spawn.js";
import { createChunkGrid } from "../../../src/sim/chunkGrid.js";
import { PLAYER_HALF } from "../../../src/sim/constants.js";
import { treesInRect, COHORT_LOG } from "../../../src/sim/vegetation.js";

const SEED = 0x5eed;

describe("pass 6: trees", () => {
  it("is registered as id 6 named trees, with the vegetation tunables declared", () => {
    const pass = registeredPasses().find((p) => p.id === 6);
    expect(pass?.name).toBe("trees");
    expect(pass?.tunables.TREELINE_HI).toBe(240);
    expect(pass?.tunables.TRUNK_HALF).toBe(0.35);
    // Geometry-steering constants hoisted from inline literals: their values
    // are part of the level id, so moving any of them must move the digest.
    expect(pass?.tunables.JITTER_SPAN).toBe(0.7);
    expect(pass?.tunables.SHORE_ALT_FADE).toBe(3);
    expect(pass?.tunables.SHORE_D_FADE).toBe(30);
  });
  it("emits trunk brushes only inside the chunk, bit-identically on regeneration", () => {
    // (130,130) is deep-inland; if this exact chunk happens to sit on gated
    // ground (a peak or a scree face) at this seed, scan outward for the first
    // chunk with props and pin THAT with a comment — do not loosen the test.
    const cx = 130, cz = 130; // x≈2080+: friendly inland forest
    const a = generateChunk(SEED, cx, cz);
    expect(a.props.length).toBeGreaterThan(0);
    for (const p of a.props) {
      expect(p.material).toBe("trunk");
      expect(p.box.min.x).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
      expect(p.box.max.x).toBeLessThanOrEqual((cx + 1) * CHUNK_SIZE);
      expect(p.box.min.z).toBeGreaterThanOrEqual(cz * CHUNK_SIZE);
      expect(p.box.max.z).toBeLessThanOrEqual((cz + 1) * CHUNK_SIZE);
      expect(p.box.max.y - p.box.min.y).toBeCloseTo(3, 6);
      // Real width even when the chunk border clips one side: at worst a
      // trunk keeps its inner half, TRUNK_HALF * min scale = 0.28. This is
      // the assertion that kills the degenerate-box (half × 0) mutant.
      expect(p.box.max.x - p.box.min.x).toBeGreaterThan(0.2);
      expect(p.box.max.z - p.box.min.z).toBeGreaterThan(0.2);
    }
    expect(a.props).toEqual(generateChunk(SEED, cx, cz).props);
  });
  it("the level id moves when a vegetation tunable moves", () => {
    const passes = registeredPasses();
    const patched = passes.map((p) =>
      p.id === 6 ? { ...p, tunables: { ...p.tunables, TREELINE_HI: 191 } } : p,
    );
    expect(registryDigest(patched)).not.toBe(registryDigest(passes));
  });
  it("trunk boxes reach collision queries through the grid", () => {
    const grid = createChunkGrid(SEED);
    const chunk = grid.chunkAt(130, 130);
    const t = chunk.props[0]!;
    const near = grid.near(
      { x: t.box.min.x - 1, y: t.box.min.y - 1, z: t.box.min.z - 1 },
      { x: t.box.max.x + 1, y: t.box.max.y + 1, z: t.box.max.z + 1 },
    );
    expect(near.some((b) => b.min.x === t.box.min.x && b.min.z === t.box.min.z && b.max.y === t.box.max.y)).toBe(true);
  });
  it("groundSpawn rejects a candidate inside a trunk — the collected promise", () => {
    const grid = createChunkGrid(SEED);
    const t = grid.chunkAt(130, 130).props[0]!;
    const cx = (t.box.min.x + t.box.max.x) / 2;
    const cz = (t.box.min.z + t.box.max.z) / 2;
    expect(groundSpawn(grid, SEED, cx, cz, PLAYER_HALF)).toBeNull();
  });
});

describe("cohort collision", () => {
  it("gives giants a wider trunk than saplings, and logs none at all", () => {
    // Scan for a chunk with at least one standing tree and one log.
    function findChunkWithLogsAndStanding() {
      for (let cx = 130; cx < 145; cx++) {
        for (let cz = 130; cz < 145; cz++) {
          const chunk = generateChunk(SEED, cx, cz);
          const trees = treesInRect(SEED, cx * CHUNK_SIZE, cz * CHUNK_SIZE,
            (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE);
          const logs = trees.filter((t) => t.cohort === COHORT_LOG);
          const standing = trees.filter((t) => t.cohort !== COHORT_LOG);
          if (standing.length > 0 && logs.length > 0) return { chunk, standing, logs };
        }
      }
    }
    const found = findChunkWithLogsAndStanding();
    expect(found).toBeDefined();
    const { chunk, standing, logs } = found!;
    expect(standing.length).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
    // One brush per standing stem, none for fallen logs.
    expect(chunk.props.length).toBe(standing.length);
    for (const l of logs) {
      const hit = chunk.props.some(
        (p) => l.x >= p.box.min.x && l.x <= p.box.max.x && l.z >= p.box.min.z && l.z <= p.box.max.z,
      );
      expect(hit).toBe(false);
    }
  });
});
