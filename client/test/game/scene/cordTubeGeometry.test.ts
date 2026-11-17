import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Scene } from "@babylonjs/core/scene.js";
import { coiledCord } from "../../../src/game/scene/cord.js";
import { createCordTube } from "../../../src/game/scene/cordTube.js";
import { CORD_TUBE_RADIUS, CORD_TUBE_SIDES, createTubeGeometry, layTube } from "../../../src/game/scene/cordTubeGeometry.js";

/** The cord as the stage lays it: 0.6 m, 20 coils of 6 mm, 201 points. */
const CORD = { length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 };

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
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const drawn = createCordTube(scene);
    const paths = [
      coiledCord({ x: 10.2, y: 31.1, z: -4.9 }, { x: 10.5, y: 31.3, z: -5.1 }, CORD),
      coiledCord({ x: -220.4, y: 12.7, z: 618.2 }, { x: -220.35, y: 12.74, z: 618.21 }, CORD),
      // Straight up: the first ring's frame is taken from another axis.
      Array.from({ length: 201 }, (_, i) => ({ x: 3, y: i * 0.003, z: 7 })),
    ];
    // Babylon.js makes its tube on the first lay and reshapes it on each one after: the reshaped tube is the one a frame shows.
    drawn.lay(paths[0]!);
    const mesh = scene.getMeshByName("film_cord")!;
    const tube = createTubeGeometry(201);
    expect(Array.from(tube.indices)).toEqual(Array.from(mesh.getIndices()!));
    for (const path of paths) {
      drawn.lay(path);
      layTube(path, CORD_TUBE_RADIUS, tube);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      expect(tube.positions).toHaveLength(positions.length);
      let apart = 0;
      for (let i = 0; i < positions.length; i++) apart = Math.max(apart, Math.abs((tube.positions[i] as number) - (positions[i] as number)), Math.abs((tube.normals[i] as number) - (normals[i] as number)));
      expect(apart).toBe(0);
    }
    drawn.dispose();
    engine.dispose();
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
