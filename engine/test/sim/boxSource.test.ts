import { describe, it, expect } from "vitest";
import { boxesNear, type BoxSource } from "../../src/sim/boxSource.js";
import type { Aabb } from "../../src/sim/level.js";

const box = (x: number): Aabb => ({ min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 1, z: 1 } });

describe("boxesNear", () => {
  it("returns a plain array provider verbatim, ignoring the region", () => {
    const boxes = [box(0), box(10)];
    const out = boxesNear(boxes, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(out).toEqual(boxes);
  });

  it("delegates to a BoxSource and forwards the region", () => {
    const seen: Array<[number, number]> = [];
    const src: BoxSource = {
      near(min, max) {
        seen.push([min.x, max.x]);
        return [box(5)];
      },
    };
    const out = boxesNear(src, { x: 2, y: 0, z: 0 }, { x: 7, y: 1, z: 1 });
    expect(out).toEqual([box(5)]);
    expect(seen).toEqual([[2, 7]]);
  });
});
