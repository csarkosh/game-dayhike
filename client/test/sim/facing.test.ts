import { describe, expect, it } from "vitest";
import { facingYaw } from "../../src/sim/facing.js";

describe("facingYaw", () => {
  it("is exact on the eight compass points", () => {
    expect(facingYaw(0, 1)).toBe(0);
    expect(facingYaw(1, 1)).toBe(0.7853981633974483);
    expect(facingYaw(1, 0)).toBe(1.5707963267948966);
    expect(facingYaw(1, -1)).toBe(2.356194490192345);
    expect(facingYaw(0, -1)).toBe(3.141592653589793);
    expect(facingYaw(-1, -1)).toBe(-2.356194490192345);
    expect(facingYaw(-1, 0)).toBe(-1.5707963267948966);
    expect(facingYaw(-1, 1)).toBe(-0.7853981633974483);
  });

  it("reads the same whatever the direction's length", () => {
    expect(facingYaw(1, 2)).toBe(0.5235987755982988);
    expect(facingYaw(10, 20)).toBe(0.5235987755982988);
    expect(facingYaw(-3, -1)).toBe(-1.9634954084936207);
  });

  it("faces +z when it is given no direction", () => {
    expect(facingYaw(0, 0)).toBe(0);
  });

  it("stays within 0.072 rad of the true angle all the way round", () => {
    let worst = 0;
    for (let i = 0; i < 36000; i++) {
      const a = (i / 36000) * 2 * Math.PI - Math.PI;
      const dx = Math.sin(a), dz = Math.cos(a);
      let d = Math.abs(facingYaw(dx, dz) - Math.atan2(dx, dz));
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > worst) worst = d;
    }
    expect(worst).toBeLessThan(0.072);
    expect(worst).toBeGreaterThan(0.07);
  });
});
