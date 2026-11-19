import { describe, expect, it } from "vitest";
import { CORD_TUBE_RADIUS, CORD_TUBE_SIDES, createTubeGeometry, layTube } from "../../../src/game/scene/cordTubeGeometry.js";
import { babylonValues } from "../../helpers/babylonFixture.js";

describe("the cord's tube as geometry", () => {
  it("is a ring of seven vertices a point, six sides of two triangles between two rings", () => {
    const tube = createTubeGeometry(201);
    expect(tube.positions).toHaveLength(201 * 7 * 3);
    expect(tube.normals).toHaveLength(201 * 7 * 3);
    expect(tube.indices).toHaveLength(200 * 6 * 6);
    expect(Math.max(...tube.indices)).toBe(201 * 7 - 1);
    expect(CORD_TUBE_SIDES).toBe(6);
  });

  it("is the tube Babylon.js makes for the same path once it is laid again, vertex for vertex", () => {
    // Babylon.js makes its tube on the first lay and reshapes it on each one after: the reshaped tube is the one a
    // frame shows. What the stage on Babylon.js held (`createCordTube`, on Babylon.js's `CreateTube`) once it was
    // laid again along each of three paths, after a first lay along the first, is recorded, a path a file: the
    // path, the tube's positions and normals as the single-precision floats its mesh held, and with the first its
    // indices. The paths are the cord as the stage lays it (0.6 m, 20 coils of 6 mm, 201 points) between two pairs
    // of ends, one of them far from the origin, and a line straight up, whose first ring's frame is taken from
    // another axis.
    type Laid = { path: number[][]; positions: number[]; normals: number[]; indices?: number[] };
    const laid = [0, 1, 2].map((n) => babylonValues<Laid>(`numbers/cordTube.${n}.json`));
    const tube = createTubeGeometry(201);
    expect(Array.from(tube.indices)).toEqual(laid[0]?.indices);
    expect(laid[2]?.path[200]).toEqual([3, 200 * 0.003, 7]);
    for (const theirs of laid) {
      expect(theirs.path).toHaveLength(201);
      const path = theirs.path.map((p) => ({ x: p[0] as number, y: p[1] as number, z: p[2] as number }));
      layTube(path, CORD_TUBE_RADIUS, tube);
      const positions = new Float32Array(theirs.positions);
      const normals = new Float32Array(theirs.normals);
      expect(positions).toHaveLength(201 * 7 * 3);
      expect(tube.positions).toHaveLength(positions.length);
      let apart = 0;
      for (let i = 0; i < positions.length; i++) apart = Math.max(apart, Math.abs((tube.positions[i] as number) - (positions[i] as number)), Math.abs((tube.normals[i] as number) - (normals[i] as number)));
      expect(apart).toBe(0);
    }
  });

  it("writes into the arrays it was made with, and refuses a path of another length", () => {
    const tube = createTubeGeometry(11);
    const { positions, normals, indices } = tube;
    const line = (y: number) => Array.from({ length: 11 }, (_, i) => ({ x: i * 0.05, y, z: 0 }));
    layTube(line(1), CORD_TUBE_RADIUS, tube);
    const before = positions.slice();
    layTube(line(2), CORD_TUBE_RADIUS, tube);
    expect(tube.positions).toBe(positions);
    expect(tube.normals).toBe(normals);
    expect(tube.indices).toBe(indices);
    expect(positions[1]! - before[1]!).toBeCloseTo(1, 6);
    // A six-sided tube of 1.8 mm: its lowest corner is the radius times cos 30 degrees below the line.
    let lowest = Infinity;
    for (let i = 1; i < positions.length; i += 3) lowest = Math.min(lowest, positions[i] as number);
    expect(lowest).toBeCloseTo(1.998441, 6);
    // Every normal is a unit vector but the seam's two, which are the mean of two.
    for (let v = 0; v < normals.length; v += 3) {
      const length = Math.hypot(normals[v] as number, normals[v + 1] as number, normals[v + 2] as number);
      expect(length).toBeGreaterThan(0.85);
      expect(length).toBeLessThan(1.0001);
    }
    expect(() => layTube(line(1).slice(1), CORD_TUBE_RADIUS, tube)).toThrow(/11 rings laid along 10 points/);
  });
});
