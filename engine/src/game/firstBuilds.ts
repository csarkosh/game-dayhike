/**
 * A hike's first builds, stepped while its intro's film covers it.
 *
 * A shell's first build is its largest: the forest and the ground cover each fill a whole disc
 * around the player, half a second of work on a phone. Run whole, each stops the page for that
 * long, and under the film the captions and the loading bar stand with it. So a shell that is
 * building for the first time hands its build here instead of draining it: the loader steps the
 * builds one at a time, in the order they came, in turns of its own (macrotasks, not frames),
 * each turn giving the thread back once `sliceMs` have passed. Under the film any build that
 * cannot wait for the frame's scheduler comes here, a shell's first or one after a jump.
 *
 * It lives only as long as the film's cover. `close` (the cut) runs whatever is left to its end
 * and from then on a build handed in runs whole, at once: a first build in play, after a
 * teleport or on a renderer made mid-hike, is not held back. `dispose` (the hike left) runs
 * nothing more.
 */
import { FIRST_BUILD_SLICE_MS, finish, type Slices } from "./syncJobs.js";

export type FirstBuilds = {
  /** True until `close` or `dispose`: a shell asks before handing a first build over. */
  readonly open: boolean;
  /** Queues `owner`'s first build to be stepped; a build of the owner's already queued is ended and replaced. Closed, the build runs whole here; disposed, not at all. */
  add(owner: object, slices: Slices, name: string): void;
  /** Ends `owner`'s queued build and drops it. */
  cancel(owner: object): void;
  /** Whether `owner` has a build queued or in hand: a shell does no other work on what that build is making meanwhile. */
  queued(owner: object): boolean;
  /** How many builds are queued or in hand. */
  pending(): number;
  /** Resolves when nothing is queued or in hand; at once when nothing is. */
  idle(): Promise<void>;
  /** Resolves once nothing is queued and nothing was queued meanwhile: a build dropped and another
   * queued in its place (a jump) settles `idle` in between, and this waits on. */
  drained(): Promise<void>;
  /** Runs everything queued to its end now, in order, and closes. */
  close(): void;
  /** Ends everything queued without running it, and closes. */
  dispose(): void;
};

type Job = { owner: object; slices: Slices; name: string };

export function createFirstBuilds(deps: { now?: () => number; later?: (run: () => void) => void; sliceMs?: number } = {}): FirstBuilds {
  const now = deps.now ?? (() => performance.now());
  const later = deps.later ?? ((run: () => void) => void setTimeout(run, 0));
  const sliceMs = deps.sliceMs ?? FIRST_BUILD_SLICE_MS;
  const queue: Job[] = [];
  let open = true;
  let disposed = false;
  let asked = false;
  let waiting: (() => void)[] = [];
  const settle = (): void => {
    if (queue.length > 0) return;
    const resolve = waiting;
    waiting = [];
    for (const r of resolve) r();
  };
  const ask = (): void => {
    if (asked || queue.length === 0) return;
    asked = true;
    later(turn);
  };
  /** One turn: the build in hand stepped until `sliceMs` have passed, the next taken up as one ends. */
  function turn(): void {
    asked = false;
    const since = now();
    while (queue.length > 0) {
      const job = queue[0] as Job;
      let done: boolean;
      try {
        done = job.slices.next().done === true;
      } catch (error) {
        // A build that broke is dropped; the rest go on, and the page's own handling sees the error.
        queue.shift();
        ask();
        settle();
        throw error;
      }
      if (done) queue.shift();
      else if (now() - since >= sliceMs) break;
    }
    ask();
    settle();
  }
  const idle = (): Promise<void> => (queue.length === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve)));
  const drop = (owner: object): void => {
    const i = queue.findIndex((j) => j.owner === owner);
    if (i < 0) return;
    const [job] = queue.splice(i, 1);
    (job as Job).slices.return();
  };
  return {
    get open() {
      return open;
    },
    add(owner, slices, name) {
      if (disposed) {
        slices.return();
        return;
      }
      if (!open) {
        finish(slices);
        return;
      }
      drop(owner);
      queue.push({ owner, slices, name });
      ask();
    },
    cancel(owner) {
      drop(owner);
      settle();
    },
    queued: (owner) => queue.some((j) => j.owner === owner),
    pending: () => queue.length,
    idle,
    async drained() {
      while (queue.length > 0) await idle();
    },
    close() {
      open = false;
      // Every build is run to its end though one throws: the rest are not left queued for ever, and
      // whoever waits on `idle` is let go. The first error is seen once they are done.
      let failed: { error: unknown } | null = null;
      while (queue.length > 0) {
        try {
          finish((queue.shift() as Job).slices);
        } catch (error) {
          failed ??= { error };
        }
      }
      settle();
      if (failed !== null) throw failed.error;
    },
    dispose() {
      open = false;
      disposed = true;
      for (const job of queue.splice(0)) job.slices.return();
      settle();
    },
  };
}

/**
 * A shell's build that cannot wait for the scheduler (its first, or one after a jump): handed to
 * the loader while one is open, which is while the intro's film covers the hike, and otherwise
 * run whole here, as it always was.
 */
export function buildAtOnce(loader: FirstBuilds | undefined, owner: object, slices: Slices, name: string): void {
  if (loader?.open === true) loader.add(owner, slices, name);
  else finish(slices);
}
