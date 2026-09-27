import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine, NullEngineOptions } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { createPost, fxSupportedBy } from "../../src/game/post.js";
import { postFeaturesFor, MSAA_SAMPLES } from "../../src/game/postParams.js";
import { WEATHER_PRESETS, gradeUnder, saturationUnder } from "../../src/game/weather.js";

// A pass's own ratio (Babylon's private, constructor-set `_options`) sizes the
// target its PREDECESSOR writes into — the general rule the doc comment above
// `createPost` states. `_options` is the exact multiplicand `activate` below
// uses, so this pins the same thing the size test does, without needing a
// sized engine.
function ratioOf(pass: PostProcess): number {
  return (pass as unknown as { _options: number })._options;
}

function passNamed(camera: UniversalCamera, name: string): PostProcess {
  const pass = camera._postProcesses.find((p) => p?.name === name);
  if (pass == null) throw new Error(`no pass named ${name}`);
  return pass;
}

// NullEngine does allocate render targets with a real width and height.
// `PostProcessManager._finalizeFrame` sizes pass i's write target by calling
// `activate` on pass i+1 (this game sets no `outputRenderTarget`, so the
// `sourceTexture` argument is always null and a pass's post-activation
// width/height is simply its own ratio times the drawing buffer) — so
// activating the pass AFTER the one whose write target is in question reads
// that target's real size.
function activatedSize(pass: PostProcess, camera: UniversalCamera): { width: number; height: number } {
  pass.activate(camera, null);
  return { width: pass.width, height: pass.height };
}

function nullEngineAt(renderWidth: number, renderHeight: number): NullEngine {
  const options = new NullEngineOptions();
  options.renderWidth = renderWidth;
  options.renderHeight = renderHeight;
  return new NullEngine(options);
}

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

  it("on high, grade is built at the halation ratio, so blur Y writes a target the same size as blur X's", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("high", true));
    const grade = passNamed(camera, "grade");
    const blurY = passNamed(camera, "halationBlurY");
    // Blur X writes into blur Y's input, sized by blur Y's own ratio; blur Y
    // writes into grade's input, sized by grade's own ratio. Equal ratios
    // here is what makes the two blurs write equal-size targets.
    expect(ratioOf(grade)).toBe(0.25);
    expect(ratioOf(blurY)).toBe(0.25);
    post.dispose();
    camera.dispose();
  });

  it("on high, grade binds the scene from the scene pass and the halation from blur Y's output", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("high", true));
    const scenePass = passNamed(camera, "scene");
    const blurY = passNamed(camera, "halationBlurY");
    const grade = passNamed(camera, "grade");
    const calls: { fn: string; args: unknown[] }[] = [];
    const fakeEffect = new Proxy(
      {},
      { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
    ) as unknown as Effect;
    grade.onApplyObservable.notifyObservers(fakeEffect);
    const sceneCall = calls.find((c) => c.fn === "setTextureFromPostProcess");
    expect(sceneCall?.args).toEqual(["textureSampler", scenePass]);
    const halationCall = calls.find((c) => c.fn === "setTextureFromPostProcessOutput");
    expect(halationCall?.args).toEqual(["halationSampler", blurY]);
    post.dispose();
    camera.dispose();
  });

  it("on medium, grade is built at ratio 1.0 and is the first pass that carries the multisampling", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("medium", true));
    const grade = passNamed(camera, "grade");
    expect(ratioOf(grade)).toBe(1.0);
    expect(camera._postProcesses[0]).toBe(grade);
    post.dispose();
    camera.dispose();
  });

  it("on high at 1920 by 1080, blur X and blur Y write quarter-size targets and grade writes full size", () => {
    const bigEngine = nullEngineAt(1920, 1080);
    const bigScene = new Scene(bigEngine);
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
    const post = createPost(bigScene, camera, postFeaturesFor("high", true));
    // Blur X's write target is blur Y's own input; blur Y's write target is
    // grade's own input; grade's write target is chromatic aberration's own
    // input. See `activatedSize` above for why activating the pass AFTER the
    // one in question reads the right target.
    expect(activatedSize(passNamed(camera, "halationBlurY"), camera)).toEqual({ width: 480, height: 270 });
    expect(activatedSize(passNamed(camera, "grade"), camera)).toEqual({ width: 480, height: 270 });
    expect(activatedSize(passNamed(camera, "chromaticAberration"), camera)).toEqual({ width: 1920, height: 1080 });
    post.dispose();
    camera.dispose();
    bigScene.dispose();
    bigEngine.dispose();
  });

  it("on medium at 1920 by 1080, the scene renders into grade's input at full size", () => {
    const bigEngine = nullEngineAt(1920, 1080);
    const bigScene = new Scene(bigEngine);
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
    const post = createPost(bigScene, camera, postFeaturesFor("medium", true));
    expect(activatedSize(passNamed(camera, "grade"), camera)).toEqual({ width: 1920, height: 1080 });
    post.dispose();
    camera.dispose();
    bigScene.dispose();
    bigEngine.dispose();
  });
});
