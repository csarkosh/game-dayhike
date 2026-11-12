import { describe, expect, it } from "vitest";
import { FILM_PAUSE_S, FILM_START_S, PAGE_STOP_MS, verdictOf, verdictRow } from "../lib/verdict.mjs";

// A film that keeps exact time from Play (page ms 1000) and ends at 72 s, sampled four times a second.
const SMOOTH = Array.from({ length: 290 }, (_, i) => ({ t: 1000 + i * 250, at: Math.min(72, i * 0.25), total: Math.min(1728, i * 6), dropped: 0 }));
const run = ({ loaf = [], video = SMOOTH, shown = [], phone = undefined } = {}) => ({
  meta: { label: "r", approach: "intro", ...(phone === undefined ? {} : { phone }) },
  marks: [{ name: "sprint-on", t: 1000 }],
  loaf,
  video,
  shown,
});

// The shape a run really has: each row carries the film's length, the rows stop when the film ends
// (the recorder skips a paused film) and the film's end is a mark.
const REAL = Array.from({ length: 288 }, (_, i) => ({ t: 1000 + i * 250, at: i * 0.25, total: i * 6, dropped: 0, dur: 72 }));
const real = ({ loaf = [], video = REAL, ended = 73000, cold = true } = {}) => ({
  meta: { label: "r", approach: "intro", cold },
  marks: [{ name: "sprint-on", t: 1000 }, ...(ended === null ? [] : [{ name: "film-end", t: ended }])],
  loaf,
  video,
  shown: [],
});

describe("an intro's verdict on a run that knows its film's length and end", () => {
  it("passes a first visit whose film played to its end", () => {
    const v = verdictOf(real());
    expect(v.why).toEqual([]);
    expect(v.end).toBe(73000);
  });
  it("fails a film that never reached its end", () => {
    const stalled = [...REAL.slice(0, 121), ...Array.from({ length: 40 }, (_, i) => ({ t: 1000 + (121 + i) * 250, at: 30, total: 720, dropped: 0, dur: 72 }))];
    expect(verdictOf(real({ video: stalled, ended: null })).why).toEqual(["the film did not reach its end (stopped at 30.0 of 72.0 s)"]);
    expect(verdictOf(real({ video: REAL.slice(0, 160), ended: null })).why).toEqual(["the film did not reach its end (stopped at 39.8 of 72.0 s)"]);
  });
  it("takes a film whose rows reach its end as ended though the mark is missing", () => {
    expect(verdictOf(real({ ended: null })).pass).toBe(true);
  });
  it("counts a stop that runs through the film's end, by its part inside the window", () => {
    const v = verdictOf(real({ loaf: [{ start: 72000, dur: 2000 }] }));
    expect(v.stops).toEqual([{ at: 71, ms: 1000 }]);
    expect(v.pass).toBe(false);
  });
  it("counts a stop that began before Play by its part after it", () => {
    expect(verdictOf(real({ loaf: [{ start: 800, dur: 3000 }] })).stops).toEqual([{ at: 0, ms: 2800 }]);
    expect(verdictOf(real({ loaf: [{ start: 600, dur: 600 }] })).pass).toBe(true);
  });
  it("judges the film's start: how far behind the tap the film is a second after it", () => {
    // The film stood 0.6 s on its first frame, then kept time: no pause after that, and a late start.
    const late = REAL.map((r) => ({ ...r, at: Math.max(0, r.at - 0.6) }));
    const v = verdictOf(real({ video: late, ended: 73600 }));
    expect(v.start.behind).toBeCloseTo(0.6, 2);
    expect(v.why).toEqual(["the film was 0.60 s behind the Play tap after its first second"]);
  });
  it("allows the start what a phone's sound takes to begin, and no more", () => {
    // A film with sound starts when the phone's sound output does: a quarter second on a Pixel 9.
    const by = (s) => REAL.map((r) => ({ ...r, at: Math.max(0, r.at - s) }));
    const quarter = verdictOf(real({ video: by(0.25), ended: 73250 }));
    expect(quarter.start.behind).toBeCloseTo(0.25, 2);
    expect(quarter.why).toEqual([]);
    expect(verdictOf(real({ video: by(0.35), ended: 73350 })).why).toEqual(["the film was 0.35 s behind the Play tap after its first second"]);
  });
  it("takes what the film loses inside its first second as its start, not as a pause", () => {
    // Its clock creeps for a moment, then it stands for the sound and keeps time from there.
    const video = [{ t: 1050, at: 0.01, total: 0, dropped: 0, dur: 72 }, ...REAL.slice(1).map((r) => ({ ...r, at: r.at - (r.t <= 1250 ? 0.21 : 0.25) }))];
    const v = verdictOf(real({ video, ended: 73250 }));
    expect(v.start.behind).toBeCloseTo(0.25, 2);
    expect(v.clockWorst).toBeNull();
    expect(v.why).toEqual([]);
  });
  it("still fails a pause over the limit after the first second, however good the start", () => {
    const video = REAL.map((r) => (r.t > 3000 ? { ...r, at: r.at - 0.15 } : r));
    expect(verdictOf(real({ video, ended: 73150 })).why).toEqual(["the film's clock fell 0.15 s behind at 2.0 s"]);
  });
  it("reads the start from the first sample though it comes only after a page stop", () => {
    // No sample until 4.2 s after Play (the page was stopped), by when the film is at 3.6 s.
    const video = REAL.filter((r) => r.t >= 5200).map((r) => ({ ...r, at: r.at - 0.6 }));
    const v = verdictOf(real({ video, ended: 73600 }));
    expect(v.start.behind).toBeCloseTo(0.6, 2);
    expect(v.clockWorst).toBeNull();
  });
  it("measures the start from the Play button's click where the run marks it", () => {
    const late = REAL.map((r) => ({ ...r, at: Math.max(0, r.at - 0.6) }));
    const run = real({ video: late, ended: 73600 });
    run.marks.push({ name: "play-click", t: 1150 });
    expect(verdictOf(run).start.behind).toBeCloseTo(0.45, 2);
  });
  it("fails a run that was not a first visit", () => {
    expect(verdictOf(real({ cold: false })).why).toEqual(["not a first visit"]);
  });
  it("reads a pause that spans several samples as one, at its whole size", () => {
    const video = REAL.map((r) => (r.t > 5000 ? { ...r, at: r.at - (r.t > 5250 ? 0.18 : 0.09) } : r));
    expect(verdictOf(real({ video })).why).toEqual(["the film's clock fell 0.18 s behind at 4.0 s"]);
  });
});

describe("an intro's verdict", () => {
  it("holds the owner's two limits", () => {
    expect(PAGE_STOP_MS).toBe(250);
    expect(FILM_PAUSE_S).toBe(0.1);
    // And, for the film's start alone, what a phone's sound output takes to begin.
    expect(FILM_START_S).toBe(0.3);
  });
  it("passes a run with no stop over 0.25 s and a film that keeps time", () => {
    const v = verdictOf(run({ loaf: [{ start: 3000, dur: 240 }, { start: 9000, dur: 120 }] }));
    expect(v.pass).toBe(true);
    expect(v.why).toEqual([]);
    expect(v.stopsOver100).toBe(2);
  });
  it("fails on one page stop over 0.25 s and names it", () => {
    const v = verdictOf(run({ loaf: [{ start: 6000, dur: 300 }] }));
    expect(v.pass).toBe(false);
    expect(v.stops).toEqual([{ at: 5, ms: 300 }]);
    expect(v.why).toEqual(["1 page stop over 0.25 s, the longest 0.30 s at 5.0 s"]);
  });
  it("counts every stop over the limit and names the longest", () => {
    const v = verdictOf(run({ loaf: [{ start: 2000, dur: 400 }, { start: 6000, dur: 3900 }, { start: 20000, dur: 260 }] }));
    expect(v.why).toEqual(["3 page stops over 0.25 s, the longest 3.90 s at 5.0 s"]);
  });
  it("ignores a stop after the film's end", () => {
    expect(verdictOf(run({ loaf: [{ start: 1000 + 73000, dur: 900 }] })).pass).toBe(true);
  });
  it("fails when the film's clock falls more than 0.1 s behind", () => {
    const video = SMOOTH.map((r) => (r.t > 5000 ? { ...r, at: r.at - 0.2 } : r));
    const v = verdictOf(run({ video }));
    expect(v.pass).toBe(false);
    expect(v.clockWorst.behind).toBeCloseTo(0.2, 2);
    expect(v.why).toEqual(["the film's clock fell 0.20 s behind at 4.0 s"]);
  });
  it("fails when the picture skips more than 0.1 s, and not on a late callback", () => {
    const skipped = verdictOf(run({ shown: [[3000, 2.0, 48], [3500, 2.5, 50]] }));
    expect(skipped.why).toEqual(["the film's picture skipped 0.42 s at 2.5 s"]);
    expect(verdictOf(run({ shown: [[4128, 0, 1], [4145, 0.041667, 2], [4195, 0.083333, 3], [4212, 3.583333, 87], [7907, 3.625, 88]] })).pass).toBe(true);
  });
  it("fails a run with no film rather than passing it on no pauses", () => {
    expect(verdictOf(run({ video: [] })).why).toEqual(["no film was seen"]);
  });
  it("fails a run with no Play marked", () => {
    expect(verdictOf({ ...run(), marks: [] }).why).toEqual(["no Play was marked"]);
  });
  it("fails a run whose phone was not cool, and says nothing of a run with no phone", () => {
    expect(verdictOf(run({ phone: { cool: false } })).why).toEqual(["the phone was not cool at the start"]);
    expect(verdictOf(run({ phone: { cool: true } })).pass).toBe(true);
    expect(verdictOf(run()).cool).toBeNull();
  });
  it("prints a run as one row that says pass or FAIL", () => {
    expect(verdictRow("live-1", verdictOf(run()))).toMatch(/^live-1 +pass /);
    expect(verdictRow("live-2", verdictOf(run({ loaf: [{ start: 6000, dur: 300 }] })))).toMatch(/^live-2 +FAIL /);
  });
});
