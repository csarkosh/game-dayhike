import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGAGE_MAX_MS, whenEngaged } from "../../src/game/engageWait.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("waiting for the controls to engage", () => {
  it("resolves true as soon as the controls read engaged", async () => {
    let engaged = false;
    const done = whenEngaged(() => engaged, 1000);
    await vi.advanceTimersByTimeAsync(120);
    engaged = true;
    await vi.advanceTimersByTimeAsync(60);
    await expect(done).resolves.toBe(true);
  });

  it("resolves true at once when they already are", async () => {
    await expect(whenEngaged(() => true, 1000)).resolves.toBe(true);
  });

  it("gives up with false after the limit, and the limit is a second", async () => {
    const done = whenEngaged(() => false, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(done).resolves.toBe(false);
    expect(ENGAGE_MAX_MS).toBe(1000);
  });
});
