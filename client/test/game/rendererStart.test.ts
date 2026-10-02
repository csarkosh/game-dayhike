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
