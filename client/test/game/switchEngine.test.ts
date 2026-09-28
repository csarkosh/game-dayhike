import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core/scene.js";
import {
  APPLY_SWAP_READY_MAX_MS,
  GOVERNOR_SWAP_READY_MAX_MS,
  SWAP_SCENE_MIN_MS,
  engineWithinBound,
  whenSceneReady,
  type EngineOnCanvas,
} from "../../src/game/rendererSwap.js";

/**
 * A switch into WebGPU makes its engine under the cover. `engineWithinBound`
 * counts that against the cover's bound, so the cover stays up for the bound
 * its caller names plus the build, and an engine too slow for it gives way to
 * WebGL2 at the tier, remembered against nothing.
 */
describe("the engine a switch makes, within its cover's bound", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The switch's clock, moved with the fake timers (no real clock is read). */
  const clock = { t: 0 };
  async function advance(ms: number): Promise<void> {
    clock.t += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }
  const timers = {
    now: () => clock.t,
    setTimer: (fn: () => void, at: number) => {
      const id = setTimeout(fn, at);
      return () => clearTimeout(id);
    },
  };

  /** An engine made after `ms`, on a canvas named `gpu`, whose dispose is counted. */
  function slowEngine(ms: number) {
    const log: string[] = [];
    let asked: (() => boolean) | null = null;
    const made: EngineOnCanvas = {
      canvas: { id: "gpu" } as unknown as HTMLCanvasElement,
      engine: { dispose: () => void log.push("disposed") } as never,
      watchers: null,
    };
    const make = (wanted: () => boolean): Promise<EngineOnCanvas> => {
      asked = wanted;
      return new Promise((resolve) => setTimeout(() => resolve(made), ms));
    };
    const deps = {
      ...timers,
      webgl2: (): EngineOnCanvas => ({ canvas: { id: "gl" } as unknown as HTMLCanvasElement, engine: null, watchers: null }),
    };
    return { log, made, make, deps, wanted: () => asked?.() ?? null };
  }

  it("hands the scene's wait what the engine left of the governor's 10 s", async () => {
    expect(GOVERNOR_SWAP_READY_MAX_MS).toBe(10_000);
    const t = slowEngine(3_000);
    const result = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(3_000);
    const got = await result;
    expect(got).toEqual({ onCanvas: t.made, leftMs: 7_000, late: false });
    expect(t.wanted()).toBe(true);
    expect(t.log).toEqual([]);
  });

  it("hands Apply's scene wait what is left of 20 s after a 12 s engine", async () => {
    expect(APPLY_SWAP_READY_MAX_MS).toBe(20_000);
    const t = slowEngine(12_000);
    const result = engineWithinBound(t.make, APPLY_SWAP_READY_MAX_MS, t.deps);
    await advance(12_000);
    expect((await result).leftMs).toBe(8_000);
  });

  it("takes WebGL2 at the bound where the engine is not ready, lets the late engine go, and wants it no more", async () => {
    const t = slowEngine(15_000);
    const result = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    let settled = false;
    void result.then(() => (settled = true));
    await advance(9_999);
    expect(settled).toBe(false);
    await advance(1);
    const got = await result;
    expect(got.late).toBe(true);
    // The scene still gets its floor: models and bakes load under the cover.
    expect(got.leftMs).toBe(5_000);
    expect(got.onCanvas.engine).toBe(null);
    expect((got.onCanvas.canvas as unknown as { id: string }).id).toBe("gl");
    // A failure the late start meets from here is not remembered.
    expect(t.wanted()).toBe(false);
    expect(t.log).toEqual([]);
    await advance(5_000);
    expect(t.log).toEqual(["disposed"]);
  });

  it("leaves the scene at least its 5 s floor however much of the bound the engine took", async () => {
    expect(SWAP_SCENE_MIN_MS).toBe(5_000);
    const t = slowEngine(8_000);
    const result = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(8_000);
    expect(await result).toEqual({ onCanvas: t.made, leftMs: 5_000, late: false });
  });

  /** A scene that is ready `readyAt` ms after it is asked, or never (null). */
  function sceneReadyAfter(readyAt: number | null): Scene {
    const from = clock.t;
    return {
      isDisposed: false,
      isReady: () => readyAt !== null && clock.t - from >= readyAt,
      getWaitingItemsCount: () => 0,
    } as unknown as Scene;
  }

  it("after an engine at 12 s of a 10 s bound, lifts the cover when the WebGL2 scene is ready, 3 s after its build", async () => {
    const t = slowEngine(12_000);
    const made = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(10_000);
    const got = await made;
    expect(got.late).toBe(true);
    // The build, then the wait for its scene.
    let lifted = false;
    void whenSceneReady(sceneReadyAfter(3_000), got.leftMs).then(() => (lifted = true));
    await advance(2_900);
    expect(lifted).toBe(false);
    await advance(100);
    expect(lifted).toBe(true);
  });

  it("after an engine at 12 s of a 10 s bound, lifts the cover 5 s after the build where the scene is never ready", async () => {
    const t = slowEngine(12_000);
    const made = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(10_000);
    const got = await made;
    let lifted = false;
    void whenSceneReady(sceneReadyAfter(null), got.leftMs).then(() => (lifted = true));
    await advance(4_999);
    expect(lifted).toBe(false);
    await advance(1);
    expect(lifted).toBe(true);
  });

  it("takes WebGL2 at the bound where the engine's making would reject later, and never throws", async () => {
    const deps = { ...timers, webgl2: (): EngineOnCanvas => ({ canvas: {} as HTMLCanvasElement, engine: null, watchers: null }) };
    const result = engineWithinBound(() => new Promise((_, reject) => setTimeout(() => reject(new Error("no device")), 12_000)), 10_000, deps);
    await advance(10_000);
    expect((await result).late).toBe(true);
    await advance(2_000);
  });
});
