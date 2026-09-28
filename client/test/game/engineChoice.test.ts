import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapterFits, adapterFromSignals, chooseEngine, signalsFit, failureSwap, fallbackHolds, featuresToRequest,
  parseEngineOverride, readFallback, recordFailure, resolveWebGpu,
  withEngine, writeFallback, WEBGPU_TEXTURE_FEATURES,
  type AdapterReport, type WebGpuSteps,
  FALLBACK_DAYS, FALLBACK_KEY, FALLBACK_NOTICE_MS, LOSS_WINDOW_MS, NOTICE_RESTARTED,
  NOTICE_SWITCHED, NOTICE_UNFETCHED, WEBGPU_ENABLED, WEBGPU_FETCH_MS, WEBGPU_REQUIRED_LIMITS,
  WEBGPU_START_MS, WEBGPU_TIERS,
} from "../../src/game/engineChoice.js";

describe("the engine override", () => {
  it("reads engine= and nothing else", () => {
    expect(parseEngineOverride("?engine=webgpu")).toBe("webgpu");
    expect(parseEngineOverride("?cmd=freecam&engine=webgl2")).toBe("webgl2");
    expect(parseEngineOverride("?engine=webgl")).toBeNull();
    expect(parseEngineOverride("")).toBeNull();
    expect(parseEngineOverride("?tier=high")).toBeNull();
  });
});

describe("chooseEngine", () => {
  const high = { tier: "high" as const, override: null, remembered: false, on: true, fits: null };
  it("probes only where WebGPU could be the answer", () => {
    expect(chooseEngine(high)).toBe("probe");
    expect(chooseEngine({ ...high, fits: true })).toBe("webgpu");
    expect(chooseEngine({ ...high, fits: false })).toBe("webgl2");
    expect(chooseEngine({ ...high, tier: "medium" })).toBe("probe");
    expect(chooseEngine({ ...high, tier: "medium", fits: true })).toBe("webgpu");
    expect(chooseEngine({ ...high, tier: "low" })).toBe("webgl2");
    expect(chooseEngine({ ...high, tier: "low", fits: true })).toBe("webgl2");
    expect(chooseEngine({ ...high, on: false })).toBe("webgl2");
    expect(chooseEngine({ ...high, remembered: true })).toBe("webgl2");
    expect(chooseEngine({ ...high, override: "webgl2", fits: true })).toBe("webgl2");
  });
  it("lets ?engine=webgpu past the tier, the switch and the memory, never past the adapter", () => {
    const forced = { tier: "low" as const, override: "webgpu" as const, remembered: true, on: false, fits: null };
    expect(chooseEngine(forced)).toBe("probe");
    expect(chooseEngine({ ...forced, fits: true })).toBe("webgpu");
    expect(chooseEngine({ ...forced, fits: false })).toBe("webgl2");
  });
  it("ships switched off", () => {
    expect(WEBGPU_ENABLED).toBe(false);
  });
  it("applies to the tiers one constant names: high and medium, never low", () => {
    expect(WEBGPU_TIERS).toEqual(["high", "medium"]);
    // A change of tiers is a change to that constant alone: the rule reads it.
    const medium = { ...high, tier: "medium" as const };
    expect(chooseEngine(medium, ["high"])).toBe("webgl2");
    expect(chooseEngine({ ...medium, fits: true }, ["high"])).toBe("webgl2");
    expect(chooseEngine(high, ["high"])).toBe("probe");
    expect(chooseEngine(high, [])).toBe("webgl2");
  });
});

/** WebGPU's defaults for the limits the scene names: what every adapter offers. */
const DEFAULT_LIMITS = {
  maxInterStageShaderVariables: 16,
  maxVertexBuffers: 8,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxUniformBuffersPerShaderStage: 12,
};

describe("adapterFits", () => {
  it("wants the limits the scene was measured to need, and a hardware adapter", () => {
    // 19 inter-stage variables and 8 vertex buffers; 16 sampled textures, 16
    // samplers and 12 uniform buffers per stage, each WebGPU's default.
    expect(WEBGPU_REQUIRED_LIMITS).toEqual({
      maxInterStageShaderVariables: 19,
      maxVertexBuffers: 8,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxUniformBuffersPerShaderStage: 12,
    });
    const defaults = { ...DEFAULT_LIMITS };
    const reference = { ...DEFAULT_LIMITS, maxInterStageShaderVariables: 28 };
    expect(adapterFits({ limits: defaults, isFallbackAdapter: false }))
      .toEqual({ fits: false, why: "maxInterStageShaderVariables 16 < 19" });
    // Every other limit is the default, so an adapter that offers the defaults
    // and 19 inter-stage variables fits.
    expect(adapterFits({ limits: { ...defaults, maxInterStageShaderVariables: 19 }, isFallbackAdapter: false }))
      .toEqual({ fits: true, why: null });
    expect(adapterFits({ limits: { ...reference, maxUniformBuffersPerShaderStage: 11 }, isFallbackAdapter: false }))
      .toEqual({ fits: false, why: "maxUniformBuffersPerShaderStage 11 < 12" });
    expect(adapterFits({ limits: reference, isFallbackAdapter: false })).toEqual({ fits: true, why: null });
    expect(adapterFits({ limits: reference, isFallbackAdapter: true })).toEqual({ fits: false, why: "fallback adapter" });
    expect(adapterFits(null)).toEqual({ fits: false, why: "no adapter" });
  });

  it("counts a limit the adapter does not report as short", () => {
    expect(adapterFits({ limits: { maxInterStageShaderVariables: 28 }, isFallbackAdapter: false }))
      .toEqual({ fits: false, why: "maxVertexBuffers 0 < 8" });
  });
});

describe("the remembered fallback", () => {
  const env = { browser: 153, babylon: "9.18.0" };
  const t0 = 1_790_000_000_000;
  it("holds after a deterministic failure until the browser or Babylon moves, or 30 days pass", () => {
    const r = recordFailure(null, "pipeline", env, t0);
    expect(r).toEqual({ reason: "pipeline", browser: 153, babylon: "9.18.0", at: t0, losses: 0 });
    expect(fallbackHolds(r, env, t0 + 1_000)).toBe(true);
    expect(fallbackHolds(r, { browser: 154, babylon: "9.18.0" }, t0)).toBe(false);
    expect(fallbackHolds(r, { browser: 153, babylon: "9.19.0" }, t0)).toBe(false);
    expect(fallbackHolds(r, env, t0 + 2_592_000_000)).toBe(false);
    expect(fallbackHolds(null, env, t0)).toBe(false);
  });
  it("gives a lost device one retry a day", () => {
    const one = recordFailure(null, "lost", env, t0);
    expect(one.losses).toBe(1);
    expect(fallbackHolds(one, env, t0)).toBe(false);
    const two = recordFailure(one, "lost", env, t0 + 3_600_000);
    expect(two.losses).toBe(2);
    expect(fallbackHolds(two, env, t0 + 3_600_000)).toBe(true);
    const nextDay = recordFailure(one, "lost", env, t0 + 90_000_000);
    expect(nextDay.losses).toBe(1);
    expect(fallbackHolds(nextDay, env, t0 + 90_000_000)).toBe(false);
  });
  it("keeps a record that holds when a lost device follows it", () => {
    // A late shader fault remembered WebGL2; the device lost afterwards must
    // not replace that with a lone loss, which would retry WebGPU.
    const late = recordFailure(null, "pipeline", env, t0);
    const after = recordFailure(late, "lost", env, t0 + 60_000);
    expect(after).toEqual({ reason: "pipeline", browser: 153, babylon: "9.18.0", at: t0, losses: 0 });
    expect(fallbackHolds(after, env, t0 + 60_000)).toBe(true);
    expect(failureSwap({ stored: true, holds: true, reason: "lost", override: null }))
      .toEqual({ engine: "webgl2", pin: false, notice: "Graphics switched to WebGL2 after a GPU error." });
    // A record that no longer holds (a new browser) is replaced as before.
    const lapsed = recordFailure(late, "lost", { browser: 154, babylon: "9.18.0" }, t0 + 60_000);
    expect(lapsed).toEqual({ reason: "lost", browser: 154, babylon: "9.18.0", at: t0 + 60_000, losses: 1 });
  });

  it("survives storage that throws, and says it could not write", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    expect(readFallback(throwing)).toBeNull();
    expect(writeFallback(throwing, recordFailure(null, "init", env, t0))).toBe(false);
    expect(readFallback(null)).toBeNull();
  });
  it("round-trips through storage under dayhike.engine, and ignores what it did not write", () => {
    const items = new Map<string, string>();
    const store = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    } as unknown as Storage;
    const record = recordFailure(null, "lost", env, t0);
    expect(writeFallback(store, record)).toBe(true);
    expect([...items.keys()]).toEqual(["dayhike.engine"]);
    expect(readFallback(store)).toEqual({ reason: "lost", browser: 153, babylon: "9.18.0", at: t0, losses: 1 });
    items.set("dayhike.engine", "not json");
    expect(readFallback(store)).toBeNull();
    items.set("dayhike.engine", JSON.stringify({ reason: "tired", browser: 153, babylon: "9.18.0", at: t0, losses: 0 }));
    expect(readFallback(store)).toBeNull();
    items.set("dayhike.engine", JSON.stringify({ reason: "init", browser: "153", babylon: "9.18.0", at: t0, losses: 0 }));
    expect(readFallback(store)).toBeNull();
  });

  it("pins its keys and clocks", () => {
    expect(FALLBACK_KEY).toBe("dayhike.engine");
    expect(FALLBACK_DAYS).toBe(30);
    expect(LOSS_WINDOW_MS).toBe(86_400_000);
    expect(WEBGPU_FETCH_MS).toBe(10_000);
    expect(WEBGPU_START_MS).toBe(10_000);
    expect(FALLBACK_NOTICE_MS).toBe(6_000);
  });
});

describe("what a failure of the running WebGPU engine does: a live swap, never a reload", () => {
  it("says one of three lines on the HUD once the swap is done: a network that failed the translators is no GPU error", () => {
    expect(NOTICE_SWITCHED).toBe("Graphics switched to WebGL2 after a GPU error.");
    expect(NOTICE_RESTARTED).toBe("Graphics restarted after a GPU error.");
    expect(NOTICE_UNFETCHED).toBe("Graphics switched to WebGL2: part of the renderer could not be downloaded.");
  });

  it("swaps a pipeline error or an uncaptured one onto WebGL2 at once, whenever it comes", () => {
    expect(failureSwap({ stored: true, holds: true, reason: "pipeline", override: null }))
      .toEqual({ engine: "webgl2", pin: false, notice: "Graphics switched to WebGL2 after a GPU error." });
  });

  it("retries a first lost device on a new WebGPU engine, and swaps a second in 24 h onto WebGL2", () => {
    expect(failureSwap({ stored: true, holds: false, reason: "lost", override: null }))
      .toEqual({ engine: "webgpu", pin: false, notice: "Graphics restarted after a GPU error." });
    expect(failureSwap({ stored: true, holds: true, reason: "lost", override: null }))
      .toEqual({ engine: "webgl2", pin: false, notice: "Graphics switched to WebGL2 after a GPU error." });
  });

  it("pins engine=webgl2 in the URL wherever the rule would otherwise start WebGPU again", () => {
    // Storage refused the record, or ?engine=webgpu outranks it.
    expect(failureSwap({ stored: false, holds: false, reason: "lost", override: null }))
      .toEqual({ engine: "webgl2", pin: true, notice: "Graphics switched to WebGL2 after a GPU error." });
    expect(failureSwap({ stored: false, holds: false, reason: "pipeline", override: null }).pin).toBe(true);
    expect(failureSwap({ stored: true, holds: true, reason: "pipeline", override: "webgpu" }).pin).toBe(true);
    expect(failureSwap({ stored: true, holds: false, reason: "lost", override: "webgpu" }))
      .toEqual({ engine: "webgpu", pin: false, notice: "Graphics restarted after a GPU error." });
  });

  it("asks for the engine the rule then gives: the rebuild takes it by the rule, from the record and the URL", () => {
    const env = { browser: 153, babylon: "9.18.0" };
    const t0 = 1_790_000_000_000;
    for (const reason of ["pipeline", "lost"] as const) {
      for (const stored of [true, false]) {
        for (const override of [null, "webgpu"] as const) {
          for (const earlier of [null, recordFailure(null, "lost", env, t0 - 3_600_000)]) {
            const record = recordFailure(earlier, reason, env, t0);
            const holds = fallbackHolds(record, env, t0);
            const act = failureSwap({ stored, holds, reason, override });
            const remembered = stored && holds;
            const url = act.pin ? "webgl2" : override;
            for (const tier of WEBGPU_TIERS) {
              expect(chooseEngine({ tier, override: url, remembered, on: true, fits: true })).toBe(act.engine);
            }
          }
        }
      }
    }
  });
});

describe("the rule's later rungs", () => {
  it("gives WebGL2 to a tier below one it gave WebGL2, so a ladder's later rungs are WebGL2 by the rule", () => {
    const order = ["low", "medium", "high"] as const;
    for (const override of [null, "webgl2", "webgpu"] as const) {
      for (const remembered of [false, true]) {
        for (const on of [false, true]) {
          for (const fits of [false, true]) {
            for (const [i, upper] of order.entries()) {
              if (chooseEngine({ tier: upper, override, remembered, on, fits }) !== "webgl2") continue;
              for (const lower of order.slice(0, i)) {
                expect(chooseEngine({ tier: lower, override, remembered, on, fits })).toBe("webgl2");
              }
            }
          }
        }
      }
    }
  });
});

describe("withEngine", () => {
  it("sets engine= and keeps the route, the rest of the query and the hash", () => {
    expect(withEngine("https://games.csarko.sh/dayhike/game/abc", "webgl2"))
      .toBe("https://games.csarko.sh/dayhike/game/abc?engine=webgl2");
    expect(withEngine("https://games.csarko.sh/dayhike/game/abc?tier=high&engine=webgpu#x", "webgl2"))
      .toBe("https://games.csarko.sh/dayhike/game/abc?tier=high&engine=webgl2#x");
    expect(withEngine("http://localhost:5173/dayhike/game/abc?cmd=seed%20atmo", "webgl2"))
      .toBe("http://localhost:5173/dayhike/game/abc?cmd=seed+atmo&engine=webgl2");
  });
});

describe("the texture compression the device asks for", () => {
  it("is the three formats Babylon's KTX2 path reads, and only those the adapter has", () => {
    expect(WEBGPU_TEXTURE_FEATURES).toEqual(["texture-compression-bc", "texture-compression-etc2", "texture-compression-astc"]);
    expect(featuresToRequest(["texture-compression-bc", "float32-filterable", "timestamp-query"]))
      .toEqual(["texture-compression-bc"]);
    expect(featuresToRequest(new Set(["texture-compression-astc", "texture-compression-etc2"])))
      .toEqual(["texture-compression-etc2", "texture-compression-astc"]);
    expect(featuresToRequest([])).toEqual([]);
  });
});

describe("resolveWebGpu", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const high = { tier: "high" as const, override: null, remembered: false, on: true, fits: null };
  const fitting: AdapterReport = {
    limits: { ...DEFAULT_LIMITS, maxInterStageShaderVariables: 28 },
    isFallbackAdapter: false,
    features: ["texture-compression-bc", "timestamp-query"],
  };
  const small: AdapterReport = { limits: { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 }, isFallbackAdapter: false };
  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const after = <T,>(ms: number, value: T): Promise<T> => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const budgets = { fetchMs: 10_000, startMs: 10_000 };

  type Module = Awaited<ReturnType<WebGpuSteps<string>["load"]>>;
  function steps(module: Partial<Module> = {}, over: Partial<WebGpuSteps<string>> = {}) {
    const log = { calls: [] as string[], remembered: [] as string[], warned: [] as string[], created: [] as [number, string[]][] };
    const s: WebGpuSteps<string> = {
      available: () => true,
      load: () => {
        log.calls.push("load");
        return Promise.resolve({
          probe: () => {
            log.calls.push("probe");
            return Promise.resolve(fitting);
          },
          fetchTranslators: () => {
            log.calls.push("fetchTranslators");
            return Promise.resolve();
          },
          create: (ms: number, features: string[]) => {
            log.calls.push("create");
            log.created.push([ms, features]);
            return Promise.resolve("engine");
          },
          ...module,
        });
      },
      remember: (reason) => void log.remembered.push(reason),
      warn: (message) => void log.warned.push(message),
      ...over,
    };
    return { s, log };
  }

  it("asks the adapter before fetching the translators, and makes the engine last", async () => {
    const { s, log } = steps();
    expect(await resolveWebGpu(high, s, budgets, () => 1_000)).toBe("engine");
    expect(log.calls).toEqual(["load", "probe", "fetchTranslators", "create"]);
    expect(log.created).toEqual([[10_000, ["texture-compression-bc"]]]);
    expect(log.remembered).toEqual([]);
  });

  it("fetches no translator where the adapter does not fit, and says why only under ?engine=webgpu", async () => {
    const quiet = steps({ probe: () => Promise.resolve(small) });
    expect(await resolveWebGpu(high, quiet.s, budgets)).toBeNull();
    expect(quiet.log.calls).toEqual(["load"]);
    expect(quiet.log.warned).toEqual([]);
    expect(quiet.log.remembered).toEqual([]);
    const forced = steps({ probe: () => Promise.resolve(small) });
    expect(await resolveWebGpu({ ...high, override: "webgpu" }, forced.s, budgets)).toBeNull();
    expect(forced.log.warned).toEqual(["WebGPU: not on this browser (maxInterStageShaderVariables 16 < 19); drawing with WebGL2."]);
    const none = steps({ probe: () => Promise.resolve(null) });
    expect(await resolveWebGpu(high, none.s, budgets)).toBeNull();
    expect(none.log.calls).toEqual(["load"]);
  });

  it("fetches nothing at all on a page without WebGPU", async () => {
    const quiet = steps({}, { available: () => false });
    expect(await resolveWebGpu(high, quiet.s, budgets)).toBeNull();
    expect(quiet.log.calls).toEqual([]);
    expect(quiet.log.warned).toEqual([]);
    const forced = steps({}, { available: () => false });
    expect(await resolveWebGpu({ ...high, override: "webgpu" }, forced.s, budgets)).toBeNull();
    expect(forced.log.calls).toEqual([]);
    expect(forced.log.warned).toEqual(["WebGPU: not on this browser (no WebGPU); drawing with WebGL2."]);
  });

  it("gives up on a module import that never settles, and remembers nothing", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({}, { load: never });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(log.remembered).toEqual([]);
    expect(log.warned).toEqual(["WebGPU: its module did not load in 10000 ms; drawing with WebGL2."]);
  });

  it("gives up on an adapter probe that never settles, and remembers it", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({ probe: () => never<AdapterReport | null>() });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(log.calls).toEqual(["load"]);
    expect(log.remembered).toEqual(["init"]);
    expect(log.warned).toEqual(["WebGPU: the adapter did not answer in 10000 ms; drawing with WebGL2."]);
  });

  it("gives up on a translator fetch that never settles, with what the import left of the fetch's budget, and remembers nothing", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({ fetchTranslators: never }, { load: () => after(3_000, undefined).then(() => ({
      probe: () => after(2_000, fitting),
      fetchTranslators: () => never<void>(),
      create: () => Promise.resolve("engine"),
    })) });
    const result = resolveWebGpu(high, s, budgets);
    // 3 s importing, 2 s probing, then the translators get the fetch's other 7 s.
    await vi.advanceTimersByTimeAsync(11_999);
    expect(log.warned).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeNull();
    expect(log.remembered).toEqual([]);
    expect(log.warned).toEqual(["WebGPU: its translators did not load in 10000 ms; drawing with WebGL2."]);
  });

  it("keeps each budget a running total across its two steps", async () => {
    vi.useFakeTimers();
    const created: [number, string[]][] = [];
    const { s } = steps({}, { load: () => after(3_000, undefined).then(() => ({
      probe: () => after(2_000, fitting),
      fetchTranslators: () => after(6_500, undefined),
      create: (ms: number, features: string[]) => {
        created.push([ms, features]);
        return Promise.resolve("engine");
      },
    })) });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(11_500);
    expect(await result).toBe("engine");
    // The fetch's 3 s + 6.5 s fit its 10 s; the probe's 2 s leave the engine 8 s.
    expect(created).toEqual([[8_000, ["texture-compression-bc"]]]);
  });

  it("falls back without a record where a fetch fails", async () => {
    const module = steps({}, { load: () => Promise.reject(new Error("chunk")) });
    expect(await resolveWebGpu(high, module.s, budgets)).toBeNull();
    expect(module.log.remembered).toEqual([]);
    expect(module.log.warned).toEqual(["WebGPU: its module did not load; drawing with WebGL2."]);
    const translators = steps({ fetchTranslators: () => Promise.reject(new Error("the WebGPU translators did not load: twgsl")) });
    expect(await resolveWebGpu(high, translators.s, budgets)).toBeNull();
    expect(translators.log.remembered).toEqual([]);
    expect(translators.log.warned).toEqual(["WebGPU: its translators did not load; drawing with WebGL2."]);
  });

  it("remembers an engine that fails to start, treats a probe that fails as no adapter, and never rejects", async () => {
    const probing = steps({ probe: () => Promise.reject(new Error("gpu")) });
    expect(await resolveWebGpu(high, probing.s, budgets)).toBeNull();
    expect(probing.log.remembered).toEqual([]);
    const broken = steps({ create: () => Promise.reject(new Error("device")) });
    expect(await resolveWebGpu(high, broken.s, budgets)).toBeNull();
    expect(broken.log.remembered).toEqual(["init"]);
    expect(broken.log.warned).toEqual(["WebGPU: the engine did not start; drawing with WebGL2."]);
  });

  it("uses the pinned budgets by default", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({}, { load: never });
    const result = resolveWebGpu(high, s);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(log.warned).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeNull();
  });
});

describe("the adapter the engine rule reads", () => {
  const signals = {
    adapter: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false },
    limits: { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 },
    features: ["texture-compression-bc"],
  };
  const unasked = (): Promise<AdapterReport | null> => {
    throw new Error("the later answer is read only when the signals went without it");
  };

  it("is the signals' own reading where the request answered in time", async () => {
    expect(await adapterFromSignals({ ...signals, adapterStatus: "ok" }, unasked)).toEqual({
      limits: { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 },
      isFallbackAdapter: false,
      features: ["texture-compression-bc"],
    });
  });

  it("is the same request's later answer where the signals timed out: not known yet, never a failure", async () => {
    const later: AdapterReport = { limits: { maxVertexBuffers: 8 }, isFallbackAdapter: true, features: [] };
    const none = { adapter: null, limits: null, features: null };
    expect(await adapterFromSignals({ ...none, adapterStatus: "timed-out" }, () => Promise.resolve(later))).toBe(later);
  });

  it("is no adapter where there is no WebGPU, no adapter, or the request failed", async () => {
    const none = { adapter: null, limits: null, features: null };
    expect(await adapterFromSignals({ ...none, adapterStatus: "none" }, unasked)).toBeNull();
    expect(await adapterFromSignals({ ...none, adapterStatus: "rejected" }, unasked)).toBeNull();
  });
});

describe("whether the signals' adapter fits", () => {
  const adapter = { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false };
  it("is known where the request answered in time, and not known where it timed out", () => {
    const fits = { adapter, limits: { ...DEFAULT_LIMITS, maxInterStageShaderVariables: 28 }, features: [] };
    expect(signalsFit({ ...fits, adapterStatus: "ok" })).toBe(true);
    expect(signalsFit({ ...fits, limits: { ...DEFAULT_LIMITS }, adapterStatus: "ok" })).toBe(false);
    expect(signalsFit({ ...fits, adapter: { ...adapter, isFallbackAdapter: true }, adapterStatus: "ok" })).toBe(false);
    const none = { adapter: null, limits: null, features: null };
    expect(signalsFit({ ...none, adapterStatus: "timed-out" })).toBe(null);
    expect(signalsFit({ ...none, adapterStatus: "none" })).toBe(false);
    expect(signalsFit({ ...none, adapterStatus: "rejected" })).toBe(false);
  });
});

