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
    api?.seek(33.5);
    expect(api?.time()).toBe(33.5);
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
});
