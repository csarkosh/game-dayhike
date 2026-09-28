import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// As in `rendererCleanup.test.ts`: the ground's texture arrays NullEngine
// cannot create, and `createRenderer`'s WebGL `Engine`, stand-ins at the
// module boundary.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { RenderingGroupInfo, type RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
import type { AsyncPipelines } from "../../src/game/asyncPipelines.js";
import { IMPOSTOR_BAKE_FAIL_MS, defaultBakeImpostor } from "../../src/game/forestMeshes.js";
import { createRenderer, scopeRenderingGroups } from "../../src/game/renderer.js";
import type { Level } from "../../src/sim/level.js";

const require = createRequire(import.meta.url);

const engines: NullEngine[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) e.dispose();
});

function sceneOnNullEngine(): Scene {
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}

/** What a rendering manager tells the group observables. */
function groupOf(scene: Scene, manager: RenderingManager): RenderingGroupInfo {
  return Object.assign(new RenderingGroupInfo(), { scene, camera: null, renderingGroupId: 0, renderingManager: manager });
}

/** Records the scope's enter and leave. */
function scopeLog(): { calls: string[]; pipelines: Pick<AsyncPipelines, "enter" | "leave"> } {
  const calls: string[] = [];
  return { calls, pipelines: { enter: () => void calls.push("enter"), leave: () => void calls.push("leave") } };
}

describe("where draws may be left out: the rendering groups", () => {
  it("brackets each rendering group of the camera's pass and of a target drawn every frame, and nothing once off", () => {
    const scene = sceneOnNullEngine();
    const { calls, pipelines } = scopeLog();
    const off = scopeRenderingGroups(scene, pipelines);
    const main = groupOf(scene, scene.renderingManager);
    scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    scene.onAfterRenderingGroupObservable.notifyObservers(main);
    // A shadow map's kind: a target the scene draws every frame.
    const count = scene.objectRenderers.length;
    const everyFrame = new RenderTargetTexture("every frame", 4, scene);
    expect(scene.objectRenderers.length).toBe(count + 1);
    const everyFrameGroup = groupOf(scene, scene.objectRenderers[count]!.renderingManager);
    scene.onBeforeRenderingGroupObservable.notifyObservers(everyFrameGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(everyFrameGroup);
    expect(calls).toEqual(["enter", "leave", "enter", "leave"]);
    off();
    scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    scene.onAfterRenderingGroupObservable.notifyObservers(main);
    expect(calls.length).toBe(4);
    everyFrame.dispose();
  });

  it("leaves a target drawn once, a render that is kept, on Babylon's synchronous path", () => {
    const scene = sceneOnNullEngine();
    const { calls, pipelines } = scopeLog();
    scopeRenderingGroups(scene, pipelines);
    const count = scene.objectRenderers.length;
    // The reflection probe's kind.
    const once = new RenderTargetTexture("once", 4, scene);
    once.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    const owner = scene.objectRenderers[count]!;
    expect(owner.refreshRate).toBe(0);
    const onceGroup = groupOf(scene, owner.renderingManager);
    const main = groupOf(scene, scene.renderingManager);
    // Drawn on its own, and inside the camera's pass: its groups never enter,
    // and the camera's leave still matches the camera's enter.
    scene.onBeforeRenderingGroupObservable.notifyObservers(onceGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(onceGroup);
    expect(calls).toEqual([]);
    scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    scene.onBeforeRenderingGroupObservable.notifyObservers(onceGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(onceGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(main);
    expect(calls).toEqual(["enter", "leave"]);
    // Drawn every frame again, it is in the scope again.
    once.refreshRate = 1;
    scene.onBeforeRenderingGroupObservable.notifyObservers(onceGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(onceGroup);
    expect(calls).toEqual(["enter", "leave", "enter", "leave"]);
    once.dispose();
  });

  it("is told by Babylon's rendering manager which manager draws, around each group's draws (a canary on the installed engine)", () => {
    const src = readFileSync(require.resolve("@babylonjs/core/Rendering/renderingManager.js"), "utf8");
    const render = src.slice(src.indexOf("    render(customRenderFunction, activeMeshes,"), src.indexOf("    reset() {"));
    expect(render).toContain("info.renderingManager = this;");
    const before = render.indexOf("this._scene.onBeforeRenderingGroupObservable.notifyObservers(info, renderingGroupMask);");
    const draws = render.indexOf("renderingGroup.render(customRenderFunction,");
    const after = render.indexOf("this._scene.onAfterRenderingGroupObservable.notifyObservers(info, renderingGroupMask);");
    expect(before).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(draws);
    // A render-once target keeps its rate at 0 while it draws; a mesh not
    // ready in it re-arms it, as the scope's rule mirrors.
    const objectRenderer = readFileSync(require.resolve("@babylonjs/core/Rendering/objectRenderer.js"), "utf8");
    expect(objectRenderer).toContain("        this._scene.addObjectRenderer(this);");
    expect(objectRenderer).toContain("    get renderingManager() {\n        return this._renderingManager;");
    expect(objectRenderer).toContain("else if (!mesh.isReady(this.refreshRate === 0)) {\n                        this.resetRefreshCounter();");
  });
});

describe("the renderer on a WebGPU engine with pipelines made asynchronously", () => {
  const LEVEL: Level = { id: "pipeline-scope", brushes: [], playerSpawns: [], enemySpawns: [] };
  const CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  /** Pipelines that record what the renderer does with them. */
  function recorded(order: string[]): AsyncPipelines {
    return {
      enter: () => void order.push("enter"),
      leave: () => void order.push("leave"),
      pending: () => 0,
      takeSkipped: () => 0,
      settled: () => Promise.resolve(true),
      remove: () => void order.push("remove"),
    };
  }

  it("scopes its scene's rendering groups, and takes the scope and the patch off before its engine goes", () => {
    const order: string[] = [];
    const bare = createRenderer(CANVAS, LEVEL, null, { tier: "medium" });
    const without = bare.scene.onBeforeRenderingGroupObservable.observers.length;
    bare.dispose();
    const r = createRenderer(CANVAS, LEVEL, null, { tier: "medium", pipelines: recorded(order) });
    expect(r.scene.onBeforeRenderingGroupObservable.observers.length).toBe(without + 1);
    const main = groupOf(r.scene, r.scene.renderingManager);
    r.scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    r.scene.onAfterRenderingGroupObservable.notifyObservers(main);
    const observed = r.scene.onBeforeRenderingGroupObservable;
    let scopedAtEngineDispose = -1;
    const dispose = r.engine.dispose.bind(r.engine);
    vi.spyOn(r.engine, "dispose").mockImplementation(() => {
      order.push("engine disposed");
      scopedAtEngineDispose = observed.observers.length;
      dispose();
    });
    r.dispose();
    expect(order).toEqual(["enter", "leave", "remove", "engine disposed"]);
    expect(scopedAtEngineDispose).toBe(without);
  });
});

describe("the impostor bake with pipelines made asynchronously", () => {
  function bakeScene() {
    const scene = sceneOnNullEngine();
    const mesh = MeshBuilder.CreateBox("s0_lod1", { size: 2 }, scene);
    return { scene, mesh };
  }

  /**
   * Bakes with pipelines whose renders leave out, in turn, the counts in
   * `plan` (0 once it runs out), and whose wait answers `emptied`. Each
   * render is recorded with what it left out and the target's rate as it
   * drew, the rate 0 of a render-once target being Babylon's synchronous
   * path (the scope above).
   */
  async function bake(plan: number[], emptied: boolean, signal?: AbortSignal) {
    const { scene, mesh } = bakeScene();
    let skipped = 0;
    const waits: number[] = [];
    const pipelines = {
      takeSkipped: () => {
        const n = skipped;
        skipped = 0;
        return n;
      },
      settled: (ms: number) => {
        waits.push(ms);
        return Promise.resolve(emptied);
      },
    };
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const renders: { leftOut: number; rate: number }[] = [];
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (this: RenderTargetTexture) {
      const leftOut = plan.shift() ?? 0;
      renders.push({ leftOut, rate: this.refreshRate });
      skipped += leftOut;
    });
    const texture = await defaultBakeImpostor(mesh, scene, { pipelines, failMs: 5_000, signal });
    return { texture, renders, waits, scene };
  }

  it("keeps a first render that left nothing out, and waits for nothing", async () => {
    const { texture, renders, waits } = await bake([0], true);
    expect(texture).not.toBeNull();
    expect(renders).toEqual([{ leftOut: 0, rate: 1 }]);
    expect(waits).toEqual([]);
  });

  it("asks with a first render, waits within its bound, and keeps the second when it left nothing out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const baking = bake([3, 0], true);
    await vi.advanceTimersByTimeAsync(0);
    const { texture, renders, waits } = await baking;
    expect(texture).not.toBeNull();
    expect(renders).toEqual([{ leftOut: 3, rate: 1 }, { leftOut: 0, rate: 1 }]);
    expect(waits).toEqual([5_000]);
  });

  it("renders once more on Babylon's synchronous path when the second render still left something out", async () => {
    const { texture, renders } = await bake([3, 2, 0], true);
    expect(texture).not.toBeNull();
    expect(renders).toEqual([{ leftOut: 3, rate: 1 }, { leftOut: 2, rate: 1 }, { leftOut: 0, rate: 0 }]);
  });

  it("renders on Babylon's synchronous path when the wait runs out", async () => {
    const { texture, renders, waits } = await bake([3, 0], false);
    expect(texture).not.toBeNull();
    expect(renders).toEqual([{ leftOut: 3, rate: 1 }, { leftOut: 0, rate: 0 }]);
    expect(waits.length).toBe(1);
  });

  it("keeps no render in which a draw was left out, whatever the pipelines do: it fails, and says so", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { texture, renders, scene } = await bake([3, 2, 1], true);
    expect(texture).toBeNull();
    expect(renders).toEqual([{ leftOut: 3, rate: 1 }, { leftOut: 2, rate: 1 }, { leftOut: 1, rate: 0 }]);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["forest impostor bake left a draw out: s0_lod1"]);
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
    // Across every plan: a bake that kept a render kept one that left nothing out.
    for (const [plan, emptied] of [[[0], true], [[1, 0], true], [[1, 1, 0], true], [[1, 0], false], [[1, 1], false], [[2, 2, 2], true]] as const) {
      const run = await bake([...plan], emptied);
      expect(run.texture === null || run.renders[run.renders.length - 1]!.leftOut === 0, JSON.stringify(plan)).toBe(true);
    }
  });

  it("stops without a word when the forest goes while it waits", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(true);
    const render = vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    let skipped = 1;
    const pipelines = {
      takeSkipped: () => {
        const n = skipped;
        skipped = 0;
        return n;
      },
      settled: () => {
        abort.abort();
        return Promise.resolve(true);
      },
    };
    // The first take clears what came before the bake; the render then leaves one out.
    render.mockImplementationOnce(() => void (skipped = 1));
    expect(await defaultBakeImpostor(mesh, scene, { pipelines, signal: abort.signal })).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("waits within the bake's own bound, which stays two minutes", () => {
    expect(IMPOSTOR_BAKE_FAIL_MS).toBe(120_000);
  });
});
