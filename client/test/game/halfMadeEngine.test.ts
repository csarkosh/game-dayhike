import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.pure.js";
import { createWebGpuEngine } from "../../src/game/gpuEngine.js";

/**
 * A WebGPU start whose device request is refused (a lost device's one retry,
 * on a machine whose GPU will not give another device), against Babylon's
 * real `WebGPUEngine`: a stand-in `navigator.gpu` whose adapter refuses the
 * device, and a stand-in canvas.
 */
describe("a WebGPU engine whose device is refused", () => {
  afterEach(() => vi.unstubAllGlobals());

  const refused = new Error("requestDevice refused");
  function refusingGpu(): void {
    vi.stubGlobal("navigator", {
      userAgent: "test",
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: async () => ({
          features: new Set<string>(),
          limits: {},
          info: {},
          requestDevice: async () => {
            throw refused;
          },
        }),
      },
    });
  }
  const canvas = (): HTMLCanvasElement => ({ addEventListener() {}, removeEventListener() {} }) as unknown as HTMLCanvasElement;

  it("is disposed out of Babylon's engine store when the start fails", async () => {
    refusingGpu();
    const before = [...EngineStore.Instances];
    await expect(createWebGpuEngine(canvas(), { translators: { glslang: {}, twgsl: {} } as never, ms: 5_000 })).rejects.toBe(refused);
    expect(EngineStore.Instances).toEqual(before);
  });

  it("throws in Babylon's own dispose before leaving the store (a canary on the installed engine)", async () => {
    refusingGpu();
    const engine = new WebGPUEngine(canvas(), {});
    try {
      expect(EngineStore.Instances).toContain(engine);
      await expect(engine.initAsync()).rejects.toBe(refused);
      // It reads what `initAsync` makes once the device stands, and the
      // device never came.
      expect(() => engine.dispose()).toThrow(TypeError);
      expect(EngineStore.Instances).toContain(engine);
    } finally {
      const at = EngineStore.Instances.indexOf(engine);
      if (at >= 0) EngineStore.Instances.splice(at, 1);
    }
  });
});
