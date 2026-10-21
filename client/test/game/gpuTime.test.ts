// The measurement mode's readout in a whole renderer (`?gpuTime`): under Node
// there is no WebGPU, so what is checked is the shape of an unsupported
// readout, that the render scale is held at the tier's own, and that nothing
// at all is installed without the flag.
import { describe, it, expect, vi } from "vitest";

// As in `rendererShore.test.ts`: the real loader would fetch and decode the
// ground's layer images, which a suite under Node cannot.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// As in `rendererShore.test.ts`: `NullEngine` for the WebGL engine this suite has no context for.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { GpuTimeReport } from "../../src/game/gpuTimeReport.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";

describe("the gpu time readout in a renderer", () => {
  const level: Level = { id: "gpu-time-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const canvas = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  it("with ?gpuTime on an engine without the feature, the readout says unsupported and the scale stays the tier's", () => {
    const renderer = createRenderer(canvas, level, null, { tier: "high", gpuTime: true, skyTable: skyFixture() });
    const readout = (globalThis as { __gpuTime?: () => GpuTimeReport }).__gpuTime;
    expect(readout).toBeTypeOf("function");
    expect(readout!()).toMatchObject({ supported: false, frameMs: null, mainMs: null, targets: [], missed: [] });
    expect(renderer.gpuTime?.read().supported).toBe(false);
    expect(renderer.engine.getHardwareScalingLevel()).toBe(1);
    renderer.dispose();
    expect((globalThis as { __gpuTime?: unknown }).__gpuTime).toBeUndefined();
  }, timeLimit(120_000));

  it("without ?gpuTime nothing is installed", () => {
    const renderer = createRenderer(canvas, level, null, { tier: "high", skyTable: skyFixture() });
    expect(renderer.gpuTime).toBeNull();
    expect((globalThis as { __gpuTime?: unknown }).__gpuTime).toBeUndefined();
    renderer.dispose();
  }, timeLimit(120_000));
});
