import { describe, it, expect } from "vitest";
import { nextRandom, randomRange, Button, AiState } from "../../src/sim/types.js";

describe("seeded rng", () => {
  it("produces the same sequence from the same seed", () => {
    const a = { rngSeed: 12345 };
    const b = { rngSeed: 12345 };
    const seqA = Array.from({ length: 50 }, () => nextRandom(a));
    const seqB = Array.from({ length: 50 }, () => nextRandom(b));
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences from different seeds", () => {
    const a = { rngSeed: 1 };
    const b = { rngSeed: 2 };
    expect(nextRandom(a)).not.toBe(nextRandom(b));
  });

  it("stays within [0, 1)", () => {
    const s = { rngSeed: 999 };
    for (let i = 0; i < 5000; i++) {
      const v = nextRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("advances the seed so callers cannot accidentally repeat", () => {
    const s = { rngSeed: 42 };
    nextRandom(s);
    expect(s.rngSeed).not.toBe(42);
  });

  it("maps into an arbitrary range", () => {
    const s = { rngSeed: 7 };
    for (let i = 0; i < 1000; i++) {
      const v = randomRange(s, -5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it("distributes roughly uniformly", () => {
    const s = { rngSeed: 20260725 };
    const buckets = new Array(10).fill(0) as number[];
    for (let i = 0; i < 100000; i++) buckets[Math.floor(nextRandom(s) * 10)]!++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });
});

// The sim is compiled per-file by esbuild, which cannot inline const enum
// values across module boundaries the way tsc can. If that ever degrades,
// bitmask checks like (buttons & Button.Jump) silently compare against
// undefined and every jump input is ignored.
describe("const enums survive cross-module transpilation", () => {
  it("exposes Button values as numbers", () => {
    expect(Button.Interact).toBe(1);
    expect(Button.Jump).toBe(2);
    expect(Button.Sprint).toBe(8);
  });

  it("exposes AiState values as numbers", () => {
    expect(AiState.Idle).toBe(0);
    expect(AiState.Dead).toBe(3);
  });

  it("supports bitmask tests", () => {
    const buttons = Button.Interact | Button.Jump;
    expect((buttons & Button.Jump) !== 0).toBe(true);
    expect((buttons & Button.Lamp) !== 0).toBe(false);
  });
});
