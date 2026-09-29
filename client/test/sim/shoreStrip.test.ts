import { afterEach, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { registeredPasses } from "../../src/sim/chunk.js";
import {
  SHORE_STRIP_TUNABLES, STRIP_EDGE, STRIP_FADE, STRIP_FOREST_FLOOR, STRIP_HALF, STRIP_LIFT, STRIP_REACH,
  shoreHeight, shoreStrip, shoreStripAt,
} from "../../src/sim/shoreStrip.js";

const HOLLOW = 2032433950;
afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

describe("shoreStripAt", () => {
  it("is whole at the pad and 30 m along the road to either side, and gone 45 m along it", () => {
    expect(shoreStripAt(9, 0)).toBe(1);
    expect(shoreStripAt(9, 30)).toBe(1);
    expect(shoreStripAt(9, 37.5)).toBe(0.5);
    expect(shoreStripAt(9, 45)).toBe(0);
    expect(shoreStripAt(9, 200)).toBe(0);
  });

  it("is whole 100 m inland and gone 120 m inland", () => {
    expect(shoreStripAt(100, 0)).toBe(1);
    expect(shoreStripAt(110, 0)).toBe(0.5);
    expect(shoreStripAt(120, 0)).toBe(0);
  });

  it("is nothing at the road's centreline and seaward of it, and rises across the bed", () => {
    expect(shoreStripAt(0, 0)).toBe(0);
    expect(shoreStripAt(-1, 0)).toBe(0);
    expect(shoreStripAt(-40, 0)).toBe(0);
    expect(shoreStripAt(2.75, 0)).toBe(0.5);
    expect(shoreStripAt(5.5, 0)).toBe(1);
  });

  it("is the product of the two where both fade", () => {
    expect(shoreStripAt(60, 40)).toBeCloseTo(0.259259, 6);
    expect(shoreStripAt(105, 35)).toBeCloseTo(0.625, 9);
  });

  it("declares its constants", () => {
    expect([STRIP_HALF, STRIP_EDGE, STRIP_REACH, STRIP_FADE, STRIP_LIFT, STRIP_FOREST_FLOOR]).toEqual([30, 15, 100, 20, 9, 1]);
    expect(Object.keys(SHORE_STRIP_TUNABLES).sort()).toEqual(["STRIP_EDGE", "STRIP_FADE", "STRIP_FOREST_FLOOR", "STRIP_HALF", "STRIP_LIFT", "STRIP_REACH"]);
    const pass8 = registeredPasses().find((p) => p.id === 8)!;
    for (const [key, value] of Object.entries(SHORE_STRIP_TUNABLES)) expect(pass8.tunables[key], key).toBe(value);
  });
});

describe("shoreStrip on the world `hollow`", () => {
  it("is measured from the road's own centreline, wherever the road bends", () => {
    setActiveTerrainVariant("olympic");
    expect(shoreStrip(HOLLOW, -313.7267739768348, 0)).toBe(1);
    expect(shoreStrip(HOLLOW, -319.7267739768348, 0)).toBeCloseTo(0.567994, 6);
    expect(shoreStrip(HOLLOW, -305.66117205148345, 38)).toBeCloseTo(0.450074, 6);
    expect(shoreStrip(HOLLOW, -307.06319004698264, 60)).toBe(0);
    expect(shoreStrip(HOLLOW, -332.7267739768348, 0)).toBe(0);
  });

  it("is nothing on a world with no road", () => {
    setActiveTerrainVariant("montane");
    expect(shoreStrip(HOLLOW, 0, 0)).toBe(0);
    expect(shoreHeight(HOLLOW, 0, 0, 3)).toBe(3);
  });
});

describe("shoreHeight", () => {
  it("adds 9 m where the strip is whole, and hands back the height it was given where there is none", () => {
    setActiveTerrainVariant("olympic");
    expect(shoreHeight(HOLLOW, -313.7267739768348, 0, 3)).toBe(12);
    expect(shoreHeight(HOLLOW, -305.66117205148345, 38, 4)).toBeCloseTo(8.050667, 6);
    const h = 4.217712345;
    expect(shoreHeight(HOLLOW, -307.06319004698264, 60, h)).toBe(h);
  });
});
