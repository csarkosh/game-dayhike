import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { PassPostProcess } from "@babylonjs/core/PostProcesses/passPostProcess.js";
import { BlurPostProcess } from "@babylonjs/core/PostProcesses/blurPostProcess.js";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";

import type { WeatherParams } from "./weather.js";
import { WEATHER_PRESETS } from "./weather.js";
import { type PaintPalette } from "./gradeParams.js";
import { gradeRecordUnder, type GradeRecord } from "./gradeParams.js";
import { curveSettingsUnder } from "./materialGrade.js";
import type { StareLens } from "./stareLens.js";
import { MSAA_SAMPLES, PAINT_SCALE, type PostFeatures } from "./postParams.js";
import { LENS, lensDropletMap } from "./lensParams.js";
import {
  FAR_CLOUD_UNIFORMS, HALATION_KERNEL, HALATION_RATIO, composeUniforms, createLensGate, createPaletteFade, createTaaFrame, emptyFarSoftUniforms,
  emptyGradeUniforms, emptyTaaUniforms, endBlurKernel, extractUniforms, farSoftUniforms, gradeUniforms, lensUniforms, paintUniforms, sharpenUniforms,
  type PostView,
} from "./postFrame.js";
import halationExtractFragment from "./shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "./shaders/grade.fragment.fx?raw";
import lensFragment from "./shaders/lens.fragment.fx?raw";
import farSoftFragment from "./shaders/farSoft.fragment.fx?raw";
import paintFragment from "./shaders/paint.fragment.fx?raw";
import paintComposeFragment from "./shaders/paintCompose.fragment.fx?raw";
import taaFragment from "./shaders/taa.fragment.fx?raw";
import taaSharpenFragment from "./shaders/taaSharpen.fragment.fx?raw";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper.js";
// Registers `scene.enablePrePassRenderer`, the far softening's depth.
import "@babylonjs/core/Rendering/prePassRendererSceneComponent.js";
import type { PrePassRenderer } from "@babylonjs/core/Rendering/prePassRenderer.js";

export type Post = {
  readonly features: PostFeatures;
  /** `night` is the sky's night factor (`SkyState.night`), which the white
   * point and the rods follow. `lens` is the smoothed strength of the rain
   * on the glass (lensParams.ts), 0 when dry. */
  update(weather: WeatherParams, hour: number, night: number, unsettle: number, stare: StareLens, lens?: number, chase?: number, blur?: number): void;
  /** The painted palette (gradeParams.ts) the frames wear from now, faded
   * from the one they wear over `fadeSeconds` (PAINT_FADE_SECONDS unless
   * given; 0 at once). On the material path there is no grade and nothing
   * changes. */
  setPalette(palette: PaintPalette, fadeSeconds?: number): void;
  /** The palette the frames wear this moment, mid-fade included. */
  palette(): PaintPalette;
  /** The haunt's mask to read the shades from, and whether any shade is in it this frame (shadeSilhouette.ts). */
  setShades(mask: BaseTexture | null, any: boolean): void;
  /** Whether the chain marches the ground cloud (the far softening's pass,
   * which reads the scene's depth): where it does, the renderer hands it the
   * atmosphere's cloud (`setCloud`) and the materials draw none. */
  readonly marchesCloud: boolean;
  /** What binds the cloud's uniforms and map to the far softening's effect each frame (`Atmosphere.bindCloud`). */
  setCloud(bind: ((effect: Effect) => void) | null): void;
  dispose(): void;
};

// The chain's numbers and each pass's uniforms are made with no engine (`postFrame.ts`).
export {
  END_BLUR_KERNEL, END_BLUR_STEPS, FAR_CLOUD_UNIFORMS, FAR_SOFT_BAND, FAR_SOFT_RADIUS, SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK, endBlurKernel,
} from "./postFrame.js";

/** The capability every HDR pass needs: float or half-float render targets. */
export function fxSupportedBy(engine: AbstractEngine): boolean {
  const caps = engine.getCaps();
  return Boolean(caps.textureHalfFloatRender || caps.textureFloatRender);
}

/**
 * The post chain: the far softening first (where the engine draws to several
 * targets at once; below), the temporal anti-aliasing and its sharpen on the
 * softened frame, the paint, then on high a full-resolution scene pass, then
 * halation extract and blur, then the grade pass, then the lens; on medium
 * the scene pass and halation are skipped. Where there is no far softening
 * (no prepass, so no depth to reproject with) there is no temporal
 * anti-aliasing either, and FXAA follows the grade instead. Passes attach in
 * creation order, which is what fixes the order — the anti-aliasing must run
 * before the paint smears the edges it is settling, and FXAA before the dither.
 *
 * The temporal anti-aliasing (2026-10-28, `taa.fragment.fx`): the scene is
 * drawn each frame with the projection moved by a fraction of a pixel along
 * an eight-step Halton walk (`taaJitter`), and the pass blends the frame into
 * the history of the frames before it at `TAA_BLEND`, the history found by
 * rebuilding each pixel's point from the prepass's depth and projecting it
 * with last frame's camera, and held to the current frame's neighbourhood
 * (`TAA_CLIP`) so what moves of itself does not trail. It writes into one of
 * two history targets in turn, which the sharpen pass (`taaSharpen.fragment.fx`,
 * `TAA_SHARPEN`) copies on down the chain and which the next frame reads as
 * its history. What it settles: the leaf cards' alpha-tested edges
 * fluttering against the sky, and the shadow map's texel pops under the
 * explore day's fast sun, neither of which the multisampling touches
 * (`docs/rendering/2026-10-28-temporal-anti-aliasing.md`).
 *
 * The far softening (2026-10-16, `farSoft.fragment.fx`) blurs the frame past
 * `FAR_SOFT_BAND` metres of camera depth by a radius rising to
 * `FAR_SOFT_RADIUS` texels, each read kept only where it is not much nearer
 * than the texel itself, so the far field's cards and rims melt into a mass
 * without the near grass bleeding into it. Its depth is the scene's own:
 * Babylon's prepass renderer draws the camera-space depth as a second target
 * of the scene's one pass, with the materials' own shaders, so every vertex
 * plugin's displacement and every alpha test holds in it and nothing is
 * drawn twice. The prepass's targets are then the first pass's input, and
 * the multisampling goes to them. On an engine without multiple render
 * targets there is no softening and the chain starts as before.
 *
 * The scene pass exists only because Babylon renders the scene straight into
 * the FIRST post-process's own input render target: on high that would
 * otherwise be `halationExtract`, whose ratio (`HALATION_RATIO`, a deliberate
 * quarter resolution for the extract's own INPUT, which the previous pass
 * writes) would size the scene render itself, rasterising the entire frame
 * at quarter resolution. A `PassPostProcess` at ratio 1.0 in front of the
 * halation chain absorbs that ratio instead, so the scene always renders
 * full-resolution regardless of what the halation extract downsamples to.
 * `grade.onApply` reads the scene from the scene pass's INPUT (the true
 * full-resolution render), not from `halationExtract`'s input (which would
 * give the same texture indirectly, but only because the scene pass happens
 * to sit in front of it — binding the scene pass directly does not depend on
 * that chaining detail).
 *
 * A pass's own ratio sizes the render target the previous pass writes into,
 * not the pass's own output. On high, `grade` is therefore built at
 * `HALATION_RATIO` rather than 1.0: that makes `halationBlurY` write a
 * quarter-size target and take its blur step there, matching `halationBlurX`,
 * instead of writing full size and taking a step a quarter as long vertically
 * as horizontally — the glow was 76 by 22 px at half its peak before this,
 * 74 by 74 px after (see `docs/rendering/2026-09-27-halation-blur-size.md`).
 * `grade`'s own OUTPUT is unaffected: it draws into the next pass's
 * input, whose ratio stays 1.0, so `grade` still writes full size regardless
 * of the ratio it was built with. On medium there is no halation chain ahead
 * of it, so `grade` is the FIRST pass and its ratio sizes the scene render
 * itself (the same hazard the scene pass exists to avoid on high) — there it
 * stays 1.0.
 *
 * FXAA is constructed directly as `FxaaPostProcess` rather than through `DefaultRenderingPipeline`: the
 * pipeline's `imageProcessingEnabled = false` writes
 * `scene.imageProcessingConfiguration.isEnabled = false`, which is scene-wide
 * and turns off `IMAGEPROCESSINGPOSTPROCESS` in every PBR material — so
 * materials would gamma-encode and clamp to [0, 1] before the grade pass ever
 * sees them. Nothing here touches `imageProcessingConfiguration.isEnabled` or
 * `applyByPostProcess`; `lighting.ts` sets `applyByPostProcess = true` on the
 * post path, which is what keeps materials outputting linear HDR.
 *
 * Every pipeline pass shares one half-float (or float, on hardware without
 * half-float render targets) `textureType`, `finish` included — a pass's
 * `textureType` sizes its INPUT render target, and the dither needs
 * higher-than-8-bit input to read a clean signal; the canvas remains the
 * 8-bit destination regardless.
 *
 * On the material path no post-process is created and `image.colorCurves` is
 * only ensured to exist here; `update()` writes the same grade record onto
 * Babylon's in-material image processing (the vignette and the colour
 * curves) every call. The exposure there, the stare's dimming included, is
 * the lighting's to write (`Lighting.setStare`), so the applies of a weather
 * fade, which run inside the render after this, keep it.
 */
export function createPost(scene: Scene, camera: Camera, features: PostFeatures, options: { now?: () => number } = {}): Post {
  /** The clock (ms) the effects' motion reads: the renderer's, so a stepped scene steps them. */
  const now = options.now ?? (() => performance.now());
  const engine = scene.getEngine();
  const image = scene.imageProcessingConfiguration;
  let grade: PostProcess | null = null;
  let scenePass: PassPostProcess | null = null;
  let extract: PostProcess | null = null;
  let blurX: BlurPostProcess | null = null;
  let blurY: BlurPostProcess | null = null;
  let fxaa: FxaaPostProcess | null = null;
  /** The temporal anti-aliasing (2026-10-28) and the sharpen that carries its frame on. */
  let taa: PostProcess | null = null;
  let taaSharpen: PostProcess | null = null;
  /** The anti-aliasing's two history targets, read and written in turn. */
  let taaPing: RenderTargetWrapper | null = null;
  let taaPong: RenderTargetWrapper | null = null;
  const taaObservers: (() => void)[] = [];
  let lens: PostProcess | null = null;
  /** The far field's softening (2026-10-16) and the prepass whose depth it reads. */
  let farSoft: PostProcess | null = null;
  /** What binds the ground cloud to the far softening's pass (`setCloud`), and a scratch axis. */
  let cloudBinder: ((effect: Effect) => void) | null = null;
  /** The camera as the passes rebuild a pixel's ray from it (`PostView`), read as a pass applies. */
  const axes = { eye: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3() };
  const viewNow = (): PostView => {
    camera.getDirectionToRef(Vector3.Forward(), axes.forward);
    camera.getDirectionToRef(Vector3.Right(), axes.right);
    camera.getDirectionToRef(Vector3.Up(), axes.up);
    // After the directions: reading them computes the world matrix the global position is of.
    axes.eye.copyFrom(camera.globalPosition);
    return { ...axes, fov: camera.fov, aspect: engine.getAspectRatio(camera) };
  };
  const farValues = emptyFarSoftUniforms();
  const gradeValues = emptyGradeUniforms();
  let prePass: PrePassRenderer | null = null;
  /** The paint pass (2026-10-17): the frame smeared into strokes, after the far softening and before the grade. */
  let paint: PostProcess | null = null;
  /** The paint's compose (2026-10-18): the half-size strokes back over the full frame, by the frame's own edges. */
  let paintCompose: PostProcess | null = null;
  let droplets: RawTexture | null = null;
  let black: RawTexture | null = null;
  // The lens's gate: its strength this frame, the slot it holds in the
  // camera's chain, whether it is attached, and when it last fell idle.
  let lensStrength = 0;
  let lensSlot = -1;
  let lensAttached = false;
  const lensGate = createLensGate();
  /** The end's softening (ending.ts): two blur passes after the chain, attached while there is any, their kernel by it. */
  let endBlurX: BlurPostProcess | null = null;
  let endBlurY: BlurPostProcess | null = null;
  let endBlurAttached = false;
  let endBlurSlot = -1;
  function setEndBlur(blur: number): void {
    if (endBlurX === null || endBlurY === null) return;
    if (blur <= 0) {
      if (endBlurAttached) {
        camera.detachPostProcess(endBlurX);
        camera.detachPostProcess(endBlurY);
        endBlurAttached = false;
      }
      return;
    }
    if (!endBlurAttached) {
      // Back into their own slots, after FXAA, as the lens returns to its.
      camera.attachPostProcess(endBlurX, endBlurSlot);
      camera.attachPostProcess(endBlurY, endBlurSlot + 1);
      endBlurAttached = true;
    }
    const kernel = endBlurKernel(blur);
    if (endBlurX.kernel !== kernel) {
      endBlurX.kernel = kernel;
      endBlurY.kernel = kernel;
    }
  }
  let record: GradeRecord = gradeRecordUnder(WEATHER_PRESETS.clear, 12, 0, 1);
  // The painted palette: the one the frames fade from, the one they fade
  // to, when the fade began (ms of `now`) and how long it takes.
  const paletteFade = createPaletteFade(now);
  /** The haunt's mask (shadeSilhouette.ts), once handed in, and whether any shade is in it this frame. */
  let shadeMask: BaseTexture | null = null;
  let shadeAny = false;
  /** Seconds since the chain was made, which the grade's dither moves by. */
  let ditherSeconds = 0;
  const start = now();

  if (features.pipeline) {
    const textureType = engine.getCaps().textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : Constants.TEXTURETYPE_FLOAT;
    Effect.ShadersStore["halationExtractFragmentShader"] = halationExtractFragment;
    Effect.ShadersStore["gradeFragmentShader"] = gradeFragment;
    Effect.ShadersStore["lensFragmentShader"] = lensFragment;
    Effect.ShadersStore["farSoftFragmentShader"] = farSoftFragment;
    Effect.ShadersStore["paintFragmentShader"] = paintFragment;
    Effect.ShadersStore["paintComposeFragmentShader"] = paintComposeFragment;
    Effect.ShadersStore["taaFragmentShader"] = taaFragment;
    Effect.ShadersStore["taaSharpenFragmentShader"] = taaSharpenFragment;

    // The far softening, first in the chain, on the scene as rendered. Its
    // depth is the scene's own: Babylon's prepass draws the camera-space
    // depth as a second target of the scene's one pass, from the materials'
    // own shaders, so every vertex plugin's displacement and every alpha test
    // holds in it, and there is no second pass over the geometry. The same
    // on WebGL2 and WebGPU. A material that cannot draw to several targets
    // (the sky dome's, the midges') leaves the depth target at its clear, 0,
    // which the shader reads as the far sky. Where the engine has no
    // multiple render targets there is no softening.
    if (engine.getCaps().drawBuffersExtension) prePass = scene.enablePrePassRenderer();
    if (prePass !== null) {
      // The prepass sets `applyByPostProcess` each frame from whether the
      // chain holds Babylon's own image-processing pass. The grade is not
      // it, and a false there would have every material tone-map in its own
      // shader, so the flag is pinned to the true `lighting.ts` sets on this
      // path; the instance's accessor goes with the prepass at dispose.
      image.applyByPostProcess = true;
      Object.defineProperty(image, "applyByPostProcess", { configurable: true, get: () => true, set: () => undefined });
      farSoft = new PostProcess("farSoft", "farSoft", ["texel", "soft", ...FAR_CLOUD_UNIFORMS], ["depthSampler", "atmCloudMap"], 1.0, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      // The prepass draws for the passes that ask it for a target: it reads
      // each pass's configuration as it updates, and draws the depth once
      // one asks for it.
      farSoft._prePassEffectConfiguration = { enabled: true, name: "farSoft", texturesRequired: [Constants.PREPASS_DEPTH_TEXTURE_TYPE] };
      // It reads that chain from the scene's active camera when it updates,
      // which is at the first draw after anything marks it dirty: its own
      // creation, a pass attached or detached (the lens, the end's blurs).
      // That draw is as often a render target's, the lake's mirror or the
      // impostors' bake, whose own camera is the active one then, and the
      // prepass, finding no chain on it, would switch itself off. Its
      // update runs with the chain's camera active.
      const withChainCamera = prePass as unknown as { _update(): void };
      const prepassUpdate = withChainCamera._update.bind(prePass);
      withChainCamera._update = () => {
        const was = scene.activeCamera;
        scene.activeCamera = camera;
        try {
          prepassUpdate();
        } finally {
          scene.activeCamera = was;
        }
      };
      prePass.markAsDirty();
      const bound = prePass;
      farSoft.onApply = (effect) => {
        const target = bound.getRenderTarget();
        effect.setTexture("depthSampler", target.textures[bound.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE)] ?? null);
        // The ground cloud's march (farSoft.fragment.fx): the ray through each
        // pixel is the camera's forward plus the pixel's place across the
        // view, the right and up axes each at the half view's tangent. With
        // nothing bound it marches no steps.
        const u = farSoftUniforms(viewNow(), engine.getRenderWidth(), engine.getRenderHeight(), farValues);
        effect.setFloat2("texel", u.texel[0], u.texel[1]);
        effect.setFloat3("soft", u.soft[0], u.soft[1], u.soft[2]);
        effect.setFloat3("farForward", u.farForward[0], u.farForward[1], u.farForward[2]);
        effect.setFloat3("farRight", u.farRight[0], u.farRight[1], u.farRight[2]);
        effect.setFloat3("farUp", u.farUp[0], u.farUp[1], u.farUp[2]);
        effect.setFloat3("farEye", u.farEye[0], u.farEye[1], u.farEye[2]);
        if (cloudBinder !== null) cloudBinder(effect);
        else {
          effect.setFloat("atmCloudSteps", 0);
          if (black !== null) effect.setTexture("atmCloudMap", black);
        }
      };
    }

    if (features.taa && farSoft !== null && prePass !== null) {
      // The temporal anti-aliasing, right after the far softening, on the
      // scene's linear colour: see the chain's note above.
      const bound = prePass;
      taa = new PostProcess("taa", "taa",
        ["texel", "taaEye", "taaForward", "taaRight", "taaUp", "taaPrevEye", "taaPrevForward", "taaPrevRight", "taaPrevUp", "taaParams"],
        ["historySampler", "depthSampler"], 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      const sharpen = new PostProcess("taaSharpen", "taaSharpen", ["texel", "sharpen"], [], 1.0, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      taaSharpen = sharpen;
      // The sharpen's input is whichever history target the anti-aliasing
      // just wrote, swapped in at its activation, so its target is never
      // cleared: the clear would be of the history itself.
      sharpen.autoClear = false;
      sharpen.onApply = (effect) => {
        const u = sharpenUniforms(engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("texel", u.texel[0], u.texel[1]);
        effect.setFloat("sharpen", u.sharpen[0]);
      };
      let flip = 0;
      // The jitter's walk and the camera the last frame was seen through (`postFrame.ts`).
      const taaFrame = createTaaFrame();
      const taaValues = emptyTaaUniforms();
      const TAA_VECTORS = ["taaEye", "taaForward", "taaRight", "taaUp", "taaPrevEye", "taaPrevForward", "taaPrevRight", "taaPrevUp"] as const;
      const taaVectors = TAA_VECTORS.map(() => new Vector3());
      const makeTargets = (): void => {
        taaPing?.dispose();
        taaPong?.dispose();
        const size = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
        const opts = { generateMipMaps: false, generateDepthBuffer: false, type: textureType, samplingMode: Texture.BILINEAR_SAMPLINGMODE };
        taaPing = engine.createRenderTargetTexture(size, opts);
        taaPong = engine.createRenderTargetTexture(size, opts);
        taaFrame.reset();
      };
      makeTargets();
      // The jitter: the projection's third row carries the clip-space offset
      // (it multiplies by the depth, so the offset is the same at every
      // depth), set on the matrix Babylon has just computed, and the matrix
      // computed afresh after the render so nothing else sees the offset.
      const jitter = scene.onBeforeRenderObservable.add(() => {
        const proj = camera.getProjectionMatrix(true);
        const { x, y } = taaFrame.jitter(engine.getRenderWidth(), engine.getRenderHeight());
        proj.setRowFromFloats(2, x, y, proj.m[10] ?? 1, proj.m[11] ?? 1);
      });
      const unjitter = scene.onAfterRenderObservable.add(() => {
        camera.getProjectionMatrix(true);
      });
      taaObservers.push(() => {
        scene.onBeforeRenderObservable.remove(jitter);
        scene.onAfterRenderObservable.remove(unjitter);
      });
      taa.onActivateObservable.add(() => {
        if (taaPing === null || taaPing.width !== engine.getRenderWidth() || taaPing.height !== engine.getRenderHeight()) makeTargets();
        sharpen.inputTexture = (flip ? taaPing : taaPong)!;
        flip ^= 1;
      });
      taa.onApply = (effect) => {
        const target = bound.getRenderTarget();
        effect.setTexture("depthSampler", target.textures[bound.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE)] ?? null);
        const history = (flip ? taaPing : taaPong)!;
        effect._bindTexture("historySampler", history.texture);
        // The camera's basis this frame and last: its eye, its forward axis, and its right and up axes each at the
        // half view's tangent; and the blend by how far the camera moved since the last frame. The first frame, and
        // the first after the targets are remade, has no history: last frame's basis is this frame's, and the blend
        // is held off.
        const u = taaFrame.step(viewNow(), engine.getRenderWidth(), engine.getRenderHeight(), taaValues);
        effect.setFloat2("texel", u.texel[0], u.texel[1]);
        TAA_VECTORS.forEach((name, i) => {
          effect.setVector3(name, (taaVectors[i] as Vector3).set(u[name][0], u[name][1], u[name][2]));
        });
        effect.setFloat3("taaParams", u.taaParams[0], u.taaParams[1], u.taaParams[2]);
      };
    }

    if (features.paint > 0) {
      // The paint: a generalized Kuwahara at the tier's stroke radius, on the
      // scene's linear colour (after the far softening, which reads the depth
      // of the scene as rendered), ahead of the halation's extract and the
      // grade, so the halo and the colour identity are taken from the painted
      // frame. It paints at half the frame's pixels on each axis
      // (`PAINT_SCALE`): the compose after it takes the half-size target,
      // which the paint therefore renders into, and writes the full frame,
      // each pixel from the painted texels round it whose scene is like its
      // own, mixed with the scene by the paint's strength.
      const strokes = features.paint;
      paint = new PostProcess("paint", "paint", ["texel", "radius"], [], 1.0, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      paint.onApply = (effect) => {
        const u = paintUniforms(strokes, engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("texel", u.texel[0], u.texel[1]);
        effect.setFloat("radius", u.radius[0]);
      };
      paintCompose = new PostProcess("paintCompose", "paintCompose", ["halfTexel", "strength"], ["sceneSampler"], PAINT_SCALE, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      const boundPaint = paint;
      paintCompose.onApply = (effect) => {
        // The paint's own input: the frame as it came to the paint, full size.
        effect.setTextureFromPostProcess("sceneSampler", boundPaint);
        const u = composeUniforms(engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("halfTexel", u.halfTexel[0], u.halfTexel[1]);
        effect.setFloat("strength", u.strength[0]);
      };
    }

    if (features.halation) {
      // Absorbs the halation extract's quarter-resolution ratio so the scene
      // itself always renders full-resolution — see the doc comment above.
      scenePass = new PassPostProcess("scene", 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      extract = new PostProcess("halationExtract", "halationExtract", ["exposure"], [], HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      extract.onApply = (effect) => {
        effect.setFloat("exposure", extractUniforms(record).exposure[0]);
      };
      blurX = new BlurPostProcess("halationBlurX", new Vector2(1, 0), HALATION_KERNEL, HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      blurY = new BlurPostProcess("halationBlurY", new Vector2(0, 1), HALATION_KERNEL, HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
    }
    // A black texel for any sampler with nothing to read: the halation's without halation, the shades' without a mask.
    black = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);

    // On high, grade's own ratio sizes blur Y's write target (Babylon sizes
    // a pass's write target by the NEXT pass's ratio — see the doc comment
    // above). Building grade at HALATION_RATIO makes blur Y write a
    // quarter-size target and take its blur step there, matching blur X.
    // grade's own OUTPUT is unaffected: it draws into aberration's input,
    // which stays ratio 1.0, so grade still writes full size. On medium,
    // grade is the FIRST pass (no halation chain ahead of it), so its ratio
    // sizes the scene render itself and must stay 1.0.
    const gradeRatio = features.halation ? HALATION_RATIO : 1.0;
    grade = new PostProcess("grade", "grade",
      ["exposure", "whitePoint", "purkinje", "purkinjeThreshold", "purkinjeStrength", "shadowTint", "shadowAmount",
        "midtoneTint", "midtoneAmount", "highlightTint", "highlightAmount", "saturation", "lift", "vignetteWeight",
        "vignetteColour", "halationStrength", "stareShade", "chaseTint", "chaseLift", "shadeShape", "shadeMonster", "texelSize", "time",
        "paintShadowTint", "paintShadowAmount", "paintMidtoneTint", "paintMidtoneAmount", "paintHighlightTint", "paintHighlightAmount",
        "paintSaturation", "paintCurve", "paintLift"],
      ["halationSampler", "shadeSampler"], gradeRatio, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
    const boundScenePass = scenePass;
    const boundBlurY = blurY;
    const boundBlack = black;
    grade.onApply = (effect) => {
      // The record's values under the shader's names, the dither's clock (2026-10-18, the finish pass's before, which
      // the grade's end now draws) and the shades' shape (`gradeUniforms`).
      const u = gradeUniforms(record, engine.getRenderWidth(), engine.getRenderHeight(), ditherSeconds, shadeMask !== null && shadeAny, gradeValues);
      effect.setFloat2("texelSize", u.texelSize[0], u.texelSize[1]);
      effect.setFloat("time", u.time[0]);
      // With halation the scene is the scene pass's INPUT (setTextureFromPostProcess
      // binds a pass's input texture, and the scene pass's own input is the
      // camera's actual render since it is first in the chain); without
      // halation the chain's previous output is already the scene, so
      // textureSampler needs no override.
      if (boundScenePass !== null) effect.setTextureFromPostProcess("textureSampler", boundScenePass);
      if (boundBlurY !== null) effect.setTextureFromPostProcessOutput("halationSampler", boundBlurY);
      else if (boundBlack !== null) effect.setTexture("halationSampler", boundBlack);
      effect.setFloat("exposure", u.exposure[0]);
      effect.setMatrix3x3("whitePoint", Float32Array.from(u.whitePoint));
      effect.setMatrix3x3("purkinje", Float32Array.from(u.purkinje));
      effect.setFloat("purkinjeThreshold", u.purkinjeThreshold[0]);
      effect.setFloat("purkinjeStrength", u.purkinjeStrength[0]);
      effect.setFloat3("shadowTint", u.shadowTint[0], u.shadowTint[1], u.shadowTint[2]);
      effect.setFloat2("shadowAmount", u.shadowAmount[0], u.shadowAmount[1]);
      effect.setFloat3("midtoneTint", u.midtoneTint[0], u.midtoneTint[1], u.midtoneTint[2]);
      effect.setFloat2("midtoneAmount", u.midtoneAmount[0], u.midtoneAmount[1]);
      effect.setFloat3("highlightTint", u.highlightTint[0], u.highlightTint[1], u.highlightTint[2]);
      effect.setFloat2("highlightAmount", u.highlightAmount[0], u.highlightAmount[1]);
      effect.setFloat("saturation", u.saturation[0]);
      effect.setFloat3("lift", u.lift[0], u.lift[1], u.lift[2]);
      effect.setFloat("vignetteWeight", u.vignetteWeight[0]);
      effect.setFloat3("vignetteColour", u.vignetteColour[0], u.vignetteColour[1], u.vignetteColour[2]);
      effect.setFloat3("paintShadowTint", u.paintShadowTint[0], u.paintShadowTint[1], u.paintShadowTint[2]);
      effect.setFloat2("paintShadowAmount", u.paintShadowAmount[0], u.paintShadowAmount[1]);
      effect.setFloat3("paintMidtoneTint", u.paintMidtoneTint[0], u.paintMidtoneTint[1], u.paintMidtoneTint[2]);
      effect.setFloat2("paintMidtoneAmount", u.paintMidtoneAmount[0], u.paintMidtoneAmount[1]);
      effect.setFloat3("paintHighlightTint", u.paintHighlightTint[0], u.paintHighlightTint[1], u.paintHighlightTint[2]);
      effect.setFloat2("paintHighlightAmount", u.paintHighlightAmount[0], u.paintHighlightAmount[1]);
      effect.setFloat("paintSaturation", u.paintSaturation[0]);
      effect.setFloat2("paintCurve", u.paintCurve[0], u.paintCurve[1]);
      effect.setFloat3("paintLift", u.paintLift[0], u.paintLift[1], u.paintLift[2]);
      effect.setFloat("halationStrength", u.halationStrength[0]);
      effect.setFloat4("stareShade", u.stareShade[0], u.stareShade[1], u.stareShade[2], u.stareShade[3]);
      effect.setFloat4("chaseTint", u.chaseTint[0], u.chaseTint[1], u.chaseTint[2], u.chaseTint[3]);
      effect.setFloat3("chaseLift", u.chaseLift[0], u.chaseLift[1], u.chaseLift[2]);
      if (shadeMask !== null) effect.setTexture("shadeSampler", shadeMask);
      else if (boundBlack !== null) effect.setTexture("shadeSampler", boundBlack);
      effect.setFloat4("shadeShape", u.shadeShape[0], u.shadeShape[1], u.shadeShape[2], u.shadeShape[3]);
      effect.setFloat("shadeMonster", u.shadeMonster[0]);
    };

    // FXAA only where the temporal anti-aliasing could not be built: it does
    // for the cards' alpha-tested edges what the multisampling cannot, less well.
    if (taa === null) fxaa = new FxaaPostProcess("fxaa", 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);

    if (features.lens) {
      // Rain on the glass, after the anti-aliasing so the drops' edges are
      // anti-aliased and before the finish so the dither stays last. The droplet map is
      // generated (lensParams.ts) and tiles, so it wraps. The frost between
      // the drops is the scene itself, read four texels out on the
      // diagonals and averaged in the shader: the same on every tier, and no
      // other target involved.
      //
      // Below the strength's floor the pass is detached rather than
      // short-circuited in the shader: a pass that writes its input back
      // still costs a full-screen read and write. Babylon nulls a detached
      // pass's slot in place and refills a null slot on attach at that
      // index (`Camera.attachPostProcess`), so the pass returns between
      // FXAA and the finish, where it was built. It starts detached: the
      // constructor attaches it, which fixes its slot, and `update` brings
      // it in once there is rain on the glass.
      // The map is always magnified (two tiles over the frame's height, so
      // four texels a pixel at 1080p), so it has no mips to filter across:
      // bilinear only, and a texel between the drops decodes to exactly no
      // normal, no cover and no trail.
      droplets = RawTexture.CreateRGBATexture(lensDropletMap(), LENS.size, LENS.size, scene, false, false,
        Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      droplets.name = "lensDroplets";
      droplets.wrapU = Texture.WRAP_ADDRESSMODE;
      droplets.wrapV = Texture.WRAP_ADDRESSMODE;
      lens = new PostProcess("lens", "lens", ["lensStrength", "time", "aspect", "texelSize"], ["lensSampler"],
        1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      lensSlot = camera._postProcesses.indexOf(lens);
      camera.detachPostProcess(lens);
      lensAttached = false;
      endBlurX = new BlurPostProcess("endBlurX", new Vector2(1, 0), 1, 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      endBlurY = new BlurPostProcess("endBlurY", new Vector2(0, 1), 1, 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      endBlurSlot = camera._postProcesses.indexOf(endBlurX);
      camera.detachPostProcess(endBlurX);
      camera.detachPostProcess(endBlurY);
      const boundDroplets = droplets;
      lens.onApply = (effect) => {
        effect.setTexture("lensSampler", boundDroplets);
        // Its clock folded so the sliding drops' saw-tooth keeps its precision on a long hike (`lensUniforms`).
        const u = lensUniforms(lensStrength, (now() - start) / 1000, engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("texelSize", u.texelSize[0], u.texelSize[1]);
        effect.setFloat("lensStrength", u.lensStrength[0]);
        effect.setFloat("time", u.time[0]);
        effect.setFloat("aspect", u.aspect[0]);
      };
    }

    // The first pass owns the scene's render target, or the prepass does
    // where there is one, its targets the first pass's input. Babylon's
    // setter clamps to the engine's cap, but an engine may report no cap at
    // all, and Math.min(4, undefined) is NaN, so ask only where a cap above
    // 1 exists; a capped engine (Safari) reads 1 and nothing else changes.
    // The cards' alpha-test edges, which MSAA does not touch, are the
    // temporal anti-aliasing's, or FXAA's without it.
    const first = farSoft ?? paint ?? scenePass ?? grade;
    if (engine.getCaps().maxMSAASamples > 1) {
      if (prePass !== null) prePass.samples = MSAA_SAMPLES;
      else if (first !== null) first.samples = MSAA_SAMPLES;
    }
  } else {
    image.vignetteEnabled = true;
    image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  return {
    features,
    get marchesCloud() {
      return farSoft !== null;
    },
    setCloud(bind) {
      cloudBinder = bind;
    },
    setShades(mask, any) {
      shadeMask = mask;
      shadeAny = any;
    },
    setPalette(palette, fadeSeconds) {
      paletteFade.set(palette, fadeSeconds);
    },
    palette() {
      return paletteFade.now();
    },
    update(weather, hour, night, unsettle, stare, lensTarget = 0, chase = 0, blur = 0) {
      setEndBlur(blur);
      const seconds = (now() - start) / 1000;
      record = gradeRecordUnder(weather, hour, night, unsettle, seconds, stare, chase, paletteFade.now());
      ditherSeconds = seconds;
      lensStrength = lensTarget;
      if (lens !== null) {
        // In at the floor, out once the strength has sat under it for a second (`createLensGate`).
        const on = lensGate.step(lensTarget, seconds);
        if (on && !lensAttached) {
          camera.attachPostProcess(lens, lensSlot);
          lensAttached = true;
        } else if (!on && lensAttached) {
          camera.detachPostProcess(lens);
          lensAttached = false;
        }
      }
      // The post path: the grade's own uniforms are read as it applies.
      if (grade !== null) return;
      // Material path: the same intent through Babylon's own operators, the
      // exposure aside (see the doc comment above). The stare here is the
      // veil's (shadeVeil.ts), the crawling darkness the grade draws on the
      // post path, so the vignette is the record's own (until 2026-11-05 it
      // stood in for the stare, heavier and moved off the Hollow).
      image.vignetteWeight = record.vignetteWeight;
      if (image.colorCurves) {
        const curves = image.colorCurves;
        // The weather's split-tone and, under the chase, the shadows turned toward burgundy and deepened (`materialGrade.ts`).
        const set = curveSettingsUnder(weather, record.chase);
        curves.globalSaturation = set.globalSaturation;
        curves.shadowsHue = set.shadows.hue;
        curves.shadowsDensity = set.shadows.density;
        curves.shadowsSaturation = set.shadows.saturation;
        curves.midtonesHue = set.midtones.hue;
        curves.midtonesDensity = set.midtones.density;
        curves.midtonesSaturation = set.midtones.saturation;
        curves.highlightsHue = set.highlights.hue;
        curves.highlightsDensity = set.highlights.density;
        curves.highlightsSaturation = set.highlights.saturation;
      }
    },
    dispose() {
      farSoft?.dispose();
      farSoft = null;
      for (const remove of taaObservers.splice(0)) remove();
      taaSharpen?.dispose();
      taaSharpen = null;
      taa?.dispose();
      taa = null;
      taaPing?.dispose();
      taaPing = null;
      taaPong?.dispose();
      taaPong = null;
      paintCompose?.dispose();
      paint?.dispose();
      paint = null;
      if (prePass !== null) {
        scene.disablePrePassRenderer();
        prePass = null;
        delete (image as { applyByPostProcess?: boolean }).applyByPostProcess;
      }
      endBlurX?.dispose();
      endBlurY?.dispose();
      lens?.dispose();
      droplets?.dispose();
      fxaa?.dispose();
      grade?.dispose();
      blurY?.dispose();
      blurX?.dispose();
      extract?.dispose();
      scenePass?.dispose();
      black?.dispose();
    },
  };
}
