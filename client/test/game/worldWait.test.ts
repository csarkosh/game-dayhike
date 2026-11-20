import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenWorldIn } from "@csarkosh/engine/game/worldWait";

describe("a renderer's wait for its world", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lifts as the world comes in, before its bound", async () => {
    let lifted = false;
    void whenWorldIn(new Promise((resolve) => setTimeout(resolve, 3_000)), 10_000).then(() => (lifted = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(lifted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifted).toBe(true);
    // The bound's timer went with it: nothing is left to run.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lifts at its bound for a world that never comes in, and at once where nothing is left of the bound", async () => {
    let lifted = false;
    void whenWorldIn(new Promise(() => undefined), 5_000).then(() => (lifted = true));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(lifted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifted).toBe(true);
    let spent = false;
    void whenWorldIn(new Promise(() => undefined), -200).then(() => (spent = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(spent).toBe(true);
  });

  it("lifts once, though the world comes in after the bound", async () => {
    let lifts = 0;
    void whenWorldIn(new Promise((resolve) => setTimeout(resolve, 8_000)), 5_000).then(() => lifts++);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(lifts).toBe(1);
  });
});
