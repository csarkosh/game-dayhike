import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../src/sim/passes/index.js";
import { PLAYER_EYE_OFFSET } from "../../../src/sim/constants.js";
import { GAME_FOV } from "../../../src/game/gameLens.js";
import { depthAheadPlugin } from "../../../src/game/lite/renderer.js";
import { createHikeRenderer, sceneRendererOf, type Renderer } from "../../../src/game/renderer.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import { windRecordUnder } from "../../../src/game/windParams.js";
import { EMPTY_LEVEL, windTestState } from "../helpers/rendererWorld.js";
import { skyFixture } from "../helpers/skyFixture.js";

const canvas = (): HTMLCanvasElement => ({ clientWidth: 800, clientHeight: 600 }) as unknown as HTMLCanvasElement;

/**
 * The hike's renderer under Node, where no WebGPU device can be had: its
 * engine is never made, which it says once, and it stands empty. What it
 * answers with no engine is what these tests read.
 */
describe("the hike's renderer on Babylon Lite, before its engine stands", () => {
  let renderer: Renderer | null = null;
  const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const make = (clock: () => number = () => 0): Renderer => {
    renderer = createHikeRenderer(canvas(), EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture(), clock });
    return renderer;
  };
  afterEach(() => {
    renderer?.dispose();
    renderer = null;
    said.mockClear();
  });

  it("is what the hike is given: drawn on WebGPU by an engine of its own, with no Babylon scene to build into", () => {
    const r = make();
    expect(r.engineName).toBe("webgpu");
    expect(sceneRendererOf(r)).toBeNull();
    expect(r.engine.isDisposed).toBe(false);
  });

  it("refuses an engine handed to it", () => {
    const engine = { isDisposed: false, dispose: () => undefined };
    expect(() => createHikeRenderer(canvas(), EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture(), engine })).toThrow(/makes its own engine/);
  });

  it("says once that it could not be made, is ready all the same, and draws nothing", async () => {
    const r = make();
    await r.whenReady(60_000);
    expect(said).toHaveBeenCalledTimes(1);
    expect(String(said.mock.calls[0]?.[0])).toContain("could not be made");
    expect(r.waitingItems()).toBe(0);
    await r.skyReady();
    expect(() => r.drawFrame()).not.toThrow();
    expect(() => r.resize()).not.toThrow();
    await r.buildFirstClipmap(8);
    expect(() => r.buildClipmapNow()).not.toThrow();
  });

  it("reads out the last frame's jobs and uploads in the measurement mode alone, and takes the read-outs with it", () => {
    const page = globalThis as { __syncJobs?: () => { slices: number }; __frameUploads?: () => { bytes: number; streamed: number; byKind: Record<string, number> } };
    make();
    expect(page.__syncJobs).toBeUndefined();
    expect(page.__frameUploads).toBeUndefined();
    renderer?.dispose();
    renderer = createHikeRenderer(canvas(), EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture(), clock: () => 0, gpuTime: true });
    expect(page.__syncJobs?.().slices).toBe(0);
    const first = page.__frameUploads?.();
    expect(first?.bytes).toBe(0);
    expect(first?.streamed).toBe(0);
    expect(Object.keys(first?.byKind ?? {})).toEqual(["instances", "pluginInstances", "geometry", "pluginVertices", "textures", "uniforms"]);
    // A frame with nothing standing hands nothing over; each reading is a copy of its own.
    renderer.sync(windTestState(), 1, 1);
    const second = page.__frameUploads?.();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    renderer.dispose();
    expect(page.__syncJobs).toBeUndefined();
    expect(page.__frameUploads).toBeUndefined();
  });

  it("stands the camera where it was made until a frame places it, then where the free camera is", async () => {
    const r = make();
    expect(r.cameraPosition()).toEqual({ x: 0, y: 2, z: 0 });
    let synced = false;
    void r.firstSynced.then(() => {
      synced = true;
    });
    // A frame with no local player and no free camera places nothing.
    r.sync(windTestState(), -1, 0);
    await Promise.resolve();
    expect(r.cameraPosition()).toEqual({ x: 0, y: 2, z: 0 });
    expect(synced).toBe(false);
    r.setFreecam({ x: 12, y: 30, z: -7, yaw: Math.PI / 2, pitch: 0 });
    r.sync(windTestState(), -1, 0);
    await Promise.resolve();
    expect(synced).toBe(true);
    const at = r.cameraPosition();
    expect(at).toEqual({ x: 12, y: 30, z: -7 });
    // A copy: the caller's to keep.
    at.x = 99;
    expect(r.cameraPosition().x).toBe(12);
    // Heard from where it flies, facing east.
    const heard = r.listener();
    expect([heard.x, heard.y, heard.z]).toEqual([12, 30, -7]);
    expect(heard.fx).toBeCloseTo(1, 9);
    expect(heard.fz).toBeCloseTo(0, 9);
  });

  it("projects a world point through the camera's pose and the game's lens onto the canvas", () => {
    const r = make();
    r.setFreecam({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0 });
    r.sync(windTestState(), -1, 0);
    expect(r.project({ x: 0, y: 10, z: 20 })).toEqual({ x: 400, y: 300, depth: 20 });
    expect(r.project({ x: 0, y: 10, z: -20 })).toBeNull();
    const top = r.project({ x: 0, y: 10 + 20 * Math.tan(GAME_FOV / 2), z: 20 });
    expect(top?.y).toBeCloseTo(0, 6);
    // A film shot's lens is the free camera's own.
    r.setFreecam({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0, fov: 0.7 });
    r.sync(windTestState(), -1, 0);
    expect(r.project({ x: 0, y: 10 + 20 * Math.tan(0.35), z: 20 })?.y).toBeCloseTo(0, 6);
  });

  it("follows the local player's eye when the camera is not free", () => {
    const r = make();
    r.setBobScale(0);
    const player = {
      id: 3, pos: { x: 5, y: 40, z: 9 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.1, grounded: true, lamp: { on: true, charge: 1 },
    } as unknown as Parameters<typeof windTestState>[0];
    r.sync(windTestState(player), 3, 1);
    expect(r.cameraPosition()).toEqual({ x: 5, y: 40 + PLAYER_EYE_OFFSET, z: 9 });
    const heard = r.listener();
    expect(heard.fx).toBeCloseTo(Math.sin(0.3) * Math.cos(0.1), 9);
    expect(heard.fy).toBeCloseTo(-Math.sin(0.1), 9);
  });

  it("keeps the wind of its weather and its clock, or the override's", () => {
    let now = 5000;
    const r = make(() => now);
    r.setWeather(WEATHER_PRESETS.rain, 0);
    r.sync(windTestState(), -1, 0);
    expect(r.wind()).toEqual(windRecordUnder(WEATHER_PRESETS.rain, 5));
    now = 9000;
    r.setWindOverride(2);
    r.sync(windTestState(), -1, 0);
    expect(r.wind()).toEqual(windRecordUnder(WEATHER_PRESETS.rain, 9, 1));
    r.setWindOverride(null);
    r.sync(windTestState(), -1, 0);
    expect(r.wind()).toEqual(windRecordUnder(WEATHER_PRESETS.rain, 9));
  });

  it("has no bake to tell of, and ends none, while no forest stands", () => {
    const r = make();
    expect(r.impostorBakes()).toEqual([]);
    expect(() => r.abandon()).not.toThrow();
    expect(r.impostorBakes()).toEqual([]);
  });

  it("lets its engine go once, by dispose or by retire, and resolves what waited on its first frame", async () => {
    const r = make();
    const handle = r.retire();
    expect(handle).toBe(r.engine);
    expect(handle.isDisposed).toBe(true);
    await expect(r.firstSynced).resolves.toBeUndefined();
    expect(() => r.dispose()).not.toThrow();
    expect(() => r.sync(windTestState(), -1, 0)).not.toThrow();
  });
});

describe("a depth offset toward the eye, in the vertex stage", () => {
  it("raises the clip depth by so many steps of a 24-bit depth buffer, scaled by w", () => {
    const plugin = depthAheadPlugin(120);
    expect(plugin.getCustomCode?.("vertex")).toEqual({ CUSTOM_VERTEX_MAIN_END: `out.clipPos.z+=${(120 / 2 ** 24).toExponential(6)}*out.clipPos.w;` });
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    expect(plugin.defines).toEqual({ units: 120 });
  });
});
