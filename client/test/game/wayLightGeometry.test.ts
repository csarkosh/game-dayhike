import { describe, expect, it } from "vitest";
import {
  WAY_CHUNK_M, WAY_FLOOR_CORE_M, WAY_FLOOR_EDGE_M, WAY_FLOOR_REACH, WAY_FLOOR_STRENGTH, WAY_LIFT_M, WAY_POINT_VERTICES, WAY_TINT,
  WAY_WALL_FOOT_M, WAY_WALL_RADIUS_M, WAY_WALL_REACH, WAY_WALL_STEPS, WAY_WALL_STRENGTH,
  floorProfile, wallProfile, wayChunk, wayChunks, type WayShape,
} from "../../src/game/wayLightGeometry.js";

/** A straight way along +x, a point every 2 m, `n` points. */
function straight(n: number): WayShape {
  const xs = new Float32Array(n), zs = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i * 2; cum[i] = i * 2; }
  return { xs, zs, cum, length: (n - 1) * 2 };
}
const flat = (): number => 10;

describe("the half pipe's shape", () => {
  it("is the approved look's numbers", () => {
    expect([WAY_WALL_FOOT_M, WAY_WALL_RADIUS_M, WAY_WALL_STEPS, WAY_FLOOR_CORE_M, WAY_FLOOR_EDGE_M, WAY_CHUNK_M, WAY_LIFT_M]).toEqual([2, 3.5, 10, 1.5, 4, 64, 0.08]);
    expect([WAY_FLOOR_STRENGTH, WAY_WALL_STRENGTH, WAY_FLOOR_REACH, WAY_WALL_REACH]).toEqual([0.06, 0.3, 0.012, 0.016]);
    expect(WAY_TINT).toEqual([0.62, 0.7, 0.86]);
    expect(WAY_POINT_VERTICES).toBe(9 + 2 * (WAY_WALL_STEPS + 1));
  });

  it("the wall is dark at its foot and its rim and brightest between", () => {
    expect(wallProfile(0)).toBe(0);
    expect(wallProfile(1)).toBe(0);
    expect(wallProfile(0.1)).toBeLessThan(0.05);
    expect(wallProfile(0.45)).toBeGreaterThan(0.3);
    // It gathers light as it climbs: brighter at 0.4 than at 0.2, and fading by 0.9.
    expect(wallProfile(0.4)).toBeGreaterThan(wallProfile(0.2) * 2);
    expect(wallProfile(0.9)).toBeLessThan(wallProfile(0.6));
  });

  it("the floor is whole on the line and gone at its edge", () => {
    expect(floorProfile(0)).toBe(1);
    expect(floorProfile(1.5)).toBe(1);
    expect(floorProfile(-1.5)).toBe(1);
    expect(floorProfile(2.75)).toBeCloseTo(0.5, 6);
    expect(floorProfile(4)).toBe(0);
    expect(floorProfile(-9)).toBe(0);
  });
});

describe("a chunk of the half pipe", () => {
  const way = straight(40);
  const c = wayChunk(way, flat, 0, 10);

  it("has 31 vertices a point: 9 of floor and 11 a wall", () => {
    expect(c.positions.length).toBe(11 * 31 * 3);
    expect(c.light.length).toBe(11 * 31 * 2);
    // Between two points: 8 floor quads and 10 a wall, two triangles each.
    expect(c.indices.length).toBe(10 * (8 + 2 * 10) * 6);
  });

  it("the floor lies 4 m either side of the line, a hair over the ground, lit by its profile", () => {
    // Point 3 (x = 6): its nine floor vertices come first, lateral -4 to 4.
    for (let k = 0; k < 9; k++) {
      const v = 3 * 31 + k;
      expect(c.positions[v * 3]).toBeCloseTo(6, 5);
      expect(c.positions[v * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M, 5);
      expect(Math.abs(c.positions[v * 3 + 2]!)).toBeCloseTo(Math.abs(k - 4), 5);
      expect(c.light[v * 2]).toBeCloseTo(floorProfile(k - 4), 6);
      expect(c.light[v * 2 + 1]).toBe(0);
    }
  });

  it("a wall begins 2 m from the line at the ground, and its rim stands 5.5 m out and 3.5 m up", () => {
    for (const wall of [0, 1]) {
      const foot = 3 * 31 + 9 + wall * 11, rim = foot + 10;
      expect(Math.abs(c.positions[foot * 3 + 2]!)).toBeCloseTo(WAY_WALL_FOOT_M, 5);
      expect(c.positions[foot * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M, 5);
      expect(Math.abs(c.positions[rim * 3 + 2]!)).toBeCloseTo(WAY_WALL_FOOT_M + WAY_WALL_RADIUS_M, 5);
      expect(c.positions[rim * 3 + 1]).toBeCloseTo(10 + WAY_LIFT_M + WAY_WALL_RADIUS_M, 5);
      expect(c.light[foot * 2]).toBe(0);
      expect(c.light[foot * 2 + 1]).toBe(1);
      expect(c.light[(foot + 5) * 2]).toBeCloseTo(wallProfile(0.5), 6);
    }
    // One wall each side.
    expect(Math.sign(c.positions[(3 * 31 + 19) * 3 + 2]!)).toBe(-Math.sign(c.positions[(3 * 31 + 30) * 3 + 2]!));
  });

  it("every vertex stands on the ground under it", () => {
    const sloped = (x: number, z: number): number => 0.1 * x + 0.3 * z;
    const s = wayChunk(way, sloped, 5, 8);
    for (let v = 0; v < s.positions.length / 3; v++) {
      const x = s.positions[v * 3]!, y = s.positions[v * 3 + 1]!, z = s.positions[v * 3 + 2]!;
      const kind = s.light[v * 2 + 1]!;
      const up = y - sloped(x, z) - WAY_LIFT_M;
      if (kind === 0) expect(up).toBeCloseTo(0, 4);
      else { expect(up).toBeGreaterThan(-1e-4); expect(up).toBeLessThanOrEqual(WAY_WALL_RADIUS_M + 1e-4); }
    }
  });

  it("every index is inside the chunk and no triangle is degenerate", () => {
    const count = c.positions.length / 3;
    for (let t = 0; t < c.indices.length; t += 3) {
      const [a, b, d] = [c.indices[t]!, c.indices[t + 1]!, c.indices[t + 2]!];
      expect(Math.max(a, b, d)).toBeLessThan(count);
      expect(new Set([a, b, d]).size).toBe(3);
    }
  });

  it("follows a bend: the floor's edge stays 4 m from the line", () => {
    const xs = new Float32Array(20), zs = new Float32Array(20), cum = new Float32Array(20);
    for (let i = 0; i < 20; i++) { xs[i] = i < 10 ? i * 2 : 18; zs[i] = i < 10 ? 0 : (i - 9) * 2; cum[i] = i * 2; }
    const bent = wayChunk({ xs, zs, cum, length: 38 }, flat, 0, 19);
    // The last point's direction is +z, so its floor spans x.
    const v = 19 * 31;
    expect(Math.abs(bent.positions[v * 3]! - 18)).toBeCloseTo(4, 4);
    expect(bent.positions[v * 3 + 2]).toBeCloseTo(20, 4);
  });

  it("splits a way into chunks of 64 m that share their end points", () => {
    expect(wayChunks(straight(40))).toEqual([[0, 32], [32, 39]]);
    expect(wayChunks(straight(33))).toEqual([[0, 32]]);
    expect(wayChunks(straight(2))).toEqual([[0, 1]]);
    expect(wayChunks(straight(1))).toEqual([]);
  });
});
