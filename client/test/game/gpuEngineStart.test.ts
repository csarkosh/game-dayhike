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
    _compiledEffects = {};
    _preparePipelineContextAsync(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { WebGPUEngine };
});

import { createWebGpuEngine, loadTranslators } from "../../src/game/gpuEngine.js";

const canvas = {} as HTMLCanvasElement;

const WASM = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
/** `fetch` answering every URL with `bytes`, and the URLs it was asked for. */
function stubFetch(bytes: number[]): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url);
    return Promise.resolve(new Response(new Uint8Array(bytes)));
  });
  return asked;
}
/** The two loaders' globals, as their scripts define them on the page. */
function stubTranslators(): void {
  vi.stubGlobal("glslang", () => Promise.resolve({}));
  vi.stubGlobal("twgsl", () => Promise.resolve({}));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  made.options.length = 0;
  made.disposed = 0;
  made.init = () => Promise.resolve();
  made.prepare = () => Promise.resolve();
  PBRBaseMaterial.ForceGLSL = false;
  StandardMaterial.ForceGLSL = false;
});

describe("loadTranslators", () => {
  // No timer is advanced in any of these: a failure does not wait for a budget.
  it("runs both loaders and fetches both translators, and a script that does not load fails at once", async () => {
    vi.useFakeTimers();
    const fetched = stubFetch(WASM);
    const ran: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation((url: string) => {
      ran.push(url);
      return url.includes("twgsl") ? Promise.reject(new Error("twgsl.js: blocked")) : Promise.resolve();
    });
    await expect(loadTranslators()).rejects.toThrow("twgsl.js: blocked");
    expect(ran).toHaveLength(2);
    expect(ran[0]).toMatch(/glslang[^/]*\.js$/);
    expect(ran[1]).toMatch(/twgsl[^/]*\.js$/);
    expect(fetched).toHaveLength(2);
    expect(fetched[0]).toMatch(/glslang[^/]*\.wasm$/);
    expect(fetched[1]).toMatch(/twgsl[^/]*\.wasm$/);
  });

  it("fails at once when a loader ran but defined nothing, as this host's HTML page for a missing script does", async () => {
    vi.useFakeTimers();
    stubFetch(WASM);
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    await expect(loadTranslators()).rejects.toThrow("the WebGPU translators did not load: glslang, twgsl");
    vi.stubGlobal("glslang", () => Promise.resolve({}));
    await expect(loadTranslators()).rejects.toThrow("the WebGPU translators did not load: twgsl");
  });

  it("fails at once when a translator is not WebAssembly", async () => {
    vi.useFakeTimers();
    stubTranslators();
    stubFetch([...Buffer.from("<!doctype html>")]);
    vi.spyOn(Tools, "LoadScriptAsync").mockResolvedValue(undefined);
    await expect(loadTranslators()).rejects.toThrow(/glslang[^/]*\.wasm: not WebAssembly/);
  });

  it("resolves when both loaders define their functions and both translators are WebAssembly", async () => {
    stubFetch(WASM);
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation((url: string) => {
      vi.stubGlobal(url.includes("glslang") ? "glslang" : "twgsl", () => Promise.resolve({}));
      return Promise.resolve();
    });
    await expect(loadTranslators()).resolves.toBeUndefined();
  });
});

describe("createWebGpuEngine", () => {
  it("refuses to start before the translators are loaded, and makes no engine", async () => {
    await expect(createWebGpuEngine(canvas)).rejects.toThrow("load the WebGPU translators first");
    expect(made.options).toEqual([]);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
  });

  it("asks the device for exactly the required limits and the texture formats it is given", async () => {
    stubTranslators();
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

  it("catches the translation failures Babylon's preparation drops, on the engine it makes", async () => {
    stubTranslators();
    const engine = await createWebGpuEngine(canvas);
    const own = Object.getOwnPropertyDescriptor(engine, "_preparePipelineContextAsync");
    expect(typeof own?.value).toBe("function");
  });

  it("asks for no optional feature when it is given none", async () => {
    stubTranslators();
    await createWebGpuEngine(canvas);
    expect((made.options[0] as { deviceDescriptor: { requiredFeatures: string[] } }).deviceDescriptor.requiredFeatures).toEqual([]);
  });

  it("disposes what it made and leaves the materials alone when the start fails", async () => {
    stubTranslators();
    made.init = () => Promise.reject(new Error("device refused"));
    await expect(createWebGpuEngine(canvas)).rejects.toThrow("device refused");
    expect(made.disposed).toBe(1);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
    expect(StandardMaterial.ForceGLSL).toBe(false);
  });

  it("gives up once the time it is given has passed", async () => {
    vi.useFakeTimers();
    stubTranslators();
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

  it("takes an already loaded glslang and twgsl from the page's globals", () => {
    expect(source).toContain("if (self.glslang) {");
    const tint = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js"), "utf8");
    expect(tint).toContain("if (self.twgsl) {");
  });

  it("finds the globals where the shipped loaders put them", () => {
    const resolve = createRequire(import.meta.url).resolve;
    expect(readFileSync(resolve("@babylonjs/core/assets/glslang/glslang.js"), "utf8")).toContain('root["glslang"] = factory();');
    expect(readFileSync(resolve("@babylonjs/core/assets/twgsl/twgsl.js"), "utf8")).toContain('root["twgsl"] = factory();');
  });
});
