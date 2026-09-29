import { describe, expect, it } from "vitest";
import {
  CAR_SHADOW_CORE, CAR_SHADOW_DARK, CAR_SHADOW_HALF, CAR_SHADOW_LIFT, CAR_SHADOW_REACH, CAR_SHADOW_STEP, CAR_SHADOW_TEX,
  carShadowAlphaMap, carShadowAt, carShadowGrid,
} from "../../src/game/carShadow.js";

describe("carShadowAt", () => {
  it("is measured from the car's own box: 0.9 by 2.3 m to a side", () => {
    expect(CAR_SHADOW_CORE).toBe(0.3);
    expect(CAR_SHADOW_REACH).toBe(0.7);
    expect(CAR_SHADOW_DARK).toBe(0.88);
    expect(CAR_SHADOW_HALF.x).toBeCloseTo(1.6, 12);
    expect(CAR_SHADOW_HALF.z).toBeCloseTo(3, 12);
  });

  it("is darkest under the body's middle, and as dark all over the core", () => {
    expect(carShadowAt(0, 0)).toBe(0.88);
    expect(carShadowAt(0.6, 0)).toBe(0.88);
    expect(carShadowAt(-0.6, 2)).toBe(0.88);
    expect(carShadowAt(0.3, -2)).toBe(0.88);
  });

  it("has faded by a fifth at the body's side, and is gone 0.7 m past it", () => {
    // 0.3 m out of the core, of the 1 m the fade takes.
    expect(carShadowAt(0.9, 0)).toBeCloseTo(0.68992, 12);
    expect(carShadowAt(0, 2.3)).toBeCloseTo(0.68992, 12);
    expect(carShadowAt(1.6, 0)).toBe(0);
    expect(carShadowAt(0, -3)).toBe(0);
    expect(carShadowAt(2, 0)).toBe(0);
    expect(carShadowAt(0, 9)).toBe(0);
  });

  it("is the same on every side of the car", () => {
    for (const [x, z] of [[0.7, 0.4], [1.1, 2.2], [0.2, 2.6], [1.5, 0.1]] as const) {
      const a = carShadowAt(x, z);
      expect(carShadowAt(-x, z)).toBe(a);
      expect(carShadowAt(x, -z)).toBe(a);
      expect(carShadowAt(-x, -z)).toBe(a);
    }
  });

  it("rounds its corners: gone at the corner of its own rectangle, and well inside it", () => {
    expect(carShadowAt(1.6, 3)).toBe(0);
    // 0.75 m out of the core both ways is 1.061 m from it, past the 1 m the fade takes.
    expect(carShadowAt(1.35, 2.75)).toBe(0);
    // 0.65 m both ways is 0.919 m from it.
    expect(carShadowAt(1.25, 2.65)).toBeGreaterThan(0);
  });

  it("never darkens on the way out", () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [0.6, 0.8], [0.8, 0.6]] as const) {
      let last = carShadowAt(0, 0);
      for (let r = 0.05; r <= 3.5; r += 0.05) {
        const a = carShadowAt(dx * r, dz * r);
        expect(a).toBeLessThanOrEqual(last);
        last = a;
      }
      expect(last).toBe(0);
    }
  });
});

describe("carShadowAlphaMap", () => {
  const data = carShadowAlphaMap();
  const alpha = (x: number, y: number): number => data[(y * 64 + x) * 4 + 3]!;

  it("is 64 by 128 texels over the patch, white, with the darkness in its alpha", () => {
    expect(CAR_SHADOW_TEX).toEqual({ width: 64, height: 128 });
    expect(data).toHaveLength(32768);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
      expect(data[i + 1]).toBe(255);
      expect(data[i + 2]).toBe(255);
    }
  });

  it("is 224 of 255 over the core and clear along every edge", () => {
    expect(alpha(31, 63)).toBe(224);
    expect(alpha(32, 64)).toBe(224);
    // The last texel inside the core's corner, 0.575 m and 1.992 m from the middle.
    expect(alpha(43, 106)).toBe(224);
    expect(alpha(44, 107)).toBeLessThan(224);
    for (let x = 0; x < 64; x++) {
      expect(alpha(x, 0)).toBe(0);
      expect(alpha(x, 127)).toBe(0);
    }
    for (let y = 0; y < 128; y++) {
      expect(alpha(0, y)).toBe(0);
      expect(alpha(63, y)).toBe(0);
    }
  });

  it("reads each texel at its own centre", () => {
    // Texel 53 across is 1.075 m from the middle; row 63 is 0.0234 m from it.
    expect(alpha(53, 63)).toBe(Math.round(carShadowAt(1.075, -0.0234375) * 255));
    expect(alpha(53, 63)).toBe(121);
  });
});

describe("carShadowGrid", () => {
  const groundH = (x: number, z: number): number => 3 + 0.01 * x - 0.02 * z;
  const grid = carShadowGrid({ x: 10, z: 20 }, groundH);

  it("is laid over a square two units to a side, which the mesh's scale makes the patch", () => {
    expect(grid.scale.x).toBeCloseTo(1.6, 12);
    expect(grid.scale.y).toBe(1);
    expect(grid.scale.z).toBeCloseTo(3, 12);
    // Scaled unevenly, as the mist's banks are, and indexed in 16 bits, as they are.
    expect(grid.scale.x).not.toBe(grid.scale.z);
    expect(grid.indices).toBeInstanceOf(Uint16Array);
  });

  it("covers the patch in cells no more than half a metre to a side", () => {
    expect(CAR_SHADOW_STEP).toBe(0.5);
    // 3.2 m across in 7 cells and 6 m along in 12: 8 by 13 corners.
    expect(grid.positions).toHaveLength(312);
    expect(grid.uvs).toHaveLength(208);
    expect(grid.normals).toHaveLength(312);
    expect(grid.indices).toHaveLength(504);
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (let i = 0; i < grid.positions.length; i += 3) {
      xs.add(+(grid.positions[i]! * 1.6).toFixed(6));
      zs.add(+(grid.positions[i + 2]! * 3).toFixed(6));
    }
    expect([...xs].sort((a, b) => a - b)).toEqual([-1.6, -1.142857, -0.685714, -0.228571, 0.228571, 0.685714, 1.142857, 1.6]);
    expect([...zs].sort((a, b) => a - b)).toEqual([-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("is laid about the car's own place, which the mesh is then put at", () => {
    expect(grid.origin.x).toBe(10);
    expect(grid.origin.y).toBeCloseTo(2.7, 12);
    expect(grid.origin.z).toBe(20);
  });

  it("follows the ground, a centimetre above it at every corner", () => {
    expect(CAR_SHADOW_LIFT).toBe(0.01);
    for (let i = 0; i < grid.positions.length; i += 3) {
      const x = grid.positions[i]! * 1.6, y = grid.positions[i + 1]!, z = grid.positions[i + 2]! * 3;
      expect(grid.origin.y + y).toBeCloseTo(groundH(10 + x, 20 + z) + 0.01, 6);
    }
    // The first corner, 1.6 m down x and 3 m down z: the ground is 0.044 m higher there.
    expect(grid.positions[1]).toBeCloseTo(0.054, 6);
  });

  it("maps the texture across it once, edge to edge", () => {
    for (let k = 0; k < grid.uvs.length / 2; k++) {
      const x = grid.positions[k * 3]!, z = grid.positions[k * 3 + 2]!;
      expect(grid.uvs[k * 2]).toBeCloseTo((x + 1) / 2, 6);
      expect(grid.uvs[k * 2 + 1]).toBeCloseTo((z + 1) / 2, 6);
    }
  });

  it("faces up, and every triangle names corners of its own", () => {
    for (let i = 0; i < grid.normals.length; i += 3) {
      expect([grid.normals[i], grid.normals[i + 1], grid.normals[i + 2]]).toEqual([0, 1, 0]);
    }
    for (let i = 0; i < grid.indices.length; i += 3) {
      const tri = [grid.indices[i]!, grid.indices[i + 1]!, grid.indices[i + 2]!];
      expect(new Set(tri).size).toBe(3);
      for (const k of tri) expect(k).toBeLessThan(104);
    }
    // Every cell is covered: the triangles' areas on the ground add up to the patch's.
    let area = 0;
    for (let i = 0; i < grid.indices.length; i += 3) {
      const [a, b, c] = [grid.indices[i]!, grid.indices[i + 1]!, grid.indices[i + 2]!];
      const ax = grid.positions[a * 3]! * 1.6, az = grid.positions[a * 3 + 2]! * 3;
      const bx = grid.positions[b * 3]! * 1.6, bz = grid.positions[b * 3 + 2]! * 3;
      const cx = grid.positions[c * 3]! * 1.6, cz = grid.positions[c * 3 + 2]! * 3;
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(area).toBeCloseTo(19.2, 4);
  });
});
