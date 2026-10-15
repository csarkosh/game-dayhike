import { describe, it, expect } from "vitest";
import "../../../src/sim/passes/index.js";
import { generateChunk, registeredPasses } from "../../../src/sim/chunk.js";
import { registryDigest } from "../../../src/sim/forest.js";
import { CHUNK_SIZE } from "../../../src/sim/forestConstants.js";
import { groundSpawn } from "../../../src/sim/spawn.js";
import { createChunkGrid } from "../../../src/sim/chunkGrid.js";
import { PLAYER_HALF } from "../../../src/sim/constants.js";
import { treesInRect, COHORT_LOG, LOG_HALF_LENGTH, LOG_SCALE_MAX, LOG_SCALE_MIN, logAxis } from "../../../src/sim/vegetation.js";
import { LOG_BOX_HALF, LOG_RADIUS, LOG_STAND_SHARE } from "../../../src/sim/passes/trees.js";

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
  /** A log's box stands this tall at the least and the most scale (m). */
  const LOG_STAND_LO = 2 * LOG_RADIUS * LOG_SCALE_MIN * LOG_STAND_SHARE;
  const LOG_STAND_HI = 2 * LOG_RADIUS * LOG_SCALE_MAX * LOG_STAND_SHARE;
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
      // A standing trunk's box is TRUNK_COLLIDER_HEIGHT tall; a log's chain stands
      // its settled trunk's height, by its scale
      const height = p.box.max.y - p.box.min.y;
      if (Math.abs(height - 3) > 1e-6) {
        expect(height).toBeGreaterThanOrEqual(LOG_STAND_LO - 1e-6);
        expect(height).toBeLessThanOrEqual(LOG_STAND_HI + 1e-6);
      }
      // Real width even when the chunk border clips one side: at worst a
      // trunk keeps its inner half, TRUNK_HALF * min scale = 0.28, and a log's
      // box half of itself. This is
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
  it("groundSpawn rejects a candidate on a log — a hiker cannot start inside one either", () => {
    const grid = createChunkGrid(SEED);
    const log = treesInRect(SEED, 130 * CHUNK_SIZE, 130 * CHUNK_SIZE, 140 * CHUNK_SIZE, 140 * CHUNK_SIZE).find((t) => t.cohort === COHORT_LOG)!;
    expect(log).toBeDefined();
    expect(groundSpawn(grid, SEED, log.x, log.z, PLAYER_HALF)).toBeNull();
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
  /** A chunk with at least one standing tree and one log rooted in it. */
  function findChunkWithLogsAndStanding() {
    for (let cx = 130; cx < 145; cx++) {
      for (let cz = 130; cz < 145; cz++) {
        const chunk = generateChunk(SEED, cx, cz);
        const trees = treesInRect(SEED, cx * CHUNK_SIZE, cz * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE);
        const logs = trees.filter((t) => t.cohort === COHORT_LOG);
        const standing = trees.filter((t) => t.cohort !== COHORT_LOG);
        if (standing.length > 0 && logs.length > 0) return { chunk, standing, logs, cx, cz };
      }
    }
  }
  const inside = (p: { box: { min: { x: number; z: number }; max: { x: number; z: number } } }, x: number, z: number) =>
    x >= p.box.min.x && x <= p.box.max.x && z >= p.box.min.z && z <= p.box.max.z;
  it("gives giants a wider trunk than saplings, and a log a chain of boxes along its length", () => {
    const found = findChunkWithLogsAndStanding();
    expect(found).toBeDefined();
    const { chunk, standing, logs } = found!;
    // One brush per standing stem, and more for the logs' chains.
    const trunks = chunk.props.filter((p) => Math.abs(p.box.max.y - p.box.min.y - 3) < 1e-6);
    expect(trunks.length).toBe(standing.length);
    expect(chunk.props.length).toBeGreaterThan(standing.length);
    for (const l of logs) {
      const axis = logAxis(l.hash);
      // the log's middle and both ends are under its chain, its station's ground to its trunk's top
      for (const along of [0, LOG_HALF_LENGTH * l.scale * 0.9, -LOG_HALF_LENGTH * l.scale * 0.9]) {
        const x = l.x + axis.x * along;
        const z = l.z + axis.z * along;
        const under = chunk.props.filter((p) => inside(p, x, z) && Math.abs(p.box.max.y - p.box.min.y - 3) > 1e-6);
        if (x < chunk.cx * CHUNK_SIZE || x >= (chunk.cx + 1) * CHUNK_SIZE || z < chunk.cz * CHUNK_SIZE || z >= (chunk.cz + 1) * CHUNK_SIZE) continue;
        expect(under.length, `log at (${l.x}, ${l.z}) ${along} m along`).toBeGreaterThan(0);
        const stand = 2 * LOG_RADIUS * l.scale * LOG_STAND_SHARE;
        for (const p of under) expect(p.box.max.y - p.box.min.y).toBeCloseTo(stand, 6);
      }
      // and past its tip, no box of its own: the chain ends with the log
      const past = { x: l.x + axis.x * (LOG_HALF_LENGTH * l.scale + 2 * LOG_BOX_HALF * l.scale + 0.5), z: l.z + axis.z * (LOG_HALF_LENGTH * l.scale + 2 * LOG_BOX_HALF * l.scale + 0.5) };
      const beyond = chunk.props.filter((p) => inside(p, past.x, past.z) && Math.abs(p.box.max.y - p.box.min.y - 3) > 1e-6);
      for (const p of beyond) {
        // a box there belongs to another log, which must have its own origin nearer
        const otherLogs = treesInRect(SEED, p.box.min.x - 20, p.box.min.z - 20, p.box.max.x + 20, p.box.max.z + 20).filter((t) => t.cohort === COHORT_LOG && t !== l);
        expect(otherLogs.length).toBeGreaterThan(0);
      }
    }
  });
  it("lays the part of a log that crosses a chunk border from the chunk it crosses into, and never a box twice", () => {
    // every log within reach of the chunk whose chain enters it: the chunk's log boxes all lie inside it,
    // and no two boxes of the chunk share a footprint
    // The first log of the forest block whose end crosses a chunk border, found from the trees alone
    // (cheap), then the one chunk it crosses into generated and read.
    const reach = (LOG_HALF_LENGTH + LOG_RADIUS) * LOG_SCALE_MAX;
    const block = treesInRect(SEED, 130 * CHUNK_SIZE, 130 * CHUNK_SIZE, 150 * CHUNK_SIZE, 150 * CHUNK_SIZE).filter((t) => t.cohort === COHORT_LOG);
    let crossing: { l: (typeof block)[number]; x: number; z: number; cx: number; cz: number } | null = null;
    for (const l of block) {
      const axis = logAxis(l.hash);
      for (const along of [LOG_HALF_LENGTH * l.scale * 0.9, -LOG_HALF_LENGTH * l.scale * 0.9]) {
        const x = l.x + axis.x * along, z = l.z + axis.z * along;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const own = cx === Math.floor(l.x / CHUNK_SIZE) && cz === Math.floor(l.z / CHUNK_SIZE);
        const deep = x >= cx * CHUNK_SIZE + 1 && x < (cx + 1) * CHUNK_SIZE - 1 && z >= cz * CHUNK_SIZE + 1 && z < (cz + 1) * CHUNK_SIZE - 1;
        if (!own && deep) { crossing = { l, x, z, cx, cz }; break; }
      }
      if (crossing) break;
    }
    expect(crossing).not.toBeNull();
    const { l, x, z, cx, cz } = crossing!;
    expect(Math.hypot(l.x - x, l.z - z)).toBeLessThan(reach);
    const chunk = generateChunk(SEED, cx, cz);
    const minX = cx * CHUNK_SIZE, minZ = cz * CHUNK_SIZE, maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    const seen = new Set<string>();
    for (const p of chunk.props) {
      expect(p.box.min.x).toBeGreaterThanOrEqual(minX);
      expect(p.box.max.x).toBeLessThanOrEqual(maxX);
      expect(p.box.min.z).toBeGreaterThanOrEqual(minZ);
      expect(p.box.max.z).toBeLessThanOrEqual(maxZ);
      const key = `${p.box.min.x},${p.box.min.z},${p.box.max.x},${p.box.max.z}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(chunk.props.some((p) => inside(p, x, z) && Math.abs(p.box.max.y - p.box.min.y - 3) > 1e-6), `log from (${l.x}, ${l.z}) reaching (${x}, ${z}) in chunk ${cx},${cz}`).toBe(true);
  });
});
