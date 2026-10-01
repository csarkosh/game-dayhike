import { describe, expect, it } from "vitest";
import { coiledCord } from "../../../src/game/scene/cord.js";

const opts = { length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 };
const dist = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

describe("a coiled cord between two plugs", () => {
  it("starts at one plug and ends at the other", () => {
    const a = { x: 0, y: 0.7, z: 0.3 }, b = { x: -0.4, y: 1.1, z: 0.2 };
    const path = coiledCord(a, b, opts);
    expect(path).toHaveLength(201);
    expect(dist(path[0]!, a)).toBeLessThan(1e-9);
    expect(dist(path[200]!, b)).toBeLessThan(1e-9);
  });

  it("winds within its coil's radius of the line between them when it is taut", () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0.6, y: 0, z: 0 };
    for (const p of coiledCord(a, b, opts)) expect(Math.hypot(p.y, p.z)).toBeLessThanOrEqual(0.006 + 1e-9);
  });

  it("sags below the line between them when slack, by no more than its most", () => {
    const a = { x: 0, y: 1, z: 0 }, b = { x: 0.1, y: 1, z: 0 };
    const path = coiledCord(a, b, opts);
    const lowest = Math.min(...path.map((p) => p.y));
    // Slack of 0.5 m would hang 0.25 m; the coil holds it to 0.04 m, and the coil winds 0.006 m about that.
    expect(lowest).toBeCloseTo(1 - 0.04 - 0.006, 2);
  });

  it("winds its turns round the line", () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0.6, y: 0, z: 0 };
    const path = coiledCord(a, b, opts);
    // The coil's angle about the line, unwrapped, over the middle of the cord where it is full width.
    let turns = 0;
    for (let i = 21; i < 180; i += 1) {
      const d = Math.atan2(path[i + 1]!.z, path[i + 1]!.y) - Math.atan2(path[i]!.z, path[i]!.y);
      turns += Math.atan2(Math.sin(d), Math.cos(d)) / (2 * Math.PI);
    }
    expect(Math.abs(turns)).toBeCloseTo(20 * (159 / 200), 1);
  });
});
