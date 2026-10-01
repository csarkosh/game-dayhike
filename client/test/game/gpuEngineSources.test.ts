import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialPluginManager } from "@babylonjs/core/Materials/materialPluginManager.pure.js";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";

/**
 * What the WebGPU engine's maker does by default, seen from outside it: the
 * sources it reads and the plugin numbers it pins. `gpuEngine.test.ts` and
 * `pluginNumbers.test.ts` pin the same two by the maker's text; these hold
 * them by what the maker does. The engine class is replaced at the module
 * boundary, as in `gpuEngineStart.test.ts`, and the map's URL is the one the
 * build would give.
 */
const made = vi.hoisted(() => ({ init: (): Promise<void> => Promise.resolve() }));

vi.mock("@babylonjs/core/Engines/webgpuEngine.pure.js", () => {
  class WebGPUEngine {
    initAsync(): Promise<void> {
      return made.init();
    }
    prepareGlslangAndTintAsync(): Promise<void> {
      return Promise.resolve();
    }
    dispose(): void {}
    _compiledEffects = {};
    _preparePipelineContextAsync(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { WebGPUEngine };
});

vi.mock("virtual:dayhike-wgsl-map", () => ({ default: "/dayhike/assets/wgsl-map-Ab12Cd34.json" }));

import { createWebGpuEngine } from "../../src/game/gpuEngine.js";

const canvas = {} as HTMLCanvasElement;
const TRANSLATORS = { glslang: { compileGLSL: "glslang" }, twgsl: { convertSpirV2WGSL: "twgsl" } };

type Numbering = { _MaterialPluginClassToMainDefine: Record<string, string>; _MaterialPluginCounter: number };
const numbering = MaterialPluginManager as unknown as Numbering;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  made.init = () => Promise.resolve();
  numbering._MaterialPluginClassToMainDefine = {};
  numbering._MaterialPluginCounter = 0;
  PBRBaseMaterial.ForceGLSL = false;
  StandardMaterial.ForceGLSL = false;
});

describe("the WebGPU engine's maker, by default", () => {
  it("asks for the map of translations the build ships, at the URL the build gives", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(String(url));
      return Promise.resolve(new Response("not a map", { status: 404 }));
    });
    await createWebGpuEngine(canvas, { translators: TRANSLATORS });
    expect(asked).toEqual(["/dayhike/assets/wgsl-map-Ab12Cd34.json"]);
  });

  it("numbers the material plugins by the fixed list once its engine stands, and leaves them alone when the start fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    numbering._MaterialPluginClassToMainDefine = { SomethingEarlier: "MATERIALPLUGIN_1" };
    numbering._MaterialPluginCounter = 1;
    made.init = () => Promise.reject(new Error("device refused"));
    await expect(createWebGpuEngine(canvas, { translators: TRANSLATORS })).rejects.toThrow("device refused");
    expect([numbering._MaterialPluginClassToMainDefine, numbering._MaterialPluginCounter]).toEqual([{ SomethingEarlier: "MATERIALPLUGIN_1" }, 1]);
    made.init = () => Promise.resolve();
    await createWebGpuEngine(canvas, { translators: TRANSLATORS });
    expect(numbering._MaterialPluginClassToMainDefine.DistanceFadePlugin).toBe("MATERIALPLUGIN_11");
    expect(numbering._MaterialPluginClassToMainDefine.SomethingEarlier).toBe(undefined);
    expect(numbering._MaterialPluginCounter).toBe(20);
  });
});
