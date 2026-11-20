/**
 * A hike's downloads take turns behind the intro's film.
 *
 * The intro is a film played over the hike while the hike loads. The browser
 * asks for a film element's file at a low priority and for every file of the
 * hike (`fetch`) at a high one, so while many of the hike's files are in
 * flight the film's request gets little or none of the link: it plays what it
 * has buffered and then stands. So while a film plays, the hike's files are
 * started only as fast as the film can afford, and the film's buffer is the
 * signal.
 *
 * The law (`run`):
 * - No film, or a film that is not playing (not started, paused, ended,
 *   failed, cut, or wholly buffered): no bound at all. A download starts the
 *   moment it is asked for, as it would without this module.
 * - A film playing: a new download starts only while the film is not hungry,
 *   and at most `width` are in flight. Hungry is a hysteresis on the film's
 *   buffered-ahead: hungry below `FILM_LOW_S`, fed again at `FILM_HIGH_S`.
 *   While hungry nothing new starts: what is in flight drains, and the link
 *   is the film's.
 * - `width` finds the link's speed by itself: it starts at `WIDTH_START`,
 *   doubles each time a full width of downloads has settled while the film
 *   stood at or above its high mark, once the width has stood
 *   `WIDTH_TRIAL_MS`, and is unbounded once it reaches `WIDTH_OPEN`; it
 *   halves (never below 1) each time the film goes hungry. Between the marks
 *   it holds: the film is draining there.
 * - The hike is never held for good: when nothing has started for
 *   `HOLD_BOUND_MS` while downloads wait (the film's own fetch is stuck, the
 *   element says what is not so), one is let through anyway, and again each
 *   time the bound passes.
 * - Holding the hike is worth it only while it feeds the film: a film still
 *   hungry at its `HOLD_GIVE_UP`th let-through in a row is one this link
 *   cannot feed, and the turns stop bounding for the rest of that film, as
 *   though it did not play. A film fed again before that starts the count
 *   again; a film handed later starts fresh.
 * - First come, first started. A caller whose signal aborts while it waits
 *   leaves the line. A turn is freed when its download settles, failed or not.
 *
 * Nothing here loads an engine or touches the page: the film is read through
 * a probe (`film`), and time through a clock, so the law is tested with fakes.
 */

/**
 * Below this many seconds of film buffered ahead the film is hungry. When the
 * film goes hungry, what is in flight still holds the link until it settles,
 * and the film plays on from its buffer meanwhile: five seconds is the drain
 * of a few of the hike's files at a link where the film runs short (four
 * files of the hike's mean 1.1 MB take about 2.5 s at 15 Mbit/s; two of its
 * largest, 3 MB each, about 3 s at 15 and 6 s at 8, by when the width has
 * halved).
 */
export const FILM_LOW_S = 5;

/**
 * At this many seconds of film buffered ahead a hungry film is fed again.
 * Under what a browser keeps ahead of a playing film on its own (about ten
 * seconds; the same reason the start asks nine before it builds), or the film
 * could never be fed; four seconds over the low mark, so each turn of the
 * hike has a few seconds of film to spend before it stops again.
 */
export const FILM_HIGH_S = 9;

/** The width a film starts with: a few files in flight, so a slow link is found before it is full. */
export const WIDTH_START = 4;

/**
 * The least time a width stands before it may double. A film's buffer falls
 * a second a second at most, so a link that gives it nothing under a width
 * shows only after the film has fallen from the high mark to the low one;
 * judged any sooner, a width of small files (a hike's sounds and ground maps
 * come first, 31 files of 5 MB) settles before the film could show anything,
 * and the width opens before the large files come.
 */
export const WIDTH_TRIAL_MS = (FILM_HIGH_S - FILM_LOW_S) * 1000;

/**
 * A width that reaches this is unbounded: a link that has fed the film
 * through a width of half of it is fast enough for the whole of a hike at
 * once (a hike asks for about fifty files at a time).
 */
export const WIDTH_OPEN = 32;

/**
 * The longest nothing starts while downloads wait before one is let through
 * anyway. Longer than a hold ever lasts while the film is fed by its link
 * (what is in flight drains and the film climbs four seconds: under ten
 * seconds at 8 Mbit/s), so it lets through only what a stuck film would hold.
 */
export const HOLD_BOUND_MS = 15_000;

/**
 * The let-throughs in a row, the film hungry through all of them, after which
 * the turns give the film up. Holding the hike only ever bought the film the
 * link; a film that stays hungry through three bounds (about 45 s, with at
 * most three of the hike's files started) is not fed by holding it, whether
 * its own fetch is stuck or the link is slower than the film, and holding on
 * would load a hike of ninety files a file a bound. So a hike is held at most
 * about a minute by a film that holding does not feed.
 */
export const HOLD_GIVE_UP = 3;

/** How often the film is looked at while downloads wait or are in flight under it. */
export const LOOK_MS = 250;

/** What the film says of itself: whether it plays (and could still use the link), and its seconds buffered ahead. */
export type FilmState = { playing: boolean; ahead: number };

/** Reads the film as it stands. */
export type FilmProbe = () => FilmState;

/** The turns' clock: the page's time in ms, and a single call after `ms` that can be cancelled. */
export type TurnsClock = {
  now(): number;
  after(ms: number, run: () => void): () => void;
};

/** What a film's turns did, from the probe's handing to its taking away. */
export type TurnsCourse = {
  /** Each width the turns took, with the number of downloads settled under the film when it was taken: the first is the start. */
  widths: { width: number; settled: number }[];
  /** Times the film went hungry. */
  hungry: number;
  /** Downloads that waited for their turn. */
  held: number;
  /** Downloads let through by `HOLD_BOUND_MS`. */
  letThrough: number;
  /** The most downloads in flight at once while the film was handed. */
  most: number;
  /** Downloads settled while the film was handed. */
  settled: number;
  /** Whether the turns gave the film up (`HOLD_GIVE_UP`), and how many downloads had settled under it then. */
  gaveUp: { settled: number } | null;
};

export type DownloadTurns = {
  /**
   * Starts `start` when it has its turn, and frees the turn when the promise
   * it returns settles. With no film playing it is started at once, in this
   * call. A caller whose `signal` aborts while it waits gets the signal's
   * reason and leaves the line; once started, the abort is the download's own.
   */
  run<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /**
   * Hands the turns the film to play behind; the returned function takes it
   * away again (once; a later film's handing is left alone) and gives
   * `told` the course, if any, at that moment.
   */
  film(probe: FilmProbe, told?: (course: TurnsCourse) => void): () => void;
  /** How the turns stand, for tests. */
  view(): { width: number; inFlight: number; waiting: number; hungry: boolean; gaveUp: boolean };
};

const browserClock: TurnsClock = {
  now: () => performance.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export function createDownloadTurns(clock: TurnsClock = browserClock): DownloadTurns {
  type Waiter = { go: () => void };
  const line: Waiter[] = [];
  let inFlight = 0;
  let probe: FilmProbe | null = null;
  let hungry = true;
  let width = WIDTH_START;
  let settledAtWidth = 0;
  /** When the width was last set, or, for a film's first width, when its first download started: null till then. */
  let widthSince: number | null = null;
  /** When the last download started, or when the line last filled from empty: the bound counts from the later. */
  let lastStart = 0;
  let lineSince = 0;
  let cancelLook: (() => void) | null = null;
  /** Let-throughs in a row with the film hungry through them; and whether this film was given up. */
  let hungryLetThroughs = 0;
  let gaveUp = false;
  let course: TurnsCourse = freshCourse();

  function freshCourse(): TurnsCourse {
    return { widths: [{ width: WIDTH_START, settled: 0 }], hungry: 0, held: 0, letThrough: 0, most: 0, settled: 0, gaveUp: null };
  }

  /** The film's state when it bounds the hike's downloads; null when nothing bounds them. */
  function bounding(): FilmState | null {
    if (probe === null || gaveUp) return null;
    const state = probe();
    return state.playing ? state : null;
  }

  function setWidth(next: number): void {
    width = next;
    settledAtWidth = 0;
    widthSince = clock.now();
    course.widths.push({ width: next, settled: course.settled });
  }

  function begin<T>(start: () => Promise<T>): Promise<T> {
    inFlight++;
    lastStart = clock.now();
    widthSince ??= lastStart;
    if (probe !== null) course.most = Math.max(course.most, inFlight);
    let download: Promise<T>;
    try {
      download = start();
    } catch (error) {
      download = Promise.reject(error);
    }
    return download.then(
      (value) => {
        settle();
        return value;
      },
      (error: unknown) => {
        settle();
        throw error;
      },
    );
  }

  function settle(): void {
    inFlight--;
    if (probe !== null) {
      course.settled++;
      const film = bounding();
      if (!hungry && film !== null && film.ahead >= FILM_HIGH_S && width !== Infinity) {
        settledAtWidth++;
        if (settledAtWidth >= width && clock.now() - (widthSince ?? Infinity) >= WIDTH_TRIAL_MS) setWidth(width * 2 >= WIDTH_OPEN ? Infinity : width * 2);
      }
    }
    look();
  }

  function startNext(): void {
    (line.shift() as Waiter).go();
  }

  /** Reads the film, starts whatever may start now, and looks again later while anything waits or is in flight under it. */
  function look(): void {
    const film = bounding();
    if (film === null) {
      while (line.length > 0) startNext();
    } else {
      if (!hungry && film.ahead < FILM_LOW_S) {
        hungry = true;
        course.hungry++;
        // An unbounded width halves from what it had in flight.
        setWidth(Math.max(1, Math.floor((width === Infinity ? inFlight : width) / 2)));
      } else if (hungry && film.ahead >= FILM_HIGH_S) {
        hungry = false;
        hungryLetThroughs = 0;
      }
      while (line.length > 0 && !hungry && inFlight < width) startNext();
      if (line.length > 0 && clock.now() - Math.max(lastStart, lineSince) >= HOLD_BOUND_MS) {
        course.letThrough++;
        if (hungry) hungryLetThroughs++;
        startNext();
        if (hungryLetThroughs >= HOLD_GIVE_UP) {
          // Holding does not feed this film: the rest of its turns are unbounded.
          gaveUp = true;
          course.gaveUp = { settled: course.settled };
          while (line.length > 0) startNext();
        }
      }
    }
    const again = probe !== null && (line.length > 0 || inFlight > 0);
    if (again && cancelLook === null) {
      cancelLook = clock.after(LOOK_MS, () => {
        cancelLook = null;
        look();
      });
    } else if (!again && cancelLook !== null) {
      cancelLook();
      cancelLook = null;
    }
  }

  return {
    run<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (probe === null) return begin(start);
      return new Promise<T>((resolve, reject) => {
        const leave = (): void => {
          const at = line.indexOf(waiter);
          if (at < 0) return;
          line.splice(at, 1);
          reject(signal?.reason);
          look();
        };
        let waited = false;
        const waiter: Waiter = {
          go: () => {
            signal?.removeEventListener("abort", leave);
            if (waited) course.held++;
            begin(start).then(resolve, reject);
          },
        };
        if (line.length === 0) lineSince = clock.now();
        line.push(waiter);
        look();
        if (line.includes(waiter)) {
          waited = true;
          if (signal?.aborted === true) leave();
          else signal?.addEventListener("abort", leave, { once: true });
        }
      });
    },
    film(next, told) {
      probe = next;
      hungry = true;
      width = WIDTH_START;
      settledAtWidth = 0;
      widthSince = null;
      hungryLetThroughs = 0;
      gaveUp = false;
      course = freshCourse();
      look();
      let taken = false;
      return () => {
        if (taken || probe !== next) return;
        taken = true;
        probe = null;
        const done = course;
        look();
        told?.(done);
      };
    },
    view: () => ({ width, inFlight, waiting: line.length, hungry, gaveUp }),
  };
}

/** The page's one set of turns: one link, one film. */
export const pageTurns: DownloadTurns = createDownloadTurns();

/** A line for the console of how a film's turns went: each width with the downloads settled when it was taken. */
export function turnsLine(course: TurnsCourse): string {
  const widths = course.widths.map((w) => `${w.width === Infinity ? "open" : w.width}@${w.settled}`).join(" ");
  const gaveUp = course.gaveUp === null ? "" : `; gave up at ${course.gaveUp.settled} settled`;
  return `Downloads under the film: widths ${widths}; hungry ${course.hungry}; held ${course.held}; let through ${course.letThrough}${gaveUp}; most in flight ${course.most}; settled ${course.settled}.`;
}
