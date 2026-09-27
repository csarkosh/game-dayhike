import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTimeScale, timeLimit } from "./helpers/timeLimit.js";

/**
 * The config scales vitest's default limit only when VITEST is set, which the
 * vitest CLI does before it loads the config. The config tests below stub the
 * variable, so they cannot notice if a vitest release stopped setting it; this
 * one reads the limit the running test actually has. Under TEST_TIME_SCALE=3
 * (the workflow) that is 15 s; unset, 5 s. The expectation goes through the
 * helper because it must hold under whatever factor the run sets.
 */
describe("the running suite", () => {
  it("gives a test with no limit of its own the config's default, scaled", ({ task }) => {
    expect(task.timeout).toBe(timeLimit(5_000));
  });
});

describe("TEST_TIME_SCALE", () => {
  it("is exactly 1 when unset, so every local limit is its literal", () => {
    expect(parseTimeScale(undefined)).toBe(1);
  });

  it("reads a positive whole or decimal factor, up to 10", () => {
    expect(parseTimeScale("3")).toBe(3);
    expect(parseTimeScale("1.5")).toBe(1.5);
    expect(parseTimeScale(" 2 ")).toBe(2);
    expect(parseTimeScale(".5")).toBe(0.5);
    expect(parseTimeScale("10")).toBe(10);
  });

  it("refuses anything else, naming the variable, rather than run with a surprise", () => {
    for (const raw of ["", "0", "0.0", "-1", "abc", "3x", "Infinity", "NaN", "1e3", "0x10"]) {
      expect(() => parseTimeScale(raw), JSON.stringify(raw)).toThrow(/TEST_TIME_SCALE/);
    }
  });

  it("refuses a factor above 10, saying why: a timer past 2^31-1 ms fires at once", () => {
    for (const raw of ["10.5", "11", "3600", "99999999999999999999"]) {
      expect(() => parseTimeScale(raw), raw).toThrow(/at most 10.*2\^31-1 ms/);
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

  it("reads the variable when a limit is asked for, not when the helper is imported", async () => {
    vi.stubEnv("TEST_TIME_SCALE", "garbage");
    vi.resetModules();
    const helper = await import("./helpers/timeLimit.js");
    expect(() => helper.timeLimit(1_000)).toThrow(/TEST_TIME_SCALE/);
  });

  it("the config scales vitest's default test and hook limits by the same factor under vitest", async () => {
    vi.stubEnv("VITEST", "true");
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

  it("the config never reads TEST_TIME_SCALE outside vitest, so a bad value cannot break dev or build", async () => {
    vi.stubEnv("VITEST", undefined);
    for (const bad of ["", "garbage", "0", "3600"]) {
      vi.stubEnv("TEST_TIME_SCALE", bad);
      vi.resetModules();
      const config = (await import("../vite.config.js")).default;
      expect(config.test?.testTimeout, JSON.stringify(bad)).toBeUndefined();
      expect(config.test?.hookTimeout, JSON.stringify(bad)).toBeUndefined();
    }
  });
});
