import { describe, it, expect, vi } from "vitest";

// `terrainTexture.ts`'s real ground loader fetches and decodes the layer
// images (`rendererSwap.test.ts` says why); the flat placeholders stand in.
vi.mock("../../src/game/groundMaps.js", () => ({
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
  reportLayer: () => undefined,
}));

// `createRenderer` builds a WebGL `Engine`; NullEngine in its place.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createRenderer } from "../../src/game/renderer.js";
import { RING_COUNT } from "../../src/game/clipmap.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";

const LEVEL: Level = { id: "renderer-start", brushes: [], playerSpawns: [], enemySpawns: [] };
const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

describe("the renderer's first clipmap build, stepped", () => {
  it("builds ring by ring, naming each ring as it is sampled, when the build is deferred to the start", async () => {
    const forest = createForest(12345);
    const r = createRenderer(nullCanvas(), LEVEL, forest, { tier: "high", deferClipmap: true });
    const rings: number[] = [];
    await r.buildFirstClipmap(4, (level) => rings.push(level));
    expect(rings).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(RING_COUNT).toBe(7);
    r.dispose();
  }, timeLimit(60_000));

  it("stops its deferred build quietly when the renderer is disposed in the middle of it", async () => {
    const forest = createForest(12345);
    const r = createRenderer(nullCanvas(), LEVEL, forest, { tier: "high", deferClipmap: true });
    const rings: number[] = [];
    const build = r.buildFirstClipmap(1, (level) => {
      rings.push(level);
      if (level === 1) r.dispose();
    });
    await expect(build).resolves.toBeUndefined();
    expect(rings).toEqual([0, 1]);
  }, timeLimit(60_000));
});

/** One turn of the event loop: long enough for a resolved promise's callbacks. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the renderer's sky before its first frame", () => {
  it("is ready once its table holds the slices either side of noon, at noon, and not before", async () => {
    const table = createSkyTable();
    const fixture = skyFixture();
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    try {
      let ready = false;
      void r.skyReady().then(() => {
        ready = true;
      });
      await tick();
      expect(ready).toBe(false);
      table.add(fixture.blendAt(74));
      await tick();
      expect(ready).toBe(false);
      table.add(fixture.blendAt(76));
      await tick();
      expect(ready).toBe(true);
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));

  it("waits for the hour it is set to while it waits, not the hour it was asked at", async () => {
    const table = createSkyTable();
    const fixture = skyFixture();
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    try {
      let ready = false;
      void r.skyReady().then(() => {
        ready = true;
      });
      r.setHour(15);
      table.add(fixture.blendAt(74));
      table.add(fixture.blendAt(76));
      await tick();
      expect(ready).toBe(false);
      // 15:00's sun stands between the slices at 42 and 44 degrees.
      table.add(fixture.blendAt(42));
      table.add(fixture.blendAt(44));
      await tick();
      expect(ready).toBe(true);
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));

  it("is one wait for every caller while it waits, and never resolves for a renderer disposed first", async () => {
    const table = createSkyTable();
    const fixture = skyFixture();
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    let ready = false;
    const waiting = r.skyReady();
    expect(r.skyReady()).toBe(waiting);
    void waiting.then(() => {
      ready = true;
    });
    r.dispose();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    await tick();
    expect(ready).toBe(false);
  }, timeLimit(60_000));

  it("is ready at once on a table that already holds them", async () => {
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      await expect(r.skyReady()).resolves.toBeUndefined();
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));
});
