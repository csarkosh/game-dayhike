import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// A NullEngine with half-float render targets, as a browser has: every
// scene's BRDF lookup texture is then expanded asynchronously
// (`brdfTeardown.test.ts` says how).
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

// The motes, built late, after the scene's PBR materials, throw when told to:
// a build that fails part-way on the engine it was given.
const late = vi.hoisted(() => ({ fail: false }));
vi.mock("../../src/game/motes.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/game/motes.js")>("../../src/game/motes.js");
  return {
    ...actual,
    createMotes: (...args: Parameters<typeof actual.createMotes>) => {
      if (late.fail) throw new Error("no motes");
      return actual.createMotes(...args);
    },
  };
});

import "../../src/sim/passes/index.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { RGBDTextureTools } from "@babylonjs/core/Misc/rgbdTextureTools.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { createRenderer, type Renderer } from "../../src/game/renderer.js";
import { swapRenderer, type SwapBindings } from "../../src/game/rendererSwap.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";

const LEVEL: Level = {
  id: "swap-release",
  brushes: [{ box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, material: "concrete" }],
  playerSpawns: [],
  enemySpawns: [],
} as unknown as Level;
const canvas = (): HTMLCanvasElement =>
  ({ renderWidth: 1600, renderHeight: 900, style: {}, replaceWith() {} }) as unknown as HTMLCanvasElement;

describe("a swap whose rung on a given engine fails part-way through the real build", () => {
  it("releases that engine once, after its BRDF texture has expanded, with no unhandled rejection", async () => {
    // Babylon's expansion with the browser's timing: a few turns of the event
    // loop, then a render through the texture's scene, which throws on a
    // disposed one (`brdfTeardown.test.ts`).
    vi.spyOn(RGBDTextureTools, "ExpandRGBDTexture").mockImplementation((texture) => {
      const internal = texture.getInternalTexture();
      if (internal === null) return;
      internal.isReady = false;
      setTimeout(() => {
        void Promise.resolve().then(() => {
          void texture.getScene()!.postProcessManager;
          internal.isReady = true;
        });
      }, 0);
    });
    const seen: string[] = [];
    const onUnhandled = (reason: unknown): void => void seen.push(String(reason));
    process.on("unhandledRejection", onUnhandled);
    const given = new Engine(canvas(), true, {}, true) as unknown as AbstractEngine;
    const readyAtDispose: boolean[] = [];
    const dispose = given.dispose.bind(given);
    let brdfReady = (): boolean => true;
    vi.spyOn(given, "dispose").mockImplementation(() => {
      readyAtDispose.push(brdfReady());
      dispose();
    });
    let running: Renderer | null = null;
    try {
      const old = createRenderer(canvas(), LEVEL, null, { tier: "low" });
      const bindings: SwapBindings = {
        build: (next, tier, engine) => {
          late.fail = engine !== null;
          try {
            const r = createRenderer(next, LEVEL, null, { tier, engine: engine ?? undefined });
            return r;
          } finally {
            if (engine !== null) {
              const scene = engine.scenes[0];
              brdfReady = () => scene?.environmentBRDFTexture?.getInternalTexture()?.isReady !== false;
            }
            late.fail = false;
          }
        },
        freshCanvas: canvas,
        extras: { dispose: () => undefined, build: () => undefined },
        rebind: () => undefined,
        restore: () => undefined,
        loop: () => undefined,
        unwatch: () => undefined,
        watch: () => undefined,
        engineFailed: () => undefined,
      };
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const got = swapRenderer({ renderer: old, canvas: canvas() }, { tier: "medium", engine: given, fallbackTier: "low" }, bindings);
        running = got.renderer;
        expect([got.tier, got.engineFellBack]).toEqual(["medium", true]);
      } finally {
        quiet.mockRestore();
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(seen).toEqual([]);
      expect(readyAtDispose).toEqual([true]);
    } finally {
      running?.dispose();
      process.off("unhandledRejection", onUnhandled);
      vi.restoreAllMocks();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(120_000));
});
