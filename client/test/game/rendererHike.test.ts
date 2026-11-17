import { afterEach, describe, it, expect, vi } from "vitest";

// As in `rendererCleanup.test.ts`: the ground's layer images cannot be fetched
// and decoded under Node, and a real WebGL engine needs a context this suite
// does not have, so both are stood in for at the module boundary.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>("@babylonjs/core/Engines/nullEngine.js");
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { createRenderer, sceneRendererOf, type Renderer, type SceneRenderer } from "../../src/game/renderer.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { EMPTY_LEVEL, windTestState } from "./helpers/rendererWorld.js";
import { skyFixture } from "./helpers/skyFixture.js";

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

/** The renderer on Babylon.js, held as the hike holds a renderer: by its own surface, its scene reached only through `sceneRendererOf`. */
function hikeRenderer(): Renderer {
  return createRenderer(nullCanvas(), EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
}

/** `renderer` with its scene: every renderer `createRenderer` makes has one. */
function withScene(renderer: Renderer): SceneRenderer {
  const own = sceneRendererOf(renderer);
  if (own === null) throw new Error("the renderer has no Babylon scene");
  return own;
}

describe("the renderer on Babylon.js as the hike holds a renderer", () => {
  let renderer: Renderer | null = null;
  afterEach(() => {
    renderer?.dispose();
    renderer = null;
    expect(EngineStore.Instances.length).toBe(0);
  });

  it("is the one renderer, with its scene behind it: the engine it names is the scene's, by a name the page reads", () => {
    renderer = hikeRenderer();
    const own = withScene(renderer);
    expect(own).toBe(renderer);
    expect(renderer.engine).toBe(own.scene.getEngine());
    // The engine made where none is given is WebGL2's.
    expect(renderer.engineName).toBe("webgl2");
  }, timeLimit(60_000));

  it("draws a frame of its scene when asked, and no other", () => {
    renderer = hikeRenderer();
    const { scene } = withScene(renderer);
    let drawn = 0;
    scene.onAfterRenderObservable.add(() => {
      drawn += 1;
    });
    renderer.setFreecam({ x: 0, y: 5, z: 0, yaw: 0, pitch: 0 });
    renderer.sync(windTestState(), -1, 0);
    expect(drawn).toBe(0);
    renderer.drawFrame();
    expect(drawn).toBe(1);
  }, timeLimit(60_000));

  it("runs and stops its loop on its engine: the function given, or every one when none is named", () => {
    renderer = hikeRenderer();
    const { engine } = withScene(renderer);
    const run = vi.spyOn(engine, "runRenderLoop").mockImplementation(() => undefined);
    const stop = vi.spyOn(engine, "stopRenderLoop");
    const frame = (): void => undefined;
    renderer.runLoop(frame);
    expect(run.mock.calls).toEqual([[frame]]);
    renderer.stopLoop(frame);
    renderer.stopLoop();
    expect(stop.mock.calls).toEqual([[frame], [undefined]]);
  }, timeLimit(60_000));

  it("tells the end of each frame and each shader compiled, until the function it gave back is called", () => {
    renderer = hikeRenderer();
    const { engine } = withScene(renderer);
    const heard: string[] = [];
    const stopFrames = renderer.onFrameEnd(() => void heard.push("frame"));
    const stopCompiles = renderer.onShaderCompiled(() => void heard.push("compile"));
    engine.onEndFrameObservable.notifyObservers(engine);
    engine.onAfterShaderCompilationObservable.notifyObservers(engine);
    expect(heard).toEqual(["frame", "compile"]);
    stopFrames();
    engine.onEndFrameObservable.notifyObservers(engine);
    engine.onAfterShaderCompilationObservable.notifyObservers(engine);
    expect(heard).toEqual(["frame", "compile", "compile"]);
    stopCompiles();
    engine.onAfterShaderCompilationObservable.notifyObservers(engine);
    expect(heard).toHaveLength(3);
  }, timeLimit(60_000));

  it("holds its engine's shaders that compiled cleanly, each once, and leaves their compile's hooks until it retires", () => {
    renderer = hikeRenderer();
    const cache = (withScene(renderer).engine as unknown as { _compiledEffects: Record<string, Effect> })._compiledEffects;
    const hook = (): string => "";
    const clean = { isReady: () => true, getCompilationError: () => "", _refCount: 1, _processCodeAfterIncludes: hook };
    const compiling = { isReady: () => false, getCompilationError: () => "", _refCount: 1 };
    cache["test.clean"] = clean as unknown as Effect;
    cache["test.compiling"] = compiling as unknown as Effect;
    try {
      withScene(renderer).keepShaders();
      withScene(renderer).keepShaders();
      expect(clean._refCount).toBe(2);
      expect(clean._processCodeAfterIncludes).toBe(hook);
      expect(compiling._refCount).toBe(1);
    } finally {
      delete cache["test.clean"];
      delete cache["test.compiling"];
    }
  }, timeLimit(60_000));

  it("says where its camera stands, as a point of the caller's own", () => {
    renderer = hikeRenderer();
    // Where the camera is made, before any frame has placed it.
    expect(renderer.cameraPosition()).toEqual({ x: 0, y: 2, z: 0 });
    renderer.setFreecam({ x: 12, y: 30, z: -7, yaw: 0.2, pitch: 0.1 });
    renderer.sync(windTestState(), -1, 0);
    const at = renderer.cameraPosition();
    expect(at).toEqual({ x: 12, y: 30, z: -7 });
    at.x = 99;
    expect(renderer.cameraPosition().x).toBe(12);
    expect(withScene(renderer).camera.position.x).toBe(12);
  }, timeLimit(60_000));

  it("counts its scene's loads in flight, and calls its world in at the bound it is given at the latest", async () => {
    renderer = hikeRenderer();
    const { scene } = withScene(renderer);
    const before = renderer.waitingItems();
    expect(before).toBe(scene.getWaitingItemsCount());
    scene.addPendingData("a model on its way");
    expect(renderer.waitingItems()).toBe(before + 1);
    // With a load in flight the world is not in: only the bound ends the wait.
    await expect(renderer.whenReady(50)).resolves.toBeUndefined();
    // The renderer's own models have settled meanwhile, or not: the one added here is still counted, until it lands.
    const waiting = renderer.waitingItems();
    expect(waiting).toBeGreaterThanOrEqual(1);
    scene.removePendingData("a model on its way");
    expect(renderer.waitingItems()).toBe(waiting - 1);
  }, timeLimit(60_000));
});
