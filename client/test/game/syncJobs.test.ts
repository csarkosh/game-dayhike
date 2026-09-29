import { describe, expect, it } from "vitest";
import {
  SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX, createCrossing, createSyncJobs, crossingAt, finish, nextCrossing, sortSlices, turn,
  type Slices,
} from "../../src/game/syncJobs.js";

/** `list` sorted at once by `sortSlices`. */
function sortSlicesDone(list: number[]): number[] {
  finish(sortSlices(list, (a, b) => a - b));
  return list;
}

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
  it("names its budget and its lateness bounds", () => {
    expect([SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX]).toEqual([4, 6, 100]);
  });

  /** A job of 400 slices of 0.125 ms begun at frame 0, with the clock set to
   * `frameMs` times the frame as each frame's share starts (a share runs 32
   * slices): the frame whose share ran it to its end, and how many slices
   * that share ran late. `replaceAt` begins it again at that frame. */
  function forcedAt(frameMs: number, replaceAt: number | null = null): { at: number | null; late: number } {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const done = { at: null as number | null };
    const clock = { advance: (ms: number) => { now += ms; } };
    const owner = {};
    jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
    let late = 0;
    for (let f = 0; f < 10 && done.at === null; f++) {
      now = f * frameMs;
      if (f === replaceAt) jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
      jobs.run();
      late = jobs.last.late;
    }
    return { at: done.at, late };
  }

  it("runs a job to its end 100 ms after its crossing at 30 frames a second: the fourth frame, not the sixth", () => {
    // 33.3 ms a frame: frame 3's share starts at 99.9 ms, frame 4's at 133.2.
    // Four shares of 32 slices, then the other 272 at once.
    expect(forcedAt(33.3)).toEqual({ at: 4, late: 272 });
  });

  it("runs a job to its end in the sixth frame after its crossing at 60 frames a second, as before", () => {
    // 16.6 ms a frame: the sixth frame's share starts at 99.6 ms. Six shares
    // of 32 slices, then the other 208 at once.
    expect(forcedAt(16.6)).toEqual({ at: 6, late: 208 });
  });

  it("keeps a replaced job's wait counted from its first crossing's time", () => {
    // Replaced at frame 2 (66.6 ms): still forced at frame 4, 133.2 ms after
    // the first crossing, with 336 of the new job's slices left; counted from
    // the second crossing it would wait to frame 6.
    expect(forcedAt(33.3, 2)).toEqual({ at: 4, late: 336 });
  });

  it("runs every pending job to its end at once when the clock jumps, as a first build does", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const clock = { advance: (ms: number) => { now += ms; } };
    const a = { at: null as number | null }, b = { at: null as number | null };
    jobs.begin({}, job(clock, 100, 0.125, a, () => jobs.frame));
    jobs.begin({}, job(clock, 100, 0.125, b, () => jobs.frame));
    jobs.run();
    // A tab hidden for a minute: the next frame's clock is 60 s on. The
    // first job's other 68 slices and the second's 100, all at once.
    now += 60_000;
    jobs.run();
    expect([a.at, b.at, jobs.last.late]).toEqual([1, 1, 168]);
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
    expect(done.at).toBe(6);
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
      // The budget and one slice.
      expect(t.clock() - before).toBeLessThanOrEqual(4.5);
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
    expect([first.at, second.at, other.at]).toEqual([null, 6, 6]);
    // Four frames of four slices, then in frame 6 the other 24 at once, and
    // the bystander's two, due then too.
    expect(late).toEqual([0, 0, 0, 0, 26]);
  });

  it("starts a slice said to be long only where it fits, or first in a frame, and lets the jobs behind it go on", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const heavy = { at: null as number | null }, light = { at: null as number | null };
    // Two small slices, then one it says takes 3 ms.
    jobs.begin({}, (function* () {
      t.advance(1);
      yield;
      t.advance(1);
      yield 3;
      t.advance(3);
      heavy.at = jobs.frame;
    })());
    jobs.begin({}, job(t, 3, 0.5, light, () => jobs.frame));
    const spent: number[] = [];
    for (let f = 0; f < 3; f++) {
      const before = t.clock();
      jobs.run();
      spent.push(t.clock() - before);
    }
    // Frame 0: the two small slices (2 ms); the long one would end at 5 ms,
    // so it waits, and the other job's three slices run instead. Frame 1:
    // the long one, first.
    expect(spent).toEqual([3.5, 3, 0]);
    expect([light.at, heavy.at]).toEqual([0, 1]);
  });

  it("gives idle work only the budget left while no job is pending, and ends work it drops with return", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    let idleSlices = 0;
    let ended = 0;
    const idleWork = (): Slices => (function* () {
      try {
        for (;;) {
          t.advance(1);
          idleSlices++;
          yield;
        }
      } finally {
        ended++;
      }
    })();
    const owner = {};
    jobs.idle(owner, idleWork());
    const done = { at: null as number | null };
    jobs.begin({}, job(t, 6, 1, done, () => jobs.frame));
    jobs.run();
    // A job pending: its four slices, no idle work.
    expect([jobs.last.slices, jobs.last.idle, idleSlices]).toEqual([4, 0, 0]);
    jobs.run();
    // The job's last two slices, then idle work with the 2 ms left.
    expect([done.at, jobs.last.slices, jobs.last.idle]).toEqual([1, 2, 2]);
    jobs.run();
    expect(jobs.last.idle).toBe(4);
    // Replaced, and the new work cleared once it has run: each ended where
    // it stood.
    jobs.idle(owner, idleWork());
    expect(ended).toBe(1);
    jobs.run();
    jobs.idle(owner, null);
    jobs.run();
    expect([jobs.last.idle, ended]).toEqual([0, 2]);
    // A job dropped by its owner is ended the same way.
    let jobEnded = false;
    jobs.begin(owner, (function* () {
      try {
        for (;;) {
          t.advance(3);
          yield;
        }
      } finally {
        jobEnded = true;
      }
    })());
    jobs.run();
    expect(jobEnded).toBe(false);
    jobs.cancel(owner);
    expect(jobEnded).toBe(true);
  });

  it("shares the idle budget between owners a slice each in turn", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const order: string[] = [];
    const work = (name: string): Slices => (function* () {
      for (;;) {
        t.advance(1);
        order.push(name);
        yield;
      }
    })();
    jobs.idle({}, work("a"));
    jobs.idle({}, work("b"));
    jobs.run();
    expect(order).toEqual(["a", "b", "a", "b"]);
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

  it("sorts in slices into exactly the order Array.prototype.sort leaves, ties as they came", () => {
    // A fixed pseudo-random list with many equal keys, tagged by position.
    let state = 7;
    const list: { key: number; at: number }[] = [];
    for (let at = 0; at < 20_000; at++) {
      state = (state * 48271) % 2147483647;
      list.push({ key: state % 997, at });
    }
    const byKey = (a: { key: number }, b: { key: number }): number => a.key - b.key;
    const want = [...list].sort(byKey);
    const got = [...list];
    const slices = sortSlices(got, byKey);
    let n = 0;
    while (slices.next().done !== true) n++;
    expect(got.map((e) => e.at)).toEqual(want.map((e) => e.at));
    // 20,000 elements over 15 passes, a slice ending at the first merge to
    // bring its moves to 8,192.
    expect(n).toBe(32);
    const empty: number[] = [];
    expect([...sortSlicesDone(empty), ...sortSlicesDone([3])]).toEqual([3]);
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

describe("a view's next crossing", () => {
  it("is where it reaches first a line of the grid, a millimetre past it", () => {
    const out = new Float64Array(2);
    // Heading mostly along x: the x line at 11 comes before the z line at 11.
    expect(nextCrossing(10.5, 10.5, 1, 0.3, 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(11.001, 9);
    expect(out[1]).toBeCloseTo(10.5 + 0.501 * 0.3, 9);
    // Heading down z: the line below, then a millimetre under it.
    expect(nextCrossing(10.5, 10.25, 0, -0.1, 1, out)).toBe(true);
    expect([out[0], out[1]]).toEqual([10.5, 9.999]);
    // Standing still: none.
    expect(nextCrossing(10.5, 10.5, 0, 0, 1, out)).toBe(false);
  });

  it("is re-aimed when the view turns, and only then", () => {
    const h = { x: 0, z: 0 };
    expect(turn(h, 0.08, 0.02)).toBe(true);
    expect(turn(h, 0.09, 0.01)).toBe(false);
    expect(turn(h, 0, 0)).toBe(false);
    expect(turn(h, 0.09, -0.01)).toBe(true);
    expect(turn(h, Number.NaN, 1)).toBe(false);
    expect(h).toEqual({ x: 0.09, z: -0.01 });
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
    // A cell of 10 m: the boost's 2.4 m a frame is under half a cell, and
    // still more than a metre.
    const wide = createCrossing();
    const on10 = (x: number) => crossingAt(wide, x, 0, Math.floor(x / 10) * 10, 0, 10, true);
    on10(18.5);
    expect(on10(20.9)).toBe("now");
    on10(29.95);
    expect(on10(30.04)).toBe("later");
  });
});
