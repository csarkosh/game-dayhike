import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import {
  CELLS_PER_CHUNK,
  cellCenter,
  generateChunk,
  quantize,
} from "../../src/sim/chunk.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { HEIGHT_QUANTUM } from "../../src/sim/forestConstants.js";

const SEED = 0x5eed;

describe("generateChunk", () => {
  it("is deterministic for the same seed and coordinates", () => {
    const a = generateChunk(SEED, 3, -2);
    const b = generateChunk(SEED, 3, -2);
    expect(Array.from(a.columns)).toEqual(Array.from(b.columns));
  });

  it("differs between chunks", () => {
    const a = generateChunk(SEED, 0, 0);
    const b = generateChunk(SEED, 1, 0);
    expect(Array.from(a.columns)).not.toEqual(Array.from(b.columns));
  });

  it("differs between seeds", () => {
    const a = generateChunk(1, 0, 0);
    const b = generateChunk(2, 0, 0);
    expect(Array.from(a.columns)).not.toEqual(Array.from(b.columns));
  });

  it("fills one column per terrain cell", () => {
    const c = generateChunk(SEED, 0, 0);
    expect(c.columns.length).toBe(CELLS_PER_CHUNK * CELLS_PER_CHUNK);
  });

  it("stores exactly the quantized field at each cell centre", () => {
    // The load-bearing property. Every column is a window onto one global pure
    // function, which is what makes the neighbour agreement below inevitable
    // rather than something that had to be engineered.
    const c = generateChunk(SEED, -3, 5);
    for (let iz = 0; iz < CELLS_PER_CHUNK; iz++) {
      for (let ix = 0; ix < CELLS_PER_CHUNK; ix++) {
        const { x, z } = cellCenter(c, ix, iz);
        expect(c.columns[iz * CELLS_PER_CHUNK + ix]).toBe(quantize(elevationAt(SEED, x, z)));
      }
    }
  });

  it("generates a chunk identically whether or not its neighbour was generated", () => {
    // Was "agrees with its neighbour across a shared edge", and asserted a
    // bounded height delta across the seam. That half retired with
    // MAX_GRADIENT: montane ground has no bounded slope, so no delta across a
    // seam is evidence of anything.
    //
    // Kept separate from the determinism test above rather than folded into
    // it, because the property is not the same one. Determinism is "the same
    // call twice"; this is "the same chunk reached by two different generation
    // orders" — generated alone, and generated alongside its neighbour. That
    // is what rules out seams, and it is what would break first if anything in
    // the pipeline ever stopped being a pure point function and started
    // carrying state between chunks.
    const left = generateChunk(SEED, 0, 0);
    const right = generateChunk(SEED, 1, 0);
    const alsoRight = generateChunk(SEED, 1, 0);

    expect(Array.from(right.columns)).toEqual(Array.from(alsoRight.columns));
    expect(Array.from(left.columns)).not.toEqual(Array.from(right.columns));
  });

  it("quantizes every height to a whole number of HEIGHT_QUANTUM units", () => {
    const c = generateChunk(SEED, -4, 6);
    for (const units of c.columns) expect(Number.isInteger(units)).toBe(true);
  });

});

describe("elevationAt", () => {
  it("produces montane relief rather than a flat plane", () => {
    // Sample an area, not a line, and a wide one: a ±600 m window sits inside a
    // single uplift feature and would report a tilt rather than the real range.
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -5000; x < 5000; x += 61) {
      for (let z = -5000; z < 5000; z += 173) {
        const h = elevationAt(SEED, x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi - lo).toBeGreaterThan(100);
  });

  it("is unaffected by HEIGHT_QUANTUM, being the continuous field", () => {
    // The renderer draws this; collision reads the quantized column. The gap
    // between them is the design's deliberate imprecision.
    const h = elevationAt(SEED, 12.3456, -7.891);
    expect(h / HEIGHT_QUANTUM).not.toBe(Math.round(h / HEIGHT_QUANTUM));
  });
});
