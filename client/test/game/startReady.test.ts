import { describe, expect, it } from "vitest";
import { READY_MAX_MS, startReady } from "@csarkosh/engine/game/startReady";
import { createLoadProgress } from "@csarkosh/engine/game/loadProgress";
import { whenWorldIn } from "@csarkosh/engine/game/worldWait";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";

/** A renderer whose world is in when `worldIn` resolves, as the hike's renderer answers `Renderer.whenReady`. */
const readyWith = (worldIn: Promise<unknown>): { whenReady(maxMs: number): Promise<void> } => ({
  whenReady: (maxMs) => whenWorldIn(worldIn, maxMs),
});

/** A world that is in already, and one that comes in `ms` later, telling `then` as it does. */
const worldIn = (): Promise<void> => Promise.resolve();
const worldInAfter = (ms: number, then: () => void = () => undefined): Promise<void> => new Promise((resolve) => setTimeout(() => { then(); resolve(); }, ms));

describe("the start-time gate", () => {
  it("resolves when the renderer's world is in, then gates the bar", async () => {
    const p = createLoadProgress();
    let cameIn = false;
    let readyAtIn: boolean | null = null;
    await startReady({ renderer: readyWith(worldInAfter(200, () => { cameIn = true; readyAtIn = p.view().ready; })), progress: p, maxMs: 5000 });
    expect(p.view().ready).toBe(true);
    // Not before the world was in.
    expect(cameIn).toBe(true);
    expect(readyAtIn).toBe(false);
  }, timeLimit(10_000));

  it("waits on no frame to come whole: it is handed no reveal, and gates as the world comes in", async () => {
    const p = createLoadProgress();
    let lifted = false;
    const reveal = new Promise<void>((r) => setTimeout(() => { lifted = true; r(); }, 50));
    // @ts-expect-error the gate's input names no reveal: no engine a hike draws with leaves a draw out of a frame.
    const withReveal: Parameters<typeof startReady>[0] = { renderer: readyWith(worldIn()), reveal, progress: p, maxMs: 5000 };
    await startReady(withReveal);
    expect(p.view().ready).toBe(true);
    // What was slipped in was not waited for.
    expect(lifted).toBe(false);
  }, timeLimit(10_000));

  it("gates without a bar, and waits at most a minute for the world", async () => {
    await expect(startReady({ renderer: readyWith(worldIn()), progress: null, maxMs: 5000 })).resolves.toBeUndefined();
    expect(READY_MAX_MS).toBe(60_000);
  }, timeLimit(10_000));

  it("is not ready while a first build is still being stepped, and is when it ends", async () => {
    let built!: () => void;
    const firstBuilds = new Promise<void>((resolve) => { built = resolve; });
    let ready = false;
    void startReady({ renderer: readyWith(worldIn()), progress: null, maxMs: 60_000, firstBuilds: () => firstBuilds }).then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 250));
    expect(ready).toBe(false);
    built();
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(true);
  }, timeLimit(10_000));

  it("asks for the first builds only once the world is in: a fill queued when the models land is not missed", async () => {
    const order: string[] = [];
    await startReady({ renderer: readyWith(worldInAfter(200, () => order.push("scene"))), progress: null, maxMs: 5000, firstBuilds: () => { order.push("fills"); return Promise.resolve(); } });
    expect(order[0]).toBe("scene");
    expect(order.at(-1)).toBe("fills");
    expect(order.filter((x) => x === "fills")).toHaveLength(1);
  }, timeLimit(10_000));

  it("calls the world ready at maxMs though a first build never ends", async () => {
    const p = createLoadProgress();
    // The limit is the gate's own (300 ms here): the test's is ten seconds, and this would never resolve without one.
    await startReady({ renderer: readyWith(worldIn()), progress: p, maxMs: 300, firstBuilds: () => new Promise(() => undefined) });
    expect(p.view().ready).toBe(true);
  }, timeLimit(10_000));
});
