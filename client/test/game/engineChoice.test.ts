import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapterFits, browserMajor, chooseEngine, createStartupWindow, failureAction, fallbackHolds, featuresToRequest,
  keepOverrides, lateFailureLine, parseEngineOverride, parseTierOverride, readFallback, recordFailure, resolveWebGpu,
  safeStorage, stripOverrides, takeNotice, leaveNotice, withEngine, writeFallback, WEBGPU_TEXTURE_FEATURES,
  type AdapterReport, type WebGpuSteps,
  FALLBACK_DAYS, FALLBACK_KEY, FALLBACK_NOTICE_KEY, FALLBACK_NOTICE_MS, LOSS_WINDOW_MS, NOTICE_RESTARTED,
  NOTICE_SWITCHED, STARTUP_MAX_MS, STARTUP_QUIET_MS, WEBGPU_ENABLED, WEBGPU_FETCH_MS, WEBGPU_REQUIRED_LIMITS,
  WEBGPU_START_MS, WEBGPU_TIERS, sameRoute,
} from "../../src/game/engineChoice.js";

describe("the overrides", () => {
  it("read engine= and tier= and nothing else", () => {
    expect(parseEngineOverride("?engine=webgpu")).toBe("webgpu");
    expect(parseEngineOverride("?cmd=freecam&engine=webgl2")).toBe("webgl2");
    expect(parseEngineOverride("?engine=webgl")).toBeNull();
    expect(parseEngineOverride("")).toBeNull();
    expect(parseTierOverride("?tier=high")).toBe("high");
    expect(parseTierOverride("?tier=ultra")).toBeNull();
    expect(parseTierOverride("?engine=webgpu")).toBeNull();
  });

  it("reads the other two tiers too", () => {
    expect(parseTierOverride("?tier=low")).toBe("low");
    expect(parseTierOverride("?engine=webgl2&tier=medium")).toBe("medium");
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

describe("adapterFits", () => {
  it("wants 17 inter-stage variables, 8 vertex buffers and a hardware adapter", () => {
    expect(WEBGPU_REQUIRED_LIMITS).toEqual({ maxInterStageShaderVariables: 17, maxVertexBuffers: 8 });
    const defaults = { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 };
    const reference = { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 };
    expect(adapterFits({ limits: defaults, isFallbackAdapter: false }))
      .toEqual({ fits: false, why: "maxInterStageShaderVariables 16 < 17" });
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
    expect(failureAction({ stored: true, holds: true, reason: "lost", inStartup: false, override: null }))
      .toEqual({ reload: "reload", notice: "Graphics switched to WebGL2 after a GPU error." });
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
  it("reads the browser's major version from navigator.userAgent", () => {
    expect(browserMajor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7310.4 Safari/537.36")).toBe(153);
    expect(browserMajor("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0")).toBe(145);
    expect(browserMajor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")).toBe(26);
    expect(browserMajor("")).toBe(0);
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
    expect(FALLBACK_NOTICE_KEY).toBe("dayhike.engine.notice");
    expect(FALLBACK_DAYS).toBe(30);
    expect(LOSS_WINDOW_MS).toBe(86_400_000);
    expect(WEBGPU_FETCH_MS).toBe(10_000);
    expect(WEBGPU_START_MS).toBe(10_000);
    expect(STARTUP_QUIET_MS).toBe(10_000);
    expect(STARTUP_MAX_MS).toBe(60_000);
    expect(FALLBACK_NOTICE_MS).toBe(6_000);
  });
});

describe("what a failure on WebGPU does", () => {
  it("reloads in the startup window and after a lost device, and only logs otherwise", () => {
    const base = { stored: true, holds: true, override: null };
    expect(failureAction({ ...base, reason: "pipeline", inStartup: true }))
      .toEqual({ reload: "reload", notice: "Graphics switched to WebGL2 after a GPU error." });
    expect(failureAction({ ...base, reason: "pipeline", inStartup: false })).toEqual({ reload: "none", notice: null });
    expect(failureAction({ ...base, reason: "lost", inStartup: false }))
      .toEqual({ reload: "reload", notice: "Graphics switched to WebGL2 after a GPU error." });
  });

  it("retries a first lost device on WebGPU", () => {
    expect(failureAction({ stored: true, holds: false, override: null, reason: "lost", inStartup: false }))
      .toEqual({ reload: "reload", notice: "Graphics restarted after a GPU error." });
    expect(failureAction({ stored: true, holds: false, override: "webgpu", reason: "lost", inStartup: true }))
      .toEqual({ reload: "reload", notice: "Graphics restarted after a GPU error." });
  });

  it("puts engine=webgl2 in the URL wherever a plain reload would start WebGPU again", () => {
    // Storage refused: nothing remembers the failure, so the URL must.
    expect(failureAction({ stored: false, holds: false, override: null, reason: "lost", inStartup: false }))
      .toEqual({ reload: "webgl2", notice: "Graphics switched to WebGL2 after a GPU error." });
    expect(failureAction({ stored: false, holds: false, override: null, reason: "pipeline", inStartup: true }))
      .toEqual({ reload: "webgl2", notice: "Graphics switched to WebGL2 after a GPU error." });
    // ?engine=webgpu outranks the memory, so it has to go from the URL.
    expect(failureAction({ stored: true, holds: true, override: "webgpu", reason: "pipeline", inStartup: true }))
      .toEqual({ reload: "webgl2", notice: "Graphics switched to WebGL2 after a GPU error." });
  });

  it("says the two lines", () => {
    expect(NOTICE_SWITCHED).toBe("Graphics switched to WebGL2 after a GPU error.");
    expect(NOTICE_RESTARTED).toBe("Graphics restarted after a GPU error.");
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

describe("the startup window", () => {
  it("closes 10 s after the first frame when nothing compiles", () => {
    const w = createStartupWindow(1_000);
    expect(w.open(2_000)).toBe(true);
    w.frame(3_000);
    expect(w.open(12_999)).toBe(true);
    expect(w.open(13_000)).toBe(false);
  });

  it("stays open while effects keep compiling after the first frame, and does not reopen", () => {
    const w = createStartupWindow(0);
    w.frame(2_000);
    w.compiled(9_000);
    w.compiled(18_000);
    expect(w.open(27_999)).toBe(true);
    expect(w.open(28_000)).toBe(false);
    w.compiled(29_000);
    expect(w.open(29_001)).toBe(false);
  });

  it("does not start the quiet clock before the first frame", () => {
    const w = createStartupWindow(0);
    w.compiled(1_000);
    expect(w.open(40_000)).toBe(true);
    w.frame(40_000);
    w.frame(45_000);
    expect(w.open(49_999)).toBe(true);
    expect(w.open(50_000)).toBe(false);
  });

  it("closes 60 s after the engine was made, whatever still compiles", () => {
    const w = createStartupWindow(0);
    w.frame(1_000);
    for (let t = 5_000; t < 60_000; t += 5_000) w.compiled(t);
    expect(w.open(59_999)).toBe(true);
    expect(w.open(60_000)).toBe(false);
    w.compiled(65_000);
    expect(w.open(65_001)).toBe(false);
  });
});

describe("the notice across a reload", () => {
  it("is left once, taken once, and dropped where storage throws", () => {
    const items = new Map<string, string>();
    const store = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    } as unknown as Storage;
    expect(takeNotice(store)).toBeNull();
    leaveNotice(store, "Graphics restarted after a GPU error.");
    expect([...items.keys()]).toEqual(["dayhike.engine.notice"]);
    expect(takeNotice(store)).toBe("Graphics restarted after a GPU error.");
    expect(takeNotice(store)).toBeNull();
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    expect(() => leaveNotice(throwing, "x")).not.toThrow();
    expect(takeNotice(throwing)).toBeNull();
    expect(takeNotice(null)).toBeNull();
  });

  it("finds no storage where the accessor itself throws", () => {
    expect(safeStorage(() => { throw new Error("denied"); })).toBeNull();
    const store = {} as Storage;
    expect(safeStorage(() => store)).toBe(store);
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

describe("the overrides stay on this page", () => {
  it("are taken off the route a host announces, and nothing else is touched", () => {
    expect(stripOverrides("/game/abc?engine=webgpu&tier=high")).toBe("/game/abc");
    expect(stripOverrides("/game/abc?cmd=seed%20atmo&engine=webgl2")).toBe("/game/abc?cmd=seed+atmo");
    // No override: the route goes out byte for byte as before.
    expect(stripOverrides("/game/abc?cmd=seed%20atmo")).toBe("/game/abc?cmd=seed%20atmo");
    expect(stripOverrides("/game/abc")).toBe("/game/abc");
    expect(stripOverrides("")).toBe("");
  });

  it("are carried onto the route a follower is sent to, from its own URL", () => {
    expect(keepOverrides("/game/abc?cmd=x", "?engine=webgl2&tier=medium&cmd=y")).toBe("/game/abc?cmd=x&engine=webgl2&tier=medium");
    expect(keepOverrides("/game/abc", "?tier=high")).toBe("/game/abc?tier=high");
    expect(keepOverrides("/game/abc?cmd=x", "")).toBe("/game/abc?cmd=x");
  });
});

describe("the line a late GPU error logs", () => {
  it("promises WebGL2 on the next load only where that is true", () => {
    expect(lateFailureLine(true, null)).toBe("WebGPU: a GPU error after startup; the next load draws with WebGL2.");
    expect(lateFailureLine(true, "webgpu"))
      .toBe("WebGPU: a GPU error after startup; remembered, but ?engine=webgpu in this URL still asks for WebGPU.");
    expect(lateFailureLine(false, null))
      .toBe("WebGPU: a GPU error after startup; storage refused the record, so this tab's URL now asks for WebGL2.");
    expect(lateFailureLine(false, "webgpu"))
      .toBe("WebGPU: a GPU error after startup; storage refused the record, so this tab's URL now asks for WebGL2.");
  });
});

describe("sameRoute", () => {
  // A hand-typed ?cmd= reaches the host's URL as the browser encoded it
  // (%20 for a space, a bare ;); the follower's URL went through
  // URLSearchParams when its own override was carried onto it (+ and %3B).
  const host = "/game/abc?cmd=seed%20atmo;weather%20mist";
  const follower = keepOverrides(host, "?tier=high");

  it("sees the same route where only the encoding and the follower's own overrides differ", () => {
    expect(follower).toBe("/game/abc?cmd=seed+atmo%3Bweather+mist&tier=high");
    // The comparison it replaces: an unchanged route read as changed, so the
    // follower navigated and rebuilt its game on every lobby change.
    expect(stripOverrides(host) === stripOverrides(follower)).toBe(false);
    expect(sameRoute(host, follower)).toBe(true);
    expect(sameRoute(`${host}&engine=webgl2`, follower)).toBe(true);
    expect(sameRoute("/game/abc?b=2&a=1", "/game/abc?a=1&b=2")).toBe(true);
    expect(sameRoute("/game/abc", "/game/abc?tier=medium")).toBe(true);
  });

  it("still sees a real change", () => {
    expect(sameRoute(host, "/game/abc?cmd=seed%20other;weather%20mist&tier=high")).toBe(false);
    expect(sameRoute(host, "/game/xyz?cmd=seed%20atmo;weather%20mist")).toBe(false);
    expect(sameRoute("/game/abc", "/game/abc?cmd=x")).toBe(false);
    expect(sameRoute("/", "/credits")).toBe(false);
  });
});

describe("resolveWebGpu", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const high = { tier: "high" as const, override: null, remembered: false, on: true, fits: null };
  const fitting: AdapterReport = {
    limits: { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 },
    isFallbackAdapter: false,
    features: ["texture-compression-bc", "timestamp-query"],
  };
  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const budgets = { fetchMs: 10_000, startMs: 10_000 };

  function steps(over: Partial<WebGpuSteps<string>> = {}) {
    const log = { remembered: [] as string[], warned: [] as string[], created: [] as [number, string[]][] };
    const s: WebGpuSteps<string> = {
      load: () =>
        Promise.resolve({
          probe: () => Promise.resolve(fitting),
          create: (ms: number, features: string[]) => {
            log.created.push([ms, features]);
            return Promise.resolve("engine");
          },
        }),
      remember: (reason) => void log.remembered.push(reason),
      warn: (message) => void log.warned.push(message),
      ...over,
    };
    return { s, log };
  }

  it("makes the engine with the GPU's budget and the adapter's texture formats", async () => {
    const { s, log } = steps();
    expect(await resolveWebGpu(high, s, budgets, () => 1_000)).toBe("engine");
    expect(log.created).toEqual([[10_000, ["texture-compression-bc"]]]);
    expect(log.remembered).toEqual([]);
  });

  it("gives up on a fetch that never settles, and remembers nothing", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({ load: never });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(log.remembered).toEqual([]);
    expect(log.warned).toEqual(["WebGPU: its module and translators did not load in 10000 ms; drawing with WebGL2."]);
  });

  it("gives up on an adapter probe that never settles, and remembers it", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({
      load: () => Promise.resolve({ probe: () => never<AdapterReport | null>(), create: () => Promise.resolve("engine") }),
    });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(log.remembered).toEqual(["init"]);
    expect(log.warned).toEqual(["WebGPU: the adapter did not answer in 10000 ms; drawing with WebGL2."]);
  });

  it("does not let a slow fetch eat the GPU's budget", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({
      load: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({
            probe: () => new Promise((r) => setTimeout(() => r(fitting), 3_000)),
            create: (ms: number, features: string[]) => {
              log.created.push([ms, features]);
              return Promise.resolve("engine");
            },
          }), 9_500);
        }),
    });
    const result = resolveWebGpu(high, s, budgets);
    await vi.advanceTimersByTimeAsync(12_500);
    expect(await result).toBe("engine");
    // The probe's 3 s came out of the GPU's 10 s; the fetch's 9.5 s did not.
    expect(log.created).toEqual([[7_000, ["texture-compression-bc"]]]);
    expect(log.remembered).toEqual([]);
  });

  it("falls back without a record where the fetch fails or the adapter does not fit", async () => {
    const failing = steps({ load: () => Promise.reject(new Error("the WebGPU translators did not load: twgsl")) });
    expect(await resolveWebGpu(high, failing.s, budgets)).toBeNull();
    expect(failing.log.remembered).toEqual([]);
    expect(failing.log.warned).toEqual(["WebGPU: its module and translators did not load; drawing with WebGL2."]);

    const small: AdapterReport = { limits: { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 }, isFallbackAdapter: false };
    const quiet = steps({ load: () => Promise.resolve({ probe: () => Promise.resolve(small), create: () => Promise.resolve("engine") }) });
    expect(await resolveWebGpu(high, quiet.s, budgets)).toBeNull();
    expect(quiet.log.warned).toEqual([]);
    const forced = steps({ load: () => Promise.resolve({ probe: () => Promise.resolve(small), create: () => Promise.resolve("engine") }) });
    expect(await resolveWebGpu({ ...high, override: "webgpu" }, forced.s, budgets)).toBeNull();
    expect(forced.log.warned).toEqual(["WebGPU: not on this browser (maxInterStageShaderVariables 16 < 17); drawing with WebGL2."]);
    expect(forced.log.remembered).toEqual([]);
  });

  it("remembers an engine that fails to start, and never rejects", async () => {
    const { s, log } = steps({
      load: () => Promise.resolve({ probe: () => Promise.reject(new Error("gpu")), create: () => Promise.resolve("engine") }),
    });
    expect(await resolveWebGpu(high, s, budgets)).toBeNull();
    expect(log.remembered).toEqual([]);
    const broken = steps({
      load: () => Promise.resolve({ probe: () => Promise.resolve(fitting), create: () => Promise.reject(new Error("device")) }),
    });
    expect(await resolveWebGpu(high, broken.s, budgets)).toBeNull();
    expect(broken.log.remembered).toEqual(["init"]);
    expect(broken.log.warned).toEqual(["WebGPU: the engine did not start; drawing with WebGL2."]);
  });

  it("uses the pinned budgets by default", async () => {
    vi.useFakeTimers();
    const { s, log } = steps({ load: never });
    const result = resolveWebGpu(high, s);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(log.warned).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeNull();
  });
});
