import { describe, expect, it } from "vitest";
import { seedPart } from "./seedPart.js";

describe("a sweep's seeds in parts", () => {
  it("deals the list out in turn, so the parts together are the list, each seed once", () => {
    const seeds = Array.from({ length: 227 }, (_, i) => i * 7);
    const parts = [1, 2, 3].map((k) => seedPart(seeds, k, 3));
    expect(parts.map((p) => p.length)).toEqual([76, 76, 75]);
    expect(parts[0]!.slice(0, 3)).toEqual([0, 21, 42]);
    expect(parts.flat().sort((a, b) => a - b)).toEqual(seeds);
    expect(seedPart(seeds, 1, 1)).toEqual(seeds);
  });

  it("refuses a part the split does not have", () => {
    expect(() => seedPart([1, 2], 0, 2)).toThrow("no part 0 of 2");
    expect(() => seedPart([1, 2], 3, 2)).toThrow("no part 3 of 2");
    expect(() => seedPart([1, 2], 1.5, 2)).toThrow();
  });
});
