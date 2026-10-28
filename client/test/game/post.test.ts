import { PAINT_AMBER, PAINT_ASH, PAINT_OILS } from "../../src/game/gradeParams.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine, NullEngineOptions } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { END_BLUR_KERNEL, END_BLUR_STEPS, endBlurKernel, createPost, FAR_SOFT_BAND, FAR_SOFT_RADIUS, fxSupportedBy } from "../../src/game/post.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import farSoftFx from "../../src/game/shaders/farSoft.fragment.fx?raw";
import { postFeaturesFor, MSAA_SAMPLES, TAA_BLEND, TAA_BLEND_STILL, TAA_CLIP, TAA_SHARPEN, taaBlendFor, taaJitter } from "../../src/game/postParams.js";
import taaFx from "../../src/game/shaders/taa.fragment.fx?raw";
import taaSharpenFx from "../../src/game/shaders/taaSharpen.fragment.fx?raw";
import { WEATHER_PRESETS, gradeUnder, saturationUnder } from "../../src/game/weather.js";
import { STARE_LENS_REST, stareReach, type StareLens } from "../../src/game/stareLens.js";
import { CHASE_SHADOW_DENSITY, CHASE_SHADOW_HUE, gradeRecordUnder, STARE_VIGNETTE } from "../../src/game/gradeParams.js";
import { BlurPostProcess } from "@babylonjs/core/PostProcesses/blurPostProcess.js";

/** A lens half closed, the Hollow to the right, between beats. */
const HALF_STARE: StareLens = { ...STARE_LENS_REST, level: 0.5, phase: 0.6, sideX: 1 };

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
      post.update(WEATHER_PRESETS.eerie, 17, 0, 1, STARE_LENS_REST);
      post.update(WEATHER_PRESETS.clear, 12, 0, 0, STARE_LENS_REST);
      post.dispose();
      camera.dispose();
    }
  });

  it("with the material path, update writes the grade record onto the image processing config", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, STARE_LENS_REST);
    const ip = scene.imageProcessingConfiguration;
    expect(ip.vignetteEnabled).toBe(true);
    expect(ip.colorCurves?.midtonesDensity ?? 0).toBeGreaterThan(0);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST);
    expect(ip.colorCurves?.midtonesDensity).toBe(0);
    // The exposure is the lighting's to write on this path, the stare's
    // dimming with it (`Lighting.setStare`): the grade's record leaves it be.
    ip.exposure = 0.7;
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, HALF_STARE);
    expect(ip.exposure).toBe(0.7);
    // The stare on this path is Babylon's own vignette: heavier by the
    // lens's reach, and its centre moved off the Hollow's side.
    const rest = gradeRecordUnder(WEATHER_PRESETS.eerie, 17, 0, 1).vignetteWeight;
    expect(ip.vignetteWeight).toBeCloseTo(rest + STARE_VIGNETTE * stareReach(HALF_STARE), 2);
    expect(ip.vignetteCenterX).toBeLessThan(0);
    expect(ip.vignetteCenterY).toBeCloseTo(0, 12);
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, STARE_LENS_REST);
    expect(ip.vignetteCenterX).toBe(0);
    // The chase on this path: the shadows turned toward burgundy and deepened.
    const g = gradeUnder(WEATHER_PRESETS.eerie);
    expect(ip.colorCurves!.shadowsHue).toBeCloseTo(g.shadowsHue, 9);
    post.update(WEATHER_PRESETS.eerie, 17, 0, 1, STARE_LENS_REST, 0, 1);
    expect(ip.colorCurves!.shadowsHue).toBeCloseTo(CHASE_SHADOW_HUE, 9);
    expect(ip.colorCurves!.shadowsDensity).toBeCloseTo(g.shadowsDensity + CHASE_SHADOW_DENSITY, 9);
    post.dispose();
  });

  it("writes the split-tone grade onto colorCurves when weather changes", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 12, 0, 1, STARE_LENS_REST);
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
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST);
    const c = scene.imageProcessingConfiguration.colorCurves;
    expect(c?.shadowsDensity).toBe(0);
    expect(c?.midtonesDensity).toBe(0);
    expect(c?.highlightsDensity).toBe(0);
    expect(c?.midtonesSaturation).toBe(0);
    post.dispose();
  });

  // NullEngine draws to one target at a time, so under it there is no prepass
  // and no far softening: the chain pins above are the chain without them.
  // The softening's wiring is pinned against a prepass stood in for the
  // scene's, on an engine told it can draw to several targets.
  describe("the far softening and the prepass it reads", () => {
    type FakePrePass = {
      samples: number;
      dirty: number;
      updates: (string | undefined)[];
      markAsDirty(): void;
      _update(): void;
      getRenderTarget(): { textures: unknown[] };
      getIndex(type: number): number;
    };
    const standIn = (): { prePass: FakePrePass; disabled: () => number } => {
      let disabledCount = 0;
      const depthTexture = { name: "the prepass's depth" };
      const prePass: FakePrePass = {
        samples: 1,
        dirty: 0,
        updates: [],
        markAsDirty() {
          this.dirty++;
        },
        _update() {
          this.updates.push(scene.activeCamera?.name);
        },
        getRenderTarget: () => ({ textures: [{ name: "the prepass's colour" }, depthTexture] }),
        getIndex: (type) => (type === Constants.PREPASS_DEPTH_TEXTURE_TYPE ? 1 : -1),
      };
      engine.getCaps().drawBuffersExtension = true;
      (scene as unknown as { enablePrePassRenderer(): unknown }).enablePrePassRenderer = () => prePass;
      (scene as unknown as { disablePrePassRenderer(): void }).disablePrePassRenderer = () => {
        disabledCount++;
      };
      return { prePass, disabled: () => disabledCount };
    };

    it("is the first pass on high and medium, at ratio 1, asking the prepass for the depth and nothing else, and absent where the engine draws to one target", () => {
      for (const tier of ["high", "medium"] as const) {
        const { prePass } = standIn();
        const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
        const post = createPost(scene, camera, postFeaturesFor(tier, true));
        const names = camera._postProcesses.map((p) => p?.name ?? null);
        expect(names[0]).toBe("farSoft");
        // The temporal anti-aliasing (2026-10-28) and its sharpen follow it, on the softened frame, before the paint.
        expect(names[1]).toBe("taa");
        expect(names[2]).toBe("taaSharpen");
        expect(names[3]).toBe("paint");
        // The paint's compose (2026-10-18) follows it, at half the frame: the paint renders into its half-size input.
        expect(names[4]).toBe("paintCompose");
        expect(ratioOf(passNamed(camera, "paintCompose"))).toBe(0.5);
        expect(names[5]).toBe(tier === "high" ? "scene" : "grade");
        // FXAA is not built where the anti-aliasing is: the chain ends grade, the lens's slot, the end's two.
        expect(names).not.toContain("fxaa");
        expect(names.slice(-3)).toEqual([null, null, null]);
        const farSoft = passNamed(camera, "farSoft");
        expect(ratioOf(farSoft)).toBe(1);
        expect(farSoft._prePassEffectConfiguration).toEqual({ enabled: true, name: "farSoft", texturesRequired: [Constants.PREPASS_DEPTH_TEXTURE_TYPE] });
        expect(prePass.dirty).toBe(1);
        post.dispose();
        camera.dispose();
      }
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      engine.getCaps().drawBuffersExtension = false;
      const post = createPost(scene, camera, postFeaturesFor("high", true));
      const names = camera._postProcesses.map((p) => p?.name ?? null);
      expect(names).not.toContain("farSoft");
      // No depth to reproject with: no anti-aliasing, and FXAA stays for the cards' edges.
      expect(names).not.toContain("taa");
      expect(names).toContain("fxaa");
      post.dispose();
      camera.dispose();
    });

    describe("the temporal anti-aliasing", () => {
      it("is two passes at ratio 1, the second keeping its target, each reading at explicit levels", () => {
        standIn();
        const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
        const post = createPost(scene, camera, postFeaturesFor("medium", true));
        const taa = passNamed(camera, "taa");
        const sharpen = passNamed(camera, "taaSharpen");
        expect(ratioOf(taa)).toBe(1);
        expect(ratioOf(sharpen)).toBe(1);
        expect(sharpen.autoClear).toBe(false);
        expect(taaFx).not.toMatch(/texture2D\(|\btexture\(/);
        expect(taaSharpenFx).not.toMatch(/texture2D\(|\btexture\(/);
        expect(taaFx).toContain("uniform sampler2D historySampler;");
        expect(taaFx).toContain("uniform sampler2D depthSampler;");
        post.dispose();
        camera.dispose();
      });

      it("jitters the projection by the frame's step before the scene renders and restores it after, a new step each frame", () => {
        standIn();
        const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
        scene.activeCamera = camera;
        const post = createPost(scene, camera, postFeaturesFor("medium", true));
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        const row2 = () => [camera.getProjectionMatrix().m[8], camera.getProjectionMatrix().m[9]];
        // The matrix holds floats: close to the step, not equal.
        const expectRow2 = (x: number, y: number) => {
          expect(row2()[0]).toBeCloseTo(x, 9);
          expect(row2()[1]).toBeCloseTo(y, 9);
        };
        expectRow2(0, 0);
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const first = taaJitter(0, width, height);
        expect(first.y).not.toBe(0);
        expectRow2(first.x, first.y);
        scene.onAfterRenderObservable.notifyObservers(scene);
        expectRow2(0, 0);
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const second = taaJitter(1, width, height);
        expect(second).not.toEqual(first);
        expectRow2(second.x, second.y);
        scene.onAfterRenderObservable.notifyObservers(scene);
        post.dispose();
        // Disposed, the chain jitters no more.
        scene.onBeforeRenderObservable.notifyObservers(scene);
        expectRow2(0, 0);
        camera.dispose();
      });

      it("binds the prepass's depth, the history, the camera's basis this frame and last, the parameters, and holds the first frame to itself", () => {
        const bigEngine = nullEngineAt(1920, 1080);
        const bigScene = new Scene(bigEngine);
        bigEngine.getCaps().drawBuffersExtension = true;
        const depthTexture = { name: "depth" };
        const prePass = {
          samples: 1,
          markAsDirty: () => undefined,
          _update: () => undefined,
          getRenderTarget: () => ({ textures: [{ name: "colour" }, depthTexture] }),
          getIndex: (type: number) => (type === Constants.PREPASS_DEPTH_TEXTURE_TYPE ? 1 : -1),
        };
        (bigScene as unknown as { enablePrePassRenderer(): unknown }).enablePrePassRenderer = () => prePass;
        (bigScene as unknown as { disablePrePassRenderer(): void }).disablePrePassRenderer = () => undefined;
        const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
        const post = createPost(bigScene, camera, postFeaturesFor("medium", true));
        const calls: { fn: string; args: unknown[] }[] = [];
        // Babylon uploads a vector as it is set; the pass then reuses the
        // vectors, so what was set is kept as a copy.
        const fakeEffect = new Proxy(
          {},
          { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args: args.map((a) => (a instanceof Vector3 ? a.clone() : a)) }) },
        ) as unknown as Effect;
        const taa = passNamed(camera, "taa");
        taa.onActivateObservable.notifyObservers(camera);
        taa.onApplyObservable.notifyObservers(fakeEffect);
        const named = (fn: string, name: string) => calls.find((c) => c.fn === fn && c.args[0] === name)?.args.slice(1);
        expect(named("setTexture", "depthSampler")).toEqual([depthTexture]);
        expect(named("_bindTexture", "historySampler")).toHaveLength(1);
        expect(named("setFloat2", "texel")).toEqual([1 / 1920, 1 / 1080]);
        const tanY = Math.tan(camera.fov / 2);
        const vector = (name: string): Vector3 => {
          const v = (named("setVector3", name) as Vector3[] | undefined)?.[0];
          if (v === undefined) throw new Error(`${name} not set`);
          return v;
        };
        expect(vector("taaForward").z).toBeCloseTo(1, 6);
        expect(vector("taaUp").y).toBeCloseTo(tanY, 6);
        expect(vector("taaRight").x).toBeCloseTo(tanY * (1920 / 1080), 6);
        expect(vector("taaEye").asArray().map((v) => v + 0)).toEqual([0, 2, 0]);
        // The first frame has no history: last frame's basis is this frame's, and the blend is held off.
        expect(vector("taaPrevEye").asArray().map((v) => v + 0)).toEqual([0, 2, 0]);
        expect(named("setFloat3", "taaParams")).toEqual([TAA_BLEND, TAA_CLIP, 0]);
        // The second frame blends, against the basis the first frame had.
        camera.position.x = 5;
        camera.computeWorldMatrix();
        calls.length = 0;
        taa.onActivateObservable.notifyObservers(camera);
        taa.onApplyObservable.notifyObservers(fakeEffect);
        expect(named("setFloat3", "taaParams")).toEqual([TAA_BLEND, TAA_CLIP, 1]);
        expect(vector("taaEye").x).toBe(5);
        expect(vector("taaPrevEye").x + 0).toBe(0);
        // A frame the camera has not moved in takes the still blend.
        calls.length = 0;
        taa.onActivateObservable.notifyObservers(camera);
        taa.onApplyObservable.notifyObservers(fakeEffect);
        expect(named("setFloat3", "taaParams")).toEqual([TAA_BLEND_STILL, TAA_CLIP, 1]);
        // A turn by half a pixel's angle takes the blend half way between.
        camera.rotation.y = (0.5 * camera.fov) / 1080;
        camera.computeWorldMatrix();
        calls.length = 0;
        taa.onActivateObservable.notifyObservers(camera);
        taa.onApplyObservable.notifyObservers(fakeEffect);
        const params = named("setFloat3", "taaParams") as number[];
        expect(params[0]).toBeCloseTo(taaBlendFor(0.5), 6);
        expect(params.slice(1)).toEqual([TAA_CLIP, 1]);
        // The sharpen lifts by the constant.
        calls.length = 0;
        passNamed(camera, "taaSharpen").onApplyObservable.notifyObservers(fakeEffect);
        expect(named("setFloat", "sharpen")).toEqual([TAA_SHARPEN]);
        post.dispose();
        camera.dispose();
        bigScene.dispose();
        bigEngine.dispose();
      });

      it("keeps two history targets at the frame's size, remade when the frame's size changes, and lets them go at dispose", () => {
        standIn();
        const made: { width: number; height: number; disposed: boolean }[] = [];
        const create = engine.createRenderTargetTexture.bind(engine);
        engine.createRenderTargetTexture = (size, options) => {
          const target = create(size, options);
          const record = { width: target.width, height: target.height, disposed: false };
          made.push(record);
          const dispose = target.dispose.bind(target);
          target.dispose = () => {
            record.disposed = true;
            dispose();
          };
          return target;
        };
        const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
        const post = createPost(scene, camera, postFeaturesFor("medium", true));
        expect(made.map((m) => [m.width, m.height])).toEqual([[engine.getRenderWidth(), engine.getRenderHeight()], [engine.getRenderWidth(), engine.getRenderHeight()]]);
        const taa = passNamed(camera, "taa");
        taa.onActivateObservable.notifyObservers(camera);
        expect(made).toHaveLength(2);
        // NullEngine's size is its options'.
        const sized = engine as unknown as { _options: { renderWidth: number; renderHeight: number } };
        sized._options.renderWidth = 300;
        sized._options.renderHeight = 200;
        taa.onActivateObservable.notifyObservers(camera);
        expect(made.slice(0, 2).every((m) => m.disposed)).toBe(true);
        expect(made.slice(2).map((m) => [m.width, m.height])).toEqual([[300, 200], [300, 200]]);
        post.dispose();
        expect(made.every((m) => m.disposed)).toBe(true);
        camera.dispose();
      });
    });

    it("binds the prepass's depth, the texel and the band each apply, and its shader reads the clear as the far sky at explicit levels", () => {
      const bigEngine = nullEngineAt(1920, 1080);
      const bigScene = new Scene(bigEngine);
      bigEngine.getCaps().drawBuffersExtension = true;
      const depthTexture = { name: "depth" };
      const prePass = {
        samples: 1,
        markAsDirty: () => undefined,
        _update: () => undefined,
        getRenderTarget: () => ({ textures: [{ name: "colour" }, depthTexture] }),
        getIndex: (type: number) => (type === Constants.PREPASS_DEPTH_TEXTURE_TYPE ? 1 : -1),
      };
      (bigScene as unknown as { enablePrePassRenderer(): unknown }).enablePrePassRenderer = () => prePass;
      (bigScene as unknown as { disablePrePassRenderer(): void }).disablePrePassRenderer = () => undefined;
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
      const post = createPost(bigScene, camera, postFeaturesFor("medium", true));
      const calls: { fn: string; args: unknown[] }[] = [];
      const fakeEffect = new Proxy(
        {},
        { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
      ) as unknown as Effect;
      passNamed(camera, "farSoft").onApplyObservable.notifyObservers(fakeEffect);
      expect(calls.slice(0, 3)).toEqual([
        { fn: "setTexture", args: ["depthSampler", depthTexture] },
        { fn: "setFloat2", args: ["texel", 1 / 1920, 1 / 1080] },
        { fn: "setFloat3", args: ["soft", FAR_SOFT_BAND[0], FAR_SOFT_BAND[1], FAR_SOFT_RADIUS] },
      ]);
      // The ground cloud's ray (2026-10-18): the camera's forward, its right
      // and up at the half view's tangents, and the eye; with no cloud handed
      // in, no steps and the chain's black texel for its map.
      const named = (fn: string, name: string) => calls.find((c) => c.fn === fn && c.args[0] === name)?.args.slice(1);
      expect(post.marchesCloud).toBe(true);
      const tanY = Math.tan(camera.fov / 2);
      const forward = named("setFloat3", "farForward") as number[];
      expect(forward[2]).toBeCloseTo(1, 6);
      const up = named("setFloat3", "farUp") as number[];
      expect(up[1]).toBeCloseTo(tanY, 6);
      const right = named("setFloat3", "farRight") as number[];
      expect(right[0]).toBeCloseTo(tanY * (1920 / 1080), 6);
      expect((named("setFloat3", "farEye") as number[]).map((v) => v + 0)).toEqual([0, 2, 0]);
      expect(named("setFloat", "atmCloudSteps")).toEqual([0]);
      expect(named("setTexture", "atmCloudMap")).toHaveLength(1);
      // Handed the atmosphere's binder, it binds that instead.
      const bound: string[] = [];
      post.setCloud(() => bound.push("cloud"));
      calls.length = 0;
      passNamed(camera, "farSoft").onApplyObservable.notifyObservers(fakeEffect);
      expect(bound).toEqual(["cloud"]);
      expect(named("setFloat", "atmCloudSteps")).toBeUndefined();
      expect(FAR_SOFT_BAND).toEqual([80, 450]);
      expect(FAR_SOFT_RADIUS).toBe(5);
      // The reads: every sample at an explicit level, none implicit, so the
      // early leave keeps WGSL's uniformity rule; the clear read as the sky.
      expect(farSoftFx).not.toMatch(/texture2D\(|\btexture\(/);
      // The softening's three, and the cloud march's three (the ground and the two noises), every one explicit.
      expect(farSoftFx.match(/textureLod\(/g)?.length).toBe(6);
      expect(farSoftFx).toContain("return d > 0.0 ? d : FAR_SOFT_SKY;");
      expect(farSoftFx).toContain("uniform sampler2D depthSampler;");
      post.dispose();
      camera.dispose();
      bigScene.dispose();
      bigEngine.dispose();
    });

    it("gives the multisampling to the prepass, keeps the image processing by post process whatever the prepass writes, runs the prepass's update with the chain's camera active, and lets all of it go at dispose", () => {
      engine.getCaps().maxMSAASamples = 4;
      const { prePass, disabled } = standIn();
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const other = new UniversalCamera("other", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor("high", true));
      expect(prePass.samples).toBe(MSAA_SAMPLES);
      for (const p of camera._postProcesses) if (p !== null) expect(p.samples, p.name).toBe(1);
      const image = scene.imageProcessingConfiguration;
      expect(image.applyByPostProcess).toBe(true);
      image.applyByPostProcess = false;
      expect(image.applyByPostProcess).toBe(true);
      scene.activeCamera = other;
      prePass._update();
      expect(prePass.updates).toEqual(["cam"]);
      expect(scene.activeCamera).toBe(other);
      post.dispose();
      expect(disabled()).toBe(1);
      image.applyByPostProcess = false;
      expect(image.applyByPostProcess).toBe(false);
      camera.dispose();
      other.dispose();
    });
  });

  it("attaches the passes in the spec's order on high and medium, the lens's slot empty until there is rain on the glass, and the end's two blurs' until the end", () => {
    const names = (tier: "high" | "medium") => {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      // `_postProcesses` is `Nullable<PostProcess>[]`: a detached pass leaves
      // a null in its slot, read here as null.
      const fresh = camera._postProcesses.map((p) => p?.name ?? null);
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 1);
      const order = camera._postProcesses.map((p) => p?.name ?? null);
      post.dispose();
      camera.dispose();
      return { fresh, order };
    };
    expect(names("high")).toEqual({
      fresh: ["paint", "paintCompose", "scene", "halationExtract", "halationBlurX", "halationBlurY", "grade", "fxaa", null, null, null],
      order: ["paint", "paintCompose", "scene", "halationExtract", "halationBlurX", "halationBlurY", "grade", "fxaa", "lens", null, null],
    });
    expect(names("medium")).toEqual({
      fresh: ["paint", "paintCompose", "grade", "fxaa", null, null, null],
      order: ["paint", "paintCompose", "grade", "fxaa", "lens", null, null],
    });
  });

  it("attaches the end's blurs after the chain while there is any blur, their kernel by it, and detaches them after", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("medium", true));
    const names = () => camera._postProcesses.map((p) => p?.name ?? null);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0, 0, 0.5);
    expect(names()).toEqual(["paint", "paintCompose", "grade", "fxaa", null, "endBlurX", "endBlurY"]);
    const blurs = camera._postProcesses.filter((p) => p?.name.startsWith("endBlur")) as BlurPostProcess[];
    for (const b of blurs) expect(b.kernel).toBeCloseTo(endBlurKernel(0.5), 6);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0, 0, 1);
    for (const b of blurs) expect(b.kernel).toBeCloseTo(END_BLUR_KERNEL, 6);
    // Stepped, never a kernel under the first step: a pass compiles for each kernel it is given.
    expect(endBlurKernel(0.001)).toBeCloseTo(END_BLUR_KERNEL / END_BLUR_STEPS, 9);
    expect(endBlurKernel(0.5)).toBeCloseTo((END_BLUR_KERNEL / END_BLUR_STEPS) * 2, 9);
    expect(endBlurKernel(0)).toBe(0);
    expect(new Set([0.01, 0.2, 0.4, 0.6, 0.8, 1].map(endBlurKernel)).size).toBe(END_BLUR_STEPS);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0, 0, 0);
    expect(names()).toEqual(["paint", "paintCompose", "grade", "fxaa", null, null, null]);
    post.dispose();
    camera.dispose();
  });

  it("builds the lens at ratio 1.0 with its uniforms and samplers, on both tiers", () => {
    for (const tier of ["high", "medium"] as const) {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, true));
      expect(post.features.lens).toBe(true);
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 1);
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
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 1);
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
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.3);
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
    post.update(WEATHER_PRESETS.clear, 18, 0, 1, STARE_LENS_REST);
    const day = uniforms();
    expect(day.floats["purkinjeStrength"]).toBe(0);
    expect(day.whitePoint).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    post.update(WEATHER_PRESETS.clear, 0, 1, 1, STARE_LENS_REST);
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
    const attached = ["paint", "paintCompose", "grade", "fxaa", "lens", null, null];
    const detached = ["paint", "paintCompose", "grade", "fxaa", null, null, null];
    expect(names()).toEqual(detached);
    // An update with no strength (every other call site) leaves it so.
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST);
    expect(names()).toEqual(detached);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.019);
    expect(names()).toEqual(detached);
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.02);
    expect(names()).toEqual(attached);
    ms = 999;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.019);
    expect(names()).toEqual(attached);
    ms = 1000;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.019);
    expect(names()).toEqual(attached);
    ms = 1999;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.019);
    expect(names()).toEqual(detached);
    // Back above the floor: attached at once, in the same slot.
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0.02);
    expect(names()).toEqual(attached);
    // The idle clock restarts from the fall, not from the last attach.
    ms = 1500;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0);
    ms = 2499;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0);
    expect(names()).toEqual(attached);
    ms = 2500;
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 0);
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
      post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST, 1);
      // The end's blurs sit detached, null in their slots, until the end.
      const passes = camera._postProcesses.filter((p) => p !== null);
      // The paint pass is first on both tiers since 2026-10-17, and carries the samples.
      expect(passes[0]!.name).toBe("paint");
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

  it("on medium, grade is built at ratio 1.0 and follows the paint and its compose; the paint is first and carries the multisampling", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("medium", true));
    const grade = passNamed(camera, "grade");
    expect(ratioOf(grade)).toBe(1.0);
    expect(camera._postProcesses[0]).toBe(passNamed(camera, "paint"));
    expect(ratioOf(passNamed(camera, "paint"))).toBe(1.0);
    // The compose's half ratio sizes the paint's own target: the strokes are painted at half the frame.
    expect(camera._postProcesses[1]).toBe(passNamed(camera, "paintCompose"));
    expect(ratioOf(passNamed(camera, "paintCompose"))).toBe(0.5);
    expect(camera._postProcesses[2]).toBe(grade);
    post.dispose();
    camera.dispose();
  });

  it("on high at 1920 by 1080, blur X and blur Y write quarter-size targets and grade writes full size", () => {
    const bigEngine = nullEngineAt(1920, 1080);
    const bigScene = new Scene(bigEngine);
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), bigScene);
    const post = createPost(bigScene, camera, postFeaturesFor("high", true));
    // Blur X's write target is blur Y's own input; blur Y's write target is
    // grade's own input; grade's write target is FXAA's own input. See
    // `activatedSize` above for why activating the pass AFTER the one in
    // question reads the right target.
    expect(activatedSize(passNamed(camera, "halationBlurY"), camera)).toEqual({ width: 480, height: 270 });
    expect(activatedSize(passNamed(camera, "grade"), camera)).toEqual({ width: 480, height: 270 });
    expect(activatedSize(passNamed(camera, "fxaa"), camera)).toEqual({ width: 1920, height: 1080 });
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

describe("the painted palette on the chain", () => {
  it("wears oils until told, fades to the palette given over its seconds, and jumps at 0", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    let ms = 0;
    const post = createPost(scene, camera, postFeaturesFor("medium", true), { now: () => ms });
    expect(post.palette()).toBe(PAINT_OILS);
    post.setPalette(PAINT_ASH, 2);
    expect(post.palette()).toBe(PAINT_OILS);
    ms = 1000;
    const half = post.palette();
    expect(half.shadows.r).toBeCloseTo((PAINT_OILS.shadows.r + PAINT_ASH.shadows.r) / 2, 12);
    expect(half.saturation).toBeCloseTo((PAINT_OILS.saturation + PAINT_ASH.saturation) / 2, 12);
    ms = 2000;
    expect(post.palette()).toBe(PAINT_ASH);
    // The record the grade binds carries the palette of the moment.
    post.update(WEATHER_PRESETS.clear, 12, 0, 1, STARE_LENS_REST);
    // A fade begun mid-fade starts from the palette worn then.
    post.setPalette(PAINT_AMBER, 2);
    ms = 2500;
    post.setPalette(PAINT_OILS, 0);
    expect(post.palette()).toBe(PAINT_OILS);
    post.dispose();
    camera.dispose();
    scene.dispose();
    engine.dispose();
  });
});
