import { describe, expect, it } from "vitest";
import {
  adapterFits, browserMajor, chooseEngine, createStartupWindow, failureAction, fallbackHolds, parseEngineOverride,
  parseTierOverride, readFallback, recordFailure, safeStorage, takeNotice, leaveNotice, withEngine, writeFallback,
  FALLBACK_DAYS, FALLBACK_KEY, FALLBACK_NOTICE_KEY, FALLBACK_NOTICE_MS, LOSS_WINDOW_MS, NOTICE_RESTARTED,
  NOTICE_SWITCHED, STARTUP_MAX_MS, STARTUP_QUIET_MS, WEBGPU_ON_HIGH, WEBGPU_REQUIRED_LIMITS, WEBGPU_START_MS,
  WEBGPU_TIERS,
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
    expect(chooseEngine({ ...high, tier: "medium" })).toBe("webgl2");
    expect(chooseEngine({ ...high, tier: "low" })).toBe("webgl2");
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
    expect(WEBGPU_ON_HIGH).toBe(false);
  });
  it("applies to the tiers one constant names, the high tier alone", () => {
    expect(WEBGPU_TIERS).toEqual(["high"]);
    // Taking medium in is a change to that constant alone: the rule reads it.
    const medium = { ...high, tier: "medium" as const };
    expect(chooseEngine(medium, ["medium", "high"])).toBe("probe");
    expect(chooseEngine({ ...medium, fits: true }, ["medium", "high"])).toBe("webgpu");
    expect(chooseEngine({ ...high, tier: "low" }, ["medium", "high"])).toBe("webgl2");
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
    expect(WEBGPU_START_MS).toBe(15_000);
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
