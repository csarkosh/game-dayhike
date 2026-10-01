import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { MaterialPluginManager } from "@babylonjs/core/Materials/materialPluginManager.pure.js";
import { CliffTintPlugin } from "../../src/game/cliffTintPlugin.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";
import { PLUGIN_ORDER, pinPluginNumbers } from "../../src/game/pluginNumbers.js";

/** Babylon 9.18's page-wide numbering of plugin classes. */
type Numbering = { _MaterialPluginClassToMainDefine: Record<string, string>; _MaterialPluginCounter: number };
const numbering = MaterialPluginManager as unknown as Numbering;

let saved: { map: Record<string, string>; counter: number };
beforeEach(() => {
  saved = { map: numbering._MaterialPluginClassToMainDefine, counter: numbering._MaterialPluginCounter };
});
afterEach(() => {
  numbering._MaterialPluginClassToMainDefine = saved.map;
  numbering._MaterialPluginCounter = saved.counter;
});

/** The plugin define a material carries, `MATERIALPLUGIN_<n>`. */
const pluginDefine = (material: Material): string[] =>
  Object.keys((material as unknown as { pluginManager: { _defineNamesFromPlugins: Record<string, unknown> } }).pluginManager._defineNamesFromPlugins).filter((name) =>
    name.startsWith("MATERIALPLUGIN_"),
  );

type Model = "fade" | "cliff";

/**
 * One load of a page: Babylon's numbering as a page begins it; whatever
 * `before` adds first (a landing scene drawn on WebGL2, say); the engine made,
 * with the numbers pinned or not; then a material for each model in the
 * order the models arrive, each with its plugin. Each material's plugin
 * define, by model.
 */
function load(arrival: readonly Model[], pin: boolean, before: readonly Model[] = []): Record<Model, string[]> {
  numbering._MaterialPluginClassToMainDefine = {};
  numbering._MaterialPluginCounter = 0;
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const made = (model: Model): Material => {
    const material = new PBRMaterial(`${model}-${Math.random()}`, scene);
    if (model === "fade") new DistanceFadePlugin(material);
    else new CliffTintPlugin(material);
    return material;
  };
  try {
    for (const model of before) made(model);
    if (pin) pinPluginNumbers();
    const defines = {} as Record<Model, string[]>;
    for (const model of arrival) defines[model] = pluginDefine(made(model));
    return defines;
  } finally {
    engine.dispose();
  }
}

describe("the material plugins' numbers", () => {
  it("are the same on every load once pinned, whatever order the models arrive in and whatever came before", () => {
    const loads = [
      load(["fade", "cliff"], true),
      load(["cliff", "fade"], true),
      load(["cliff", "fade"], true, ["cliff"]),
      load(["fade", "cliff"], true, ["fade", "cliff"]),
    ];
    for (const defines of loads) expect(defines).toEqual({ fade: ["MATERIALPLUGIN_11"], cliff: ["MATERIALPLUGIN_10"] });
    // Unpinned, as Babylon numbers them: by what comes first.
    expect(load(["fade", "cliff"], false)).not.toEqual(load(["cliff", "fade"], false));
  });

  it("number every class the game's materials carry: Babylon's own on a PBR and a Standard material, and every plugin class in src/", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const carried = [new PBRMaterial("pbr", scene), new StandardMaterial("standard", scene)].flatMap((material) =>
        (material as unknown as { pluginManager?: { _plugins: { getClassName(): string }[] } }).pluginManager?._plugins.map((plugin) => plugin.getClassName()) ?? [],
      );
      expect(carried.length).toBeGreaterThan(0);
      expect(carried.filter((name) => !PLUGIN_ORDER.includes(name))).toEqual([]);
    } finally {
      engine.dispose();
    }
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const games = files(src).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/class \w+ extends MaterialPluginBase \{[\s\S]*?getClassName\(\): string \{\s*return "(\w+)";/g)].map((m) => m[1] as string);
    });
    expect(games.length).toBe(12);
    expect(games.filter((name) => !PLUGIN_ORDER.includes(name))).toEqual([]);
    expect(new Set(PLUGIN_ORDER).size).toBe(PLUGIN_ORDER.length);
  });

  it("are Babylon's to give by first registration, keyed by class name, from a page-wide counter (a canary on the installed Babylon)", () => {
    const resolve = createRequire(import.meta.url).resolve;
    const manager = readFileSync(resolve("@babylonjs/core/Materials/materialPluginManager.pure.js"), "utf8");
    expect(manager).toContain(
      "        const pluginClassName = plugin.getClassName();\n" +
        "        if (!MaterialPluginManager._MaterialPluginClassToMainDefine[pluginClassName]) {\n" +
        '            MaterialPluginManager._MaterialPluginClassToMainDefine[pluginClassName] = "MATERIALPLUGIN_" + ++MaterialPluginManager._MaterialPluginCounter;\n' +
        "        }",
    );
    expect(manager).toContain("MaterialPluginManager._MaterialPluginClassToMainDefine = {};\nMaterialPluginManager._MaterialPluginCounter = 0;");
    // Pinned, a class the list does not name is numbered after it.
    numbering._MaterialPluginClassToMainDefine = { SomethingEarlier: "MATERIALPLUGIN_1" };
    numbering._MaterialPluginCounter = 1;
    pinPluginNumbers();
    expect(numbering._MaterialPluginClassToMainDefine.PBRBRDFConfiguration).toBe("MATERIALPLUGIN_1");
    expect(numbering._MaterialPluginClassToMainDefine.WingPlugin).toBe("MATERIALPLUGIN_17");
    // What the recorded corpus carries: wetLine stages say 18, waterBedHeight stages 19.
    expect(numbering._MaterialPluginClassToMainDefine.WetPlugin).toBe("MATERIALPLUGIN_18");
    expect(numbering._MaterialPluginClassToMainDefine.WaterPlugin).toBe("MATERIALPLUGIN_19");
    // Appended after them, so neither number above moved.
    expect(numbering._MaterialPluginClassToMainDefine.RainPlugin).toBe("MATERIALPLUGIN_20");
    expect(numbering._MaterialPluginClassToMainDefine.SomethingEarlier).toBe(undefined);
    expect(numbering._MaterialPluginCounter).toBe(20);
  });

  it("are pinned by the WebGPU engine's maker once its engine stands, before any of its materials", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/game/gpuEngine.ts", import.meta.url)), "utf8");
    expect(src).toContain("    StandardMaterial.ForceGLSL = true;\n    // Before any of its materials: every plugin class's define numbered the\n    // same on every load, so a stage's text, and its key, is too.\n    pinPluginNumbers();\n    return engine;");
    // Nowhere else: a page that never makes a WebGPU engine keeps Babylon's own numbering.
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const calling = files(root).filter((file) => /\bpinPluginNumbers\(\);/.test(readFileSync(file, "utf8")));
    expect(calling.map((file) => file.slice(root.length + 1))).toEqual(["game/gpuEngine.ts"]);
  });
});
