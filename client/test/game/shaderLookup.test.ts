import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.pure.js";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js";
import { WebGPUPipelineContext } from "@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { parseShaderLookup } from "../../src/game/engineChoice.js";
import { catchTranslationFailures, disposeHalfMade, handTranslators } from "../../src/game/gpuEngine.js";
import {
  LOOKUP_FORMAT,
  buildSalt,
  lookUpShaders,
  releaseShaderLookup,
  lookupSalt,
  newLookupReport,
  stageKey,
  translatorInput,
  uniformityOff,
  type ShaderLookupReport,
  type WgslSource,
} from "../../src/game/shaderLookup.js";
import { openWgslStore, wgslStoreName } from "../../src/game/wgslStore.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { memoryIndexedDb } from "./helpers/memoryIndexedDb.js";

const resolve = createRequire(import.meta.url).resolve;
const SALT = "dayhike-wgsl/1|babylon=test|glslang=aa|twgsl=bb|staticUA=false";

const VERTEX = "#define SHADER_NAME vertex:test\nlayout(location = 0) in vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }";
const FRAGMENT = "#define SHADER_NAME fragment:test\nlayout(location = 0) out vec4 glFragColor;\nvoid main() { glFragColor = vec4(1.0); }";
const DEFINES = "#define NUM_BONE_INFLUENCERS 0\n#define LIGHT0";

afterEach(() => {
  // Babylon keeps the second translator page-wide once it has one.
  (WebGPUTintWASM as unknown as { _Twgsl: unknown })._Twgsl = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * A WebGPU engine with Babylon 9.18's own methods (its prototype's) on a
 * stand-in device, and two stand-in translators: the first returns what it
 * was handed, the second writes a WGSL naming it. The device refuses a
 * module whose code `refuse` names, into the innermost error scope where one
 * is open, else as an uncaptured error, as WebGPU does.
 */
function harness(refuse: (code: string) => boolean = () => false) {
  const modules: string[] = [];
  const compiled: [string, string][] = [];
  const uncaptured: string[] = [];
  const scopes: string[][] = [];
  const counts = { converted: 0 };
  const engine = Object.create(WebGPUEngine.prototype) as WebGPUEngine;
  Object.assign(engine, {
    _isDisposed: false,
    _glslang: null,
    _tintWASM: null,
    _glslangAndTintAreFullyLoaded: false,
    dbgShowShaderCode: false,
    _compiledEffects: {},
    onBeforeShaderCompilationObservable: new Observable(),
    onAfterShaderCompilationObservable: new Observable(),
    onEndFrameObservable: new Observable(),
    _device: {
      createShaderModule: ({ code }: { code: string }) => {
        modules.push(code);
        const bad = refuse(code);
        if (bad) {
          const error = `refused: ${code.slice(0, 40)}`;
          const scope = scopes[scopes.length - 1];
          if (scope !== undefined) scope.push(error);
          else uncaptured.push(error);
        }
        return { code, getCompilationInfo: () => Promise.resolve({ messages: bad ? [{ type: "error" }] : [] }) };
      },
      pushErrorScope: () => void scopes.push([]),
      popErrorScope: () => Promise.resolve(scopes.pop()?.[0] ?? null),
    },
  });
  const translators = {
    glslang: {
      compileGLSL: (text: string, stage: string) => {
        compiled.push([stage, text]);
        return { spirvOf: text };
      },
    },
    twgsl: {
      convertSpirV2WGSL: (code: { spirvOf: string }) => {
        counts.converted++;
        return `// WGSL of\n${code.spirvOf}`;
      },
    },
  };
  return { engine, modules, compiled, uncaptured, translators, counts, scopes };
}

type Harness = ReturnType<typeof harness>;

/** A source in memory, recording what it keeps and drops. */
function memorySource(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  const puts: string[] = [];
  const drops: string[] = [];
  const source: WgslSource = {
    has: (key) => map.has(key),
    get: (key) => Promise.resolve(map.get(key) ?? null),
    put: (key, wgsl) => {
      puts.push(key);
      map.set(key, wgsl);
    },
    drop: (key) => {
      drops.push(key);
      map.delete(key);
    },
  };
  return { source, map, puts, drops };
}

/** The lookup on `h`'s engine, with `sources`, starting `h`'s translators
 * through the game's hand-over; the calls of that start counted. */
function lookUp(h: Harness, sources: readonly WgslSource[], mode: "on" | "record" | "verify" = "on", report?: ShaderLookupReport) {
  const started = { count: 0 };
  const made = lookUpShaders(h.engine, {
    mode,
    salt: SALT,
    sources,
    report: report ?? newLookupReport(mode, SALT),
    translators: async () => {
      started.count++;
      await handTranslators(h.engine, h.translators);
    },
  });
  return { report: made as ShaderLookupReport, started };
}

/** Prepares one effect on `h`'s engine as Babylon's `Effect` does. */
async function prepare(
  h: Harness,
  opts: { vertex?: string; fragment?: string; defines?: string | null; language?: number; raw?: boolean; context?: object } = {},
) {
  const processing = opts.context ?? { shaderLanguage: opts.language ?? 0 };
  const context = new WebGPUPipelineContext(processing as never, h.engine);
  context._name = "test-effect";
  const events: string[] = [];
  const before = h.engine.onBeforeShaderCompilationObservable.add(() => void events.push("before"));
  const after = h.engine.onAfterShaderCompilationObservable.add(() => void events.push("after"));
  try {
    await (h.engine as unknown as { _preparePipelineContextAsync(...args: unknown[]): Promise<void> })._preparePipelineContextAsync(
      context,
      opts.vertex ?? VERTEX,
      opts.fragment ?? FRAGMENT,
      opts.raw ?? false,
      "raw vertex",
      "raw fragment",
      undefined,
      opts.defines === undefined ? DEFINES : opts.defines,
      undefined,
      "",
      () => void events.push("ready"),
    );
  } finally {
    h.engine.onBeforeShaderCompilationObservable.remove(before);
    h.engine.onAfterShaderCompilationObservable.remove(after);
  }
  return { context, events };
}

/** Babylon's own preparation of the same effect, its translators handed over first. */
async function babylons(opts: Parameters<typeof prepare>[1] = {}) {
  const h = harness();
  await handTranslators(h.engine, h.translators);
  const { context } = await prepare(h, opts);
  return { h, context };
}

const keyOf = (stage: "vertex" | "fragment", code: string, defines: string | null = DEFINES): string =>
  stageKey(SALT, stage, uniformityOff(code), translatorInput(code, defines));

describe("the WebGPU shader lookup", () => {
  it("hands the first translator exactly the text Babylon's own path hands it, and makes the same modules from what it translates", async () => {
    const cases = [
      {},
      { defines: null },
      { defines: "" },
      { fragment: `#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}` },
      { vertex: `#define DISABLE_UNIFORMITY_ANALYSIS\n${VERTEX}`, defines: "#define A" },
    ];
    for (const opts of cases) {
      const own = await babylons(opts);
      const h = harness();
      lookUp(h, []);
      const { context } = await prepare(h, opts);
      expect(h.compiled, JSON.stringify(opts)).toEqual(own.h.compiled);
      expect(h.modules, JSON.stringify(opts)).toEqual(own.h.modules);
      expect(context.sources).toEqual(own.context.sources);
      expect(context.isReady).toBe(true);
    }
    // A stage that turns uniformity analysis off gets Babylon's diagnostic.
    const h = harness();
    lookUp(h, []);
    await prepare(h, { fragment: `#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}` });
    expect(h.modules[0]?.startsWith("// WGSL of")).toBe(true);
    expect(h.modules[1]?.startsWith("diagnostic(off, derivative_uniformity);\n// WGSL of")).toBe(true);
  });

  it("finds both stages: starts and calls no translator, and makes exactly two shader modules", async () => {
    const shared = memorySource();
    const first = harness();
    lookUp(first, [shared.source]);
    await prepare(first);
    const h = harness();
    const { report, started } = lookUp(h, [shared.source]);
    const { context, events } = await prepare(h);
    expect(started.count).toBe(0);
    expect(h.compiled).toEqual([]);
    expect(h.counts.converted).toBe(0);
    expect((h.engine as unknown as { _glslang: unknown })._glslang).toBe(null);
    expect(h.modules).toHaveLength(2);
    expect(h.modules).toEqual([...shared.map.values()]);
    expect(context.isReady).toBe(true);
    expect(events).toEqual(["before", "after", "ready"]);
    expect([report.hits, report.misses, report.rejected]).toEqual([2, 0, 0]);
    expect(h.uncaptured).toEqual([]);
  });

  it("translates the one stage no source has, and only it", async () => {
    const full = memorySource();
    const first = harness();
    lookUp(first, [full.source]);
    await prepare(first);
    const vertexOnly = memorySource({ [keyOf("vertex", VERTEX)]: full.map.get(keyOf("vertex", VERTEX)) as string });
    const h = harness();
    const { report, started } = lookUp(h, [vertexOnly.source]);
    await prepare(h);
    expect(started.count).toBe(1);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["fragment"]);
    expect(h.modules).toEqual(first.modules);
    expect([report.hits, report.misses]).toEqual([1, 1]);
  });

  it("keeps each stage it translates, under the stage's key, in every source", async () => {
    const one = memorySource();
    const two = memorySource();
    const h = harness();
    lookUp(h, [one.source, two.source]);
    await prepare(h);
    const keys = [keyOf("vertex", VERTEX), keyOf("fragment", FRAGMENT)];
    expect(one.puts).toEqual(keys);
    expect(two.puts).toEqual(keys);
    expect([one.map.get(keys[0] as string), one.map.get(keys[1] as string)]).toEqual(h.modules);
  });

  it("asks its sources in order, and takes the first that has the stage", async () => {
    const key = keyOf("vertex", VERTEX);
    const first = memorySource({ [key]: "// first" });
    const second = memorySource({ [key]: "// second", [keyOf("fragment", FRAGMENT)]: "// second's fragment" });
    const h = harness();
    lookUp(h, [first.source, second.source]);
    await prepare(h);
    expect(h.modules).toEqual(["// first", "// second's fragment"]);
    expect(h.compiled).toEqual([]);
  });

  it("drops a stored stage the device refuses and translates it afresh, once, with no uncaptured error", async () => {
    const good = harness();
    lookUp(good, []);
    await prepare(good);
    const stored = memorySource({ [keyOf("vertex", VERTEX)]: "corrupt WGSL", [keyOf("fragment", FRAGMENT)]: good.modules[1] as string });
    const h = harness((code) => code.startsWith("corrupt"));
    const { report } = lookUp(h, [stored.source]);
    const { context, events } = await prepare(h);
    expect(stored.drops).toEqual([keyOf("vertex", VERTEX)]);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex"]);
    expect(h.modules).toEqual(["corrupt WGSL", good.modules[1], good.modules[0], good.modules[1]]);
    expect(h.uncaptured).toEqual([]);
    expect(stored.map.get(keyOf("vertex", VERTEX))).toBe(good.modules[0]);
    expect([report.hits, report.misses, report.rejected]).toEqual([1, 1, 1]);
    expect(context.isReady).toBe(true);
    expect(events).toEqual(["before", "after", "before", "after", "ready"]);
  });

  it("leaves a fresh translation the device refuses to its uncaptured error, as without the lookup: no second retry", async () => {
    const stored = memorySource({ [keyOf("vertex", VERTEX)]: "corrupt WGSL" });
    const h = harness((code) => code.startsWith("corrupt") || code.includes("vertex:test"));
    lookUp(h, [stored.source]);
    await prepare(h);
    expect(h.modules).toHaveLength(4);
    expect(h.uncaptured).toHaveLength(1);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["fragment", "vertex"]);
  });

  it("with no source (a store the browser refused) translates every stage, as without the lookup", async () => {
    const own = await babylons();
    const refused: (() => readonly WgslSource[] | Promise<readonly WgslSource[]>)[] = [
      () => [],
      () => Promise.resolve([]),
      () => Promise.reject(new Error("refused")),
    ];
    for (const sources of refused) {
      const h = harness();
      lookUpShaders(h.engine, {
        mode: "on",
        salt: SALT,
        sources: sources(),
        report: newLookupReport("on", SALT),
        translators: () => handTranslators(h.engine, h.translators),
      });
      await prepare(h);
      expect(h.compiled).toEqual(own.h.compiled);
      expect(h.modules).toEqual(own.h.modules);
    }
  });

  it("notifies the compile observables on a hit as on a miss: once each, before the effect is ready", async () => {
    const shared = memorySource();
    const miss = harness();
    lookUp(miss, [shared.source]);
    const missed = await prepare(miss);
    const hit = harness();
    lookUp(hit, [shared.source]);
    const found = await prepare(hit);
    const own = harness();
    await handTranslators(own.engine, own.translators);
    const babylon = await prepare(own);
    expect(missed.events).toEqual(["before", "after", "ready"]);
    expect(found.events).toEqual(missed.events);
    expect(babylon.events).toEqual(missed.events);
  });

  it("starts the translators at the first stage not found, once for stages at once, and again after a start that failed", async () => {
    const h = harness();
    let fail = true;
    let starts = 0;
    vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    lookUpShaders(h.engine, {
      mode: "on",
      salt: SALT,
      sources: [],
      report: newLookupReport("on", SALT),
      translators: async () => {
        starts++;
        if (fail) throw new Error("the WebGPU translators did not load: glslang");
        await handTranslators(h.engine, h.translators);
      },
    });
    await prepare(h);
    expect(h.modules).toEqual([]);
    fail = false;
    await Promise.all([prepare(h), prepare(h, { defines: "#define OTHER" })]);
    expect(starts).toBe(2);
    expect(h.modules).toHaveLength(4);
  });

  it("tells the page, once, of translators that cannot be fetched for a stage not found, and never the failure wrap: the effect is left unready", async () => {
    const h = harness();
    const told: unknown[] = [];
    const warned = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const unfetched = new Error("the WebGPU translators did not load in 10000 ms");
    lookUpShaders(h.engine, {
      mode: "on",
      salt: SALT,
      sources: [],
      report: newLookupReport("on", SALT),
      translators: () => Promise.reject(unfetched),
      unfetched: (error) => void told.push(error),
    });
    catchTranslationFailures(h.engine);
    const wrapped = vi.spyOn(Logger, "Error").mockImplementation(() => undefined);
    const effectErrors: unknown[] = [];
    h.engine.onEffectErrorObservable = new Observable();
    h.engine.onEffectErrorObservable.add((e) => void effectErrors.push(e));
    const first = await prepare(h);
    const second = await prepare(h, { raw: true });
    const third = await prepare(h, { defines: "#define OTHER" });
    expect(told).toEqual([unfetched]);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(wrapped).not.toHaveBeenCalled();
    expect(effectErrors).toEqual([]);
    expect([first.events, second.events, third.events]).toEqual([[], [], []]);
    expect([first.context.isReady, third.context.isReady]).toEqual([false, false]);
    expect(h.modules).toEqual([]);
  });

  it("gives a translation that throws to the failure handling, as without the lookup", async () => {
    const h = harness();
    lookUp(h, []);
    h.translators.glslang.compileGLSL = () => {
      throw new Error("GLSL compilation failed");
    };
    catchTranslationFailures(h.engine);
    const logged = vi.spyOn(Logger, "Error").mockImplementation(() => undefined);
    await expect(prepare(h)).rejects.toThrow("GLSL compilation failed");
    expect(h.modules).toEqual([]);
    // The wrap heard it (no compiled effect owns this stand-in context).
    expect(logged).toHaveBeenCalledWith("WebGPU shader translation failed: GLSL compilation failed");
  });

  it("starts the translators once the page is idle after the engine's first frame, and only then", async () => {
    const idle: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void) => void idle.push(run));
    const h = harness();
    const { started } = lookUp(h, []);
    expect(idle).toHaveLength(0);
    h.engine.onEndFrameObservable.notifyObservers(h.engine);
    h.engine.onEndFrameObservable.notifyObservers(h.engine);
    expect(started.count).toBe(0);
    expect(idle).toHaveLength(1);
    idle[0]?.();
    await Promise.resolve();
    expect(started.count).toBe(1);
    // The first stage not found then takes the same start.
    await prepare(h);
    expect(started.count).toBe(1);
    expect(h.compiled).toHaveLength(2);
  });

  it("fails a prefetch silently: nothing told, logged or kept; the next stage not found starts the translators again, and its failure is told", async () => {
    const idle: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void) => void idle.push(run));
    const warned = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const h = harness();
    const told: unknown[] = [];
    let starts = 0;
    lookUpShaders(h.engine, {
      mode: "on",
      salt: SALT,
      sources: [],
      report: newLookupReport("on", SALT),
      translators: async () => {
        starts++;
        throw new Error("the WebGPU translators did not load in 10000 ms");
      },
      unfetched: (error) => void told.push(error),
    });
    h.engine.onEndFrameObservable.notifyObservers(h.engine);
    idle[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([starts, told.length, warned.mock.calls.length]).toEqual([1, 0, 0]);
    // A miss starts them again; failing there, it is told.
    await prepare(h);
    expect([starts, told.length, warned.mock.calls.length]).toEqual([2, 1, 1]);
    // A miss after a silent prefetch that failed, with the network back.
    const again = harness();
    let back = 0;
    const idleAgain: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void) => void idleAgain.push(run));
    lookUpShaders(again.engine, {
      mode: "on",
      salt: SALT,
      sources: [],
      report: newLookupReport("on", SALT),
      translators: async () => {
        back++;
        if (back === 1) throw new Error("the WebGPU translators did not load in 10000 ms");
        await handTranslators(again.engine, again.translators);
      },
      unfetched: (error) => void told.push(error),
    });
    again.engine.onEndFrameObservable.notifyObservers(again.engine);
    idleAgain[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { events } = await prepare(again);
    expect(back).toBe(2);
    expect(events).toEqual(["before", "after", "ready"]);
    expect(told).toHaveLength(1);
  });

  it("leaves a native WGSL effect to Babylon, and a raw GLSL one too once it has started the translators", async () => {
    const own = harness();
    const wgsl = await prepare(own, { language: 1, vertex: "// vertex wgsl", fragment: "// fragment wgsl" });
    const h = harness();
    const { started, report } = lookUp(h, []);
    const looked = await prepare(h, { language: 1, vertex: "// vertex wgsl", fragment: "// fragment wgsl" });
    expect(started.count).toBe(0);
    expect(h.modules).toEqual(own.modules);
    expect(looked.context.sources).toEqual(wgsl.context.sources);

    const ownRaw = await babylons({ raw: true });
    const raw = harness();
    const rawLookup = lookUp(raw, []);
    await prepare(raw, { raw: true });
    expect(rawLookup.started.count).toBe(1);
    expect(raw.compiled).toEqual(ownRaw.h.compiled);
    expect(raw.modules).toEqual(ownRaw.h.modules);
    expect([report.hits, report.misses, rawLookup.report.hits, rawLookup.report.misses]).toEqual([0, 0, 0, 0]);
  });

  it("ends a preparation whose engine was disposed meanwhile without making a module or calling it ready", async () => {
    const h = harness();
    let answer: (value: string | null) => void = () => undefined;
    const key = keyOf("vertex", VERTEX);
    const slow: WgslSource = {
      has: (k) => k === key,
      get: () => new Promise((r) => (answer = r)),
      put: () => undefined,
      drop: () => undefined,
    };
    lookUp(h, [slow]);
    const pending = prepare(h);
    await new Promise((r) => setTimeout(r, 0));
    (h.engine as unknown as { _isDisposed: boolean })._isDisposed = true;
    answer("// vertex");
    const { events, context } = await pending;
    expect(h.modules).toEqual([]);
    expect(events).toEqual([]);
    expect(context.isReady).toBe(false);
  });

  it("with ?wgsl=verify translates every stage found and counts the ones that differ, drawing with what it found", async () => {
    const good = harness();
    lookUp(good, []);
    await prepare(good);
    const stored = memorySource({ [keyOf("vertex", VERTEX)]: good.modules[0] as string, [keyOf("fragment", FRAGMENT)]: "// a different WGSL" });
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const h = harness();
    const { report } = lookUp(h, [stored.source], "verify");
    await prepare(h);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
    expect(report.differences).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.modules).toEqual([good.modules[0], "// a different WGSL"]);
    expect([report.hits, report.misses]).toEqual([2, 0]);
  });

  it("with ?wgsl=record keeps every effect's stages, texts and times, one object for a measurement to read", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const shared = memorySource();
    const report = newLookupReport("record", SALT);
    const first = harness();
    lookUp(first, [shared.source], "record", report);
    const processing = first.engine._getShaderProcessingContext(0, false) as object;
    await prepare(first, { context: processing });
    const second = harness();
    lookUp(second, [shared.source], "record", report);
    await prepare(second);
    expect(Object.keys(report).sort()).toEqual(["differences", "download", "effects", "hits", "misses", "mode", "rejected", "salt", "translateMs"]);
    expect([report.mode, report.salt, report.hits, report.misses, report.rejected, report.differences]).toEqual(["record", SALT, 2, 2, 0, 0]);
    expect(report.translateMs).toBeGreaterThan(0);
    expect(typeof report.download).toBe("function");
    expect(report.effects).toHaveLength(2);
    const [translated, found] = report.effects as [NonNullable<(typeof report.effects)[0]>, NonNullable<(typeof report.effects)[0]>];
    expect(Object.keys(translated).sort()).toEqual(["at", "moduleMs", "name", "processMs", "stages"]);
    expect(translated.name).toBe("test-effect");
    expect(translated.processMs).toBeGreaterThan(0);
    expect(translated.moduleMs).toBeGreaterThan(0);
    expect(translated.stages.map((s) => Object.keys(s).sort())).toEqual([
      ["flag", "from", "glsl", "key", "spirvMs", "stage", "wgsl", "wgslMs"],
      ["flag", "from", "glsl", "key", "spirvMs", "stage", "wgsl", "wgslMs"],
    ]);
    expect(translated.stages.map((s) => [s.stage, s.key, s.flag, s.glsl, s.wgsl, s.from])).toEqual([
      ["vertex", keyOf("vertex", VERTEX), false, translatorInput(VERTEX, DEFINES), first.modules[0], "translated"],
      ["fragment", keyOf("fragment", FRAGMENT), false, translatorInput(FRAGMENT, DEFINES), first.modules[1], "translated"],
    ]);
    expect(translated.stages.every((s) => s.spirvMs > 0 && s.wgslMs > 0)).toBe(true);
    expect(found.stages.map((s) => [s.from, s.spirvMs, s.wgslMs])).toEqual([
      ["source", 0, 0],
      ["source", 0, 0],
    ]);
    // It reads whole as JSON, the form `download()` saves.
    expect(JSON.parse(JSON.stringify(report)).effects[0].stages[1].wgsl).toBe(first.modules[1]);
  });

  it("counts, but records no effect, without ?wgsl=record", async () => {
    const h = harness();
    const { report } = lookUp(h, []);
    await prepare(h);
    expect([report.hits, report.misses, report.effects.length]).toEqual([0, 2, 0]);
  });

  it("puts the page's report on the page, the first engine's, as dayhikeWgsl", () => {
    vi.stubGlobal("dayhikeWgsl", undefined);
    const h = harness();
    const made = lookUpShaders(h.engine, { mode: "record", salt: SALT, sources: [], translators: () => Promise.resolve() });
    const again = lookUpShaders(harness().engine, { mode: "record", salt: SALT, sources: [], translators: () => Promise.resolve() });
    expect((globalThis as { dayhikeWgsl?: unknown }).dayhikeWgsl).toBe(made);
    expect(again).toBe(made);
  });

  it("with ?wgsl=off leaves the engine as Babylon made it", () => {
    const h = harness();
    expect(lookUpShaders(h.engine, { mode: "off", salt: SALT, sources: [], translators: () => Promise.resolve() })).toBe(null);
    expect(Object.getOwnPropertyDescriptor(h.engine, "_preparePipelineContextAsync")).toBe(undefined);
    expect(Object.getOwnPropertyDescriptor(h.engine, "_getShaderProcessingContext")).toBe(undefined);
    expect(parseShaderLookup("?wgsl=off")).toBe("off");
    expect(parseShaderLookup("?tier=high&wgsl=record")).toBe("record");
    expect(parseShaderLookup("?wgsl=verify")).toBe("verify");
    expect(parseShaderLookup("")).toBe("on");
    expect(parseShaderLookup("?wgsl=OFF")).toBe("on");
  });

  it("opens the browser's store at its first shader, not before, so an engine whose start fails opens none", async () => {
    const idb = memoryIndexedDb();
    vi.stubGlobal("indexedDB", idb.factory);
    const h = harness();
    lookUpShaders(h.engine, { mode: "on", salt: SALT, report: newLookupReport("on", SALT), translators: () => handTranslators(h.engine, h.translators) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idb.databases.size).toBe(0);
    await prepare(h);
    expect([...idb.databases.keys()]).toEqual([wgslStoreName(SALT)]);
  });

  it("lets its store go when its engine is disposed, or when told to, once; and opens none after", async () => {
    for (const how of ["dispose", "told"] as const) {
      const closed: string[] = [];
      const shared = memorySource();
      const h = harness();
      Object.assign(h.engine, { onDisposeObservable: new Observable() });
      lookUp(h, [{ ...shared.source, close: () => void closed.push("closed") }]);
      await prepare(h);
      if (how === "dispose") h.engine.onDisposeObservable.notifyObservers(h.engine);
      else releaseShaderLookup(h.engine);
      releaseShaderLookup(h.engine);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(closed, how).toEqual(["closed"]);
      // After it, no source is asked: every stage is translated.
      await prepare(h, { defines: "#define AFTER" });
      expect(h.compiled.map(([stage]) => stage), how).toEqual(["vertex", "fragment", "vertex", "fragment"]);
    }
    // An engine that looked nothing up, or never prepared, is left alone.
    expect(() => releaseShaderLookup(harness().engine)).not.toThrow();
  });

  it("lets its store go when a start that failed part-way is disposed, though Babylon's dispose throws before it tells anyone", async () => {
    const closed: string[] = [];
    const h = harness();
    // No dispose observable is ever notified: the store's release must come
    // from the disposal's own end.
    Object.assign(h.engine, {
      dispose: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'dispose')");
      },
    });
    lookUp(h, [{ ...memorySource().source, close: () => void closed.push("closed") }]);
    await prepare(h);
    disposeHalfMade(h.engine);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toEqual(["closed"]);
    // Babylon's base dispose notifies its dispose observable only at the end,
    // after the effects, textures and scenes (a canary on the installed engine).
    const base = readFileSync(resolve("@babylonjs/core/Engines/abstractEngine.pure.js"), "utf8");
    const dispose = base.slice(base.indexOf("    dispose() {\n        this.releaseEffects();"), base.indexOf("        this.onDisposeObservable.clear();"));
    expect(dispose.indexOf("this.onDisposeObservable.notifyObservers(this);")).toBeGreaterThan(dispose.indexOf("this.scenes[0].dispose();"));
    expect(dispose.indexOf("this.scenes[0].dispose();")).toBeGreaterThan(0);
  });

  it("keeps a translation in the browser's store, and the next engine finds it there", async () => {
    const idb = memoryIndexedDb();
    const first = harness();
    const opened = openWgslStore(SALT, { idb: idb.factory }).then((store) => (store === null ? [] : [store]));
    lookUpShaders(first.engine, { mode: "on", salt: SALT, sources: opened, report: newLookupReport("on", SALT), translators: () => handTranslators(first.engine, first.translators) });
    await prepare(first);
    const store = (await opened)[0] as WgslSource;
    await vi.waitFor(() => expect(store.has(keyOf("fragment", FRAGMENT))).toBe(true), { timeout: timeLimit(5_000) });
    const second = harness();
    const reopened = openWgslStore(SALT, { idb: idb.factory }).then((s) => (s === null ? [] : [s]));
    const report = newLookupReport("on", SALT);
    lookUpShaders(second.engine, { mode: "on", salt: SALT, sources: reopened, report, translators: () => handTranslators(second.engine, second.translators) });
    await prepare(second);
    expect(second.compiled).toEqual([]);
    expect(second.modules).toEqual(first.modules);
    expect([report.hits, report.misses]).toEqual([2, 0]);
  });
});

describe("the lookup's key", () => {
  it("is SHA-256 over the salt, the stage, the switch and the exact text, each apart by a zero byte", () => {
    const glsl = translatorInput(VERTEX, DEFINES);
    const expected = createHash("sha256").update(`${SALT}\0vertex\0${"1"}\0${glsl}`, "utf8").digest("hex");
    expect(stageKey(SALT, "vertex", true, glsl)).toBe(expected);
    expect(stageKey(SALT, "fragment", false, "é")).toBe(createHash("sha256").update(`${SALT}\0fragment\0${"0"}\0é`, "utf8").digest("hex"));
  });

  it("carries the whole stage as the translator is handed it: a define that turns uniformity analysis off makes another key", () => {
    // Babylon reads that define from the code to put its diagnostic before
    // the WGSL; the key reads the same code, and the switch it gives.
    const plain = `#define A\n${FRAGMENT}`;
    const off = `#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}`;
    expect(keyOf("fragment", off)).not.toBe(keyOf("fragment", plain));
    expect(stageKey(SALT, "fragment", true, translatorInput(FRAGMENT, DEFINES))).not.toBe(stageKey(SALT, "fragment", false, translatorInput(FRAGMENT, DEFINES)));
  });

  it("changes with each of its inputs and with nothing else", () => {
    const glsl = translatorInput(VERTEX, DEFINES);
    const keys = [
      stageKey(SALT, "vertex", false, glsl),
      stageKey(`${SALT}x`, "vertex", false, glsl),
      stageKey(SALT, "fragment", false, glsl),
      stageKey(SALT, "vertex", true, glsl),
      stageKey(SALT, "vertex", false, `${glsl} `),
    ];
    expect(new Set(keys).size).toBe(5);
    expect(stageKey(SALT, "vertex", false, glsl)).toBe(keys[0]);
    // Only the text the translator is handed counts, however it was put together.
    expect(translatorInput("void main() {}", "#define A")).toBe(translatorInput("#define A\nvoid main() {}", null));
    expect(translatorInput("void main() {}", "")).toBe("#version 450\nvoid main() {}");
    // The switch is read from the code, as Babylon reads it, never from the defines.
    expect(uniformityOff("#define DISABLE_UNIFORMITY_ANALYSIS\nvoid main() {}")).toBe(true);
    expect(uniformityOff("void main() {}")).toBe(false);
  });

  it("is salted with its format, Babylon's version, the shipped translators' digests and Babylon's page-wide switch", () => {
    expect(LOOKUP_FORMAT).toBe("dayhike-wgsl/1");
    expect(lookupSalt({ babylon: "9.18.0", translators: "glslang=aa|twgsl=bb", staticUniformityOff: false })).toBe(
      "dayhike-wgsl/1|babylon=9.18.0|glslang=aa|twgsl=bb|staticUA=false",
    );
    const salts = [
      lookupSalt({ babylon: "9.18.0", translators: "glslang=aa|twgsl=bb", staticUniformityOff: false }),
      lookupSalt({ babylon: "9.18.1", translators: "glslang=aa|twgsl=bb", staticUniformityOff: false }),
      lookupSalt({ babylon: "9.18.0", translators: "glslang=ab|twgsl=bb", staticUniformityOff: false }),
      lookupSalt({ babylon: "9.18.0", translators: "glslang=aa|twgsl=bb", staticUniformityOff: true }),
    ];
    expect(new Set(salts).size).toBe(4);
    // The build's digests are those of the WebAssembly it ships.
    const digest = (name: string): string =>
      createHash("sha256").update(readFileSync(resolve(`@babylonjs/core/assets/${name}/${name}.wasm`))).digest("hex");
    expect(buildSalt()).toBe(`dayhike-wgsl/1|babylon=9.18.0|glslang=${digest("glslang")}|twgsl=${digest("twgsl")}|staticUA=false`);
  });
});

describe("the lines of Babylon 9.18 the lookup copies or leans on (canaries on the installed engine)", () => {
  const engine = readFileSync(resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
  const between = (from: string, to: string): string => engine.slice(engine.indexOf(from), engine.indexOf(to, engine.indexOf(from)));

  it("puts the version line and the defines before a stage's code, and hands that to glslang", () => {
    expect(engine).toContain(
      "    _compileRawShaderToSpirV(source, type) {\n        return this._glslang.compileGLSL(source, type);\n    }\n" +
        "    _compileShaderToSpirV(source, type, defines, shaderVersion) {\n" +
        '        return this._compileRawShaderToSpirV(shaderVersion + (defines ? defines + "\\n" : "") + source, type);',
    );
    const compile = between("    _compilePipelineStageDescriptor(vertexCode, fragmentCode, defines, shaderLanguage) {", "    createRawShaderProgram() {");
    expect(compile).toContain('        const shaderVersion = "#version 450\\n";');
    expect(compile).toContain('this._compileShaderToSpirV(vertexCode, "vertex", defines, shaderVersion)');
    expect(compile).toContain('this._compileShaderToSpirV(fragmentCode, "fragment", defines, shaderVersion)');
  });

  it("reads each stage's uniformity switch from its code, and notifies the observables around the compile", () => {
    const compile = between("    _compilePipelineStageDescriptor(vertexCode, fragmentCode, defines, shaderLanguage) {", "    createRawShaderProgram() {");
    expect(compile).toContain(
      "        this.onBeforeShaderCompilationObservable.notifyObservers(this);\n" +
        "        const disableUniformityAnalysisInVertex = vertexCode.indexOf(`#define DISABLE_UNIFORMITY_ANALYSIS`) >= 0;\n" +
        "        const disableUniformityAnalysisInFragment = fragmentCode.indexOf(`#define DISABLE_UNIFORMITY_ANALYSIS`) >= 0;",
    );
    expect(compile).toContain(
      "        const program = this._createPipelineStageDescriptor(vertexShader, fragmentShader, shaderLanguage, disableUniformityAnalysisInVertex, disableUniformityAnalysisInFragment);\n" +
        "        this.onAfterShaderCompilationObservable.notifyObservers(this);\n        return program;",
    );
  });

  it("skips Tint for WGSL and makes one module per stage from the code it is given", () => {
    const descriptor = between("    _createPipelineStageDescriptor(vertexShader, fragmentShader, shaderLanguage, disableUniformityAnalysisInVertex, disableUniformityAnalysisInFragment) {", "    _compileRawPipelineStageDescriptor(");
    expect(descriptor).toContain(
      "        if (this._tintWASM && shaderLanguage === 0 /* ShaderLanguage.GLSL */) {\n" +
        "            vertexShader = this._tintWASM.convertSpirV2WGSL(vertexShader, disableUniformityAnalysisInVertex);\n" +
        "            fragmentShader = this._tintWASM.convertSpirV2WGSL(fragmentShader, disableUniformityAnalysisInFragment);\n        }",
    );
    expect([...descriptor.matchAll(/module: this\._device\.createShaderModule\(\{/g)]).toHaveLength(2);
    expect(descriptor).toContain("                    code: vertexShader,");
    expect(descriptor).toContain("                    code: fragmentShader,");
  });

  it("prepares with the parameters, the sources and the order the lookup replaces", () => {
    const prepare = between("    async _preparePipelineContextAsync(", "    getAttributes(");
    expect(prepare).toContain(
      "    async _preparePipelineContextAsync(pipelineContext, vertexSourceCode, fragmentSourceCode, createAsRaw, rawVertexSourceCode, rawFragmentSourceCode, _rebuildRebind, defines, _transformFeedbackVaryings, _key, onReady) {",
    );
    expect(prepare).toContain("        const shaderLanguage = webGpuContext.shaderProcessingContext.shaderLanguage;");
    // The translators, loaded by Babylon's own loader only here, and only for GLSL.
    expect(prepare).toContain(
      "        if (shaderLanguage === 0 /* ShaderLanguage.GLSL */ && !this._glslangAndTintAreFullyLoaded) {\n            await this.prepareGlslangAndTintAsync();",
    );
    expect(prepare).toContain(
      "        webGpuContext.sources = {\n            fragment: fragmentSourceCode,\n            vertex: vertexSourceCode,\n" +
        "            rawVertex: rawVertexSourceCode,\n            rawFragment: rawFragmentSourceCode,\n        };",
    );
    expect(prepare).toContain(
      "            webGpuContext.stages = this._compilePipelineStageDescriptor(vertexSourceCode, fragmentSourceCode, defines, shaderLanguage);\n        }\n        onReady();",
    );
    expect(engine).toContain("    _getShaderProcessingContext(shaderLanguage, pureMode) {\n        return new WebGPUShaderProcessingContext(shaderLanguage, pureMode);");
  });

  it("puts the diagnostic before a WGSL whose stage turns uniformity analysis off", () => {
    const tint = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js"), "utf8");
    expect(tint).toContain(
      '        return WebGPUTintWASM.DisableUniformityAnalysis || disableUniformityAnalysis ? "diagnostic(off, derivative_uniformity);\\n" + ccode : ccode;',
    );
    expect(tint).toContain("WebGPUTintWASM.DisableUniformityAnalysis = false;");
  });

  it("makes an effect's processing context first, and names its pipeline context by the effect's key (the recorder's two readings)", () => {
    const effect = readFileSync(resolve("@babylonjs/core/Materials/effect.pure.js"), "utf8");
    expect(effect).toContain("        this._processingContext = shaderProcessingContext || this._engine._getShaderProcessingContext(this._shaderLanguage, false);");
    const functions = readFileSync(resolve("@babylonjs/core/Materials/effect.functions.js"), "utf8");
    expect(functions).toContain("        pipelineContext._name = options.name;");
  });

  it("never sets Babylon's page-wide uniformity switch in the game, so the salt's one reading of it holds", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const setting = files(src).filter((file) => /DisableUniformityAnalysis\s*=[^=]/.test(readFileSync(file, "utf8")));
    expect(setting).toEqual([]);
  });
});
