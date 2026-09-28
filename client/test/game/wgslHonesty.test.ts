import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.pure.js";
import { WebGPUPipelineContext } from "@babylonjs/core/Engines/WebGPU/webgpuPipelineContext.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { buildSalt, lookUpShaders, newLookupReport, type ShaderLookupReport, type WgslSource } from "../../src/game/shaderLookup.js";
import * as format from "../../src/game/wgslFormat.js";
import { loadWgslMap } from "../../src/game/wgslMap.js";
import { buildMap, nodeSalt, readCorpusDir } from "../../../tools/wgsl/lib/buildMap.mjs";
import { CORPUS_DIR } from "../../../tools/wgsl/lib/files.mjs";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The map the build ships is honest only if every entry is byte for byte what
 * the page would translate from the same text. Here the committed corpus is
 * translated twice with the real translators the client ships, both under
 * Node: by the build's tool, and by the page's own lookup through Babylon's
 * own engine methods (the translators handed to Babylon as the engine's maker
 * hands them, on a stand-in device that keeps each module's code). Whether a
 * browser's WebAssembly gives the same bytes as Node's is for a recorded page
 * to show (the design's §8); this holds the tool to the page.
 */

const VERSION = "#version 450\n";
/** A stage to pair a corpus stage with, so that each is prepared in an effect. */
const PARTNER = {
  vertex: "layout(location = 0) in vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }",
  fragment: "layout(location = 0) out vec4 glFragColor;\nvoid main() { glFragColor = vec4(1.0); }",
};

let translators: StartedTranslators;
beforeAll(async () => {
  translators = await startTranslators();
}, timeLimit(60_000));

// Babylon keeps the second translator page-wide (`WebGPUTintWASM._Twgsl`):
// every engine here, and the tool, are handed the same one.
afterEach(() => {
  vi.restoreAllMocks();
});

/** A WebGPU engine with Babylon's own methods on a stand-in device, the real
 * translators handed over, and the lookup installed with `sources`. */
async function page(sources: readonly WgslSource[], mode: "record" | "verify") {
  const modules: string[] = [];
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
  const report: ShaderLookupReport = newLookupReport(mode, buildSalt());
  const ready = lookUpShaders(engine, { mode, salt: buildSalt(), sources: () => Promise.resolve(sources), report });
  const own = engine as unknown as { _glslangOptions: unknown; _twgslOptions: unknown };
  own._glslangOptions = { glslang: Promise.resolve(translators.glslang) };
  own._twgslOptions = { twgsl: translators.twgsl };
  await engine.prepareGlslangAndTintAsync();
  await ready;
  /** Prepares an effect of two stages, each the text for the first translator. */
  const prepare = async (vertex: string, fragment: string): Promise<void> => {
    const context = new WebGPUPipelineContext({ shaderLanguage: 0 } as never, engine);
    const code = (glsl: string): string => {
      expect(glsl.startsWith(VERSION)).toBe(true);
      return glsl.slice(VERSION.length);
    };
    await (engine as unknown as { _preparePipelineContextAsync(...args: unknown[]): Promise<void> })._preparePipelineContextAsync(
      context,
      code(vertex),
      code(fragment),
      false,
      "",
      "",
      undefined,
      null,
      undefined,
      "",
      () => undefined,
    );
  };
  return { report, modules, prepare };
}

describe("the map the build ships, against the page's own translation", () => {
  it("keys every stage of the corpus as the page does, under the page's salt, and holds, for each, byte for byte the WGSL the page translates", async () => {
    const salt = nodeSalt(format);
    expect(salt).toBe(buildSalt());
    const { stages } = readCorpusDir(CORPUS_DIR, format);
    const made = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared: format });
    expect(made.failed).toEqual([]);
    const map = format.readMap(made.text, salt);
    expect(stages).toHaveLength(10);
    expect(map.size).toBe(10);

    // The page's own lookup, with no source: every stage translated in the page's way.
    const own = await page([], "record");
    for (const entry of stages) {
      // Its switch is read from its text, as the page reads it from the code.
      expect(format.uniformityOff(entry.glsl.slice(VERSION.length))).toBe(entry.flag);
      if (entry.stage === "vertex") await own.prepare(entry.glsl, VERSION + PARTNER.fragment);
      else await own.prepare(VERSION + PARTNER.vertex, entry.glsl);
    }
    const translatedByPage = new Map(own.report.effects.flatMap((effect) => effect.stages).map((stage) => [stage.key, stage.wgsl]));
    let compared = 0;
    for (const entry of stages) {
      const key = format.stageKey(salt, entry.stage, entry.flag, entry.glsl);
      expect(translatedByPage.has(key), `${entry.stage} ${format.corpusId(entry)}`).toBe(true);
      expect(map.get(key), `${entry.stage} ${format.corpusId(entry)}`).toBe(translatedByPage.get(key));
      compared += 1;
    }
    expect(compared).toBe(10);

  }, timeLimit(300_000));

  it("finds every stage in the map when the page is given it, and ?wgsl=verify counts an entry altered by one byte", async () => {
    const salt = nodeSalt(format);
    const { stages } = readCorpusDir(CORPUS_DIR, format);
    const vertex = stages.find((entry) => entry.stage === "vertex" && !entry.flag);
    const fragment = stages.find((entry) => entry.stage === "fragment");
    if (vertex === undefined || fragment === undefined) throw new Error("the corpus has no vertex stage or no fragment stage");
    const made = buildMap({ stages: [vertex, fragment], salt, translate: (entry) => translateStage(translators, entry), shared: format });
    const fragmentKey = format.stageKey(salt, fragment.stage, fragment.flag, fragment.glsl);
    const serve = (text: string): typeof fetch =>
      (() => Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: () => Promise.resolve(text) } as Response)) as unknown as typeof fetch;

    const shipped = await page([loadWgslMap("/dayhike/assets/wgsl-map-Ab12Cd34.json", salt, { fetch: serve(made.text) })], "verify");
    await shipped.prepare(vertex.glsl, fragment.glsl);
    expect([shipped.report.hits, shipped.report.misses, shipped.report.differences]).toEqual([2, 0, 0]);
    expect(shipped.report.hitsBySource).toEqual({ shipped: 2 });
    expect(shipped.modules).toEqual([made.entries.get(format.stageKey(salt, vertex.stage, vertex.flag, vertex.glsl)), made.entries.get(fragmentKey)]);

    const altered = new Map(made.entries);
    const wgsl = altered.get(fragmentKey) as string;
    altered.set(fragmentKey, `${wgsl.slice(0, -1)}${wgsl.endsWith(" ") ? "\t" : " "}`);
    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => undefined);
    const damaged = await page([loadWgslMap("/dayhike/assets/wgsl-map-Ab12Cd34.json", salt, { fetch: serve(format.mapText(salt, altered)) })], "verify");
    await damaged.prepare(vertex.glsl, fragment.glsl);
    expect(damaged.report.hitsBySource).toEqual({ shipped: 2 });
    expect(damaged.report.differences).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  }, timeLimit(300_000));
});
