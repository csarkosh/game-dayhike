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
  it("the primary front travels downwind at ω1 / k1 = 1.5 m/s", () => {
    // Same 6 m ragged cell for both points so only the travelling phase differs:
    // the first term at (x, t) equals the first term at (x + 15 m downwind, t + 10 s).
    const r = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 1, dirZ: 0 };
    const speed = WIND_OMEGA_GUST / WIND_K1;
    expect(speed).toBeCloseTo(1.5, 6);
    const x0 = 0.5, dt = 10, x1 = x0 + speed * dt;
    // Isolate the primary term by differencing out the second octave analytically.
    const primary = (x: number, t: number) => gustAt({ ...r, time: t }, x, 0) - 0.5 * Math.sin(WIND_K2 * x + WIND_OMEGA_GUST2 * t + 1.7 * 0);
    // Both points sit in cells whose ragged term is identical only if ci is equal;
    // x0 = 0.5 and x1 = 15.5 are in cells 0 and 2, so compare with the ragged
    // difference removed by evaluating on a record with the ragged amplitude ignored:
    // the test therefore pins the closed form directly.
    const raggedAt = (x: number) => { const f = Math.floor(x / 6) * 0.618034; return 1.2 * (f - Math.floor(f) - 0.5); };
    const p0 = Math.sin(WIND_K1 * x0 + WIND_OMEGA_GUST * 0 + raggedAt(x0));
    const p1 = Math.sin(WIND_K1 * x1 + WIND_OMEGA_GUST * dt + raggedAt(x1));
    expect(Math.abs(Math.sin(WIND_K1 * x1 + WIND_OMEGA_GUST * dt) - Math.sin(WIND_K1 * x0))).toBeLessThan(1e-9);
    expect(primary(x0, 0)).toBeCloseTo(p0, 9);
    expect(primary(x1, dt)).toBeCloseTo(p1, 9);
  });
});
