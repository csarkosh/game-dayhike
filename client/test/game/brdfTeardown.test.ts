import { describe, it, expect, vi } from "vitest";

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

// A NullEngine that reports what a WebGL2 browser does: half-float render
// targets with linear filtering. With them, Babylon expands every scene's BRDF
// lookup texture from RGBD through a post-process, asynchronously
// (`RGBDTextureTools.ExpandRGBDTexture`), exactly as it does in the browser; a
// bare NullEngine reports neither, and skips the expansion.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  class FloatTargetEngine extends mod.NullEngine {
    constructor() {
      super();
      const caps = this.getCaps();
      caps.textureHalfFloatRender = true;
      caps.textureHalfFloatLinearFiltering = true;
    }
  }
  return { Engine: FloatTargetEngine };
});

import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { RGBDTextureTools } from "@babylonjs/core/Misc/rgbdTextureTools.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";

// One brush, so the scene has a PBR material and with it a BRDF texture.
const LEVEL: Level = {
  id: "brdf-teardown",
  brushes: [{ box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, material: "concrete" }],
  playerSpawns: [],
  enemySpawns: [],
} as unknown as Level;
const nullCanvas = (): HTMLCanvasElement =>
  ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

const expanding = (t: BaseTexture | null): boolean => t !== null && t.getInternalTexture()?.isReady === false;

async function unhandledDuring(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onUnhandled = (reason: unknown): void => { seen.push(String(reason)); };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

/**
 * A stand-in for Babylon's expansion with the browser's timing: after the image
 * has "loaded" it needs `turns` more turns of the event loop (the shader import,
 * the compile) before it does what Babylon's does last, render through
 * `texture.getScene().postProcessManager`, inside a promise, and mark the
 * texture ready. On a disposed scene that line throws, as Babylon's does.
 * `turns` Infinity is an expansion that never ends.
 */
function expansionTaking(turns: number) {
  return vi.spyOn(RGBDTextureTools, "ExpandRGBDTexture").mockImplementation((texture) => {
    const internal = texture.getInternalTexture();
    if (internal === null) return;
    internal.isReady = false;
    if (turns === Infinity) return;
    const step = (left: number): void => {
      setTimeout(() => {
        if (left > 0) {
          step(left - 1);
          return;
        }
        void Promise.resolve().then(() => {
          void texture.getScene()!.postProcessManager;
          internal.isReady = true;
        });
      }, 0);
    };
    step(turns);
  });
}

/** Holds the thread, the way the next renderer's build does during a swap. */
function block(ms: number): void {
  const until = performance.now() + ms;
  let spins = 0;
  while (performance.now() < until) spins++;
  if (spins < 0) throw new Error("unreachable");
}

/** Whether the BRDF texture had finished expanding each time `engine.dispose` ran. */
function watchRelease(r: ReturnType<typeof createRenderer>) {
  const brdf = r.scene.environmentBRDFTexture;
  const readyAtDispose: boolean[] = [];
  const dispose = r.engine.dispose.bind(r.engine);
  vi.spyOn(r.engine, "dispose").mockImplementation(() => {
    readyAtDispose.push(brdf?.getInternalTexture()?.isReady === true);
    dispose();
  });
  return readyAtDispose;
}

describe("a renderer disposed while its scene's BRDF texture is still being expanded", () => {
  it("lets Babylon's own expansion finish before its scene goes: no unhandled rejection, then the engine released", async () => {
    let readyAtDispose: boolean[] = [];
    const seen = await unhandledDuring(async () => {
      const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
      expect(expanding(r.scene.environmentBRDFTexture)).toBe(true);
      readyAtDispose = watchRelease(r);
      r.dispose();
      await new Promise((res) => setTimeout(res, 300));
    });
    expect(seen).toEqual([]);
    expect(EngineStore.Instances.length).toBe(0);
    // Released once, and only after the texture had finished expanding.
    expect(readyAtDispose).toEqual([true]);
  });

  it("keeps waiting through a long synchronous block after the dispose, which spends none of its bound", async () => {
    const expand = expansionTaking(2);
    let readyAtDispose: boolean[] = [];
    try {
      const seen = await unhandledDuring(async () => {
        const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
        readyAtDispose = watchRelease(r);
        r.dispose();
        // The next renderer's build, on a slow machine, before any poll can run.
        block(2100);
        await new Promise((res) => setTimeout(res, 500));
      });
      expect(seen).toEqual([]);
      expect(EngineStore.Instances.length).toBe(0);
      expect(readyAtDispose).toEqual([true]);
    } finally {
      expand.mockRestore();
    }
  }, timeLimit(10_000));

  it("releases the engine at the bound when the expansion never finishes", async () => {
    const expand = expansionTaking(Infinity);
    try {
      const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
      expect(expanding(r.scene.environmentBRDFTexture)).toBe(true);
      r.dispose();
      await new Promise((res) => setTimeout(res, 1000));
      expect(EngineStore.Instances.length).toBe(1);
      expect(r.scene.isDisposed).toBe(false);
      for (let waited = 0; EngineStore.Instances.length > 0 && waited < 6000; waited += 50) {
        await new Promise((res) => setTimeout(res, 50));
      }
      expect(EngineStore.Instances.length).toBe(0);
      expect(r.scene.isDisposed).toBe(true);
    } finally {
      expand.mockRestore();
    }
  }, timeLimit(10_000));

  it("does not dispose an engine a second time when something else disposed it during the wait", async () => {
    const expand = expansionTaking(Infinity);
    try {
      const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium" });
      let disposals = 0;
      const dispose = r.engine.dispose.bind(r.engine);
      vi.spyOn(r.engine, "dispose").mockImplementation(() => {
        disposals++;
        dispose();
      });
      r.dispose();
      r.engine.dispose();
      for (let waited = 0; waited < 3000; waited += 100) await new Promise((res) => setTimeout(res, 100));
      expect(disposals).toBe(1);
    } finally {
      expand.mockRestore();
    }
  }, timeLimit(10_000));
});
