import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { facingDir, facingYaw } from "../../src/sim/facing.js";

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

describe("facingDir", () => {
  it("is the direction a yaw faces: +z at 0, +x at a quarter turn", () => {
    expect(facingDir(0)).toEqual({ x: 0, z: 1 });
    expect(facingDir(Math.PI / 2).x).toBeCloseTo(1, 11);
    expect(facingDir(Math.PI / 2).z).toBeCloseTo(0, 11);
    expect(facingDir(Math.PI)).toEqual({ x: 0, z: -1 });
    expect(facingDir(1).x).toBeCloseTo(0.8414709848078965, 12);
    expect(facingDir(1).z).toBeCloseTo(0.5403023058681399, 12);
    expect(facingDir(-2.5).x).toBeCloseTo(-0.5984721441039563, 12);
    expect(facingDir(-2.5).z).toBeCloseTo(-0.8011436155469338, 12);
  });

  it("is within 1e-12 of the sine and cosine over the whole turn", () => {
    let worst = 0;
    for (let i = -3141; i <= 3141; i++) {
      const d = facingDir(i / 1000);
      worst = Math.max(worst, Math.abs(d.x - Math.sin(i / 1000)), Math.abs(d.z - Math.cos(i / 1000)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("uses none of the host's trigonometry", () => {
    // The code, without its comments: they name what it does not use.
    const source = readFileSync(new URL("../../src/sim/facing.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|acos|asin|hypot|pow)\b/);
  });
});
