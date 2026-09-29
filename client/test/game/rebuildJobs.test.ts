import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";

// The terrain material's ground textures are a texture array NullEngine
// cannot make; `renderer.test.ts` stands in for them the same way.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

import "../../src/sim/passes/index.js";
import { createClipmap, type Clipmap } from "../../src/game/renderer.js";
import {
  createRingSamples, holeCellsFor, ringGeometry, snapOrigin, updateRingSamples, RING_COUNT, type RingGeometry,
  type RingSamples,
} from "../../src/game/clipmap.js";
import { SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, createSyncJobs, type SyncJobs } from "../../src/game/syncJobs.js";
import { collectBladeCells } from "../../src/game/bladeField.js";
import { createBladeMeshes, type BladeMeshes } from "../../src/game/bladeMeshes.js";
import { DUFF_REACH, collectDuffCells } from "../../src/game/duffField.js";
import { createDuffMeshes, type DuffMeshes } from "../../src/game/duffMeshes.js";
import { collectClutter } from "../../src/game/clutterField.js";
import { createClutterMeshes, type ClutterMeshes } from "../../src/game/clutterMeshes.js";
import {
  BLADE_KINDS, DUFF_KINDS, SEED, clutterKinds, clutterScene, differences, expectedBlades, expectedClutter,
  expectedDuff, uploads, type Spy, type Uploads,
} from "../helpers/groundCoverUploads.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A frame at 60 frames a second. */
const DT = 1 / 60;
/** On foot, m/s (`WALK_SPEED`). */
const WALKING = 5.25;
/** The free camera's boost, m/s. */
const BOOST = 144;
/** The heading every walk here takes: off both axes, so it crosses the
 * lines of both, and now and then both in one frame. */
const HEADING = 0.3;

/**
 * The test clock: every reading advances it by `tick` ms, and the scheduler
 * reads it once as a frame's share starts and once before each slice, so
 * every slice is charged `tick`. A tenth of a millisecond is about what a
 * slice of the terrain's or the ground cover's rebuild takes, and lets a
 * frame's budget hold forty.
 */
function tickClock(tick: number): () => number {
  let now = 0;
  return () => (now += tick);
}
const TICK = 0.1;

/** The positions of a walk from `start` along `HEADING` at `speed`, one a frame. */
function* walk(start: { x: number; z: number }, speed: number): Generator<{ x: number; z: number; frame: number }> {
  for (let frame = 0; ; frame++) {
    const s = frame * speed * DT;
    yield { x: start.x + Math.cos(HEADING) * s, z: start.z + Math.sin(HEADING) * s, frame };
  }
}

// ---------------------------------------------------------------- clipmap

const CLIPMAP_KINDS: [string, number][] = [
  [VertexBuffer.PositionKind, 3], [VertexBuffer.NormalKind, 3], [VertexBuffer.ColorKind, 4],
  ["terrainWeights", 4], ["terrainWeights2", 4], ["terrainCover", 1],
];

/** Every buffer of every ring, as bits. */
function ringUploads(clipmap: Clipmap): Uploads {
  const out: Uploads = new Map();
  for (const mesh of clipmap.meshes) {
    for (const [kind] of CLIPMAP_KINDS) {
      const data = mesh.getVerticesData(kind) as Float32Array;
      out.set(`${mesh.name}|${kind}`, new Uint32Array(Float32Array.from(data).buffer));
    }
    out.set(`${mesh.name}|indices`, Uint32Array.from(mesh.getIndices()!));
  }
  return out;
}

/** The present rebuild's buffers for every ring at (x, z): the rings moved by
 * `updateRingSamples`, each emitted whole by `ringGeometry`. */
function expectedRings(rings: RingSamples[], x: number, z: number): Uploads {
  for (const ring of rings) updateRingSamples(ring, SEED, x, z);
  const out: Uploads = new Map();
  for (let level = 0; level < RING_COUNT; level++) {
    const ring = rings[level]!;
    const g: RingGeometry = ringGeometry(
      ring, level === 0 ? null : holeCellsFor(ring, rings[level - 1]!), level < RING_COUNT - 1 ? rings[level + 1]! : null,
    );
    const name = `clipmap_${level}`;
    const arrays = [g.positions, g.normals, g.colors, g.weights, g.weights2, g.cover];
    CLIPMAP_KINDS.forEach(([kind], i) => out.set(`${name}|${kind}`, new Uint32Array(arrays[i]!.slice().buffer)));
    out.set(`${name}|indices`, Uint32Array.from(g.indices));
  }
  return out;
}

function referenceRings(): RingSamples[] {
  const rings: RingSamples[] = [];
  for (let level = 0; level < RING_COUNT; level++) rings.push(createRingSamples(SEED, level, 0, 0));
  return rings;
}

// ---------------------------------------------------------------- the shells

/** One shell under test: how to build it, where it walks, and what the
 * present rebuild uploads for a view. */
type Shell = {
  name: string;
  start: { x: number; z: number };
  make(jobs: SyncJobs | undefined): { update(x: number, z: number): void; view: { x: number; z: number }; drawn(): Uploads; dispose(): void };
  expected(x: number, z: number): Uploads;
};

function clipmapShell(): Shell {
  let engine: NullEngine | null = null;
  let rings: RingSamples[] | null = null;
  return {
    name: "clipmap",
    start: { x: 0.5, z: 0.5 },
    make(jobs) {
      engine = new NullEngine();
      const clipmap = createClipmap(new Scene(engine), SEED, jobs);
      return {
        update: (x, z) => clipmap.update(x, z),
        get view() { return clipmap.view; },
        drawn: () => ringUploads(clipmap),
        dispose: () => { clipmap.dispose(); engine?.dispose(); },
      };
    },
    expected(x, z) {
      rings ??= referenceRings();
      return expectedRings(rings, x, z);
    },
  };
}

function bladeShell(): Shell {
  let meshes: readonly Mesh[] = [];
  return {
    name: "blades",
    // The open-field census point bladeMeshes.test.ts uses.
    start: { x: 35.5, z: 21335.5 },
    make(jobs) {
      const engine = new NullEngine();
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      const blades: BladeMeshes = createBladeMeshes(new Scene(engine), SEED, { quality: "high", jobs });
      meshes = blades.meshes;
      return {
        update: (x, z) => blades.update(x, z),
        get view() { return blades.view; },
        drawn: () => {
          // What the renderer's cull hook does each frame, with every cell kept.
          blades.cull(null);
          return uploads(spy as unknown as Spy, blades.meshes, () => BLADE_KINDS);
        },
        dispose: () => { blades.dispose(); spy.mockRestore(); engine.dispose(); },
      };
    },
    expected: (x, z) => expectedBlades(meshes, collectBladeCells(SEED, x, z)),
  };
}

function duffShell(): Shell {
  let meshes: readonly Mesh[] = [];
  return {
    name: "duff",
    // The forest-interior census point duffMeshes.test.ts uses.
    start: { x: 480.5, z: -599.5 },
    make(jobs) {
      const engine = new NullEngine();
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      const duff: DuffMeshes = createDuffMeshes(new Scene(engine), SEED, { quality: "high", jobs });
      meshes = duff.meshes;
      return {
        update: (x, z) => duff.update(x, z),
        get view() { return duff.view; },
        drawn: () => uploads(spy as unknown as Spy, duff.meshes, () => DUFF_KINDS),
        dispose: () => { duff.dispose(); spy.mockRestore(); engine.dispose(); },
      };
    },
    expected: (x, z) => expectedDuff(meshes, collectDuffCells(SEED, x, z, DUFF_REACH.high)),
  };
}

function clutterShell(): Shell {
  let meshes: Mesh[] = [];
  return {
    name: "clutter",
    // Near the origin, where clutterMeshes.test.ts finds grass reliably.
    start: { x: 100.5, z: 100.5 },
    make(jobs) {
      const { engine, scene, assets, bucketMeshes } = clutterScene();
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      // Culled as the medium and high tiers build it, every card drawn.
      const clutter: ClutterMeshes = createClutterMeshes(scene, SEED, { assets, cull: true, jobs });
      meshes = bucketMeshes();
      return {
        update: (x, z) => clutter.update(x, z),
        get view() { return clutter.view; },
        drawn: () => {
          clutter.cull(null);
          return uploads(spy as unknown as Spy, meshes, clutterKinds);
        },
        dispose: () => { clutter.dispose(); spy.mockRestore(); engine.dispose(); },
      };
    },
    expected: (x, z) => expectedClutter(meshes, collectClutter(SEED, x, z)),
  };
}

const SHELLS = [clipmapShell, clutterShell, bladeShell, duffShell];

describe("rebuilds as jobs: what is uploaded", () => {
  for (const shellOf of SHELLS) {
    it(`${shellOf().name}: uploads, over a walk of 40 crossings, exactly what the present rebuild uploads for each view`, () => {
      const shell = shellOf();
      const jobs = createSyncJobs(tickClock(TICK));
      const s = shell.make(jobs);
      let built = 0;
      let deferred = 0;
      let lastView = { x: NaN, z: NaN };
      for (const p of walk(shell.start, WALKING)) {
        s.update(p.x, p.z);
        const atOnce = s.view.x !== lastView.x || s.view.z !== lastView.z;
        jobs.run();
        const view = { x: s.view.x, z: s.view.z };
        if (view.x !== lastView.x || view.z !== lastView.z) {
          if (!atOnce) deferred++;
          expect(differences(s.drawn(), shell.expected(view.x, view.z)), `${shell.name} build ${built}`).toEqual([]);
          lastView = view;
          built++;
        }
        if (built === 41) break;
      }
      // The first build, at once, and 40 crossings, every one of them built
      // as a job over the frames after it.
      expect([built, deferred]).toEqual([41, 40]);
      s.dispose();
    }, timeLimit(240_000));
  }
});

/** Each shell's rebuild grid, as its `update` snaps a coordinate. */
const GRIDS: Record<string, (v: number) => number> = {
  clipmap: (v) => snapOrigin(v, 1),
  clutter: (v) => Math.floor(v / 3) * 3,
  blades: (v) => Math.floor(v),
  duff: (v) => Math.floor(v),
};

describe("rebuilds as jobs: when", () => {
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
      expect(jobs.last.slices, `frame ${p.frame}`).toBeLessThanOrEqual(SYNC_BUDGET_MS / TICK + 1);
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
        if (queue[0] !== undefined) expect(p.frame - queue[0].frame, `${shells[i]!.name} at frame ${p.frame}`).toBeLessThan(SYNC_LATE_FRAMES_MAX);
      });
    }
    // 600 frames at a walk: 52.5 m. Crossings of all four grids, several of
    // them in the same frame as another; none waited more than six frames,
    // including any a further line along the diagonal overtook.
    expect(crossings).toBeGreaterThan(100);
    expect(crowded).toBeGreaterThan(5);
    expect(slowest).toBeLessThanOrEqual(SYNC_LATE_FRAMES_MAX);
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
        if (p.frame > 6) break;
        const moved = grid(p.x) !== grid(p.x - Math.cos(HEADING) * BOOST * DT) || grid(p.z) !== grid(p.z - Math.sin(HEADING) * BOOST * DT);
        if (!moved) {
          s.update(p.x, p.z);
          jobs.run();
          continue;
        }
        check(p.x, p.z, `boost frame ${p.frame}`);
        fast++;
      }
      expect(fast).toBeGreaterThanOrEqual(3);
      s.dispose();
    }, timeLimit(240_000));

    it(`${shellOf().name}: leaves every buffer its meshes draw as it was until the job applies`, () => {
      const shell = shellOf();
      // A clock that lets a frame run one slice: its reading as the share
      // starts and before the first slice are 2.5 ms apart, the next 5 ms.
      const jobs = createSyncJobs(tickClock(2.5));
      const s = shell.make(jobs);
      let before: Uploads | null = null;
      let stood: { x: number; z: number } | null = null;
      let held = 0;
      for (const p of walk(shell.start, WALKING)) {
        // Once a crossing has begun a job, stand still until it applies.
        const at: { x: number; z: number } = stood ?? p;
        const was = { x: s.view.x, z: s.view.z };
        s.update(at.x, at.z);
        const grid = GRIDS[shell.name]!;
        const crossed = grid(at.x) !== grid(was.x) || grid(at.z) !== grid(was.z);
        if (stood === null && p.frame > 0 && s.view.x === was.x && s.view.z === was.z && crossed) {
          stood = { x: at.x, z: at.z };
        }
        before ??= s.drawn();
        jobs.run();
        if (stood === null) {
          before = s.drawn();
          continue;
        }
        const now = s.drawn();
        if (s.view.x !== stood.x || s.view.z !== stood.z) {
          expect(differences(now, before), `${shell.name}: still frame ${held}`).toEqual([]);
          held++;
          continue;
        }
        // Applied: every buffer is the new view's, and the job did change them.
        expect(differences(now, shell.expected(stood.x, stood.z))).toEqual([]);
        expect(differences(now, before).length).toBeGreaterThan(0);
        break;
      }
      expect(held).toBeGreaterThanOrEqual(1);
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
    // 105 m at a walk, 64 crossings and 120 ring moves prepared ahead; the
    // crossings themselves lifted what two or three moves not prepared lift
    // (766 a step), where a move lifts that many every time.
    expect([builds, prepared, lifted]).toEqual([64, 120, 1782]);
    clipmap.dispose();
    engine.dispose();
  }, timeLimit(120_000));
});
