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

  /** A device whose `destroy` is counted, and whose limits cannot be read,
   * so `initAsync` fails just after the device came, before it makes what
   * Babylon's dispose reads first. */
  function brokenDevice(): { device: object; destroyed: () => number } {
    let destroyed = 0;
    const device = {
      features: new Set<string>(),
      get limits(): never {
        throw new Error("the device's limits could not be read");
      },
      addEventListener() {},
      lost: new Promise(() => undefined),
      destroy() {
        destroyed++;
      },
    };
    return { device, destroyed: () => destroyed };
  }
  function gpuGiving(device: () => Promise<object>): void {
    vi.stubGlobal("navigator", {
      userAgent: "test",
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: async () => ({ features: new Set<string>(), limits: {}, info: {}, requestDevice: device }),
      },
    });
  }

  it("destroys a device that came when the start fails after it", async () => {
    const made = brokenDevice();
    gpuGiving(async () => made.device);
    const before = [...EngineStore.Instances];
    await expect(createWebGpuEngine(canvas(), { translators: { glslang: {}, twgsl: {} } as never, ms: 5_000 })).rejects.toThrow(
      "the device's limits could not be read",
    );
    expect(made.destroyed()).toBe(1);
    expect(EngineStore.Instances).toEqual(before);
  });

  it("destroys a device that comes after the start has given up, and leaves the store as it was", async () => {
    vi.useFakeTimers();
    try {
      const made = brokenDevice();
      let give: () => void = () => undefined;
      gpuGiving(() => new Promise<object>((resolve) => (give = () => resolve(made.device))));
      const before = [...EngineStore.Instances];
      const start = createWebGpuEngine(canvas(), { translators: { glslang: {}, twgsl: {} } as never, ms: 5_000 });
      const settled = expect(start).rejects.toThrow("the WebGPU engine was not ready in 5000 ms");
      await vi.advanceTimersByTimeAsync(5_000);
      await settled;
      expect(made.destroyed()).toBe(0);
      // The device the start asked for comes now, to an engine already given up.
      give();
      await vi.advanceTimersByTimeAsync(0);
      expect(made.destroyed()).toBe(1);
      expect(EngineStore.Instances).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
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
