// When the rebuilds a crossing starts run as jobs, and what they compute. What
// they upload is in `rebuildJobsUploads.test.ts`, and the clutter's walk of 40
// crossings, about 90 s alone on a CI runner, in `rebuildJobsClutter.test.ts`:
// vitest hands out files, not tests, and as one file of about 230 s these were
// one of the floors under the client suite. The shells all three drive are
// `helpers/rebuildShells.ts`.
import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";

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
import { createClipmap } from "../../src/game/renderer.js";
import { snapOrigin } from "../../src/game/clipmap.js";
import { createSyncJobs, finish as finishSlices, type Slices, type SyncJobs } from "../../src/game/syncJobs.js";
import { collectBladeCells, createBladeCollector } from "../../src/game/bladeField.js";
import { DUFF_REACH, collectDuffCells, createDuffCollector } from "../../src/game/duffField.js";
import { collectClutter, createClutterCollector } from "../../src/game/clutterField.js";
import { SEED, differences, type Uploads } from "../helpers/groundCoverUploads.js";
import { timeLimit } from "../helpers/timeLimit.js";
import {
  BOOST, DT, HEADING, SHELLS, TICK, WALKING, expectedRings, referenceRings, ringUploads, tickClock, walk,
} from "./helpers/rebuildShells.js";

/** Each shell's rebuild grid, as its `update` snaps a coordinate. */
const GRIDS: Record<string, (v: number) => number> = {
  clipmap: (v) => snapOrigin(v, 1),
  clutter: (v) => Math.floor(v / 3) * 3,
  blades: (v) => Math.floor(v),
  duff: (v) => Math.floor(v),
  forest: (v) => Math.floor(v / 10) * 10,
};

/**
 * A scheduler that runs nothing: it keeps the job a shell begins, for the
 * test to step a slice at a time, and ends any idle work it is handed, so the
 * rebuild does all its work itself.
 */
function keeper(): SyncJobs & { held: Slices | null } {
  const owners = new Set<object>();
  const k = {
    held: null as Slices | null,
    begin(owner: object, slices: Slices) {
      k.held?.return(undefined);
      k.held = slices;
      owners.add(owner);
    },
    cancel() {
      k.held?.return(undefined);
      k.held = null;
    },
    pending(owner: object) {
      return k.held !== null && owners.has(owner);
    },
    idle(_owner: object, slices: Slices | null) {
      slices?.return(undefined);
    },
    run() {},
    frame: 0,
    last: { slices: 0, late: 0, completed: 0, idle: 0 },
  };
  return k;
}

/** Slices of each shell's rebuild at the first crossing of a walk from its
 * start, with nothing prepared ahead: each loop of a rebuild yields by the
 * work it has done, so a rebuild that stops slicing, in any of its loops,
 * changes these. The forest's 143 since the pine's second bark set: a
 * giant bucket set more to slice through, its three LOD buckets and its
 * billboard (the understory stays with the species' first set). The
 * clutter's 168 since the meadow's far band: its cards to 100 m, so more
 * cells looked up a step and more instances staged. */
const STEP_SLICES: Record<string, number> = { clipmap: 30, clutter: 168, blades: 18, duff: 5, forest: 143 };

describe("rebuilds as jobs: when", () => {
  for (const shellOf of SHELLS) {
    it(`${shellOf().name}: slices its rebuild at a step, and leaves every buffer its meshes draw, and every one a cut reads, as it was until the last slice`, () => {
      const shell = shellOf();
      const k = keeper();
      const s = shell.make(k);
      /** Everything a frame draws: every instance, and for the shells that
       * cut to the view, two opposing cuts, each of which reads the collected
       * buffers and counts afresh. */
      const seen = (): Uploads => {
        const all = s.drawn();
        if (s.cuts !== undefined) for (const [key, bits] of s.cuts()) all.set(key, bits);
        return all;
      };
      let slices = 0;
      for (const p of walk(shell.start, WALKING)) {
        const was = { x: s.view.x, z: s.view.z };
        const before = seen();
        s.update(p.x, p.z);
        if (k.held === null) continue;
        // A crossing began a job: after every slice but its last, everything
        // drawn and cut is as it was.
        expect([s.view.x, s.view.z]).toEqual([was.x, was.z]);
        const job = k.held;
        for (let step = job.next(); step.done !== true; step = job.next()) {
          slices++;
          expect(differences(seen(), before), `${shell.name}: after slice ${slices}`).toEqual([]);
        }
        k.held = null;
        // The last slice applied what the present rebuild uploads for its
        // view, and changed what is drawn.
        expect([s.view.x, s.view.z]).toEqual([p.x, p.z]);
        expect(differences(s.drawn(), shell.expected(p.x, p.z))).toEqual([]);
        expect(differences(seen(), before).length).toBeGreaterThan(0);
        break;
      }
      expect(slices).toBe(STEP_SLICES[shell.name]);
      s.dispose();
    }, timeLimit(240_000));
  }

  it("spends at most the budget and one slice a frame on a walk, and brings every view up within six frames of its crossing", () => {
    const jobs = createSyncJobs(tickClock(TICK));
    const shells = SHELLS.map((shellOf) => shellOf());
    const made = shells.map((shell) => shell.make(jobs));
    const start = { x: 100.5, z: 100.5 };
    const origins = shells.map(() => ({ x: NaN, z: NaN }));
    /** Crossings not yet on screen, per shell: where and in which frame. */
    const due: { x: number; z: number; frame: number }[][] = shells.map(() => []);
    let crossings = 0;
    let crowded = 0;
    let slowest = 0;
    for (const p of walk(start, WALKING)) {
      if (p.frame === 600) break;
      let begun = 0;
      shells.forEach((shell, i) => {
        const grid = GRIDS[shell.name]!;
        const o = { x: grid(p.x), z: grid(p.z) };
        if (p.frame > 0 && (o.x !== origins[i]!.x || o.z !== origins[i]!.z)) {
          due[i]!.push({ x: p.x, z: p.z, frame: p.frame });
          begun++;
          crossings++;
        }
        origins[i] = o;
        made[i]!.update(p.x, p.z);
      });
      jobs.run();
      // Nothing was late, and the frame started no slice past its budget.
      expect(jobs.last.late, `frame ${p.frame}`).toBe(0);
      // Forty slices of 0.1 ms, and one past the budget.
      expect(jobs.last.slices, `frame ${p.frame}`).toBeLessThanOrEqual(41);
      if (begun >= 2) crowded++;
      made.forEach((s, i) => {
        // The view drawn is a crossing's: that one and every one before it,
        // which a further crossing overtook before its job applied, are on
        // screen or never will be.
        const queue = due[i]!;
        const shown = queue.findIndex((c) => s.view.x === c.x && s.view.z === c.z);
        if (shown >= 0) {
          slowest = Math.max(slowest, p.frame - queue[0]!.frame);
          queue.splice(0, shown + 1);
        }
        // What is not yet on screen crossed fewer than six frames ago.
        if (queue[0] !== undefined) expect(p.frame - queue[0].frame, `${shells[i]!.name} at frame ${p.frame}`).toBeLessThan(6);
      });
    }
    // 600 frames at a walk: 52.5 m. Crossings of all four grids, several of
    // them in the same frame as another; none waited more than six frames,
    // including any a further line along the diagonal overtook.
    expect(crossings).toBeGreaterThan(100);
    expect(crowded).toBeGreaterThan(5);
    expect(slowest).toBeLessThanOrEqual(6);
    for (const s of made) s.dispose();
  }, timeLimit(240_000));

  for (const shellOf of SHELLS) {
    it(`${shellOf().name}: builds the first view, a teleport and every crossing at 144 m/s at once, as the present rebuild does`, () => {
      const shell = shellOf();
      const jobs = createSyncJobs(tickClock(TICK));
      const s = shell.make(jobs);
      const check = (x: number, z: number, what: string): void => {
        s.update(x, z);
        // Built before the frame's share of jobs runs: at once.
        expect([s.view.x, s.view.z], what).toEqual([x, z]);
        expect(differences(s.drawn(), shell.expected(x, z)), what).toEqual([]);
        jobs.run();
      };
      check(shell.start.x, shell.start.z, "first build");
      // A few frames' walk, then a teleport 500 m on.
      const w = walk(shell.start, WALKING);
      for (let f = 0; f < 30; f++) {
        const p = w.next().value!;
        s.update(p.x, p.z);
        jobs.run();
      }
      const far = { x: shell.start.x + 500, z: shell.start.z - 300 };
      check(far.x, far.z, "teleport");
      // The free camera's boost: every crossing built in its own frame.
      let fast = 0;
      const grid = GRIDS[shell.name]!;
      for (const p of walk(far, BOOST)) {
        if (p.frame === 0) continue;
        if (fast === 3) break;
        const moved = grid(p.x) !== grid(p.x - Math.cos(HEADING) * BOOST * DT) || grid(p.z) !== grid(p.z - Math.sin(HEADING) * BOOST * DT);
        if (!moved) {
          s.update(p.x, p.z);
          jobs.run();
          continue;
        }
        check(p.x, p.z, `boost frame ${p.frame}`);
        fast++;
      }
      expect(fast).toBe(3);
      s.dispose();
    }, timeLimit(240_000));
  }
});

describe("rebuilds as jobs: what is computed", () => {
  it("lifts 766 vertices at a ring-0 step, where re-emitting rings 0 and 1 whole lifted 84,034", () => {
    // The step moves ring 0 by one snap (two cells) along x and nothing else.
    // Its new columns, the old border column, the new border column and the
    // two border rows are lifted (4 × 127 + 2 × 129); every other vertex is
    // interior to both rings and keeps its lift. The rebuild before lifted
    // every vertex of both rings it re-emitted, and again once or twice for
    // each blended vertex's coarser height: 45,697 for ring 0 and 38,337 for
    // ring 1.
    const engine = new NullEngine();
    const clipmap = createClipmap(new Scene(engine), SEED);
    clipmap.update(0.5, 0.5);
    clipmap.update(2.5, 0.5);
    expect(clipmap.lifted).toBe(766);
    expect(differences(ringUploads(clipmap), expectedRings(referenceRings(), 2.5, 0.5))).toEqual([]);
    clipmap.dispose();
    engine.dispose();
  }, timeLimit(60_000));

  it("looks up 2,115 clutter cells a grass cell on, where a walk of every cell looks up 127,281", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(100.5, 100.5);
    expect(collector.walked).toBe(127281);
    const bands = collector.collect(103.5, 100.5);
    // The strips the fourteen classes' squares add, a column or a few each,
    // the meadow's 287 cells high since its far band.
    expect(collector.walked).toBe(2115);
    expect(bands).toEqual(collectClutter(SEED, 103.5, 100.5));
  }, timeLimit(60_000));

  it("looks up 164 blade cells and 54 duff cells a metre on, where a walk of every cell looks up 6,724 and 2,916", () => {
    const blades = createBladeCollector(SEED);
    blades.collect(35.5, 21335.5);
    expect(blades.walked).toBe(6724);
    const tiers = blades.collect(36.5, 21335.5);
    // Two columns of the half-metre lattice, 82 cells high.
    expect(blades.walked).toBe(164);
    expect(tiers).toEqual(collectBladeCells(SEED, 36.5, 21335.5));
    const duff = createDuffCollector(SEED);
    duff.collect(480.5, -599.5, DUFF_REACH.high);
    expect(duff.walked).toBe(2916);
    const pieces = duff.collect(481.5, -599.5, DUFF_REACH.high);
    // One column of the metre lattice, 54 cells high.
    expect(duff.walked).toBe(54);
    expect(pieces).toEqual(collectDuffCells(SEED, 481.5, -599.5, DUFF_REACH.high));
  }, timeLimit(60_000));

  it("looks up again, after a sweep, the cells it let go inside a square, and lists what a walk of every cell lists", () => {
    // The sweep lets go every cell whose nearest point is past the eviction
    // radius, and a square's corner cells can be: a walk of every cell looks
    // them up again at the next collect, and the collectors that keep their
    // squares must too, or they would list instances the cache no longer
    // holds.
    const blades = createBladeCollector(SEED);
    let x = 35.5;
    blades.collect(x, 21335.5);
    let size = blades.size;
    for (;;) {
      x += 1;
      blades.collect(x, 21335.5);
      if (blades.size < size) break;
      size = blades.size;
    }
    const swept = x;
    // The sweep 142 m on; the collect after it looks up the strip's 164
    // cells and the 300 the sweep let go in the square's corners.
    const tiers = blades.collect(x + 1, 21335.5);
    expect([swept, blades.walked]).toEqual([177.5, 464]);
    expect(tiers).toEqual(collectBladeCells(SEED, x + 1, 21335.5));
    expect(blades.collect(x + 2, 21335.5)).toEqual(collectBladeCells(SEED, x + 2, 21335.5));

    const clutter = createClutterCollector(SEED);
    let cx = 100.5;
    clutter.collect(cx, 100.5);
    size = clutter.size;
    for (;;) {
      cx += 3;
      clutter.collect(cx, 100.5);
      if (clutter.size < size) break;
      size = clutter.size;
    }
    // The sweep 150 m on (the meadow's square, 287 cells a side since its far
    // band, fills the cache sooner); the collect after it looks up the
    // fourteen strips and the corner cells the sweep let go, 14,985 in all,
    // most of them the meadow square's corners past its disc.
    const bands = clutter.collect(cx + 3, 100.5);
    expect([cx, clutter.walked]).toEqual([250.5, 14985]);
    expect(bands).toEqual(collectClutter(SEED, cx + 3, 100.5));
  }, timeLimit(120_000));

  it("looks up ahead the strip the next collect adds, which then samples nothing and lists what a walk of every cell lists", () => {
    // Walking along +x: the next collects are those of the first frame past
    // the next grass-cell line (102 m) and the next metre line (36 m).
    const clutter = createClutterCollector(SEED);
    clutter.collect(100.5, 100.5);
    const cold = clutter.size;
    finishSlices(clutter.prefetchSlices(100.5, 100.5, 0.0875, 0, 1));
    const ahead = clutter.size;
    const bands = clutter.collect(102.05, 100.5);
    expect([ahead - cold, clutter.size - ahead]).toEqual([1171, 0]);
    expect(bands).toEqual(collectClutter(SEED, 102.05, 100.5));

    const blades = createBladeCollector(SEED);
    blades.collect(35.5, 21335.5);
    const found: unknown[] = [];
    finishSlices(blades.prefetchSlices(35.5, 21335.5, 0.0875, 0, (c) => {
      found.push(c);
      return 1;
    }));
    const size = blades.size;
    const tiers = blades.collect(36.05, 21335.5);
    expect([found.length, blades.size - size]).toEqual([77, 0]);
    expect(tiers).toEqual(collectBladeCells(SEED, 36.05, 21335.5));
  }, timeLimit(60_000));

  it("prepares the terrain's next moves with the budget jobs leave, and a crossing commits them without sampling", () => {
    const engine = new NullEngine();
    const jobs = createSyncJobs(tickClock(TICK));
    const clipmap = createClipmap(new Scene(engine), SEED, jobs);
    let builds = 0;
    let prepared = 0;
    let lifted = 0;
    let lastView = NaN;
    for (const p of walk({ x: 0.5, z: 0.5 }, WALKING)) {
      if (p.frame === 1200) break;
      clipmap.update(p.x, p.z);
      jobs.run();
      if (clipmap.view.x !== lastView && p.frame > 0) {
        builds++;
        prepared += clipmap.prepared;
        lifted += clipmap.lifted;
      }
      lastView = clipmap.view.x;
    }
    // 105 m at a walk, 64 crossings and 121 ring moves prepared ahead; the
    // crossings themselves lifted what two moves not prepared lift (766 a
    // step), where every move lifted that many before.
    expect([builds, prepared, lifted]).toEqual([64, 121, 1532]);
    clipmap.dispose();
    engine.dispose();
  }, timeLimit(120_000));
});
