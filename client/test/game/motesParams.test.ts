import { describe, it, expect } from "vitest";
import { motesUnder, windAt, MOTE_CAPACITY, MOTE_DREAD_GAIN } from "../../src/game/motesParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

const AIR = { r: 0.5, g: 0.55, b: 0.6 };

describe("motesUnder", () => {
  it("pollen by day, midges at dusk, frost at night, and never all three at once", () => {
    const noon = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species;
    expect(noon.pollen.rate).toBeGreaterThan(0);
    expect(noon.frost.rate).toBe(0);
    const dusk = motesUnder(WEATHER_PRESETS.clear, 18.3, AIR, "high", 0).species;
    expect(dusk.midge.rate).toBeGreaterThan(0);
    const night = motesUnder(WEATHER_PRESETS.clear, 1, AIR, "high", 0).species;
    expect(night.frost.rate).toBeGreaterThan(0);
    expect(night.pollen.rate).toBe(0);
    for (const hour of [6, 12, 18, 22]) {
      const s = motesUnder(WEATHER_PRESETS.clear, hour, AIR, "high", 0).species;
      expect([s.pollen.rate, s.midge.rate, s.frost.rate].filter((r) => r > 0).length).toBeLessThanOrEqual(2);
    }
  });

  it("rain zeroes every rate and dread raises them on the top plateau", () => {
    const rain = motesUnder(WEATHER_PRESETS.rain, 12, AIR, "high", 0).species;
    expect(rain.pollen.rate + rain.midge.rate + rain.frost.rate).toBe(0);
    const clear = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species.pollen.rate;
    const eerie = motesUnder({ ...WEATHER_PRESETS.eerie, rain: 0 }, 12, AIR, "high", 0).species.pollen.rate;
    expect(eerie).toBeCloseTo(clear * (1 + MOTE_DREAD_GAIN), 10);
  });

  it("scales with the tier's capacity and is silent on low", () => {
    expect(MOTE_CAPACITY.low).toBe(0);
    const high = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species.pollen.rate;
    const medium = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "medium", 0).species.pollen.rate;
    expect(high).toBeCloseTo(medium * (MOTE_CAPACITY.high / MOTE_CAPACITY.medium), 10);
  });

  it("carries the air colour and a wind drift that varies with time", () => {
    const r = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 5);
    expect(r.colour).toEqual(AIR);
    expect(windAt(0)).not.toEqual(windAt(3));
  });
});
