import { describe, it, expect } from "vitest";
import {
  WIND_TIME_WRAP, WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER, WIND_K1, WIND_K2,
  WIND_BASE, WIND_CLOUD, WIND_RAIN, WIND_LEAN_MAX, WIND_GUST_MAX, WIND_FLUTTER_MAX,
  WIND_DIR_PERIOD, windSpeedUnder, windRecordUnder, directionAt, gustAt, omegaMultiple,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

describe("wind frequencies", () => {
  it("are exact multiples of 2π / WIND_TIME_WRAP so the time wrap is phase-continuous", () => {
    for (const omega of [WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER]) {
      const n = omegaMultiple(omega);
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    }
    expect(WIND_TIME_WRAP).toBe(300);
  });
  it("keep the gust ω values the old windField.ts exported", () => {
    expect(WIND_OMEGA_GUST).toBe(0.3769911184);
    expect(WIND_OMEGA_GUST2).toBe(0.879645943);
  });
  it("wave numbers give a 25 m primary wave and a 9 m second octave", () => {
    expect(WIND_K1).toBeCloseTo((2 * Math.PI) / 25, 12);
    expect(WIND_K2).toBeCloseTo((2 * Math.PI) / 9, 12);
  });
});

describe("windSpeedUnder", () => {
  it("is the spec's table per preset", () => {
    expect(windSpeedUnder(WEATHER_PRESETS.clear)).toBeCloseTo(0.25, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.overcast)).toBeCloseTo(0.53, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.mist)).toBeCloseTo(0.565, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.rain)).toBeCloseTo(0.9, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.eerie)).toBeCloseTo(0.69, 10);
    expect(WIND_BASE + WIND_CLOUD + WIND_RAIN).toBeCloseTo(0.9, 10);
  });
  it("never exceeds 1", () => {
    expect(windSpeedUnder({ cloudCover: 1, mist: 1, rain: 1, wetness: 1, dread: 1 })).toBeLessThanOrEqual(1);
  });
});

describe("windRecordUnder", () => {
  it("scales lean, gust and flutter with speed and wraps time", () => {
    const r = windRecordUnder(WEATHER_PRESETS.rain, 301);
    expect(r.speed).toBeCloseTo(0.9, 10);
    expect(r.lean).toBeCloseTo(WIND_LEAN_MAX * 0.9, 10);
    expect(r.gustAmp).toBeCloseTo(WIND_GUST_MAX * 0.9, 10);
    expect(r.flutterAmp).toBeCloseTo(WIND_FLUTTER_MAX * 0.9, 10);
    expect(r.time).toBeCloseTo(1, 10);
    expect(r.dirX * r.dirX + r.dirZ * r.dirZ).toBeCloseTo(1, 10);
  });
  it("the override replaces speed only", () => {
    const a = windRecordUnder(WEATHER_PRESETS.clear, 10);
    const b = windRecordUnder(WEATHER_PRESETS.clear, 10, 1);
    expect(b.speed).toBe(1);
    expect(b.dirX).toBe(a.dirX);
    expect(b.time).toBe(a.time);
    expect(windRecordUnder(WEATHER_PRESETS.rain, 10, 0).lean).toBe(0);
  });
});

describe("directionAt", () => {
  it("is unit length and makes one full turn per WIND_DIR_PERIOD", () => {
    const a = directionAt(0);
    const b = directionAt(WIND_DIR_PERIOD);
    expect(a.x * a.x + a.z * a.z).toBeCloseTo(1, 10);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
    const q = directionAt(WIND_DIR_PERIOD / 4);
    expect(q.x * a.x + q.z * a.z).toBeCloseTo(0, 6);
  });
});

describe("gustAt", () => {
  it("is bounded in [-1.5, 1.5]", () => {
    const r = windRecordUnder(WEATHER_PRESETS.rain, 0);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 300; t += 0.37) {
      const v = gustAt({ ...r, time: t }, 13.2, -41.7);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1.5);
    expect(hi).toBeLessThanOrEqual(1.5);
  });
  it("the front travels downwind: the crest moves +x over time, at about 1.5 m/s", () => {
    expect(WIND_OMEGA_GUST / WIND_K1).toBeCloseTo(1.5, 6);
    const r = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 1, dirZ: 0 };
    // Search one ragged cell (x in [0, 6)) at 1 mm for the crest at t = 0 and t = 0.2 s.
    const crestAt = (t: number): number => {
      let best = -Infinity, bestX = 0;
      for (let x = 0; x < 6; x += 0.001) {
        const v = gustAt({ ...r, time: t }, x, 0);
        if (v > best) { best = v; bestX = x; }
      }
      return bestX;
    };
    const dx = crestAt(0.2) - crestAt(0);
    // Both octaves travel +x (at 1.5 and 1.26 m/s), so the summed crest advances between them.
    expect(dx).toBeGreaterThan(0.2);
    expect(dx).toBeLessThan(0.35);
  });
});
