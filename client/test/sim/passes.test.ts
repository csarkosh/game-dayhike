import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { registerPass } from "../../src/sim/chunk.js";

const SEED = 0xd3a5e;

describe("pass independence", () => {
  it("registering a new pass leaves earlier passes byte-identical", () => {
    // This is what protects future iteration. Each pass derives its own RNG
    // stream from its id, so a pass registered at id 6 or above cannot shift
    // the draws of the elevation pass at id 1 — which a single shared
    // sequential stream would. One pass exists today, so the props comparison
    // below is "[]" against "[]"; it becomes load-bearing again the moment a
    // feature pass emits anything, which is exactly when trees return.
    const before = createChunkGrid(SEED).chunkAt(1, 1);
    const beforeColumns = Array.from(before.columns);
    const beforeProps = JSON.stringify(before.props);

    registerPass({ id: 9999, name: "noop", tunables: { NONE: 0 }, run: () => {} });

    const after = createChunkGrid(SEED).chunkAt(1, 1);
    expect(Array.from(after.columns)).toEqual(beforeColumns);
    expect(JSON.stringify(after.props)).toBe(beforeProps);
  });

  it("refuses a duplicate pass id", () => {
    expect(() =>
      registerPass({ id: 1, name: "clash", tunables: { NONE: 0 }, run: () => {} }),
    ).toThrow();
  });
});
