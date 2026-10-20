/**
 * The rebuilds a crossing starts, as the tests of them drive them: the
 * clipmap, the clutter, the blades, the duff and the forest, each built on a
 * scheduler and read back against what the present rebuild uploads, and the
 * walks and the test clock they run on. Shared by `rebuildJobs.test.ts`
 * (when the jobs run, and what they compute), `rebuildJobsUploads.test.ts`
 * (what they upload) and `rebuildJobsClutter.test.ts` (the clutter's walk):
 * vitest hands out files, not tests, and as one file of about 230 s on a CI
 * runner, the clutter's walk alone about 90 s of it, they were one of the
 * floors under the client suite.
 *
 * Every file that imports this mocks `groundMaps.js` first: the terrain
 * material's ground textures are a texture array NullEngine cannot make.
 */
import { expect, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../../src/sim/passes/index.js";
import { createClipmap, type Clipmap } from "../../../src/game/renderer.js";
import { elevationAt } from "../../../src/sim/terrain.js";
import type { CullPose } from "../../../src/game/grassCull.js";
import {
  createRingSamples, holeCellsFor, ringGeometry, updateRingSamples, RING_COUNT, type RingGeometry,
  type RingSamples,
} from "../../../src/game/clipmap.js";
import { createSyncJobs, type SyncJobs } from "../../../src/game/syncJobs.js";
import { collectBladeCells } from "../../../src/game/bladeField.js";
import { createBladeMeshes, type BladeMeshes } from "../../../src/game/bladeMeshes.js";
import { DUFF_REACH, collectDuffCells } from "../../../src/game/duffField.js";
import { createDuffMeshes, type DuffMeshes } from "../../../src/game/duffMeshes.js";
import { collectClutter } from "../../../src/game/clutterField.js";
import { createClutterMeshes, type ClutterMeshes } from "../../../src/game/clutterMeshes.js";
import { createForestMeshes, type ForestMeshes } from "../../../src/game/forestMeshes.js";
import {
  BLADE_KINDS, DUFF_KINDS, SEED, clutterKinds, clutterScene, differences, expectedBlades, expectedClutter,
  expectedDuff, uploads, type Spy, type Uploads,
} from "../../helpers/groundCoverUploads.js";

/** A frame at 60 frames a second. */
export const DT = 1 / 60;
/** On foot, m/s (`WALK_SPEED`). */
export const WALKING = 5.25;
/** The free camera's boost, m/s. */
export const BOOST = 144;
/** The heading every walk here takes: off both axes, so it crosses the
 * lines of both, and now and then both in one frame. */
export const HEADING = 0.3;

/**
 * The test clock: every reading advances it by `tick` ms, and the scheduler
 * reads it once as a frame's share starts and once before each slice, so
 * every slice is charged `tick`. A tenth of a millisecond is about what a
 * slice of the terrain's or the ground cover's rebuild takes, and lets a
 * frame's budget hold forty.
 */
export function tickClock(tick: number): () => number {
  let now = 0;
  return () => (now += tick);
}
export const TICK = 0.1;

/** The positions of a walk from `start` along `HEADING` at `speed`, one a frame. */
export function* walk(start: { x: number; z: number }, speed: number): Generator<{ x: number; z: number; frame: number }> {
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
export function ringUploads(clipmap: Clipmap): Uploads {
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
export function expectedRings(rings: RingSamples[], x: number, z: number): Uploads {
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

export function referenceRings(): RingSamples[] {
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
export type Shell = {
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

export const SHELLS = [clipmapShell, clutterShell, bladeShell, duffShell, forestShell];

/**
 * A shell's walk of 40 crossings from its start: the first build at once, and
 * every crossing after it a job over the frames that follow, each view drawn
 * exactly as the present rebuild uploads it.
 */
export function checkWalkUploads(shellOf: () => Shell): void {
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
}
