import { describe, expect, it } from "vitest";
import { sentInstances } from "../../../src/game/lite/listMeshes.js";

describe("a ground-cover bucket on Babylon Lite", () => {
  it("sends its plugin data for the instances shown rounded up to a power of two, within what the list holds", () => {
    expect(sentInstances(0, 64)).toBe(16);
    expect(sentInstances(16, 64)).toBe(16);
    expect(sentInstances(17, 64)).toBe(32);
    expect(sentInstances(33, 64)).toBe(64);
    expect(sentInstances(1000, 4096)).toBe(1024);
    // Never past the list's own arrays, and never more than twice what is drawn past the floor.
    expect(sentInstances(3000, 4096)).toBe(4096);
    expect(sentInstances(5, 8)).toBe(8);
    for (const count of [17, 100, 513, 2049]) expect(sentInstances(count, 1 << 20)).toBeLessThan(count * 2);
  });
});
