import { describe, expect, it } from "vitest";
import { createEngineWatch } from "../../src/game/engineWatch.js";
import type { EngineHandle } from "../../src/game/engineHandle.js";

const handle: EngineHandle = { isDisposed: false, dispose: () => undefined };
/** One turn of the microtask queue. */
const turn = (): Promise<void> => Promise.resolve();

describe("a renderer's own watch on its engine", () => {
  it("tells who listens of a lost device, once", () => {
    const watch = createEngineWatch();
    const heard: string[] = [];
    watch.watch(handle, (reason) => heard.push(reason));
    expect(watch.failed("lost")).toBe(false);
    watch.fail("lost");
    watch.fail("lost");
    expect(heard).toEqual(["lost"]);
    expect(watch.failed("lost")).toBe(true);
    expect(watch.failed("pipeline")).toBe(false);
  });

  it("tells each reason once, as the page's own watch on an engine does", () => {
    const watch = createEngineWatch();
    const heard: string[] = [];
    watch.watch(handle, (reason) => heard.push(reason));
    watch.fail("pipeline");
    watch.fail("lost");
    watch.fail("pipeline");
    expect(heard).toEqual(["pipeline", "lost"]);
  });

  it("stops telling a listener that was taken off", () => {
    const watch = createEngineWatch();
    const heard: string[] = [];
    const off = watch.watch(handle, (reason) => heard.push(reason));
    off();
    watch.fail("lost");
    expect(heard).toEqual([]);
  });

  it("tells a failure that came before anyone listened to the first who does, a turn later", async () => {
    const watch = createEngineWatch();
    watch.fail("lost");
    const first: string[] = [];
    const second: string[] = [];
    watch.watch(handle, (reason) => first.push(reason));
    watch.watch(handle, (reason) => second.push(reason));
    // Not within the call that puts the listener on: whoever calls is still holding what it returns.
    expect(first).toEqual([]);
    await turn();
    expect(first).toEqual(["lost"]);
    expect(second).toEqual([]);
  });

  it("does not tell a late listener that was taken off within the turn", async () => {
    const watch = createEngineWatch();
    watch.fail("lost");
    const heard: string[] = [];
    watch.watch(handle, (reason) => heard.push(reason))();
    await turn();
    expect(heard).toEqual([]);
  });

  it("tells no one once it is closed: a renderer let go destroys its own device", async () => {
    const watch = createEngineWatch();
    const heard: string[] = [];
    watch.watch(handle, (reason) => heard.push(reason));
    watch.close();
    watch.fail("lost");
    watch.watch(handle, (reason) => heard.push(reason));
    await turn();
    expect(heard).toEqual([]);
    expect(watch.failed("lost")).toBe(false);
  });
});
