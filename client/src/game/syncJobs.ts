/**
 * The renderer's rebuilds, spread over frames under a per-frame budget.
 *
 * A rebuild that a crossing starts — the terrain's rings, the ground cover's
 * lists — is a job: a generator whose every `yield` ends one slice and whose
 * last slice applies the result to the shell's meshes in one step, so no frame
 * ever draws a buffer half written. `run`, called once a frame at the end of
 * the renderer's `sync`, first runs to its end any job begun
 * `SYNC_LATE_FRAMES_MAX` frames ago, then gives the jobs still pending, oldest
 * first, one slice after another until `SYNC_BUDGET_MS` of the clock has
 * gone. A job's result therefore reaches the screen at most
 * `SYNC_LATE_FRAMES_MAX` frames after the crossing that began it, and a frame
 * spends at most the budget and one slice on jobs unless a job is that late.
 *
 * Which crossings wait and which do not is each shell's `crossingAt`: the
 * first build, a jump of more than one cell (a teleport) and a view moving
 * more than half a cell a frame (the free camera's boost) all build at once,
 * as they did before there were jobs, so at those the picture is exactly what
 * it was. A crossing that finds the shell's last job still pending — the view
 * has moved past a further line before that job applied, as a walk along a
 * diagonal does whenever it crosses an x line and a z line a few frames apart
 * — replaces it with the rebuild for the new view, which keeps the old job's
 * deadline: the view it was begun for is never drawn, and the picture is
 * still never more than `SYNC_LATE_FRAMES_MAX` frames behind the first
 * crossing it has not yet shown.
 *
 * Pure and Babylon-free: time is the clock handed in, so a test drives it.
 */

/** The most a frame's `run` spends on jobs (ms), past which it starts no
 * further slice. */
export const SYNC_BUDGET_MS = 4;

/** The most frames a job's result may reach the screen after the crossing
 * that began it; a job this old is run to its end, whatever the budget. */
export const SYNC_LATE_FRAMES_MAX = 6;

/** A rebuild in slices: each `next()` runs one slice, and the call that
 * returns `done` has applied the result. */
export type Slices<T = void> = Generator<void, T, void>;

/** Runs `slices` to its end at once and returns what it returns. */
export function finish<T>(slices: Slices<T>): T {
  for (;;) {
    const step = slices.next();
    if (step.done === true) return step.value;
  }
}

export type SyncJobs = {
  /** Queues `slices` as `owner`'s job, begun this frame. An owner has at most
   * one job: one it already has is dropped unfinished, and the new one takes
   * its place in the queue and its deadline. */
  begin(owner: object, slices: Slices): void;
  /** Drops `owner`'s pending job unfinished; its meshes keep what they drew. */
  cancel(owner: object): void;
  /** Whether `owner` has a job begun and not yet applied. */
  pending(owner: object): boolean;
  /** This frame's share: the late jobs to their end, then slices of the rest
   * until the budget is spent. Call once a frame, after every shell's update. */
  run(): void;
  /** Frames `run` has closed. */
  readonly frame: number;
  /** Slices the last `run` ran, and how many of them it ran past the budget
   * because a job was late. For the tests. */
  readonly last: { readonly slices: number; readonly late: number; readonly completed: number };
};

type Job = { owner: object; slices: Slices; begun: number };

/**
 * The scheduler. `clock` is read once as `run` starts and once before each
 * slice; the renderer passes `performance.now`.
 */
export function createSyncJobs(clock: () => number): SyncJobs {
  const queue: Job[] = [];
  let frame = 0;
  const last = { slices: 0, late: 0, completed: 0 };

  function remove(job: Job): void {
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  }

  /** One slice of `job`; true when it has applied. A slice that throws takes
   * its job out of the queue before the error goes on. */
  function slice(job: Job): boolean {
    let done: boolean | undefined;
    try {
      done = job.slices.next().done;
    } finally {
      if (done !== false) remove(job);
    }
    last.slices++;
    if (done === true) last.completed++;
    return done === true;
  }

  return {
    begin(owner, slices) {
      const held = queue.find((job) => job.owner === owner);
      if (held === undefined) {
        queue.push({ owner, slices, begun: frame });
        return;
      }
      held.slices = slices;
    },
    cancel(owner) {
      const held = queue.find((job) => job.owner === owner);
      if (held !== undefined) remove(held);
    },
    pending(owner) {
      return queue.some((job) => job.owner === owner);
    },
    run() {
      last.slices = 0;
      last.late = 0;
      last.completed = 0;
      const start = clock();
      // A late job goes to its end first: it is the one the picture waits on.
      // Its last slice takes it out of the queue, so the next job moves up
      // into its index. Indexed rather than iterated over a copy: this runs
      // every frame, and allocates nothing.
      for (let i = 0; i < queue.length;) {
        const job = queue[i] as Job;
        if (frame - job.begun < SYNC_LATE_FRAMES_MAX) {
          i++;
          continue;
        }
        while (!slice(job)) last.late++;
        last.late++;
      }
      while (queue.length > 0 && clock() - start < SYNC_BUDGET_MS) slice(queue[0] as Job);
      frame++;
    },
    get frame() {
      return frame;
    },
    last,
  };
}

/** What a shell does with this frame's view. */
export type CrossingKind = "none" | "now" | "later";

/** A shell's record of the views it has been handed: the origin on its
 * rebuild grid it last built or began building for, and last frame's view. */
export type Crossing = { originX: number; originZ: number; lastX: number; lastZ: number };

export function createCrossing(): Crossing {
  return { originX: NaN, originZ: NaN, lastX: NaN, lastZ: NaN };
}

/**
 * Classifies this frame's view (x, z), whose origin on the shell's rebuild
 * grid of `cell` metres is (ox, oz), and records both. "none" while the origin
 * holds. Otherwise "now" — build at once, as before there were jobs — for the
 * first build, for a jump of more than one cell on either axis since the last
 * origin (a teleport, a burst of speed), for a view that moved more than half a
 * cell since last frame (so the next crossing is at most a frame or two away),
 * and for a shell given no scheduler (`deferrable` false). "later" for
 * everything else: a one-cell step at a walk or a run, which becomes a job.
 */
export function crossingAt(
  c: Crossing,
  x: number,
  z: number,
  ox: number,
  oz: number,
  cell: number,
  deferrable: boolean,
): CrossingKind {
  const moved = Math.hypot(x - c.lastX, z - c.lastZ);
  c.lastX = x;
  c.lastZ = z;
  if (ox === c.originX && oz === c.originZ) return "none";
  const first = Number.isNaN(c.originX) || Number.isNaN(c.originZ);
  const jump = Math.abs(ox - c.originX) > cell || Math.abs(oz - c.originZ) > cell;
  c.originX = ox;
  c.originZ = oz;
  if (!deferrable || first || jump || moved > cell / 2) return "now";
  return "later";
}
