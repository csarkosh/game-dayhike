import { describe, it, expect } from "vitest";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { loadUntilAborted } from "../../src/game/modelLoad.js";

/** A container stand-in that counts its disposals. */
function container(): AssetContainer & { disposals: number } {
  const c = { disposals: 0, dispose() { c.disposals++; } };
  return c as unknown as AssetContainer & { disposals: number };
}

/** A load the test settles by hand. */
function manual() {
  let resolve!: (c: AssetContainer) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<AssetContainer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Rejections nothing handled, over a few turns of the event loop. */
async function unhandledDuring(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { seen.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

describe("loadUntilAborted", () => {
  it("hands back the container and the failure of a load never aborted", async () => {
    const loads = new AbortController();
    const c = container();
    await expect(loadUntilAborted(() => Promise.resolve(c), loads.signal)).resolves.toBe(c);
    const missing = new Error("HTTP 404");
    await expect(loadUntilAborted(() => Promise.reject(missing), loads.signal)).rejects.toBe(missing);
    expect(c.disposals).toBe(0);
  });

  it("starts nothing once aborted", async () => {
    const loads = new AbortController();
    loads.abort();
    let started = 0;
    const load = loadUntilAborted(() => {
      started++;
      return Promise.resolve(container());
    }, loads.signal);
    await expect(load).rejects.toBe(loads.signal.reason);
    expect(started).toBe(0);
  });

  it("ends at the abort, and disposes a container that lands after it", async () => {
    const loads = new AbortController();
    const late = manual();
    const load = loadUntilAborted(() => late.promise, loads.signal);
    loads.abort();
    await expect(load).rejects.toBe(loads.signal.reason);
    const c = container();
    late.resolve(c);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.disposals).toBe(1);
  });

  it("leaves no unhandled rejection when the load fails after the abort", async () => {
    const seen = await unhandledDuring(async () => {
      const loads = new AbortController();
      const late = manual();
      const load = loadUntilAborted(() => late.promise, loads.signal);
      loads.abort();
      await load.catch(() => undefined);
      late.reject(new Error("Unable to load from cliff.wall_a.glb: Scene has been disposed"));
    });
    expect(seen.length).toBe(0);
  });

  it("leaves no unhandled rejection when a container that lands after the abort throws on dispose", async () => {
    let disposals = 0;
    const seen = await unhandledDuring(async () => {
      const loads = new AbortController();
      const late = manual();
      const load = loadUntilAborted(() => late.promise, loads.signal);
      loads.abort();
      await load.catch(() => undefined);
      const broken = {
        dispose() {
          disposals++;
          throw new Error("the context is gone");
        },
      } as unknown as AssetContainer;
      late.resolve(broken);
    });
    expect(disposals).toBe(1);
    expect(seen.length).toBe(0);
  });

  it("leaves a settled load alone when the abort comes after it", async () => {
    const loads = new AbortController();
    const c = container();
    const got = await loadUntilAborted(() => Promise.resolve(c), loads.signal);
    loads.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toBe(c);
    expect(c.disposals).toBe(0);
  });
});
