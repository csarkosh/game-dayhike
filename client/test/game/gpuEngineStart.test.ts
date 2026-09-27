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
  initArgs: [] as unknown[][],
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
    initAsync(...args: unknown[]): Promise<void> {
      made.initArgs.push(args);
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

import { createWebGpuEngine, forgetTranslators, loadTranslators } from "../../src/game/gpuEngine.js";

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
/** Two translators, as `loadTranslators` hands them over. */
const TRANSLATORS = { glslang: { compileGLSL: "glslang" }, twgsl: { convertSpirV2WGSL: "twgsl" } };

/**
 * `Tools.LoadScriptAsync` as the shipped loaders behave: each classic script
 * declares a top-level `var Module` (its emscripten factory) and defines its
 * UMD global, whose `initialize` calls whatever `Module` is when it is called.
 * `events` records the order of it all; `skip` names a script that runs but
 * defines nothing; `fail` one that does not load.
 */
function shippedLoaders(events: string[], opts: { skip?: string; fail?: string } = {}) {
  return (url: string): Promise<void> => {
    const name = url.includes("twgsl") ? "twgsl" : "glslang";
    if (opts.fail === name) return Promise.reject(new Error(`${name}.js: blocked`));
    events.push(`run ${name}.js`);
    if (opts.skip === name) return Promise.resolve();
    vi.stubGlobal("Module", () => ({ builtBy: name }));
    vi.stubGlobal(name, (wasm: string) => {
      events.push(`call ${name}`);
      const Module = (globalThis as unknown as { Module: () => { builtBy: string } }).Module;
      return Promise.resolve({ translator: name, builtBy: Module().builtBy, wasm });
    });
    return Promise.resolve();
  };
}

afterEach(() => {
  forgetTranslators();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  made.options.length = 0;
  made.initArgs.length = 0;
  made.disposed = 0;
  made.init = () => Promise.resolve();
  made.prepare = () => Promise.resolve();
  PBRBaseMaterial.ForceGLSL = false;
  StandardMaterial.ForceGLSL = false;
});

describe("loadTranslators", () => {
  it("gives each translator its own factory: one script at a time, each started before the next runs", async () => {
    const events: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      events.push(`fetch ${url.includes("twgsl") ? "twgsl" : "glslang"}.wasm`);
      return Promise.resolve(new Response(new Uint8Array(WASM)));
    });
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(events));
    const translators = await loadTranslators();
    // Both scripts declare the same global `Module`; each factory is called
    // while its own script's is the one there, so each builds its own.
    expect(translators.glslang).toMatchObject({ translator: "glslang", builtBy: "glslang" });
    expect(translators.twgsl).toMatchObject({ translator: "twgsl", builtBy: "twgsl" });
    expect((translators.glslang as { wasm: string }).wasm).toMatch(/glslang[^/]*\.wasm$/);
    expect((translators.twgsl as { wasm: string }).wasm).toMatch(/twgsl[^/]*\.wasm$/);
    // The WebAssembly fetched (and checked) first, so the loaders' own fetches
    // of it come from the cache.
    expect(events).toEqual([
      "fetch glslang.wasm",
      "fetch twgsl.wasm",
      "run glslang.js",
      "call glslang",
      "run twgsl.js",
      "call twgsl",
    ]);
  });

  it("starts them once per page: every later engine gets the same ones", async () => {
    const events: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      events.push(`fetch ${url.includes("twgsl") ? "twgsl" : "glslang"}.wasm`);
      return Promise.resolve(new Response(new Uint8Array(WASM)));
    });
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(events));
    // Two at once, as a renderer swap onto WebGPU could ask, and one later.
    const [first, second] = await Promise.all([loadTranslators(), loadTranslators()]);
    const third = await loadTranslators();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(events).toEqual([
      "fetch glslang.wasm",
      "fetch twgsl.wasm",
      "run glslang.js",
      "call glslang",
      "run twgsl.js",
      "call twgsl",
    ]);
  });

  it("drops a start that failed, so the next one tries again", async () => {
    stubFetch(WASM);
    const failed: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(failed, { fail: "twgsl" }));
    await expect(loadTranslators()).rejects.toThrow("twgsl.js: blocked");
    vi.restoreAllMocks();
    stubFetch(WASM);
    const retried: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(retried));
    const translators = await loadTranslators();
    expect(translators.twgsl).toMatchObject({ builtBy: "twgsl" });
    expect(retried).toEqual(["run glslang.js", "call glslang", "run twgsl.js", "call twgsl"]);
  });

  it("drops a start that has not come in within the fetch budget; the next starts afresh, undisturbed", async () => {
    vi.useFakeTimers();
    // The first start's WebAssembly never comes, until it is answered late by
    // hand: its fetches ignore the abort, as a stalled network can.
    const signals: AbortSignal[] = [];
    const answerLate: (() => void)[] = [];
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve) => answerLate.push(() => resolve(new Response(new Uint8Array(WASM)))));
    });
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders([]));
    const first = loadTranslators();
    let firstOutcome = "pending";
    first.then(
      () => (firstOutcome = "loaded"),
      (err: unknown) => (firstOutcome = String(err)),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(firstOutcome).toBe("pending");
    expect(loadTranslators()).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(firstOutcome).toBe("Error: the WebGPU translators did not load in 10000 ms");
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
    expect(vi.getTimerCount()).toBe(0);

    // The next call starts afresh. The stalled start's answer comes in while
    // it runs, and neither runs a loader nor takes the slot.
    vi.restoreAllMocks();
    stubFetch(WASM);
    const fresh: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(fresh));
    const second = loadTranslators();
    expect(second).not.toBe(first);
    for (const answer of answerLate) answer();
    const translators = await second;
    await vi.advanceTimersByTimeAsync(0);
    expect(translators.glslang).toMatchObject({ builtBy: "glslang" });
    expect(translators.twgsl).toMatchObject({ builtBy: "twgsl" });
    expect(fresh).toEqual(["run glslang.js", "call glslang", "run twgsl.js", "call twgsl"]);
    expect(loadTranslators()).toBe(second);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails at once when a script does not load", async () => {
    vi.useFakeTimers();
    stubFetch(WASM);
    const events: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(events, { fail: "twgsl" }));
    await expect(loadTranslators()).rejects.toThrow("twgsl.js: blocked");
    expect(events).toEqual(["run glslang.js", "call glslang"]);
  });

  it("fails at once when a loader ran but defined nothing, as this host's HTML page for a missing script does", async () => {
    vi.useFakeTimers();
    stubFetch(WASM);
    const first: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(first, { skip: "glslang" }));
    await expect(loadTranslators()).rejects.toThrow("the WebGPU translators did not load: glslang");
    expect(first).toEqual(["run glslang.js"]);
    vi.restoreAllMocks();
    stubFetch(WASM);
    const second: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(second, { skip: "twgsl" }));
    await expect(loadTranslators()).rejects.toThrow("the WebGPU translators did not load: twgsl");
  });

  it("fails at once when a translator is not WebAssembly, before any script runs", async () => {
    vi.useFakeTimers();
    stubFetch([...Buffer.from("<!doctype html>")]);
    const events: string[] = [];
    vi.spyOn(Tools, "LoadScriptAsync").mockImplementation(shippedLoaders(events));
    await expect(loadTranslators()).rejects.toThrow(/glslang[^/]*\.wasm: not WebAssembly/);
    expect(events).toEqual([]);
  });
});

describe("createWebGpuEngine", () => {
  it("refuses to start before the translators are loaded, and makes no engine", async () => {
    await expect(createWebGpuEngine(canvas, {})).rejects.toThrow("load the WebGPU translators first");
    expect(made.options).toEqual([]);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
  });

  it("hands Babylon the translators it was given, so it neither loads nor starts its own", async () => {
    await createWebGpuEngine(canvas, { translators: TRANSLATORS });
    const [glslangOptions, twgslOptions] = made.initArgs[0] as [{ glslang: Promise<unknown> }, { twgsl: unknown }];
    expect(Object.keys(glslangOptions)).toEqual(["glslang"]);
    expect(await glslangOptions.glslang).toBe(TRANSLATORS.glslang);
    expect(twgslOptions).toEqual({ twgsl: TRANSLATORS.twgsl });
  });

  it("asks the device for exactly the required limits and the texture formats it is given", async () => {
    await createWebGpuEngine(canvas, { features: ["texture-compression-bc"], translators: TRANSLATORS });
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
    const engine = await createWebGpuEngine(canvas, { translators: TRANSLATORS });
    const own = Object.getOwnPropertyDescriptor(engine, "_preparePipelineContextAsync");
    expect(typeof own?.value).toBe("function");
  });

  it("asks for no optional feature when it is given none", async () => {
    await createWebGpuEngine(canvas, { translators: TRANSLATORS });
    expect((made.options[0] as { deviceDescriptor: { requiredFeatures: string[] } }).deviceDescriptor.requiredFeatures).toEqual([]);
  });

  it("disposes what it made and leaves the materials alone when the start fails", async () => {
    made.init = () => Promise.reject(new Error("device refused"));
    await expect(createWebGpuEngine(canvas, { translators: TRANSLATORS })).rejects.toThrow("device refused");
    expect(made.disposed).toBe(1);
    expect(PBRBaseMaterial.ForceGLSL).toBe(false);
    expect(StandardMaterial.ForceGLSL).toBe(false);
  });

  it("gives up once the time it is given has passed", async () => {
    vi.useFakeTimers();
    made.prepare = () => new Promise<void>(() => undefined);
    const start = createWebGpuEngine(canvas, { ms: 9_000, translators: TRANSLATORS });
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

  it("takes translators it is handed, ahead of any it would load itself", () => {
    // glslang as a promise (the caller then waits on it), twgsl as the instance.
    expect(source).toContain("        if (glslangOptions.glslang) {\n            return glslangOptions.glslang;");
    expect(source).toContain("this._initGlslangAsync(this._glslangOptions ?? this._options?.glslangOptions).then((glslang) => {");
    const tint = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js"), "utf8");
    expect(tint).toContain("        if (twgslOptions.twgsl) {\n            WebGPUTintWASM._Twgsl = twgslOptions.twgsl;\n            return;");
  });

  it("ships loaders that share one global Module, which each factory reads when it is called", () => {
    const resolve = createRequire(import.meta.url).resolve;
    for (const name of ["glslang", "twgsl"]) {
      const loader = readFileSync(resolve(`@babylonjs/core/assets/${name}/${name}.js`), "utf8");
      // Its first statement, at the top level: a page global.
      expect(loader.trimStart().startsWith("var Module = "), name).toBe(true);
      expect(loader, name).toMatch(/const initialize = \(wasmPath\) => \{[\s\S]{0,120}?return new Promise\(resolve => \{\s+Module\(\{/);
    }
  });

  it("finds the globals where the shipped loaders put them", () => {
    const resolve = createRequire(import.meta.url).resolve;
    expect(readFileSync(resolve("@babylonjs/core/assets/glslang/glslang.js"), "utf8")).toContain('root["glslang"] = factory();');
    expect(readFileSync(resolve("@babylonjs/core/assets/twgsl/twgsl.js"), "utf8")).toContain('root["twgsl"] = factory();');
  });
});
