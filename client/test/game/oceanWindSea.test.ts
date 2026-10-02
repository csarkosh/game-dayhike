import { describe, it, expect } from "vitest";
import {
  WIND_SEA_AFTERNOON, WIND_SEA_DAWN, WIND_SEA_FETCH_COEFF, WIND_SEA_GAMMA, WIND_SEA_HS_COEFF, WIND_SEA_SPREAD,
  WIND_SEA_U_PER_WIND, WIND_SEA_U_REF, fetchShare, hourFactor, sharedSeconds, windSeaShare, windSeaStateFor,
} from "../../src/game/oceanWindSea.js";
import { whitecapCoverage } from "../../src/game/oceanPhysics.js";
import { FixedStepAccumulator } from "../../src/game/loop.js";
import { TICK_DT } from "../../src/sim/constants.js";

describe("hourFactor", () => {
  it("calms the dawn, raises the afternoon's sea breeze and leaves the rest of the day alone", () => {
    expect([WIND_SEA_DAWN, WIND_SEA_AFTERNOON]).toEqual([0.4, 1.25]);
    for (const h of [5, 6, 7.5, 8]) expect(hourFactor(h)).toBeCloseTo(0.4, 12);
    for (const h of [13, 15, 18]) expect(hourFactor(h)).toBeCloseTo(1.25, 12);
    for (const h of [0, 3, 4, 9, 10, 12, 19, 22, 23.99]) expect(hourFactor(h)).toBe(1);
  });

  it("turns over a smoothstep shoulder an hour wide either side", () => {
    expect(hourFactor(4.5)).toBeCloseTo(0.7, 12);
    expect(hourFactor(8.5)).toBeCloseTo(0.7, 12);
    expect(hourFactor(12.5)).toBeCloseTo(1.125, 12);
    expect(hourFactor(18.5)).toBeCloseTo(1.125, 12);
    expect(hourFactor(12.25)).toBeCloseTo(1.0390625, 12);
  });

  it("is continuous through the day and wraps at midnight", () => {
    let step = 0;
    for (let i = 1; i <= 24000; i++) step = Math.max(step, Math.abs(hourFactor(i / 1000) - hourFactor((i - 1) / 1000)));
    expect(step).toBeLessThan(0.001);
    expect(step).toBeGreaterThan(0.0008);
    expect(hourFactor(30)).toBeCloseTo(0.4, 12);
    expect(hourFactor(-9)).toBeCloseTo(1.25, 12);
  });
});

describe("windSeaStateFor", () => {
  it("a clear noon: 3 m/s, a small sea and no whitecaps", () => {
    expect(WIND_SEA_U_PER_WIND).toBe(12);
    const s = windSeaStateFor(0.25, [1, 0], 12);
    expect(s.u10).toBeCloseTo(3, 12);
    expect(s.hs).toBeCloseTo(0.25688073394495414, 12);
    expect(s.tp).toBeCloseTo(2.486263394744039, 12);
    expect(s.coverage).toBe(0);
    expect(s.loopScale).toBeCloseTo(0.09, 12);
    expect(s.loopRate).toBeCloseTo(3.3333333333333335, 12);
  });

  it("a rainy afternoon: 13.5 m/s, a storm sea and its whitecaps", () => {
    const s = windSeaStateFor(0.9, [1, 0], 15);
    expect(s.u10).toBeCloseTo(13.5, 12);
    expect(s.hs).toBeCloseTo(5.201834862385321, 12);
    expect(s.tp).toBeCloseTo(11.188185276348175, 12);
    expect(s.coverage).toBe(whitecapCoverage(13.5));
    expect(s.coverage).toBeGreaterThan(0.01);
    expect(s.loopScale).toBeCloseTo(1.8225, 12);
    expect(s.loopRate).toBeCloseTo(0.7407407407407407, 12);
  });

  it("a dawn: the same wind at 0.4 of its noon speed", () => {
    expect(windSeaStateFor(0.53, [1, 0], 6).u10).toBeCloseTo(2.544, 12);
    expect(windSeaStateFor(0.53, [1, 0], 6).u10).toBeCloseTo(0.4 * windSeaStateFor(0.53, [1, 0], 12).u10, 12);
  });

  it("weighs the wind onshore by its direction: 1 onshore, 0 off the land, a smoothstep between", () => {
    const onshore = windSeaStateFor(0.6, [1, 0], 12);
    expect(onshore.onshore).toBe(1);
    expect(onshore.onshoreWeight).toBe(1);
    const offshore = windSeaStateFor(0.6, [-1, 0], 12);
    expect(offshore.onshore).toBe(-1);
    expect(offshore.onshoreWeight).toBe(0);
    const along = windSeaStateFor(0.6, [0, 1], 12);
    expect(along.onshoreWeight).toBeCloseTo(0.352, 12);
    // The direction is made a unit vector first.
    const slanted = windSeaStateFor(0.6, [3, 4], 12);
    expect(slanted.dir[0]).toBeCloseTo(0.6, 12);
    expect(slanted.dir[1]).toBeCloseTo(0.8, 12);
    expect(slanted.onshore).toBeCloseTo(0.6, 12);
    expect(slanted.onshoreWeight).toBe(1);
  });

  it("stays finite in still air", () => {
    const s = windSeaStateFor(0, [0, 0], 12);
    expect([s.u10, s.hs, s.coverage, s.loopScale]).toEqual([0, 0, 0, 0]);
    expect(s.dir).toEqual([1, 0]);
    expect(s.loopRate).toBe(20);
    expect(s.tp).toBeCloseTo(0.4143772324573398, 12);
    expect([WIND_SEA_SPREAD, WIND_SEA_GAMMA, WIND_SEA_U_REF]).toEqual([10, 3.3, 10]);
    expect(s.onshoreWeight).toBe(1);
    expect(Number.isFinite(windSeaShare(s, -200))).toBe(true);
    expect(fetchShare(0, 100)).toBeCloseTo(0.3579533660197903, 12);
    expect(fetchShare(0, 0)).toBe(0);
  });
});

describe("the fetch law", () => {
  it("is the Coastal Engineering Manual's: Hs = 0.0016 sqrt(gX / U²) U² / g, over the fully developed 0.28 U² / g", () => {
    expect([WIND_SEA_FETCH_COEFF, WIND_SEA_HS_COEFF]).toEqual([0.0016, 0.28]);
    expect(fetchShare(8, 50)).toBeCloseTo(0.0158194532788215, 12);
    expect(fetchShare(8, 1000)).toBeCloseTo(0.07074674579665362, 12);
    // At 8 m/s the fully developed height is 1.8267074413863404 m; the share leaves 3 cm over 50 m and 12 cm over 1 km.
    const hs8 = windSeaStateFor(8 / 12, [1, 0], 12).hs;
    expect(hs8).toBeCloseTo(1.8267074413863404, 12);
    expect(fetchShare(8, 50) * hs8).toBeCloseTo(0.02889751302308678, 12);
    expect(fetchShare(8, 1000) * hs8).toBeCloseTo(0.12923360700061495, 12);
  });

  it("is 0 at the waterline and on land, 1 far enough out, and grows with the fetch", () => {
    expect(fetchShare(8, 0)).toBe(0);
    expect(fetchShare(8, -100)).toBe(0);
    expect(fetchShare(8, 1e6)).toBe(1);
    // Fully developed from sqrt(gX) = u 0.28 / 0.0016, X = 199796 m at 8 m/s.
    expect(fetchShare(8, 199000)).toBeLessThan(1);
    expect(fetchShare(8, 200000)).toBe(1);
    let prev = 0;
    for (const fetch of [1, 10, 50, 200, 1000, 5000, 50000, 150000, 199000, 250000]) {
      const share = fetchShare(8, fetch);
      expect(share).toBeGreaterThan(prev);
      prev = share;
    }
  });

  it("holds the sea small off the land and whole onshore, mixing by the onshore weight", () => {
    const onshore = windSeaStateFor(0.6, [1, 0], 12);
    for (const d of [-1, -200, -5000]) expect(windSeaShare(onshore, d)).toBe(1);
    const offshore = windSeaStateFor(0.6, [-1, 0], 12);
    // U10 = 7.2 m/s, 200 m out: 0.03515434061960333 of the fully developed height.
    expect(windSeaShare(offshore, -200)).toBeCloseTo(0.03515434061960333, 12);
    expect(windSeaShare(offshore, -200)).toBeCloseTo(fetchShare(7.2, 200), 12);
    expect(windSeaShare(offshore, 0)).toBe(0);
    expect(windSeaShare(offshore, 30)).toBe(0);
    expect(windSeaShare(offshore, -1e6)).toBe(1);
    // Along the shore, the weight 0.352 of the way from the fetch's share to 1.
    const along = windSeaStateFor(0.6, [0, 1], 12);
    expect(windSeaShare(along, -200)).toBeCloseTo(0.3747800127215029, 12);
    expect(windSeaShare(along, 0)).toBeCloseTo(0.352, 12);
  });
});

describe("sharedSeconds", () => {
  it("is the tick and its fraction in seconds, the same either side of a tick", () => {
    expect(sharedSeconds(0, 0)).toBe(0);
    expect(sharedSeconds(60, 0)).toBeCloseTo(1, 12);
    expect(sharedSeconds(7200, 0.5)).toBeCloseTo(120.00833333333333, 9);
    expect(sharedSeconds(10, 1)).toBe(sharedSeconds(11, 0));
    expect(sharedSeconds(5, -0.5)).toBe(sharedSeconds(5, 0));
    expect(sharedSeconds(5, 1.5)).toBe(sharedSeconds(6, 0));
  });

  it("advances exactly with the frames the fixed step runs, never backward", () => {
    const acc = new FixedStepAccumulator();
    let tick = 0;
    let prev = sharedSeconds(tick, acc.alpha);
    let elapsed = 0;
    for (let i = 0; i < 3000; i++) {
      // Frames from 4 to 40 ms, unevenly.
      const dt = 0.004 + 0.036 * ((i * 0.618033988749895) % 1);
      tick += acc.advance(dt);
      elapsed += dt;
      const now = sharedSeconds(tick, acc.alpha);
      expect(now).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(now - prev - dt)).toBeLessThan(1e-9);
      prev = now;
    }
    expect(prev).toBeCloseTo(elapsed, 6);
    // A backgrounded tab's long frame drops ticks; the clock still only moves forward.
    tick += acc.advance(2);
    const after = sharedSeconds(tick, acc.alpha);
    expect(after - prev).toBeGreaterThan(14 * TICK_DT);
    expect(after - prev).toBeLessThanOrEqual(15 * TICK_DT + 1e-12);
  });
});
