import { describe, it, expect } from "vitest";
import {
  SWELL_COMPONENTS, SWELL_COMPONENTS_LOW, SWELL_DIR_MAX_DEG, SWELL_DIR_MIN_DEG, SWELL_GAMMA_MAX, SWELL_GAMMA_MIN,
  SWELL_HS_MAX, SWELL_HS_MEDIAN, SWELL_HS_MIN, SWELL_PAIR_DF_MAX, SWELL_PAIR_DF_MIN, SWELL_Q0, SWELL_Q_SUM_MAX,
  SWELL_SPREAD_MAX, SWELL_SPREAD_MIN, SWELL_TP_MAX, SWELL_TP_MIN, SWELL_TRAVEL_MAX_DEG,
  swellComponents, swellStateFor, swellTravelDirection, type SwellComponent,
} from "../../src/game/oceanSwell.js";
import { OCEAN_G } from "../../src/game/oceanPhysics.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";

// Every world's swell, drawn once. The swell reads only the seed's hashes
// (no terrain, no bowl), so the 200 lobby worlds take a fraction of a second.
const WORLDS = LOBBY_SEEDS.map((seed) => {
  const state = swellStateFor(seed);
  return { seed, state, components: swellComponents(seed, state) };
});

const frequency = (c: SwellComponent): number => c.omega / (2 * Math.PI);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return ((sorted[(sorted.length - 1) >> 1] as number) + (sorted[sorted.length >> 1] as number)) / 2;
};

describe("swellStateFor", () => {
  it("keeps every quantity inside the real coast's range over the 200 lobby worlds", () => {
    for (const { state } of WORLDS) {
      expect(state.hs).toBeGreaterThanOrEqual(SWELL_HS_MIN);
      expect(state.hs).toBeLessThanOrEqual(SWELL_HS_MAX);
      expect(state.tp).toBeGreaterThanOrEqual(SWELL_TP_MIN);
      expect(state.tp).toBeLessThanOrEqual(SWELL_TP_MAX);
      expect(state.dirFromDeg).toBeGreaterThanOrEqual(SWELL_DIR_MIN_DEG);
      expect(state.dirFromDeg).toBeLessThanOrEqual(SWELL_DIR_MAX_DEG);
      expect(state.gamma).toBeGreaterThanOrEqual(SWELL_GAMMA_MIN);
      expect(state.gamma).toBeLessThanOrEqual(SWELL_GAMMA_MAX);
      expect(state.spread).toBeGreaterThanOrEqual(SWELL_SPREAD_MIN);
      expect(state.spread).toBeLessThanOrEqual(SWELL_SPREAD_MAX);
    }
    expect([SWELL_HS_MIN, SWELL_HS_MAX, SWELL_TP_MIN, SWELL_TP_MAX]).toEqual([0.8, 4, 8, 14]);
    expect([SWELL_DIR_MIN_DEG, SWELL_DIR_MAX_DEG, SWELL_GAMMA_MIN, SWELL_GAMMA_MAX]).toEqual([255, 300, 3.3, 7]);
    expect([SWELL_SPREAD_MIN, SWELL_SPREAD_MAX]).toEqual([25, 75]);
  });

  it("draws Hs log-normally about 1.9 m: the 200 worlds' median within 15 %", () => {
    expect(SWELL_HS_MEDIAN).toBe(1.9);
    const m = median(WORLDS.map((w) => w.state.hs));
    expect(m).toBeGreaterThan(1.615);
    expect(m).toBeLessThan(2.185);
    // Spread out, not a constant: both tails are reached.
    expect(WORLDS.some((w) => w.state.hs < 1.2)).toBe(true);
    expect(WORLDS.some((w) => w.state.hs > 3)).toBe(true);
  });

  it("raises the peak period with the height, 7.5 + 1.6 Hs within its 1 s jitter, clamped to 8–14 s", () => {
    for (const { state } of WORLDS) {
      const centre = 7.5 + 1.6 * state.hs;
      expect(state.tp).toBeGreaterThanOrEqual(Math.min(14, Math.max(8, centre - 1)) - 1e-12);
      expect(state.tp).toBeLessThanOrEqual(Math.max(8, Math.min(14, centre + 1)) + 1e-12);
    }
  });

  it("weights the direction toward due west: the median within 3° of the triangle's 274°", () => {
    const m = median(WORLDS.map((w) => w.state.dirFromDeg));
    expect(m).toBeGreaterThan(271);
    expect(m).toBeLessThan(277);
  });

  it("is a pure function of the seed", () => {
    for (const { seed, state, components } of WORLDS.slice(0, 20)) {
      expect(swellStateFor(seed)).toEqual(state);
      expect(swellComponents(seed, state)).toEqual(components);
    }
    expect(swellStateFor(1)).not.toEqual(swellStateFor(2));
  });
});

describe("swellComponents", () => {
  it("makes SWELL_COMPONENTS components, largest first, so the low tier's first eight are the biggest", () => {
    expect([SWELL_COMPONENTS, SWELL_COMPONENTS_LOW]).toEqual([12, 8]);
    for (const { components } of WORLDS) {
      expect(components).toHaveLength(12);
      for (let i = 1; i < components.length; i++) {
        expect((components[i] as SwellComponent).a0).toBeLessThanOrEqual((components[i - 1] as SwellComponent).a0);
      }
    }
  });

  it("scales the amplitudes so 4√(Σa²/2) = Hs exactly", () => {
    for (const { state, components } of WORLDS) {
      const energy = components.reduce((sum, c) => sum + (c.a0 * c.a0) / 2, 0);
      expect(4 * Math.sqrt(energy)).toBeCloseTo(state.hs, 12);
    }
  });

  it("spaces neighbouring frequencies 0.005 to 0.01 Hz apart, the peak between the third and fourth", () => {
    expect([SWELL_PAIR_DF_MIN, SWELL_PAIR_DF_MAX]).toEqual([0.005, 0.01]);
    for (const { state, components } of WORLDS) {
      const f = components.map(frequency).sort((a, b) => a - b);
      for (let i = 1; i < f.length; i++) {
        const gap = (f[i] as number) - (f[i - 1] as number);
        expect(gap).toBeGreaterThanOrEqual(0.005 - 1e-12);
        expect(gap).toBeLessThanOrEqual(0.01 + 1e-12);
      }
      expect(f[2] as number).toBeLessThan(1 / state.tp);
      expect(f[3] as number).toBeGreaterThan(1 / state.tp);
    }
  });

  it("makes the two largest neighbours, so the sets repeat every 100 to 200 s", () => {
    let shortest = Infinity;
    let longest = 0;
    for (const { components } of WORLDS) {
      const set = 1 / Math.abs(frequency(components[0] as SwellComponent) - frequency(components[1] as SwellComponent));
      shortest = Math.min(shortest, set);
      longest = Math.max(longest, set);
      // Neighbours on the ladder: no other component's frequency lies between them.
      const lo = Math.min(frequency(components[0] as SwellComponent), frequency(components[1] as SwellComponent));
      const hi = Math.max(frequency(components[0] as SwellComponent), frequency(components[1] as SwellComponent));
      expect(components.filter((c) => frequency(c) > lo && frequency(c) < hi)).toHaveLength(0);
    }
    expect(shortest).toBeGreaterThanOrEqual(100 - 1e-9);
    expect(longest).toBeLessThanOrEqual(200 + 1e-9);
  });

  it("travels onshore in deep water: k0x > 0, |k0| = ω²/g, within SWELL_TRAVEL_MAX_DEG of the shore's normal", () => {
    expect(SWELL_TRAVEL_MAX_DEG).toBe(60);
    for (const { components } of WORLDS) {
      for (const c of components) {
        expect(c.k0x).toBeGreaterThan(0);
        expect(Math.hypot(c.k0x, c.k0z)).toBeCloseTo((c.omega * c.omega) / OCEAN_G, 12);
        expect(Math.abs(Math.atan2(c.k0z, c.k0x))).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-12);
        expect(c.phase0).toBeGreaterThanOrEqual(0);
        expect(c.phase0).toBeLessThan(2 * Math.PI);
        expect(c.q0).toBe(SWELL_Q0);
      }
    }
    expect(SWELL_Q0).toBe(1);
  });

  it("stays far under the Σ Q|K|A cap offshore, where the cap is applied only near shore", () => {
    expect(SWELL_Q_SUM_MAX).toBe(0.9);
    for (const { components } of WORLDS) {
      const sum = components.reduce((s, c) => s + c.q0 * Math.hypot(c.k0x, c.k0z) * c.a0, 0);
      expect(sum).toBeLessThan(0.2);
    }
  });
});

describe("swellTravelDirection", () => {
  it("is a unit vector within 20° of the sea state's mean direction", () => {
    for (const { state, components } of WORLDS) {
      const [x, z] = swellTravelDirection(components);
      expect(Math.hypot(x, z)).toBeCloseTo(1, 12);
      expect(x).toBeGreaterThan(0);
      const mean = ((state.dirFromDeg - 270) * Math.PI) / 180;
      expect(Math.abs(Math.atan2(z, x) - mean)).toBeLessThan((20 * Math.PI) / 180);
    }
  });

  it("weights each component's direction by its amplitude squared", () => {
    const along = { k0x: 0.04, k0z: 0, omega: 0.6, a0: 1, phase0: 0, q0: 1 };
    const across = { k0x: 0, k0z: 0.04, omega: 0.6, a0: Math.sqrt(3), phase0: 0, q0: 1 };
    const [x, z] = swellTravelDirection([along, across]);
    expect(x).toBeCloseTo(0.31622776601683794, 12);
    expect(z).toBeCloseTo(0.9486832980505138, 12);
  });
});
