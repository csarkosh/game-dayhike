/**
 * A shell's rebuilds as the renderer's jobs (`syncJobs.ts`): which of a
 * view's crossings build at once and which over the frames after, and the
 * idle work between them, decided as the game's shells on Babylon.js decide
 * it (`forestMeshes.ts`, `clutterMeshes.ts`, `bladeMeshes.ts`,
 * `duffMeshes.ts`): by `crossingAt`, on the shell's own rebuild grid.
 *
 * A crossing at a walk begins a job, or takes the place of the shell's job
 * still pending, which keeps its deadline. The first build, a jump of more
 * than a cell and a view moving fast build at once, or are stepped by the
 * loader of first builds while the intro's film covers the hike
 * (`firstBuilds.ts`). While the view holds its cell and nothing is pending,
 * the shell's idle work is aimed once at the next crossing on the view's
 * heading, and aimed again when the view turns or a rebuild has been shown.
 *
 * A shell given no scheduler builds every crossing at once, in the call.
 *
 * Loads no engine: a test drives it with a scheduler on a clock of its own.
 */
import { buildAtOnce, type FirstBuilds } from "../firstBuilds.js";
import { createCrossing, crossingAt, turn, type CrossingKind, type Heading, type Slices, type SyncJobs } from "../syncJobs.js";

export type RebuildOptions = {
  /** The job's name in the scheduler's record and the loader's. */
  name: string;
  /** The shell's rebuild grid (m). */
  cell: number;
  /** The view's origin on that grid, written to `out` as x, z. */
  origin(x: number, z: number, out: Float64Array): void;
  /** The rebuild for a view at (x, z), as slices: the last one shows its result whole. */
  rebuild(x: number, z: number): Slices;
  /** Idle work ahead of the next crossing from (x, z) on the heading; absent or null, none. */
  ahead?(x: number, z: number, headingX: number, headingZ: number): Slices | null;
  /** The renderer's scheduler; absent, every crossing builds at once. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike. */
  firstBuilds?: FirstBuilds;
};

export type Rebuilds = {
  /** This frame's view: begins, replaces or runs the rebuild its crossing asks for, and says which. */
  update(x: number, z: number): CrossingKind;
  /** Whether a rebuild is begun and not yet shown, the scheduler's or the loader's. */
  pending(): boolean;
  /** Ends what is pending and the idle work, unfinished. */
  dispose(): void;
};

export function createRebuilds(options: RebuildOptions): Rebuilds {
  const { jobs, firstBuilds, name, cell } = options;
  const crossing = createCrossing();
  /** This shell, as the scheduler and the loader know it. */
  const owner = {};
  const heading: Heading = { x: 0, z: 0 };
  const origin = new Float64Array(2);
  /** Whether the idle work is aimed at the next crossing from where the last rebuild left the shell, on the present heading. */
  let aimed = false;

  function* rebuild(x: number, z: number): Slices {
    yield* options.rebuild(x, z);
    aimed = false;
  }

  /** Sets the idle work for the next crossing, while no rebuild is pending. */
  function aim(x: number, z: number): void {
    if (aimed || jobs === undefined || options.ahead === undefined || jobs.pending(owner)) return;
    aimed = true;
    jobs.idle(owner, options.ahead(x, z, heading.x, heading.z) ?? null);
  }

  return {
    update(x, z) {
      if (turn(heading, x - crossing.lastX, z - crossing.lastZ)) aimed = false;
      options.origin(x, z, origin);
      const kind = crossingAt(crossing, x, z, origin[0] as number, origin[1] as number, cell, jobs !== undefined, jobs?.started());
      if (kind === "none") {
        // While the loader steps this shell's build, nothing is prepared ahead of it.
        if (firstBuilds?.queued(owner) !== true) aim(x, z);
        return kind;
      }
      // A new place: a build the loader still holds for the last one is dropped.
      firstBuilds?.cancel(owner);
      if (kind === "later") {
        (jobs as SyncJobs).begin(owner, rebuild(x, z), false, name);
        return kind;
      }
      jobs?.cancel(owner);
      buildAtOnce(firstBuilds, owner, rebuild(x, z), name);
      return kind;
    },
    pending: () => (jobs?.pending(owner) ?? false) || (firstBuilds?.queued(owner) ?? false),
    dispose() {
      jobs?.cancel(owner);
      jobs?.idle(owner, null);
      // A build the loader still holds is dropped with the shell: it would be stepped against meshes that have gone.
      firstBuilds?.cancel(owner);
    },
  };
}

/** A grid's origin for a view: each coordinate floored to a line of `cell` metres. */
export function cellOrigin(cell: number): (x: number, z: number, out: Float64Array) => void {
  return (x, z, out) => {
    out[0] = Math.floor(x / cell) * cell;
    out[1] = Math.floor(z / cell) * cell;
  };
}
