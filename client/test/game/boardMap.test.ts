import { describe, expect, it } from "vitest";
import { MAP_MARGIN, MAP_RINGS, boardMap, type MapInput } from "../../src/game/boardMap.js";

/** A stem 0 → 1 → 2 straight inland, a loop 1 → 3 → 4 → 2 off to +z, a pond in the loop, the road 9 m behind the pad. */
const world: MapInput = {
  nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }, { x: 120, z: 50 }, { x: 180, z: 50 }],
  edges: [
    { a: 0, b: 1, kind: "stem" }, { a: 1, b: 2, kind: "stem" },
    { a: 1, b: 3, kind: "loop" }, { a: 3, b: 4, kind: "loop" }, { a: 4, b: 2, kind: "loop" },
  ],
  road: [-100, -50, 0, 50, 100, 150].map((z) => ({ x: -9, z })),
  features: [{ kind: "peak", x: 200, z: 0, radius: 50 }, { kind: "pond", x: 150, z: 60, radius: 20 }],
  places: [{ name: "Summit", x: 200, z: 0 }, { name: "Old Lake", x: 150, z: 60 }],
  summitName: "Summit",
};
const inner = { x: 100, y: 200, width: 640, height: 480 };

describe("boardMap", () => {
  it("fits the trails inside the sheet with their proportions kept, 60 m of ground round them", () => {
    expect(MAP_MARGIN).toBe(60);
    const m = boardMap(world, inner);
    // 320 m of inland and 170 m along the road into 480 by 640: the height decides.
    expect(m.scale).toBe(1.5);
    for (const l of [...m.stem, ...m.side]) {
      for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y1]] as const) {
        expect(x).toBeGreaterThanOrEqual(100);
        expect(x).toBeLessThanOrEqual(740);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(y).toBeLessThanOrEqual(680);
      }
    }
  });

  it("draws inland up the sheet, and +z to the left", () => {
    const m = boardMap(world, inner);
    expect(m.here).toEqual({ x: 457.5, y: 590 });
    expect(m.summit).toEqual({ x: 457.5, y: 290 });
    // The loop lies toward +z: left of the stem.
    expect(m.side[0]).toEqual({ x0: 457.5, y0: 440, x1: 382.5, y1: 410 });
  });

  it("keeps the stem apart from the trails that leave it", () => {
    const m = boardMap(world, inner);
    expect(m.stem).toEqual([
      { x0: 457.5, y0: 590, x1: 457.5, y1: 440 },
      { x0: 457.5, y0: 440, x1: 457.5, y1: 290 },
    ]);
    expect(m.side).toHaveLength(3);
  });

  it("draws the road where the sheet shows it, the pond, the peak's rings and every name", () => {
    const m = boardMap(world, inner);
    expect(m.road).toEqual([{ x: 532.5, y: 603.5 }, { x: 457.5, y: 603.5 }, { x: 382.5, y: 603.5 }, { x: 307.5, y: 603.5 }]);
    expect(m.ponds).toEqual([{ x: 367.5, y: 365, rx: 30, ry: 30 }]);
    expect(MAP_RINGS).toBe(5);
    expect(m.rings.map((r) => r.rx)).toEqual([15, 30, 45, 60, 75]);
    expect(m.labels).toEqual([{ text: "Summit", x: 457.5, y: 290 }, { text: "Old Lake", x: 367.5, y: 365 }]);
  });

  it("has no summit mark where no place goes by the summit's name", () => {
    expect(boardMap({ ...world, summitName: "Crest" }, inner).summit).toBeNull();
  });

  it("fits a graph of one node", () => {
    const m = boardMap({ nodes: [{ x: 5, z: 5 }], edges: [], road: [], features: [], places: [], summitName: "Summit" }, inner);
    // 120 m each way into 640 by 480.
    expect(m.scale).toBe(4);
    expect(m.here).toEqual({ x: 420, y: 440 });
    expect(m.stem).toEqual([]);
  });

  it("passes over an edge that names a node the graph does not have", () => {
    const m = boardMap({ ...world, edges: [...world.edges, { a: 0, b: 99, kind: "stem" }] }, inner);
    expect(m.stem).toHaveLength(2);
  });
});
