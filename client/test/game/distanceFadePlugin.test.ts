import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import {
  attachDistanceFade,
  DistanceFadePlugin,
  FADE_ALWAYS,
  fadeBands,
  fadeKeeps,
  fadeVisibility,
  fadeWeight,
  ign,
  writeFadeBands,
} from "../../src/game/distanceFadePlugin.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("fadeVisibility mirror", () => {
  it("is 0 before an in-band, 1 after it, monotone across it", () => {
    const b = fadeBands([100, 120], null);
    expect(fadeVisibility(50, b)).toBe(0);
    expect(fadeVisibility(100, b)).toBe(0);
    expect(fadeVisibility(120, b)).toBe(1);
    expect(fadeVisibility(500, b)).toBe(1);
    expect(fadeVisibility(110, b)).toBeCloseTo(0.5, 9);
    let prev = 0;
    for (let d = 100; d <= 120; d += 0.5) {
      const v = fadeVisibility(d, b);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("is 1 before an out-band, 0 at and beyond it", () => {
    const b = fadeBands(null, [36, 42]);
    expect(fadeVisibility(0, b)).toBe(1);
    expect(fadeVisibility(36, b)).toBe(1);
    expect(fadeVisibility(42, b)).toBe(0);
    expect(fadeVisibility(60, b)).toBe(0);
    expect(fadeVisibility(39, b)).toBeCloseTo(0.5, 9);
  });
  it("multiplies the two, and the no-op bands are 1 everywhere from 0 to 1e7", () => {
    const b = fadeBands([100, 120], [1800, 2000]);
    expect(fadeVisibility(110, b)).toBeCloseTo(0.5, 9);
    expect(fadeVisibility(1900, b)).toBeCloseTo(0.5, 9);
    expect(fadeVisibility(500, b)).toBe(1);
    for (const d of [0, 1, 50, 1e4, 1e7]) expect(fadeVisibility(d, FADE_ALWAYS)).toBe(1);
  });
  it("never has two equal edges in a no-op band (smoothstep is undefined there)", () => {
    const [a, b, c, d] = FADE_ALWAYS;
    expect(a).toBeLessThan(b);
    expect(c).toBeLessThan(d);
  });
});

describe("fadeKeeps — the GLSL discard predicate mirror (the seam partition)", () => {
  it("partitions every pixel at a seam: exactly one bucket keeps each (d, noise), except at the crossover", () => {
    // The outgoing (inner) bucket fades OUT across [76, 85]; the incoming
    // (outer) bucket fades IN across the same band. `v` is the shared
    // visibility term both sides key off — `fadeVisibility` against the
    // inner bucket's own bands is exactly that term, since its (missing)
    // in-band is always 1.
    const inner = fadeBands(null, [76, 85]);
    const outer = fadeBands([76, 85], null);
    for (let d = 70; d <= 90; d += 0.25) {
      const v = fadeVisibility(d, inner);
      for (let k = 0; k < 200; k++) {
        const n = k / 200;
        const keepsInner = fadeKeeps(d, inner, n);
        const keepsOuter = fadeKeeps(d, outer, n);
        if (Math.abs(n - v) < 1e-9) {
          // Only at the exact crossover may both sides legitimately agree
          // to keep the boundary pixel — a tie, not a gap or a double draw.
          expect(keepsInner, `d=${d} n=${n} (crossover)`).toBe(true);
          expect(keepsOuter, `d=${d} n=${n} (crossover)`).toBe(true);
        } else {
          expect(keepsInner, `d=${d} n=${n}`).not.toBe(keepsOuter);
        }
      }
    }
  });

  it("a two-band bucket keeps everything between its bands, at every noise", () => {
    const both = fadeBands([36, 42], [76, 85]);
    for (let d = 42; d <= 76; d += 1) {
      for (let k = 0; k < 200; k++) {
        expect(fadeKeeps(d, both, k / 200), `d=${d} n=${k / 200}`).toBe(true);
      }
    }
  });

  it("FADE_ALWAYS keeps everything at every noise, from 0 to 1e7", () => {
    for (const d of [0, 1, 50, 1e4, 1e7]) {
      for (let k = 0; k < 200; k++) {
        expect(fadeKeeps(d, FADE_ALWAYS, k / 200), `d=${d} n=${k / 200}`).toBe(true);
      }
    }
  });

  it("keeps nothing before an in-band, at any noise", () => {
    const b = fadeBands([100, 120], null);
    for (let k = 0; k < 200; k++) {
      expect(fadeKeeps(50, b, k / 200), `n=${k / 200}`).toBe(false);
    }
  });
});

describe("fadeWeight (wildlifeMeshes.ts's CPU-side pooled-clone sibling)", () => {
  it("is 1 inside the start, 0 at and beyond the end, monotone between", () => {
    expect(fadeWeight(0, 14, 20)).toBe(1);
    expect(fadeWeight(14, 14, 20)).toBe(1);
    expect(fadeWeight(20, 14, 20)).toBe(0);
    expect(fadeWeight(25, 14, 20)).toBe(0);
    expect(fadeWeight(17, 14, 20)).toBeCloseTo(0.5, 9);
    let prev = 1;
    for (let d = 14; d <= 20; d += 0.25) {
      const w = fadeWeight(d, 14, 20);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });
});

describe("interleaved gradient noise mirror", () => {
  it("lies in [0, 1) and is not constant across a 4x4 block", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = ign(x + 0.5, y + 0.5);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        seen.add(Math.round(v * 1000));
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });
});

describe("writeFadeBands", () => {
  it("writes four floats at the offset and nothing else", () => {
    const buf = new Float32Array(12).fill(-9);
    writeFadeBands(buf, 4, fadeBands([1, 2], [3, 4]));
    expect(Array.from(buf)).toEqual([-9, -9, -9, -9, 1, 2, 3, 4, -9, -9, -9, -9]);
  });
});

describe("distance fade plugin", () => {
  // Force-attached: these tests exercise the plugin's own mechanics (hooks,
  // GLSL, GLSL-300 migration), not the gating `attachDistanceFade` itself
  // applies — that gating gets its own describe block below.
  function pluginFor(name: string): DistanceFadePlugin {
    const mat = new PBRMaterial(name, scene);
    attachDistanceFade(mat, { force: true });
    return mat.pluginManager!.getPlugin("DistanceFade") as DistanceFadePlugin;
  }
  it("registers once per material and activates through the manager", () => {
    const mat = new PBRMaterial("df1", scene);
    attachDistanceFade(mat, { force: true });
    attachDistanceFade(mat, { force: true });
    const plugin = mat.pluginManager?.getPlugin("DistanceFade");
    expect(plugin).toBeInstanceOf(DistanceFadePlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof DistanceFadePlugin)).toHaveLength(1);
  });
  it("declares the define, the attribute, the eye uniform, and the four hooks", () => {
    const plugin = pluginFor("df2");
    expect(plugin.priority).toBe(205);
    const defines: Record<string, boolean> = { DISTANCEFADE: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.DISTANCEFADE).toBe(true);
    const attrs: string[] = [];
    plugin.getAttributes(attrs, scene, undefined as never);
    expect(attrs).toEqual(["fadeBands"]);
    expect(plugin.getUniforms().ubo.map((u) => u.name)).toEqual(["fadeEye"]);
    expect(Object.keys(plugin.getCustomCode("vertex")!).sort()).toEqual(
      ["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"],
    );
    expect(Object.keys(plugin.getCustomCode("fragment")!).sort()).toEqual(
      ["CUSTOM_FRAGMENT_DEFINITIONS", "CUSTOM_FRAGMENT_MAIN_BEGIN"],
    );
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_MAIN_BEGIN!).toContain("discard");
    expect(plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_UPDATE_WORLDPOS!).toContain("finalWorld[3]");
  });
  it("tests the incoming side against 1 - noise (the seam partition)", () => {
    const plugin = pluginFor("df2b");
    expect(plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_MAIN_BEGIN!).toContain("1.0 - dfN");
  });
  it("never spells a hashed preprocessor keyword inside a GLSL comment", () => {
    const plugin = pluginFor("df3");
    const all = [
      ...Object.values(plugin.getCustomCode("vertex")!),
      ...Object.values(plugin.getCustomCode("fragment")!),
      plugin.getUniforms().vertex,
    ].join("\n");
    for (const line of all.split("\n")) {
      const comment = line.indexOf("//");
      if (comment === -1) continue;
      expect(line.slice(comment)).not.toMatch(/#\s*(if|ifdef|ifndef|else|elif|endif|define)/);
    }
  });
  it("migrates to GLSL 300 es with the attribute and varyings intact", async () => {
    const plugin = pluginFor("df4");
    const vert = await processInjected(
      plugin.getUniforms().vertex + plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_DEFINITIONS!,
      ["DISTANCEFADE", "THIN_INSTANCES"], false,
    );
    expect(vert).toContain("in vec4 fadeBands");
    expect(vert).toContain("out vec4 vFadeBands");
    expect(vert).toContain("out float vFadeDist");
    const frag = await processInjected(
      plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!, ["DISTANCEFADE"], true,
    );
    expect(frag).toContain("in vec4 vFadeBands");
    expect(frag).toContain("in float vFadeDist");
  });
});

describe("attachDistanceFade gating (discard defeats early-Z)", () => {
  it("does not attach to an opaque material (default transparencyMode)", () => {
    const mat = new PBRMaterial("gate-opaque", scene);
    attachDistanceFade(mat);
    expect(mat.pluginManager?.getPlugin("DistanceFade")).toBeNull();
  });
  it("attaches to a material with transparencyMode = PBRMATERIAL_ALPHATEST", () => {
    const mat = new PBRMaterial("gate-alphatest", scene);
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    attachDistanceFade(mat);
    expect(mat.pluginManager?.getPlugin("DistanceFade")).toBeInstanceOf(DistanceFadePlugin);
  });
  it("attaches to an opaque material when force: true", () => {
    const mat = new PBRMaterial("gate-forced", scene);
    attachDistanceFade(mat, { force: true });
    expect(mat.pluginManager?.getPlugin("DistanceFade")).toBeInstanceOf(DistanceFadePlugin);
  });
  it("stays idempotent across the alpha-tested and forced paths", () => {
    const alphaTested = new PBRMaterial("gate-idem-alphatest", scene);
    alphaTested.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    attachDistanceFade(alphaTested);
    attachDistanceFade(alphaTested);
    const alphaActive = (alphaTested.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(alphaActive.filter((p) => p instanceof DistanceFadePlugin)).toHaveLength(1);

    const forced = new PBRMaterial("gate-idem-forced", scene);
    attachDistanceFade(forced, { force: true });
    attachDistanceFade(forced, { force: true });
    const forcedActive = (forced.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(forcedActive.filter((p) => p instanceof DistanceFadePlugin)).toHaveLength(1);
  });
});

function processInjected(source: string, defines: string[], isFragment: boolean): Promise<string> {
  const options: _IProcessingOptions = {
    defines, indexParameters: {}, isFragment, shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true, shadersRepository: "", includesShadersStore: {},
    processor: new WebGL2ShaderProcessor(), version: "300", platformName: "WEBGL2",
    processingContext: null, isNDCHalfZRange: false, useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migrated) => resolve(migrated), engine);
  });
}
