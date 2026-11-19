import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineContext, MaterialPlugin, PluginUniformBlock, SceneContext } from "@babylonjs/lite";
import type { ChunkGrid } from "../../../src/sim/chunkGrid.js";
import { createFirstBuilds } from "../../../src/game/firstBuilds.js";
import { emptyWetUniforms } from "../../../src/game/wetSurface.js";
import { createSyncJobs } from "../../../src/game/syncJobs.js";
import { createPropMeshes, type PropMeshes } from "../../../src/game/lite/propMeshes.js";

/** What the shell asked of the engine, in order: a mesh made (its name and arrays) and a mesh let go. */
const made: { name: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array }[] = [];
const dropped: string[] = [];

vi.mock("@babylonjs/lite", async (original) => ({
  ...(await original<typeof import("@babylonjs/lite")>()),
  createMeshFromData: (_engine: unknown, name: string, positions: Float32Array, normals: Float32Array, indices: Uint32Array) => {
    made.push({ name, positions, normals, indices });
    return { name };
  },
  createPbrMaterial: () => ({}),
  addToScene: () => undefined,
  removeFromScene: (_scene: unknown, mesh: { name: string }) => void dropped.push(mesh.name),
  disposeMeshGpu: () => undefined,
}));

const ENGINE = {} as EngineContext;
const SCENE = {} as SceneContext;
const PLUGIN = {} as MaterialPlugin;
const SHARED = { name: "frame" } as unknown as PluginUniformBlock;

/** A grid whose every chunk holds two props, boxes of different sizes by the chunk's place, and charges `clock` for each chunk it generates. */
function gridOn(clock: { advance(ms: number): void }, perChunk: number): ChunkGrid {
  return {
    chunkAt(cx: number, cz: number) {
      clock.advance(perChunk);
      const box = (k: number) => ({ min: { x: cx * 32 + k, y: 0, z: cz * 32 + k }, max: { x: cx * 32 + k + 1 + (cx & 3), y: 1 + k, z: cz * 32 + k + 2 } });
      return { props: [{ material: "wall", box: box(1) }, { material: "wall", box: box(5) }] };
    },
  } as unknown as ChunkGrid;
}

function shell(grid: ChunkGrid, options: { jobs?: ReturnType<typeof createSyncJobs>; firstBuilds?: ReturnType<typeof createFirstBuilds> } = {}): PropMeshes {
  return createPropMeshes(ENGINE, SCENE, grid, { wet: emptyWetUniforms(), air: () => PLUGIN, shared: SHARED, ...options });
}

/** Camera positions of a walk: from the first, in steps of half a metre, to each of the others in turn, one place a frame. */
function* walk(from: [number, number], ...to: [number, number][]): Generator<[number, number]> {
  let [x, z] = from;
  yield [x, z];
  for (const [tx, tz] of to) {
    while (Math.abs(tx - x) > 1e-9 || Math.abs(tz - z) > 1e-9) {
      x += Math.max(-0.5, Math.min(0.5, tx - x));
      z += Math.max(-0.5, Math.min(0.5, tz - z));
      yield [x, z];
    }
  }
}

beforeEach(() => {
  made.length = 0;
  dropped.length = 0;
});

describe("the props' chunks on Babylon Lite", () => {
  it("makes the first window at once and each chunk a step into the next chunk brings a slice at a time, the same meshes as making them at once", () => {
    const route: [number, number][] = [[40, 16], [40, 40], [20, 40]];
    // Made at once: no scheduler, so every crossing builds in the call that finds it.
    let now = 0;
    const clock = { advance: (ms: number) => { now += ms; } };
    const whole = shell(gridOn(clock, 0));
    for (const [x, z] of walk([16, 16], ...route)) whole.update(x, z);
    const expected = made.map((m) => ({ ...m }));
    const expectedDropped = [...dropped];
    expect(whole.count()).toBe(49 * 2);
    made.length = 0;
    dropped.length = 0;

    // Made by the scheduler: 3 ms a chunk on the clock, so a frame's share of 4 ms runs two chunks.
    now = 0;
    const jobs = createSyncJobs(() => now);
    const sliced = shell(gridOn(clock, 3), { jobs });
    const perFrame: number[] = [];
    let sawPartial = false;
    for (const [x, z] of walk([16, 16], ...route)) {
      sliced.update(x, z);
      const before = made.length;
      jobs.run();
      perFrame.push(made.length - before);
      // A crossing's window is whole only once its job has run: some frame stands between.
      if (jobs.pending({}) || made.length < expected.length) sawPartial = true;
    }
    // The last job's chunks, over the frames after the walk.
    for (let f = 0; f < 20; f++) jobs.run();
    expect(sawPartial).toBe(true);
    expect(sliced.count()).toBe(49 * 2);
    // The same meshes, bit for bit, in the same order, and the same chunks let go.
    expect(made.map((m) => m.name)).toEqual(expected.map((m) => m.name));
    made.forEach((m, i) => {
      const e = expected[i] as (typeof expected)[number];
      expect(Buffer.from(m.positions.buffer).equals(Buffer.from(e.positions.buffer))).toBe(true);
      expect(Buffer.from(m.normals.buffer).equals(Buffer.from(e.normals.buffer))).toBe(true);
      expect(Buffer.from(m.indices.buffer).equals(Buffer.from(e.indices.buffer))).toBe(true);
    });
    expect([...dropped].sort()).toEqual([...expectedDropped].sort());
    // A chunk a slice: no frame of the walk made more than the share's two chunks' boxes after the first window.
    expect(Math.max(...perFrame.slice(1))).toBeLessThanOrEqual(4);
  });

  it("makes a jump's window at once, as a first build is, and a step at a walk with no scheduler in the call", () => {
    let now = 0;
    const clock = { advance: (ms: number) => { now += ms; } };
    const jobs = createSyncJobs(() => now);
    const props = shell(gridOn(clock, 3), { jobs });
    props.update(16, 16);
    jobs.run();
    expect(props.count()).toBe(98);
    // A teleport three chunks away: the three new columns of the window (21 chunks) are made in the call, before any
    // frame's share, and the three left behind let go.
    const before = made.length;
    props.update(16 + 32 * 3, 16);
    expect(made.length - before).toBe(21 * 2);
    expect(dropped.length).toBe(21 * 2);
    expect(props.count()).toBe(98);
  });

  it("hands a first build to the loader of first builds while the film covers the hike, a chunk a slice", async () => {
    let now = 0;
    const clock = { advance: (ms: number) => { now += ms; } };
    const loads = createFirstBuilds({ now: () => now, later: (run) => void queueMicrotask(run), sliceMs: 1 });
    const props = shell(gridOn(clock, 3), { firstBuilds: loads });
    props.update(16, 16);
    expect(props.count()).toBe(0);
    await loads.drained();
    expect(props.count()).toBe(98);
    props.dispose();
  });

  it("lets go of what it made, and a job still pending ends with it", () => {
    let now = 0;
    const clock = { advance: (ms: number) => { now += ms; } };
    const jobs = createSyncJobs(() => now);
    const props = shell(gridOn(clock, 3), { jobs });
    for (const [x, z] of walk([16, 16], [40, 16])) {
      props.update(x, z);
      if (now === 0) jobs.run();
    }
    props.dispose();
    expect(jobs.pending({})).toBe(false);
    expect(props.count()).toBe(0);
    props.update(100, 100);
    expect(props.count()).toBe(0);
  });
});
