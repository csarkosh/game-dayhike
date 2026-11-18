import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLY_SWAP_READY_MAX_MS,
  GOVERNOR_SWAP_READY_MAX_MS,
  SWAP_SCENE_MIN_MS,
  engineWithinBound,
  type EngineOnCanvas,
} from "../../src/game/rendererSwap.js";
import { whenWorldIn } from "../../src/game/worldWait.js";

/**
 * A switch has the canvas its new renderer is built on made under the cover.
 * `engineWithinBound` counts that against the cover's bound, so the cover
 * stays up for the bound its caller names plus the build, and a canvas too
 * slow for it gives way to a fresh one at the tier, remembered against
 * nothing. A canvas carries no engine: the renderer built on it makes its
 * own, so one that comes late has nothing to let go of.
 */
describe("the canvas a switch has made, within its cover's bound", () => {
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

  /** A canvas named `slow`, made after `ms`. */
  function slowCanvas(ms: number) {
    let asked: (() => boolean) | null = null;
    const made: EngineOnCanvas = { canvas: { id: "slow" } as unknown as HTMLCanvasElement };
    const make = (wanted: () => boolean): Promise<EngineOnCanvas> => {
      asked = wanted;
      return new Promise((resolve) => setTimeout(() => resolve(made), ms));
    };
    const deps = {
      ...timers,
      fresh: (): EngineOnCanvas => ({ canvas: { id: "fresh" } as unknown as HTMLCanvasElement }),
    };
    return { made, make, deps, wanted: () => asked?.() ?? null };
  }

  it("hands the scene's wait what the making left of the governor's 10 s", async () => {
    expect(GOVERNOR_SWAP_READY_MAX_MS).toBe(10_000);
    const t = slowCanvas(3_000);
    const result = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(3_000);
    const got = await result;
    expect(got).toEqual({ onCanvas: t.made, leftMs: 7_000, late: false });
    expect(t.wanted()).toBe(true);
  });

  it("hands Apply's scene wait what is left of 20 s after a making of 12 s", async () => {
    expect(APPLY_SWAP_READY_MAX_MS).toBe(20_000);
    const t = slowCanvas(12_000);
    const result = engineWithinBound(t.make, APPLY_SWAP_READY_MAX_MS, t.deps);
    await advance(12_000);
    expect((await result).leftMs).toBe(8_000);
  });

  it("takes a fresh canvas at the bound where the one being made is not ready, and wants the late one no more", async () => {
    const t = slowCanvas(15_000);
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
    expect((got.onCanvas.canvas as unknown as { id: string }).id).toBe("fresh");
    // A failure the late making meets from here is not remembered.
    expect(t.wanted()).toBe(false);
    // The late canvas arrives and is left: there is no engine on it to let go of.
    await advance(5_000);
    expect(t.wanted()).toBe(false);
  });

  it("leaves the scene at least its 5 s floor however much of the bound the making took", async () => {
    expect(SWAP_SCENE_MIN_MS).toBe(5_000);
    const t = slowCanvas(8_000);
    const result = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(8_000);
    expect(await result).toEqual({ onCanvas: t.made, leftMs: 5_000, late: false });
  });

  /** A world that is in `inAt` ms after it is asked, or never (null): what the renderer built on the canvas waits on (`Renderer.whenReady`). */
  function worldInAfter(inAt: number | null): Promise<void> {
    return inAt === null ? new Promise(() => undefined) : new Promise((resolve) => setTimeout(resolve, inAt));
  }

  it("after a making of 12 s under a 10 s bound, lifts the cover when the world is in, 3 s after its build", async () => {
    const t = slowCanvas(12_000);
    const made = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(10_000);
    const got = await made;
    expect(got.late).toBe(true);
    // The build, then the wait for its world.
    let lifted = false;
    void whenWorldIn(worldInAfter(3_000), got.leftMs).then(() => (lifted = true));
    await advance(2_900);
    expect(lifted).toBe(false);
    await advance(100);
    expect(lifted).toBe(true);
  });

  it("after a making of 12 s under a 10 s bound, lifts the cover 5 s after the build where the world never comes in", async () => {
    const t = slowCanvas(12_000);
    const made = engineWithinBound(t.make, GOVERNOR_SWAP_READY_MAX_MS, t.deps);
    await advance(10_000);
    const got = await made;
    let lifted = false;
    void whenWorldIn(worldInAfter(null), got.leftMs).then(() => (lifted = true));
    await advance(4_999);
    expect(lifted).toBe(false);
    await advance(1);
    expect(lifted).toBe(true);
  });

  it("takes a fresh canvas at the bound where the making would reject later, and never throws", async () => {
    const deps = { ...timers, fresh: (): EngineOnCanvas => ({ canvas: {} as HTMLCanvasElement }) };
    const result = engineWithinBound(() => new Promise((_, reject) => setTimeout(() => reject(new Error("no device")), 12_000)), 10_000, deps);
    await advance(10_000);
    expect((await result).late).toBe(true);
    await advance(2_000);
  });
});
