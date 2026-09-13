import { describe, it, expect } from "vitest";
import { parseLevel, collisionBoxes } from "../../src/sim/level.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const valid = {
  id: "test01",
  brushes: [{ min: [-2, 0, -2], max: [2, 1, 2], material: "concrete" }],
  playerSpawns: [[0, 2, 0]],
  enemySpawns: [[5, 2, 5]],
};

describe("parseLevel", () => {
  it("converts array triples into Vec3", () => {
    const level = parseLevel(valid);
    expect(level.id).toBe("test01");
    expect(level.brushes[0]?.box.min).toEqual({ x: -2, y: 0, z: -2 });
    expect(level.brushes[0]?.box.max).toEqual({ x: 2, y: 1, z: 2 });
    expect(level.playerSpawns[0]).toEqual({ x: 0, y: 2, z: 0 });
    expect(level.enemySpawns[0]).toEqual({ x: 5, y: 2, z: 5 });
  });

  it("rejects a brush whose min exceeds its max", () => {
    const bad = { ...valid, brushes: [{ min: [2, 0, -2], max: [-2, 1, 2], material: "x" }] };
    expect(() => parseLevel(bad)).toThrow(/min .* max/i);
  });

  it("rejects a level with no player spawns", () => {
    expect(() => parseLevel({ ...valid, playerSpawns: [] })).toThrow(/playerSpawns/);
  });

  it("rejects a malformed coordinate triple", () => {
    const bad = { ...valid, playerSpawns: [[0, 2]] };
    expect(() => parseLevel(bad)).toThrow(/three numbers/);
  });

  it("rejects non-object input", () => {
    expect(() => parseLevel(null)).toThrow();
    expect(() => parseLevel("nope")).toThrow();
  });

  it("extracts collision boxes in stable order", () => {
    const level = parseLevel({
      ...valid,
      brushes: [
        { min: [0, 0, 0], max: [1, 1, 1], material: "a" },
        { min: [5, 0, 5], max: [6, 1, 6], material: "b" },
      ],
    });
    const boxes = collisionBoxes(level);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.min.x).toBe(0);
    expect(boxes[1]?.min.x).toBe(5);
  });
});

describe("sandbox01", () => {
  it("parses and has spawns for the full player count", () => {
    const level = parseLevel(sandbox01);
    expect(level.id).toBe("sandbox01");
    expect(level.playerSpawns.length).toBeGreaterThanOrEqual(5);
    expect(level.enemySpawns.length).toBeGreaterThan(0);
    expect(collisionBoxes(level).length).toBe(level.brushes.length);
  });
});
