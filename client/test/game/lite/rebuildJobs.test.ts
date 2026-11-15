import { describe, expect, it } from "vitest";
import { createFirstBuilds } from "../../../src/game/firstBuilds.js";
import { cellOrigin, createRebuilds, type Rebuilds } from "../../../src/game/lite/rebuildJobs.js";
import { SYNC_LATE_FRAMES_MAX, createSyncJobs, type Slices, type SyncJobs } from "../../../src/game/syncJobs.js";

const CELL = 3;

/**
 * A shell's stand-in: its rebuild is `slices` slices of `ms` each on the
 * test's clock, and what it shows is the view the last whole rebuild was
 * for. `half` is what a frame would draw if a rebuild showed as it went.
 */
function shell(options: { jobs?: SyncJobs; firstBuilds?: ReturnType<typeof createFirstBuilds>; slices?: number; ms?: number } = {}) {
  const clock = { now: 0 };
  const jobs = options.jobs;
  const shown: { x: number; z: number }[] = [];
  const begun: { x: number; z: number }[] = [];
  const ahead: { x: number; z: number; hx: number; hz: number }[] = [];
  let idled = 0;
  const rebuilds: Rebuilds = createRebuilds({
    name: "stand-in",
    cell: CELL,
    origin: cellOrigin(CELL),
    *rebuild(x, z): Slices {
      begun.push({ x, z });
      for (let i = 0; i < (options.slices ?? 8); i++) {
        clock.now += options.ms ?? 1;
        yield;
      }
      shown.push({ x, z });
    },
    *ahead(x, z, hx, hz): Slices {
      ahead.push({ x, z, hx, hz });
      yield;
      idled++;
    },
    jobs,
    firstBuilds: options.firstBuilds,
  });
  return { rebuilds, shown, begun, ahead, clock, idled: () => idled };
}

/** A scheduler on a clock the test advances, and a frame of it: the clock a sixtieth of a second on, then its share. */
function scheduler() {
  const time = { now: 0 };
  const jobs = createSyncJobs(() => time.now);
  const frame = (): void => {
    time.now += 1000 / 60;
    jobs.run();
  };
  return { jobs, frame, time };
}

describe("a shell's rebuilds on the renderer's scheduler", () => {
  it("snaps a view to its grid's lines", () => {
    const out = new Float64Array(2);
    cellOrigin(3)(7.5, -0.5, out);
    expect([...out]).toEqual([6, -3]);
  });

  it("builds every crossing at once, in the call, when it is given no scheduler", () => {
    const s = shell();
    expect(s.rebuilds.update(1, 1)).toBe("now");
    expect(s.rebuilds.update(1.05, 1)).toBe("none");
    expect(s.rebuilds.update(3.05, 1)).toBe("now");
    expect(s.shown).toEqual([{ x: 1, z: 1 }, { x: 3.05, z: 1 }]);
    expect(s.rebuilds.pending()).toBe(false);
  });

  it("builds the first view at once and a crossing at a walk as a job, shown whole some frames later", () => {
    const { jobs, frame } = scheduler();
    const s = shell({ jobs, slices: 8, ms: 0 });
    expect(s.rebuilds.update(2.9, 0)).toBe("now");
    expect(s.shown).toHaveLength(1);
    frame();
    expect(s.rebuilds.update(2.95, 0)).toBe("none");
    frame();
    // A walk: a twentieth of a metre a frame across the line at 3 m.
    expect(s.rebuilds.update(3.0, 0)).toBe("later");
    expect(s.rebuilds.pending()).toBe(true);
    expect(s.shown).toHaveLength(1);
    frame();
    expect(s.shown).toEqual([{ x: 2.9, z: 0 }, { x: 3.0, z: 0 }]);
    expect(s.rebuilds.pending()).toBe(false);
  });

  it("shows nothing of a rebuild before its last slice, however many frames it takes", () => {
    const time = { now: 0 };
    const jobs = createSyncJobs(() => time.now);
    const shown: number[] = [];
    let slicesRun = 0;
    const rebuilds = createRebuilds({
      name: "stand-in",
      cell: CELL,
      origin: cellOrigin(CELL),
      *rebuild(x): Slices {
        // Twelve slices of 1.5 ms: a frame's share of 4 ms runs three of them.
        for (let i = 0; i < 12; i++) {
          time.now += 1.5;
          slicesRun++;
          yield;
        }
        shown.push(x);
      },
      jobs,
    });
    rebuilds.update(2.9, 0);
    expect(shown).toEqual([2.9]);
    slicesRun = 0;
    time.now += 16;
    jobs.run();
    rebuilds.update(3.0, 0);
    const seen: number[] = [];
    for (let f = 0; f < 4; f++) {
      time.now += 16;
      jobs.run();
      seen.push(shown.length);
    }
    // Three slices a frame: after four frames the twelve have run, and the list was the old one whole until the last.
    expect(slicesRun).toBe(12);
    expect(seen).toEqual([1, 1, 1, 1]);
    time.now += 16;
    jobs.run();
    expect(shown).toEqual([2.9, 3.0]);
  });

  it("runs a rebuild to its end once it is as late as the game lets a job be", () => {
    const time = { now: 0 };
    const jobs = createSyncJobs(() => time.now);
    const shown: number[] = [];
    const rebuilds = createRebuilds({
      name: "stand-in",
      cell: CELL,
      origin: cellOrigin(CELL),
      *rebuild(x): Slices {
        // A hundred slices of 2 ms: two a frame's share, so the budget alone would take fifty frames.
        for (let i = 0; i < 100; i++) {
          time.now += 2;
          yield;
        }
        shown.push(x);
      },
      jobs,
    });
    rebuilds.update(2.9, 0);
    time.now += 1;
    jobs.run();
    rebuilds.update(3.0, 0);
    let frames = 0;
    while (shown.length < 2) {
      // The frames come a millisecond apart, so the bound in frames is the one reached.
      time.now += 1;
      jobs.run();
      frames++;
      expect(frames).toBeLessThanOrEqual(SYNC_LATE_FRAMES_MAX + 1);
    }
    expect(frames).toBe(SYNC_LATE_FRAMES_MAX + 1);
  });

  it("replaces a rebuild still pending with the one for the newer view, and never shows the stale one", () => {
    const { jobs, frame, time } = scheduler();
    const shown: number[] = [];
    const rebuilds = createRebuilds({
      name: "stand-in",
      cell: 1,
      origin: cellOrigin(1),
      *rebuild(x): Slices {
        for (let i = 0; i < 4; i++) {
          time.now += 3;
          yield;
        }
        shown.push(x);
      },
      jobs,
    });
    rebuilds.update(0.98, 0.98);
    frame();
    // A walk along a diagonal: an x line, then a z line a frame later, before the first crossing's rebuild has shown.
    expect(rebuilds.update(1.0, 0.99)).toBe("later");
    frame();
    expect(rebuilds.update(1.02, 1.0)).toBe("later");
    for (let f = 0; f < SYNC_LATE_FRAMES_MAX + 2; f++) frame();
    expect(shown).toEqual([0.98, 1.02]);
  });

  it("builds a jump of more than a cell and a fast view at once, and drops the rebuild they overtake", () => {
    const { jobs, frame } = scheduler();
    const s = shell({ jobs, slices: 40, ms: 0 });
    s.rebuilds.update(0.5, 0);
    frame();
    expect(s.rebuilds.update(3.0, 0)).toBe("now");
    frame();
    expect(s.rebuilds.update(3.05, 0)).toBe("none");
    frame();
    // More than a cell on from the origin last built for.
    expect(s.rebuilds.update(9.5, 0)).toBe("now");
    expect(s.shown.at(-1)).toEqual({ x: 9.5, z: 0 });
    expect(s.rebuilds.pending()).toBe(false);
    frame();
    // Past a metre in one frame of a sixtieth of a second: the free camera's boost.
    expect(s.rebuilds.update(12.0, 0)).toBe("now");
    expect(s.shown.at(-1)).toEqual({ x: 12.0, z: 0 });
  });

  it("aims its idle work once while the view holds its cell, and again when the view turns or a rebuild has shown", () => {
    const { jobs, frame } = scheduler();
    const s = shell({ jobs, slices: 2, ms: 0 });
    s.rebuilds.update(0.5, 0.5);
    frame();
    s.rebuilds.update(0.55, 0.5);
    s.rebuilds.update(0.6, 0.5);
    expect(s.ahead).toHaveLength(0);
    frame();
    // Idle work runs with what the jobs leave: its first slice names where it was aimed from, and on which heading.
    expect(s.ahead).toEqual([{ x: 0.55, z: 0.5, hx: expect.closeTo(0.05, 9), hz: 0 }]);
    frame();
    expect(s.idled()).toBe(1);
    s.rebuilds.update(0.65, 0.5);
    frame();
    expect(s.ahead).toHaveLength(1);
    // The view turns back: the lines its next crossings are on changed.
    s.rebuilds.update(0.6, 0.5);
    frame();
    expect(s.ahead).toHaveLength(2);
    expect(s.ahead[1]?.hx).toBeLessThan(0);
    // A rebuild shown: the idle work is aimed again from the new place.
    s.rebuilds.update(-0.02, 0.5);
    frame();
    frame();
    s.rebuilds.update(-0.04, 0.5);
    frame();
    expect(s.ahead).toHaveLength(3);
  });

  it("hands a build that cannot wait to the loader of first builds while it is open, and prepares nothing ahead of it", () => {
    const { jobs, frame } = scheduler();
    const turns: (() => void)[] = [];
    const firstBuilds = createFirstBuilds({ now: () => 0, later: (run) => void turns.push(run) });
    const s = shell({ jobs, firstBuilds, slices: 3, ms: 0 });
    expect(s.rebuilds.update(0.5, 0.5)).toBe("now");
    expect(s.shown).toHaveLength(0);
    expect(s.rebuilds.pending()).toBe(true);
    s.rebuilds.update(0.55, 0.5);
    frame();
    expect(s.ahead).toHaveLength(0);
    // A new place before the loader has stepped the first: the build it held is dropped for this one's.
    expect(s.rebuilds.update(20, 0.5)).toBe("now");
    expect(firstBuilds.pending()).toBe(1);
    firstBuilds.close();
    expect(s.shown).toEqual([{ x: 20, z: 0.5 }]);
    // The first place's build never began: the loader had not stepped it.
    expect(s.begun).toEqual([{ x: 20, z: 0.5 }]);
    // Closed, the loader runs a build whole in the call, as a shell with none does.
    expect(s.rebuilds.update(40, 0.5)).toBe("now");
    expect(s.shown.at(-1)).toEqual({ x: 40, z: 0.5 });
  });

  it("ends what is pending when the shell goes, and shows nothing after", () => {
    const { jobs, frame } = scheduler();
    const s = shell({ jobs, slices: 50, ms: 0 });
    s.rebuilds.update(2.98, 0);
    frame();
    s.rebuilds.update(3.0, 0);
    expect(s.rebuilds.pending()).toBe(true);
    s.rebuilds.dispose();
    expect(s.rebuilds.pending()).toBe(false);
    for (let f = 0; f < 10; f++) frame();
    expect(s.shown).toEqual([{ x: 2.98, z: 0 }]);
  });
});
