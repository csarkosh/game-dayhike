import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  collectMistBanks, MIST_ALT_MAX, MIST_ALT_MIN, MIST_CAP, MIST_RADIUS,
  MIST_SLOPE_MAX, MIST_TEX_SIZE, mistAlphaMap,
} from "../../src/game/mistField.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";

const SEED = 1;
setActiveTerrainVariant("olympic");

/** Somewhere on the coastal strip: low, flat, guaranteed candidates nearby. */
function coastalOrigin(): { x: number; z: number } {
  for (let x = -350; x <= -100; x += 50) {
    for (let z = -400; z <= 400; z += 100) {
      if (collectMistBanks(SEED, x, z).length > 0) return { x, z };
    }
  }
  throw new Error("no mist banks anywhere on the coastal strip — placement is broken");
}

describe("collectMistBanks", () => {
  it("is deterministic", () => {
    const { x, z } = coastalOrigin();
    expect(collectMistBanks(SEED, x, z)).toEqual(collectMistBanks(SEED, x, z));
  });

  it("respects the cap and sorts ascending by distance", () => {
    const { x, z } = coastalOrigin();
    const banks = collectMistBanks(SEED, x, z);
    expect(banks.length).toBeGreaterThan(0);
    expect(banks.length).toBeLessThanOrEqual(MIST_CAP);
    let prev = -1;
    for (const b of banks) {
      const d2 = (b.x - x) ** 2 + (b.z - z) ** 2;
      expect(d2).toBeGreaterThanOrEqual(prev);
      expect(d2).toBeLessThanOrEqual(MIST_RADIUS * MIST_RADIUS);
      prev = d2;
    }
  });

  it("only places banks on low, gentle ground", () => {
    const { x, z } = coastalOrigin();
    for (const b of collectMistBanks(SEED, x, z)) {
      const g = elevationSampleAt(SEED, b.x, b.z);
      expect(g.h).toBeGreaterThanOrEqual(MIST_ALT_MIN);
      expect(g.h).toBeLessThanOrEqual(MIST_ALT_MAX);
      expect(g.dx * g.dx + g.dz * g.dz).toBeLessThanOrEqual(MIST_SLOPE_MAX * MIST_SLOPE_MAX);
      expect(b.y).toBeGreaterThan(g.h); // the quad straddles the air above ground
    }
  });
});

describe("mistAlphaMap", () => {
  it("is opaque white at the centre and transparent at the corners", () => {
    const size = MIST_TEX_SIZE;
    const data = mistAlphaMap(size);
    expect(data.length).toBe(size * size * 4);
    const centre = ((size / 2) * size + size / 2) * 4;
    expect(data[centre + 3]).toBeGreaterThan(200);
    expect(data[3]).toBe(0); // corner alpha
    expect(data[0]).toBe(255); // RGB stays white so only alpha shapes the sprite
  });
});
