import { describe, expect, it } from "vitest";
import {
  SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, createCrossing, createSyncJobs, crossingAt, finish, type Slices,
} from "../../src/game/syncJobs.js";

/** A test clock: `now` is advanced by hand, by the slices below. */
function testClock(): { clock: () => number; advance(ms: number): void } {
  let now = 0;
  return { clock: () => now, advance: (ms) => { now += ms; } };
}

/** A job of `slices` slices, each advancing the clock by `ms`, that records
 * the frame its last slice ran in. */
function job(clock: { advance(ms: number): void }, slices: number, ms: number, done: { at: number | null }, frame: () => number): Slices {
  return (function* () {
    for (let i = 0; i < slices; i++) {
      clock.advance(ms);
      if (i < slices - 1) yield;
    }
    done.at = frame();
  })();
}

describe("the scheduler", () => {
  it("names its budget and its lateness bound", () => {
    expect([SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX]).toEqual([4, 6]);
  });

  it("spends a frame's budget and at most one slice past it, oldest job first", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    const ownerA = {}, ownerB = {};
    // Two jobs of 7 ms each, in slices of 1.5 ms: three slices a frame.
    jobs.begin(ownerA, job(t, 5, 1.4, a, () => jobs.frame));
    jobs.begin(ownerB, job(t, 5, 1.4, b, () => jobs.frame));
    const spent: number[] = [];
    for (let f = 0; f < 5; f++) {
      const before = t.clock();
      jobs.run();
      spent.push(Math.round((t.clock() - before) * 10) / 10);
      expect(jobs.last.late).toBe(0);
    }
    // 4.2 ms a frame: three slices, the third begun at 2.8 ms, under the budget.
    expect(spent).toEqual([4.2, 4.2, 4.2, 1.4, 0]);
    expect([a.at, b.at]).toEqual([1, 3]);
    expect(jobs.pending(ownerA) || jobs.pending(ownerB)).toBe(false);
  });

  it("runs a job to its end in the sixth frame after its crossing, whatever the budget", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    // 100 slices of 1 ms: the budget alone would take 25 frames.
    jobs.begin(owner, job(t, 100, 1, done, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f <= SYNC_LATE_FRAMES_MAX; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    // Four slices a frame for six frames, then the other 76 at once.
    expect(late).toEqual([0, 0, 0, 0, 0, 0, 76]);
    expect(done.at).toBe(SYNC_LATE_FRAMES_MAX);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("keeps two crossings in one frame from making one long frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    // 10 ms each in slices of 0.5 ms, both begun in frame 0.
    jobs.begin({}, job(t, 20, 0.5, a, () => jobs.frame));
    jobs.begin({}, job(t, 20, 0.5, b, () => jobs.frame));
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) {
      const before = t.clock();
      jobs.run();
      expect(t.clock() - before).toBeLessThanOrEqual(SYNC_BUDGET_MS + 0.5);
      expect(jobs.last.late).toBe(0);
    }
    // 20 ms over frames of 4 ms: both done inside five frames, neither late.
    expect([a.at, b.at]).toEqual([2, 4]);
  });

  it("drops a job its owner cancels, and leaves the rest queued", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const dropped = { at: null as number | null }, other = { at: null as number | null };
    const owner = {}, bystander = {};
    jobs.begin(owner, job(t, 3, 1, dropped, () => jobs.frame));
    jobs.begin(bystander, job(t, 3, 1, other, () => jobs.frame));
    jobs.cancel(owner);
    expect([jobs.pending(owner), jobs.pending(bystander)]).toEqual([false, true]);
    jobs.run();
    expect([dropped.at, other.at]).toEqual([null, 0]);
  });

  it("replaces a job its owner begins again, in its place in the queue and with its deadline", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null }, other = { at: null as number | null };
    const owner = {}, bystander = {};
    // 40 slices of 1 ms: ten frames' budget.
    jobs.begin(owner, job(t, 40, 1, first, () => jobs.frame));
    jobs.begin(bystander, job(t, 2, 1, other, () => jobs.frame));
    jobs.run();
    jobs.run();
    // A further crossing, two frames on: the new rebuild is still due six
    // frames after the first one began, and still ahead of the bystander.
    jobs.begin(owner, job(t, 40, 1, second, () => jobs.frame));
    const late: number[] = [];
    for (let f = 2; f <= SYNC_LATE_FRAMES_MAX; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    expect([first.at, second.at, other.at]).toEqual([null, SYNC_LATE_FRAMES_MAX, SYNC_LATE_FRAMES_MAX]);
    // Four frames of four slices, then in frame 6 the other 24 at once, and
    // the bystander's two, due then too.
    expect(late).toEqual([0, 0, 0, 0, 26]);
  });

  it("takes a job whose slice throws out of the queue, and throws", () => {
    const jobs = createSyncJobs(() => 0);
    const owner = {};
    jobs.begin(owner, (function* () {
      yield;
      throw new Error("broken slice");
    })());
    expect(() => jobs.run()).toThrow("broken slice");
    expect(jobs.pending(owner)).toBe(false);
    expect(() => jobs.run()).not.toThrow();
  });

  it("finish runs a job's slices to the end and returns its result", () => {
    let slices = 0;
    const result = finish((function* () {
      for (let i = 0; i < 5; i++) {
        slices++;
        yield;
      }
      return "built";
    })());
    expect([result, slices]).toEqual(["built", 5]);
  });
});

describe("crossingAt", () => {
  const CELL = 2;
  const at = (c: ReturnType<typeof createCrossing>, x: number, z: number, deferrable = true) =>
    crossingAt(c, x, z, Math.floor(x / CELL) * CELL, Math.floor(z / CELL) * CELL, CELL, deferrable);

  it("builds the first view at once, then waits for a crossing", () => {
    const c = createCrossing();
    expect(at(c, 10.5, 10.5)).toBe("now");
    expect(at(c, 10.6, 10.6)).toBe("none");
    expect(at(c, 11.9, 10.6)).toBe("none");
  });

  it("makes a one-cell step at a walk or a run a job", () => {
    const c = createCrossing();
    at(c, 11.95, 10.5);
    // Walking, 5.25 m/s at 60 frames a second: 0.0875 m a frame.
    expect(at(c, 12.0375, 10.5)).toBe("later");
    // Running along the diagonal, both lines crossed in one frame.
    at(c, 13.95, 13.95);
    expect(at(c, 14.03, 14.03)).toBe("later");
  });

  it("builds at once after a teleport, at speed, and without a scheduler", () => {
    const c = createCrossing();
    at(c, 10.5, 10.5);
    // A jump of more than one cell.
    expect(at(c, 510.5, 10.5)).toBe("now");
    // The free camera's boost, 144 m/s: 2.4 m a frame, here a step of one
    // cell but more than half a cell since the last frame.
    at(c, 511.5, 10.5);
    expect(at(c, 513.9, 10.5)).toBe("now");
    // No scheduler.
    at(c, 515.9, 10.5);
    expect(at(c, 516.0, 10.5, false)).toBe("now");
  });
});
