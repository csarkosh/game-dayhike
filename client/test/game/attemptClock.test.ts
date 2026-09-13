import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startAttemptClock, ATTEMPT_TICK_MS } from "../../src/game/attemptClock.js";
import { PENDING_AFTER_MS, OVERRUN_MS } from "../../src/game/rosterModel.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A clock the test moves by hand, kept in step with the fake timers. */
function harness(kind: "invite" | "join" = "invite") {
  let t = 1000;
  const repaints: number[] = [];
  const ticks: number[] = [];
  const clock = startAttemptClock({
    kind,
    now: () => t,
    onRepaint: () => repaints.push(t),
    onTick: () => ticks.push(t),
  });
  const advance = async (ms: number) => {
    t += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  return { clock, repaints, ticks, advance };
}

describe("startAttemptClock", () => {
  it("reports elapsed time and the stage it is in", async () => {
    const { clock, advance } = harness();
    expect(clock.attempt).toEqual({ kind: "invite", elapsedMs: 0, connectedAtMs: null });
    await advance(400);
    expect(clock.attempt).toEqual({ kind: "invite", elapsedMs: 400, connectedAtMs: null });
    clock.stop();
  });

  it("records the socket-open milestone relative to the start, and repaints for it", async () => {
    const { clock, repaints, advance } = harness();
    await advance(1800);
    const before = repaints.length;
    clock.connected();
    expect(clock.attempt.connectedAtMs).toBe(1800);
    expect(repaints.length).toBe(before + 1);
    clock.stop();
  });

  it("ignores a second milestone: a reconnect must not restart the stage", async () => {
    const { clock, repaints, advance } = harness();
    await advance(1800);
    clock.connected();
    const after = repaints.length;
    await advance(500);
    clock.connected();
    expect(clock.attempt.connectedAtMs).toBe(1800);
    expect(repaints.length).toBe(after);
    clock.stop();
  });

  it("repaints when the bar appears and again when the wait becomes an overrun", async () => {
    const { clock, repaints, advance } = harness();
    expect(repaints).toEqual([]);
    await advance(PENDING_AFTER_MS);
    expect(repaints).toEqual([1000 + PENDING_AFTER_MS]);
    await advance(OVERRUN_MS - PENDING_AFTER_MS);
    expect(repaints).toEqual([1000 + PENDING_AFTER_MS, 1000 + OVERRUN_MS]);
    clock.stop();
  });

  it("ticks the bar steadily in between", async () => {
    const { clock, ticks, advance } = harness();
    await advance(ATTEMPT_TICK_MS * 5);
    expect(ticks.length).toBe(5);
    clock.stop();
  });

  it("stops every timer it started", async () => {
    const { clock, repaints, ticks, advance } = harness();
    await advance(100);
    clock.stop();
    const seen = { repaints: repaints.length, ticks: ticks.length };
    await advance(OVERRUN_MS * 2);
    expect(repaints.length).toBe(seen.repaints);
    expect(ticks.length).toBe(seen.ticks);
  });
});
