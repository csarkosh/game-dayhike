import { describe, expect, it, vi } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";

type Sim = {
  terrain: typeof import("../../src/sim/terrain.js");
  forest: typeof import("../../src/sim/forest.js");
  olympic: typeof import("../../src/sim/olympic.js");
  spawn: typeof import("../../src/sim/spawn.js");
  world: typeof import("../../src/sim/world.js");
  chunk: typeof import("../../src/sim/chunk.js");
  chunkGrid: typeof import("../../src/sim/chunkGrid.js");
  constants: typeof import("../../src/sim/constants.js");
  trailRoute: typeof import("../../src/sim/trailRoute.js");
};
/** A sim of its own, as another thread's is: its module caches are empty. */
async function freshSim(): Promise<Sim> {
  vi.resetModules();
  await import("../../src/sim/passes/index.js");
  return {
    terrain: await import("../../src/sim/terrain.js"),
    forest: await import("../../src/sim/forest.js"),
    olympic: await import("../../src/sim/olympic.js"),
    spawn: await import("../../src/sim/spawn.js"),
    world: await import("../../src/sim/world.js"),
    chunk: await import("../../src/sim/chunk.js"),
    chunkGrid: await import("../../src/sim/chunkGrid.js"),
    constants: await import("../../src/sim/constants.js"),
    trailRoute: await import("../../src/sim/trailRoute.js"),
  };
}
const SEED = 627994160;
/**
 * What a hike's world is, as far as two threads must agree: its id, its start, its ground, the
 * chunks along its trail, the trail's routes (which the ground never reads), and the simulation's
 * whole state after a hiker has walked up the stem for five seconds.
 */
function fingerprint(sim: Sim) {
  const forest = sim.forest.createForest(SEED);
  const heights: number[] = [];
  for (let i = 0; i < 64; i++) heights.push(sim.terrain.elevationSampleAt(SEED, (i % 8) * 137 - 480, Math.floor(i / 8) * 211 - 700).h);
  const world = sim.world.createForestWorld(forest, true, false);
  const graph = world.trail;
  if (graph === null) throw new Error("the default terrain has a trail");
  const player = sim.world.spawnPlayer(world);
  const states: string[] = [];
  for (let tick = 0; tick < 300; tick++) {
    const at = world.state.players.get(player.id);
    const ahead = at === undefined ? null : sim.trailRoute.stemAhead(graph, at.pos.x, at.pos.z, 12);
    const yaw = ahead === null || at === undefined ? 0 : Math.atan2(ahead.x - at.pos.x, ahead.z - at.pos.z);
    sim.world.tickWorld(world, new Map([[player.id, { seq: tick + 1, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: tick === 100 ? 1 : 0 }]]));
    if (tick % 100 === 99) states.push(sim.world.serializeWorldState(world.state));
  }
  const chunks: unknown[] = [];
  for (let n = 0; n < graph.nodes.length; n += Math.max(1, Math.floor(graph.nodes.length / 6))) {
    const node = graph.nodes[n] as { x: number; z: number };
    const made = sim.chunk.generateChunk(SEED, Math.floor(node.x / 32), Math.floor(node.z / 32));
    chunks.push([Array.from(made.columns), made.props]);
  }
  const routes = [sim.trailRoute.route(graph, 0, graph.summit), sim.trailRoute.route(graph, graph.summit, 0), graph.forks, graph.homeDist];
  return { levelId: forest.levelId, fieldHash: forest.fieldHash, passHash: forest.passHash, start: sim.spawn.trailheadStart(SEED), heights, states, chunks, routes };
}

describe("a world prepared in another thread", () => {
  it("is the same world when its bowl was cloned across and installed", async () => {
    const worker = await freshSim();
    const prepared = structuredClone(worker.terrain.activeTerrainVariant().prepare?.(SEED));
    const key = worker.forest.passHashKey();
    const hash = worker.forest.passHash();
    const page = await freshSim();
    expect(page.terrain.activeTerrainVariant().install?.(SEED, prepared)).toBe(true);
    expect(page.forest.installPassHash(hash, key)).toBe(true);
    // The page made no trail of its own: it has the one it was given.
    expect(page.olympic.bowlFor(SEED)).toBe(prepared);
    const withInstall = fingerprint(page);
    const alone = fingerprint(await freshSim());
    expect(withInstall).toEqual(alone);
    expect(withInstall.passHash).toBe(64181734);
    expect(withInstall.states).toHaveLength(3);
    expect(withInstall.chunks.length).toBeGreaterThanOrEqual(6);
  }, timeLimit(180_000));

  it("is the same world when the spawn's chunks were made in another thread and installed, and its spawn then generates none", async () => {
    const worker = await freshSim();
    const cells = worker.spawn.spawnChunkCells(SEED, worker.constants.PLAYER_HALF);
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells.length).toBeLessThanOrEqual(4);
    const chunks = structuredClone(cells.map(({ cx, cz }) => worker.chunk.generateChunk(SEED, cx, cz)));
    /** How many chunks placing the first player generates in `sim`'s world. */
    const generatedBySpawn = (sim: Sim): number => {
      const forest = sim.forest.createForest(SEED);
      const world = sim.world.createForestWorld(forest, true, false);
      const before = forest.grid.generatedCount();
      sim.world.spawnPlayer(world);
      return forest.grid.generatedCount() - before;
    };
    const page = await freshSim();
    expect(page.chunkGrid.installChunks(SEED, "olympic", chunks)).toBe(true);
    expect(generatedBySpawn(page)).toBe(0);
    // The control: with nothing installed, the spawn generates exactly the cells named.
    expect(generatedBySpawn(await freshSim())).toBe(cells.length);
    const again = await freshSim();
    expect(again.chunkGrid.installChunks(SEED, "olympic", structuredClone(chunks))).toBe(true);
    expect(fingerprint(again)).toEqual(fingerprint(await freshSim()));
  }, timeLimit(240_000));

  it("names no chunk for a spawn on a terrain with no trailhead", async () => {
    const sim = await freshSim();
    sim.terrain.setActiveTerrainVariant("montane");
    expect(sim.spawn.spawnChunkCells(SEED, sim.constants.PLAYER_HALF)).toEqual([]);
  });

  it("is a different world when the bowl it was given is not the one it would have made", async () => {
    // What the comparison above can see: a trail whose way home, which no height reads, was altered on the way.
    const worker = await freshSim();
    const altered = structuredClone(worker.olympic.bowlFor(SEED));
    const homeDist = altered.graph.homeDist as unknown as number[];
    homeDist[homeDist.length - 1] = (homeDist[homeDist.length - 1] as number) + 1;
    const page = await freshSim();
    expect(page.olympic.installBowl(SEED, altered)).toBe(true);
    const withAltered = fingerprint(page);
    const alone = fingerprint(await freshSim());
    expect(withAltered.routes).not.toEqual(alone.routes);
    expect(withAltered).not.toEqual(alone);
  }, timeLimit(180_000));

  it("keeps the bowl a seed already has", async () => {
    const sim = await freshSim();
    const own = sim.olympic.bowlFor(SEED);
    expect(sim.olympic.installBowl(SEED, structuredClone(own))).toBe(false);
    expect(sim.olympic.bowlFor(SEED)).toBe(own);
  }, timeLimit(60_000));

  it("keeps the trail graph's features and the bowl's features one array across a clone", async () => {
    const sim = await freshSim();
    const clone = structuredClone(sim.olympic.bowlFor(SEED));
    expect(clone.graph.features).toBe(clone.features);
  }, timeLimit(60_000));

  it("says whether a seed's bowl is held, without making it", async () => {
    const sim = await freshSim();
    const variant = sim.terrain.activeTerrainVariant();
    expect(variant.isPrepared?.(SEED)).toBe(false);
    sim.olympic.bowlFor(SEED);
    expect(variant.isPrepared?.(SEED)).toBe(true);
    expect(variant.isPrepared?.(SEED + 1)).toBe(false);
  }, timeLimit(60_000));

  it("says whether the pass hash is held for a terrain, without making it", async () => {
    const sim = await freshSim();
    expect(sim.forest.passHashCachedFor("olympic")).toBe(false);
    sim.forest.passHash();
    expect(sim.forest.passHashCachedFor("olympic")).toBe(true);
    expect(sim.forest.passHashCachedFor("montane")).toBe(false);
  }, timeLimit(60_000));

  it("has nothing to prepare on a terrain with no trail", async () => {
    const sim = await freshSim();
    expect(sim.terrain.terrainVariant("montane")?.prepare).toBeUndefined();
    expect(sim.terrain.terrainVariant("montane")?.install).toBeUndefined();
    expect(sim.terrain.terrainVariant("nowhere")).toBeUndefined();
  });
});
