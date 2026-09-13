import { describe, it, expect } from "vitest";
import {
  FOG_FLOOR,
  SUN_PEAK,
  ambientColourFor,
  exposureFor,
  fillIntensityFor,
  FILL_DAY,
  FILL_NIGHT,
  fogDensityFor,
  skyColourAt,
  sunColourAt,
  sunIntensityAt,
  sunIntensityFor,
  sunPositionAt,
} from "../../src/game/sky.js";

describe("sunPositionAt", () => {
  it("returns a unit vector at every hour", () => {
    for (let h = 0; h < 24; h += 0.25) {
      const s = sunPositionAt(h);
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 10);
    }
  });

  it("puts the sun near the zenith at noon", () => {
    expect(sunPositionAt(12).y).toBeGreaterThan(0.9);
  });

  it("keeps noon off exactly vertical, so relief still casts a shadow", () => {
    // A sun at precisely (0, 1, 0) flattens terrain — the thing this whole step
    // exists to avoid. The arc is deliberately tilted.
    expect(sunPositionAt(12).y).toBeLessThan(0.999);
    expect(Math.hypot(sunPositionAt(12).x, sunPositionAt(12).z)).toBeGreaterThan(0.1);
  });

  it("puts the sun on the horizon at 6 and 18", () => {
    expect(sunPositionAt(6).y).toBeCloseTo(0, 10);
    expect(sunPositionAt(18).y).toBeCloseTo(0, 10);
  });

  it("travels east to west", () => {
    // Sunrise on +x, sunset on -x. Without this, dawn and dusk are mirrored and
    // nothing else in the suite would notice.
    expect(sunPositionAt(6).x).toBeGreaterThan(0.9);
    expect(sunPositionAt(18).x).toBeLessThan(-0.9);
  });

  it("puts the sun below the horizon at night", () => {
    expect(sunPositionAt(0).y).toBeLessThan(-0.9);
    expect(sunPositionAt(23).y).toBeLessThan(0);
    expect(sunPositionAt(1).y).toBeLessThan(0);
  });

  it("is continuous across midnight", () => {
    const before = sunPositionAt(23.999);
    const after = sunPositionAt(0);
    expect(before.x).toBeCloseTo(after.x, 3);
    expect(before.y).toBeCloseTo(after.y, 3);
    expect(before.z).toBeCloseTo(after.z, 3);
  });

  it("agrees at hour 0 and hour 24", () => {
    const a = sunPositionAt(0);
    const b = sunPositionAt(24);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
  });

  it("is deterministic", () => {
    expect(sunPositionAt(9.37)).toEqual(sunPositionAt(9.37));
  });
});

describe("sunIntensityFor", () => {
  it("is dark below the horizon", () => {
    expect(sunIntensityFor(-0.01)).toBe(0);
    expect(sunIntensityFor(-1)).toBe(0);
  });

  it("rises monotonically with altitude", () => {
    let previous = -1;
    for (let a = 0; a <= 1.0001; a += 0.02) {
      const value = sunIntensityFor(a);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("reaches SUN_PEAK at the zenith", () => {
    expect(sunIntensityFor(1)).toBeCloseTo(SUN_PEAK, 10);
  });

  it("is brighter at noon than at dusk", () => {
    expect(sunIntensityAt(12)).toBeGreaterThan(sunIntensityAt(17.5));
    expect(sunIntensityAt(0)).toBe(0);
  });
});

describe("sunColourAt", () => {
  it("is warm at the horizon and near-neutral overhead", () => {
    const dawn = sunColourAt(6);
    const noon = sunColourAt(12);
    // Warmth is red over blue. Asserting the *relationship* rather than fixed
    // numbers keeps the palette tunable without rewriting the test.
    expect(dawn.r - dawn.b).toBeGreaterThan(0.5);
    expect(noon.r - noon.b).toBeLessThan(0.2);
  });

  it("stays in gamut", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const c = sunColourAt(h);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("skyColourAt", () => {
  it("is darkest at midnight and brightest at noon", () => {
    const sum = (h: number) => {
      const c = skyColourAt(h);
      return c.r + c.g + c.b;
    };
    expect(sum(0)).toBeLessThan(sum(6));
    expect(sum(6)).toBeLessThan(sum(12));
  });

  it("is blue-dominant at noon", () => {
    const noon = skyColourAt(12);
    expect(noon.b).toBeGreaterThan(noon.r);
  });

  it("is continuous where the night and day branches meet", () => {
    // The two branches join at sun altitude 0, which is hour 6. This guards C0
    // continuity only: that both branches agree in value at the join, so the
    // sky doesn't visibly snap as /time crosses dawn. It does NOT pin the
    // transition widths (NIGHT_ALTITUDE, DAY_ALTITUDE) — those are visual
    // tuning constants, deliberately different from each other, and changing
    // either only changes the *slope* each branch approaches the join with, not
    // the value at the join itself, so this test is correctly insensitive to
    // them. That slope mismatch does mean there's a real kink near the join, so
    // the sample offset has to be small enough that the kink itself stays under
    // the tolerance: at +-0.01 hour it does not (worst channel delta ~0.0066,
    // over the 0.005 threshold at precision 2), so this samples at +-0.001 hour
    // instead, where the kink-induced delta is ~0.0007. A smaller offset is a
    // *better* test of continuity-at-a-limit, not a weaker one.
    const before = skyColourAt(5.999);
    const after = skyColourAt(6.001);
    expect(before.r).toBeCloseTo(after.r, 2);
    expect(before.g).toBeCloseTo(after.g, 2);
    expect(before.b).toBeCloseTo(after.b, 2);
  });

  it("stays in gamut", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const c = skyColourAt(h);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("exposureFor", () => {
  it("decreases monotonically as the sun rises", () => {
    let previous = Infinity;
    for (let a = -1; a <= 1.0001; a += 0.05) {
      const value = exposureFor(a);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });

  it("clamps outside the altitude range", () => {
    expect(exposureFor(-4)).toBe(exposureFor(-1));
    expect(exposureFor(4)).toBe(exposureFor(1));
  });

  it("stays positive", () => {
    for (let a = -1; a <= 1; a += 0.1) expect(exposureFor(a)).toBeGreaterThan(0);
  });
});

describe("fillIntensityFor", () => {
  it("is non-increasing as altitude rises", () => {
    // Brighter fill as the sun sinks: it is the only light left once the sun
    // sets, so it must never get dimmer while the sun is climbing.
    let previous = Infinity;
    for (let a = -1; a <= 1.0001; a += 0.02) {
      const value = fillIntensityFor(a);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it("is continuous, so a /time sweep does not step", () => {
    let previous = fillIntensityFor(-1);
    for (let a = -1; a <= 1.0001; a += 0.01) {
      const value = fillIntensityFor(a);
      expect(Math.abs(value - previous)).toBeLessThan(0.05);
      previous = value;
    }
  });

  it("is strictly brighter at night than by day", () => {
    expect(fillIntensityFor(-1)).toBeGreaterThan(fillIntensityFor(1));
    expect(fillIntensityFor(-1)).toBeCloseTo(FILL_NIGHT, 10);
    expect(fillIntensityFor(1)).toBeCloseTo(FILL_DAY, 10);
  });

  it("stays positive", () => {
    for (let a = -1; a <= 1; a += 0.1) expect(fillIntensityFor(a)).toBeGreaterThan(0);
  });
});

describe("ambientColourFor", () => {
  it("stays in gamut across the whole day", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const c = ambientColourFor(h);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the sky colour by day", () => {
    const noon = ambientColourFor(12);
    const sky = skyColourAt(12);
    expect(noon.r).toBeCloseTo(sky.r, 5);
    expect(noon.g).toBeCloseTo(sky.g, 5);
    expect(noon.b).toBeCloseTo(sky.b, 5);
  });

  it("is a cool moonlight tint at night, not the near-black night sky colour", () => {
    const midnight = ambientColourFor(0);
    const sky = skyColourAt(0);
    // The night sky colour is near-black; moonlight must be substantially
    // brighter than it so night stays legible.
    const sum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
    expect(sum(midnight)).toBeGreaterThan(sum(sky) * 3);
  });
});

describe("fogDensityFor", () => {
  it("leaves exactly FOG_FLOOR of a surface visible at the reference distance", () => {
    // This is the property that makes the number meaningful rather than tuned.
    // Babylon's FOGMODE_EXP2 transmittance is exp(-(density * d)^2).
    for (const d of [40, 70, 250, 8000]) {
      const transmittance = Math.exp(-Math.pow(fogDensityFor(d) * d, 2));
      expect(transmittance).toBeCloseTo(FOG_FLOOR, 10);
    }
  });

  it("thins as the view distance grows", () => {
    expect(fogDensityFor(8000)).toBeLessThan(fogDensityFor(70));
  });
});
