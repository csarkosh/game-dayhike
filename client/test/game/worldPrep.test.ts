import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/sim/passes/index.js";
import { WORLD_PREP_TIMEOUT_MS, sceneLine, startWorldPrep, worldPrepLine, type WorldPrepOutcome } from "../../src/game/worldPrep.js";
import type { PreparedScene } from "../../src/game/preparedScene.js";
import type { QualityTier } from "../../src/game/quality.js";
import type { WorldPrepReply } from "../../src/game/world.worker.js";
import { installPassHash, passHash, passHashCachedFor, passHashKey } from "../../src/sim/forest.js";
import { bowlFor, type Bowl } from "../../src/sim/olympic.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant, terrainVariant } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A Worker that records what it is sent and whether it was ended; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  readonly posted: unknown[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<WorldPrepReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (FakeWorker.refuse) throw new Error("no worker to be had");
    FakeWorker.made.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated++;
  }
  /** The id of the one request it was sent. */
  get id(): number {
    return (this.posted[0] as { id: number }).id;
  }
  send(reply: WorldPrepReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<WorldPrepReply>);
  }
}

/** A bowl for `seed` made by a sim of its own, as a worker's is, and cloned as a message is. */
async function bowlFromAnotherSim(seed: number): Promise<Bowl> {
  vi.resetModules();
  await import("../../src/sim/passes/index.js");
  const other = await import("../../src/sim/olympic.js");
  expect(other.bowlFor).not.toBe(bowlFor);
  return structuredClone(other.bowlFor(seed));
}

/** Whether this thread's sim holds a bowl for `seed`, without making one. */
const hasBowl = (seed: number): boolean => terrainVariant("olympic")?.isPrepared?.(seed) === true;
/** Empties the pass hash's cache: a hash installed for a terrain that is never active is never read. */
const forgetPassHash = (): void => void installPassHash(0, { passCount: passHashKey().passCount, variant: "no terrain" });

/** The outcome once `ready` has settled, or null while it has not. */
async function settled(ready: Promise<WorldPrepOutcome>): Promise<WorldPrepOutcome | null> {
  let outcome: WorldPrepOutcome | null = null;
  void ready.then((o) => (outcome = o));
  await Promise.resolve();
  await Promise.resolve();
  return outcome;
}

describe("the console's line for how the world's worker ended", () => {
  it("names the way out, the time and what was installed", () => {
    expect(worldPrepLine({ why: "done", prepared: true, passHash: true, ms: 1479.6 })).toBe("world prep: done in 1480 ms, the trail and the level check installed");
    expect(worldPrepLine({ why: "timeout", prepared: true, passHash: false, ms: 30000 })).toBe("world prep: timeout in 30000 ms, the trail installed");
    expect(worldPrepLine({ why: "done", prepared: false, passHash: true, ms: 800 })).toBe("world prep: done in 800 ms, the level check installed");
    expect(worldPrepLine({ why: "failed", prepared: false, passHash: false, ms: 12.2 })).toBe("world prep: failed in 12 ms, nothing installed");
    expect(worldPrepLine({ why: "cached", prepared: false, passHash: false, ms: 0 })).toBe("world prep: cached in 0 ms, nothing installed");
  });

  it("says whether the first scene was made, for which tier and in how long", () => {
    expect(sceneLine("low", { tier: "low" } as PreparedScene, 412.4)).toBe("world scene: made for low in 412 ms");
    expect(sceneLine("high", null, 30000)).toBe("world scene: none for high in 30000 ms");
  });
});

describe("a hike's world, prepared for the page by its worker", () => {
  let clock = 0;
  const deps = { now: () => clock };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.made = [];
    FakeWorker.refuse = false;
    clock = 1000;
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    forgetPassHash();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts a module worker in the form Vite bundles", () => {
    const text = readFileSync(new URL("../../src/game/worldPrep.ts", import.meta.url), "utf8");
    // The code alone: the form is also written in a comment, which would pass whatever the call said.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" })');
  });

  it("starts the worker as a module and asks it for the hike's seed and terrain, all of it", () => {
    const prep = startWorldPrep({ seed: 9, variant: "olympic" }, deps);
    expect(FakeWorker.made).toHaveLength(1);
    const worker = FakeWorker.made[0] as FakeWorker;
    expect(String(worker.url)).toMatch(/world\.worker\.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.posted).toEqual([{ id: worker.id, seed: 9, variant: "olympic", skip: { prepared: false, passHash: false } }]);
    prep.dispose();
  });

  it("installs the bowl and the pass hash as they arrive, and is ready when the worker is done", async () => {
    const bowl = await bowlFromAnotherSim(9);
    const prep = startWorldPrep({ seed: 9, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id, kind: "prepared", seed: 9, variant: "olympic", prepared: bowl });
    expect(bowlFor(9)).toBe(bowl);
    expect(await settled(prep.ready)).toBeNull();
    worker.send({ id: worker.id, kind: "passHash", hash: 64181734, passCount: passHashKey().passCount, variant: "olympic" });
    expect(passHashCachedFor("olympic")).toBe(true);
    clock = 1750;
    worker.send({ id: worker.id, kind: "done" });
    expect(await prep.ready).toEqual({ why: "done", prepared: true, passHash: true, ms: 750 });
    expect(passHash()).toBe(64181734);
    // The worker is kept, with the bowl it made, for the hike's first scene; no timer left running ends it.
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS * 2);
    expect(worker.terminated).toBe(0);
    prep.dispose();
    expect(worker.terminated).toBe(1);
  }, timeLimit(120_000));

  it("drops a reply that is not this request's: another id, another seed, another terrain", async () => {
    const bowl = { graph: {}, landmarks: [], features: [] } as unknown as Bowl;
    const prep = startWorldPrep({ seed: 10, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id + 1, kind: "prepared", seed: 10, variant: "olympic", prepared: bowl });
    worker.send({ id: worker.id, kind: "prepared", seed: 11, variant: "olympic", prepared: bowl });
    worker.send({ id: worker.id, kind: "prepared", seed: 10, variant: "montane", prepared: bowl });
    worker.send({ id: worker.id, kind: "passHash", hash: 5, passCount: passHashKey().passCount, variant: "montane" });
    worker.send({ id: worker.id + 1, kind: "passHash", hash: 5, passCount: passHashKey().passCount, variant: "olympic" });
    worker.send({ id: worker.id + 1, kind: "done" });
    expect(hasBowl(10)).toBe(false);
    expect(hasBowl(11)).toBe(false);
    expect(passHashCachedFor("olympic")).toBe(false);
    expect(passHashCachedFor("montane")).toBe(false);
    expect(await settled(prep.ready)).toBeNull();
    prep.dispose();
  });

  it("refuses a pass hash made over another count of passes", async () => {
    const prep = startWorldPrep({ seed: 12, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id, kind: "passHash", hash: 5, passCount: passHashKey().passCount + 1, variant: "olympic" });
    worker.send({ id: worker.id, kind: "done" });
    expect(await prep.ready).toEqual({ why: "done", prepared: false, passHash: false, ms: 0 });
    expect(passHashCachedFor("olympic")).toBe(false);
  });

  it("is ready at once, with nothing installed, where there is no Worker or it cannot be made", async () => {
    FakeWorker.refuse = true;
    expect(await startWorldPrep({ seed: 13, variant: "olympic" }, deps).ready).toEqual({ why: "no-worker", prepared: false, passHash: false, ms: 0 });
    vi.stubGlobal("Worker", undefined);
    expect(await startWorldPrep({ seed: 13, variant: "olympic" }, deps).ready).toEqual({ why: "no-worker", prepared: false, passHash: false, ms: 0 });
    expect(FakeWorker.made).toHaveLength(0);
  });

  it("gives up on a worker that fails, and installs nothing it sends after", async () => {
    for (const fail of ["onerror", "onmessageerror", "failed"] as const) {
      FakeWorker.made = [];
      const prep = startWorldPrep({ seed: 14, variant: "olympic" }, deps);
      const worker = FakeWorker.made[0] as FakeWorker;
      const late = worker.onmessage;
      if (fail === "failed") worker.send({ id: worker.id, kind: "failed", message: "it threw" });
      else worker[fail]?.({} as ErrorEvent & MessageEvent);
      expect(await prep.ready).toEqual({ why: "failed", prepared: false, passHash: false, ms: 0 });
      expect(worker.terminated).toBe(1);
      // A message already on its way when the worker was ended.
      late?.({ data: { id: worker.id, kind: "prepared", seed: 14, variant: "olympic", prepared: {} } } as MessageEvent<WorldPrepReply>);
      expect(hasBowl(14)).toBe(false);
    }
  });

  it("gives up after WORLD_PREP_TIMEOUT_MS, keeping what was installed by then", async () => {
    expect(WORLD_PREP_TIMEOUT_MS).toBe(30_000);
    const prep = startWorldPrep({ seed: 15, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id, kind: "passHash", hash: 64181734, passCount: passHashKey().passCount, variant: "olympic" });
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS - 1);
    expect(await settled(prep.ready)).toBeNull();
    clock = 31_000;
    vi.advanceTimersByTime(1);
    expect(await prep.ready).toEqual({ why: "timeout", prepared: false, passHash: true, ms: 30_000 });
    expect(worker.terminated).toBe(1);
  });

  it("ends the worker and installs nothing when it is disposed, once", async () => {
    const prep = startWorldPrep({ seed: 16, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    const late = worker.onmessage;
    prep.dispose();
    prep.dispose();
    expect(await prep.ready).toEqual({ why: "disposed", prepared: false, passHash: false, ms: 0 });
    expect(worker.terminated).toBe(1);
    late?.({ data: { id: worker.id, kind: "prepared", seed: 16, variant: "olympic", prepared: {} } } as MessageEvent<WorldPrepReply>);
    expect(hasBowl(16)).toBe(false);
  });

  it("never rejects: an install that throws, or a request that cannot be posted, is a failure", async () => {
    vi.spyOn(terrainVariant("olympic") as { install(seed: number, prepared: unknown): boolean }, "install").mockImplementation(() => {
      throw new Error("not a bowl");
    });
    const prep = startWorldPrep({ seed: 17, variant: "olympic" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id, kind: "prepared", seed: 17, variant: "olympic", prepared: 3 });
    expect(await prep.ready).toEqual({ why: "failed", prepared: false, passHash: false, ms: 0 });
    expect(worker.terminated).toBe(1);

    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(() => {
      throw new Error("cannot post");
    });
    expect((await startWorldPrep({ seed: 17, variant: "olympic" }, deps).ready).why).toBe("failed");
  });

  it("asks the worker only for what this thread does not hold, and starts none where it holds both", async () => {
    // The pass hash is held: a second hike on the page, another seed.
    installPassHash(64181734, passHashKey());
    const first = startWorldPrep({ seed: 18, variant: "olympic" }, deps);
    expect((FakeWorker.made[0] as FakeWorker).posted).toEqual([{ id: (FakeWorker.made[0] as FakeWorker).id, seed: 18, variant: "olympic", skip: { prepared: false, passHash: true } }]);
    first.dispose();
    // The bowl is held too: the same hike again.
    terrainVariant("olympic")?.install?.(18, await bowlFromAnotherSim(18));
    expect(await startWorldPrep({ seed: 18, variant: "olympic" }, deps).ready).toEqual({ why: "cached", prepared: false, passHash: false, ms: 0 });
    expect(FakeWorker.made).toHaveLength(1);
    // A terrain with nothing to prepare asks for its pass hash alone.
    startWorldPrep({ seed: 18, variant: "montane" }, deps).dispose();
    expect((FakeWorker.made[1] as FakeWorker).posted[0]).toMatchObject({ variant: "montane", skip: { prepared: true, passHash: false } });
  }, timeLimit(120_000));
});

describe("a hike's first scene, asked of the world's worker", () => {
  let clock = 0;
  const deps = { now: () => clock };
  /** A scene as the worker would send one: only what `scene()` checks. */
  const sceneFor = (seed: number, variant: string, tier: QualityTier): PreparedScene =>
    ({ seed, variant, tier, start: { x: 0, z: 0 }, rings: [], waterRings: null, waterFirst: null, waterBump: null, featureTable: null, bed: null, ocean: null, lakes: [] });
  /** Lets `ready`'s continuation, and what it starts, run. */
  const turn = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  /** A wrapper whose world is done, its worker, and the id of a scene request once one is posted. */
  async function doneWorld(seed: number): Promise<{ prep: ReturnType<typeof startWorldPrep>; worker: FakeWorker }> {
    const prep = startWorldPrep({ seed, variant: "montane" }, deps);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    worker.send({ id: worker.id, kind: "done" });
    expect((await prep.ready).why).toBe("done");
    return { prep, worker };
  }
  const sceneId = (worker: FakeWorker): number => (worker.posted.at(-1) as { id: number }).id;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.made = [];
    FakeWorker.refuse = false;
    clock = 1000;
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    forgetPassHash();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the worker it kept, once the world is ready, and resolves with the scene it sends, ending the worker", async () => {
    const prep = startWorldPrep({ seed: 9, variant: "montane" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    const asked = prep.scene("low");
    // A second call is the first's promise: one request, whatever it is asked.
    expect(prep.scene("high")).toBe(asked);
    await turn();
    // Not before the world is ready: the worker's own bowl is then made.
    expect(worker.posted).toHaveLength(1);
    worker.send({ id: worker.id, kind: "done" });
    await turn();
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toEqual({ id: sceneId(worker), kind: "scene", seed: 9, variant: "montane", tier: "low" });
    expect(sceneId(worker)).not.toBe(worker.id);
    expect(worker.terminated).toBe(0);
    const scene = sceneFor(9, "montane", "low");
    worker.send({ id: sceneId(worker), kind: "scene", scene });
    expect(await asked).toBe(scene);
    expect(worker.terminated).toBe(1);
    // The worker's `done` after it, and a timer left running, end nothing twice.
    worker.send({ id: sceneId(worker), kind: "done" });
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS * 2);
    expect(worker.terminated).toBe(1);
    expect(FakeWorker.made).toHaveLength(1);
  });

  it("drops a scene that is not this request's, and resolves null when the worker is done without one", async () => {
    const { prep, worker } = await doneWorld(10);
    const asked = prep.scene("low");
    await turn();
    const id = sceneId(worker);
    worker.send({ id: id + 1, kind: "scene", scene: sceneFor(10, "montane", "low") });
    worker.send({ id, kind: "scene", scene: sceneFor(11, "montane", "low") });
    worker.send({ id, kind: "scene", scene: sceneFor(10, "olympic", "low") });
    worker.send({ id, kind: "scene", scene: sceneFor(10, "montane", "high") });
    worker.send({ id: worker.id, kind: "done" });
    let got: PreparedScene | null | undefined;
    void asked.then((scene) => (got = scene));
    await turn();
    expect(got).toBeUndefined();
    worker.send({ id, kind: "done" });
    expect(await asked).toBeNull();
    expect(worker.terminated).toBe(1);
  });

  it("resolves null and ends the worker once on each way of giving up", async () => {
    for (const way of ["failed", "onerror", "onmessageerror", "timeout", "dispose", "unreadable"] as const) {
      const { prep, worker } = await doneWorld(12);
      const asked = prep.scene("low");
      await turn();
      const id = sceneId(worker);
      if (way === "failed") worker.send({ id, kind: "failed", message: "it threw" });
      else if (way === "onerror" || way === "onmessageerror") worker[way]?.({} as ErrorEvent & MessageEvent);
      else if (way === "timeout") vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS);
      else if (way === "dispose") prep.dispose();
      else worker.onmessage?.({ data: null } as unknown as MessageEvent<WorldPrepReply>);
      expect(await asked, way).toBeNull();
      expect(worker.terminated, way).toBe(1);
      // A scene already on its way when the worker was ended changes nothing.
      worker.send({ id, kind: "scene", scene: sceneFor(12, "montane", "low") });
      expect(await prep.scene("low"), way).toBeNull();
      prep.dispose();
      expect(worker.terminated, way).toBe(1);
    }
  });

  it("times the scene from its own request, not from the hike's start", async () => {
    const { prep, worker } = await doneWorld(13);
    // Long after the world was ready (a film that was slow to load).
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS * 3);
    const asked = prep.scene("medium");
    await turn();
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS - 1);
    const scene = sceneFor(13, "montane", "medium");
    worker.send({ id: sceneId(worker), kind: "scene", scene });
    expect(await asked).toBe(scene);
  });

  it("starts a worker for the scene alone where the page held the world already", async () => {
    installPassHash(5, { passCount: passHashKey().passCount, variant: "montane" });
    const prep = startWorldPrep({ seed: 14, variant: "montane" }, deps);
    expect((await prep.ready).why).toBe("cached");
    expect(FakeWorker.made).toHaveLength(0);
    const asked = prep.scene("low");
    await turn();
    expect(FakeWorker.made).toHaveLength(1);
    const worker = FakeWorker.made[0] as FakeWorker;
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.posted).toEqual([{ id: sceneId(worker), kind: "scene", seed: 14, variant: "montane", tier: "low" }]);
    const scene = sceneFor(14, "montane", "low");
    worker.send({ id: sceneId(worker), kind: "scene", scene });
    expect(await asked).toBe(scene);
    expect(worker.terminated).toBe(1);
  });

  it("has no scene where the world had no worker, where it failed or ran out of time, and starts none for it", async () => {
    FakeWorker.refuse = true;
    const none = startWorldPrep({ seed: 15, variant: "montane" }, deps);
    expect(await none.scene("low")).toBeNull();
    expect(FakeWorker.made).toHaveLength(0);
    // Held already, and no worker to be had for the scene alone.
    installPassHash(5, { passCount: passHashKey().passCount, variant: "montane" });
    expect(await startWorldPrep({ seed: 15, variant: "montane" }, deps).scene("low")).toBeNull();
    forgetPassHash();
    FakeWorker.refuse = false;
    const failed = startWorldPrep({ seed: 15, variant: "montane" }, deps);
    const worker = FakeWorker.made[0] as FakeWorker;
    worker.send({ id: worker.id, kind: "failed", message: "it threw" });
    expect(await failed.scene("low")).toBeNull();
    const slow = startWorldPrep({ seed: 15, variant: "montane" }, deps);
    vi.advanceTimersByTime(WORLD_PREP_TIMEOUT_MS);
    expect(await slow.scene("low")).toBeNull();
    expect(FakeWorker.made).toHaveLength(2);
    for (const made of FakeWorker.made) {
      expect(made.posted).toHaveLength(1);
      expect(made.terminated).toBe(1);
    }
  });

  it("asked after it was disposed, resolves null without starting or asking anything", async () => {
    const { prep, worker } = await doneWorld(16);
    prep.dispose();
    expect(worker.terminated).toBe(1);
    expect(await prep.scene("low")).toBeNull();
    expect(worker.posted).toHaveLength(1);
    // Where the page held the world: no worker is started for a hike that was left.
    installPassHash(5, { passCount: passHashKey().passCount, variant: "montane" });
    const held = startWorldPrep({ seed: 16, variant: "montane" }, deps);
    held.dispose();
    expect(await held.scene("low")).toBeNull();
    expect(FakeWorker.made).toHaveLength(1);
  });

  it("lets go of the scene when it is disposed: a later call does not hand it out again", async () => {
    const { prep, worker } = await doneWorld(17);
    const asked = prep.scene("low");
    await turn();
    const scene = sceneFor(17, "montane", "low");
    worker.send({ id: sceneId(worker), kind: "scene", scene });
    expect(await asked).toBe(scene);
    prep.dispose();
    expect(await prep.scene("low")).toBeNull();
  });

  it("never rejects: a scene request that cannot be posted is no scene", async () => {
    const { prep, worker } = await doneWorld(18);
    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(() => {
      throw new Error("cannot post");
    });
    expect(await prep.scene("low")).toBeNull();
    expect(worker.terminated).toBe(1);
  });
});
