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
 * effect is Babylon's own, and so is a raw one.
 *
 * **A preparation never waits.** Babylon's own preparation, once its
 * translators are loaded, runs to `onReady` in the call that asked for it,
 * and Babylon relies on that: at the first draw of a mesh with integer vertex
 * buffers (every skinned glTF model) it prepares the effect again on the same
 * pipeline context and builds the render pipeline from `stages` straight
 * after (`checkNonFloatVertexBuffers`, `buffer.nonFloatVertexBuffers.js`).
 * So every source answers from memory, read in while the engine is made
 * (`lookUpShaders`' promise, which the engine's maker waits for within
 * `WGSL_SOURCES_MS`); the translators are loaded before the engine is handed
 * over, so a stage not found is translated at once; and keeping a new
 * translation is never waited on. Its canaries are in `shaderLookup.test.ts`.
 */
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { ShaderLookupMode } from "./engineChoice.js";
import { sha256Hex } from "./sha256.js";
import { loadWgslStore } from "./wgslStore.js";

/** The format of the key and of what is stored under it. A change to how
 * the key is made, or to what is stored for a key (the text composed for the
 * first translator, `translatorInput`; the translation, `translate` in
 * `lookUpShaders`; the packing, `pack` in `wgslStore.ts`) bumps it, so that
 * no entry made the old way is reachable; `shaderLookup.test.ts` pins the
 * three by their text beside it. */
export const LOOKUP_FORMAT = "dayhike-wgsl/1";

/** How long the engine's maker waits for the sources to be read into memory,
 * opening and reading together (less where its start's budget leaves less):
 * a stage asked for before its entry has landed is a miss, translated; an
 * entry that lands later is found from then on. The device's request runs
 * meanwhile. */
export const WGSL_SOURCES_MS = 2_000;
/** The start settles once no preparation has come for this long… */
export const WGSL_HOLD_QUIET_MS = 30_000;
/** …or this long after the engine stood, whichever comes first. The WGSL the
 * start used is then let go, the page's own translations and each source's
 * entries that were asked for; a source keeps those not asked for yet. A
 * stage asked for again after that is translated, the translators being
 * loaded. */
export const WGSL_HOLD_MAX_MS = 120_000;

/** `ShaderLanguage.GLSL` and `ShaderLanguage.WGSL`. */
const GLSL = 0;
const WGSL = 1;

/** What Babylon 9.18 puts before a non-raw stage's defines and code
 * (`_compilePipelineStageDescriptor`, webgpuEngine.pure.js). */
const VERSION_PREFIX = "#version 450\n";
/** The define a stage turns Tint's uniformity analysis off with. */
const UNIFORMITY_OFF = "#define DISABLE_UNIFORMITY_ANALYSIS";

/** The name under which the report counts the stages found among those this
 * page itself translated while the start's WGSL was held. */
const PAGE = "page";

export type Stage = "vertex" | "fragment";

/**
 * One source of WGSL: the browser's store (`wgslStore.ts`), and next, the
 * translations shipped with the build. Every answer comes from memory, at
 * once: a preparation never waits (see the module's comment).
 */
export type WgslSource = {
  /** How the report names it (`hitsBySource`, `StageRecord.from`). */
  readonly name: string;
  /** The salt its entries were made under: a source of another salt is never
   * asked (a map shipped with another build, say). */
  readonly salt: string;
  /** The WGSL under `key`, from memory, or null. */
  get(key: string): string | null;
  /** Keeps a stage just translated, later, never waited on (the page's own
   * map spares a second translation meanwhile). Absent on a source that
   * takes no writes (a map shipped with the build). */
  put?(key: string, wgsl: string): void;
  /** Resolves once its entries are in memory. The engine's maker waits for
   * it within its bound; an entry that lands after the engine is handed over
   * is found from then on. Absent: in memory from the start. */
  readonly ready?: Promise<void>;
  /** The start has settled: lets go of the WGSL it held and was asked for,
   * keeping what has not been asked for yet; the keys may stay. */
  settle?(): void;
  /** Lets go of everything it holds, connections included. */
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
  /** Where its WGSL came from: the name of the source that had it, or
   * `translated`. */
  from: string;
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
  /** Stages whose WGSL was found and used. */
  hits: number;
  /** The same, by the name of the source that had it (`page` for a stage
   * this page translated earlier in the start). */
  hitsBySource: Record<string, number>;
  /** Stages translated because nothing had them. */
  misses: number;
  /** ms translating on the page's thread, both translators, every stage
   * (`?wgsl=verify`'s own translations not included). */
  translateMs: number;
  /** `?wgsl=verify`: stages whose text for the first translator, or whose
   * WGSL, differs from what Babylon's own path makes of the same effect. */
  differences: number;
  effects: EffectRecord[];
  /** Saves the report as a JSON file. */
  download(): void;
};

/** The salt: the key's format, Babylon's version (it owns the text around
 * the code and the diagnostic before the WGSL), the translators' own bytes'
 * digests, their WebAssembly and their loaders (`__WGSL_TRANSLATORS__`,
 * computed by the build), and Babylon's page-wide uniformity switch, which
 * no text shows. */
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
    hitsBySource: {},
    misses: 0,
    translateMs: 0,
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

/** The browser's store for `salt`, as the lookup's one source by default. */
export function defaultSources(salt: string): Promise<readonly WgslSource[]> {
  return loadWgslStore(salt).then((store) => (store === null ? [] : [store]));
}

/** What the lookup uses of a WebGPU engine: Babylon 9.18's own members. */
type LookupEngine = {
  _preparePipelineContextAsync(pipelineContext: unknown, ...rest: unknown[]): Promise<void>;
  _getShaderProcessingContext(shaderLanguage: number, pureMode: boolean): object | null;
  _compileRawShaderToSpirV(source: string, type: string): unknown;
  _tintWASM: { convertSpirV2WGSL(code: unknown, disableUniformityAnalysis?: boolean): string } | null;
  _createPipelineStageDescriptor(vertex: string, fragment: string, shaderLanguage: number, uaVertex: boolean, uaFragment: boolean): unknown;
  _device: { createShaderModule(descriptor: { code: string }): unknown };
  onBeforeShaderCompilationObservable: { notifyObservers(engine: unknown): void };
  onAfterShaderCompilationObservable: { notifyObservers(engine: unknown): void };
  onDisposeObservable?: { addOnce(callback: () => void): unknown };
};

/** A WebGPU pipeline context, as the preparation fills it. */
type LookupContext = {
  shaderProcessingContext: { shaderLanguage: number };
  _name?: string;
  sources?: { fragment: string; vertex: string; rawVertex: string; rawFragment: string };
  stages?: unknown;
};

/** Per engine, what lets its lookup go (`releaseShaderLookup`). */
const releases = new WeakMap<AbstractEngine, () => void>();

/**
 * Lets `engine`'s lookup go: its sources closed (the browser's store's
 * database), its timers cleared, and any source that arrives later closed as
 * it lands. Once; called when the engine is disposed, and by
 * `disposeHalfMade`, where Babylon's dispose never gets as far as telling
 * anyone. An engine without a lookup is left alone.
 */
export function releaseShaderLookup(engine: AbstractEngine): void {
  releases.get(engine)?.();
  releases.delete(engine);
}

/** `promise`, or null once `ms` pass first. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A property of `target` replaced for one call, and put back as it was
 * (its own, or its prototype's). */
function during<T extends object, K extends keyof T>(target: T, key: K, value: T[K], run: () => void): void {
  const own = Object.prototype.hasOwnProperty.call(target, key);
  const before = target[key];
  target[key] = value;
  try {
    run();
  } finally {
    if (own) target[key] = before;
    else Reflect.deleteProperty(target, key);
  }
}

/**
 * Looks up every GLSL shader `engine` prepares before translating it (see the
 * module's comment). `mode` `"off"` leaves the engine as Babylon made it.
 * Resolves once its sources (`sources`, the browser's store by default) are
 * in memory, or `WGSL_SOURCES_MS` has passed, whichever comes first, never
 * rejecting; the engine's maker waits for it before handing the engine over,
 * and the translators must be loaded by then too. From then the WGSL held
 * for the start is let go after `WGSL_HOLD_QUIET_MS` without a preparation,
 * or `WGSL_HOLD_MAX_MS`. `report` counts and records (the page's, where none
 * is given). Install it before `catchTranslationFailures`, which wraps
 * whatever preparation it finds.
 */
export function lookUpShaders(
  engine: AbstractEngine,
  options: {
    mode: ShaderLookupMode;
    salt?: string;
    sources?: (salt: string) => Promise<readonly WgslSource[]>;
    report?: ShaderLookupReport;
  },
): Promise<void> {
  const mode = options.mode;
  if (mode === "off") return Promise.resolve();
  const own = engine as unknown as LookupEngine;
  const salt = options.salt ?? buildSalt();
  const report = options.report ?? pageReport(mode, salt);

  /** The sources asked, in order, once they are in. */
  let asked: readonly WgslSource[] = [];
  /** Stages this page translated while the start's WGSL is held: two effects
   * with one stage between them translate it once. */
  const translated = new Map<string, string>();
  let released = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let longest: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  const settle = (): void => {
    if (!held) return;
    held = false;
    clearTimeout(quiet);
    clearTimeout(longest);
    translated.clear();
    for (const source of asked) source.settle?.();
  };
  const keepQuiet = (): void => {
    if (!held) return;
    clearTimeout(quiet);
    quiet = setTimeout(settle, WGSL_HOLD_QUIET_MS);
  };

  /** The sources as they land, whenever that is. */
  const arriving = (options.sources ?? defaultSources)(salt).catch(() => null);
  const ready = (async (): Promise<void> => {
    const began = performance.now();
    const got = await within(arriving, WGSL_SOURCES_MS);
    if (got === null) {
      // Too late for this engine: let go as they land.
      void arriving.then((late) => {
        for (const source of late ?? []) source.close?.();
      });
      return;
    }
    const ours = got.filter((source) => source.salt === salt);
    for (const source of got) {
      if (source.salt !== salt) {
        Logger.Warn(`WebGPU shader lookup: the source ${source.name} was made for another build; not asked`);
        source.close?.();
      }
    }
    if (released) {
      for (const source of ours) source.close?.();
      return;
    }
    asked = ours;
    const left = Math.max(0, WGSL_SOURCES_MS - (performance.now() - began));
    await within(Promise.all(ours.map((source) => source.ready ?? Promise.resolve())), left);
  })()
    .catch(() => undefined)
    .then(() => {
      if (released) return;
      held = true;
      keepQuiet();
      longest = setTimeout(settle, WGSL_HOLD_MAX_MS);
    });

  const release = (): void => {
    if (released) return;
    released = true;
    settle();
    clearTimeout(quiet);
    clearTimeout(longest);
    for (const source of asked) source.close?.();
    asked = [];
  };
  releases.set(engine, release);
  own.onDisposeObservable?.addOnce(() => releaseShaderLookup(engine));

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

  const prepare = own._preparePipelineContextAsync.bind(engine);

  /** What Babylon's own preparation hands the first translator and makes of
   * the same effect, on a scratch context: the text for each stage and the
   * WGSL of each module, in stage order (`?wgsl=verify`). Babylon's own
   * preparation runs to its end in the call, its translators being loaded. */
  const babylons = (context: LookupContext, rest: unknown[]): { glsl: string[]; wgsl: string[] } => {
    const glsl: string[] = [];
    const wgsl: string[] = [];
    const compile = own._compileRawShaderToSpirV;
    const device = own._device;
    during(own, "_compileRawShaderToSpirV", (source: string, type: string) => {
      glsl.push(source);
      return compile.call(engine, source, type);
    }, () =>
      during(device, "createShaderModule", (descriptor: { code: string }) => {
        wgsl.push(descriptor.code);
        return {};
      }, () => {
        void prepare({ shaderProcessingContext: context.shaderProcessingContext }, ...rest.slice(0, 9), () => undefined).catch(() => undefined);
      }),
    );
    return { glsl, wgsl };
  };

  const translate = (stage: StageRecord): string => {
    const from = performance.now();
    const spirv = own._compileRawShaderToSpirV(stage.glsl, stage.stage);
    const middle = performance.now();
    const tint = own._tintWASM;
    if (tint === null) throw new Error("WebGPU shader translation failed: the translators are not loaded");
    const wgsl = tint.convertSpirV2WGSL(spirv, stage.flag);
    const to = performance.now();
    stage.spirvMs += middle - from;
    stage.wgslMs += to - middle;
    report.translateMs += to - from;
    return wgsl;
  };

  // Deliberately `async` with no `await`: it runs to `onReady` in the call,
  // as Babylon's own does, and a translation that throws rejects its promise.
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
    if (context.shaderProcessingContext.shaderLanguage !== GLSL || createAsRaw) return prepare(pipelineContext, ...rest);

    const at = performance.now();
    const began = processingSince.get(context.shaderProcessingContext);
    const stages: StageRecord[] = (
      [
        ["vertex", vertex],
        ["fragment", fragment],
      ] as const
    ).map(([stage, code]) => {
      const glsl = translatorInput(code, defines);
      const flag = uniformityOff(code);
      const key = stageKey(salt, stage, flag, glsl);
      let wgsl: string | null = held ? (translated.get(key) ?? null) : null;
      let from = PAGE;
      for (const source of asked) {
        if (wgsl !== null) break;
        wgsl = source.get(key);
        from = source.name;
      }
      return { stage, key, flag, glsl, wgsl: wgsl ?? "", from: wgsl === null ? "translated" : from, spirvMs: 0, wgslMs: 0 };
    });

    context.sources = { fragment, vertex, rawVertex, rawFragment };
    own.onBeforeShaderCompilationObservable.notifyObservers(engine);
    for (const stage of stages) {
      if (stage.from !== "translated") continue;
      stage.wgsl = translate(stage);
      if (held) translated.set(stage.key, stage.wgsl);
      for (const source of asked) {
        try {
          source.put?.(stage.key, stage.wgsl);
        } catch {
          /* a source that cannot keep it keeps nothing */
        }
      }
    }
    const [vertexStage, fragmentStage] = stages as [StageRecord, StageRecord];
    if (mode === "verify") {
      const theirs = babylons(context, rest);
      for (const [i, stage] of stages.entries()) {
        if (theirs.glsl[i] === stage.glsl && theirs.wgsl[i] === stage.wgsl) continue;
        report.differences += 1;
        Logger.Warn(`WebGPU shader lookup: the ${stage.stage} stage ${stage.key} differs from Babylon's own path (${theirs.glsl[i] === stage.glsl ? "WGSL" : "text for the first translator"})`);
      }
    }
    const moduleFrom = performance.now();
    context.stages = own._createPipelineStageDescriptor(vertexStage.wgsl, fragmentStage.wgsl, WGSL, false, false);
    const moduleMs = performance.now() - moduleFrom;
    own.onAfterShaderCompilationObservable.notifyObservers(engine);

    for (const stage of stages) {
      if (stage.from === "translated") {
        report.misses += 1;
      } else {
        report.hits += 1;
        report.hitsBySource[stage.from] = (report.hitsBySource[stage.from] ?? 0) + 1;
      }
    }
    if (mode === "record") {
      report.effects.push({
        name: context._name ?? "",
        at,
        processMs: began === undefined ? 0 : at - began,
        moduleMs,
        stages: stages.map((s) => ({ ...s })),
      });
    }
    keepQuiet();
    onReady();
  };
  return ready;
}
