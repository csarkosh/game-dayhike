import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// As in `rendererCleanup.test.ts`: the ground's texture arrays, whose real
// loader fetches and decodes the layer images, and `createRenderer`'s WebGL
// `Engine`, stand-ins at the module boundary.
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
import { defaultBakeImpostor } from "../../src/game/forestMeshes.js";
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
/** The target a render target just made added to `scene`, found by identity. */
function addedBy(scene: Scene, make: () => RenderTargetTexture): { target: RenderTargetTexture; manager: RenderingManager } {
  const before = [...scene.objectRenderers];
  const target = make();
  const added = scene.objectRenderers.filter((r) => !before.includes(r));
  expect(added.length).toBe(1);
  return { target, manager: added[0]!.renderingManager };
}

function scopeLog(): { calls: string[]; pipelines: Pick<AsyncPipelines, "enter" | "leave" | "guard"> } {
  const calls: string[] = [];
  const guard = (render: () => void): boolean => {
    render();
    return true;
  };
  return { calls, pipelines: { enter: () => void calls.push("enter"), leave: () => void calls.push("leave"), guard } };
}

describe("where draws may be left out: the rendering groups", () => {
  it("brackets each rendering group of the camera's pass and of a target drawn every frame, and nothing once off", () => {
    const scene = sceneOnNullEngine();
    const { calls, pipelines } = scopeLog();
    const scope = scopeRenderingGroups(scene, pipelines);
    const main = groupOf(scene, scene.renderingManager);
    scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    scene.onAfterRenderingGroupObservable.notifyObservers(main);
    // A shadow map's kind: a target the scene draws every frame.
    const { target: everyFrame, manager } = addedBy(scene, () => new RenderTargetTexture("every frame", 4, scene));
    const everyFrameGroup = groupOf(scene, manager);
    scene.onBeforeRenderingGroupObservable.notifyObservers(everyFrameGroup);
    scene.onAfterRenderingGroupObservable.notifyObservers(everyFrameGroup);
    expect(calls).toEqual(["enter", "leave", "enter", "leave"]);
    scope.off();
    scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    scene.onAfterRenderingGroupObservable.notifyObservers(main);
    expect(calls.length).toBe(4);
    everyFrame.dispose();
  });

  it("leaves a target drawn once, a render that is kept, on Babylon's synchronous path", () => {
    const scene = sceneOnNullEngine();
    const { calls, pipelines } = scopeLog();
    scopeRenderingGroups(scene, pipelines);
    // The reflection probe's kind.
    const { target: once, manager } = addedBy(scene, () => new RenderTargetTexture("once", 4, scene));
    once.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    const onceGroup = groupOf(scene, manager);
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
      guard: (render) => {
        render();
        return true;
      },
      pending: () => 0,
      takeSkipped: () => 0,
      settled: () => Promise.resolve(true),
      remove: () => void order.push("remove"),
    };
  }

  it("scopes its scene's rendering groups, and takes the scope and the patch off before its engine goes", () => {
    const order: string[] = [];
    const r = createRenderer(CANVAS, LEVEL, null, { tier: "medium", pipelines: recorded(order) });
    const main = groupOf(r.scene, r.scene.renderingManager);
    r.scene.onBeforeRenderingGroupObservable.notifyObservers(main);
    r.scene.onAfterRenderingGroupObservable.notifyObservers(main);
    // As the engine goes, a group's draws no longer open the scope (Babylon
    // drops a removed observer from its list on the next turn, and calls it
    // no more at once).
    const dispose = r.engine.dispose.bind(r.engine);
    vi.spyOn(r.engine, "dispose").mockImplementation(() => {
      r.scene.onBeforeRenderingGroupObservable.notifyObservers(main);
      r.scene.onAfterRenderingGroupObservable.notifyObservers(main);
      order.push("engine disposed");
      dispose();
    });
    r.dispose();
    expect(order).toEqual(["enter", "leave", "remove", "engine disposed"]);
  });
});

describe("the impostor bake with pipelines made asynchronously", () => {
  /**
   * A bake whose target is ready as `gates` says, in turn (ready once they
   * run out), and whose renders leave out what `leftOut` gives for the render's
   * index and the target's rate as it draws (rate 0, a target drawn once, is
   * Babylon's synchronous path: the scope above). Every readiness check, take
   * of the count, guarded render and render is recorded in order; the tests
   * move the fake timers by hand, so when each render comes is read from how
   * many there are after each step.
   */
  function bake(opts: { gates?: boolean[]; leftOut(index: number, rate: number): number; failMs?: number; signal?: AbortSignal }) {
    const scene = sceneOnNullEngine();
    const mesh = MeshBuilder.CreateBox("s0_lod1", { size: 2 }, scene);
    const events: string[] = [];
    let skipped = 0;
    let rendered = 0;
    const pipelines = {
      takeSkipped: (): number => {
        events.push("take");
        const count = skipped;
        skipped = 0;
        return count;
      },
      guarded: (render: () => void): boolean => {
        events.push("guarded");
        render();
        return true;
      },
    };
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => {
      const ready = opts.gates?.shift() ?? true;
      events.push(ready ? "ready" : "not ready");
      return ready;
    });
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(function (this: RenderTargetTexture) {
      const leftOut = opts.leftOut(rendered++, this.refreshRate);
      events.push(`render, rate ${this.refreshRate}, left out ${leftOut}`);
      skipped += leftOut;
    });
    const texture = defaultBakeImpostor(mesh, scene, { pipelines, failMs: opts.failMs, signal: opts.signal });
    return { texture, events, scene, renders: () => events.filter((e) => e.startsWith("render")) };
  }

  it("reads what each render left out around it, and keeps a first render that left nothing out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { texture, events } = bake({ leftOut: () => 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await texture).not.toBeNull();
    expect(events).toEqual(["ready", "take", "guarded", "render, rate 1, left out 0", "take"]);
  });

  it("renders again every 250 ms, readiness checked first, until a render left nothing out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { texture, events, renders } = bake({ leftOut: (i) => [3, 2, 0][i] ?? 0 });
    await vi.advanceTimersByTimeAsync(249);
    expect(renders().length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(renders().length).toBe(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(renders().length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await texture).not.toBeNull();
    expect(events).toEqual([
      "ready", "take", "guarded", "render, rate 1, left out 3", "take",
      "ready", "take", "guarded", "render, rate 1, left out 2", "take",
      "ready", "take", "guarded", "render, rate 1, left out 0", "take",
    ]);
  });

  it("goes back to its poll while the target is not ready, and renders only a ready one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { texture, events, renders } = bake({ gates: [true, false, false], leftOut: (i) => [1, 0][i] ?? 0 });
    await vi.advanceTimersByTimeAsync(250);
    expect(renders().length).toBe(1);
    await vi.advanceTimersByTimeAsync(31);
    expect(renders().length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await texture).not.toBeNull();
    expect(events).toEqual([
      "ready", "take", "guarded", "render, rate 1, left out 1", "take",
      "not ready",
      "not ready",
      "ready", "take", "guarded", "render, rate 1, left out 0", "take",
    ]);
  });

  it("renders as a target drawn once, on Babylon's synchronous path, when what is left of its bound runs out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { texture, renders } = bake({ failMs: 1_000, leftOut: (_i, rate) => (rate === 0 ? 0 : 1) });
    await vi.advanceTimersByTimeAsync(999);
    expect(renders()).toEqual([
      "render, rate 1, left out 1",
      "render, rate 1, left out 1",
      "render, rate 1, left out 1",
      "render, rate 1, left out 1",
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await texture).not.toBeNull();
    expect(renders().slice(4)).toEqual(["render, rate 0, left out 0"]);
  });

  it("keeps no render in which a draw was left out, even its synchronous one: it fails, and says so", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { texture, scene, renders } = bake({ failMs: 500, leftOut: () => 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await texture).toBeNull();
    expect(renders()).toEqual([
      "render, rate 1, left out 1",
      "render, rate 1, left out 1",
      "render, rate 0, left out 1",
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renders().length).toBe(3);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["forest impostor bake left a draw out: s0_lod1"]);
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("stops without a word when the forest goes while it polls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const { texture, scene, renders } = bake({ leftOut: () => 1, signal: abort.signal });
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await vi.advanceTimersByTimeAsync(250);
    expect(await texture).toBeNull();
    expect(renders()).toEqual(["render, rate 1, left out 1"]);
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });
});
