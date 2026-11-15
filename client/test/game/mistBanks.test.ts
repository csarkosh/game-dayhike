import { describe, expect, it } from "vitest";
import {
  MIST_CAP_BY_TIER, MIST_DRIFT, MIST_EDGE_FADE_SPAN, MIST_NEAR_FADE_SPAN, MIST_NEAR_FADE_START, MIST_SHOWN_FLOOR, MIST_WRAP_FADE,
  createMistBanks, mistBankShown,
} from "../../src/game/mistBanks.js";
import { MIST_CELL, MIST_RADIUS, collectMistBanks } from "../../src/game/mistField.js";
import { WEATHER_PRESETS, mistOpacityUnder } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";
// Terrain variants register via import side effects (see mistField.test.ts);
// collectMistBanks needs one active before it can sample elevation.
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";

setActiveTerrainVariant("olympic");

const SEED = 1;
const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
const wrap = (v: number): number => ((v + MIST_CELL / 2) % MIST_CELL + MIST_CELL) % MIST_CELL - MIST_CELL / 2;

function coastalOrigin(): { x: number; z: number } {
  for (let x = -350; x <= -100; x += 50) {
    for (let z = -400; z <= 400; z += 100) {
      if (collectMistBanks(SEED, x, z).length > 0) return { x, z };
    }
  }
  throw new Error("no banks on the coastal strip");
}

describe("the mist banks as a frame draws them", () => {
  it("has a quad a bank of the tier's cap, none placed before a frame", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const banks = createMistBanks(SEED, tier);
      expect(banks.drawn.length).toBe(MIST_CAP_BY_TIER[tier]);
      expect(banks.drawn.some(mistBankShown)).toBe(false);
    }
  });

  it("draws nothing in a weather with no mist, and leaves its quads as they were", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    expect(banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0)).toBe(true);
    const before = banks.drawn.map((bank) => ({ ...bank }));
    expect(banks.update(x, z, WEATHER_PRESETS.clear, STILL, 0)).toBe(false);
    expect(banks.drawn).toEqual(before);
  });

  it("places the nearest banks first, each where its own phase of the drift carries it, at its size", () => {
    const banks = createMistBanks(SEED, "low");
    const { x, z } = coastalOrigin();
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    const placed = collectMistBanks(SEED, x, z);
    banks.drawn.forEach((quad, i) => {
      const bank = placed[i];
      expect(quad.placed).toBe(bank !== undefined);
      if (bank === undefined) return;
      // A bank's own phase stands it off its seeded place along the wind's direction, even at a speed of none.
      expect(quad.x).toBeCloseTo(bank.x + wrap(bank.hash * MIST_CELL) * STILL.dirX, 9);
      expect(quad.z).toBeCloseTo(bank.z + wrap(bank.hash * MIST_CELL) * STILL.dirZ, 9);
      expect([quad.y, quad.width, quad.height]).toEqual([bank.y, bank.width, bank.height]);
    });
  });

  it("fades a bank by the weather's opacity, the near ring, the rim of the radius and its own wrap boundary", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    const wind = { ...windRecordUnder(WEATHER_PRESETS.mist, 0, 1), dirX: 1, dirZ: 0 };
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 0);
    const opacity = mistOpacityUnder(WEATHER_PRESETS.mist);
    const placed = collectMistBanks(SEED, x, z);
    let some = 0;
    banks.drawn.forEach((quad, i) => {
      const bank = placed[i];
      if (bank === undefined) return;
      const offset = wrap(bank.hash * MIST_CELL);
      const d = Math.hypot(quad.x - x, quad.z - z);
      const near = Math.min(1, Math.max(0, (d - MIST_NEAR_FADE_START) / MIST_NEAR_FADE_SPAN));
      const edge = Math.min(1, Math.max(0, (MIST_RADIUS - d) / MIST_EDGE_FADE_SPAN));
      const t = Math.min(1, Math.max(0, (Math.abs(offset) - (MIST_CELL / 2 - MIST_WRAP_FADE)) / MIST_WRAP_FADE));
      expect(quad.visibility).toBeCloseTo(opacity * near * edge * (1 - t * t * (3 - 2 * t)), 12);
      expect(mistBankShown(quad)).toBe(quad.visibility > MIST_SHOWN_FLOOR);
      if (mistBankShown(quad)) some++;
    });
    expect(some).toBeGreaterThan(0);
  });

  it("integrates the drift from the clock, a second of wind a step at most", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    const wind = { ...windRecordUnder(WEATHER_PRESETS.mist, 0, 1), dirX: 1, dirZ: 0 };
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 0);
    const at = banks.drawn.map((quad) => quad.x);
    // The clock is stepped in a weather with no mist too.
    banks.update(x, z, WEATHER_PRESETS.clear, wind, 0.5);
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 1);
    banks.drawn.forEach((quad, i) => {
      if (quad.placed) expect(wrap(quad.x - (at[i] as number))).toBeCloseTo(MIST_DRIFT * wind.speed, 9);
    });
    // A minute's gap carries a second of it, and a clock that has not moved carries nothing.
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 61);
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 61);
    banks.drawn.forEach((quad, i) => {
      if (quad.placed) expect(wrap(quad.x - (at[i] as number))).toBeCloseTo(2 * MIST_DRIFT * wind.speed, 9);
    });
  });

  it("collects again when the camera crosses a cell, and when the mist returns", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    const here = banks.drawn.filter((quad) => quad.placed).map((quad) => [quad.x, quad.z]);
    banks.update(x + 3 * MIST_CELL, z, WEATHER_PRESETS.mist, STILL, 0);
    const there = collectMistBanks(SEED, x + 3 * MIST_CELL, z);
    banks.drawn.forEach((quad, i) => {
      expect(quad.placed).toBe(there[i] !== undefined);
      if (there[i] !== undefined) expect(quad.y).toBe(there[i]?.y);
    });
    banks.update(x + 3 * MIST_CELL, z, WEATHER_PRESETS.clear, STILL, 0);
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    expect(banks.drawn.filter((quad) => quad.placed).map((quad) => [quad.x, quad.z])).toEqual(here);
  });
});
