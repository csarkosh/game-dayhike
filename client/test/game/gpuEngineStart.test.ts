import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Tools } from "@babylonjs/core/Misc/tools.js";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";

// `createWebGpuEngine` needs a browser's WebGPU; the engine class is replaced
// at the module boundary by one that records how it was made and lets each
// test decide how its start goes.
const made = vi.hoisted(() => ({
  options: [] as unknown[],
  disposed: 0,
  init: (): Promise<void> => Promise.resolve(),
  prepare: (): Promise<void> => Promise.resolve(),
}));

vi.mock("@babylonjs/core/Engines/webgpuEngine.js", () => {
  class WebGPUEngine {
    static get IsSupportedAsync(): Promise<boolean> {
      return Promise.resolve(true);
    }
    constructor(_canvas: unknown, options: unknown) {
      made.options.push(options);
    }
    initAsync(): Promise<void> {
      return made.init();
    }
    prepareGlslangAndTintAsync(): Promise<void> {
      return made.prepare();
    }
    dispose(): void {
      made.disposed++;
    }
  }
  return { WebGPUEngine };
});

import { createWebGpuEngine } from "../../src/game/gpuEngine.js";

const canvas = {} as HTMLCanvasElement;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  made.options.length = 0;
  made.disposed = 0;
  made.init = () => Promise.resolve();
  made.prepare = () => Promise.resolve();
  PBRBaseMaterial.ForceGLSL = false;
  StandardMaterial.ForceGLSL = false;
});

describe("createWebGpuEngine", () => {
  it("loads both translator scripts first, and a missing one fails at once, before any engine is made", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation((url: string) => {
      asked.push(url);
      return url.includes("twgsl") ? Promise.reject(new Error("twgsl.js: 404")) : Promise.resolve();
    });
    // No timer is advanced: the failure does not wait for the budget.
    await expect(createWebGpuEngine(canvas)).rejects.toThrow("twgsl.js: 404");
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/glslang[^/]*\.js$/);
    expect(asked[1]).toMatch(/twgsl[^/]*\.js$/);
    expect(made.options).toEqual([]);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
  });

  it("asks the device for exactly the required limits and the texture formats it is given", async () => {
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    await createWebGpuEngine(canvas, { features: ["texture-compression-bc"] });
    expect(made.options).toEqual([
      {
        antialias: true,
        stencil: true,
        adaptToDeviceRatio: true,
        powerPreference: "high-performance",
        deviceDescriptor: {
          requiredLimits: { maxInterStageShaderVariables: 17, maxVertexBuffers: 8 },
          requiredFeatures: ["texture-compression-bc"],
        },
      },
    ]);
    expect(PBRBaseMaterial.ForceGLSL).toBe(true);
    expect(StandardMaterial.ForceGLSL).toBe(true);
  });

  it("asks for no optional feature when it is given none", async () => {
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    await createWebGpuEngine(canvas);
    expect((made.options[0] as { deviceDescriptor: { requiredFeatures: string[] } }).deviceDescriptor.requiredFeatures).toEqual([]);
  });

  it("disposes what it made and leaves the materials alone when the start fails", async () => {
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    made.init = () => Promise.reject(new Error("device refused"));
    await expect(createWebGpuEngine(canvas)).rejects.toThrow("device refused");
    expect(made.disposed).toBe(1);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
    expect(StandardMaterial.ForceGLSL).toBe(false);
  });

  it("gives up once the time it is given has passed", async () => {
    vi.useFakeTimers();
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    made.prepare = () => new Promise<void>(() => undefined);
    const start = createWebGpuEngine(canvas, { ms: 9_000 });
    const settled = expect(start).rejects.toThrow("the WebGPU engine was not ready in 9000 ms");
    await vi.advanceTimersByTimeAsync(9_000);
    await settled;
    expect(made.disposed).toBe(1);
  });
});

describe("the installed engine (canaries)", () => {
  const source = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");

  it("keeps only the requested features the adapter has", () => {
    expect(source).toContain("if (this._adapterSupportedExtensions.indexOf(extension) !== -1) {");
    expect(source).toContain("deviceDescriptor.requiredFeatures = validExtensions;");
  });

  it("reads the three texture formats KTX2 transcodes to from those features", () => {
    expect(source).toContain('astc: (this._deviceEnabledExtensions.indexOf("texture-compression-astc"');
    expect(source).toContain('s3tc: (this._deviceEnabledExtensions.indexOf("texture-compression-bc"');
    expect(source).toContain('etc2: (this._deviceEnabledExtensions.indexOf("texture-compression-etc2"');
    expect(source).toContain('bptc: this._deviceEnabledExtensions.indexOf("texture-compression-bc"');
  });

  it("takes an already loaded glslang instead of loading its script again", () => {
    expect(source).toContain("if (self.glslang) {");
  });
});
