import { describe, expect, it } from "vitest";
import { MATRIX_BYTES, listBytes } from "../../../src/game/lite/listMeshes.js";

describe("a ground-cover bucket on Babylon Lite", () => {
  it("says what a showing hands over: a matrix and the plugin data of each instance shown", () => {
    expect(MATRIX_BYTES).toBe(64);
    // No plugin data: the matrices alone.
    expect(listBytes(100, 0)).toBe(100 * 64);
    // Four floats an instance, sent for the hundred shown and no more.
    expect(listBytes(100, 4)).toBe(100 * 64 + 100 * 4 * 4);
    // A bucket shown nothing sends nothing.
    expect(listBytes(0, 4)).toBe(0);
    expect(listBytes(3000, 8)).toBe(3000 * (64 + 8 * 4));
  });
});
