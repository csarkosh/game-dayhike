import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTimeScale } from "./helpers/timeLimit.js";

describe("TEST_TIME_SCALE", () => {
  it("is exactly 1 when unset, so every local limit is its literal", () => {
    expect(parseTimeScale(undefined)).toBe(1);
  });

  it("reads a positive whole or decimal factor", () => {
    expect(parseTimeScale("3")).toBe(3);
    expect(parseTimeScale("1.5")).toBe(1.5);
    expect(parseTimeScale(" 2 ")).toBe(2);
    expect(parseTimeScale(".5")).toBe(0.5);
  });

  it("refuses anything else, naming the variable, rather than run with a surprise", () => {
    for (const raw of ["", "0", "0.0", "-1", "abc", "3x", "Infinity", "NaN", "1e3", "0x10"]) {
      expect(() => parseTimeScale(raw), JSON.stringify(raw)).toThrow(/TEST_TIME_SCALE/);
    }
  });
});

describe("the scaled limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("timeLimit multiplies by the factor, and leaves the literal alone when unset", async () => {
    vi.stubEnv("TEST_TIME_SCALE", "3");
    vi.resetModules();
    expect((await import("./helpers/timeLimit.js")).timeLimit(60_000)).toBe(180_000);
    vi.stubEnv("TEST_TIME_SCALE", undefined);
    vi.resetModules();
    expect((await import("./helpers/timeLimit.js")).timeLimit(60_000)).toBe(60_000);
  });

  it("the config scales vitest's default test and hook limits by the same factor", async () => {
    vi.stubEnv("TEST_TIME_SCALE", "3");
    vi.resetModules();
    const scaled = (await import("../vite.config.js")).default;
    expect(scaled.test?.testTimeout).toBe(15_000);
    expect(scaled.test?.hookTimeout).toBe(30_000);
    vi.stubEnv("TEST_TIME_SCALE", undefined);
    vi.resetModules();
    const unscaled = (await import("../vite.config.js")).default;
    expect(unscaled.test?.testTimeout).toBe(5_000);
    expect(unscaled.test?.hookTimeout).toBe(10_000);
  });
});
