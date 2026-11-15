import { describe, expect, it } from "vitest";
import { MATRIX_BYTES, listBytes, sentInstances } from "../../../src/game/lite/listMeshes.js";

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

  it("says what a showing hands over: a matrix an instance shown, and the view of the plugin data Lite sends", () => {
    expect(MATRIX_BYTES).toBe(64);
    // No plugin data: the matrices alone.
    expect(listBytes(100, 4096, 0)).toBe(100 * 64);
    // Four floats an instance, sent for the 128 the view rounds 100 up to.
    expect(listBytes(100, 4096, 4)).toBe(100 * 64 + 128 * 4 * 4);
    // A bucket shown nothing still sends its smallest view when its draw is recorded.
    expect(listBytes(0, 4096, 4)).toBe(16 * 4 * 4);
    // The view never passes the list's own arrays.
    expect(listBytes(3000, 3200, 8)).toBe(3000 * 64 + 3200 * 8 * 4);
  });
});
