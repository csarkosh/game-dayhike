// What the rebuilds a crossing starts upload, as jobs, over a walk and over a
// walk that turns, held to what the present rebuild uploads. The clutter's
// walk of 40 crossings, about 90 s alone on a CI runner, is
// `rebuildJobsClutter.test.ts`, and when the jobs run and what they compute is
// `rebuildJobs.test.ts`: vitest hands out files, not tests, and as one file of
// about 230 s these were one of the floors under the client suite.
import { describe, expect, it, vi } from "vitest";

// The terrain material's ground textures are a texture array NullEngine
// cannot make; `renderer.test.ts` stands in for them the same way.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

import "../../src/sim/passes/index.js";
import { createSyncJobs, type SyncJobs } from "../../src/game/syncJobs.js";
import { differences } from "../helpers/groundCoverUploads.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { DT, SHELLS, WALKING, checkWalkUploads, tickClock } from "./helpers/rebuildShells.js";

describe("rebuilds as jobs: what is uploaded", () => {
  // The clutter's walk is `rebuildJobsClutter.test.ts`, a file of its own.
  for (const shellOf of SHELLS.filter((of) => of().name !== "clutter")) {
    it(`${shellOf().name}: uploads, over a walk of 40 crossings, exactly what the present rebuild uploads for each view`, () => {
      checkWalkUploads(shellOf);
    }, timeLimit(240_000));
  }
});

/** How a walk that turns meets each shell's grid: its rebuild cell (m), and
 * where its lines lie. The clipmap's step is ring 0's snap, whose lines lie
 * on even metres. */
const LINES: Record<string, number> = { clipmap: 2, clutter: 3, blades: 1, duff: 1, forest: 10 };

/**
 * A walk that turns: a frame's walking step at a time along +x for three
 * cells, back along −x for three, then up to a point a centimetre short of
 * an x line, where it stops, steps across the line and back five times
 * (across for a frame, back for three), then off along the diagonal so that
 * it crosses an x line and a z line two frames apart, and stands.
 */
function* turningWalk(start: { x: number; z: number }, cell: number): Generator<{ x: number; z: number }> {
  const step = WALKING * DT;
  let x = start.x;
  let z = start.z;
  /** Walks to (tx, tz) a step a frame. */
  function* to(tx: number, tz: number): Generator<{ x: number; z: number }> {
    for (;;) {
      const d = Math.hypot(tx - x, tz - z);
      if (d <= step) {
        x = tx;
        z = tz;
        yield { x, z };
        return;
      }
      x += ((tx - x) / d) * step;
      z += ((tz - z) / d) * step;
      yield { x, z };
    }
  }
  yield { x, z };
  yield* to(start.x + 3 * cell, z);
  yield* to(start.x, z);
  const line = (Math.floor(x / cell) + 1) * cell;
  yield* to(line - 0.01, z);
  for (let i = 0; i < 5; i++) {
    yield { x: line + 0.01, z };
    x = line - 0.01;
    for (let f = 0; f < 3; f++) yield { x, z };
  }
  // Two frames' diagonal steps short of the z line, a centimetre past the x line.
  const d = step / Math.SQRT2;
  const zLine = (Math.floor(z / cell) + 1) * cell;
  yield* to(line - 0.01, zLine - 0.01 - 2 * d);
  for (let f = 0; f < 40; f++) {
    x += d;
    z += d;
    yield { x, z };
  }
  for (let f = 0; f < 20; f++) yield { x, z };
}

describe("rebuilds as jobs: a walk that turns", () => {
  for (const shellOf of SHELLS.filter((of) => of().name !== "forest")) {
    it(`${shellOf().name}: uploads, where the walk turns back, stops on a line, steps across it and back, and crosses two lines two frames apart, exactly what the present rebuild uploads for each view`, () => {
      const shell = shellOf();
      // A frame runs one slice, so a job spans frames and a further crossing
      // finds it pending.
      const jobs = createSyncJobs(tickClock(2.5));
      let replaced = 0;
      const counted: SyncJobs = {
        ...jobs,
        begin(owner, slices) {
          if (jobs.pending(owner)) replaced++;
          jobs.begin(owner, slices);
        },
        pending: (owner) => jobs.pending(owner),
        cancel: (owner) => jobs.cancel(owner),
        idle: (owner, slices) => jobs.idle(owner, slices),
        run: () => jobs.run(),
      };
      const s = shell.make(counted);
      let built = 0;
      let lastView = { x: NaN, z: NaN };
      for (const p of turningWalk(shell.start, LINES[shell.name]!)) {
        s.update(p.x, p.z);
        jobs.run();
        if (s.view.x !== lastView.x || s.view.z !== lastView.z) {
          lastView = { x: s.view.x, z: s.view.z };
          expect(differences(s.drawn(), shell.expected(lastView.x, lastView.z)), `${shell.name} build ${built}`).toEqual([]);
          built++;
        }
      }
      // Builds applied, and jobs replaced while pending by a further crossing.
      expect([built, replaced]).toEqual(TURNING[shell.name]);
      s.dispose();
    }, timeLimit(240_000));
  }
});

/** Builds applied and jobs replaced on each shell's walk that turns. */
const TURNING: Record<string, [number, number]> = { clipmap: [10, 7], clutter: [9, 8], blades: [11, 10], duff: [11, 8] };
