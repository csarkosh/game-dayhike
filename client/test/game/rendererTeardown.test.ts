import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// `createRenderer` builds a WebGL `Engine`; NullEngine in its place.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

/**
 * Every model load the renderer starts goes through here. By URL, Babylon's
 * loader cannot fetch under Node, so each call reads the shipped file from disk
 * and hands its bytes to the real loader, against the scene it was given, once
 * `gate` opens. Held shut, the loads are in flight when the renderer goes; the
 * real loader then meets a disposed scene and rejects exactly as it does in the
 * browser ("Scene has been disposed"). `failing` makes one URL fail at once,
 * for a reason that has nothing to do with the scene.
 *
 * `guarded` records every load a shell hands to `loadUntilAborted`: the signal
 * it was given and how the load it returned settled. A call to the loader that
 * did not come through it is marked `unguarded`. `mistThrows` makes the mist
 * shell's constructor throw, part-way through a build, after every shell that
 * loads models except the character pool already exists.
 */
const loads = vi.hoisted(() => {
  const state = {
    calls: [] as { url: string; afterDispose: boolean; unguarded: boolean }[],
    guarded: [] as { signal: AbortSignal; outcome: "pending" | "resolved" | "aborted" | "failed" }[],
    inGuard: 0,
    pending: 0,
    disposed: false,
    failing: null as string | null,
    mistThrows: false,
    open: (): void => undefined,
    opened: Promise.resolve(),
    reset(): void {
      state.calls.length = 0;
      state.guarded.length = 0;
      state.inGuard = 0;
      state.pending = 0;
      state.disposed = false;
      state.failing = null;
      state.mistThrows = false;
      state.opened = new Promise<void>((resolve) => {
        state.open = resolve;
      });
    },
  };
  return state;
});
vi.mock("@babylonjs/core/Loading/sceneLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader.js")>();
  return {
    ...actual,
    loadAssetContainerAsync: async (url: unknown, scene: import("@babylonjs/core/scene.js").Scene) => {
      const name = String(url).split("/").pop()!.split("?")[0]!;
      loads.calls.push({ url: name, afterDispose: loads.disposed, unguarded: loads.inGuard === 0 });
      if (name === loads.failing) throw new Error("HTTP 404");
      loads.pending++;
      try {
        await loads.opened;
        const bytes = readFileSync(new URL(`../../assets/models/${name}`, import.meta.url));
        return await actual.loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
      } finally {
        loads.pending--;
      }
    },
  };
});
vi.mock("../../src/game/modelLoad.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/modelLoad.js")>();
  return {
    ...actual,
    loadUntilAborted: (start: () => Promise<import("@babylonjs/core/assetContainer.js").AssetContainer>, signal: AbortSignal) => {
      const record = { signal, outcome: "pending" as "pending" | "resolved" | "aborted" | "failed" };
      loads.guarded.push(record);
      // `start` is called synchronously inside, and calls the loader
      // synchronously, which is how a loader call is known to be guarded.
      const load = actual.loadUntilAborted(() => {
        loads.inGuard++;
        try {
          return start();
        } finally {
          loads.inGuard--;
        }
      }, signal);
      load.then(
        () => { record.outcome = "resolved"; },
        (error: unknown) => { record.outcome = error === signal.reason ? "aborted" : "failed"; },
      );
      return load;
    },
  };
});
vi.mock("../../src/game/mistMeshes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/mistMeshes.js")>();
  return {
    ...actual,
    createMistMeshes: (...args: Parameters<typeof actual.createMistMeshes>) => {
      if (loads.mistThrows) throw new Error("no mist");
      return actual.createMistMeshes(...args);
    },
  };
});

import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { createForest } from "../../src/sim/forest.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { Level } from "../../src/sim/level.js";

const LEVEL: Level = { id: "renderer-teardown", brushes: [], playerSpawns: [], enemySpawns: [] };
const SEED = 12345;
const nullCanvas = (): HTMLCanvasElement =>
  ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

/** Waits until no load is in flight and none has started for a while. */
async function settled(): Promise<void> {
  let quiet = 0;
  let seen = -1;
  while (quiet < 10) {
    await new Promise((r) => setTimeout(r, 50));
    if (loads.pending === 0 && loads.calls.length === seen) quiet++;
    else quiet = 0;
    seen = loads.calls.length;
  }
}

/** What reaches the console and the unhandled-rejection hook while `run` runs. */
async function heard(run: () => Promise<void>): Promise<{ errors: string[]; unhandled: unknown[] }> {
  const errors: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
  } finally {
    process.off("unhandledRejection", onUnhandled);
    spy.mockRestore();
  }
  return { errors, unhandled };
}

/** The distinct signals the guarded loads were handed, in first-use order. */
function signalsOf(guarded: typeof loads.guarded): AbortSignal[] {
  return [...new Set(guarded.map((g) => g.signal))];
}

describe("a renderer disposed while its models load", () => {
  it("ends every load quietly, starts none afterwards and adopts nothing", async () => {
    loads.reset();
    const forest = createForest(SEED);
    let meshesAfter = -1;
    const { errors, unhandled } = await heard(async () => {
      const r = createRenderer(nullCanvas(), LEVEL, forest, { tier: "high" });
      await new Promise((res) => setTimeout(res, 50));
      loads.disposed = true;
      r.dispose();
      loads.open();
      await settled();
      meshesAfter = r.scene.meshes.length;
    });
    expect(errors).toEqual([]);
    expect(unhandled.length).toBe(0);
    expect(loads.calls.filter((c) => c.afterDispose).map((c) => c.url)).toEqual([]);
    expect(meshesAfter).toBe(0);
  }, 120_000);

  it("still reports a load that fails for any other reason", async () => {
    loads.reset();
    loads.failing = "cliff.wall_a.glb";
    loads.open();
    const forest = createForest(SEED);
    const { errors, unhandled } = await heard(async () => {
      const r = createRenderer(nullCanvas(), LEVEL, forest, { tier: "high" });
      await settled();
      r.dispose();
    });
    expect(errors).toEqual(["cliff modules: keeping whatever loaded — Error: HTTP 404"]);
    expect(unhandled.length).toBe(0);
  }, 120_000);
});

describe("a renderer whose build throws after its loading shells exist", () => {
  it("ends their loads, starts none afterwards and logs nothing, the build's own throw aside", async () => {
    loads.reset();
    loads.mistThrows = true;
    const forest = createForest(SEED);
    const { errors, unhandled } = await heard(async () => {
      expect(() => createRenderer(nullCanvas(), LEVEL, forest, { tier: "high" })).toThrow("no mist");
      loads.disposed = true;
      loads.open();
      await settled();
    });
    expect(EngineStore.Instances.length).toBe(0);
    expect(errors).toEqual([]);
    expect(unhandled.length).toBe(0);
    expect(loads.calls.filter((c) => c.afterDispose).map((c) => c.url)).toEqual([]);
    // The forest, the clutter, the cliff modules, the birds and the creature
    // pool existed when the mist threw; the character pool comes later.
    const signals = signalsOf(loads.guarded);
    expect(signals.length).toBe(5);
    expect(signals.filter((s) => !s.aborted).length).toBe(0);
  }, 120_000);
});
