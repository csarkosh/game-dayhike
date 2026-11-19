import { createSyncJobs, type Slices } from "../../src/game/syncJobs.js";

/**
 * Runs `slices` to its end the way the renderer's scheduler runs a job, on a clock that has passed a slice's whole
 * target at every reading: a builder that asks `sliceDue` gives the thread back at every reading it makes, the
 * most slices it can be cut into. Returns what the slices return and how many slices it was cut into.
 */
export function runBySlices<T>(slices: Slices<T>, step = 10): { value: T; slices: number } {
  let now = 0;
  const jobs = createSyncJobs(() => (now += step));
  let value: T | undefined;
  let cut = 0;
  const owner = {};
  jobs.begin(owner, (function* () {
    value = yield* slices;
  })());
  // The share's own readings advance the clock too, so every frame runs a slice or more; a bound keeps a stuck builder from looping.
  for (let frame = 0; jobs.pending(owner); frame++) {
    if (frame > 5_000_000) throw new Error("the slices did not end");
    jobs.run();
    cut += jobs.last.slices;
  }
  return { value: value as T, slices: cut };
}
