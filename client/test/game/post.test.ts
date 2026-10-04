import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine, NullEngineOptions } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import finishFx from "../../src/game/shaders/finish.fragment.fx?raw";
import { createPost, finishFragmentFor, fxSupportedBy } from "../../src/game/post.js";
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
      post.update(WEATHER_PRESETS.eerie, 17, 0, 1, 0);
      post.update(WEATHER_PRESETS.clear, 12, 0, 0, 0);
      post.dispose();
      camera.dispose();
    }
  });

  it("with the material path, update writes the grade record onto the image processing config", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, 0);
    const ip = scene.imageProcessingConfiguration;
    expect(ip.vignetteEnabled).toBe(true);
    expect(ip.colorCurves?.midtonesDensity ?? 0).toBeGreaterThan(0);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0);
    expect(ip.colorCurves?.midtonesDensity).toBe(0);
    // The exposure is the lighting's to write on this path, the stare's
    // dimming with it (`Lighting.setStare`): the grade's record leaves it be.
    ip.exposure = 0.7;
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, 0.5);
    expect(ip.exposure).toBe(0.7);
    post.dispose();
  });

  it("writes the split-tone grade onto colorCurves when weather changes", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 12, 0, 1, 0);
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
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0);
    const c = scene.imageProcessingConfiguration.colorCurves;
    expect(c?.shadowsDensity).toBe(0);
    expect(c?.midtonesDensity).toBe(0);
    expect(c?.highlightsDensity).toBe(0);
    expect(c?.midtonesSaturation).toBe(0);
    post.dispose();
  });

  it("attaches the passes in the spec's order on high and medium, the lens's slot empty until there is rain on the glass", () => {
    const names = (tier: "high" | "medium") => {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      // `_postProcesses` is `Nullable<PostProcess>[]`: a detached pass leaves
      // a null in its slot, read here as null.
      const fresh = camera._postProcesses.map((p) => p?.name ?? null);
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 1);
      const order = camera._postProcesses.map((p) => p?.name ?? null);
      post.dispose();
      camera.dispose();
      return { fresh, order };
    };
    expect(names("high")).toEqual({
      fresh: ["scene", "halationExtract", "halationBlurX", "halationBlurY", "grade", "chromaticAberration", "fxaa", null, "finish"],
      order: ["scene", "halationExtract", "halationBlurX", "halationBlurY", "grade", "chromaticAberration", "fxaa", "lens", "finish"],
    });
    expect(names("medium")).toEqual({
      fresh: ["grade", "chromaticAberration", "fxaa", null, "finish"],
      order: ["grade", "chromaticAberration", "fxaa", "lens", "finish"],
    });
  });

  it("builds the lens at ratio 1.0 with its uniforms and samplers, on both tiers", () => {
    for (const tier of ["high", "medium"] as const) {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      expect(post.features.lens).toBe(true);
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 1);
      const lens = passNamed(camera, "lens");
      expect(ratioOf(lens)).toBe(1.0);
      // Babylon appends its own `scale` and `textureSampler` to what a pass declares.
      expect((lens as unknown as { _parameters: string[] })._parameters).toEqual(["lensStrength", "time", "aspect", "texelSize", "scale"]);
      expect((lens as unknown as { _samplers: string[] })._samplers).toEqual(["lensSampler", "textureSampler"]);
      post.dispose();
      camera.dispose();
    }
  });

  it("binds the droplet map, wrapping, bilinear and without mips, and the texel size, the same on both tiers", () => {
    for (const tier of ["high", "medium"] as const) {
      const bigEngine = nullEngineAt(1920, 1080);
      const bigScene = new Scene(bigEngine);
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
      const post = createPost(bigScene, camera, postFeaturesFor(tier, true));
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 1);
      const lens = passNamed(camera, "lens");
      const calls: { fn: string; args: unknown[] }[] = [];
      const fakeEffect = new Proxy(
        {},
        { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
      ) as unknown as Effect;
      lens.onApplyObservable.notifyObservers(fakeEffect);
      const droplets = calls.find((c) => c.fn === "setTexture");
      expect(droplets?.args[0]).toBe("lensSampler");
      expect(droplets?.args[1]).toBeInstanceOf(RawTexture);
      expect((droplets?.args[1] as RawTexture).wrapU).toBe(Texture.WRAP_ADDRESSMODE);
      expect((droplets?.args[1] as RawTexture).wrapV).toBe(Texture.WRAP_ADDRESSMODE);
      expect((droplets?.args[1] as RawTexture).noMipmap).toBe(true);
      expect((droplets?.args[1] as RawTexture).samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
      const texel = calls.find((c) => c.fn === "setFloat2");
      expect(texel?.args[0]).toBe("texelSize");
      expect(texel?.args[1]).toBeCloseTo(0.0005208333333333333, 15);
      expect(texel?.args[2]).toBeCloseTo(0.0009259259259259259, 15);
      // No other texture: the frost is the scene itself, read in the shader.
      expect(calls.filter((c) => c.fn.startsWith("setTexture")).map((c) => c.args[0])).toEqual(["lensSampler"]);
      post.dispose();
      camera.dispose();
      bigScene.dispose();
      bigEngine.dispose();
    }
  });

  it("hands the lens its strength, the clock folded modulo an hour and the frame's aspect", () => {
    const bigEngine = nullEngineAt(1920, 1080);
    const bigScene = new Scene(bigEngine);
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
    let ms = 0;
    const post = createPost(bigScene, camera, postFeaturesFor("medium", true), { now: () => ms });
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.3);
    ms = 3_601_000;
    const calls: { fn: string; args: unknown[] }[] = [];
    const fakeEffect = new Proxy(
      {},
      { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
    ) as unknown as Effect;
    passNamed(camera, "lens").onApplyObservable.notifyObservers(fakeEffect);
    const floats = Object.fromEntries(calls.filter((c) => c.fn === "setFloat").map((c) => [c.args[0], c.args[1]]));
    expect(floats["lensStrength"]).toBe(0.3);
    expect(floats["time"]).toBe(1);
    expect(floats["aspect"]).toBeCloseTo(1.7777777777777777, 12);
    post.dispose();
    camera.dispose();
    bigScene.dispose();
    bigEngine.dispose();
  });

  it("hands the grade pass the night factor: the identity white point and no rods by day, the night white and the rods' 0.8 at night", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("medium", true));
    const uniforms = (): { floats: Record<string, unknown>; whitePoint: number[] } => {
      const calls: { fn: string; args: unknown[] }[] = [];
      const fakeEffect = new Proxy(
        {},
        { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
      ) as unknown as Effect;
      passNamed(camera, "grade").onApplyObservable.notifyObservers(fakeEffect);
      const floats = Object.fromEntries(calls.filter((c) => c.fn === "setFloat").map((c) => [c.args[0], c.args[1]]));
      const white = calls.find((c) => c.fn === "setMatrix3x3" && c.args[0] === "whitePoint");
      return { floats, whitePoint: Array.from(white?.args[1] as Float32Array) };
    };
    // Sunset at clear, where the warm dusk white point was, with a night
    // factor of 0: no warmth and no rods.
    post.update(WEATHER_PRESETS.clear, 18, 0, 1, 0);
    const day = uniforms();
    expect(day.floats["purkinjeStrength"]).toBe(0);
    expect(day.whitePoint).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    post.update(WEATHER_PRESETS.clear, 0, 1, 1, 0);
    const night = uniforms();
    expect(night.floats["purkinjeStrength"]).toBeCloseTo(0.8, 6);
    // The night white's blue gain, as a float32 uniform.
    expect(night.whitePoint[8]).toBeCloseTo(1.242522254356526, 6);
    post.dispose();
    camera.dispose();
  });

  it("starts the lens detached, attaches it at 0.02, and detaches it a second after its strength falls under that, in its slot", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    let ms = 0;
    const post = createPost(scene, camera, postFeaturesFor("medium", true), { now: () => ms });
    const names = () => camera._postProcesses.map((p) => p?.name ?? null);
    const attached = ["grade", "chromaticAberration", "fxaa", "lens", "finish"];
    const detached = ["grade", "chromaticAberration", "fxaa", null, "finish"];
    expect(names()).toEqual(detached);
    // An update with no strength (every other call site) leaves it so.
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0);
    expect(names()).toEqual(detached);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.019);
    expect(names()).toEqual(detached);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.02);
    expect(names()).toEqual(attached);
    ms = 999;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.019);
    expect(names()).toEqual(attached);
    ms = 1000;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.019);
    expect(names()).toEqual(attached);
    ms = 1999;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.019);
    expect(names()).toEqual(detached);
    // Back above the floor: attached at once, in the same slot.
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0.02);
    expect(names()).toEqual(attached);
    // The idle clock restarts from the fall, not from the last attach.
    ms = 1500;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0);
    ms = 2499;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0);
    expect(names()).toEqual(attached);
    ms = 2500;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 0);
    expect(names()).toEqual(detached);
    // Disposing a detached lens leaves the chain's other passes to their own dispose.
    post.dispose();
    expect(camera._postProcesses.filter((p) => p !== null)).toEqual([]);
    camera.dispose();
  });

  it("multisamples the first pass of the chain when the engine can, and leaves the rest at 1", () => {
    expect(MSAA_SAMPLES).toBe(4);
    for (const tier of ["high", "medium"] as const) {
      // NullEngine reports no MSAA cap; raise it the way a real WebGL2 engine does.
      engine.getCaps().maxMSAASamples = 4;
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, 0, 1);
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

describe("the halation's sizes on the WebGPU engine (canaries on the installed engine)", () => {
  // The size tests above run under NullEngine, the WebGL path. They hold on
  // WebGPU because the sizing is the post process's own, with no engine branch:
  // each pass's `activate` sizes its input target (the previous pass's write
  // target) from its own ratio, the manager chains them the same way on both
  // engines, and neither engine rounds a target to a power of two.
  const read = (spec: string) => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
  const between = (src: string, from: string, to: string) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("sizes a pass's input target from its own ratio, the same on every engine", () => {
    const activate = between(read("@babylonjs/core/PostProcesses/postProcess.pure.js"), "    activate(cameraOrScene, sourceTexture = null, forceDepthStencil) {", "    get isSupported() {");
    expect(activate).toContain(
      "const requiredWidth = ((sourceTexture ? sourceTexture.width : this._engine.getRenderWidth(true)) * this._options) | 0;",
    );
    expect(activate).toContain("desiredWidth = engine.needPOTTextures ? GetExponentOfTwo(desiredWidth, maxSize, this.scaleMode) : desiredWidth;");
    expect(activate).not.toContain("isWebGPU");
  });

  it("chains each pass's output into the next pass's activation, the same on every engine", () => {
    const manager = read("@babylonjs/core/PostProcesses/postProcessManager.js");
    expect(manager).toContain("pp._outputTexture = postProcesses[index + 1].activate(camera, targetTexture?.texture);");
    expect(manager).not.toContain("isWebGPU");
  });

  it("rounds no target to a power of two on WebGPU, as on WebGL2", () => {
    expect(read("@babylonjs/core/Engines/webgpuEngine.pure.js")).toContain("    get needPOTTextures() {\n        return false;\n    }");
    expect(read("@babylonjs/core/Engines/thinEngine.pure.js")).toContain(
      "    get needPOTTextures() {\n        return this._webGLVersion < 2 || this.forcePOTTextures;\n    }",
    );
  });
});

describe("the finish pass's text per engine", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("is the file itself on WebGL2", () => {
    expect(sha(finishFragmentFor(false))).toBe("4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5");
  });
  it("turns uniformity analysis off for itself alone on WebGPU", () => {
    // Its second read of the scene sits inside a branch on vUV. The target has
    // one mip level, so the implicit LOD it gives up cannot pick another.
    expect(finishFragmentFor(true)).toBe("#define DISABLE_UNIFORMITY_ANALYSIS\n" + finishFx);
  });
  it("uses the words Babylon's WebGPU engine looks for (a canary on the installed engine)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(src).toContain("const disableUniformityAnalysisInFragment = fragmentCode.indexOf(`#define DISABLE_UNIFORMITY_ANALYSIS`) >= 0;");
  });
});
