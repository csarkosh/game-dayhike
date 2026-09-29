import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { surfaceWeights } from "../../src/game/terrainSurface.js";

const HOLLOW = 2032433950;
const shore = (x: number, z: number, altitude: number): number => {
  const w = surfaceWeights(HOLLOW, x, z, altitude, 0.05);
  return w.sand + w.pebble;
};

describe("the sand's paint at the trailhead", () => {
  it("is gone inland of the pad, on ground that was all sand", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-313.7267739768348, 0, 3.0155)).toBe(0);
    expect(shore(-302.7267739768348, 0, 3.5929)).toBe(0);
  });

  it("fades with the strip under the pavement and at its edge", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-319.7267739768348, 0, 3.0169)).toBeCloseTo(0.080491, 6);
    expect(shore(-305.66117205148345, 38, 4.2139)).toBeCloseTo(0.058539, 6);
  });

  it("is what it was outside the strip and on the beach", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-307.06319004698264, 60, 4.2177)).toBeCloseTo(0.994478, 6);
    expect(shore(-287.06319004698264, 60, 7.1664)).toBeCloseTo(0.304815, 6);
    expect(shore(-332.7267739768348, 0, 2.9873)).toBe(1);
  });
});
