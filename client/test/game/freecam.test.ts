import { describe, it, expect } from "vitest";
import { stepFreecam, FREECAM_SPEED, FREECAM_BOOST } from "../../src/game/freecam.js";

const at = (x = 0, y = 0, z = 0) => ({ x, y, z });
const keys = (...k: string[]) => new Set(k);

describe("stepFreecam", () => {
  it("moves along +Z at yaw 0, matching the simulation's forward", () => {
    const next = stepFreecam(at(), { yaw: 0, keys: keys("KeyW"), dt: 1 });
    expect(next.z).toBeCloseTo(FREECAM_SPEED, 6);
    expect(next.x).toBeCloseTo(0, 6);
  });

  it("strafes along +X at yaw 0", () => {
    const next = stepFreecam(at(), { yaw: 0, keys: keys("KeyD"), dt: 1 });
    expect(next.x).toBeCloseTo(FREECAM_SPEED, 6);
  });

  it("pins the horizontal basis at yaw = pi/2, where cross terms are non-zero", () => {
    // At yaw 0 the cross terms (sin(0) = 0) vanish, so a mirrored or negated
    // basis is indistinguishable from the correct one there. At yaw = pi/2
    // (sin = 1, cos = 0) they do not: a mirrored implementation gets the
    // sign of x or z backwards here even though every other test passes.
    const forward = stepFreecam(at(), { yaw: Math.PI / 2, keys: keys("KeyW"), dt: 1 });
    expect(forward.x).toBeCloseTo(FREECAM_SPEED, 6);
    expect(forward.z).toBeCloseTo(0, 6);

    const right = stepFreecam(at(), { yaw: Math.PI / 2, keys: keys("KeyD"), dt: 1 });
    expect(right.z).toBeCloseTo(-FREECAM_SPEED, 6);
    expect(right.x).toBeCloseTo(0, 6);
  });

  it("never moves vertically on WASD, whatever you are looking at", () => {
    // The failure this guards: flying into the ground when you look down and
    // press forward, which makes the camera useless for inspecting terrain.
    for (const yaw of [0, 1, -2.5, Math.PI]) {
      const next = stepFreecam(at(0, 100, 0), { yaw, keys: keys("KeyW", "KeyD"), dt: 1 });
      expect(next.y).toBe(100);
    }
  });

  it("ascends on J and descends on K along world up", () => {
    expect(stepFreecam(at(), { yaw: 2, keys: keys("KeyJ"), dt: 1 }).y).toBeCloseTo(FREECAM_SPEED, 6);
    expect(stepFreecam(at(), { yaw: 2, keys: keys("KeyK"), dt: 1 }).y).toBeCloseTo(-FREECAM_SPEED, 6);
  });

  it("scales linearly with dt, so speed is frame-rate independent", () => {
    const a = stepFreecam(at(), { yaw: 0, keys: keys("KeyW"), dt: 0.5 });
    const b = stepFreecam(at(), { yaw: 0, keys: keys("KeyW"), dt: 1 });
    expect(b.z).toBeCloseTo(a.z * 2, 6);
  });

  it("boosts with shift without changing direction", () => {
    const plain = stepFreecam(at(), { yaw: 0.7, keys: keys("KeyW"), dt: 1 });
    const fast = stepFreecam(at(), { yaw: 0.7, keys: keys("KeyW", "ShiftLeft"), dt: 1 });
    expect(fast.x).toBeCloseTo(plain.x * FREECAM_BOOST, 6);
    expect(fast.z).toBeCloseTo(plain.z * FREECAM_BOOST, 6);
  });

  it("cancels opposed keys exactly", () => {
    expect(stepFreecam(at(), { yaw: 1, keys: keys("KeyW", "KeyS"), dt: 1 })).toEqual(at());
    expect(stepFreecam(at(), { yaw: 1, keys: keys("KeyJ", "KeyK"), dt: 1 })).toEqual(at());
  });

  it("normalises diagonals, so W+D is not faster than W", () => {
    const straight = stepFreecam(at(), { yaw: 0, keys: keys("KeyW"), dt: 1 });
    const diagonal = stepFreecam(at(), { yaw: 0, keys: keys("KeyW", "KeyD"), dt: 1 });
    const speed = (p: { x: number; z: number }) => Math.sqrt(p.x * p.x + p.z * p.z);
    expect(speed(diagonal)).toBeCloseTo(speed(straight), 6);
  });

  it("stands still with no keys held", () => {
    expect(stepFreecam(at(1, 2, 3), { yaw: 1, keys: keys(), dt: 1 })).toEqual(at(1, 2, 3));
  });
});
