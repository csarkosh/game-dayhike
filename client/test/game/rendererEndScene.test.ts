import { describe, it, expect, vi } from "vitest";

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
import type { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import type { PlayerState } from "../../src/sim/types.js";
import { createRenderer, lampForRain } from "../../src/game/renderer.js";
import { LAMP_INTENSITY } from "../../src/game/headlamp.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

function player(x: number, z: number): PlayerState {
  return {
    id: 1, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 100, grounded: true,
    lastProcessedInput: 0, deathPos: null, lamp: { on: true, charge: 1 }, stare: 0, safe: true,
  };
}

describe("the renderer's end scene", () => {
  it("films the run from its first frame, hides the body from the arrival, drives the car and lights its lamps at the catch", () => {
    const level = parseLevel(sandbox01);
    const world = createWorld(level, 4242, false);
    let now = 5000;
    const r = createRenderer(nullCanvas(), level, null, { tier: "low", clock: () => now });
    const root = new TransformNode("car", r.scene);
    let left = 0;
    const car = { root, model: null, leave: () => void (left += 1) };
    // A straight road along z on flat ground; the car on its shoulder at the pad, its nose to +z.
    r.setEnding("won", {
      site: { x: 6.9, z: 0 }, direction: 1, road: { centerX: () => 0, groundY: () => 0 }, door: { x: 8.4, z: 0.5 },
      car: () => car,
    });
    const tails = r.scene.meshes.filter((m) => m.name.startsWith("car_tail_lamp_"));
    const lens = r.scene.lights.find((l) => l.name === "lamp_local") as SpotLight;

    world.state.players.set(1, player(20, 10));
    r.sync(world.state, 1, 0, { dt: 0.016, sprinting: true });
    // Shot 1: behind the runner and to their right, over their eye, at the door, on the 24 mm.
    expect(r.camera.position.x).toBeCloseTo(21.321891583212775, 9);
    expect(r.camera.position.y).toBeCloseTo(2.1, 9);
    expect(r.camera.position.z).toBeCloseTo(11.858118037755196, 9);
    expect(r.camera.rotation.y).toBeCloseTo(-2.291877519079126, 9);
    expect(r.camera.fov).toBe(0.57);
    expect(r.views.showLocal).toBe(true);
    expect(lens.intensity).toBe(0);
    expect(r.endScene()).toEqual({ t: 0, arrival: null, shot: 0, car: { x: 6.9, y: 0, z: 0, yaw: 0, speed: 0 } });
    // The tail lamps are made with the scene, hidden to the catch.
    expect(tails.map((m) => m.isEnabled())).toEqual([false, false]);

    // At the door a second later: in the car, the engine shot from the far shoulder.
    now = 6000;
    world.state.players.set(1, player(8.4, 0.5));
    r.sync(world.state, 1, 0, { dt: 0.016, sprinting: true });
    expect(r.views.showLocal).toBe(false);
    expect(r.endScene()!.arrival).toBe(1);
    expect(r.endScene()!.shot).toBe(2);
    expect([r.camera.position.x, r.camera.position.y, r.camera.position.z]).toEqual([-6.9, 0.6, 7]);
    expect(r.camera.fov).toBe(0.43);
    expect(lens.intensity).toBe(0);
    expect(r.views.hideNear).toEqual({ x: 8.4, z: 0.5, radius: 1.2 });
    expect(left).toBe(0);

    // Past the catch, 4.6 s after the arrival: the car 7 m down the road, the lens's lamp its right headlamp.
    now = 10600;
    r.sync(world.state, 1, 0, { dt: 0.016, sprinting: false });
    expect(r.endScene()!.car.z).toBeCloseTo(7, 9);
    expect(r.endScene()!.car.speed).toBeCloseTo(7, 9);
    expect(root.position.z).toBeCloseTo(7, 9);
    expect(root.rotation.y).toBeCloseTo(-0.18048116140626563, 9);
    expect(lens.intensity).toBe(LAMP_INTENSITY);
    expect([lens.angle, lens.range]).toEqual([1.9, 60]);
    expect(lens.parent).toBeNull();
    // The rain is lit from the headlamp where it stands, not from the camera it left.
    const rainLamp = lampForRain(lens, { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, intensity: 0, angle: 0, r: 0, g: 0, b: 0 });
    expect([rainLamp.x, rainLamp.y, rainLamp.z]).toEqual([lens.position.x, lens.position.y, lens.position.z]);
    expect([rainLamp.dx, rainLamp.dy, rainLamp.dz]).toEqual([lens.direction.x, lens.direction.y, lens.direction.z]);
    expect(rainLamp.angle).toBe(1.9);
    expect(r.views.localLampAt?.angle).toBe(1.9);
    // Gone from the rain's cover from the pull-away, once.
    expect(left).toBe(1);
    expect(tails.map((m) => m.parent)).toEqual([root, root]);
    expect(tails.map((m) => m.isEnabled())).toEqual([true, true]);
    expect(tails.map((m) => m.position.asArray())).toEqual([[-0.7, 0.75, -2.2], [0.7, 0.75, -2.2]]);
    r.dispose();
    expect(tails.every((m) => m.isDisposed())).toBe(true);
  });

  it("keeps the lamps at the parked car when there is no car drawn to drive, its box alone", () => {
    const level = parseLevel(sandbox01);
    const world = createWorld(level, 4242, false);
    let now = 5000;
    const r = createRenderer(nullCanvas(), level, null, { tier: "low", clock: () => now });
    r.setEnding("won", {
      site: { x: 6.9, z: 0 }, direction: 1, road: { centerX: () => 0, groundY: () => 0 }, door: { x: 8.4, z: 0.5 }, car: () => null,
    });
    world.state.players.set(1, player(8.4, 0.5));
    r.sync(world.state, 1, 0, { dt: 0.016, sprinting: true });
    now = 9600;
    r.sync(world.state, 1, 0, { dt: 0.016, sprinting: false });
    const lens = r.scene.lights.find((l) => l.name === "lamp_local") as SpotLight;
    // The sound's car is 7 m down the road; the lamps stand at the parked car's right front.
    expect(r.endScene()!.car.z).toBeCloseTo(7, 9);
    expect([lens.position.x, lens.position.y, lens.position.z]).toEqual([7.5, 0.7, 2.3]);
    expect(r.views.localLampAt).toEqual(expect.objectContaining({ x: expect.closeTo(6.3, 9), y: 0.7, z: 2.3 }));
    r.dispose();
  });
});
