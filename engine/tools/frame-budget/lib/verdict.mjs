// An intro judged against its limits, from the Play tap to the film's end: no page stop longer
// than PAGE_STOP_MS (a page stop is a long animation frame, a run's `loaf` row), and no film
// pause longer than FILM_PAUSE_S by either of `film.mjs`'s measures. The film's start is judged
// apart, against FILM_START_S: a film with sound starts when the phone's sound output does, a
// quarter second after the tap on a Pixel 9 (0.20 to 0.29 s on a blank page, `film-start.mjs`),
// and nothing a page does shortens that. The bar is a first visit on a cool phone whose film
// plays to its end: a run that was not one of those is not a run to count.
import { clockSteps, filmEnd, filmLength, filmRate, pictureSkips, playing } from "./film.mjs";

export const PAGE_STOP_MS = 250;
export const FILM_PAUSE_S = 0.1;
/** How far behind its tap a film may be once its first second has passed (the owner's, 2026-11-12). */
export const FILM_START_S = 0.3;
/** The film's start: its first second from the tap. What its clock loses in it is the start's. */
const START_WINDOW_MS = 1000;

const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);

/**
 * `{ pass, why, play, end, stops, stopsOver100, start, clockWorst, skipWorst, dropped, cool }`: `why` is
 * one sentence a failure; `stops` are those over the limit as `{ at, ms }`, `at` in seconds from
 * Play; `start` how far behind the tap the film was a second after it; `clockWorst` and
 * `skipWorst` the film's largest step behind after that and largest skip in the window.
 */
export function verdictOf(run, { pageMs = PAGE_STOP_MS, filmS = FILM_PAUSE_S, startS = FILM_START_S } = {}) {
  const v = { pass: false, why: [], play: null, end: null, stops: [], stopsOver100: 0, start: null, clockWorst: null, skipWorst: null, dropped: null, cool: run.meta?.phone?.cool ?? null };
  const play = run.marks?.find((m) => m.name === "sprint-on")?.t ?? null;
  if (play === null) return { ...v, why: ["no Play was marked"] };
  const video = run.video ?? [];
  if (playing(video).length === 0) return { ...v, play, why: ["no film was seen"] };
  // The film's end: its `film-end` mark; without one, the last row of a film whose rows reach its
  // length; without a length (an older run), the last row before the largest time sampled.
  const length = filmLength(video), reached = filmEnd(video);
  const mark = run.marks.find((m) => m.name === "film-end")?.t ?? null;
  const ended = mark !== null || length === null || reached >= length - 0.3;
  const endT = mark ?? (length !== null && ended ? video.at(-1).t : null);
  const rows = playing(video, endT);
  const end = endT ?? rows.at(-1).t;
  const at = (t) => (t - play) / 1000;
  // A stop counts by its part inside the window: one that began before Play, or runs through the film's end.
  const inside = (run.loaf ?? [])
    .map((l) => ({ from: Math.max(l.start, play), ms: Math.min(l.start + l.dur, end) - Math.max(l.start, play) }))
    .filter((l) => l.ms > 0);
  const stops = inside.filter((l) => l.ms > pageMs).map((l) => ({ at: at(l.from), ms: l.ms }));
  const worst = (xs, k) => xs.reduce((a, x) => (a === null || x[k] > a[k] ? x : a), null);
  const within = (xs) => xs.filter((x) => x.t >= play && x.t <= end);
  // The film's start: how far behind the tap the film is a second after it, at the last sample
  // inside that second that shows it moving; where the page was stopped through the second, at
  // the first sample after. The tap is the Play button's click where the run marks it
  // (`play-click`), the harness's own mark before the touch otherwise. What the clock loses up
  // to that sample is the start, not a pause: a film's clock can creep before its sound begins
  // and stand while it does, and a run whose first sample comes after a page stop has no pair
  // of samples across its start at all.
  const tap = run.marks.find((m) => m.name === "play-click")?.t ?? play;
  const seen = rows.filter((r) => r.at > 0);
  const moving = seen.filter((r) => r.t <= tap + START_WINDOW_MS).at(-1) ?? seen[0] ?? null;
  const start = moving === null ? null : { at: at(moving.t), behind: Math.max(0, (moving.t - tap) / 1000 - moving.at) };
  const step = worst(within(clockSteps(moving === null ? [] : video.filter((r) => r.t >= moving.t), { endT })), "behind");
  const shown = run.shown ?? [];
  const skip = worst(within(pictureSkips(shown, { rate: filmRate(shown) })), "skipped");
  const why = [];
  if (v.cool === false) why.push("the phone was not cool at the start");
  if (run.meta?.cold === false) why.push("not a first visit");
  if (!ended) why.push(`the film did not reach its end (stopped at ${f1(reached)} of ${f1(length)} s)`);
  if (start !== null && start.behind > startS) why.push(`the film was ${f2(start.behind)} s behind the Play tap after its first second`);
  if (stops.length > 0) {
    const longest = worst(stops, "ms");
    why.push(`${stops.length} page stop${stops.length === 1 ? "" : "s"} over ${f2(pageMs / 1000)} s, the longest ${f2(longest.ms / 1000)} s at ${f1(longest.at)} s`);
  }
  if (step !== null && step.behind > filmS) why.push(`the film's clock fell ${f2(step.behind)} s behind at ${f1(at(step.t))} s`);
  if (skip !== null && skip.skipped > filmS) why.push(`the film's picture skipped ${f2(skip.skipped)} s at ${f1(at(skip.t))} s`);
  return {
    ...v,
    pass: why.length === 0,
    why,
    play,
    end,
    stops,
    stopsOver100: inside.filter((l) => l.ms >= 100).length,
    start,
    clockWorst: step === null ? null : { at: at(step.t), behind: step.behind },
    skipWorst: skip === null ? null : { at: at(skip.t), skipped: skip.skipped },
    dropped: rows.at(-1).dropped ?? null,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export const VERDICT_HEAD = `${pad("run", 24)}${pad("", 6)}${lpad("stops>0.1", 10)}${lpad(">0.25", 7)}${lpad("longest s", 11)}${lpad("start s", 9)}${lpad("clock s", 9)}${lpad("skip s", 8)}${lpad("dropped", 9)}`;

/** A run as one row of a table under VERDICT_HEAD. */
export function verdictRow(label, v) {
  const longest = v.stops.reduce((a, s) => Math.max(a, s.ms), 0);
  return `${pad(label, 24)}${pad(v.pass ? "pass" : "FAIL", 6)}${lpad(v.stopsOver100, 10)}${lpad(v.stops.length, 7)}${lpad(f2(longest / 1000), 11)}${lpad(v.start === null ? "?" : f2(v.start.behind), 9)}${lpad(f2(v.clockWorst?.behind ?? 0), 9)}${lpad(f2(v.skipWorst?.skipped ?? 0), 8)}${lpad(v.dropped ?? "?", 9)}`;
}
