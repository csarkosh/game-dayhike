import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseEngine, engineForTier, WEBGPU_ENABLED, WEBGPU_TIERS, type EngineInput } from "../../src/game/engineChoice.js";
import { autoPick, qualityLine, runProbe } from "../../src/game/frameProbe.js";
import type { GpuSignals } from "../../src/game/gpuSignals.js";
import type { AutoRecord, ProbeReading, QualityTier } from "../../src/game/quality.js";
import { readAutoRecord } from "../../src/game/tierChoice.js";

/**
 * With `WEBGPU_ENABLED` false, as shipped, a player's start is what it is on
 * the tier detection branch: the same tier decision, the same engine
 * (WebGL2), the same records and log lines, the engine's name aside. Nothing
 * of WebGPU is fetched: its module is never imported, so no translator is.
 */
describe("the start with the WebGPU switch off", () => {
  const TIERS: readonly QualityTier[] = ["low", "medium", "high"];

  it("ships off", () => {
    expect(WEBGPU_ENABLED).toBe(false);
  });

  it("draws every tier on WebGL2 without asking for WebGPU: the module is never imported, no translator fetched", async () => {
    for (const tier of TIERS) {
      for (const remembered of [false, true]) {
        for (const fits of [null, false, true]) {
          const input: EngineInput = { tier, override: null, remembered, on: WEBGPU_ENABLED, fits };
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

  it("keys Auto's verdicts on WebGL2, so its tier decision and its records are the tier detection branch's", async () => {
    // The engine `main.ts` keys the verdicts on (`verdictEngineNow`).
    expect(chooseEngine({ tier: WEBGPU_TIERS[0] as QualityTier, override: null, remembered: false, on: WEBGPU_ENABLED, fits: true })).toBe("webgl2");
    const signals: GpuSignals = {
      renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
    };
    const verdict = { tier: "high" as const, source: "probe" as const, pixels: 2_073_600, at: 1_790_000_000_000 - 1 };
    const records: (AutoRecord | null)[] = [
      null,
      { v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null },
      { v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0, verdict },
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

  it("reaches the WebGPU path only through the rule: `makeWebGpu` called once, from behind `engineForTier`", () => {
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    // Its definition, and the one call the rule gates.
    expect(main.match(/\bmakeWebGpu\(/g)).toEqual(["makeWebGpu(", "makeWebGpu("]);
    expect(main).toContain("function makeWebGpu(");
    expect(main).toContain("engineForTier(input, () => makeWebGpu(canvas, input, read, current, wanted))");
    // The translators are started in one place, inside it.
    expect(main.match(/\bloadTranslators\(/g)).toEqual(["loadTranslators("]);
    const inside = main.slice(main.indexOf("function makeWebGpu("), main.indexOf("\n}\n", main.indexOf("function makeWebGpu(")));
    expect(inside).toContain("translators = await gpu.loadTranslators();");
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
    // The engine is made with the page's switch, and its module hands the
    // game the patch and the reveal.
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    expect(main).toContain("engine: await gpu.createWebGpuEngine(canvas, { ms, features, translators, lookup, pipelines }),");
    expect(main).toContain("watchers: { failures: gpu.watchWebGpu, pipelines: gpu.watchPipelines, asyncPipelines: gpu.asyncPipelinesOf, reveal: gpu.revealWhenWhole },");
    // The game holds its first frames only on a WebGPU engine, and gives the
    // patch only to a renderer on one.
    const app = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");
    expect(app.match(/watchers\.reveal\(/g)).toEqual(["watchers.reveal("]);
    expect(app).toContain("if (renderer.engine.isWebGPU && watchers !== null) {");
    expect(app).toContain("engine !== null && watchers !== null ? (watchers.asyncPipelines(engine) ?? undefined) : undefined");
  });

  it("imports the WebGPU module in one place, on the path the rule sends to WebGPU", () => {
    const main = readFileSync(fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "utf8");
    // The one runtime import (the other names the module's type only).
    expect(main.match(/(?<!typeof )import\("\.\/game\/gpuEngine\.js"\)/g)).toEqual(['import("./game/gpuEngine.js")']);
    // `engineFor` asks the rule first; only an answer other than WebGL2 goes on
    // to `makeWebGpu`, whose `load` is that import.
    expect(main).toContain("  return engineForTier(input, () => makeWebGpu(canvas, input, read, current, wanted)).then(");
  });
});
