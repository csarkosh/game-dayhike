import { describe, expect, it } from "vitest";
import { extrasLater } from "../../src/game/extrasLater.js";

describe("a hike's extras, built in a task after the one that asked", () => {
  /** The tasks asked for, run when the test says. */
  function tasks(): { later: (run: () => void) => void; run(): void; waiting(): number } {
    const queue: (() => void)[] = [];
    return {
      later: (run) => queue.push(run),
      run: () => {
        for (const task of queue.splice(0)) task();
      },
      waiting: () => queue.length,
    };
  }

  it("builds once, in the next task and not in the call", () => {
    const t = tasks();
    let built = 0;
    extrasLater({ build: () => built++, still: () => true, failed: () => undefined, later: t.later });
    expect(built).toBe(0);
    expect(t.waiting()).toBe(1);
    t.run();
    expect(built).toBe(1);
    t.run();
    expect(built).toBe(1);
  });

  it("builds nothing where the hike is no longer the one that asked when the task comes", () => {
    const t = tasks();
    let built = 0;
    let still = true;
    extrasLater({ build: () => built++, still: () => still, failed: () => undefined, later: t.later });
    // Asked at the task, not at the call: the hike was left, or its renderer swapped, in between.
    still = false;
    t.run();
    expect(built).toBe(0);
  });

  it("builds nothing once it is cancelled, and does not ask whether to", () => {
    const t = tasks();
    let built = 0;
    let asked = 0;
    const later = extrasLater({ build: () => built++, still: () => (asked++, true), failed: () => undefined, later: t.later });
    later.cancel();
    later.cancel();
    t.run();
    expect([built, asked]).toEqual([0, 0]);
  });

  it("hands a build that throws to its failure, and lets nothing out", () => {
    const t = tasks();
    const failures: unknown[] = [];
    const broke = new Error("no board");
    extrasLater({
      build: () => {
        throw broke;
      },
      still: () => true,
      failed: (error) => failures.push(error),
      later: t.later,
    });
    expect(() => t.run()).not.toThrow();
    expect(failures).toEqual([broke]);
  });

  it("takes a task of the page's own where it is given none", async () => {
    let built = 0;
    extrasLater({ build: () => built++, still: () => true, failed: () => undefined });
    expect(built).toBe(0);
    await new Promise((given) => setTimeout(given, 0));
    await new Promise((given) => setTimeout(given, 0));
    expect(built).toBe(1);
  });
});
