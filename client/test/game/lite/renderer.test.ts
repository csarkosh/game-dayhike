import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../src/sim/passes/index.js";
import { PLAYER_EYE_OFFSET } from "../../../src/sim/constants.js";
import { CAP_SCENE_S, LENS_24, LENS_32, SHOTS, SUMMIT_SCENE_S, capStand, summitShot } from "../../../src/game/cutscene.js";
import { DIED_EYE_HEIGHT, DIED_FALL_S } from "../../../src/game/ending.js";
import { GAME_FOV } from "../../../src/game/gameLens.js";
import type { CarPose } from "../../../src/game/scene/timeline.js";
import { PLAYER_HALF } from "../../../src/sim/constants.js";
import { DEPTH_AHEAD_MAX_DEGREES, depthAheadPlugin } from "../../../src/game/lite/renderer.js";
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

  it("reads out no GPU time outside the measurement mode, and in it says unsupported until its engine stands", () => {
    expect(make().gpuTime).toBeNull();
    renderer?.dispose();
    const page = globalThis as { __gpuTime?: () => unknown };
    const measured = createHikeRenderer(canvas(), EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture(), clock: () => 0, gpuTime: true });
    renderer = measured;
    expect(measured.gpuTime?.read()).toMatchObject({ supported: false, frameMs: null, mainMs: null, targets: [], missed: [] });
    // The page's hook is the same read, and goes with the renderer.
    expect(page.__gpuTime?.()).toEqual(measured.gpuTime?.read());
    measured.dispose();
    expect(page.__gpuTime).toBeUndefined();
  });

  it("tells a shader's compile to no one while no device has been asked for one, and keeps no shader", () => {
    const r = make();
    let told = 0;
    const stop = r.onShaderCompiled(() => told++);
    r.keepShaders();
    r.drawFrame();
    stop();
    expect(told).toBe(0);
  });

  it("offers a watch of its own on the engine it makes, which the hike is told a lost device through", () => {
    const r = make();
    expect(r.ownWatch).not.toBeNull();
    const heard: string[] = [];
    const off = r.ownWatch?.(r.engine, (reason) => heard.push(reason));
    expect(typeof off).toBe("function");
    off?.();
    // No device was ever made under Node: nothing is told.
    expect(heard).toEqual([]);
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

  it("plays a scene on its camera: the cap's turn from the player's eye and back to it, the summit's shots through their own lenses", () => {
    let now = 0;
    const r = make(() => now);
    r.setBobScale(0);
    const player = {
      id: 3, pos: { x: 5, y: 40, z: 9 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.1, grounded: true, lamp: { on: true, charge: 1 },
    } as unknown as Parameters<typeof windTestState>[0];
    const state = windTestState(player);
    const eye = { x: 5, y: 40 + PLAYER_EYE_OFFSET, z: 9 };
    /** The canvas row of a point 20 m along the camera's look and half a view of `fov` above it: the frame's top row under that lens. */
    const topRow = (fov: number): number => {
      const heard = r.listener();
      const at = r.cameraPosition();
      // The camera's own up, with no roll: its look turned a quarter up.
      const pitch = -Math.asin(heard.fy);
      const yaw = Math.atan2(heard.fx, heard.fz);
      const up = { x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw) * Math.sin(pitch) };
      const d = 20;
      const lift = d * Math.tan(fov / 2);
      return r.project({ x: at.x + heard.fx * d + up.x * lift, y: at.y + heard.fy * d + up.y * lift, z: at.z + heard.fz * d + up.z * lift })?.y ?? NaN;
    };
    // The cap's scene: held on its stand, turned to the cap, at the game's lens; then the eye again.
    const cap = { x: 9, y: 39.4, z: 12 };
    r.setScene("cap", cap);
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    now = 2000;
    r.sync(state, 3, 1);
    const stand = capStand({ ...eye, yaw: 0.3, pitch: 0.1 }, cap);
    expect(r.cameraPosition()).toEqual({ x: stand.x, y: stand.y, z: stand.z });
    expect(r.listener().fx).toBeCloseTo(Math.sin(stand.yaw) * Math.cos(stand.pitch), 9);
    expect(r.listener().fy).toBeCloseTo(-Math.sin(stand.pitch), 9);
    expect(topRow(GAME_FOV)).toBeCloseTo(0, 6);
    now = CAP_SCENE_S * 1000;
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    // The summit's scene: each shot's own camera from its first frame, through its own lens.
    const body = { x: 30, y: 41, z: 20 };
    const more = { hollow: { x: 33, y: 41, z: 24 }, party: eye };
    // On a whole second, so each cut falls on its frame.
    now = 8000;
    r.setScene("summit", body, more);
    const ctx = { base: { ...eye, yaw: 0.3, pitch: 0.1 }, body, hollow: more.hollow, party: more.party };
    const since = now;
    let at = 0;
    for (const [shot, lens] of [LENS_24, LENS_32, LENS_24, LENS_32].entries()) {
      now = since + at * 1000;
      r.sync(state, 3, 1);
      const want = summitShot(at, ctx);
      expect(want.shot).toBe(shot);
      const stood = r.cameraPosition();
      expect(stood.x).toBeCloseTo(want.x, 9);
      expect(stood.y).toBeCloseTo(want.y, 9);
      expect(stood.z).toBeCloseTo(want.z, 9);
      expect(topRow(lens)).toBeCloseTo(0, 6);
      at += SHOTS[shot] as number;
    }
    // The threshold is the player's own eye at the game's lens, and the hike's after it.
    now = since + at * 1000;
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    expect(topRow(GAME_FOV)).toBeCloseTo(0, 6);
    now = since + SUMMIT_SCENE_S * 1000;
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    // The free camera is no scene's: it flies where it is put while one plays.
    r.setScene("cap", cap);
    r.setFreecam({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0 });
    now += 2000;
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("plays the death on its camera, down to the ground under the player, and gives the eye back when it is undone", () => {
    let now = 0;
    const r = make(() => now);
    r.setBobScale(0);
    const player = {
      id: 3, pos: { x: 5, y: 40, z: 9 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.1, grounded: true, lamp: { on: true, charge: 1 },
    } as unknown as Parameters<typeof windTestState>[0];
    const state = windTestState(player);
    const eye = { x: 5, y: 40 + PLAYER_EYE_OFFSET, z: 9 };
    expect(r.endScene()).toBeNull();
    r.setEnding("died");
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    now = DIED_FALL_S * 1000;
    r.sync(state, 3, 1);
    const down = r.cameraPosition();
    expect([down.x, down.z]).toEqual([5, 9]);
    expect(down.y).toBeCloseTo(40 - PLAYER_HALF.y + DIED_EYE_HEIGHT, 9);
    // Near straight up.
    expect(r.listener().fy).toBeGreaterThan(0.95);
    // A second word of it is nothing; undone, the eye is the player's again.
    r.setEnding("died");
    r.clearEnding();
    now += 100;
    r.sync(state, 3, 1);
    expect(r.cameraPosition()).toEqual(eye);
    expect(r.endScene()).toBeNull();
  });

  it("plays the end scene: the run's camera, the car the scenery hands it stood at its pose each frame, taken out of the rain's cover once and its lamps lit at the catch", () => {
    let now = 5000;
    const r = make(() => now);
    r.setBobScale(0);
    const at = (x: number, z: number): Parameters<typeof windTestState>[0] => ({
      id: 3, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true, lamp: { on: true, charge: 1 },
    }) as unknown as Parameters<typeof windTestState>[0];
    const staged: CarPose[] = [];
    let left = 0;
    const lit: boolean[] = [];
    const car = { stage: (pose: CarPose) => void staged.push({ ...pose }), leave: () => void (left += 1), tailLamps: (on: boolean) => void lit.push(on) };
    // A straight road along z on flat ground; the car on its shoulder at the pad, its nose to +z.
    r.setEnding("won", { site: { x: 6.9, z: 0 }, direction: 1, road: { centerX: () => 0, groundY: () => 0 }, door: { x: 8.4, z: 0.5 }, car: () => car });
    expect(r.endScene()).toEqual({ t: 0, arrival: null, shot: 0, car: { x: 6.9, y: 0, z: 0, yaw: 0, speed: 0 } });
    r.sync(windTestState(at(20, 10)), 3, 1);
    // Shot 1: behind the runner and to their right, over their eye, on the 24 mm.
    const run = r.cameraPosition();
    expect(run.x).toBeCloseTo(21.321891583212775, 9);
    expect(run.y).toBeCloseTo(0.9 + PLAYER_EYE_OFFSET + 0.5, 9);
    expect(run.z).toBeCloseTo(11.858118037755196, 9);
    expect(staged).toHaveLength(1);
    // At the door a second later: the engine's shot from the far shoulder.
    now = 6000;
    r.sync(windTestState(at(8.4, 0.5)), 3, 1);
    expect(r.endScene()).toMatchObject({ arrival: 1, shot: 2 });
    expect(r.cameraPosition()).toEqual({ x: -6.9, y: 0.6, z: 7 });
    expect([left, lit.length]).toEqual([0, 0]);
    // 4.6 s after the arrival: 7 m down the road, out of the cover, the lamps lit; heard from the camera.
    now = 10600;
    r.sync(windTestState(at(8.4, 0.5)), 3, 1);
    expect(r.endScene()!.car.z).toBeCloseTo(7, 9);
    expect(staged[staged.length - 1]!.z).toBeCloseTo(7, 9);
    expect(staged[staged.length - 1]!.wheelSpin).toBeGreaterThan(0);
    expect([left, lit]).toEqual([1, [true]]);
    r.sync(windTestState(at(8.4, 0.5)), 3, 1);
    expect([left, lit]).toEqual([1, [true]]);
    expect(r.listener().x).toBe(-6.9);
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

  it("holds the ground cloud at the level the console gives it and says what is drawn, which is none where none is marched", () => {
    const r = make();
    // No forest and the low tier: no cloud is marched, and the night's density is never worked.
    expect(r.setMist(null)).toBe(0);
    expect(r.setMist(0.7)).toBe(0.7);
    expect(r.setMist(3)).toBe(1);
    expect(r.setMist(-1)).toBe(0);
    r.setHaunt(1);
    r.setMistIn(1);
    r.setChase(1);
    r.setFreecam({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0 });
    r.sync(windTestState(), -1, 0);
    expect(r.setMist(null)).toBe(0);
  });

  it("answers the canopy's read-outs itself: no water while no rain is stepped, no canopy where no forest stands", () => {
    const r = make();
    expect(r.canopyWater()).toBe(0);
    expect(r.canopyOver()).toBe(0);
    r.setWeather(WEATHER_PRESETS.rain, 0);
    r.setFreecam({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0 });
    r.sync(windTestState(), -1, 0);
    // Nothing stands to step the rain, and a level with no forest has no canopy.
    expect(r.canopyWater()).toBe(0);
    expect(r.canopyOver()).toBe(0);
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

  it("adds the slope's half where it is asked for: a pixel's step of depth on the surface, by the vertex normal's angle to the eye", () => {
    const plugin = depthAheadPlugin(120, 1);
    const code = (plugin.getCustomCode?.("vertex") as { CUSTOM_VERTEX_MAIN_END: string }).CUSTOM_VERTEX_MAIN_END;
    // The constant half as it was, then the slope's.
    expect(code.startsWith(`out.clipPos.z+=${(120 / 2 ** 24).toExponential(6)}*out.clipPos.w;`)).toBe(true);
    // The angle is the normal's to the eye, held under the plugin's steepest; its tangent is sqrt(1 - c^2) / c.
    expect(code).toContain(`clamp(abs(dot(normalize(out.worldNormal),normalize(scene.vEyePosition.xyz-out.worldPos))),${Math.cos((DEPTH_AHEAD_MAX_DEGREES * Math.PI) / 180).toExponential(6)},1.0)`);
    expect(code).toContain("sqrt(1.0-daC*daC)/daC");
    // The projection's constant term over a pixel's angle: both read from the frame's block.
    expect(code).toContain("abs(daP[3].z)");
    expect(code).toContain("2.0/(abs(daP[1].y)*hikeFrame.fadeRows)");
    expect(code).toContain("let daP=hikeFrame.frameProjection;");
    // Toward the eye, as the constant half: Lite's depth is 1 at the near plane.
    expect(code).toContain(`out.clipPos.z+=${(1).toExponential(6)}*abs(daP[3].z)`);
    expect(plugin.defines).toEqual({ units: 120, slope: 1 });
    expect(DEPTH_AHEAD_MAX_DEGREES).toBeGreaterThan(60);
    expect(DEPTH_AHEAD_MAX_DEGREES).toBeLessThan(90);
  });
});
