import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";

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
import { createClipmap, type Clipmap } from "../../src/game/renderer.js";
import { elevationAt } from "../../src/sim/terrain.js";
import type { CullPose } from "../../src/game/grassCull.js";
import {
  createRingSamples, holeCellsFor, ringGeometry, snapOrigin, updateRingSamples, RING_COUNT, type RingGeometry,
  type RingSamples,
} from "../../src/game/clipmap.js";
import { createSyncJobs, finish as finishSlices, type Slices, type SyncJobs } from "../../src/game/syncJobs.js";
import { collectBladeCells, createBladeCollector } from "../../src/game/bladeField.js";
import { createBladeMeshes, type BladeMeshes } from "../../src/game/bladeMeshes.js";
import { DUFF_REACH, collectDuffCells, createDuffCollector } from "../../src/game/duffField.js";
import { createDuffMeshes, type DuffMeshes } from "../../src/game/duffMeshes.js";
import { collectClutter, createClutterCollector } from "../../src/game/clutterField.js";
import { createClutterMeshes, type ClutterMeshes } from "../../src/game/clutterMeshes.js";
import { createForestMeshes, type ForestMeshes } from "../../src/game/forestMeshes.js";
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

/** A shell as the tests drive it. `drawn` is every instance it draws; `cuts`,
 * for the shells that cut their collected buffers to the view, is what two
 * cuts facing opposite ways draw, so every call re-cuts and reads the
 * collected buffers and counts the way the renderer's per-frame cull does. */
type Made = {
  update(x: number, z: number): void;
  view: { x: number; z: number };
  drawn(): Uploads;
  cuts?: () => Uploads;
  dispose(): void;
};

/** Two poses at `at`, eye height above the ground, looking down at the
 * ground ahead facing +z and −z: each keeps a different half of the field,
 * near and far, so a cut at one after the other always copies from the
 * collected buffers again. */
function opposingPoses(at: { x: number; z: number }): [CullPose, CullPose] {
  const y = elevationAt(SEED, at.x, at.z) + 1.7;
  const pose = (yaw: number): CullPose => ({ x: at.x, y, z: at.z, yaw, pitch: 0.5, roll: 0, fov: 1.4, aspect: 1.6 });
  return [pose(0), pose(Math.PI)];
}

/** What the two opposing cuts draw, keyed by the cut. */
function cutUploads(cull: (pose: CullPose) => void, poses: [CullPose, CullPose], read: () => Uploads): Uploads {
  const out: Uploads = new Map();
  poses.forEach((pose, i) => {
    cull(pose);
    for (const [key, bits] of read()) out.set(`cut${i}|${key}`, bits);
  });
  return out;
}

/** One shell under test: how to build it, where it walks, and what the
 * present rebuild uploads for a view. */
type Shell = {
  name: string;
  start: { x: number; z: number };
  make(jobs: SyncJobs | undefined): Made;
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
      const poses = opposingPoses(this.start);
      return {
        update: (x, z) => blades.update(x, z),
        get view() { return blades.view; },
        drawn: () => {
          // What the renderer's cull hook does each frame, with every cell kept.
          blades.cull(null);
          return uploads(spy as unknown as Spy, blades.meshes, () => BLADE_KINDS);
        },
        cuts: () => cutUploads((pose) => blades.cull(pose), poses, () => uploads(spy as unknown as Spy, blades.meshes, () => BLADE_KINDS)),
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
      const poses = opposingPoses(this.start);
      return {
        update: (x, z) => clutter.update(x, z),
        get view() { return clutter.view; },
        drawn: () => {
          clutter.cull(null);
          return uploads(spy as unknown as Spy, meshes, clutterKinds);
        },
        cuts: () => cutUploads((pose) => clutter.cull(pose), poses, () => uploads(spy as unknown as Spy, meshes, clutterKinds)),
        dispose: () => { clutter.dispose(); spy.mockRestore(); engine.dispose(); },
      };
    },
    expected: (x, z) => expectedClutter(meshes, collectClutter(SEED, x, z)),
  };
}

/** A box with an alpha-tested material, as the forest's models are. */
function box(name: string, scene: Scene): Mesh {
  const mesh = CreateBox(name, { size: 1 }, scene);
  mesh.material = new PBRMaterial(`${name}_mat`, scene);
  (mesh.material as PBRMaterial).transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  return mesh;
}

/** Boxes in place of the forest's seven models (`forestMeshes.test.ts`'s
 * stubs, reduced), and no billboard bakes, which NullEngine cannot make. */
function forestOn(scene: Scene, jobs: SyncJobs | undefined): ForestMeshes {
  const lods = (prefix: string): [Mesh, Mesh, Mesh] => [box(`${prefix}0`, scene), box(`${prefix}1`, scene), box(`${prefix}2`, scene)];
  return createForestMeshes(scene, SEED, {
    assets: {
      giants: [0, 1].map((s) => ({ lods: lods(`g${s}_`), understory: box(`u${s}`, scene) })),
      saplings: [0, 1].map((s) => ({ lods: lods(`p${s}_`) })),
      deadwood: box("dead", scene),
    },
    bakeImpostor: () => null,
    jobs,
  });
}

const FOREST_KINDS: [string, number][] = [["matrix", 16], ["fadeBands", 4], ["groundGrad", 2], ["foliage", 4]];

/**
 * The forest: its buffers are all new arrays each rebuild, built from the
 * collected bands by functions of the bands and the view alone, so what it
 * uploads for a view is held to the same forest rebuilding at once at that
 * view, without a scheduler.
 */
function forestShell(): Shell {
  let reference: { forest: ForestMeshes; meshes: Mesh[]; engine: NullEngine } | null = null;
  let spy: Spy | null = null;
  const bucketMeshes = (scene: Scene): Mesh[] => scene.meshes.filter((m): m is Mesh => m instanceof Mesh);
  return {
    name: "forest",
    // Inside a stand of trees near the origin.
    start: { x: 1, z: 1 },
    make(jobs) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const mocked = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      spy = mocked as unknown as Spy;
      const forest = forestOn(scene, jobs);
      const meshes = bucketMeshes(scene);
      return {
        update: (x, z) => forest.update(x, z),
        get view() { return forest.view; },
        drawn: () => uploads(spy!, meshes, () => FOREST_KINDS),
        dispose: () => {
          forest.dispose();
          reference?.forest.dispose();
          reference?.engine.dispose();
          mocked.mockRestore();
          engine.dispose();
        },
      };
    },
    expected(x, z) {
      if (reference === null) {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const forest = forestOn(scene, undefined);
        reference = { forest, meshes: bucketMeshes(scene), engine };
      }
      reference.forest.update(x, z);
      return uploads(spy!, reference.meshes, () => FOREST_KINDS);
    },
  };
}

const SHELLS = [clipmapShell, clutterShell, bladeShell, duffShell, forestShell];

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
 * changes these. */
const STEP_SLICES: Record<string, number> = { clipmap: 30, clutter: 92, blades: 18, duff: 5, forest: 138 };

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

  it("looks up 1,111 clutter cells a grass cell on, where a walk of every cell looks up 45,819", () => {
    const collector = createClutterCollector(SEED);
    collector.collect(100.5, 100.5);
    expect(collector.walked).toBe(45819);
    const bands = collector.collect(103.5, 100.5);
    // The strips the twelve classes' squares add, a column or a few each.
    expect(collector.walked).toBe(1111);
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
    // The sweep 159 m on; the collect after it looks up the twelve strips and
    // the corner cells the sweep let go, 3,121 in all.
    const bands = clutter.collect(cx + 3, 100.5);
    expect([cx, clutter.walked]).toEqual([259.5, 3121]);
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
    expect([ahead - cold, clutter.size - ahead]).toEqual([669, 0]);
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
