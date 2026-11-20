import { describe, it, expect } from "vitest";
import {
  motesUnder, presenceAt, windAt, MOTE_CAPACITY, MOTE_DREAD_GAIN, MOTE_SPECIES, MOTE_WIND_DRIFT,
  MOTE_ALPHA, MOTE_BOX_HALF, MOTE_EMIT_BOX, MOTE_TEX_SIZE, moteCapacity, moteDiscMap, moteVelocities,
} from "@csarkosh/engine/game/motesParams";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";
import { windRecordUnder } from "@csarkosh/engine/game/windParams";

const AIR = { r: 0.5, g: 0.55, b: 0.6 };
const WIND0 = windRecordUnder(WEATHER_PRESETS.clear, 0);

describe("presenceAt", () => {
  it("is the pollen's and the frost's alone, at every hour: the midges live at the lake now", () => {
    expect(MOTE_SPECIES).toEqual(["pollen", "frost"]);
    for (const hour of [1, 5.5, 6, 12, 18, 18.3, 19, 22]) {
      expect(Object.keys(presenceAt(hour))).toEqual(["pollen", "frost"]);
    }
    expect(presenceAt(18.3)).toEqual({ pollen: 0, frost: 0.30446601315421495 });
  });
});

describe("motesUnder", () => {
  it("pollen by day, frost at night, no midges at dusk, and never both at once", () => {
    const noon = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", WIND0).species;
    expect(Object.keys(noon)).toEqual(["pollen", "frost"]);
    expect(noon.pollen.rate).toBe(175);
    expect(noon.frost.rate).toBe(0);
    const dusk = motesUnder(WEATHER_PRESETS.clear, 18.3, AIR, "high", WIND0).species;
    expect(Object.keys(dusk)).toEqual(["pollen", "frost"]);
    expect([dusk.pollen.rate, dusk.frost.rate]).toEqual([0, 53.281552301987624]);
    const night = motesUnder(WEATHER_PRESETS.clear, 1, AIR, "high", WIND0).species;
    expect(night.frost.rate).toBe(175);
    expect(night.pollen.rate).toBe(0);
    for (const hour of [6, 12, 18, 22]) {
      const s = motesUnder(WEATHER_PRESETS.clear, hour, AIR, "high", WIND0).species;
      expect([s.pollen.rate, s.frost.rate].filter((r) => r > 0).length).toBeLessThanOrEqual(1);
    }
  });

  it("rain zeroes every rate and dread raises them on the top plateau", () => {
    const rain = motesUnder(WEATHER_PRESETS.rain, 12, AIR, "high", WIND0).species;
    expect(rain.pollen.rate + rain.frost.rate).toBe(0);
    const clear = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", WIND0).species.pollen.rate;
    const eerie = motesUnder({ ...WEATHER_PRESETS.eerie, rain: 0 }, 12, AIR, "high", WIND0).species.pollen.rate;
    expect(eerie).toBeCloseTo(clear * (1 + MOTE_DREAD_GAIN), 10);
  });

  it("scales with the tier's capacity and is silent on low", () => {
    expect(MOTE_CAPACITY).toEqual({ low: 0, medium: 600, high: 1500 });
    const rate = (tier: "low" | "medium" | "high") => motesUnder(WEATHER_PRESETS.clear, 12, AIR, tier, WIND0).species.pollen.rate;
    // As before the midges left: 0.35 a second for every particle of the species' third of the capacity.
    expect([rate("low"), rate("medium"), rate("high")]).toEqual([0, 70, 175]);
  });

  it("carries the air colour it is handed", () => {
    const r = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", WIND0);
    expect(r.colour).toEqual(AIR);
  });

  it("drifts downwind with the gust and stands still at speed 0", () => {
    const still = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
    expect(windAt(still)).toEqual({ x: 0, z: 0 });
    const blowing = { ...windRecordUnder(WEATHER_PRESETS.rain, 7), dirX: 1, dirZ: 0 };
    const d = windAt(blowing);
    expect(d.z).toBe(0);
    expect(Math.abs(d.x)).toBeGreaterThan(0);
    expect(Math.abs(d.x)).toBeLessThanOrEqual(MOTE_WIND_DRIFT * (0.4 + 0.6) * 1.25 + 1e-9);
  });
});

describe("what the motes' systems are made with", () => {
  it("gives a species a third of the tier's capacity, and none on low", () => {
    expect(moteCapacity("low")).toBe(0);
    expect(moteCapacity("medium")).toBe(200);
    expect(moteCapacity("high")).toBe(500);
  });

  it("emits in a box round the camera, half as tall as it is wide", () => {
    expect(MOTE_BOX_HALF).toBe(10);
    expect(MOTE_EMIT_BOX.min).toEqual([-10, -5, -10]);
    expect(MOTE_EMIT_BOX.max).toEqual([10, 5, 10]);
  });

  it("bears a mote with the wind's drift and the species' rise, each way by its jitter, half of it up and down", () => {
    const wind = { ...windRecordUnder(WEATHER_PRESETS.clear, 0, 1), dirX: 1, dirZ: 0 };
    const r = motesUnder(WEATHER_PRESETS.clear, 12, { r: 0.5, g: 0.5, b: 0.5 }, "medium", wind);
    const born = moteVelocities(r, "pollen");
    expect(born.min).toEqual([r.drift.x - 0.15, 0.08 - 0.075, r.drift.z - 0.15]);
    expect(born.max).toEqual([r.drift.x + 0.15, 0.08 + 0.075, r.drift.z + 0.15]);
    const frost = moteVelocities(r, "frost");
    expect(frost.min[1]).toBeCloseTo(-0.25 - 0.05, 12);
    expect(frost.max[1]).toBeCloseTo(-0.25 + 0.05, 12);
  });

  it("draws a mote as a soft disc: opaque at its centre, clear at its rim, white throughout", () => {
    const map = moteDiscMap();
    expect(map.length).toBe(MOTE_TEX_SIZE * MOTE_TEX_SIZE * 4);
    const alpha = (x: number, y: number): number => map[(y * MOTE_TEX_SIZE + x) * 4 + 3] as number;
    expect(alpha(8, 8)).toBeGreaterThan(240);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(0, 8)).toBeLessThan(8);
    expect(alpha(4, 8)).toBe(alpha(11, 8));
    expect(map[0]).toBe(255);
    expect(MOTE_ALPHA).toBe(0.18);
  });
});
