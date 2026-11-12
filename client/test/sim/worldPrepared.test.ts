import { describe, expect, it, vi } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";

type Sim = {
  terrain: typeof import("../../src/sim/terrain.js");
  forest: typeof import("../../src/sim/forest.js");
  olympic: typeof import("../../src/sim/olympic.js");
  spawn: typeof import("../../src/sim/spawn.js");
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
  };
}
const SEED = 627994160;
/** What a hike's world is, as far as two threads must agree: its id, its start and its ground. */
function fingerprint(sim: Sim) {
  const forest = sim.forest.createForest(SEED);
  const heights: number[] = [];
  for (let i = 0; i < 64; i++) heights.push(sim.terrain.elevationSampleAt(SEED, (i % 8) * 137 - 480, Math.floor(i / 8) * 211 - 700).h);
  return { levelId: forest.levelId, fieldHash: forest.fieldHash, passHash: forest.passHash, start: sim.spawn.trailheadStart(SEED), heights };
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
  }, timeLimit(120_000));

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
