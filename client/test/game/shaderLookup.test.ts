import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.pure.js";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js";
import { WebGPUPipelineContext } from "@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js";
import { WebGPUShaderProcessorGLSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js";
import { checkNonFloatVertexBuffers } from "@babylonjs/core/Buffers/buffer.nonFloatVertexBuffers.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { parseShaderLookup } from "../../src/game/engineChoice.js";
import { catchTranslationFailures, disposeHalfMade, type Translators } from "../../src/game/gpuEngine.js";
import {
  LOOKUP_FORMAT,
  WGSL_KEPT_MAX_CHARS,
  WGSL_SOURCES_MS,
  buildSalt,
  defaultSources,
  lookUpShaders,
  openingSource,
  releaseShaderLookup,
  lookupSalt,
  newLookupReport,
  stageKey,
  translatorInput,
  uniformityOff,
  type ShaderLookupReport,
  type WgslSource,
} from "../../src/game/shaderLookup.js";
import { corpusText, mapText, readCorpus } from "../../src/game/wgslFormat.js";
import { WGSL_MAP_MS, WGSL_MAP_SOURCE, loadWgslMap } from "../../src/game/wgslMap.js";
import { loadWgslStore, wgslStoreName } from "../../src/game/wgslStore.js";
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
 * stand-in device that keeps the code of each module it makes, and two
 * stand-in translators: the first returns what it was handed, the second
 * writes a WGSL naming it.
 */
function harness() {
  const modules: string[] = [];
  const compiled: [string, string][] = [];
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
    _device: {
      createShaderModule: ({ code }: { code: string }) => {
        modules.push(code);
        return { code };
      },
    },
  });
  const translators = {
    glslang: {
      compileGLSL: (text: string, stage: string) => {
        compiled.push([stage, text]);
        return { spirvOf: text };
      },
    },
    twgsl: { convertSpirV2WGSL: (code: { spirvOf: string }) => `// WGSL of\n${code.spirvOf}` },
  };
  return { engine, modules, compiled, translators };
}

type Harness = ReturnType<typeof harness>;

/** Hands `translators` to Babylon on `engine` as the engine's maker does,
 * before the engine is handed over: after it, Babylon's own path translates
 * in the call. */
async function handOver(engine: WebGPUEngine, translators: Translators): Promise<void> {
  const own = engine as unknown as { _glslangOptions: unknown; _twgslOptions: unknown };
  own._glslangOptions = { glslang: Promise.resolve(translators.glslang) };
  own._twgslOptions = { twgsl: translators.twgsl };
  await engine.prepareGlslangAndTintAsync();
}

/** A source in memory, named, recording what it keeps. */
function memorySource(entries: Record<string, string> = {}, name = "memory", salt = SALT) {
  const map = new Map(Object.entries(entries));
  const puts: string[] = [];
  const events: string[] = [];
  const source: WgslSource = {
    name,
    salt,
    get: (key) => map.get(key) ?? null,
    put: (key, wgsl) => {
      puts.push(key);
      map.set(key, wgsl);
    },
    close: () => void events.push("close"),
  };
  return { source, map, puts, events };
}

/** The lookup on `h`'s engine with `sources`, and the engine as its maker
 * hands it over: translators loaded, the sources in. */
async function lookUp(h: Harness, sources: readonly WgslSource[], mode: "on" | "record" | "verify" = "on", report?: ShaderLookupReport) {
  const made = report ?? newLookupReport(mode, SALT);
  const ready = lookUpShaders(h.engine, { mode, salt: SALT, sources: () => Promise.resolve(sources), report: made });
  await handOver(h.engine, h.translators);
  await ready;
  return made;
}

/**
 * Prepares one effect on `h`'s engine as Babylon's `Effect` does, and what
 * had happened by the time the call returned, before anything was awaited:
 * a preparation runs to `onReady` in the call that asks for it, as Babylon's
 * own does, which Babylon relies on when it prepares an effect again at the
 * first draw of integer vertex buffers.
 */
async function prepare(
  h: Harness,
  opts: { vertex?: string; fragment?: string; defines?: string | null; language?: number; raw?: boolean; context?: WebGPUPipelineContext; processing?: object } = {},
) {
  const context = opts.context ?? new WebGPUPipelineContext((opts.processing ?? { shaderLanguage: opts.language ?? 0 }) as never, h.engine);
  context._name = "test-effect";
  const events: string[] = [];
  const before = h.engine.onBeforeShaderCompilationObservable.add(() => void events.push("before"));
  const after = h.engine.onAfterShaderCompilationObservable.add(() => void events.push("after"));
  let inTheCall: string[] = [];
  let stagesInTheCall: unknown;
  try {
    const pending = (h.engine as unknown as { _preparePipelineContextAsync(...args: unknown[]): Promise<void> })._preparePipelineContextAsync(
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
    inTheCall = [...events];
    stagesInTheCall = context.stages;
    await pending;
  } finally {
    h.engine.onBeforeShaderCompilationObservable.remove(before);
    h.engine.onAfterShaderCompilationObservable.remove(after);
  }
  return { context, events, inTheCall, stagesInTheCall };
}

/** Babylon's own preparation of the same effect, its translators loaded. */
async function babylons(opts: Parameters<typeof prepare>[1] = {}) {
  const h = harness();
  await handOver(h.engine, h.translators);
  const { context } = await prepare(h, opts);
  return { h, context };
}

const keyOf = (stage: "vertex" | "fragment", code: string, defines: string | null = DEFINES): string =>
  stageKey(SALT, stage, uniformityOff(code), translatorInput(code, defines));

/** Every stage `h` translates, kept under its key: what a first load leaves. */
async function translatedBy(opts: Parameters<typeof prepare>[1] = {}) {
  const kept = memorySource();
  const first = harness();
  await lookUp(first, [kept.source]);
  await prepare(first, opts);
  return { kept, first };
}

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
      await lookUp(h, []);
      const { context } = await prepare(h, opts);
      expect(h.compiled, JSON.stringify(opts)).toEqual(own.h.compiled);
      expect(h.modules, JSON.stringify(opts)).toEqual(own.h.modules);
      expect(context.sources).toEqual(own.context.sources);
      expect(context.isReady).toBe(true);
    }
    // A stage that turns uniformity analysis off gets Babylon's diagnostic.
    const h = harness();
    await lookUp(h, []);
    await prepare(h, { fragment: `#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}` });
    expect(h.modules[0]?.startsWith("// WGSL of")).toBe(true);
    expect(h.modules[1]?.startsWith("diagnostic(off, derivative_uniformity);\n// WGSL of")).toBe(true);
  });

  it("prepares in the call that asks, never waiting: ready, with its stages set, before the call returns, on a hit and on a miss", async () => {
    const miss = harness();
    const kept = memorySource();
    await lookUp(miss, [kept.source]);
    const missed = await prepare(miss);
    expect(missed.inTheCall).toEqual(["before", "after", "ready"]);
    expect(missed.stagesInTheCall).toBe(missed.context.stages);
    expect(missed.stagesInTheCall).not.toBe(undefined);
    const hit = harness();
    await lookUp(hit, [kept.source]);
    const found = await prepare(hit);
    expect(hit.compiled).toEqual([]);
    expect(found.inTheCall).toEqual(["before", "after", "ready"]);
    expect(found.stagesInTheCall).toBe(found.context.stages);
  });

  it("prepares a context that already has stages again, in the call, and leaves the new stages on it, on a hit and on a miss", async () => {
    const vertexInt = `${VERTEX}\nlayout(location = 1) in uvec4 _int_matricesIndices_;`;
    // Both variants translated once: every stage of them found after.
    const { kept, first: translating } = await translatedBy();
    await prepare(translating, { vertex: vertexInt });
    for (const store of [memorySource(), kept]) {
      const h = harness();
      await lookUp(h, [store.source]);
      const first = await prepare(h);
      const old = first.context.stages;
      const again = await prepare(h, { context: first.context, vertex: vertexInt });
      expect(again.context).toBe(first.context);
      expect(again.inTheCall).toEqual(["before", "after", "ready"]);
      expect(again.stagesInTheCall).not.toBe(old);
      expect(again.stagesInTheCall).toBe(first.context.stages);
      const stages = first.context.stages as unknown as { vertexStage: { module: { code: string } } };
      expect(stages.vertexStage.module.code).toContain("_int_matricesIndices_");
      expect(h.compiled.length).toBe(store === kept ? 0 : 3);
    }
  });

  it("finds both stages: calls no translator, and makes exactly two shader modules, counting the source that had them", async () => {
    const { kept, first } = await translatedBy();
    const h = harness();
    const report = await lookUp(h, [kept.source]);
    const { context, events } = await prepare(h);
    expect(h.compiled).toEqual([]);
    expect(h.modules).toEqual(first.modules);
    expect(context.isReady).toBe(true);
    expect(events).toEqual(["before", "after", "ready"]);
    expect([report.hits, report.misses]).toEqual([2, 0]);
    expect(report.hitsBySource).toEqual({ memory: 2 });
  });

  it("translates the one stage no source has, and only it", async () => {
    const { kept, first } = await translatedBy();
    const vertexOnly = memorySource({ [keyOf("vertex", VERTEX)]: kept.map.get(keyOf("vertex", VERTEX)) as string });
    const h = harness();
    const report = await lookUp(h, [vertexOnly.source]);
    await prepare(h);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["fragment"]);
    expect(h.modules).toEqual(first.modules);
    expect([report.hits, report.misses]).toEqual([1, 1]);
  });

  it("keeps each stage it translates, under the stage's key, in every source that takes writes", async () => {
    const one = memorySource();
    const two = memorySource({}, "two");
    const shipped: WgslSource = { name: "shipped", salt: SALT, get: () => null };
    const h = harness();
    await lookUp(h, [shipped, one.source, two.source]);
    await prepare(h);
    const keys = [keyOf("vertex", VERTEX), keyOf("fragment", FRAGMENT)];
    expect(one.puts).toEqual(keys);
    expect(two.puts).toEqual(keys);
    expect([one.map.get(keys[0] as string), one.map.get(keys[1] as string)]).toEqual(h.modules);
  });

  it("asks its sources in order, takes the first that has the stage, and names it", async () => {
    const key = keyOf("vertex", VERTEX);
    const first = memorySource({ [key]: "// first" }, "first");
    const second = memorySource({ [key]: "// second", [keyOf("fragment", FRAGMENT)]: "// second's fragment" }, "second");
    const h = harness();
    const report = await lookUp(h, [first.source, second.source], "record");
    await prepare(h);
    expect(h.modules).toEqual(["// first", "// second's fragment"]);
    expect(h.compiled).toEqual([]);
    expect(report.hitsBySource).toEqual({ first: 1, second: 1 });
    expect(report.effects[0]?.stages.map((s) => s.from)).toEqual(["first", "second"]);
  });

  it("never asks a source made for another salt, and lets it go", async () => {
    const { kept } = await translatedBy();
    const other = memorySource(Object.fromEntries(kept.map), "shipped", "dayhike-wgsl/1|babylon=other");
    vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const h = harness();
    const report = await lookUp(h, [other.source]);
    await prepare(h);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
    expect(report.hits).toBe(0);
    expect(other.events).toEqual(["close"]);
  });

  it("translates a stage two effects share once", async () => {
    const h = harness();
    const report = await lookUp(h, []);
    await prepare(h);
    await prepare(h, { fragment: `${FRAGMENT}\n// another fragment` });
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment", "fragment"]);
    expect(report.hitsBySource).toEqual({ page: 1 });
  });

  it("with no source translates every stage, as without the lookup", async () => {
    const own = await babylons();
    const factories: (() => Promise<readonly WgslSource[]>)[] = [() => Promise.resolve([]), () => Promise.reject(new Error("refused"))];
    for (const sources of factories) {
      const h = harness();
      const ready = lookUpShaders(h.engine, { mode: "on", salt: SALT, sources, report: newLookupReport("on", SALT) });
      await handOver(h.engine, h.translators);
      await ready;
      await prepare(h);
      expect(h.compiled).toEqual(own.h.compiled);
      expect(h.modules).toEqual(own.h.modules);
    }
  });

  it("waits for its sources at most 500 ms: what has not arrived by then is not there, and a source that lands later is let go", async () => {
    expect(WGSL_SOURCES_MS).toBe(500);
    vi.useFakeTimers();
    const late = memorySource();
    let land: (sources: readonly WgslSource[]) => void = () => undefined;
    const h = harness();
    const ready = lookUpShaders(h.engine, { mode: "on", salt: SALT, sources: () => new Promise((r) => (land = r)), report: newLookupReport("on", SALT) });
    let done = false;
    void ready.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    land([late.source]);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.events).toEqual(["close"]);
    // A source in, whose entries are still arriving: waited for within the
    // same 500 ms, then asked for what it has.
    const slow: WgslSource = { ...memorySource().source, ready: new Promise(() => undefined) };
    const partly = harness();
    const readyPartly = lookUpShaders(partly.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([slow]), report: newLookupReport("on", SALT) });
    let partlyDone = false;
    void readyPartly.then(() => (partlyDone = true));
    await vi.advanceTimersByTimeAsync(250);
    expect(partlyDone).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(partlyDone).toBe(true);

    // A source whose read fails does not end the wait for the others: each is
    // still waited for by its own bound.
    const refused = Promise.reject(new Error("refused"));
    refused.catch(() => undefined);
    const failing: WgslSource = { ...memorySource({}, "failing").source, ready: refused };
    const patient: WgslSource = { ...memorySource().source, ready: new Promise(() => undefined), waitMs: 1_000 };
    const mixed = harness();
    const readyMixed = lookUpShaders(mixed.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([failing, patient]), report: newLookupReport("on", SALT) });
    let mixedDone = false;
    void readyMixed.then(() => (mixedDone = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(mixedDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(mixedDone).toBe(true);

    // A source with a bound of its own is waited for by it, the others by
    // theirs: the map's 1 s beside a store that never answers.
    const own: WgslSource = { ...memorySource().source, ready: new Promise(() => undefined), waitMs: 1_000 };
    const store: WgslSource = { ...memorySource({}, "store").source, ready: new Promise(() => undefined) };
    const both = harness();
    const readyBoth = lookUpShaders(both.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([own, store]), report: newLookupReport("on", SALT) });
    let bothDone = false;
    void readyBoth.then(() => (bothDone = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(bothDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(bothDone).toBe(true);
  });

  it("keeps what it translated for the engine's life, up to 32 MB of text: an effect made again minutes after the start finds its stages (the rain's)", async () => {
    expect(WGSL_KEPT_MAX_CHARS).toBe(33_554_432);
    vi.useFakeTimers();
    // A source that takes no writes, so that only the page's own kept
    // translations can spare a translation.
    const none: WgslSource = { name: "none", salt: SALT, get: () => null };
    const h = harness();
    const report = await lookUp(h, [none]);
    await prepare(h);
    await vi.advanceTimersByTimeAsync(600_000);
    const again = await prepare(h);
    expect(again.inTheCall).toEqual(["before", "after", "ready"]);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
    expect(report.hitsBySource).toEqual({ page: 2 });

    // Past the bound a translation is not kept, and is translated again when
    // asked again: here the bound holds the vertex stage's WGSL and no more.
    const small = harness();
    const vertexWgsl = `// WGSL of\n${translatorInput(VERTEX, DEFINES)}`;
    const ready = lookUpShaders(small.engine, {
      mode: "on",
      salt: SALT,
      sources: () => Promise.resolve([none]),
      report: newLookupReport("on", SALT),
      maxKeptChars: vertexWgsl.length,
    });
    await handOver(small.engine, small.translators);
    await ready;
    await prepare(small);
    expect(small.modules[0]).toBe(vertexWgsl);
    await prepare(small);
    expect(small.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment", "fragment"]);
  });

  it("notifies the compile observables on a hit as on a miss: once each, before the effect is ready", async () => {
    const { kept } = await translatedBy();
    const miss = harness();
    await lookUp(miss, []);
    const missed = await prepare(miss);
    const hit = harness();
    await lookUp(hit, [kept.source]);
    const found = await prepare(hit);
    const own = harness();
    await handOver(own.engine, own.translators);
    const babylon = await prepare(own);
    expect(missed.events).toEqual(["before", "after", "ready"]);
    expect(found.events).toEqual(missed.events);
    expect(babylon.events).toEqual(missed.events);
  });

  it("gives a translation that throws to the failure handling, as without the lookup", async () => {
    const h = harness();
    await lookUp(h, []);
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

  it("leaves a native WGSL effect and a raw GLSL one to Babylon, prepared in the call", async () => {
    const own = harness();
    const wgsl = await prepare(own, { language: 1, vertex: "// vertex wgsl", fragment: "// fragment wgsl" });
    const h = harness();
    const report = await lookUp(h, []);
    const looked = await prepare(h, { language: 1, vertex: "// vertex wgsl", fragment: "// fragment wgsl" });
    expect(h.modules).toEqual(own.modules);
    expect(looked.context.sources).toEqual(wgsl.context.sources);
    expect(looked.inTheCall).toEqual(["before", "after", "ready"]);

    const ownRaw = await babylons({ raw: true });
    const raw = harness();
    const rawReport = await lookUp(raw, []);
    const rawDone = await prepare(raw, { raw: true });
    expect(raw.compiled).toEqual(ownRaw.h.compiled);
    expect(raw.modules).toEqual(ownRaw.h.modules);
    expect(rawDone.inTheCall).toEqual(["ready"]);
    expect([report.hits, report.misses, rawReport.hits, rawReport.misses]).toEqual([0, 0, 0, 0]);
  });

  it("with ?wgsl=verify compares every stage with what Babylon's own path makes of the same effect, and counts the ones that differ", async () => {
    const { kept, first } = await translatedBy();
    kept.map.set(keyOf("fragment", FRAGMENT), "// a different WGSL");
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const h = harness();
    const report = await lookUp(h, [kept.source], "verify");
    await prepare(h);
    expect(report.differences).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    // It draws with what it found, and Babylon's check makes no module.
    expect(h.modules).toEqual([first.modules[0], "// a different WGSL"]);
    expect([report.hits, report.misses]).toEqual([2, 0]);

    // A text for glslang put together otherwise than Babylon's own path puts
    // it is a difference too, though the WGSL agrees with itself.
    const drifted = harness();
    const driftReport = await lookUp(drifted, [], "verify");
    const composeOwn = WebGPUEngine.prototype as unknown as { _compileShaderToSpirV(s: string, t: string, d: string, v: string): unknown };
    Object.assign(drifted.engine, {
      _compileShaderToSpirV: (source: string, type: string, defines: string, version: string) =>
        composeOwn._compileShaderToSpirV.call(drifted.engine, source, type, `${defines}\n#define DRIFT`, version),
    });
    await prepare(drifted);
    expect(driftReport.differences).toBe(2);
    expect(drifted.modules).toHaveLength(2);
  });

  it("with ?wgsl=record keeps every effect's stages, texts and times, one object for a measurement to read", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const shared = memorySource();
    const report = newLookupReport("record", SALT);
    const first = harness();
    await lookUp(first, [shared.source], "record", report);
    const processing = first.engine._getShaderProcessingContext(0, false) as object;
    await prepare(first, { processing });
    const second = harness();
    await lookUp(second, [shared.source], "record", report);
    await prepare(second);
    expect(Object.keys(report).sort()).toEqual([
      "differences",
      "download",
      "effects",
      "hits",
      "hitsBySource",
      "misses",
      "mode",
      "salt",
      "stagesWithCarriageReturns",
      "translateMs",
    ]);
    expect([report.mode, report.salt, report.hits, report.misses, report.differences]).toEqual(["record", SALT, 2, 2, 0]);
    expect(report.hitsBySource).toEqual({ memory: 2 });
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
      ["memory", 0, 0],
      ["memory", 0, 0],
    ]);
    // It reads whole as JSON.
    expect(JSON.parse(JSON.stringify(report)).effects[0].stages[1].wgsl).toBe(first.modules[1]);
  });

  it("with ?wgsl=record downloads the stages it prepared as a corpus file, the form the build translates ahead", async () => {
    const report = newLookupReport("record", SALT);
    const first = harness();
    await lookUp(first, [], "record", report);
    await prepare(first);
    // The same effect again, and one sharing its vertex stage: each stage once.
    const second = harness();
    await lookUp(second, [], "record", report);
    await prepare(second);
    await prepare(second, { fragment: `#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}` });
    const saved: Blob[] = [];
    const link = { href: "", download: "", click: vi.fn() };
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved.push(blob as Blob);
      return "blob:corpus";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("document", { createElement: () => link });
    report.download();
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.download).toMatch(/^dayhike-wgsl-corpus-\d+\.json$/);
    const text = await (saved[0] as Blob).text();
    expect(text).toBe(
      corpusText([
        { stage: "vertex", flag: false, glsl: translatorInput(VERTEX, DEFINES) },
        { stage: "fragment", flag: false, glsl: translatorInput(FRAGMENT, DEFINES) },
        { stage: "fragment", flag: true, glsl: translatorInput(`#define DISABLE_UNIFORMITY_ANALYSIS\n${FRAGMENT}`, DEFINES) },
      ]),
    );
    expect(readCorpus(text)).toHaveLength(3);
  });

  it("with ?wgsl=record counts the stages whose text carries a carriage return, and keys them as they are", async () => {
    const report = newLookupReport("record", SALT);
    const h = harness();
    await lookUp(h, [], "record", report);
    const windowsVertex = VERTEX.replaceAll("\n", "\r\n");
    await prepare(h, { vertex: windowsVertex });
    await prepare(h, { vertex: windowsVertex, fragment: FRAGMENT.replaceAll("\n", "\r\n") });
    await prepare(h);
    expect(report.stagesWithCarriageReturns).toBe(3);
    // The key is the hash of the exact text, carriage returns and all.
    expect(report.effects[0]?.stages[0]?.key).toBe(keyOf("vertex", windowsVertex));
    expect(report.effects[0]?.stages[0]?.glsl).toBe(translatorInput(windowsVertex, DEFINES));
    // Without ?wgsl=record, nothing is kept and nothing counted.
    const plain = newLookupReport("on", SALT);
    const other = harness();
    await lookUp(other, [], "on", plain);
    await prepare(other, { vertex: windowsVertex });
    expect(plain.stagesWithCarriageReturns).toBe(0);
  });

  it("counts, but records no effect, without ?wgsl=record", async () => {
    const h = harness();
    const report = await lookUp(h, []);
    await prepare(h);
    expect([report.hits, report.misses, report.effects.length]).toEqual([0, 2, 0]);
  });

  it("puts the page's report on the page, the first engine's, as dayhikeWgsl", () => {
    vi.stubGlobal("dayhikeWgsl", undefined);
    const none = (): Promise<readonly WgslSource[]> => Promise.resolve([]);
    void lookUpShaders(harness().engine, { mode: "record", salt: SALT, sources: none });
    const made = (globalThis as { dayhikeWgsl?: ShaderLookupReport }).dayhikeWgsl;
    void lookUpShaders(harness().engine, { mode: "record", salt: SALT, sources: none });
    expect(made?.mode).toBe("record");
    expect((globalThis as { dayhikeWgsl?: unknown }).dayhikeWgsl).toBe(made);
  });

  it("with ?wgsl=off leaves the engine as Babylon made it", async () => {
    const h = harness();
    await lookUpShaders(h.engine, { mode: "off", salt: SALT, sources: () => Promise.resolve([]) });
    expect(Object.getOwnPropertyDescriptor(h.engine, "_preparePipelineContextAsync")).toBe(undefined);
    expect(Object.getOwnPropertyDescriptor(h.engine, "_getShaderProcessingContext")).toBe(undefined);
    expect(parseShaderLookup("?wgsl=off")).toBe("off");
    expect(parseShaderLookup("?tier=high&wgsl=record")).toBe("record");
    expect(parseShaderLookup("?wgsl=verify")).toBe("verify");
    expect(parseShaderLookup("")).toBe("on");
    expect(parseShaderLookup("?wgsl=OFF")).toBe("on");
  });

  it("lets its sources go when its engine is disposed, or when told to, once; and asks none after", async () => {
    for (const how of ["dispose", "told"] as const) {
      const shared = memorySource();
      const h = harness();
      Object.assign(h.engine, { onDisposeObservable: new Observable() });
      await lookUp(h, [shared.source]);
      await prepare(h);
      if (how === "dispose") h.engine.onDisposeObservable.notifyObservers(h.engine);
      else releaseShaderLookup(h.engine);
      releaseShaderLookup(h.engine);
      expect(shared.events, how).toEqual(["close"]);
      await prepare(h, { defines: "#define AFTER" });
      expect(shared.puts, how).toHaveLength(2);
    }
    // An engine that looked nothing up is left alone.
    expect(() => releaseShaderLookup(harness().engine)).not.toThrow();
  });

  it("lets its sources go when a start that failed part-way is disposed, though Babylon's dispose throws before it tells anyone", async () => {
    const shared = memorySource();
    const h = harness();
    // No dispose observable is ever notified: the release must come from
    // the disposal's own end.
    Object.assign(h.engine, {
      dispose: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'dispose')");
      },
    });
    await lookUp(h, [shared.source]);
    disposeHalfMade(h.engine);
    expect(shared.events).toEqual(["close"]);
    // Babylon's base dispose notifies its dispose observable only at the end,
    // after the effects, textures and scenes (a canary on the installed engine).
    const base = readFileSync(resolve("@babylonjs/core/Engines/abstractEngine.pure.js"), "utf8");
    const dispose = base.slice(base.indexOf("    dispose() {\n        this.releaseEffects();"), base.indexOf("        this.onDisposeObservable.clear();"));
    expect(dispose.indexOf("this.onDisposeObservable.notifyObservers(this);")).toBeGreaterThan(dispose.indexOf("this.scenes[0].dispose();"));
    expect(dispose.indexOf("this.scenes[0].dispose();")).toBeGreaterThan(0);
  });

  it("finds, minutes after the start, a stored stage the start used and one the hike had not asked for, in the call", async () => {
    const idb = memoryIndexedDb();
    const fromStore = (): Promise<readonly WgslSource[]> => loadWgslStore(SALT, { idb: idb.factory }).then((s) => (s === null ? [] : [s]));
    const lampOn = `${FRAGMENT}\n// the headlamp on`;
    // A first load that met the start's effect and the lamp's.
    const first = harness();
    const readyFirst = lookUpShaders(first.engine, { mode: "on", salt: SALT, sources: fromStore, report: newLookupReport("on", SALT) });
    await handOver(first.engine, first.translators);
    await readyFirst;
    await prepare(first);
    await prepare(first, { fragment: lampOn });
    await vi.waitFor(() => expect(idb.databases.get(wgslStoreName(SALT))?.get("meta")?.size).toBe(3), { timeout: timeLimit(5_000) });
    // The next load, its store read in, then the hike's own clock.
    const [store] = await fromStore();
    await store?.ready;
    vi.useFakeTimers();
    const second = harness();
    await lookUp(second, store === undefined ? [] : [store]);
    await prepare(second);
    expect(second.compiled).toEqual([]);
    await vi.advanceTimersByTimeAsync(600_000);
    // The lamp on: its fragment stage, never asked for, and its vertex stage,
    // the start's, are both found in the call.
    const lamp = await prepare(second, { fragment: lampOn });
    expect(lamp.inTheCall).toEqual(["before", "after", "ready"]);
    // The start's effect made again (the rain's case): found.
    await prepare(second);
    expect(second.compiled).toEqual([]);
  });

  it("keeps a translation in the browser's store, and the next engine finds it there, in the call", async () => {
    const idb = memoryIndexedDb();
    const first = harness();
    let store: WgslSource | null = null;
    const ready = lookUpShaders(first.engine, {
      mode: "on",
      salt: SALT,
      sources: async () => {
        store = await loadWgslStore(SALT, { idb: idb.factory });
        return store === null ? [] : [store];
      },
      report: newLookupReport("on", SALT),
    });
    await handOver(first.engine, first.translators);
    await ready;
    await prepare(first);
    const stored = (): number => idb.databases.values().next().value?.get("meta")?.size ?? 0;
    await vi.waitFor(() => expect(stored()).toBe(2), { timeout: timeLimit(5_000) });
    const second = harness();
    const report = newLookupReport("on", SALT);
    const readyAgain = lookUpShaders(second.engine, {
      mode: "on",
      salt: SALT,
      sources: () => loadWgslStore(SALT, { idb: idb.factory }).then((s) => (s === null ? [] : [s])),
      report,
    });
    await handOver(second.engine, second.translators);
    await readyAgain;
    const { inTheCall } = await prepare(second);
    expect(inTheCall).toEqual(["before", "after", "ready"]);
    expect(second.compiled).toEqual([]);
    expect(second.modules).toEqual(first.modules);
    expect(report.hitsBySource).toEqual({ store: 2 });
    expect(store).not.toBe(null);
  });
});

/**
 * The map of translations the build ships (`wgslMap.ts`), the lookup's first
 * source: fetched while the engine is made, read into memory within the
 * lookup's bound, never a failure the player sees.
 */
describe("the translations shipped with the build", () => {
  const MAP_URL = "/dayhike/assets/wgsl-map-Ab12Cd34.json";
  /** A response with `body`, read with promises alone, so that fake timers
   * hold nothing of it back. */
  const response = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
    ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: () => Promise.resolve(body) }) as Response;
  /** `fetch` answering every request with `body`. */
  function serving(body: string, status = 200) {
    const answer = (() => Promise.resolve(response(body, status))) as unknown as typeof fetch;
    return { answer };
  }
  /** The map of `entries` for this build, as the lookup's source. */
  const shipped = (entries: ReadonlyMap<string, string>, salt = SALT): WgslSource =>
    loadWgslMap(MAP_URL, SALT, { fetch: serving(mapText(salt, entries)).answer });

  it("finds a stage in the map, in the call, and counts it under its own name; it takes no writes", async () => {
    const { kept, first } = await translatedBy();
    const map = shipped(kept.map);
    expect([map.name, WGSL_MAP_SOURCE, map.put]).toEqual(["shipped", "shipped", undefined]);
    const h = harness();
    const report = await lookUp(h, [map]);
    const { inTheCall } = await prepare(h);
    expect(inTheCall).toEqual(["before", "after", "ready"]);
    expect(h.compiled).toEqual([]);
    expect(h.modules).toEqual(first.modules);
    expect(report.hitsBySource).toEqual({ shipped: 2 });
  });

  it("is asked before the store: a stage both have is the map's; one only the store has is the store's", async () => {
    const { kept, first } = await translatedBy();
    const vertexKey = keyOf("vertex", VERTEX);
    const fragmentKey = keyOf("fragment", FRAGMENT);
    const map = shipped(new Map([[vertexKey, kept.map.get(vertexKey) as string]]));
    const store = memorySource({ [vertexKey]: "// the store's vertex", [fragmentKey]: kept.map.get(fragmentKey) as string }, "store");
    const h = harness();
    const report = await lookUp(h, [map, store.source], "record");
    await prepare(h);
    expect(h.compiled).toEqual([]);
    expect(h.modules).toEqual(first.modules);
    expect(report.effects[0]?.stages.map((s) => s.from)).toEqual(["shipped", "store"]);
    expect(report.hitsBySource).toEqual({ shipped: 1, store: 1 });

    // By default: the map at the URL the build gives, then the store.
    vi.stubGlobal("fetch", serving(mapText(SALT, kept.map)).answer);
    const sources = await defaultSources(SALT, MAP_URL);
    expect(sources.map((source) => source.name)).toEqual(["shipped", "store"]);
    expect((await defaultSources(SALT)).map((source) => source.name)).toEqual(["store"]);
    for (const source of sources) source.close?.();
  });

  it("is a source with nothing in it when the map does not come, is another build's or format's, or does not parse: every stage translated, nothing thrown", async () => {
    const { kept } = await translatedBy();
    const text = mapText(SALT, kept.map);
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const cases: [string, typeof fetch][] = [
      ["a refused fetch", (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch],
      ["an HTTP error", serving("not found", 404).answer],
      ["another build's map", serving(mapText(`${SALT}x`, kept.map)).answer],
      ["another format", serving(text.replace('"dayhike-wgsl-map/1"', '"dayhike-wgsl-map/2"')).answer],
      ["the site's page, not a map", serving("<!doctype html><title>Day Hike</title>").answer],
    ];
    for (const [what, answer] of cases) {
      warn.mockClear();
      const h = harness();
      const report = await lookUp(h, [loadWgslMap(MAP_URL, SALT, { fetch: answer })]);
      const { inTheCall } = await prepare(h);
      expect(inTheCall, what).toEqual(["before", "after", "ready"]);
      expect(h.compiled.map(([stage]) => stage), what).toEqual(["vertex", "fragment"]);
      expect([report.hits, report.misses], what).toEqual([0, 2]);
      expect(warn, what).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0]), what).toMatch(/^WebGPU shader lookup: no translations shipped with the build \(/);
    }
  });

  it("is waited for 1 s at most, by its own bound, when its fetch never answers; is found from when it lands; is aborted when the engine is let go", async () => {
    expect(WGSL_MAP_MS).toBe(1_000);
    const { kept } = await translatedBy({ fragment: `${FRAGMENT}\n// the lamp on` });
    vi.useFakeTimers();
    let land: (response: Response) => void = () => undefined;
    const signals: AbortSignal[] = [];
    const slow = ((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve) => (land = resolve));
    }) as unknown as typeof fetch;
    const h = harness();
    const report = newLookupReport("on", SALT);
    const ready = lookUpShaders(h.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([loadWgslMap(MAP_URL, SALT, { fetch: slow })]), report });
    await handOver(h.engine, h.translators);
    let done = false;
    void ready.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    // Not there yet: translated in the call.
    const early = await prepare(h);
    expect(early.inTheCall).toEqual(["before", "after", "ready"]);
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
    // Landed: found from then on.
    land(response(mapText(SALT, kept.map)));
    await vi.advanceTimersByTimeAsync(0);
    await prepare(h, { fragment: `${FRAGMENT}\n// the lamp on` });
    expect(h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment"]);
    expect(report.hitsBySource).toEqual({ page: 1, shipped: 1 });

    // A fetch still under way when the engine is let go is aborted.
    const other = harness();
    const signalsBefore = signals.length;
    const readyOther = lookUpShaders(other.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([loadWgslMap(MAP_URL, SALT, { fetch: slow })]), report });
    await vi.advanceTimersByTimeAsync(1_000);
    await readyOther;
    releaseShaderLookup(other.engine);
    expect(signals.slice(signalsBefore).map((signal) => signal.aborted)).toEqual([true]);
  });

  it("refuses a map whose Content-Length is over the 32 MiB ceiling, before reading its body: a source with nothing in it", async () => {
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    let read = 0;
    const big = (() =>
      Promise.resolve({
        ...response(mapText(SALT, new Map([["aa", "// a"]])), 200, { "content-length": "33554433" }),
        text: () => {
          read += 1;
          return Promise.resolve(mapText(SALT, new Map([["aa", "// a"]])));
        },
      } as Response)) as unknown as typeof fetch;
    const map = loadWgslMap(MAP_URL, SALT, { fetch: big });
    await map.ready;
    expect([map.get("aa"), read]).toEqual([null, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      `WebGPU shader lookup: no translations shipped with the build (${MAP_URL}: 33554433 bytes, over the map's ceiling of 33554432)`,
    );
    // At the ceiling, read.
    const atCeiling = loadWgslMap(MAP_URL, SALT, {
      fetch: (() => Promise.resolve(response(mapText(SALT, new Map([["aa", "// a"]])), 200, { "content-length": "33554432" }))) as unknown as typeof fetch,
    });
    await atCeiling.ready;
    expect(atCeiling.get("aa")).toBe("// a");
  });

  /** A body read a part at a time, only as it is asked for; `hang` keeps it
   * from ever ending after its parts. What was pulled, and whether it was
   * cancelled. */
  function streamOf(parts: Uint8Array[], hang = false) {
    const seen = { pulled: 0, cancelled: false };
    let next = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (next < parts.length) {
            seen.pulled += 1;
            controller.enqueue(parts[next++] as Uint8Array);
            return undefined;
          }
          if (hang) return new Promise<void>(() => undefined);
          controller.close();
          return undefined;
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { body, seen };
  }
  /** A map of one entry, padded with white space to `bytes`. */
  const padded = (bytes: number): string => {
    const text = mapText(SALT, new Map([["aa", "// a"]]));
    return text + " ".repeat(bytes - text.length);
  };
  const MIB = new Uint8Array(1_048_576).fill(0x20);
  const CEILING_REFUSED = `WebGPU shader lookup: no translations shipped with the build (${MAP_URL}: past the map's ceiling of 33554432 bytes as it was read)`;
  /** `fetch` answering with `body` and `headers`, counting the reads of its text. */
  function answering(body: ReadableStream<Uint8Array> | null, headers: Record<string, string>, text: string) {
    const reads = { text: 0 };
    const answer = (() =>
      Promise.resolve({
        ...response("", 200, headers),
        body,
        text: () => {
          reads.text += 1;
          return Promise.resolve(text);
        },
      } as Response)) as unknown as typeof fetch;
    return { answer, reads };
  }

  it("refuses a body that reads past the 32 MiB ceiling though its Content-Length says less, and stops reading it: never parsed", async () => {
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    for (const headers of [{ "content-length": "1000" }, {}] as Record<string, string>[]) {
      warn.mockClear();
      // One shared mebibyte, forty times: the reading stops at the 33rd.
      const { body, seen } = streamOf(Array.from({ length: 40 }, () => MIB));
      const { answer, reads } = answering(body, headers, padded(1_000));
      const map = loadWgslMap(MAP_URL, SALT, { fetch: answer });
      await map.ready;
      expect([map.get("aa"), reads.text, seen.pulled, seen.cancelled]).toEqual([null, 0, 33, true]);
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([CEILING_REFUSED]);
    }
  });

  it("reads a body of exactly the ceiling through its stream, and finds its entries", async () => {
    // The map, then white space from the one shared mebibyte to exactly
    // 33,554,432 bytes: 31 of it whole, and what is left of the last.
    const head = new TextEncoder().encode(mapText(SALT, new Map([["aa", "// a"]])));
    const parts = [head, ...Array.from({ length: 31 }, () => MIB), MIB.subarray(0, 1_048_576 - head.length)];
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(33_554_432);
    const { body, seen } = streamOf(parts);
    const { answer, reads } = answering(body, {}, "");
    const map = loadWgslMap(MAP_URL, SALT, { fetch: answer });
    await map.ready;
    expect([map.get("aa"), reads.text, seen.pulled]).toEqual(["// a", 0, 33]);
  });

  it("decodes a character its body's parts split, whole: three bytes split two and one, four split two and two", async () => {
    const wgsl = "// € for the euro, 𝄞 for the clef\n@fragment fn main() {}";
    const text = mapText(SALT, new Map([["aa", wgsl]]));
    const bytes = new TextEncoder().encode(text);
    const euro = bytes.indexOf(0xe2);
    const clef = bytes.indexOf(0xf0);
    expect([bytes[euro + 1], bytes[euro + 2], bytes[clef + 1], bytes[clef + 2], bytes[clef + 3]]).toEqual([0x82, 0xac, 0x9d, 0x84, 0x9e]);
    const parts = [bytes.subarray(0, euro + 2), bytes.subarray(euro + 2, clef + 2), bytes.subarray(clef + 2)];
    const { body, seen } = streamOf(parts);
    const map = loadWgslMap(MAP_URL, SALT, { fetch: answering(body, {}, "").answer });
    await map.ready;
    expect(seen.pulled).toBe(3);
    expect(map.get("aa")).toBe(wgsl);

    // A body that ends inside a character is not read as though the
    // character were not there: its last bytes decode to a replacement, and
    // the map, no longer one, is refused.
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const cut = new Uint8Array([...new TextEncoder().encode(text), 0xe2, 0x82]);
    const truncated = streamOf([cut.subarray(0, cut.length - 1), cut.subarray(cut.length - 1)]);
    const refused = loadWgslMap(MAP_URL, SALT, { fetch: answering(truncated.body, {}, "").answer });
    await refused.ready;
    expect(refused.get("aa")).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0]).startsWith("WebGPU shader lookup: no translations shipped with the build (")).toBe(true);
  });

  it("with no stream to read, refuses a text past the ceiling by its length, before it is parsed", async () => {
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const over = loadWgslMap(MAP_URL, SALT, { fetch: answering(null, {}, padded(33_554_433)).answer });
    await over.ready;
    expect(over.get("aa")).toBe(null);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([CEILING_REFUSED]);
    const at = loadWgslMap(MAP_URL, SALT, { fetch: answering(null, {}, padded(33_554_432)).answer });
    await at.ready;
    expect(at.get("aa")).toBe("// a");
  });

  it("while its body is being read, is still waited for 1 s at most, and its reading is stopped when the engine is let go", async () => {
    vi.useFakeTimers();
    const { body, seen } = streamOf([MIB], true);
    const signals: AbortSignal[] = [];
    const reading = ((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve({ ...response("", 200, {}), body, text: () => new Promise<string>(() => undefined) } as Response);
    }) as unknown as typeof fetch;
    const h = harness();
    const ready = lookUpShaders(h.engine, {
      mode: "on",
      salt: SALT,
      sources: () => Promise.resolve([loadWgslMap(MAP_URL, SALT, { fetch: reading })]),
      report: newLookupReport("on", SALT),
    });
    let done = false;
    void ready.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    releaseShaderLookup(h.engine);
    await vi.advanceTimersByTimeAsync(0);
    expect([signals.map((signal) => signal.aborted), seen.cancelled]).toEqual([[true], true]);
  });

  it("holds what it read for the engine's life, asked for or not, and lets it all go when closed", async () => {
    const map = shipped(
      new Map([
        ["aa", "// a"],
        ["bb", "// b"],
      ]),
    );
    await map.ready;
    expect([map.get("aa"), map.get("aa"), map.get("cc"), map.get("bb")]).toEqual(["// a", "// a", null, "// b"]);
    const closing = shipped(new Map([["aa", "// a"]]));
    await closing.ready;
    closing.close?.();
    expect(closing.get("aa")).toBe(null);
  });

  it("with ?wgsl=verify counts a map entry that differs by one byte from what the page translates", async () => {
    const { kept, first } = await translatedBy();
    const fragmentKey = keyOf("fragment", FRAGMENT);
    const altered = new Map(kept.map);
    const wgsl = kept.map.get(fragmentKey) as string;
    altered.set(fragmentKey, `${wgsl.slice(0, -1)}${wgsl.endsWith("x") ? "y" : "x"}`);
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const h = harness();
    const report = await lookUp(h, [shipped(altered)], "verify");
    await prepare(h);
    expect(report.hitsBySource).toEqual({ shipped: 2 });
    expect(report.differences).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.modules).toEqual([first.modules[0], altered.get(fragmentKey)]);
    // The map as the build made it: no difference.
    const same = harness();
    const sameReport = await lookUp(same, [shipped(kept.map)], "verify");
    await prepare(same);
    expect([sameReport.hitsBySource, sameReport.differences]).toEqual([{ shipped: 2 }, 0]);
  });
});

/**
 * The browser's store opens a database before it has anything; the lookup
 * holds it from the start (`openingSource`), so its opening never holds back
 * the map shipped beside it.
 */
describe("a source still opening", () => {
  it("does not hold back the sources beside it; one that opens after 500 ms is let go as it lands and never asked", async () => {
    const { kept } = await translatedBy();
    vi.useFakeTimers();
    let open: (source: WgslSource | null) => void = () => undefined;
    const late = memorySource(Object.fromEntries(kept.map), "store");
    const beside = memorySource(Object.fromEntries(kept.map), "beside");
    const h = harness();
    const report = newLookupReport("on", SALT);
    const opening = openingSource("store", SALT, new Promise((resolve) => (open = resolve)));
    const ready = lookUpShaders(h.engine, { mode: "on", salt: SALT, sources: () => Promise.resolve([opening, beside.source]), report });
    await handOver(h.engine, h.translators);
    let done = false;
    void ready.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await prepare(h);
    expect(report.hitsBySource).toEqual({ beside: 2 });
    open(late.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.events).toEqual(["close"]);
    await prepare(h, { defines: "#define LATER" });
    expect(late.puts).toEqual([]);
  });

  it("answers, keeps and closes as the source it opened to, once open within 500 ms", async () => {
    const { kept } = await translatedBy();
    const store = memorySource(Object.fromEntries(kept.map), "store");
    const opening = openingSource("store", SALT, Promise.resolve(store.source));
    const h = harness();
    const report = await lookUp(h, [opening]);
    await prepare(h);
    expect(report.hitsBySource).toEqual({ store: 2 });
    await prepare(h, { defines: "#define LATER" });
    expect(store.puts).toEqual([keyOf("vertex", VERTEX, "#define LATER"), keyOf("fragment", FRAGMENT, "#define LATER")]);
    releaseShaderLookup(h.engine);
    expect(store.events).toEqual(["close"]);
    // A store the browser refuses is none: nothing asked, nothing thrown.
    const none = openingSource("store", SALT, Promise.resolve(null));
    await none.ready;
    expect(none.get(keyOf("vertex", VERTEX))).toBe(null);
    expect(() => none.put?.("key", "// wgsl")).not.toThrow();
  });
});

/**
 * Babylon's own re-preparation of an effect whose mesh draws integer vertex
 * buffers (every skinned glTF model's joints), driven through Babylon's real
 * `Effect` and `checkNonFloatVertexBuffers` on an engine with Babylon's WebGPU
 * methods, its WebGPU GLSL processor and a stand-in device.
 */
describe("the re-preparation Babylon makes at the first draw of integer vertex buffers", () => {
  function effectEngine() {
    const h = harness();
    Object.assign(h.engine, {
      _shaderProcessor: new WebGPUShaderProcessorGLSL(),
      _shaderPlatformName: "WEBGPU",
      isNDCHalfZRange: true,
      _caps: { parallelShaderCompile: undefined, highPrecisionShaderSupported: true },
      _highPrecisionShadersAllowed: true,
      _features: { _checkNonFloatVertexBuffersDontRecreatePipelineContext: true },
      onReleaseEffectsObservable: new Observable(),
    });
    return h;
  }
  const SKINNED = {
    vertexSource: "attribute vec3 position;\nattribute vec4 matricesIndices;\nvoid main() { gl_Position = vec4(position + matricesIndices.xyz, 1.0); }",
    fragmentSource: "void main() { gl_FragColor = vec4(1.0); }",
  };
  const JOINTS = { matricesIndices: { type: VertexBuffer.UNSIGNED_BYTE, normalized: false } };

  async function drawSkinned(store: ReturnType<typeof memorySource>) {
    const h = effectEngine();
    await lookUp(h, [store.source]);
    const effect = (h.engine as unknown as { createEffect(...a: unknown[]): Effect }).createEffect(SKINNED, ["position", "matricesIndices"], [], [], "");
    const context = effect.getPipelineContext() as WebGPUPipelineContext;
    expect(effect.isReady()).toBe(true);
    const before = context.stages;
    checkNonFloatVertexBuffers(JOINTS as never, effect);
    // By the time Babylon's check returns, and Babylon builds the render
    // pipeline from the context's stages, they are the new ones.
    const after = context.stages as unknown as { vertexStage: { module: { code: string } } } | undefined;
    return { h, effect, context, before, after };
  }

  it("leaves the integer variant's stages on the same context before Babylon's call returns, on a miss and on a hit", async () => {
    const kept = memorySource();
    const missed = await drawSkinned(kept);
    expect(missed.effect.getPipelineContext()).toBe(missed.context);
    expect(missed.after).not.toBe(missed.before);
    expect(missed.after?.vertexStage.module.code).toContain("_int_matricesIndices_");
    // The integer variant's fragment stage is the first's: translated once.
    expect(missed.h.compiled.map(([stage]) => stage)).toEqual(["vertex", "fragment", "vertex"]);

    const hit = await drawSkinned(kept);
    expect(hit.after).not.toBe(hit.before);
    expect(hit.after?.vertexStage.module.code).toContain("_int_matricesIndices_");
    expect(hit.h.compiled).toEqual([]);
  });

  it("is made in the call, on the same context, and read from that context right after (canaries on the installed engine)", () => {
    const nonFloat = readFileSync(resolve("@babylonjs/core/Buffers/buffer.nonFloatVertexBuffers.js"), "utf8");
    expect(nonFloat).toContain("        // There is no additional call to async so the _processShaderCodeAsync will execute synchronously.");
    expect(nonFloat).toContain(
      "        effect._processShaderCodeAsync(null, engine._features._checkNonFloatVertexBuffersDontRecreatePipelineContext, shaderProcessingContext);",
    );
    const engine = readFileSync(resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(engine).toContain("            _checkNonFloatVertexBuffersDontRecreatePipelineContext: true,");
    const cache = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    const build = cache.slice(cache.indexOf("    _buildRenderPipelineDescriptor(effect, topology, sampleCount) {"));
    expect(build.indexOf("checkNonFloatVertexBuffers(this._vertexBuffers, effect);")).toBeGreaterThan(0);
    expect(build.indexOf("module: webgpuPipelineContext.stages.vertexStage.module,")).toBeGreaterThan(
      build.indexOf("checkNonFloatVertexBuffers(this._vertexBuffers, effect);"),
    );
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

  it("has its format changed with anything that decides what is stored for a key: the composed text, the translation, the packing", () => {
    const src = (file: string): string => readFileSync(new URL(`../../src/game/${file}`, import.meta.url), "utf8");
    const slice = (text: string, from: string, to: string): string => {
      const at = text.indexOf(from);
      const end = text.indexOf(to, at);
      expect(at, from).toBeGreaterThanOrEqual(0);
      expect(end, to).toBeGreaterThan(at);
      return text.slice(at, end);
    };
    const lookup = src("shaderLookup.ts");
    const stored = createHash("sha256")
      .update(slice(src("wgslFormat.ts"), "export function translatorInput(", "/** Whether a stage turns Tint"))
      .update(slice(lookup, "  const translate = (stage: StageRecord): string => {", "  // Deliberately `async` with no `await`"))
      .update(slice(src("wgslStore.ts"), "async function pack(", "/** What `pack` made"))
      .digest("hex");
    expect(
      [LOOKUP_FORMAT, stored],
      "what is stored for a key has changed: bump LOOKUP_FORMAT (so no entry made the old way is reachable), then update both here",
    ).toEqual(["dayhike-wgsl/1", "645d79bd3228be2ce3199bc10383bdf19c4687dd50dc16d9fd7896c525a008d6"]);
  });

  it("is salted with its format, Babylon's version, the shipped translators' digests (WebAssembly and loaders) and Babylon's page-wide switch", () => {
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
    // The build's digests are those of the translators it ships, their
    // WebAssembly and their loaders.
    const digest = (file: string): string => createHash("sha256").update(readFileSync(resolve(`@babylonjs/core/assets/${file}`))).digest("hex");
    expect(buildSalt()).toBe(
      "dayhike-wgsl/1|babylon=9.18.0" +
        `|glslang=${digest("glslang/glslang.wasm")}|twgsl=${digest("twgsl/twgsl.wasm")}` +
        `|glslang.js=${digest("glslang/glslang.js")}|twgsl.js=${digest("twgsl/twgsl.js")}` +
        "|staticUA=false",
    );
  });
});

describe("the lines of Babylon 9.18 the lookup copies or leans on (canaries on the installed engine)", () => {
  const engine = readFileSync(resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
  const between = (from: string, to: string): string => engine.slice(engine.indexOf(from), engine.indexOf(to, engine.indexOf(from)));

  it("keeps whole every body the lookup replaces, skips or calls, on Babylon 9.18.0: a line added anywhere in one turns this red", () => {
    // The lookup replaces the preparation whole for a GLSL effect, and so
    // skips Babylon's compile of its stages; it calls the composition, the
    // stage descriptor, and relies on readiness being the stages alone and
    // on the re-preparation for integer vertex buffers being synchronous.
    // Each body is pinned by the SHA-256 of its text in the installed
    // Babylon; on an upgrade, read each against the lookup before moving it.
    expect(AbstractEngine.Version).toBe("9.18.0");
    const digest = (text: string, from: string, to: string): string => {
      const at = text.indexOf(from);
      const end = text.indexOf(to, at);
      expect(at, from).toBeGreaterThanOrEqual(0);
      expect(end, to).toBeGreaterThan(at);
      return createHash("sha256").update(text.slice(at, end)).digest("hex");
    };
    const pipelineContext = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js"), "utf8");
    const nonFloat = readFileSync(resolve("@babylonjs/core/Buffers/buffer.nonFloatVertexBuffers.js"), "utf8");
    const effect = readFileSync(resolve("@babylonjs/core/Materials/effect.pure.js"), "utf8");
    const functions = readFileSync(resolve("@babylonjs/core/Materials/effect.functions.js"), "utf8");
    const cache = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    const tint = readFileSync(resolve("@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js"), "utf8");
    expect({
      prepare: digest(engine, "    async _preparePipelineContextAsync(", "    getAttributes(pipelineContext, attributesNames) {"),
      compile: digest(engine, "    _compilePipelineStageDescriptor(vertexCode, fragmentCode, defines, shaderLanguage) {", "    createRawShaderProgram() {"),
      descriptor: digest(
        engine,
        "    _createPipelineStageDescriptor(vertexShader, fragmentShader, shaderLanguage, disableUniformityAnalysisInVertex, disableUniformityAnalysisInFragment) {",
        "    _compileRawPipelineStageDescriptor(",
      ),
      spirv: digest(engine, "    _compileRawShaderToSpirV(source, type) {", "    _getWGSLShader("),
      isReady: digest(pipelineContext, "    get isReady() {", "    constructor("),
      nonFloat: digest(nonFloat, "export function checkNonFloatVertexBuffers(vertexBuffers, effect) {", "//# sourceMappingURL"),
      // The re-preparation's own path, which must await nothing but an
      // effect's extra initializations, hand the kept context on in the
      // order the lookup reads its arguments, and run `onReady`'s action
      // at once; the pipeline built from the stages after it; the second
      // translator's wrapper, whose output is what is stored.
      processShader: digest(effect, "    async _processShaderCodeAsync(", "    get key() {"),
      prepareEffect: digest(effect, "    _prepareEffect(keepExistingPipelineContext = false) {", "    _getShaderCodeAndErrorLine("),
      createAndPrepare: digest(functions, "export const createAndPreparePipelineContext = ", "\n};\n"),
      executeWhen: digest(engine, "    _executeWhenRenderingStateIsCompiled(pipelineContext, action) {", "    bindSamplers() { }"),
      buildDescriptor: digest(cache, "    _buildRenderPipelineDescriptor(effect, topology, sampleCount) {", "    _createRenderPipeline(effect, topology, sampleCount) {"),
      convert: digest(tint, "    convertSpirV2WGSL(code, disableUniformityAnalysis = false) {", "// Default twgsl options."),
    }).toEqual({
      prepare: "f6b14c32b327f76b854d92b44bddf902710f1f21af59250f802af90b07d5b7cc",
      compile: "10282feb3582d5a301b949b56caf7adbb5f16060a9df0ad571fe37940bdb5d2c",
      descriptor: "a46d9fc69b06155c9109d4c0f4d93c2c46afe72bc89824d4d74bc2cad3ffaf8f",
      spirv: "ad624ad5e9c1a22e684cd4a0184fbce8d93886c67a5f186913d707f5db1d388a",
      isReady: "dbaad8c15f9107fcd7051c84340a7712016c8467a5b5d54f99abebb904a02c3e",
      nonFloat: "983f3575d3dcfef9fef9bc5df97c25b5cc2aef45bca214f1ac15d98dd63824cb",
      processShader: "ffef4511a780eb609b0b6669b76adfcd8b73f7f2dcd63ea9dd18a2ed91a66c1a",
      prepareEffect: "d5035243305b6e77583434ad58d050a08ec45f48cd6137edd1d1bfaa76cc2f90",
      createAndPrepare: "17b881793f9e6661e7f62c9df908f0dd590b908d3ea3c927c632b7101ab0689a",
      executeWhen: "6e998642ec9026ff1d76360646eb3572a84bff9e3b2a50b5e234d4a4fe171eb5",
      buildDescriptor: "c6a0749d74bc90f81138236cec529421239fe9114216e40a8f1b190bf2e439e1",
      convert: "5b0a7e403ab678ed152330024c49c9b3e8cc5d897b1d944d1a7aacb11dc2e7df",
    });
    // What the readiness is: the stages alone.
    expect(pipelineContext).toContain("    get isReady() {\n        if (this.stages) {\n            return true;\n        }\n        return false;\n    }");
  });

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
