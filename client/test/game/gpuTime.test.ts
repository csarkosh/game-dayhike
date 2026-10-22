// The measurement mode's readout in a whole renderer (`?gpuTime`): under Node
// there is no WebGPU, so what is checked is the shape of an unsupported
// readout, that the render scale is held through slow frames that step it
// down without the flag, and that nothing at all is installed without it.
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

// As in `swapRelease.test.ts`: a `NullEngine` with half-float render targets,
// as a browser has, so the post chain is built with its paint pass and the
// render scale that only the paint has.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  class FloatTargetEngine extends mod.NullEngine {
    constructor() {
      super();
      const caps = this.getCaps();
      caps.textureHalfFloatRender = true;
      caps.textureHalfFloatLinearFiltering = true;
    }
  }
  return { Engine: FloatTargetEngine };
});

import "../../src/sim/passes/index.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { GpuTimeReport } from "../../src/game/gpuTimeReport.js";
import { QUALITY } from "../../src/game/quality.js";
import { RENDER_SCALE_REDUCED, RENDER_SCALE_SLOW_HZ, RENDER_SCALE_WINDOW_S } from "../../src/game/renderScale.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { windTestState } from "./helpers/rendererWorld.js";
import { skyFixture } from "./helpers/skyFixture.js";

describe("the gpu time readout in a renderer", () => {
  const level: Level = { id: "gpu-time-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const canvas = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

  it("with ?gpuTime on an engine without the feature, the readout says unsupported", () => {
    const renderer = createRenderer(canvas, level, null, { tier: "high", gpuTime: true, skyTable: skyFixture() });
    const readout = (globalThis as { __gpuTime?: () => GpuTimeReport }).__gpuTime;
    expect(readout).toBeTypeOf("function");
    expect(readout!()).toMatchObject({ supported: false, frameMs: null, mainMs: null, targets: [], missed: [] });
    expect(renderer.gpuTime?.read().supported).toBe(false);
    renderer.dispose();
    expect((globalThis as { __gpuTime?: unknown }).__gpuTime).toBeUndefined();
  }, timeLimit(120_000));

  it("with ?gpuTime the render scale holds through slow frames that step it down without", () => {
    // A spy on the setter, not a readback: NullEngine's getHardwareScalingLevel()
    // reads 1 whatever was set (`lighting.test.ts`).
    const scalesSet = (gpuTime: boolean): number[] => {
      const renderer = createRenderer(canvas, level, null, { tier: "high", gpuTime, skyTable: skyFixture() });
      const set = vi.spyOn(renderer.engine, "setHardwareScalingLevel");
      // Three windows' frames at 5 a second, under RENDER_SCALE_SLOW_HZ: two slow windows drop a step.
      const dt = 0.2;
      expect(1 / dt).toBeLessThan(RENDER_SCALE_SLOW_HZ);
      for (let i = 0; i < (3 * RENDER_SCALE_WINDOW_S) / dt; i++) renderer.sync(windTestState(), 1, 0, { dt, sprinting: false });
      const scales = set.mock.calls.map(([level]) => level);
      renderer.dispose();
      return scales;
    };
    expect(scalesSet(false)).toEqual([QUALITY.high.hardwareScaling / RENDER_SCALE_REDUCED]);
    expect(scalesSet(true)).toEqual([]);
  }, timeLimit(120_000));

  it("without ?gpuTime nothing is installed", () => {
    const renderer = createRenderer(canvas, level, null, { tier: "high", skyTable: skyFixture() });
    expect(renderer.gpuTime).toBeNull();
    expect((globalThis as { __gpuTime?: unknown }).__gpuTime).toBeUndefined();
    renderer.dispose();
  }, timeLimit(120_000));
});
