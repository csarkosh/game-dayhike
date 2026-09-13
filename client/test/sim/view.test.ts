import { describe, it, expect } from "vitest";
import { aimDirection } from "../../src/sim/view.js";

describe("aimDirection", () => {
  it("points along +Z at yaw 0 and pitch 0", () => {
    const d = aimDirection(0, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(1, 6);
  });

  it("points up when pitch is negative", () => {
    expect(aimDirection(0, -Math.PI / 2).y).toBeCloseTo(1, 6);
  });

  it("stays unit length", () => {
    for (const [yaw, pitch] of [
      [0.4, 0.3],
      [2.2, -1.1],
      [-3, 0.9],
    ] as const) {
      const d = aimDirection(yaw, pitch);
      expect(Math.sqrt(d.x ** 2 + d.y ** 2 + d.z ** 2)).toBeCloseTo(1, 9);
    }
  });
});
