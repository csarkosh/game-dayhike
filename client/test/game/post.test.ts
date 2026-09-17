import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createPost, fxSupportedBy } from "../../src/game/post.js";
import { postFeaturesFor, MSAA_SAMPLES } from "../../src/game/postParams.js";
import { WEATHER_PRESETS, gradeUnder, saturationUnder } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("createPost under NullEngine — the silent-degradation contract", () => {
  it("reports no float render targets, so every tier is pass-free", () => {
    expect(fxSupportedBy(engine)).toBe(false);
    for (const tier of ["low", "medium", "high"] as const) {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, fxSupportedBy(engine)));
      expect(post.features.pipeline).toBe(false);
      expect(camera._postProcesses.length).toBe(0);
      post.update(WEATHER_PRESETS.eerie, 17, 1, 0);
      post.update(WEATHER_PRESETS.clear, 12, 0, 0);
      post.dispose();
      camera.dispose();
    }
  });

  it("with the material path, update writes the grade record onto the image processing config", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 17, 1, 0);
    const ip = scene.imageProcessingConfiguration;
    expect(ip.vignetteEnabled).toBe(true);
    expect(ip.colorCurves?.midtonesDensity ?? 0).toBeGreaterThan(0);
    post.update(WEATHER_PRESETS.clear, 12, 1, 0);
    expect(ip.colorCurves?.midtonesDensity).toBe(0);
    post.dispose();
  });

  it("writes the split-tone grade onto colorCurves when weather changes", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 12, 1, 0);
    const c = scene.imageProcessingConfiguration.colorCurves;
    const g = gradeUnder(WEATHER_PRESETS.eerie);
    expect(c?.globalSaturation).toBe(saturationUnder(WEATHER_PRESETS.eerie));
    expect(c?.shadowsHue).toBe(g.shadowsHue);
    expect(c?.shadowsDensity).toBe(g.shadowsDensity);
    expect(c?.shadowsSaturation).toBe(g.shadowsSaturation);
    expect(c?.midtonesHue).toBe(g.midtonesHue);
    expect(c?.midtonesDensity).toBe(g.midtonesDensity);
    expect(c?.midtonesSaturation).toBe(g.midtonesSaturation);
    expect(c?.highlightsHue).toBe(g.highlightsHue);
    expect(c?.highlightsDensity).toBe(g.highlightsDensity);
    expect(c?.highlightsSaturation).toBe(g.highlightsSaturation);
    post.dispose();
  });

  it("leaves the colour filter inert under clear — the sunny frame is untouched", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.clear, 12, 1, 0);
    const c = scene.imageProcessingConfiguration.colorCurves;
    expect(c?.shadowsDensity).toBe(0);
    expect(c?.midtonesDensity).toBe(0);
    expect(c?.highlightsDensity).toBe(0);
    expect(c?.midtonesSaturation).toBe(0);
    post.dispose();
  });

  it("attaches the passes in the spec's order on high and medium", () => {
    const names = (tier: "high" | "medium") => {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      // `_postProcesses` is `Nullable<PostProcess>[]`; `?.` keeps TS happy and
      // still fails the assertion below if a slot is ever null, since `toEqual`
      // would then see `undefined` where a pass name is expected.
      const order = camera._postProcesses.map((p) => p?.name);
      post.dispose();
      camera.dispose();
      return order;
    };
    expect(names("high")).toEqual(["scene", "halationExtract", "halationBlurX", "halationBlurY", "grade", "chromaticAberration", "fxaa", "finish"]);
    expect(names("medium")).toEqual(["grade", "chromaticAberration", "fxaa", "finish"]);
  });

  it("multisamples the first pass of the chain when the engine can, and leaves the rest at 1", () => {
    expect(MSAA_SAMPLES).toBe(4);
    for (const tier of ["high", "medium"] as const) {
      // NullEngine reports no MSAA cap; raise it the way a real WebGL2 engine does.
      engine.getCaps().maxMSAASamples = 4;
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      const passes = camera._postProcesses.map((p) => p!);
      expect(passes[0]!.name).toBe(tier === "high" ? "scene" : "grade");
      expect(passes[0]!.samples).toBe(MSAA_SAMPLES);
      for (const p of passes.slice(1)) expect(p.samples, p.name).toBe(1);
      post.dispose();
      camera.dispose();
    }
  });

  it("asks for no multisampling when the engine reports no cap", () => {
    const caps = engine.getCaps() as { maxMSAASamples?: number };
    delete caps.maxMSAASamples;
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("high", true));
    expect(camera._postProcesses[0]!.samples).toBe(1);
    post.dispose();
    camera.dispose();
  });
});
