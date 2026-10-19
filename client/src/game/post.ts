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
import { gradeUnder, saturationUnder, WEATHER_PRESETS } from "./weather.js";
import { mixPalette, PAINT_FADE_SECONDS, PAINT_OILS, type PaintPalette } from "./gradeParams.js";
import { CHASE_LIFT, CHASE_SHADOW_DENSITY, CHASE_SHADOW_HUE, CHASE_TINT, gradeRecordUnder, STARE_VIGNETTE, type GradeRecord } from "./gradeParams.js";
import type { StareLens } from "./stareLens.js";
import { MSAA_SAMPLES, PAINT_SCALE, PAINT_STRENGTH, paintTargetSize, paintTexelRadius, type PostFeatures } from "./postParams.js";
import { LENS, lensDropletMap } from "./lensParams.js";
import halationExtractFragment from "./shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "./shaders/grade.fragment.fx?raw";
import lensFragment from "./shaders/lens.fragment.fx?raw";
import farSoftFragment from "./shaders/farSoft.fragment.fx?raw";
import paintFragment from "./shaders/paint.fragment.fx?raw";
import paintComposeFragment from "./shaders/paintCompose.fragment.fx?raw";
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

/** How long the lens's strength sits under its floor before the pass is detached. */
const LENS_IDLE_S = 1;
/** The shades' blur radius as a share of the frame's width, and how dark the mask makes the frame at full. */
export const SHADE_BLUR = 0.015;
/** How much darker a shade is than what stands behind it, the mist: a little, not black; and the real one, black, nearer to whole. */
export const SHADE_DARK = 0.3;
export const SHADE_MONSTER_DARK = 1;
/** The end's blur at its fullest, in texels: soft, not a wash. */
export const END_BLUR_KERNEL = 28;
/** The kernels the end's blur steps through: a blur pass compiles afresh for each kernel it is given, so a smooth ramp would compile every frame; three steps compile three times. */
export const END_BLUR_STEPS = 3;

/** The kernel for a blur of 0 to 1: none below the first step, then END_BLUR_STEPS even steps up to END_BLUR_KERNEL. */
export function endBlurKernel(blur: number): number {
  const step = Math.min(END_BLUR_STEPS, Math.ceil(Math.max(0, Math.min(1, blur)) * END_BLUR_STEPS));
  return (END_BLUR_KERNEL / END_BLUR_STEPS) * step;
}

/** The far softening's band of camera depth (m) and its radius at the band's end, in texels. */
export const FAR_SOFT_BAND: readonly [number, number] = [80, 450];
export const FAR_SOFT_RADIUS = 5;

/** The capability every HDR pass needs: float or half-float render targets. */
export function fxSupportedBy(engine: AbstractEngine): boolean {
  const caps = engine.getCaps();
  return Boolean(caps.textureHalfFloatRender || caps.textureFloatRender);
}

/** The far softening's uniforms for the ground cloud it marches (farSoft.fragment.fx). */
export const FAR_CLOUD_UNIFORMS = [
  "farEye", "farForward", "farRight", "farUp", "atmSunDir", "atmSunColour",
  "atmCloudDensity", "atmCloudSteps", "atmCloudRange", "atmCloudFalloff", "atmCloudSeat", "atmCloudGroundRange",
  "atmCloudNear", "atmCloudTrail", "atmCloudNoiseScale", "atmCloudWind", "atmCloudGlow", "atmCloudColour", "atmCloudGroundRect",
] as const;

// The ratio shared by every pass in the halation sub-chain — extract, blur X,
// blur Y, and (on high) grade — so a pass's own ratio and the previous
// pass's ratio agree and the whole sub-chain reads and writes quarter size
// throughout, blur Y's write target included (see grade's ratio below).
const HALATION_RATIO = 0.25;
const HALATION_KERNEL = 32;

/**
 * The post chain: the far softening first (where the engine draws to several
 * targets at once; below), then on high a full-resolution scene pass, then
 * halation extract and blur, then the grade pass, FXAA,
 * then the finish pass; on medium the scene pass and halation are skipped.
 * Passes attach in creation order, which is what fixes the order —
 * FXAA must run before the dither, and the dither must be last.
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
 * `grade`'s own OUTPUT is unaffected: it draws into `fxaa`'s
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
  let lens: PostProcess | null = null;
  /** The far field's softening (2026-10-16) and the prepass whose depth it reads. */
  let farSoft: PostProcess | null = null;
  /** What binds the ground cloud to the far softening's pass (`setCloud`), and a scratch axis. */
  let cloudBinder: ((effect: Effect) => void) | null = null;
  const farAxis = new Vector3();
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
  let lensIdleSince: number | null = null;
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
  let paletteFrom: PaintPalette = PAINT_OILS;
  let paletteTo: PaintPalette = PAINT_OILS;
  let paletteFadeStart = 0;
  let paletteFadeMs = 0;
  const paletteNow = (): PaintPalette => {
    if (paletteFadeMs <= 0) return paletteTo;
    return mixPalette(paletteFrom, paletteTo, (now() - paletteFadeStart) / paletteFadeMs);
  };
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
        effect.setFloat2("texel", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
        effect.setFloat3("soft", FAR_SOFT_BAND[0], FAR_SOFT_BAND[1], FAR_SOFT_RADIUS);
        // The ground cloud's march (farSoft.fragment.fx): the ray through each
        // pixel is the camera's forward plus the pixel's place across the
        // view, the right and up axes each at the half view's tangent. With
        // nothing bound it marches no steps.
        const tanY = Math.tan(camera.fov / 2);
        const tanX = tanY * engine.getAspectRatio(camera);
        camera.getDirectionToRef(Vector3.Forward(), farAxis);
        effect.setFloat3("farForward", farAxis.x, farAxis.y, farAxis.z);
        camera.getDirectionToRef(Vector3.Right(), farAxis);
        effect.setFloat3("farRight", farAxis.x * tanX, farAxis.y * tanX, farAxis.z * tanX);
        camera.getDirectionToRef(Vector3.Up(), farAxis);
        effect.setFloat3("farUp", farAxis.x * tanY, farAxis.y * tanY, farAxis.z * tanY);
        const eye = camera.globalPosition;
        effect.setFloat3("farEye", eye.x, eye.y, eye.z);
        if (cloudBinder !== null) cloudBinder(effect);
        else {
          effect.setFloat("atmCloudSteps", 0);
          if (black !== null) effect.setTexture("atmCloudMap", black);
        }
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
        const target = paintTargetSize(engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("texel", 1 / target.width, 1 / target.height);
        effect.setFloat("radius", paintTexelRadius(strokes, engine.getRenderHeight()));
      };
      paintCompose = new PostProcess("paintCompose", "paintCompose", ["halfTexel", "strength"], ["sceneSampler"], PAINT_SCALE, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      const boundPaint = paint;
      paintCompose.onApply = (effect) => {
        // The paint's own input: the frame as it came to the paint, full size.
        effect.setTextureFromPostProcess("sceneSampler", boundPaint);
        const target = paintTargetSize(engine.getRenderWidth(), engine.getRenderHeight());
        effect.setFloat2("halfTexel", 1 / target.width, 1 / target.height);
        effect.setFloat("strength", PAINT_STRENGTH);
      };
    }

    if (features.halation) {
      // Absorbs the halation extract's quarter-resolution ratio so the scene
      // itself always renders full-resolution — see the doc comment above.
      scenePass = new PassPostProcess("scene", 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      extract = new PostProcess("halationExtract", "halationExtract", ["exposure"], [], HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      extract.onApply = (effect) => {
        effect.setFloat("exposure", record.exposure);
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
      const r = record;
      // The dither (2026-10-18, the finish pass's before, which the grade's end now draws).
      effect.setFloat2("texelSize", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
      effect.setFloat("time", ditherSeconds);
      // With halation the scene is the scene pass's INPUT (setTextureFromPostProcess
      // binds a pass's input texture, and the scene pass's own input is the
      // camera's actual render since it is first in the chain); without
      // halation the chain's previous output is already the scene, so
      // textureSampler needs no override.
      if (boundScenePass !== null) effect.setTextureFromPostProcess("textureSampler", boundScenePass);
      if (boundBlurY !== null) effect.setTextureFromPostProcessOutput("halationSampler", boundBlurY);
      else if (boundBlack !== null) effect.setTexture("halationSampler", boundBlack);
      effect.setFloat("exposure", r.exposure);
      effect.setMatrix3x3("whitePoint", Float32Array.from(r.whitePoint));
      effect.setMatrix3x3("purkinje", Float32Array.from(r.purkinje));
      effect.setFloat("purkinjeThreshold", r.purkinjeThreshold);
      effect.setFloat("purkinjeStrength", r.purkinjeStrength);
      effect.setFloat3("shadowTint", r.shadows.r, r.shadows.g, r.shadows.b);
      effect.setFloat2("shadowAmount", r.shadows.density, r.shadows.saturation);
      effect.setFloat3("midtoneTint", r.midtones.r, r.midtones.g, r.midtones.b);
      effect.setFloat2("midtoneAmount", r.midtones.density, r.midtones.saturation);
      effect.setFloat3("highlightTint", r.highlights.r, r.highlights.g, r.highlights.b);
      effect.setFloat2("highlightAmount", r.highlights.density, r.highlights.saturation);
      effect.setFloat("saturation", r.saturation);
      effect.setFloat3("lift", r.lift.r, r.lift.g, r.lift.b);
      effect.setFloat("vignetteWeight", r.vignetteWeight);
      effect.setFloat3("vignetteColour", r.vignetteColour.r, r.vignetteColour.g, r.vignetteColour.b);
      const p = r.paint;
      effect.setFloat3("paintShadowTint", p.shadows.r, p.shadows.g, p.shadows.b);
      effect.setFloat2("paintShadowAmount", p.shadows.density, p.shadows.saturation);
      effect.setFloat3("paintMidtoneTint", p.midtones.r, p.midtones.g, p.midtones.b);
      effect.setFloat2("paintMidtoneAmount", p.midtones.density, p.midtones.saturation);
      effect.setFloat3("paintHighlightTint", p.highlights.r, p.highlights.g, p.highlights.b);
      effect.setFloat2("paintHighlightAmount", p.highlights.density, p.highlights.saturation);
      effect.setFloat("paintSaturation", p.saturation);
      effect.setFloat2("paintCurve", p.contrast, p.pivot);
      effect.setFloat3("paintLift", p.lift.r, p.lift.g, p.lift.b);
      effect.setFloat("halationStrength", r.halationStrength);
      effect.setFloat4("stareShade", r.stare.x, r.stare.y, r.stare.reach, r.stare.time);
      effect.setFloat4("chaseTint", CHASE_TINT.r, CHASE_TINT.g, CHASE_TINT.b, r.chase);
      effect.setFloat3("chaseLift", CHASE_LIFT.r, CHASE_LIFT.g, CHASE_LIFT.b);
      if (shadeMask !== null) effect.setTexture("shadeSampler", shadeMask);
      else if (boundBlack !== null) effect.setTexture("shadeSampler", boundBlack);
      effect.setFloat4("shadeShape", SHADE_BLUR, SHADE_DARK, engine.getRenderWidth() / engine.getRenderHeight(), shadeMask !== null && shadeAny ? 1 : 0);
      effect.setFloat("shadeMonster", SHADE_MONSTER_DARK);
    };

    fxaa = new FxaaPostProcess("fxaa", 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);

    if (features.lens) {
      // Rain on the glass, after FXAA so the drops' edges are anti-aliased
      // and before the finish so the dither stays last. The droplet map is
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
        effect.setFloat2("texelSize", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
        effect.setFloat("lensStrength", lensStrength);
        // Folded so the sliding drops' saw-tooth keeps its precision on a long hike.
        effect.setFloat("time", ((now() - start) / 1000) % 3600);
        effect.setFloat("aspect", engine.getRenderWidth() / engine.getRenderHeight());
      };
    }

    // The first pass owns the scene's render target, or the prepass does
    // where there is one, its targets the first pass's input. Babylon's
    // setter clamps to the engine's cap, but an engine may report no cap at
    // all, and Math.min(4, undefined) is NaN, so ask only where a cap above
    // 1 exists; a capped engine (Safari) reads 1 and nothing else changes.
    // FXAA stays for the cards' alpha-test edges, which MSAA does not touch.
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
    setPalette(palette, fadeSeconds = PAINT_FADE_SECONDS) {
      paletteFrom = paletteNow();
      paletteTo = palette;
      paletteFadeMs = Math.max(0, fadeSeconds) * 1000;
      paletteFadeStart = now();
    },
    palette() {
      return paletteNow();
    },
    update(weather, hour, night, unsettle, stare, lensTarget = 0, chase = 0, blur = 0) {
      setEndBlur(blur);
      const seconds = (now() - start) / 1000;
      record = gradeRecordUnder(weather, hour, night, unsettle, seconds, stare, chase, paletteNow());
      ditherSeconds = seconds;
      lensStrength = lensTarget;
      if (lens !== null) {
        if (lensTarget >= LENS.floor) {
          lensIdleSince = null;
          if (!lensAttached) {
            camera.attachPostProcess(lens, lensSlot);
            lensAttached = true;
          }
        } else {
          lensIdleSince ??= seconds;
          if (lensAttached && seconds - lensIdleSince >= LENS_IDLE_S) {
            camera.detachPostProcess(lens);
            lensAttached = false;
          }
        }
      }
      // The post path: the grade's own uniforms are read as it applies.
      if (grade !== null) return;
      // Material path: the same intent through Babylon's own operators, the
      // exposure aside (see the doc comment above).
      // The stare here is Babylon's own vignette, heavier and moved off the
      // Hollow: this path has no pass to draw the crawling edge with.
      image.vignetteWeight = record.vignetteWeight + STARE_VIGNETTE * record.stare.reach;
      image.vignetteCenterX = record.stare.x;
      image.vignetteCenterY = record.stare.y;
      if (image.colorCurves) {
        const curves = image.colorCurves;
        const g = gradeUnder(weather);
        curves.globalSaturation = saturationUnder(weather);
        // The chase on this path: the shadows turned toward burgundy and deepened.
        curves.shadowsHue = g.shadowsHue + (CHASE_SHADOW_HUE - g.shadowsHue) * record.chase;
        curves.shadowsDensity = g.shadowsDensity + CHASE_SHADOW_DENSITY * record.chase;
        curves.shadowsSaturation = g.shadowsSaturation;
        curves.midtonesHue = g.midtonesHue;
        curves.midtonesDensity = g.midtonesDensity;
        curves.midtonesSaturation = g.midtonesSaturation;
        curves.highlightsHue = g.highlightsHue;
        curves.highlightsDensity = g.highlightsDensity;
        curves.highlightsSaturation = g.highlightsSaturation;
      }
    },
    dispose() {
      farSoft?.dispose();
      farSoft = null;
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
