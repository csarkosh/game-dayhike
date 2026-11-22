import { describe, expect, it } from "vitest";
import { runBySlices } from "../../testing/sliceRun.js";
import {
  SLICE_READ_UNITS, SLICE_TARGET_MS, SYNC_BUDGET_MS, SYNC_PATIENT_MAX_MS, SYNC_PATIENT_WAIT_FRAMES, SYNC_LATE_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX, SYNC_OVERDUE_MS,
  createCrossing, createSyncJobs, crossingAt, finish, nextCrossing, sliceDue, sortSlices, turn,
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
    expect([SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, SYNC_LATE_MS_MAX, SYNC_LATE_BUDGET_MS, SYNC_OVERDUE_MS, SYNC_PATIENT_MAX_MS]).toEqual([4, 6, 100, 8, 1000, 9.5]);
    expect([SLICE_TARGET_MS, SLICE_READ_UNITS]).toEqual([1.5, 8]);
  });

  /** A job of 400 slices of 0.125 ms begun at frame 0, with the clock set to
   * `frameMs` times the frame as each frame's share starts (the ordinary share
   * runs 32 slices, the late one 64): the frame whose share ran it to its end,
   * and how many slices each frame ran late. `replaceAt` begins it again at
   * that frame. */
  function lateAt(frameMs: number, replaceAt: number | null = null): { at: number | null; late: number[] } {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const done = { at: null as number | null };
    const clock = { advance: (ms: number) => { now += ms; } };
    const owner = {};
    jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f < 12 && done.at === null; f++) {
      now = f * frameMs;
      if (f === replaceAt) jobs.begin(owner, job(clock, 400, 0.125, done, () => jobs.frame));
      jobs.run();
      late.push(jobs.last.late);
    }
    return { at: done.at, late };
  }

  it("makes a job late 100 ms after its crossing at 30 frames a second: the fifth frame, not the seventh", () => {
    // 33.3 ms a frame: frame 3's share starts at 99.9 ms, frame 4's at 133.2.
    // Four ordinary shares of 32 slices, then late shares of 64, the last
    // of the 16 slices left.
    expect(lateAt(33.3)).toEqual({ at: 8, late: [0, 0, 0, 0, 64, 64, 64, 64, 16] });
  });

  it("makes a job late in the seventh frame after its crossing at 60 frames a second, as before", () => {
    // 16.6 ms a frame: the sixth frame's share starts at 99.6 ms, and a job
    // begun at frame 0 is six frames old there.
    expect(lateAt(16.6)).toEqual({ at: 9, late: [0, 0, 0, 0, 0, 0, 64, 64, 64, 16] });
  });

  it("keeps a replaced job's wait counted from its first crossing's time", () => {
    // Replaced at frame 2 (66.6 ms): late at frame 4, 133.2 ms after the
    // first crossing, with the new job's 400 slices to make; counted from the
    // second crossing it would be late at frame 6.
    expect(lateAt(33.3, 2)).toEqual({ at: 9, late: [0, 0, 0, 0, 64, 64, 64, 64, 64, 16] });
  });

  it("runs every pending job to its end at once when the clock jumps, as a first build does", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const clock = { advance: (ms: number) => { now += ms; } };
    const a = { at: null as number | null }, b = { at: null as number | null };
    jobs.begin({}, job(clock, 100, 0.125, a, () => jobs.frame));
    jobs.begin({}, job(clock, 100, 0.125, b, () => jobs.frame));
    jobs.run();
    // A tab hidden for a minute: the next frame's clock is 60 s on, so both are
    // overdue. The first job's other 68 slices and the second's 100, all at
    // once, none of them under the late share.
    now += 60_000;
    jobs.run();
    expect([a.at, b.at, jobs.last.overdue, jobs.last.overdueJobs, jobs.last.late]).toEqual([1, 1, 168, 2, 0]);
    expect(jobs.last.lateMs).toBe(jobs.last.ms);
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

  it("gives a late job the late share a frame and no more, and ends it over the frames after", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    // 100 slices of 1 ms: the ordinary share alone would take 25 frames.
    jobs.begin(owner, job(t, 100, 1, done, () => jobs.frame));
    const late: number[] = [];
    const spent: number[] = [];
    for (let f = 0; f < 16; f++) {
      const before = t.clock();
      jobs.run();
      late.push(jobs.last.late);
      spent.push(t.clock() - before);
    }
    // Four slices a frame for six frames, then eight a frame, the last four.
    expect(late).toEqual([0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4, 0].slice(0, 16));
    expect(Math.max(...spent)).toBeLessThanOrEqual(SYNC_LATE_BUDGET_MS);
    expect(done.at).toBe(15);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("stops a late job at the late share even when its slices are long, and goes on next frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    jobs.begin(owner, job(t, 30, 3, done, () => jobs.frame));
    // Two slices of 3 ms an ordinary frame: the second begins at 3 ms, under the 4.
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) jobs.run();
    const before = t.clock();
    jobs.run();
    // The share is looked at before each slice: they begin at 0, 3 and 6 ms, and the one at 9 does not.
    expect(t.clock() - before).toBe(9);
    expect(jobs.last.late).toBe(3);
    expect(jobs.pending(owner)).toBe(true);
    expect(done.at).toBeNull();
  });

  it("goes to the late jobs first, ahead of one queued before it that is not late", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: string[] = [];
    const named = (name: string): Slices => (function* () {
      for (let i = 0; i < 100; i++) {
        if (ran[ran.length - 1] !== name || i === 0) ran.push(name);
        t.advance(1);
        yield;
      }
    })();
    const first = {}, second = {};
    // `second` is begun patient at frame 0, and again as an ordinary job at frame 4, behind `first`, which is begun then: but its crossing is the older.
    jobs.begin(second, named("second"), true);
    for (let f = 0; f < 4; f++) jobs.run();
    jobs.begin(first, named("first"));
    jobs.begin(second, named("second"));
    // Frames 4 and 5: `first` is queued first and takes the ordinary share, `second` the rest if any.
    jobs.run();
    jobs.run();
    expect(jobs.last.late).toBe(0);
    ran.length = 0;
    // Frame 6: `second`'s crossing is six frames old, `first`'s two.
    jobs.run();
    expect(jobs.last.late).toBe(8);
    expect(ran[0]).toBe("second");
    expect(ran).toEqual(["second"]);
  });

  it("runs a job to its end when it is overdue, whatever the share", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    const owner = {};
    jobs.begin(owner, job(t, 400, 1, done, () => jobs.frame));
    jobs.run();
    // A frame whose clock is a second on: the whole of what is left, in one go.
    t.advance(SYNC_OVERDUE_MS);
    const before = t.clock();
    jobs.run();
    expect(done.at).toBe(1);
    expect([jobs.last.overdueJobs, jobs.last.overdue]).toEqual([1, 396]);
    expect(t.clock() - before).toBe(396);
    expect(jobs.pending(owner)).toBe(false);
  });

  it("makes a job replaced again and again overdue a second after the first crossing", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = { at: null as number | null };
    // A crossing every 250 ms of the clock, each beginning a job the share cannot finish.
    let overdueAt = -1;
    jobs.begin(owner, job(t, 1000, 1, done, () => jobs.frame));
    for (let f = 0; f < 12 && overdueAt < 0; f++) {
      t.advance(250);
      jobs.begin(owner, job(t, 1000, 1, done, () => jobs.frame));
      jobs.run();
      if (jobs.last.overdueJobs > 0) overdueAt = f;
    }
    // Begun at 0, replaced at 250, 500 and 750 ms (the share's own time counted), overdue when a frame starts a second on.
    expect(overdueAt).toBe(3);
    expect(done.at).toBe(jobs.frame - 1);
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
    // A further crossing, two frames on: the new rebuild is late six frames
    // after the first one began, and still ahead of the bystander.
    jobs.begin(owner, job(t, 40, 1, second, () => jobs.frame));
    const late: number[] = [];
    for (let f = 2; f <= 9; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    expect([first.at, second.at, other.at]).toEqual([null, 8, 9]);
    // Four frames of four slices (the new job's first 16), then three of the late
    // share's eight (its other 24), the bystander's two after it: the bystander
    // is late too, and has no share while the job ahead of it takes the late one.
    expect(late).toEqual([0, 0, 0, 0, 8, 8, 8, 2]);
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

  it("never runs a patient job to its end at once, and gives it what the other jobs leave", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const slow = { at: null as number | null }, quick = { at: null as number | null };
    const patches = {}, rings = {};
    // 100 slices of 1 ms begun first, as patient; then 12 of 1 ms.
    jobs.begin(patches, job(t, 100, 1, slow, () => jobs.frame), true);
    jobs.begin(rings, job(t, 12, 1, quick, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f < 30; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    // The other first, four slices a frame, though begun after; then the
    // patient one at four a frame, never late: 25 frames from frame 3.
    expect(late.every((n) => n === 0)).toBe(true);
    expect([quick.at, slow.at]).toEqual([2, 27]);
    expect(jobs.pending(patches)).toBe(false);
  });

  it("moves a job begun again as no longer patient ahead of the patient ones, and lets it be late", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const a = { at: null as number | null }, b = { at: null as number | null };
    const first = {}, second = {};
    jobs.begin(first, job(t, 100, 1, a, () => jobs.frame), true);
    jobs.begin(second, job(t, 100, 1, b, () => jobs.frame), true);
    // The second begun again as an ordinary job: ahead of the first, and
    // run to its end six frames after its first crossing, frame 0.
    jobs.begin(second, job(t, 30, 1, b, () => jobs.frame));
    const late: number[] = [];
    for (let f = 0; f <= SYNC_LATE_FRAMES_MAX; f++) {
      jobs.run();
      late.push(jobs.last.late);
    }
    expect([a.at, b.at]).toEqual([null, 6]);
    // Six frames of four of its slices, then the other 6 at once.
    expect(late).toEqual([0, 0, 0, 0, 0, 0, 6]);
  });

  it("keeps a patient job patient when it is begun again, and its place behind the others", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null }, other = { at: null as number | null };
    const patches = {}, rings = {};
    jobs.begin(patches, job(t, 40, 1, first, () => jobs.frame), true);
    jobs.run();
    jobs.begin(rings, job(t, 8, 1, other, () => jobs.frame));
    jobs.begin(patches, job(t, 40, 1, second, () => jobs.frame), true);
    for (let f = 1; f < 14; f++) {
      jobs.run();
      expect(jobs.last.late).toBe(0);
    }
    expect([first.at, other.at, second.at]).toEqual([null, 2, 12]);
  });

  it("runs idle work while only patient jobs are pending, and none while another is", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    let idleSlices = 0;
    jobs.idle({}, (function* () {
      for (;;) {
        t.advance(1);
        idleSlices++;
        yield;
      }
    })());
    const slow = { at: null as number | null }, quick = { at: null as number | null };
    // A patient job whose slices say they take 3 ms: one a frame, first.
    jobs.begin({}, (function* () {
      for (let i = 0; i < 4; i++) {
        t.advance(2);
        yield 3;
      }
      slow.at = jobs.frame;
    })(), true);
    jobs.run();
    // Its slice, then idle work with the 2 ms left.
    expect([jobs.last.slices, jobs.last.idle]).toEqual([1, 2]);
    // An ordinary job besides, ten slices of 0.5 ms: eight fill the share, the
    // patient job's slice (the floor's, which its 3 ms fit in the 9.5) makes nine,
    // and while the ordinary one is pending no idle work runs.
    jobs.begin({}, job(t, 10, 0.5, quick, () => jobs.frame));
    jobs.run();
    expect([quick.at, jobs.last.slices, jobs.last.idle, jobs.last.floor]).toEqual([null, 9, 0, 1]);
    // Its last two slices, the patient one's, and idle work again.
    jobs.run();
    expect([quick.at, jobs.last.slices, jobs.last.idle]).toEqual([2, 3, 1]);
    expect(idleSlices).toBe(3);
  });

  it("lets the idle work behind a long slice go on, and puts the long one first the next frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: string[] = [];
    const work = (name: string, first: number, then: number): Slices => (function* () {
      t.advance(first);
      ran.push(`${name}${jobs.frame}`);
      for (;;) {
        yield then;
        t.advance(then);
        ran.push(`${name}${jobs.frame}`);
      }
    })();
    // a: 1.5 ms, then slices said to take 3 ms; b: slices of 1 ms.
    jobs.idle({}, work("a", 1.5, 3));
    jobs.idle({}, work("b", 1, 1));
    jobs.run();
    jobs.run();
    // Frame 0: a, b, then a's long one waits and b goes on while it fits.
    // Frame 1: a's long one first, then b with what is left.
    expect(ran).toEqual(["a0", "b0", "b0", "a1", "b1"]);
  });

  it("starts an idle slice said to be long only where it fits, or first in a frame", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const ran: number[] = [];
    // A slice of 1.5 ms, then two it says take 3 ms each.
    jobs.idle({}, (function* () {
      t.advance(1.5);
      ran.push(jobs.frame);
      yield 3;
      t.advance(3);
      ran.push(jobs.frame);
      yield 3;
      t.advance(3);
      ran.push(jobs.frame);
    })());
    for (let f = 0; f < 4; f++) jobs.run();
    // Frame 0: the first; the next would end at 4.5 ms, so it waits for
    // frame 1, where it is first, and the third, which would end at 6 ms,
    // for frame 2.
    expect(ran).toEqual([0, 1, 2]);
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

  it("sorts the same order cut at every reading of the scheduler's clock, merges of the whole list included", () => {
    const keys = Array.from({ length: 5000 }, (_, i) => ({ k: (i * 7919) % 211, i }));
    const expected = [...keys].sort((a, b) => a.k - b.k);
    const list = [...keys];
    const run = runBySlices(sortSlices(list, (a, b) => a.k - b.k));
    expect(list).toEqual(expected);
    // Cut inside the passes: the count of elements moved alone makes 8 slices of these 5000 elements in 13 passes.
    expect(run.slices).toBeGreaterThan(30);
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
  /** The page's clock, a frame of 60 a second on at every view unless a test says how long its frame was. */
  let clock = 0;
  const at = (c: ReturnType<typeof createCrossing>, x: number, z: number, deferrable = true, frameMs = 1000 / 60) =>
    crossingAt(c, x, z, Math.floor(x / CELL) * CELL, Math.floor(z / CELL) * CELL, CELL, deferrable, (clock += frameMs));

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
    const on10 = (x: number) => crossingAt(wide, x, 0, Math.floor(x / 10) * 10, 0, 10, true, (clock += 1000 / 60));
    on10(18.5);
    expect(on10(20.9)).toBe("now");
    on10(29.95);
    expect(on10(30.04)).toBe("later");
  });

  it("reads a step by the view's speed, so a slow frame at a sprint is a job and not a burst", () => {
    const c = createCrossing();
    at(c, 10.5, 10.5);
    // A sprint, 7 m/s, over one frame of 200 ms: 1.4 m, across a line. At 60 frames a second
    // that step is the free camera's (below); over 200 ms it is 0.117 m a frame, a run.
    expect(at(c, 11.9, 10.5, true, 200)).toBe("none");
    expect(at(c, 13.3, 10.5, true, 200)).toBe("later");
    // The same 1.4 m in one frame of 60 a second: at once.
    at(c, 13.9, 10.5);
    expect(at(c, 15.3, 10.5)).toBe("now");
    // The free camera's boost in a frame shorter than one of 60 a second is still a burst: 1.8 m in 12.5 ms.
    at(c, 15.5, 10.5);
    expect(at(c, 17.3, 10.5, true, 12.5)).toBe("now");
    // A jump of more than a cell is a jump, however long the frame.
    expect(at(c, 30.5, 10.5, true, 5000)).toBe("now");
    // A frame shorter than one of 60 a second is not scaled up: the uncapped page's 2 ms frames.
    const fast = createCrossing();
    at(fast, 11.95, 10.5);
    expect(at(fast, 12.0, 10.5, true, 2)).toBe("later");
  });

  it("takes a first view's step as it is, having no frame before it", () => {
    const c = createCrossing();
    expect(Number.isNaN(c.lastAt)).toBe(true);
    expect(at(c, 10.5, 10.5, true, 5000)).toBe("now");
    expect(c.lastAt).toBe(clock);
  });
});

describe("the jobs' milliseconds, by owner", () => {
  it("counts a frame's slices' time under the owner's name, and the late run's time apart", () => {
    const { clock, advance } = testClock();
    const jobs = createSyncJobs(clock);
    const done = { at: null as number | null };
    jobs.begin({}, job({ advance }, 3, 0.5, done, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.ms).toBeCloseTo(1.5, 9);
    expect(jobs.last.lateMs).toBe(0);
    expect(jobs.last.owners.clipmap).toBeCloseTo(1.5, 9);
    expect(done.at).toBe(0);
    // A job of 50 slices of 1 ms gets 4 a frame; at its sixth frame it is late and gets the late share.
    const long = { at: null as number | null };
    jobs.begin({}, job({ advance }, 50, 1, long, () => jobs.frame), false, "forest");
    for (let f = 0; f < 6; f++) jobs.run();
    expect(jobs.last.owners.clipmap).toBe(0);
    expect(jobs.last.lateMs).toBe(0);
    expect(long.at).toBeNull();
    jobs.run();
    expect(long.at).toBeNull();
    expect(jobs.last.lateMs).toBe(8);
    expect(jobs.last.ms).toBe(jobs.last.lateMs);
    expect(jobs.last.owners.forest).toBe(jobs.last.ms);
    // The other 18 slices: eight, eight, then two, which end the job.
    jobs.run();
    jobs.run();
    expect(long.at).toBeNull();
    jobs.run();
    expect(long.at).toBe(10);
    expect(jobs.last.lateMs).toBe(2);
    // An unnamed owner counts under "other".
    jobs.begin({}, job({ advance }, 2, 0.25, { at: null }, () => jobs.frame));
    jobs.run();
    expect(jobs.last.owners.other).toBeCloseTo(0.5, 9);
  });
});

describe("a slice that ends by the clock", () => {
  /** A builder of `samples` samples, each costing `ms` of a test clock, that asks `sliceDue` after each; the slices it was cut into, by their samples. */
  function sampler(clock: { advance(ms: number): void }, samples: number, ms: number, cuts: number[]): Slices {
    return (function* () {
      let since = 0;
      for (let i = 0; i < samples; i++) {
        clock.advance(ms);
        since++;
        if (sliceDue()) {
          cuts.push(since);
          since = 0;
          yield;
        }
      }
      cuts.push(since);
    })();
  }

  it("ends by the target, held past it by at most one reading's interval of samples", () => {
    for (const ms of [0.01, 0.1, 0.4]) {
      const t = testClock();
      const jobs = createSyncJobs(t.clock);
      const cuts: number[] = [];
      const owner = {};
      jobs.begin(owner, sampler(t, 2000, ms, cuts));
      for (let frames = 0; jobs.pending(owner) && frames < 5000; frames++) jobs.run();
      // Every slice but the last ran its samples in a time that is at least the target (it ended because of it) and under the target and one reading's interval.
      const longest = Math.max(...cuts.slice(0, -1)) * ms;
      expect(Math.min(...cuts.slice(0, -1)) * ms).toBeGreaterThanOrEqual(SLICE_TARGET_MS - 1e-9);
      expect(longest).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * ms + 1e-9);
      expect(cuts.reduce((a, b) => a + b, 0)).toBe(2000);
    }
  });

  it("reads the clock once every SLICE_READ_UNITS units, not at every sample", () => {
    let reads = 0;
    let now = 0;
    const jobs = createSyncJobs(() => {
      reads++;
      return now;
    });
    jobs.begin({}, (function* () {
      const before = reads;
      for (let i = 0; i < 64; i++) sliceDue();
      // 64 calls: eight readings, none of them past the target.
      expect(reads - before).toBe(64 / SLICE_READ_UNITS);
      now += 0;
      yield;
    })());
    jobs.run();
    expect(reads).toBeGreaterThan(8);
  });

  it("counts a call's units: a unit more than the interval reads at once", () => {
    let now = 0;
    const jobs = createSyncJobs(() => now);
    const seen: boolean[] = [];
    jobs.begin({}, (function* () {
      now += 2;
      seen.push(sliceDue(1), sliceDue(SLICE_READ_UNITS));
      yield;
    })());
    jobs.run();
    expect(seen).toEqual([false, true]);
  });

  it("is false outside a scheduler's slice, so a build at once runs through", () => {
    expect(sliceDue()).toBe(false);
    expect(sliceDue(1000)).toBe(false);
    const cuts: number[] = [];
    const t = testClock();
    const slices = sampler(t, 500, 1, cuts);
    finish(slices);
    expect(cuts).toEqual([500]);
  });

  it("is not carried from one slice into the next, or out of the scheduler", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const cuts: number[] = [];
    jobs.begin({}, sampler(t, 100, 0.5, cuts));
    jobs.run();
    // After a share the gate is closed again.
    expect(sliceDue(1000)).toBe(false);
    // And a slice that begins late in a frame is given its own target, not what was left of the last.
    jobs.run();
    expect(cuts.slice(0, 2).every((n) => n * 0.5 >= SLICE_TARGET_MS - 1e-9)).toBe(true);
  });

  it("gives idle work the same bound", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const cuts: number[] = [];
    jobs.idle({}, sampler(t, 1000, 0.1, cuts));
    for (let f = 0; f < 200 && cuts.reduce((a, b) => a + b, 0) < 1000; f++) jobs.run();
    expect(Math.max(...cuts.slice(0, -1)) * 0.1).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * 0.1 + 1e-9);
    expect(jobs.last.longest.idle).toBeLessThanOrEqual(SLICE_TARGET_MS + SLICE_READ_UNITS * 0.1 + 1e-9);
  });
});

describe("what an apply step takes", () => {
  /** A job that does `small` slices of `smallMs`, says its apply takes `said` ms, and then spends `real` ms in it. */
  function applying(t: { advance(ms: number): void }, small: number, smallMs: number, said: number, real: number, done: { at: number | null }, frame: () => number): Slices {
    return (function* () {
      for (let i = 0; i < small; i++) {
        t.advance(smallMs);
        yield;
      }
      yield said;
      t.advance(real);
      done.at = frame();
    })();
  }

  it("learns an owner's figure from what its announced slices took", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    jobs.begin({}, applying(t, 0, 0, 1, 6, done, () => jobs.frame), false, "forest");
    jobs.run();
    expect(jobs.last.learned.forest).toBe(6);
    expect(done.at).toBe(0);
    // A second one weighs in at a quarter.
    // (Its apply, learned to take 6 ms, waits for a frame it is first in.)
    jobs.begin({}, applying(t, 0, 0, 1, 2, done, () => jobs.frame), false, "forest");
    jobs.run();
    jobs.run();
    expect(jobs.last.learned.forest).toBeCloseTo(5, 9);
  });

  it("keeps an apply out of a frame it does not fit, by the learned figure where it is more than the builder's", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const first = { at: null as number | null }, second = { at: null as number | null };
    // The first teaches the scheduler that "forest" applies take 3 ms where they say 1.
    jobs.begin({}, applying(t, 0, 0, 1, 3, first, () => jobs.frame), false, "forest");
    jobs.run();
    // A frame that has spent 2 ms on an older job: the apply says 1 ms and would fit in the 4, but it is learned to take 3.
    jobs.begin({}, job(t, 2, 1.5, { at: null }, () => jobs.frame));
    jobs.begin({}, applying(t, 0, 0, 1, 3, second, () => jobs.frame), false, "forest");
    jobs.run();
    expect(second.at).toBeNull();
    // Next frame it is first in the frame, so it runs whatever it takes.
    jobs.run();
    expect(second.at).toBe(2);
    expect(first.at).toBe(0);
  });

  it("starts an apply that is the first slice of a frame whatever it is learned to take, and never holds it for ever", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    // An apply learned at 30 ms, far past the share.
    jobs.begin({}, applying(t, 0, 0, 1, 30, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.learned.clipmap).toBe(30);
    // Behind a job of 40 slices of 1 ms: the apply waits while that job takes the share, then is first in a frame.
    const owner = {};
    jobs.begin({}, job(t, 6, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, applying(t, 0, 0, 1, 30, done, () => jobs.frame), false, "clipmap");
    for (let f = 0; f < 10 && done.at === null; f++) jobs.run();
    expect(done.at).not.toBeNull();
    expect(jobs.pending(owner)).toBe(false);
  });

  it("trusts what a builder says when it is more than the learned figure", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const learned = { at: null as number | null }, later = { at: null as number | null };
    jobs.begin({}, applying(t, 0, 0, 1, 0.5, learned, () => jobs.frame), false, "clipmap");
    jobs.run();
    // 2 ms of another job's, then an apply that says 3: 2 + 3 > 4, so it waits.
    jobs.begin({}, job(t, 1, 2, { at: null }, () => jobs.frame));
    jobs.begin({}, applying(t, 0, 0, 3, 0.5, later, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(later.at).toBeNull();
  });

  it("does not learn from a slice that said nothing", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, job(t, 3, 0.5, { at: null }, () => jobs.frame), false, "clutter");
    jobs.run();
    expect(jobs.last.learned.clutter).toBeUndefined();
  });

  it("holds an apply that does not fit the late share to the next frame too", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const owner = {};
    const done = { at: null as number | null };
    // Teach "forest" 5 ms.
    jobs.begin({}, applying(t, 0, 0, 5, 5, { at: null }, () => jobs.frame), false, "forest");
    jobs.run();
    // A late job that has used 4 ms of the late share, then another whose apply is 5: 4 + 5 > 8, so it waits.
    const slow = {};
    jobs.begin(slow, job(t, 200, 1, { at: null }, () => jobs.frame));
    jobs.begin(owner, applying(t, 0, 0, 1, 5, done, () => jobs.frame), false, "forest");
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX; f++) jobs.run();
    jobs.run();
    expect(jobs.last.late).toBeGreaterThan(0);
    expect(done.at).toBeNull();
  });
});

describe("the longest slice an owner ran", () => {
  it("records the longest single slice by owner until it is reset", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, (function* () {
      t.advance(1);
      yield;
      t.advance(3);
      yield;
      t.advance(2);
    })(), false, "clipmap");
    jobs.run();
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(3);
    jobs.begin({}, job(t, 1, 2.5, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(3);
    jobs.resetLongest();
    jobs.begin({}, job(t, 1, 0.5, { at: null }, () => jobs.frame), false, "clipmap");
    jobs.run();
    expect(jobs.last.longest.clipmap).toBe(0.5);
  });
});

describe("a patient job under busy jobs", () => {
  it("is given one slice a frame the other jobs' share left none for, and no more than the late share and a slice is spent", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const patches = {};
    const patchesDone = { at: null as number | null };
    // The ordinary jobs take the whole share for ever: a new one of 50 slices of 1 ms whenever the last ends.
    const busy = {};
    const keepBusy = (): Slices => (function* () {
      for (let i = 0; i < 50; i++) {
        t.advance(1);
        yield;
      }
    })();
    jobs.begin(busy, keepBusy());
    jobs.begin(patches, job(t, 20, 1, patchesDone, () => jobs.frame), true);
    const spent: number[] = [];
    let floors = 0;
    for (let f = 0; f < 60 && patchesDone.at === null; f++) {
      if (!jobs.pending(busy)) jobs.begin(busy, keepBusy());
      const before = t.clock();
      jobs.run();
      spent.push(t.clock() - before);
      floors += jobs.last.floor;
    }
    // Four slices of the busy job take the ordinary share, and the patient job's slice is the fifth: 5 ms a frame, and it ends.
    expect(patchesDone.at).not.toBeNull();
    expect(floors).toBeGreaterThan(15);
    expect(Math.max(...spent)).toBeLessThanOrEqual(SYNC_LATE_BUDGET_MS + 1.5);
    expect(jobs.pending(patches)).toBe(false);
  });

  it("holds a patient apply that does not fit to the next frames, and gives it a slice once it has waited for the floor", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    const done = { at: null as number | null };
    // The ordinary jobs take the whole share for ever.
    const busy = {};
    const keepBusy = (): Slices => (function* () {
      for (let i = 0; i < 400; i++) {
        t.advance(1);
        yield;
      }
    })();
    jobs.begin(busy, keepBusy());
    // A patient job whose apply says it takes 6 ms, after a first slice that takes nothing.
    jobs.begin({}, (function* () {
      yield;
      yield 6;
      t.advance(6);
      done.at = jobs.frame;
    })(), true);
    jobs.run();
    // The first slice is the floor's; the apply would end at 4 + 6, past 9.5, so it waits.
    expect(jobs.last.floor).toBe(1);
    let waited = 0;
    while (done.at === null && waited < 100) {
      jobs.run();
      waited++;
    }
    // The second slice (which says what the apply takes) is the next frame's floor; the apply then waits the frames it is given, and starts whatever it says.
    expect(waited).toBe(SYNC_PATIENT_WAIT_FRAMES + 2);
    expect(done.at).not.toBeNull();
  });

  it("changes nothing for a frame in which a patient job already ran, or where there is none", () => {
    const t = testClock();
    const jobs = createSyncJobs(t.clock);
    jobs.begin({}, job(t, 3, 1, { at: null }, () => jobs.frame), true);
    jobs.run();
    expect(jobs.last.floor).toBe(0);
    jobs.begin({}, job(t, 3, 1, { at: null }, () => jobs.frame));
    jobs.run();
    expect(jobs.last.floor).toBe(0);
  });
});
