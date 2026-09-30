import { describe, expect, it } from "vitest";
import { READY_MAX_MS, startReady } from "../../src/game/startReady.js";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the start-time gate", () => {
  it("resolves when the scene is ready and the forest's layers are in, then gates the bar", async () => {
    const p = createLoadProgress();
    let readyCalls = 0;
    const scene = { isDisposed: false, isReady: () => ++readyCalls > 2, getWaitingItemsCount: () => 0 };
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: p, maxMs: 5000 });
    expect(p.view().ready).toBe(true);
    expect(readyCalls).toBeGreaterThan(2);
  }, timeLimit(10_000));

  it("waits for the whole-frame reveal on WebGPU before it gates", async () => {
    const p = createLoadProgress();
    let lifted = false;
    const scene = { isDisposed: false, isReady: () => true, getWaitingItemsCount: () => 0 };
    const reveal = new Promise<void>((r) => setTimeout(() => { lifted = true; r(); }, 50));
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal, progress: p, maxMs: 5000 });
    expect(lifted).toBe(true);
    expect(p.view().ready).toBe(true);
  }, timeLimit(10_000));

  it("gates without a bar, and waits at most a minute for the world", async () => {
    const scene = { isDisposed: false, isReady: () => true, getWaitingItemsCount: () => 0 };
    await expect(startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: null, maxMs: 5000 })).resolves.toBeUndefined();
    expect(READY_MAX_MS).toBe(60_000);
  }, timeLimit(10_000));
});
