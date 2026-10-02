import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/game/groundMaps.js", () => ({
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

import "../../../src/sim/passes/index.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { startSceneRoute } from "../../../src/game/scene/sceneRoute.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";
import { timeLimit } from "../../helpers/timeLimit.js";

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900, clientWidth: 1600, clientHeight: 900 }) as unknown as HTMLCanvasElement;

describe("the scene route", () => {
  it("plays the intro on the fixed world with no local player, seeks, renders one frame on request, and leaves nothing behind", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const ms = 0;
    const frames: ((ms: number) => void)[] = [];
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => ms, loadCar: async () => null, raf: (fn) => { frames.push(fn); return frames.length; }, paint: (s, name) => new PBRMaterial(name, s) },
      { t: 20, step: null },
    );
    const before = JSON.stringify(run.worldState());
    // The loop draws inside the engine's own frame: its frame count moves.
    const frameId = run.scene().getEngine().frameId;
    for (const fn of frames.splice(0)) fn(0);
    for (const fn of frames.splice(0)) fn(0);
    expect(run.scene().getEngine().frameId).toBe(frameId + 2);
    const api = (globalThis as { dayhikeScene?: { seek(t: number): void; frame(): Promise<void>; time(): number } }).dayhikeScene;
    expect(api).toBeDefined();
    expect(api?.time()).toBe(20);
    api?.seek(43);
    expect(api?.time()).toBe(43);
    // `frame()` draws now and resolves on the animation frame after.
    const drawn = api?.frame();
    for (const fn of frames.splice(0)) fn(0);
    await drawn;
    expect(container.querySelector("div.scene-caption")?.textContent).toBe("Four-one, be advised,\nradio won't carry past the road.");
    // A scene frame leaves the sim's state as it found it.
    expect(JSON.stringify(run.worldState())).toBe(before);
    // The trailhead's board stands on the route (the film frames it); the
    // hike's car does not, the scene's own car moving in its place.
    expect(run.scene().getMeshByName("trailhead_kiosk_box_0")).not.toBeNull();
    expect(run.scene().getMeshByName("trailhead_car_box")).toBeNull();
    run.dispose();
    expect((globalThis as { dayhikeScene?: unknown }).dayhikeScene).toBeUndefined();
    expect(container.querySelector("div.scene-caption")).toBeNull();
    expect(container.querySelector("div.scene-black")).toBeNull();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));

  it("holds the frame the step names", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    let ms = 0;
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => ms, loadCar: async () => null, raf: () => 0, paint: (s, name) => new PBRMaterial(name, s) },
      { t: null, step: 240 },
    );
    const api = (globalThis as { dayhikeScene?: { time(): number } }).dayhikeScene;
    ms = 90000;
    expect(api?.time()).toBe(10);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));

  it("lays the car's soft patch under the film's car, riding with it", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    let root: TransformNode | null = null;
    const run = startSceneRoute(
      {
        canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => 0, raf: () => 0, paint: (s, name) => new PBRMaterial(name, s),
        loadCar: async (scene) => {
          root = new TransformNode("film_car", scene);
          return { node: root, meshes: [], dispose() {} };
        },
      },
      { t: 20, step: null },
    );
    await (globalThis as { dayhikeScene?: { ready: Promise<void> } }).dayhikeScene!.ready;
    const patch = run.scene().getMeshByName("film_car_shadow");
    expect(patch?.parent).toBe(root);
    // Fogged as the road is, and half as dark as the hike's parked car's under the film's mist.
    expect(patch?.material?.getClassName()).toBe("PBRMaterial");
    expect(patch?.material?.alpha).toBe(0.5);
    run.dispose();
  }, timeLimit(20000));

  it("resolves ready once the loads have settled, arrived or not, says its engine, and holds no wildlife", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => 0, loadCar: async () => null, raf: () => 0, paint: (s, name) => new PBRMaterial(name, s) },
      { t: 20, step: null },
    );
    const api = (globalThis as { dayhikeScene?: { ready: Promise<void>; engine(): string } }).dayhikeScene!;
    // The car's load answers null and the ranger's file cannot be read in Node: both settle.
    await expect(api.ready).resolves.toBeUndefined();
    expect(api.engine()).toBe("webgl2");
    expect(run.hasWildlife).toBe(false);
    run.dispose();
  }, timeLimit(20000));

  it("builds the title scene: no film models, the hike's parked car, and ready once the world is in", async () => {
    const doc = installStandInDom();
    let carLoads = 0;
    let release: () => void = () => undefined;
    const worldIn = vi.fn<(maxMs: number) => Promise<void>>(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = startSceneRoute(
      {
        canvas: nullCanvas(), container: asHtml(doc.createElement("div")), tier: "low", now: () => 0, raf: () => 0,
        paint: (s, name) => new PBRMaterial(name, s), worldIn,
        loadCar: async () => { carLoads += 1; return null; },
      },
      { t: 3, step: null },
      "title",
    );
    const api = (globalThis as { dayhikeScene?: { ready: Promise<void>; time(): number } }).dayhikeScene!;
    let readied = false;
    void api.ready.then(() => { readied = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(readied).toBe(false);
    release();
    await api.ready;
    expect(worldIn).toHaveBeenCalledWith(60000);
    expect([carLoads, api.time()]).toEqual([0, 3]);
    expect(run.scene().getMeshByName("trailhead_car_box")).not.toBeNull();
    expect(run.scene().getMeshByName("film_car_shadow")).toBeNull();
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
});
