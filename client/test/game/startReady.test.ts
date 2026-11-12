import { describe, expect, it } from "vitest";
import { READY_MAX_MS, startReady } from "../../src/game/startReady.js";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the start-time gate", () => {
  it("resolves when the scene is ready and the forest's layers are in, then gates the bar", async () => {
    const p = createLoadProgress();
    let readyCalls = 0;
    const scene = { isDisposed: false, meshes: [], isReady: () => ++readyCalls > 2, getWaitingItemsCount: () => 0 };
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: p, maxMs: 5000 });
    expect(p.view().ready).toBe(true);
    expect(readyCalls).toBeGreaterThan(2);
  }, timeLimit(10_000));

  it("waits for the whole-frame reveal on WebGPU before it gates", async () => {
    const p = createLoadProgress();
    let lifted = false;
    const scene = { isDisposed: false, meshes: [], isReady: () => true, getWaitingItemsCount: () => 0 };
    const reveal = new Promise<void>((r) => setTimeout(() => { lifted = true; r(); }, 50));
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal, progress: p, maxMs: 5000 });
    expect(lifted).toBe(true);
    expect(p.view().ready).toBe(true);
  }, timeLimit(10_000));

  it("gates without a bar, and waits at most a minute for the world", async () => {
    const scene = { isDisposed: false, meshes: [], isReady: () => true, getWaitingItemsCount: () => 0 };
    await expect(startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: null, maxMs: 5000 })).resolves.toBeUndefined();
    expect(READY_MAX_MS).toBe(60_000);
  }, timeLimit(10_000));

  it("is not ready while a first build is still being stepped, and is when it ends", async () => {
    const scene = { isDisposed: false, meshes: [], isReady: () => true, getWaitingItemsCount: () => 0 };
    let built!: () => void;
    const firstBuilds = new Promise<void>((resolve) => { built = resolve; });
    let ready = false;
    void startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: null, maxMs: 60_000, firstBuilds: () => firstBuilds }).then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 250));
    expect(ready).toBe(false);
    built();
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(true);
  }, timeLimit(10_000));

  it("asks for the first builds only once the scene is ready: a fill queued when the models land is not missed", async () => {
    const order: string[] = [];
    let readyCalls = 0;
    const scene = { isDisposed: false, meshes: [], isReady: () => { if (++readyCalls > 2) { order.push("scene"); return true; } return false; }, getWaitingItemsCount: () => 0 };
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: null, maxMs: 5000, firstBuilds: () => { order.push("fills"); return Promise.resolve(); } });
    expect(order[0]).toBe("scene");
    expect(order.at(-1)).toBe("fills");
    expect(order.filter((x) => x === "fills")).toHaveLength(1);
  }, timeLimit(10_000));

  it("calls the world ready at maxMs though a first build never ends", async () => {
    const scene = { isDisposed: false, meshes: [], isReady: () => true, getWaitingItemsCount: () => 0 };
    const p = createLoadProgress();
    // The limit is the gate's own (300 ms here): the test's is ten seconds, and this would never resolve without one.
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: p, maxMs: 300, firstBuilds: () => new Promise(() => undefined) });
    expect(p.view().ready).toBe(true);
  }, timeLimit(10_000));
});
