import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { PassPostProcess } from "@babylonjs/core/PostProcesses/passPostProcess.js";
import { BlurPostProcess } from "@babylonjs/core/PostProcesses/blurPostProcess.js";
import { ChromaticAberrationPostProcess } from "@babylonjs/core/PostProcesses/chromaticAberrationPostProcess.js";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";

import type { WeatherParams } from "./weather.js";
import { gradeUnder, saturationUnder, WEATHER_PRESETS } from "./weather.js";
import { gradeRecordUnder, type GradeRecord } from "./gradeParams.js";
import { finishUnder, type PostFeatures } from "./postParams.js";
import halationExtractFragment from "./shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "./shaders/grade.fragment.fx?raw";
import finishFragment from "./shaders/finish.fragment.fx?raw";

export type Post = {
  readonly features: PostFeatures;
  update(weather: WeatherParams, hour: number, unsettle: number): void;
  dispose(): void;
};

/** The capability every HDR pass needs: float or half-float render targets. */
export function fxSupportedBy(engine: AbstractEngine): boolean {
  const caps = engine.getCaps();
  return Boolean(caps.textureHalfFloatRender || caps.textureFloatRender);
}

const HALATION_RATIO = 0.25;
const HALATION_KERNEL = 32;

/**
 * The post chain: on high, a full-resolution scene pass, then halation
 * extract and blur, then the grade pass, chromatic aberration, FXAA, then the
 * finish pass; on medium the scene pass and halation are skipped and grade is
 * first. Passes attach in creation order, which is what fixes the order —
 * aberration and FXAA must run before grain and dither, and dither must be
 * last.
 *
 * The scene pass exists only because Babylon renders the scene straight into
 * the FIRST post-process's own input render target: on high that would
 * otherwise be `halationExtract`, whose ratio (`HALATION_RATIO`, a deliberate
 * quarter resolution for the extract's OWN output) would size the scene
 * render itself, rasterising the entire frame at quarter resolution. A
 * `PassPostProcess` at ratio 1.0 in front of the halation chain absorbs that
 * ratio instead, so the scene always renders full-resolution regardless of
 * what the halation extract downsamples to. `grade.onApply` reads the scene
 * from the scene pass's INPUT (the true full-resolution render), not from
 * `halationExtract`'s input (which would give the same texture indirectly,
 * but only because the scene pass happens to sit in front of it — binding the
 * scene pass directly does not depend on that chaining detail).
 *
 * Aberration and FXAA are constructed directly as `ChromaticAberrationPostProcess`
 * and `FxaaPostProcess` rather than through `DefaultRenderingPipeline`: the
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
 * Babylon's in-material image processing (exposure, vignette, colour
 * curves) every call.
 */
export function createPost(scene: Scene, camera: Camera, features: PostFeatures): Post {
  const engine = scene.getEngine();
  const image = scene.imageProcessingConfiguration;
  let grade: PostProcess | null = null;
  let finish: PostProcess | null = null;
  let scenePass: PassPostProcess | null = null;
  let extract: PostProcess | null = null;
  let blurX: BlurPostProcess | null = null;
  let blurY: BlurPostProcess | null = null;
  let aberration: ChromaticAberrationPostProcess | null = null;
  let fxaa: FxaaPostProcess | null = null;
  let black: RawTexture | null = null;
  let record: GradeRecord = gradeRecordUnder(WEATHER_PRESETS.clear, 12, 1);
  let finishRecord = finishUnder(WEATHER_PRESETS.clear, 1, 0);
  const start = performance.now();

  if (features.pipeline) {
    const textureType = engine.getCaps().textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : Constants.TEXTURETYPE_FLOAT;
    Effect.ShadersStore["halationExtractFragmentShader"] = halationExtractFragment;
    Effect.ShadersStore["gradeFragmentShader"] = gradeFragment;
    Effect.ShadersStore["finishFragmentShader"] = finishFragment;

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
    } else {
      black = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    }

    grade = new PostProcess("grade", "grade",
      ["exposure", "whitePoint", "purkinje", "purkinjeThreshold", "purkinjeStrength", "shadowTint", "shadowAmount",
        "midtoneTint", "midtoneAmount", "highlightTint", "highlightAmount", "lift", "vignetteWeight", "vignetteColour",
        "halationStrength"],
      ["halationSampler"], 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
    const boundScenePass = scenePass;
    const boundBlurY = blurY;
    const boundBlack = black;
    grade.onApply = (effect) => {
      const r = record;
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
      effect.setFloat("lift", r.lift);
      effect.setFloat("vignetteWeight", r.vignetteWeight);
      effect.setFloat3("vignetteColour", r.vignetteColour.r, r.vignetteColour.g, r.vignetteColour.b);
      effect.setFloat("halationStrength", r.halationStrength);
    };

    aberration = new ChromaticAberrationPostProcess("chromaticAberration", engine.getRenderWidth(),
      engine.getRenderHeight(), 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
    // Babylon defaults radialIntensity to 0 — a flat screen-uniform shift.
    aberration.radialIntensity = 2;
    const boundAberration = aberration;
    boundAberration.onApply = () => {
      // screenWidth/Height are constructor-time snapshots; keep them current
      // so a resize does not leave the effect reading a stale render size.
      boundAberration.screenWidth = engine.getRenderWidth();
      boundAberration.screenHeight = engine.getRenderHeight();
    };

    fxaa = new FxaaPostProcess("fxaa", 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);

    finish = new PostProcess("finish", "finish", ["texelSize", "overlapGain", "overlapPhase", "grainGain", "time"], [],
      1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
    finish.onApply = (effect) => {
      const f = finishRecord;
      effect.setFloat2("texelSize", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
      effect.setFloat("overlapGain", f.overlapGain);
      effect.setFloat("overlapPhase", f.overlapPhase);
      effect.setFloat("grainGain", f.grainGain);
      effect.setFloat("time", f.time);
    };
  } else {
    image.vignetteEnabled = true;
    image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  return {
    features,
    update(weather, hour, unsettle) {
      record = gradeRecordUnder(weather, hour, unsettle);
      finishRecord = finishUnder(weather, unsettle, (performance.now() - start) / 1000);
      if (aberration !== null) {
        aberration.aberrationAmount = record.aberrationAmount;
        return;
      }
      // Material path: the same intent through Babylon's own operators.
      image.exposure = record.exposure;
      image.vignetteWeight = record.vignetteWeight;
      if (image.colorCurves) {
        const curves = image.colorCurves;
        const g = gradeUnder(weather);
        curves.globalSaturation = saturationUnder(weather);
        curves.shadowsHue = g.shadowsHue;
        curves.shadowsDensity = g.shadowsDensity;
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
      finish?.dispose();
      fxaa?.dispose();
      aberration?.dispose();
      grade?.dispose();
      blurY?.dispose();
      blurX?.dispose();
      extract?.dispose();
      scenePass?.dispose();
      black?.dispose();
    },
  };
}
