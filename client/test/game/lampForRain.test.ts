import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { lampForRain } from "../../src/game/renderer.js";
import { createHeadlamp, setLamp } from "../../src/game/headlamp.js";
import type { RainLamp } from "../../src/game/rain.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

/** The renderer's own setup: a headlamp parented to the camera at its eye,
 * pointing down its +Z, the camera placed and turned to `yaw`. */
function rig(yaw: number) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("c", new Vector3(10, 5, -20), scene);
  camera.rotation.set(0, yaw, 0);
  const lamp = createHeadlamp(scene, "lamp_local");
  lamp.parent = camera;
  lamp.position.set(0, 0, 0);
  lamp.direction.set(0, 0, 1);
  const out: RainLamp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 0, r: 1, g: 1, b: 1 };
  return { lamp, out };
}

describe("lampForRain", () => {
  it("reads the lamp's world position and direction through its parent, the camera", () => {
    // Yaw π/2 turns the camera's +Z to +X.
    const { lamp, out } = rig(Math.PI / 2);
    expect(lampForRain(lamp, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([10, 5, -20]);
    expect(out.dx).toBeCloseTo(1, 9);
    expect(out.dy).toBeCloseTo(0, 9);
    expect(out.dz).toBeCloseTo(0, 9);
    expect(out.angle).toBe(1.5);
  });

  it("carries the lamp's intensity, 0 when off, and its colour when on", () => {
    const { lamp, out } = rig(0);
    setLamp(lamp, false, { intensity: 400, colour: { r: 1, g: 0.9, b: 0.8 } });
    lampForRain(lamp, out);
    expect(out.intensity).toBe(0);
    expect(out.dz).toBeCloseTo(1, 9);
    setLamp(lamp, true, { intensity: 400, colour: { r: 1, g: 0.9, b: 0.8 } });
    lampForRain(lamp, out);
    expect(out.intensity).toBe(400);
    expect([out.r, out.g, out.b]).toEqual([1, 0.9, 0.8]);
  });
});
