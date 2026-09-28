/**
 * The WebGPU shader lookup: every GLSL shader the engine would translate to
 * WGSL is looked up first, and translated only where it is not found.
 *
 * On WebGPU every material and plugin of this game is GLSL, and Babylon 9.18
 * translates each effect's two stages when the effect is prepared: the GLSL
 * to SPIR-V (glslang), then the SPIR-V to WGSL (Tint), both WebAssembly, both
 * synchronous on the page's thread. On a Windows machine with 4 virtual CPUs
 * that cost 0.7 to 2.0 s an effect, 39.8 s over a start's 61 preparations,
 * against about nothing for the shader modules and pipelines made from the
 * WGSL; and nothing of it was kept from one load to the next. The WGSL is a
 * pure function of the one text each stage hands the first translator, the
 * translators' own bytes and Babylon's own wrapping of them, so it is looked
 * up by a key over exactly those (`stageKey`, `lookupSalt`).
 *
 * `lookUpShaders` replaces the engine instance's `_preparePipelineContextAsync`
 * (Babylon's `Effect` looks it up there at every preparation) with one that,
 * for a GLSL effect that is not raw, builds the two texts Babylon would
 * translate and each stage's uniformity switch exactly as Babylon does, keys
 * them, asks its sources in order, translates only a stage none has (through
 * the engine's own methods, as Babylon does), keeps what it translated, and
 * makes the shader modules through Babylon's own stage-descriptor path with
 * the WGSL language, which skips Tint. The observables Babylon notifies
 * around a compile are notified around it, as the governor and the probe
 * listen to them. A translation that throws rejects the preparation as it
 * does today, so `catchTranslationFailures` still answers it. A native WGSL
 * effect is Babylon's own; so is a raw one, once the translators are there.
 *
 * The translators are started at the first stage not found, and when the
 * page is idle after the engine's first frame, by the function the engine's
 * maker passes (`gpuEngine.ts`: the game's own loader, never Babylon's, whose
 * promise has no rejection path). Translators that cannot be fetched for a
 * stage not found are the network's failure, not the shader's: the effect is
 * left unready and the page told (`unfetched`), never the failure handling
 * that remembers a broken engine. A stored WGSL the device refuses is
 * dropped and translated afresh, once. Its canaries are in
 * `shaderLookup.test.ts`.
 */
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { ShaderLookupMode } from "./engineChoice.js";
import { sha256Hex } from "./sha256.js";
import { openWgslStore } from "./wgslStore.js";

/** The format of the key; a change to how it is made changes this. */
export const LOOKUP_FORMAT = "dayhike-wgsl/1";

/** `ShaderLanguage.GLSL` and `ShaderLanguage.WGSL`. */
const GLSL = 0;
const WGSL = 1;

/** What Babylon 9.18 puts before a non-raw stage's defines and code
 * (`_compilePipelineStageDescriptor`, webgpuEngine.pure.js). */
const VERSION_PREFIX = "#version 450\n";
/** The define a stage turns Tint's uniformity analysis off with. */
const UNIFORMITY_OFF = "#define DISABLE_UNIFORMITY_ANALYSIS";

export type Stage = "vertex" | "fragment";

/** One source of WGSL: the browser's store (`wgslStore.ts`), and next, the
 * translations shipped with the build. */
export type WgslSource = {
  /** Whether it holds `key`, answered at once. */
  has(key: string): boolean;
  /** The WGSL under `key`, or null where it cannot be read. */
  get(key: string): Promise<string | null>;
  /** Keeps a stage just translated; a source that keeps nothing ignores it. */
  put(key: string, wgsl: string): void;
  /** Forgets `key`, whose WGSL the device refused. */
  drop(key: string): void;
  /** Lets go of what it holds open; it has nothing after. */
  close?(): void;
};

/** One stage as the recorder keeps it. */
export type StageRecord = {
  stage: Stage;
  key: string;
  /** The stage's uniformity switch (`uniformityOff`). */
  flag: boolean;
  /** Exactly what the first translator was, or would have been, handed. */
  glsl: string;
  wgsl: string;
  /** Where its WGSL came from: a source, or a translation now. */
  from: "source" | "translated";
  /** ms in the first translator, GLSL to SPIR-V; 0 for a stage found. */
  spirvMs: number;
  /** ms in the second, SPIR-V to WGSL; 0 for a stage found. */
  wgslMs: number;
};

/** One effect's preparation as the recorder keeps it. */
export type EffectRecord = {
  /** The effect's key, as Babylon names its pipeline context. */
  name: string;
  /** When the preparation began, on the page's clock (`performance.now`). */
  at: number;
  /** ms in Babylon's own processing of the effect's code, both stages: from
   * its processing context's making to this preparation. */
  processMs: number;
  /** ms making the effect's two shader modules. */
  moduleMs: number;
  stages: StageRecord[];
};

/**
 * What the lookup reports, one object for the page, on `globalThis` as
 * `dayhikeWgsl` for a measurement to read or `download()`. The counters are
 * always kept; the effects only with `?wgsl=record`.
 */
export type ShaderLookupReport = {
  mode: Exclude<ShaderLookupMode, "off">;
  salt: string;
  /** Stages whose WGSL was found in a source and used. */
  hits: number;
  /** Stages translated because no source had them (or had one the device
   * refused). */
  misses: number;
  /** ms translating on the page's thread, both translators, every stage
   * (`?wgsl=verify`'s checks included). */
  translateMs: number;
  /** Stored stages the device refused, dropped and translated afresh. */
  rejected: number;
  /** `?wgsl=verify`: stages found whose translation now differs. */
  differences: number;
  effects: EffectRecord[];
  /** Saves the report as a JSON file. */
  download(): void;
};

/** The salt: the key's format, Babylon's version (it owns the text around
 * the code and the diagnostic before the WGSL), the translators' own bytes'
 * digests (`__WGSL_TRANSLATORS__`, computed by the build), and Babylon's
 * page-wide uniformity switch, which no text shows. */
export function lookupSalt(parts: { babylon: string; translators: string; staticUniformityOff: boolean }): string {
  return `${LOOKUP_FORMAT}|babylon=${parts.babylon}|${parts.translators}|staticUA=${parts.staticUniformityOff}`;
}

/** The salt of this build, on the Babylon it runs. */
export function buildSalt(): string {
  return lookupSalt({
    babylon: AbstractEngine.Version,
    // Always defined by the build (`vite.config.ts`); a salt without it
    // would still key every stage, and `shaderLookup.test.ts` pins it.
    translators: typeof __WGSL_TRANSLATORS__ === "string" ? __WGSL_TRANSLATORS__ : "translators=unknown",
    staticUniformityOff: WebGPUTintWASM.DisableUniformityAnalysis,
  });
}

/** The text Babylon 9.18 hands the first translator for one stage of a
 * non-raw GLSL effect: `_compilePipelineStageDescriptor` passes its version
 * line to `_compileShaderToSpirV`, which puts it and the defines before the
 * code. */
export function translatorInput(code: string, defines: string | null): string {
  return VERSION_PREFIX + (defines ? defines + "\n" : "") + code;
}

/** Whether a stage turns Tint's uniformity analysis off, read as Babylon 9.18
 * reads it: from the processed code, not the defines. */
export function uniformityOff(code: string): boolean {
  return code.indexOf(UNIFORMITY_OFF) >= 0;
}

const encoder = new TextEncoder();
const SEPARATOR = new Uint8Array([0]);

/** A stage's key: SHA-256 over the salt, the stage, its uniformity switch and
 * the exact text the first translator is handed, each apart by a zero byte. */
export function stageKey(salt: string, stage: Stage, flag: boolean, glsl: string): string {
  return sha256Hex(
    encoder.encode(salt),
    SEPARATOR,
    encoder.encode(stage),
    SEPARATOR,
    encoder.encode(flag ? "1" : "0"),
    SEPARATOR,
    encoder.encode(glsl),
  );
}

/** A report for the page, empty, in `mode`. */
export function newLookupReport(mode: Exclude<ShaderLookupMode, "off">, salt: string): ShaderLookupReport {
  return {
    mode,
    salt,
    hits: 0,
    misses: 0,
    translateMs: 0,
    rejected: 0,
    differences: 0,
    effects: [],
    download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `dayhike-wgsl-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  };
}

/** The page's report, made by the first engine that looks shaders up. */
function pageReport(mode: Exclude<ShaderLookupMode, "off">, salt: string): ShaderLookupReport {
  const page = globalThis as { dayhikeWgsl?: ShaderLookupReport };
  page.dayhikeWgsl ??= newLookupReport(mode, salt);
  return page.dayhikeWgsl;
}

/** What the lookup uses of a WebGPU engine: Babylon 9.18's own members. */
type LookupEngine = {
  _preparePipelineContextAsync(pipelineContext: unknown, ...rest: unknown[]): Promise<void>;
  _getShaderProcessingContext(shaderLanguage: number, pureMode: boolean): object | null;
  _compileRawShaderToSpirV(source: string, type: string): unknown;
  _tintWASM: { convertSpirV2WGSL(code: unknown, disableUniformityAnalysis?: boolean): string } | null;
  _createPipelineStageDescriptor(vertex: string, fragment: string, shaderLanguage: number, uaVertex: boolean, uaFragment: boolean): unknown;
  _device: { pushErrorScope(filter: "validation"): void; popErrorScope(): Promise<unknown> };
  readonly isDisposed: boolean;
  onBeforeShaderCompilationObservable: { notifyObservers(engine: unknown): void };
  onAfterShaderCompilationObservable: { notifyObservers(engine: unknown): void };
  onEndFrameObservable?: { addOnce(callback: () => void): unknown };
  onDisposeObservable?: { addOnce(callback: () => void): unknown };
};

/** A WebGPU pipeline context, as the preparation fills it. */
type LookupContext = {
  shaderProcessingContext: { shaderLanguage: number };
  _name?: string;
  sources?: { fragment: string; vertex: string; rawVertex: string; rawFragment: string };
  stages?: unknown;
};

/** One stage under way. */
type Pending = StageRecord & { source: WgslSource | null };

/** A shader module, as far as its compilation messages. */
type ModuleLike = { getCompilationInfo?: () => Promise<{ messages: readonly { type: string }[] }> };

/** Of the stages `found` in a source, those whose module in `made` (Babylon's
 * stage descriptor) the device refused, by each module's compilation
 * messages; all of them where the messages do not say. */
async function refusedStages(found: Pending[], made: unknown): Promise<Pending[]> {
  const modules = made as { vertexStage: { module: ModuleLike }; fragmentStage: { module: ModuleLike } };
  const refused = await Promise.all(
    found.map(async (stage) => {
      const module = stage.stage === "vertex" ? modules.vertexStage.module : modules.fragmentStage.module;
      try {
        const info = await module.getCompilationInfo?.();
        return info?.messages.some((message) => message.type === "error") ?? false;
      } catch {
        return false;
      }
    }),
  );
  const bad = found.filter((_, i) => refused[i]);
  return bad.length > 0 ? bad : found;
}

/** Runs `run` when the page is next idle, or soon where it cannot say. */
function whenIdle(run: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => unknown }).requestIdleCallback;
  if (typeof idle === "function") idle(run);
  else setTimeout(run, 0);
}

/** Per engine, what lets its lookup go (`releaseShaderLookup`). */
const releases = new WeakMap<AbstractEngine, () => void>();

/**
 * Lets `engine`'s lookup go: its sources closed (the browser's store's
 * database), and no source opened after. Once; called when the engine is
 * disposed, and callable where an engine is let go of without Babylon's
 * dispose running to its end (a start that failed part-way). An engine
 * without a lookup is left alone.
 */
export function releaseShaderLookup(engine: AbstractEngine): void {
  releases.get(engine)?.();
  releases.delete(engine);
}

/**
 * Looks up every GLSL shader `engine` prepares before translating it (see the
 * module's comment). `mode` `"off"` leaves the engine as Babylon made it.
 * `translators` starts the translators and hands them to the engine, or
 * rejects; a start that failed is tried again at the next stage not found.
 * Where it fails for a stage not found, that effect cannot be made: its
 * preparation ends there, unready and without an error (a network's failure
 * is not the shader's, so `catchTranslationFailures` never hears it), and
 * `unfetched` is called, once for the engine, for the page to let it go.
 * `sources` are asked in order: where none are given, the browser's store
 * for this build's salt, opened at the first shader, so an engine whose
 * start fails before one opens nothing. `report` counts and records (the
 * page's, where none is given). Install it before
 * `catchTranslationFailures`, which wraps whatever preparation it finds.
 */
export function lookUpShaders(
  engine: AbstractEngine,
  options: {
    mode: ShaderLookupMode;
    translators: () => Promise<void>;
    unfetched?: (error: unknown) => void;
    salt?: string;
    sources?: readonly WgslSource[] | Promise<readonly WgslSource[]>;
    report?: ShaderLookupReport;
  },
): ShaderLookupReport | null {
  const mode = options.mode;
  if (mode === "off") return null;
  const own = engine as unknown as LookupEngine;
  const salt = options.salt ?? buildSalt();
  const report = options.report ?? pageReport(mode, salt);

  let released = false;
  let opened: Promise<readonly WgslSource[]> | null = null;
  const sources = (): Promise<readonly WgslSource[]> => {
    if (released) return Promise.resolve([]);
    opened ??= Promise.resolve(options.sources ?? openWgslStore(salt).then((store) => (store === null ? [] : [store]))).catch(() => []);
    return opened;
  };
  const release = (): void => {
    if (released) return;
    released = true;
    void opened?.then((all) => {
      for (const source of all) source.close?.();
    });
  };
  releases.set(engine, release);
  own.onDisposeObservable?.addOnce(() => releaseShaderLookup(engine));

  let told = false;
  /** Whether the translators are there, started if need be; where they
   * cannot be, the page is told, once. */
  const haveTranslators = async (): Promise<boolean> => {
    try {
      await translatorsReady();
      return true;
    } catch (error) {
      if (!told) {
        told = true;
        Logger.Warn(`WebGPU shader lookup: the translators did not load for a shader not found: ${error instanceof Error ? error.message : String(error)}`);
        options.unfetched?.(error);
      }
      return false;
    }
  };

  let started: Promise<void> | null = null;
  const translatorsReady = (): Promise<void> => {
    if (started === null) {
      const attempt = options.translators();
      started = attempt;
      attempt.catch(() => {
        if (started === attempt) started = null;
      });
    }
    return started;
  };
  // A later stage not found should not wait on the network: the translators
  // are started once the page is idle after the first frame.
  own.onEndFrameObservable?.addOnce(() =>
    whenIdle(() => {
      if (!own.isDisposed) translatorsReady().catch(() => undefined);
    }),
  );

  // Where Babylon's own processing of an effect begins, for the recorder.
  const processingSince = new WeakMap<object, number>();
  if (mode === "record") {
    const processingContext = own._getShaderProcessingContext.bind(engine);
    own._getShaderProcessingContext = (shaderLanguage, pureMode) => {
      const made = processingContext(shaderLanguage, pureMode);
      if (made !== null) processingSince.set(made, performance.now());
      return made;
    };
  }

  const translate = (stage: Pending): string => {
    const from = performance.now();
    const spirv = own._compileRawShaderToSpirV(stage.glsl, stage.stage);
    const middle = performance.now();
    const tint = own._tintWASM;
    if (tint === null) throw new Error("WebGPU shader translation failed: the translators are not ready");
    const wgsl = tint.convertSpirV2WGSL(spirv, stage.flag);
    const to = performance.now();
    stage.spirvMs += middle - from;
    stage.wgslMs += to - middle;
    report.translateMs += to - from;
    return wgsl;
  };

  /** Translates `stage` now and offers it to every source to keep. */
  const translateAndKeep = (stage: Pending, kept: readonly WgslSource[]): void => {
    stage.wgsl = translate(stage);
    stage.from = "translated";
    stage.source = null;
    for (const source of kept) {
      try {
        source.put(stage.key, stage.wgsl);
      } catch {
        /* a source that cannot keep it keeps nothing */
      }
    }
  };

  const prepare = own._preparePipelineContextAsync.bind(engine);
  own._preparePipelineContextAsync = async (pipelineContext, ...rest) => {
    const context = pipelineContext as LookupContext;
    const [vertex, fragment, createAsRaw, rawVertex, rawFragment, , defines, , , onReady] = rest as [
      string,
      string,
      boolean,
      string,
      string,
      unknown,
      string | null,
      unknown,
      unknown,
      () => void,
    ];
    if (context.shaderProcessingContext.shaderLanguage !== GLSL) return prepare(pipelineContext, ...rest);
    if (createAsRaw) {
      // Babylon's own path, which would otherwise start its own translators.
      if (!(await haveTranslators())) return;
      return prepare(pipelineContext, ...rest);
    }

    const at = performance.now();
    const began = processingSince.get(context.shaderProcessingContext);
    const stages: Pending[] = (
      [
        ["vertex", vertex],
        ["fragment", fragment],
      ] as const
    ).map(([stage, code]) => {
      const glsl = translatorInput(code, defines);
      const flag = uniformityOff(code);
      return { stage, key: stageKey(salt, stage, flag, glsl), flag, glsl, wgsl: "", from: "source", spirvMs: 0, wgslMs: 0, source: null };
    });
    const asked = await sources();
    for (const stage of stages) {
      for (const source of asked) {
        if (!source.has(stage.key)) continue;
        const wgsl = await source.get(stage.key).catch(() => null);
        if (wgsl === null) continue;
        stage.wgsl = wgsl;
        stage.source = source;
        break;
      }
    }
    if ((stages.some((stage) => stage.source === null) || mode === "verify") && !(await haveTranslators())) return;
    if (own.isDisposed) return;

    context.sources = { fragment, vertex, rawVertex, rawFragment };
    own.onBeforeShaderCompilationObservable.notifyObservers(engine);
    for (const stage of stages) if (stage.source === null) translateAndKeep(stage, asked);
    if (mode === "verify") {
      for (const stage of stages.filter((s) => s.source !== null)) {
        const now = translate(stage);
        if (now !== stage.wgsl) {
          report.differences += 1;
          Logger.Warn(`WebGPU shader lookup: the ${stage.stage} stage ${stage.key} translates differently from what was found`);
        }
      }
    }
    const [vertexStage, fragmentStage] = stages as [Pending, Pending];
    const found = stages.filter((stage) => stage.source !== null);
    // A WGSL found is checked by the device before the effect uses it (Babylon
    // reads no module's compilation messages): an error scope around its
    // modules, so a refused one is an answer here, not an uncaptured error.
    const moduleFrom = performance.now();
    if (found.length > 0) own._device.pushErrorScope("validation");
    let made = own._createPipelineStageDescriptor(vertexStage.wgsl, fragmentStage.wgsl, WGSL, false, false);
    const refused = found.length > 0 ? own._device.popErrorScope() : null;
    let moduleMs = performance.now() - moduleFrom;
    own.onAfterShaderCompilationObservable.notifyObservers(engine);
    if (refused !== null && (await refused.catch(() => null)) !== null) {
      const bad = await refusedStages(found, made);
      report.rejected += bad.length;
      for (const stage of bad) stage.source?.drop(stage.key);
      if (!(await haveTranslators()) || own.isDisposed) return;
      own.onBeforeShaderCompilationObservable.notifyObservers(engine);
      for (const stage of bad) translateAndKeep(stage, asked);
      const again = performance.now();
      made = own._createPipelineStageDescriptor(vertexStage.wgsl, fragmentStage.wgsl, WGSL, false, false);
      moduleMs += performance.now() - again;
      own.onAfterShaderCompilationObservable.notifyObservers(engine);
    }
    if (own.isDisposed) return;
    context.stages = made;

    for (const stage of stages) {
      if (stage.from === "source") report.hits += 1;
      else report.misses += 1;
    }
    if (mode === "record") {
      report.effects.push({
        name: context._name ?? "",
        at,
        processMs: began === undefined ? 0 : at - began,
        moduleMs,
        stages: stages.map((s) => ({ stage: s.stage, key: s.key, flag: s.flag, glsl: s.glsl, wgsl: s.wgsl, from: s.from, spirvMs: s.spirvMs, wgslMs: s.wgslMs })),
      });
    }
    onReady();
  };
  return report;
}
