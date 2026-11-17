import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseEngine, engineForTier, WEBGPU_ENABLED, WEBGPU_PHONE_TIERS, WEBGPU_TIERS, type EngineInput } from "../../src/game/engineChoice.js";
import { autoPick, qualityLine, runProbe } from "../../src/game/frameProbe.js";
import type { GpuSignals } from "../../src/game/gpuSignals.js";
import { DETECT_VERSION, type AutoRecord, type ProbeReading, type QualityTier } from "../../src/game/quality.js";
import { readAutoRecord } from "../../src/game/tierChoice.js";

/**
 * Wherever the rule gives WebGL2, which with `WEBGPU_ENABLED` on is everywhere
 * but high and medium in desktop Chrome and Edge on macOS and Windows and low
 * in Chrome and Edge on an Android phone or tablet, a player's start is what it was before the WebGPU engine was built: the same
 * tier decision, the same engine (WebGL2), the same records and log lines, the
 * engine's name aside. Nothing of WebGPU is fetched there: its module is
 * reached only by a dynamic import behind the rule, so neither the translators
 * nor the map of translations are.
 */
describe("the start where the rule gives WebGL2", () => {
  const TIERS: readonly QualityTier[] = ["low", "medium", "high"];
  const CHROME_MAC = { chromeOrEdge: true, os: "mac", mobile: false } as const;
  const EDGE_WINDOWS = { chromeOrEdge: true, os: "windows", mobile: false } as const;
  const OTHERS = [
    { chromeOrEdge: false, os: "mac", mobile: false }, // Safari
    { chromeOrEdge: false, os: "windows", mobile: false }, // Firefox
    { chromeOrEdge: false, os: "android", mobile: true }, // Samsung Internet, Firefox on Android
    { chromeOrEdge: false, os: "other", mobile: true }, // an iPhone, Safari or Chrome
    { chromeOrEdge: true, os: "other", mobile: false }, // Chrome on Linux
    { chromeOrEdge: false, os: "mac", mobile: false }, // the desktop launcher, Brave, Opera
    { chromeOrEdge: false, os: "windows", mobile: false }, // the same on Windows
  ] as const;

  const CHROME_ANDROID = { chromeOrEdge: true, os: "android", mobile: true } as const;

  it("is on, for the high and medium tiers on a desktop and the low tier on an Android phone", () => {
    expect(WEBGPU_ENABLED).toBe(true);
    expect(WEBGPU_TIERS).toEqual(["high", "medium"]);
    expect(WEBGPU_PHONE_TIERS).toEqual(["low"]);
  });

  it("draws low on WebGL2 without asking for WebGPU, on every browser but Chrome and Edge on Android: the module is never imported, no translator fetched", async () => {
    for (const host of [CHROME_MAC, EDGE_WINDOWS, ...OTHERS]) {
      for (const tier of ["low"] as const) {
        for (const remembered of [false, true]) {
          for (const fits of [null, false, true]) {
            const input: EngineInput = { tier, override: null, remembered, on: WEBGPU_ENABLED, fits, ...host };
            let asked = 0;
            const engine = await engineForTier(input, async () => {
              asked += 1;
              return "webgpu engine";
            });
            expect(engine).toBe(null);
            expect(asked).toBe(0);
          }
        }
      }
    }
  });

  it("draws every tier on WebGL2 without asking for WebGPU on Safari, Firefox, Chrome on Linux, the desktop launcher, Brave and Opera, an iPhone, and another browser on Android", async () => {
    for (const host of OTHERS) {
      for (const tier of TIERS) {
        for (const fits of [null, false, true]) {
          const input: EngineInput = { tier, override: null, remembered: false, on: WEBGPU_ENABLED, fits, ...host };
          let asked = 0;
          const engine = await engineForTier(input, async () => {
            asked += 1;
            return "webgpu engine";
          });
          expect(engine).toBe(null);
          expect(asked).toBe(0);
        }
      }
    }
  });

  it("asks for WebGPU on the high tier on desktop Chrome and Edge on macOS and Windows, unless a failure is remembered", async () => {
    for (const host of [CHROME_MAC, EDGE_WINDOWS]) {
      for (const remembered of [false, true]) {
        const input: EngineInput = { tier: "high", override: null, remembered, on: WEBGPU_ENABLED, fits: null, ...host };
        let asked = 0;
        const engine = await engineForTier(input, async () => {
          asked += 1;
          return "webgpu engine";
        });
        expect(engine).toBe(remembered ? null : "webgpu engine");
        expect(asked).toBe(remembered ? 0 : 1);
      }
    }
  });

  it("asks for WebGPU on the low tier in Chrome on an Android phone, unless a failure is remembered, and for no other tier there", async () => {
    for (const tier of TIERS) {
      for (const remembered of [false, true]) {
        const input: EngineInput = { tier, override: null, remembered, on: WEBGPU_ENABLED, fits: null, ...CHROME_ANDROID };
        let asked = 0;
        const engine = await engineForTier(input, async () => {
          asked += 1;
          return "webgpu engine";
        });
        const wanted = tier === "low" && !remembered;
        expect(engine).toBe(wanted ? "webgpu engine" : null);
        expect(asked).toBe(wanted ? 1 : 0);
      }
    }
  });

  it("keys Auto's verdicts on WebGL2 where the rule gives the high tier WebGL2, so its tier decision and its records are the tier detection branch's", async () => {
    // The engine a page that draws by the rule keys the verdicts on: the high
    // tier's, here Safari's. (The page itself keys them on WebGPU alone, the
    // one engine the hike's own renderer draws with: `verdictEngineNow`.)
    expect(chooseEngine({ tier: WEBGPU_TIERS[0] as QualityTier, override: null, remembered: false, on: WEBGPU_ENABLED, fits: true, chromeOrEdge: false, os: "mac", mobile: false })).toBe("webgl2");
    const signals: GpuSignals = {
      renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
    };
    const verdict = { tier: "high" as const, source: "probe" as const, pixels: 2_073_600, at: 1_790_000_000_000 - 1 };
    const records: (AutoRecord | null)[] = [
      null,
      { v: DETECT_VERSION, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null },
      { v: DETECT_VERSION, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0, verdict },
    ];
    for (const record of records) {
      const at = { record, pixels: 2_073_600, now: 1_790_000_000_000 };
      expect(autoPick(signals, { ...at, engine: "webgl2" })).toEqual(autoPick(signals, at));
    }
    // A probe's verdict on WebGL2 is written as the tier detection branch
    // writes it: no engine field.
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
    const reading = (tier: QualityTier): ProbeReading => ({ tier, frames: 120, meanMs: 16.7, p95Ms: 16.7, pixels: 2_073_600, engine: "webgl2" });
    await runProbe("high", "medium", null, { gpu: "Apple GPU", browser: 26, cls: "apple-unknown", engine: "webgl2" }, {
      storage,
      runStep: async (tier) => reading(tier),
      pixels: () => 2_073_600,
      now: () => 1_790_000_000_000,
    });
    expect(JSON.parse(map.get("dayhike.quality.auto") ?? "null").verdict).toEqual({
      tier: "high", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000, readings: [reading("high")],
    });
    expect(readAutoRecord(storage)!.verdict).not.toHaveProperty("engine");
  });

  it("logs the tier detection branch's line for the tier, the engine named", () => {
    expect(qualityLine("medium", "auto", "apple-unknown", "webgl2")).toBe("quality: medium (auto, apple-unknown), engine webgl2");
  });

  it("reaches the WebGPU path of Babylon.js from no page: the page makes no engine, by the rule or without it", () => {
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // The rule's gate (`engineForTier`, shown above) and what stood behind it are called by no page: a hike, a staged
    // scene and the tier check are drawn by the hike's own renderer, which makes its engine for itself.
    expect(main.match(/\bmakeWebGpu\b/g)).toBeNull();
    expect(main.match(/\bengineForTier\b/g)).toBeNull();
    expect(main.match(/\bchooseEngine\b/g)).toBeNull();
    // Nor are the translators started, or the rule handed anything, there.
    expect(main.match(/\bloadTranslators\b/g)).toBeNull();
    expect(main.match(/\bengineInput\b/g)).toBeNull();
  });

  it("names the translators' files in the WebGPU module alone, so nothing else can fetch them", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const naming = files(src).filter((file) => /glslang|twgsl/.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    expect(naming.map((file) => relative(src, file))).toEqual(["game/gpuEngine.ts"]);
  });

  it("names the map of translations the build ships in the WebGPU module alone, which the page's first load never imports", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [join(dir, e.name)] : [],
      );
    const code = (file: string): string => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const naming = files(src).filter((file) => code(file).includes("virtual:dayhike-wgsl-map"));
    expect(naming.map((file) => relative(src, file))).toEqual(["game/gpuEngine.ts"]);
    // The modules that fetch and read it, and the one that names it, are
    // reached from main.ts only through the WebGPU module's dynamic import.
    const reached = new Set<string>();
    const stack = [join(src, "main.ts")];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const m of readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["'](\.[^"']+)\.js["']/gm)) {
        stack.push(join(file, "..", `${m[1] as string}.ts`));
      }
    }
    expect(reached.size).toBeGreaterThan(20);
    const lookup = [...reached].map((file) => relative(src, file)).filter((file) => /gpuEngine|shaderLookup|wgslMap|wgslStore|wgslFormat/.test(file));
    expect(lookup).toEqual([]);
  });

  it("loads nothing of the asynchronous pipelines on a WebGL2 page: only the WebGPU module reaches them, and only a WebGPU engine's renderer is given them", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    /** Every module `entry` reaches by a runtime import (types aside). */
    const reachedFrom = (entry: string): Set<string> => {
      const reached = new Set<string>();
      const stack = [entry];
      while (stack.length > 0) {
        const file = stack.pop() as string;
        if (reached.has(file)) continue;
        reached.add(file);
        for (const m of readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["'](\.[^"']+)\.js["']/gm)) {
          stack.push(join(file, "..", `${m[1] as string}.ts`));
        }
      }
      return reached;
    };
    const fromMain = [...reachedFrom(join(src, "main.ts"))].map((file) => relative(src, file));
    expect(fromMain.length).toBeGreaterThan(20);
    expect(fromMain.filter((file) => /asyncPipelines/.test(file))).toEqual([]);
    expect([...reachedFrom(join(src, "game/gpuEngine.ts"))].map((file) => relative(src, file))).toContain("game/asyncPipelines.ts");
    // The engine is made by its module, which hands the game the patch and
    // the reveal beside it; the page asks it for none.
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    expect(main).not.toContain("startWebGpu");
    const gpu = readFileSync(join(src, "game/gpuEngine.ts"), "utf8");
    expect(gpu).toContain("  return { engine: await createWebGpuEngine(canvas, options), watchers: WATCHERS };");
    expect(gpu).toContain("  asyncPipelines: (engine) => asyncPipelinesOf(engineOf(engine)),");
    expect(gpu).toContain("  reveal: (engine, lift) => revealWhenWhole(engineOf(engine), lift),");
    // The game holds its first frames only on a WebGPU engine, and gives the
    // patch only to a renderer on one.
    const app = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");
    expect(app.match(/\bholdReveal\(/g)).toEqual(["holdReveal("]);
    expect(app).toContain('if (renderer.engineName === "webgpu" && watchers !== null) {');
    // The hold gives way to a switch's own cover and to the game's end
    // (`revealHold.test.ts` shows what lifting it does; the app itself needs a
    // page to run).
    const switchNow = app.slice(app.indexOf("  async function switchNow("), app.indexOf("\n  }\n", app.indexOf("  async function switchNow(")));
    expect(switchNow.indexOf("endRevealHold();")).toBeGreaterThan(0);
    expect(switchNow.indexOf("swapRenderer(")).toBeGreaterThan(switchNow.indexOf("endRevealHold();"));
    // The switch's cover also waits for a frame that left nothing out, on
    // what is left of its bound, after the scene is ready.
    const ready = switchNow.indexOf("await renderer.whenReady(made.leftMs);");
    expect(ready).toBeGreaterThan(0);
    expect(switchNow.indexOf("await whenFrameWhole(")).toBeGreaterThan(ready);
    const dispose = app.slice(app.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose.indexOf("endRevealHold();")).toBeGreaterThan(0);
    expect(dispose.indexOf("endRevealHold();")).toBeLessThan(dispose.indexOf("renderer.dispose();"));
    expect(app).toContain("engine !== null && watchers !== null ? (watchers.asyncPipelines(engine) ?? undefined) : undefined");
  });

  it("imports the WebGPU module of Babylon.js nowhere in the page: not at run time, not for its type", () => {
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    expect(main.match(/import\("\.\/game\/gpuEngine\.js"\)/g)).toBeNull();
    expect(main).not.toContain("gpuEngine");
  });
});
