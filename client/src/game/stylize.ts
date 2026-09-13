import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Texture as BaseTexture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
// Non-`.pure` imports, and load-bearing exactly as documented in lighting.ts:
// these register the scene components that enableDepthRenderer and
// enableGeometryBufferRenderer need. The pure halves import without error and
// silently do nothing.
import "@babylonjs/core/Rendering/depthRendererSceneComponent.js";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent.js";

import type { QualityTier } from "./quality.js";
import {
  grainIntensityUnder, vignetteWeightUnder,
  GRAIN_INTENSITY_BASE, VIGNETTE_WEIGHT_BASE, type WeatherParams,
} from "./weather.js";
import {
  CHROMATIC_ABERRATION_AMOUNT, CHROMATIC_ABERRATION_RADIAL, ETCH_NOISE_SIZE, etchNoiseTexels,
  OUTLINE, outlineLineColour, stylizeFeaturesFor,
} from "./stylizeParams.js";
import etchedOutlineFragment from "./shaders/etchedOutline.fragment.fx?raw";

export type Stylize = {
  /** Null when the outline pass is skipped — tier says off, or no float
   * render targets (NullEngine, weak WebGL). Mirrors Lighting.shadows. */
  readonly outline: PostProcess | null;
  /** Per-frame: vignette and grain follow the weather's dread. The outline's
   * fog uniforms self-serve from the scene in onApply — no work here. */
  update(weather: WeatherParams): void;
  dispose(): void;
};

/**
 * The stylization layer: vignette on the shared image
 * processing config (every tier, zero passes), grain and chromatic aberration
 * via DefaultRenderingPipeline (medium/high), and the etched-outline post
 * process fed by a depth or geometry pre-pass (medium/high). All numbers come
 * from stylizeParams.ts and weather.ts, which are pure and tested; this is
 * wiring, and the traps are in the wiring.
 */
export function createStylize(scene: Scene, camera: Camera, tier: QualityTier): Stylize {
  const engine = scene.getEngine();
  const image = scene.imageProcessingConfiguration;
  const features = stylizeFeaturesFor(tier);

  // Vignette rides the image processing every material already runs — and the
  // pipeline's own image-processing pass once one exists below, since both
  // read this same configuration. Every tier, zero added passes.
  image.vignetteEnabled = true;
  image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
  image.vignetteWeight = VIGNETTE_WEIGHT_BASE;

  // Same underlying capability class as lighting.ts's cascaded shadows check
  // (float/half-float render targets). No such capability (NullEngine, weak WebGL)
  // means no pre-pass worth having — an 8-bit depth over a 10 km far plane steps
  // every ~39 m. Degrade silently.
  const caps = engine.getCaps();
  const fxSupported = caps.textureHalfFloatRender || caps.textureFloatRender;

  let outline: PostProcess | null = null;
  let noise: RawTexture | null = null;
  let usedGeometryBuffer = false;
  let usedDepthRenderer = false;

  // Outline FIRST, pipeline second: post processes run in attach order, and
  // the lines must pass through ACES and the vignette with the scene rather
  // than being stamped on after.
  if (fxSupported && features.outline !== "off") {
    Effect.ShadersStore["etchedOutlineFragmentShader"] = etchedOutlineFragment;

    noise = RawTexture.CreateRGBATexture(
      etchNoiseTexels(), ETCH_NOISE_SIZE, ETCH_NOISE_SIZE, scene,
      false, false, Texture.BILINEAR_SAMPLINGMODE,
    );
    noise.wrapU = Texture.WRAP_ADDRESSMODE;
    noise.wrapV = Texture.WRAP_ADDRESSMODE;

    // High tier: one MRT pre-pass provides depth AND normals (the g-buffer's
    // default layout is depth at 0, normal at 1). Medium: the cheaper
    // depth-only pre-pass. Never both — one pre-pass either way.
    let depthTexture: BaseTexture;
    let normalTexture: BaseTexture | null = null;
    if (features.outline === "normal") {
      const geometry = scene.enableGeometryBufferRenderer();
      if (geometry !== null) {
        usedGeometryBuffer = true;
        depthTexture = geometry.getGBuffer().textures[0] as BaseTexture;
        normalTexture = geometry.getGBuffer().textures[1] as BaseTexture;
      } else {
        usedDepthRenderer = true;
        depthTexture = scene.enableDepthRenderer(camera).getDepthMap();
      }
    } else {
      usedDepthRenderer = true;
      depthTexture = scene.enableDepthRenderer(camera).getDepthMap();
    }

    outline = new PostProcess(
      "etchedOutline", "etchedOutline",
      ["texelSize", "cameraMaxZ", "fogDensity", "lineColour", "lineStrength",
        "depthThreshold", "normalThreshold", "noiseScale"],
      normalTexture !== null
        ? ["depthSampler", "normalSampler", "noiseSampler"]
        : ["depthSampler", "noiseSampler"],
      1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false,
      // ETCH_GBUFFER_DEPTH always rides with ETCH_NORMALS: normalTexture is
      // only ever set alongside depthTexture from the SAME g-buffer MRT
      // above, whose depth convention (raw metres, zero-cleared background)
      // the shader must branch on — see etchedOutline.fragment.fx's banner.
      normalTexture !== null ? "#define ETCH_NORMALS\n#define ETCH_GBUFFER_DEPTH" : null,
    );
    const boundNoise = noise;
    const boundNormal = normalTexture;
    const boundDepth = depthTexture;
    outline.onApply = (effect) => {
      effect.setFloat2("texelSize", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
      effect.setFloat("cameraMaxZ", camera.maxZ);
      // Fog uniforms self-serve from what lighting.ts already wrote to the
      // scene this frame — density and colour are never duplicated here.
      effect.setFloat("fogDensity", scene.fogDensity);
      const line = outlineLineColour({
        r: scene.fogColor.r, g: scene.fogColor.g, b: scene.fogColor.b,
      });
      effect.setFloat3("lineColour", line.r, line.g, line.b);
      effect.setFloat("lineStrength", OUTLINE.lineStrength);
      effect.setFloat("depthThreshold", OUTLINE.depthThreshold);
      effect.setFloat("normalThreshold", OUTLINE.normalThreshold);
      effect.setFloat("noiseScale", OUTLINE.noiseScale);
      effect.setTexture("depthSampler", boundDepth);
      if (boundNormal !== null) effect.setTexture("normalSampler", boundNormal);
      effect.setTexture("noiseSampler", boundNoise);
    };
  }

  let pipeline: DefaultRenderingPipeline | null = null;
  if (fxSupported && features.pipeline) {
    // hdr: true keeps tone mapping fed with linear HDR values so the post
    // move introduces no banding; the fxSupported guard is exactly the
    // capability it needs.
    pipeline = new DefaultRenderingPipeline("stylize", true, scene, [camera]);
    pipeline.grainEnabled = true;
    pipeline.grain.animated = true;
    pipeline.grain.intensity = GRAIN_INTENSITY_BASE;
    pipeline.chromaticAberrationEnabled = true;
    pipeline.chromaticAberration.aberrationAmount = CHROMATIC_ABERRATION_AMOUNT;
    // Babylon defaults radialIntensity to 0 — pow(radius, 0) is 1 everywhere,
    // a flat screen-uniform shift. Nonzero is what makes it radial.
    pipeline.chromaticAberration.radialIntensity = CHROMATIC_ABERRATION_RADIAL;
  }

  return {
    outline,
    update(weather) {
      image.vignetteWeight = vignetteWeightUnder(weather);
      if (pipeline !== null) pipeline.grain.intensity = grainIntensityUnder(weather);
    },
    dispose() {
      outline?.dispose();
      pipeline?.dispose();
      noise?.dispose();
      if (usedGeometryBuffer) scene.disableGeometryBufferRenderer();
      if (usedDepthRenderer) scene.disableDepthRenderer(camera);
      // The vignette flags on the shared image processing config are borrowed
      // state, deliberately not restored — the documented lighting.ts policy;
      // the renderer disposes the whole scene.
    },
  };
}
