import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createHauntMist, HAUNT_MIST_ALPHA, HAUNT_MIST_AHEAD, HAUNT_MIST_SIDE, HAUNT_MIST_SWAY } from "../../src/game/hauntMist.js";

describe("the haunt's mist", () => {
  it("rides at the eye's left and right while the haunt is on at night, and shows nothing by day or with no haunt", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("player", new Vector3(10, 2, 5), scene);
    camera.rotation.set(0, 0, 0); // looking down +z: right is +x
    const mist = createHauntMist(scene);
    const banks = () => scene.meshes.filter((m) => m.name.startsWith("haunt_mist_"));
    expect(banks().length).toBe(2);
    mist.update(camera, 1, 1, 0);
    const [left, right] = banks();
    expect(left!.isEnabled()).toBe(true);
    expect(right!.isEnabled()).toBe(true);
    expect(left!.material!.alpha).toBeCloseTo(HAUNT_MIST_ALPHA, 12);
    expect(left!.position.x).toBeLessThan(10 - HAUNT_MIST_SIDE + HAUNT_MIST_SWAY + 1e-9);
    expect(right!.position.x).toBeGreaterThan(10 + HAUNT_MIST_SIDE - HAUNT_MIST_SWAY - 1e-9);
    expect(left!.position.z).toBeCloseTo(5 + HAUNT_MIST_AHEAD, 9);
    expect(left!.position.y).toBeCloseTo(3, 9);
    // Half a haunt in half a night: a quarter of the opacity.
    mist.update(camera, 0.5, 0.5, 1);
    expect(left!.material!.alpha).toBeCloseTo(HAUNT_MIST_ALPHA * 0.25, 12);
    // By day, nothing, whatever the haunt; with no haunt, nothing, whatever the night.
    mist.update(camera, 1, 0, 2);
    expect(left!.isEnabled()).toBe(false);
    mist.update(camera, 0, 1, 3);
    expect(right!.isEnabled()).toBe(false);
    mist.dispose();
    expect(banks().length).toBe(0);
    scene.dispose();
    engine.dispose();
  });
});
