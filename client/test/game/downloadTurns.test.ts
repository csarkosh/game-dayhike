import { describe, expect, it } from "vitest";
import {
  createDownloadTurns, FILM_HIGH_S, FILM_LOW_S, HOLD_BOUND_MS, HOLD_GIVE_UP, LOOK_MS, turnsLine, WIDTH_OPEN, WIDTH_START, WIDTH_TRIAL_MS,
  type FilmState, type TurnsClock, type TurnsCourse,
} from "@csarkosh/engine/game/downloadTurns";

/** A clock moved by hand: `pass(ms)` runs every call that falls due on the way. */
function fakeClock(): TurnsClock & { pass(ms: number): void } {
  let now = 0;
  let calls: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    after(ms, run) {
      const call = { at: now + ms, run };
      calls.push(call);
      return () => {
        calls = calls.filter((c) => c !== call);
      };
    },
    pass(ms) {
      const end = now + ms;
      for (;;) {
        const due = calls.filter((c) => c.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        calls = calls.filter((c) => c !== due);
        now = due.at;
        due.run();
      }
      now = end;
    },
  };
}

/** A download the test settles by hand. */
function download(): { start: () => Promise<string>; started: () => boolean; succeed(): void; fail(): void } {
  let started = false;
  let done: ((value: string) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  return {
    start: () => {
      started = true;
      return new Promise<string>((resolve, reject) => {
        done = resolve;
        failed = reject;
      });
    },
    started: () => started,
    succeed: () => done?.("bytes"),
    fail: () => failed?.(new TypeError("Failed to fetch")),
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A film the test sets: playing, and seconds buffered ahead. */
function fakeFilm(state: FilmState): { probe: () => FilmState; set(next: Partial<FilmState>): void } {
  let now = { ...state };
  return { probe: () => now, set: (next) => (now = { ...now, ...next }) };
}

describe("a hike's downloads taking turns behind the intro's film", () => {
  it("names marks with room between them, under what a browser keeps ahead", () => {
    expect(FILM_LOW_S).toBeLessThan(FILM_HIGH_S);
    expect(FILM_HIGH_S).toBeLessThanOrEqual(9);
    expect(WIDTH_START).toBeGreaterThanOrEqual(1);
    expect(WIDTH_OPEN).toBeGreaterThan(WIDTH_START);
    expect(HOLD_BOUND_MS).toBeGreaterThan(LOOK_MS);
  });

  it("bounds nothing with no film: every download starts at once, in the call", () => {
    const turns = createDownloadTurns(fakeClock());
    const all = Array.from({ length: 50 }, download);
    for (const d of all) void turns.run(d.start);
    expect(all.every((d) => d.started())).toBe(true);
    expect(turns.view().inFlight).toBe(50);
  });

  it("bounds nothing behind a film that does not play (paused, ended, failed, wholly buffered)", () => {
    const turns = createDownloadTurns(fakeClock());
    turns.film(() => ({ playing: false, ahead: 0 }));
    const all = Array.from({ length: 20 }, download);
    for (const d of all) void turns.run(d.start);
    expect(all.every((d) => d.started())).toBe(true);
  });

  it("starts nothing while a playing film is hungry, and the first download waits for it to be fed", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 2 });
    turns.film(film.probe);
    const d = download();
    void turns.run(d.start);
    expect(d.started()).toBe(false);
    film.set({ ahead: FILM_HIGH_S - 0.5 });
    clock.pass(LOOK_MS);
    expect(d.started()).toBe(false);
    film.set({ ahead: FILM_HIGH_S });
    clock.pass(LOOK_MS);
    expect(d.started()).toBe(true);
  });

  it("holds new starts once the film goes hungry, lets what is in flight drain, and starts again once it is fed", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 12 });
    turns.film(film.probe);
    const first = Array.from({ length: WIDTH_START }, download);
    for (const d of first) void turns.run(d.start);
    const later = download();
    void turns.run(later.start);
    expect(first.every((d) => d.started())).toBe(true);
    expect(later.started()).toBe(false);
    // Between the marks a fed film stays fed.
    film.set({ ahead: FILM_LOW_S + 0.5 });
    clock.pass(LOOK_MS);
    expect(turns.view().hungry).toBe(false);
    film.set({ ahead: FILM_LOW_S - 0.5 });
    clock.pass(LOOK_MS);
    expect(turns.view().hungry).toBe(true);
    for (const d of first) d.succeed();
    await settled();
    expect(turns.view().inFlight).toBe(0);
    expect(later.started()).toBe(false);
    // Between the marks a hungry film stays hungry.
    film.set({ ahead: FILM_HIGH_S - 0.5 });
    clock.pass(LOOK_MS);
    expect(later.started()).toBe(false);
    film.set({ ahead: FILM_HIGH_S });
    clock.pass(LOOK_MS);
    expect(later.started()).toBe(true);
  });

  it("doubles the width each time a full width settles while the film is fed, until it is unbounded", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    turns.film(fakeFilm({ playing: true, ahead: 12 }).probe);
    const all = Array.from({ length: 100 }, download);
    for (const d of all) void turns.run(d.start);
    let width = WIDTH_START;
    const seen: number[] = [width];
    let next = 0;
    while (width !== Infinity) {
      expect(turns.view().inFlight).toBe(width);
      clock.pass(WIDTH_TRIAL_MS);
      for (let i = 0; i < width; i++) all[next + i]?.succeed();
      next += width;
      await settled();
      width = turns.view().width;
      seen.push(width);
    }
    expect(seen).toEqual([4, 8, 16, Infinity]);
    expect(WIDTH_OPEN).toBe(32);
    expect(all.every((d) => d.started())).toBe(true);
  });

  it("halves the width each time the film goes hungry, never below one, and an unbounded width from what it has in flight", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 12 });
    turns.film(film.probe);
    // One download in flight that never settles, so the film is looked at.
    void turns.run(download().start);
    const goHungryAndBack = (): void => {
      film.set({ ahead: 1 });
      clock.pass(LOOK_MS);
      film.set({ ahead: 12 });
      clock.pass(LOOK_MS);
    };
    expect(turns.view().width).toBe(4);
    goHungryAndBack();
    expect(turns.view().width).toBe(2);
    goHungryAndBack();
    expect(turns.view().width).toBe(1);
    goHungryAndBack();
    expect(turns.view().width).toBe(1);
    // Opened up again, then hungry with ten in flight: five.
    const fresh = createDownloadTurns(clock);
    const second = fakeFilm({ playing: true, ahead: 12 });
    fresh.film(second.probe);
    const all = Array.from({ length: 60 }, download);
    for (const d of all) void fresh.run(d.start);
    let next = 0;
    while (fresh.view().width !== Infinity) {
      const w = fresh.view().width;
      clock.pass(WIDTH_TRIAL_MS);
      for (let i = 0; i < w; i++) all[next + i]?.succeed();
      next += w;
      await settled();
    }
    expect(fresh.view().inFlight).toBe(60 - next);
    for (let i = next; i < 50; i++) all[i]?.succeed();
    await settled();
    expect(fresh.view().inFlight).toBe(10);
    second.set({ ahead: 1 });
    clock.pass(LOOK_MS);
    expect(fresh.view().width).toBe(5);
  });

  it("doubles a width only once it has stood its trial, however fast its downloads settle", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    turns.film(fakeFilm({ playing: true, ahead: 12 }).probe);
    const all = Array.from({ length: 40 }, download);
    for (const d of all) void turns.run(d.start);
    for (let round = 0; round < 5; round++) {
      for (const d of all.filter((x) => x.started())) d.succeed();
      await settled();
    }
    expect(turns.view().width).toBe(WIDTH_START);
    expect(WIDTH_TRIAL_MS).toBe((FILM_HIGH_S - FILM_LOW_S) * 1000);
    clock.pass(WIDTH_TRIAL_MS);
    for (const d of all.filter((x) => x.started())) d.succeed();
    await settled();
    expect(turns.view().width).toBe(WIDTH_START * 2);
  });

  it("counts a film's first trial from its first download, not from the film's handing", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    turns.film(fakeFilm({ playing: true, ahead: 12 }).probe);
    clock.pass(2 * WIDTH_TRIAL_MS);
    const all = Array.from({ length: 8 }, download);
    for (const d of all) void turns.run(d.start);
    for (const d of all.filter((x) => x.started())) d.succeed();
    await settled();
    expect(turns.view().width).toBe(WIDTH_START);
  });

  it("holds the width while the film stands between its marks, however many settle", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 12 });
    turns.film(film.probe);
    clock.pass(WIDTH_TRIAL_MS);
    film.set({ ahead: FILM_HIGH_S - 0.5 });
    const all = Array.from({ length: 40 }, download);
    for (const d of all) void turns.run(d.start);
    for (let round = 0; round < 8; round++) {
      for (const d of all.filter((x) => x.started())) d.succeed();
      await settled();
    }
    expect(all.filter((d) => d.started()).length).toBe(36);
    expect(turns.view().width).toBe(WIDTH_START);
  });

  it("does not widen on downloads that settle while the film is hungry", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 12 });
    turns.film(film.probe);
    const all = Array.from({ length: 4 }, download);
    for (const d of all) void turns.run(d.start);
    film.set({ ahead: 1 });
    clock.pass(LOOK_MS);
    expect(turns.view().width).toBe(2);
    for (const d of all) d.succeed();
    await settled();
    expect(turns.view().width).toBe(2);
  });

  it("lets one through when nothing has started for the bound while downloads wait, and again each time it passes", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    // A film that never fills: its own fetch is stuck.
    turns.film(fakeFilm({ playing: true, ahead: 0 }).probe);
    const all = Array.from({ length: 3 }, download);
    for (const d of all) void turns.run(d.start);
    clock.pass(HOLD_BOUND_MS - LOOK_MS);
    expect(all.map((d) => d.started())).toEqual([false, false, false]);
    clock.pass(LOOK_MS);
    expect(all.map((d) => d.started())).toEqual([true, false, false]);
    clock.pass(HOLD_BOUND_MS);
    expect(all.map((d) => d.started())).toEqual([true, true, false]);
    clock.pass(HOLD_BOUND_MS);
    expect(all.map((d) => d.started())).toEqual([true, true, true]);
  });

  it("gives up a film hungry for good at its third let-through: the line goes, and later downloads start in the call", () => {
    expect(HOLD_GIVE_UP).toBe(3);
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const courses: TurnsCourse[] = [];
    const takeAway = turns.film(fakeFilm({ playing: true, ahead: 0 }).probe, (c) => courses.push(c));
    const all = Array.from({ length: 10 }, download);
    for (const d of all) void turns.run(d.start);
    const started = (): number => all.filter((d) => d.started()).length;
    clock.pass(HOLD_BOUND_MS);
    expect(started()).toBe(1);
    clock.pass(HOLD_BOUND_MS);
    expect(started()).toBe(2);
    expect(turns.view().gaveUp).toBe(false);
    clock.pass(HOLD_BOUND_MS);
    expect(started()).toBe(10);
    expect(turns.view().gaveUp).toBe(true);
    const late = download();
    void turns.run(late.start);
    expect(late.started()).toBe(true);
    takeAway();
    expect(courses[0]?.gaveUp).toEqual({ settled: 0 });
    expect(courses[0]?.letThrough).toBe(3);
    expect(turnsLine(courses[0] as TurnsCourse)).toContain("let through 3; gave up at 0 settled;");
  });

  it("starts the count of hungry let-throughs again when the film is fed between them", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 0 });
    turns.film(film.probe);
    // One download in flight that never settles, and a line behind it.
    const all = Array.from({ length: 12 }, download);
    for (const d of all) void turns.run(d.start);
    clock.pass(2 * HOLD_BOUND_MS);
    expect(all.filter((d) => d.started()).length).toBe(2);
    // Fed: a width's worth starts, then hungry again.
    film.set({ ahead: 12 });
    clock.pass(LOOK_MS);
    const fed = all.filter((d) => d.started()).length;
    expect(fed).toBe(WIDTH_START);
    film.set({ ahead: 0 });
    clock.pass(LOOK_MS);
    clock.pass(2 * HOLD_BOUND_MS);
    expect(turns.view().gaveUp).toBe(false);
    expect(all.filter((d) => d.started()).length).toBe(fed + 2);
    clock.pass(HOLD_BOUND_MS);
    expect(turns.view().gaveUp).toBe(true);
    expect(all.every((d) => d.started())).toBe(true);
  });

  it("bounds a film handed after one that was given up", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const first = turns.film(fakeFilm({ playing: true, ahead: 0 }).probe);
    for (let i = 0; i < HOLD_GIVE_UP + 1; i++) void turns.run(download().start);
    clock.pass(HOLD_GIVE_UP * HOLD_BOUND_MS);
    expect(turns.view().gaveUp).toBe(true);
    first();
    turns.film(fakeFilm({ playing: true, ahead: 0 }).probe);
    expect(turns.view().gaveUp).toBe(false);
    const d = download();
    void turns.run(d.start);
    expect(d.started()).toBe(false);
  });

  it("starts first come, first started", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 0 });
    turns.film(film.probe);
    const order: number[] = [];
    for (let i = 0; i < 6; i++) void turns.run(() => {
      order.push(i);
      return new Promise<void>(() => undefined);
    });
    film.set({ ahead: 12 });
    clock.pass(LOOK_MS);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("takes an aborted caller out of the line with the signal's reason", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 0 });
    turns.film(film.probe);
    const leaving = download();
    const staying = download();
    const abort = new AbortController();
    const reason = new DOMException("left the hike", "AbortError");
    const left = turns.run(leaving.start, abort.signal);
    void turns.run(staying.start);
    expect(turns.view().waiting).toBe(2);
    abort.abort(reason);
    await expect(left).rejects.toBe(reason);
    expect(turns.view().waiting).toBe(1);
    film.set({ ahead: 12 });
    clock.pass(LOOK_MS);
    expect(leaving.started()).toBe(false);
    expect(staying.started()).toBe(true);
    // Asked for with a signal already aborted, while it would have to wait: it never joins.
    film.set({ ahead: 0 });
    const gone = new AbortController();
    gone.abort(reason);
    const busy = Array.from({ length: 8 }, download);
    for (const d of busy) void turns.run(d.start);
    const late = download();
    await expect(turns.run(late.start, gone.signal)).rejects.toBe(reason);
    expect(late.started()).toBe(false);
  });

  it("frees a turn on a failure as on a success, and hands the caller the download's own answer", async () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    turns.film(fakeFilm({ playing: true, ahead: 12 }).probe);
    const all = Array.from({ length: 6 }, download);
    const outcomes = all.map((d) => turns.run(d.start).then((v) => v, (e: unknown) => e));
    expect(all.map((d) => d.started())).toEqual([true, true, true, true, false, false]);
    all[0]?.fail();
    all[1]?.succeed();
    await settled();
    expect(all.map((d) => d.started())).toEqual([true, true, true, true, true, true]);
    expect(await outcomes[1]).toBe("bytes");
    expect(await outcomes[0]).toBeInstanceOf(TypeError);
    // A start that throws at once is a failure too, and frees its turn.
    const fresh = createDownloadTurns(clock);
    fresh.film(fakeFilm({ playing: true, ahead: 12 }).probe);
    const thrown = new Error("no such file");
    await expect(fresh.run(() => {
      throw thrown;
    })).rejects.toBe(thrown);
    expect(fresh.view().inFlight).toBe(0);
  });

  it("lets the whole line go when the film is taken away, and tells the course once", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const courses: TurnsCourse[] = [];
    const takeAway = turns.film(fakeFilm({ playing: true, ahead: 0 }).probe, (c) => courses.push(c));
    const all = Array.from({ length: 5 }, download);
    for (const d of all) void turns.run(d.start);
    expect(all.some((d) => d.started())).toBe(false);
    takeAway();
    takeAway();
    expect(all.every((d) => d.started())).toBe(true);
    expect(courses.length).toBe(1);
    expect(courses[0]?.held).toBe(5);
    expect(turnsLine(courses[0] as TurnsCourse)).toBe(
      "Downloads under the film: widths 4@0; hungry 0; held 5; let through 0; most in flight 0; settled 0.",
    );
  });

  it("leaves a later film alone when an earlier film's handing is taken away", () => {
    const turns = createDownloadTurns(fakeClock());
    const takeFirst = turns.film(() => ({ playing: true, ahead: 0 }));
    turns.film(() => ({ playing: true, ahead: 0 }));
    takeFirst();
    const d = download();
    void turns.run(d.start);
    expect(d.started()).toBe(false);
  });

  it("lifts the bound when the film stops playing", () => {
    const clock = fakeClock();
    const turns = createDownloadTurns(clock);
    const film = fakeFilm({ playing: true, ahead: 0 });
    turns.film(film.probe);
    const d = download();
    void turns.run(d.start);
    expect(d.started()).toBe(false);
    film.set({ playing: false });
    clock.pass(LOOK_MS);
    expect(d.started()).toBe(true);
  });
});
