/**
 * The renderer's rebuilds, spread over frames under a per-frame budget.
 *
 * A rebuild that a crossing starts — the terrain's rings, the ground cover's
 * lists, the forest's bands, the props' chunks — is a job: a generator whose
 * every `yield` ends one slice and whose last slice applies the result to the
 * shell's meshes in one step, so no frame ever draws a buffer half written.
 * `run`, called once a frame at the end of the renderer's `sync`, gives the
 * jobs pending, oldest first, one slice after another until `SYNC_BUDGET_MS`
 * of the clock has gone.
 *
 * **A slice ends by the clock, on any device.** A builder's loop asks
 * `sliceDue` as it works, and ends its slice once the scheduler's clock says
 * `SLICE_TARGET_MS` has gone since the slice began. What a loop costs a
 * sample is a desktop's figure or a phone's, five to ten times as much, so a
 * count of samples cannot size a slice; the clock can, and it is the one the
 * scheduler is handed, so a test drives it. Only the apply step is a slice no
 * clock divides: it is one step by design, says what it expects to take (a
 * yielded number of milliseconds), and starts only as a frame's share begins
 * or where it fits in what is left; the scheduler learns each owner's real
 * figure from what its apply steps took by its own clock (`learned`) and
 * trusts it where the builder's own is smaller.
 *
 * What budget no job needs goes to idle work (`idle`): work a shell can do
 * ahead of a crossing it expects, such as the terrain sampling the ground its
 * rings will move onto next. It runs only while no job is pending, is never
 * late, and may be dropped between any two of its slices. The first slice of a
 * frame starts whatever it says it takes: slices are bounded, so that is at
 * most one slice past the budget, and idle work never waits for ever behind
 * an estimate.
 *
 * **A late job gets a larger share, not the whole frame.** A job begun
 * `SYNC_LATE_FRAMES_MAX` frames or `SYNC_LATE_MS_MAX` milliseconds ago,
 * whichever comes first, is late: it goes before the other jobs, and the
 * frame gives late jobs slices until `SYNC_LATE_BUDGET_MS` of the clock has
 * gone, then stops; what is left of the job goes on next frame. On a machine
 * where a crossing's work fits in six frames of the ordinary share no job is
 * ever late. The hard bound stays for what the soft one cannot meet, a clock
 * that jumped (a tab hidden for a minute) or a job starved: one begun
 * `SYNC_OVERDUE_MS` ago is run to its end in one frame, as a first build is.
 *
 * Which crossings wait and which do not is each shell's `crossingAt`: the
 * first build, a jump of more than one cell (a teleport) and a view moving
 * more than half a cell or a metre a frame (the free camera's boost) all
 * build at once, or are stepped by the loader of first builds
 * (`firstBuilds.ts`), so at those the picture is exactly what it was. A
 * crossing that finds the shell's last job still pending — the view has moved
 * past a further line before that job applied, as a walk along a diagonal
 * does whenever it crosses an x line and a z line a few frames apart —
 * replaces it with the rebuild for the new view, which keeps the old job's
 * deadline, in frames and in time: the view it was begun for is never drawn.
 * What the old job had made that the new needs is not made again, as each
 * shell's own record says (a ring's samples, the cells a lookup holds, the
 * face patches built ahead), so a replacement costs a job's array building and
 * not its sampling.
 *
 * A patient job (`begin`'s `patient`) is never late and never overdue: it is
 * the rebuild of a shell whose meshes draw the last set it applied, whole and
 * correct, until the next set is applied, so waiting costs detail and never
 * shows a hole — the face patches', whose crossing builds far more than six
 * frames' share. It runs after every other job, with the share they leave;
 * idle work runs while only patient jobs are pending, with what they leave.
 *
 * Pure and Babylon-free: time is the clock handed in, so a test drives it.
 */

/**
 * The most a frame's `run` spends on jobs (ms), past which it starts no
 * further slice. A phone's frame at 60 a second is 16.7 ms and the rest of it
 * (the draw, the simulation, the rest of `sync`, the sound) takes 4 to 5, so
 * the share is what a frame can spend on streaming and still hold its rate,
 * with the slice that starts inside it.
 */
export const SYNC_BUDGET_MS = 4;

/** The most frames a job's result may take to reach the screen after the
 * crossing that began it before the job is late. */
export const SYNC_LATE_FRAMES_MAX = 6;

/**
 * The most time (ms) a job's result may take to reach the screen after the
 * crossing that began it, whatever the frame rate, before the job is late. At
 * 60 frames a second the two bounds are the same; below it, this one comes
 * first. What hides the wait is reckoned against it: in 100 ms the view
 * moves 0.33 m at 3.3 m/s, 0.525 m walking (5.25 m/s) and 0.70 m sprinting
 * (7 m/s), at any frame rate. The blade field's `BLADE_PAD` of 2.12 m leaves
 * 0.71 m past the worst offset inside its rebuild cell on a diagonal, the
 * duff's `DUFF_PAD` 1.41 m, and every clutter fade ramp at full radius at
 * least 8 m past the grass cell's 4.24 m snap; the forest's `SEAM_PAD` is
 * exactly its snap, so a late forest is up to those distances past a seam's
 * pad, and the low tier's litter ramp (4.8 m) up to 0.14 m at a sprint.
 * Past it a job is given the larger share below, so it is shown later by what
 * its work needs, a few tenths of a second on a phone.
 *
 * Time is the renderer's clock.
 */
export const SYNC_LATE_MS_MAX = 100;

/**
 * The most a frame's `run` spends on late jobs (ms), twice the ordinary
 * share: the phone's frame has 12 ms to spare after the 4 to 5 ms the rest of
 * it takes, and 8 leaves the other 4 for a slice that starts inside the share
 * and a frame that runs long. A late job is shown after the number of frames
 * its work needs at this share, not run to its end in the frame that finds it
 * late, which on a phone was 40 to 105 ms of one frame.
 */
export const SYNC_LATE_BUDGET_MS = 8;

/**
 * The age (ms) at which a job is run to its end in one frame whatever the
 * share: the hard bound for what the share cannot meet. A tab hidden for a
 * minute stops its frames while its clock runs on, so every pending job is
 * overdue at once on its next frame, and the next frame runs them all to
 * their end, as a first build does; a job starved by others, or replaced by
 * crossing after crossing and never shown, is overdue a second after the
 * first crossing that began it. A second is ten times the soft bound and
 * three to four of a walk's crossings (a ring lattice step of 4 m is 0.76 s
 * at 5.25 m/s), so no walk meets it unless the device cannot keep up.
 */
export const SYNC_OVERDUE_MS = 1000;

/**
 * The longest a builder holds the thread in one slice (ms): the time since the
 * slice began at which `sliceDue` says to end it. Three of these fit in the
 * ordinary share and five in the late one, so the jobs behind one still run
 * in the frame, and one is under a tenth of a frame: a phone's page thread
 * answers a touch or a timer inside it.
 */
export const SLICE_TARGET_MS = 1.5;

/**
 * Units of work a loop counts between two readings of the clock. A unit is
 * about one sample of the terrain (a few microseconds on a desktop, tens on a
 * phone), so a reading comes every 8 samples, 0.05 to 0.4 ms of a phone's
 * work, and a slice is held past its target by at most that and one step of
 * the loop. A reading is a call to the clock, tens of nanoseconds to a few
 * hundred, a hundredth of the work it follows or less.
 */
export const SLICE_READ_UNITS = 8;

/** The clock the open slice reads, its end, and the units counted since its last reading; null with no slice open. */
let gateClock: (() => number) | null = null;
let gateEnd = Infinity;
let gateUnits = 0;

/**
 * Whether the slice a builder is in has used its time: true once the clock has
 * passed `SLICE_TARGET_MS` since the slice began, read every
 * `SLICE_READ_UNITS` units of the work the caller counts (`units`, 1 for a
 * sample). A builder's loop ends its slice with `if (sliceDue()) yield;`
 * where it can resume. False when no scheduler has a slice open — a build at
 * once, a first build stepped by the loader, a test — so such a build runs as
 * it always did; what a builder builds is the same either way, only where it
 * gives the thread back changes.
 */
export function sliceDue(units = 1): boolean {
  if (gateClock === null) return false;
  gateUnits += units;
  if (gateUnits < SLICE_READ_UNITS) return false;
  gateUnits = 0;
  return gateClock() >= gateEnd;
}

/** Opens a slice that began at `at` on `clock`, and returns the one it replaces (a slice run inside another's). */
function openSlice(clock: () => number, at: number): [(() => number) | null, number, number] {
  const held: [(() => number) | null, number, number] = [gateClock, gateEnd, gateUnits];
  gateClock = clock;
  gateEnd = at + SLICE_TARGET_MS;
  gateUnits = 0;
  return held;
}

/** Closes the open slice, the one it replaced open again. */
function closeSlice(held: [(() => number) | null, number, number]): void {
  [gateClock, gateEnd, gateUnits] = held;
}

/** A rebuild in slices: each `next()` runs one slice, and the call that
 * returns `done` has applied the result. A slice may yield what it expects
 * the next to take (ms); nothing yielded means a small one. Idle work's
 * slices may say so too, and one that would not fit in what is left of a
 * frame's share waits for the next, unless nothing has run yet this frame. */
export type Slices<T = void> = Generator<number | void, T, void>;

/** Elements a slice of `sortSlices` moves before it yields. */
const SORT_SLICE = 8192;

/**
 * Sorts `list` in place, in slices: a bottom-up merge sort, stable like
 * `Array.prototype.sort`, so it leaves exactly the order that call would —
 * a stable sort's result is the one permutation that orders the keys and
 * keeps equal ones as they came.
 */
export function* sortSlices<T>(list: T[], compare: (a: T, b: T) => number): Slices {
  const n = list.length;
  let from = list;
  let to: T[] = new Array<T>(n);
  let moved = 0;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      let k = lo;
      // Ties take the left run first: that is what keeps it stable.
      while (i < mid && j < hi) to[k++] = compare(from[j] as T, from[i] as T) < 0 ? (from[j++] as T) : (from[i++] as T);
      while (i < mid) to[k++] = from[i++] as T;
      while (j < hi) to[k++] = from[j++] as T;
      moved += hi - lo;
      if (moved >= SORT_SLICE) {
        moved = 0;
        yield;
      }
    }
    const swap = from;
    from = to;
    to = swap;
  }
  if (from !== list) for (let i = 0; i < n; i++) list[i] = from[i] as T;
}

/** Runs `slices` to its end at once and returns what it returns. */
export function finish<T>(slices: Slices<T>): T {
  for (;;) {
    const step = slices.next();
    if (step.done === true) return step.value;
  }
}

/**
 * The longest a first build holds the page's thread before it gives it back
 * (ms): half a frame at sixty a second. A single slice longer than this runs
 * to its end; a ring's sampling is one slice, about 70 ms on a phone.
 */
export const FIRST_BUILD_SLICE_MS = 8;

/**
 * Runs `slices` to its end, giving the thread back (a macrotask) whenever
 * `sliceMs` have passed since it last did, so the page paints and its video
 * keeps its frames between, and returns what the slices return. A rebuild done
 * this way, not by `SyncJobs`, is one that has no frame to fit: the first
 * build, before the render loop runs. It is paced by the clock and not by a
 * count of slices, since a slice is a ring on one machine's 20 ms and another's
 * 400: a count of eight once let all seven rings run before the first paint.
 * Asked before every slice, `stopped` ends the run early with nothing: what
 * the slices build has gone (a renderer disposed while its world was made).
 */
export async function stepSlices<T>(
  slices: Slices<T>,
  sliceMs: number,
  stopped: () => boolean = () => false,
  now: () => number = () => performance.now(),
): Promise<T | undefined> {
  let since = now();
  for (;;) {
    if (stopped()) return undefined;
    const step = slices.next();
    if (step.done === true) return step.value;
    if (now() - since >= sliceMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      since = now();
    }
  }
}

/** What `SyncJobs.last` carries: the last `run`'s slices, and the counts since the last `resetLongest`. */
export type SyncJobsLast = {
  /** Slices the last `run` ran. */
  readonly slices: number;
  /** How many of them ran as a late job's, past the ordinary budget, and how many jobs were late as the share began. */
  readonly late: number;
  readonly lateJobs: number;
  /** How many ran as an overdue job's, to its end, and how many jobs that was. */
  readonly overdue: number;
  readonly overdueJobs: number;
  /** The jobs completed, and the idle slices run. */
  readonly completed: number;
  readonly idle: number;
  /** The milliseconds the slices took, how many of those a late or overdue run took, and the milliseconds by the jobs' names. */
  readonly ms: number;
  readonly lateMs: number;
  readonly owners: Readonly<Record<string, number>>;
  /** The longest single slice by owner (ms) since the last `resetLongest`. */
  readonly longest: Readonly<Record<string, number>>;
  /** The apply cost learned by owner (ms): what its announced slices took, as a running figure. */
  readonly learned: Readonly<Record<string, number>>;
};

export type SyncJobs = {
  /** Queues `slices` as `owner`'s job, begun this frame. An owner has at most
   * one job: one it already has is dropped unfinished, and the new one takes
   * its place in the queue and its deadline. A `patient` job is never late:
   * it queues behind every other and is never run to its end at once. */
  begin(owner: object, slices: Slices, patient?: boolean, name?: string): void;
  /** Drops `owner`'s pending job unfinished; its meshes keep what they drew.
   * A job dropped here or by `begin` is ended with `return`, so its `finally`
   * blocks run. */
  cancel(owner: object): void;
  /** Whether `owner` has a job begun and not yet applied. */
  pending(owner: object): boolean;
  /** Sets `owner`'s idle work, replacing any it has (null clears it): slices
   * run only with the budget left while no job is pending. */
  idle(owner: object, slices: Slices | null): void;
  /** This frame's share: the overdue jobs to their end, the late jobs' slices
   * until the late share has gone, then the others' until the budget is spent. Call once a frame, after every shell's update. */
  run(): void;
  /** The clock (ms) as the last `run` began, NaN before the first: a frame's
   * time for `crossingAt`, read without another reading of the clock. */
  started(): number;
  /** Frames `run` has closed. */
  readonly frame: number;
  /** The last `run`'s record, for the tests and for the measurement mode's
   * `window.__syncJobs()` (lite/renderer.ts), which a phone harness reads
   * each frame (tools/frame-budget/phone.mjs). */
  readonly last: SyncJobsLast;
  /** Forgets the longest slices recorded, so the next reading's are those since now. */
  resetLongest(): void;
};

/** A queued job: its slices, the frame whose crossing began it and the
 * clock then, what its next slice is expected to take (ms), and whether it
 * is never late. */
type Job = { owner: object; slices: Slices; begun: number; begunAt: number; next: number; patient: boolean; name: string };

/** The weight of the newest apply slice in an owner's learned cost. */
const LEARN_RATE = 0.25;

/**
 * The scheduler. `clock` is read as a job begins, once as `run` starts and
 * once before each slice; the renderer passes `performance.now`.
 */
export function createSyncJobs(clock: () => number): SyncJobs {
  const queue: Job[] = [];
  /** Idle work, one per owner, and whose turn it is. */
  const idle: { owner: object; slices: Slices; next: number }[] = [];
  let idleTurn = 0;
  let frame = 0;
  let startedAt = Number.NaN;
  const last = {
    slices: 0, late: 0, lateJobs: 0, overdue: 0, overdueJobs: 0, completed: 0, idle: 0, ms: 0, lateMs: 0,
    owners: {} as Record<string, number>, longest: {} as Record<string, number>, learned: {} as Record<string, number>,
  };
  /** The slice the clock's next reading is charged to: the one that just ran
   * (its name, whether it ran late, and whether it said what it would take),
   * or none. The clock is read once as a frame's share starts, once before
   * each slice and once as the share ends, never inside a slice's timing, so
   * a test clock that advances on every reading charges each slice one
   * reading. */
  let charging: { name: string; late: boolean; announced: boolean } | null = null;
  let at = 0;
  /** The clock, read: the time since the last reading goes to the slice that ran in it. */
  function tick(): number {
    const now = clock();
    if (charging !== null) {
      const ms = now - at;
      const { name } = charging;
      last.ms += ms;
      if (charging.late) last.lateMs += ms;
      last.owners[name] = (last.owners[name] ?? 0) + ms;
      if (ms > (last.longest[name] ?? 0)) last.longest[name] = ms;
      if (charging.announced) {
        const known = last.learned[name];
        last.learned[name] = known === undefined ? ms : known + (ms - known) * LEARN_RATE;
      }
      charging = null;
    }
    at = now;
    return now;
  }

  /** What `job`'s next slice is expected to take (ms): what it said, or the owner's learned figure where that is more. A slice that said nothing is a bounded one. */
  const expected = (job: Job): number => (job.next > 0 ? Math.max(job.next, last.learned[job.name] ?? 0) : 0);

  /** Whether `job`, as a share begins at `now`, is late: begun too many frames or too long ago, and not patient. */
  const isLate = (job: Job, now: number): boolean =>
    !job.patient && (frame - job.begun >= SYNC_LATE_FRAMES_MAX || now - job.begunAt >= SYNC_LATE_MS_MAX);

  function remove(job: Job): void {
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  }

  /** Queues `job`: a patient one last, any other ahead of every patient one,
   * so the slices go to the jobs that can be late first. */
  function enqueue(job: Job): void {
    const at = job.patient ? -1 : queue.findIndex((j) => j.patient);
    if (at < 0) queue.push(job);
    else queue.splice(at, 0, job);
  }

  /** One slice of `job`; true when it has applied. A slice that throws takes
   * its job out of the queue before the error goes on. */
  function slice(job: Job, late = false): boolean {
    let done: boolean | undefined;
    charging = { name: job.name, late, announced: job.next > 0 };
    const held = openSlice(clock, at);
    try {
      const step = job.slices.next();
      done = step.done;
      job.next = step.done !== true && typeof step.value === "number" ? step.value : 0;
    } finally {
      closeSlice(held);
      if (done !== false) remove(job);
    }
    last.slices++;
    if (done === true) last.completed++;
    return done === true;
  }

  return {
    begin(owner, slices, patient = false, name = "other") {
      const held = queue.find((job) => job.owner === owner);
      if (held === undefined) {
        enqueue({ owner, slices, begun: frame, begunAt: clock(), next: 0, patient, name });
        return;
      }
      held.name = name;
      // Dropped with `return`, so whatever it holds is handed back. The
      // replacement keeps the first crossing's frame and time.
      held.slices.return(undefined);
      held.slices = slices;
      held.next = 0;
      if (held.patient !== patient) {
        remove(held);
        held.patient = patient;
        enqueue(held);
      }
    },
    cancel(owner) {
      const held = queue.find((job) => job.owner === owner);
      if (held === undefined) return;
      remove(held);
      held.slices.return(undefined);
    },
    pending(owner) {
      return queue.some((job) => job.owner === owner);
    },
    idle(owner, slices) {
      const at = idle.findIndex((work) => work.owner === owner);
      if (at >= 0) idle.splice(at, 1)[0]?.slices.return(undefined);
      if (slices !== null) idle.push({ owner, slices, next: 0 });
    },
    started: () => startedAt,
    resetLongest() {
      for (const name in last.longest) last.longest[name] = 0;
    },
    run() {
      last.slices = 0;
      last.late = 0;
      last.lateJobs = 0;
      last.overdue = 0;
      last.overdueJobs = 0;
      last.completed = 0;
      last.idle = 0;
      last.ms = 0;
      last.lateMs = 0;
      for (const name in last.owners) last.owners[name] = 0;
      charging = null;
      const start = tick();
      startedAt = start;
      for (let i = 0; i < queue.length; i++) if (isLate(queue[i] as Job, start)) last.lateJobs++;
      // A job begun `SYNC_OVERDUE_MS` ago goes to its end: the hard bound, for
      // a clock that jumped or a job starved. Its last slice takes it out of
      // the queue, so the next job moves up into its index. Indexed rather than
      // iterated over a copy: this runs every frame, and allocates nothing.
      for (let i = 0; i < queue.length;) {
        const job = queue[i] as Job;
        if (job.patient || start - job.begunAt < SYNC_OVERDUE_MS) {
          i++;
          continue;
        }
        last.overdueJobs++;
        // Each slice after a reading, so each is charged its own time.
        for (;;) {
          tick();
          const done = slice(job, true);
          last.overdue++;
          if (done) break;
        }
      }
      // Then the late jobs, oldest first, whose slices go before every
      // other's: until the late share has gone. A late job whose next slice
      // would not fit in what is left waits for the next frame (unless nothing
      // has run yet this frame), and the late jobs behind it go on.
      for (let i = 0, ran = last.slices; i < queue.length;) {
        const job = queue[i] as Job;
        if (!isLate(job, start)) {
          i++;
          continue;
        }
        for (;;) {
          const spent = tick() - start;
          if (spent >= SYNC_LATE_BUDGET_MS || (last.slices > ran && spent + expected(job) > SYNC_LATE_BUDGET_MS)) {
            i++;
            break;
          }
          const done = slice(job, true);
          last.late++;
          if (done) break;
        }
      }
      // Then slices, oldest job first and the patient ones last, while the
      // frame's share lasts. A job whose
      // next slice would not fit in what is left waits for the next frame
      // (unless nothing has run yet this frame), and the jobs behind it go on.
      for (let i = 0, ran = last.slices; i < queue.length;) {
        const spent = tick() - start;
        if (spent >= SYNC_BUDGET_MS) break;
        const job = queue[i] as Job;
        if (last.slices > ran && spent + expected(job) > SYNC_BUDGET_MS) {
          i++;
          continue;
        }
        slice(job);
        // A job done has left the queue, and the next has moved up to `i`.
      }
      // Then idle work, with what is left, while nothing is pending: a slice
      // of each owner's in turn, so none waits on another's.
      // Patient jobs pending do not stop it: they have had their slices.
      // A slice said to be longer than what is left waits for the next
      // frame, where it is first, and the work behind it goes on; the frame's
      // idle work ends when every one left waits.
      let waiting: Slices | null = null;
      let skipped = 0;
      while ((queue.length === 0 || (queue[0] as Job).patient) && idle.length > 0) {
        const spent = tick() - start;
        if (spent >= SYNC_BUDGET_MS) break;
        idleTurn %= idle.length;
        const work = idle[idleTurn] as { owner: object; slices: Slices; next: number };
        if (last.slices + last.idle > 0 && spent + work.next > SYNC_BUDGET_MS) {
          waiting ??= work.slices;
          if (++skipped >= idle.length) break;
          idleTurn++;
          continue;
        }
        skipped = 0;
        let done = true;
        charging = { name: "idle", late: false, announced: false };
        const held = openSlice(clock, at);
        try {
          const step = work.slices.next();
          done = step.done === true;
          work.next = !done && typeof step.value === "number" ? step.value : 0;
        } finally {
          closeSlice(held);
          if (done) idle.splice(idleTurn, 1);
          else idleTurn++;
        }
        last.idle++;
      }
      // The first that waited is first next frame.
      for (let i = 0; waiting !== null && i < idle.length; i++) {
        if ((idle[i] as { slices: Slices }).slices === waiting) idleTurn = i;
      }
      // The share's last reading: the last slice's time, charged.
      tick();
      frame++;
    },
    get frame() {
      return frame;
    },
    last,
  };
}

/** A view that moved more than this between two frames (m) — 60 m/s at 60
 * frames a second, past any speed on foot — builds at once whatever its
 * shell's cell: the free camera's boost moves 2.4 m a frame. */
export const SYNC_FAST_STEP_M = 1;

/**
 * Where a view at (x, z), moving (hx, hz) a frame, next crosses a line of a
 * grid of `cell` metres — whichever line, x or z, it reaches first — a
 * millimetre past the line: the view its next crossing will be built for,
 * give or take a frame's travel. Writes it to `out` as x, z and returns
 * false when the view is not moving.
 */
export function nextCrossing(x: number, z: number, hx: number, hz: number, cell: number, out: Float64Array): boolean {
  const lineX = hx > 0 ? (Math.floor(x / cell) + 1) * cell : Math.floor(x / cell) * cell;
  const lineZ = hz > 0 ? (Math.floor(z / cell) + 1) * cell : Math.floor(z / cell) * cell;
  const tx = hx !== 0 ? (lineX - x) / hx : Infinity;
  const tz = hz !== 0 ? (lineZ - z) / hz : Infinity;
  if (tx === Infinity && tz === Infinity) return false;
  if (tx <= tz) {
    const px = lineX + Math.sign(hx) * 1e-3;
    out[0] = px;
    out[1] = z + ((px - x) / hx) * hz;
  } else {
    const pz = lineZ + Math.sign(hz) * 1e-3;
    out[0] = x + ((pz - z) / hz) * hx;
    out[1] = pz;
  }
  return true;
}

/** A view's heading: its last move between two frames that moved. */
export type Heading = { x: number; z: number };

/** Takes the view's move since last frame as its heading, if it moved, and
 * says whether it turned: either component changed sign, so the lines its
 * next crossings are on changed. */
export function turn(h: Heading, dx: number, dz: number): boolean {
  if ((dx === 0 && dz === 0) || Number.isNaN(dx) || Number.isNaN(dz)) return false;
  const turned = Math.sign(dx) !== Math.sign(h.x) || Math.sign(dz) !== Math.sign(h.z);
  h.x = dx;
  h.z = dz;
  return turned;
}

/** What a shell does with this frame's view. */
export type CrossingKind = "none" | "now" | "later";

/** A shell's record of the views it has been handed: the origin on its
 * rebuild grid it last built or began building for, and last frame's view. */
export type Crossing = { originX: number; originZ: number; lastX: number; lastZ: number; lastAt: number };

export function createCrossing(): Crossing {
  return { originX: NaN, originZ: NaN, lastX: NaN, lastZ: NaN, lastAt: NaN };
}

/** The frame a view's step is reckoned against (s): 60 a second. */
export const SYNC_FRAME_S = 1 / 60;

/**
 * Classifies this frame's view (x, z), whose origin on the shell's rebuild
 * grid of `cell` metres is (ox, oz), and records both. "none" while the origin
 * holds. Otherwise "now" — build at once, as before there were jobs — for the
 * first build, for a jump of more than one cell on either axis since the last
 * origin (a teleport, a burst of speed), for a view that moved more than half a
 * cell since last frame (so the next crossing is at most a frame or two away)
 * or more than `SYNC_FAST_STEP_M`, and for a shell given no scheduler
 * (`deferrable` false). "later" for everything else: a one-cell step at a walk
 * or a run, which becomes a job.
 *
 * The step since last frame is read as it would be at 60 frames a second:
 * over a frame longer than `SYNC_FRAME_S` (by `now`, the scheduler's clock as
 * its last share began, `SyncJobs.started`; no clock, no scaling)
 * it is scaled to one, so it is the view's speed that says a burst, not a slow
 * frame. A sprint moves 0.12 m a frame at 60; after one frame of 150 ms (a
 * collection, a buffer's upload) it had moved 1.05 m, was taken for the free
 * camera's boost, and every shell crossing a line that frame rebuilt at once:
 * the face patches' set in one frame of 1.1 to 1.3 s on the rig that measured
 * it (2026-11-09), three times in six runs, each after a frame of 0.18 to
 * 0.26 s. A jump of more than a cell is a jump at any frame rate.
 */
export function crossingAt(
  c: Crossing,
  x: number,
  z: number,
  ox: number,
  oz: number,
  cell: number,
  deferrable: boolean,
  now: number = Number.NaN,
): CrossingKind {
  const step = Math.hypot(x - c.lastX, z - c.lastZ);
  const seconds = (now - c.lastAt) / 1000;
  // With no clock (a shell given no scheduler, a first view), the step stands as it is.
  const moved = seconds > SYNC_FRAME_S ? (step * SYNC_FRAME_S) / seconds : step;
  c.lastAt = now;
  c.lastX = x;
  c.lastZ = z;
  if (ox === c.originX && oz === c.originZ) return "none";
  const first = Number.isNaN(c.originX) || Number.isNaN(c.originZ);
  const jump = Math.abs(ox - c.originX) > cell || Math.abs(oz - c.originZ) > cell;
  c.originX = ox;
  c.originZ = oz;
  if (!deferrable || first || jump || moved > Math.min(cell / 2, SYNC_FAST_STEP_M)) return "now";
  return "later";
}
