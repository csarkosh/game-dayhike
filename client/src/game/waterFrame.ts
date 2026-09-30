// client/src/game/waterFrame.ts
/**
 * The high tier's view of the opaque pass for the water to read through
 * (spec §4.4, §5.2): the frame's colour copied before the water's rendering
 * group draws, and the depth behind each pixel. Two depth sources, a runtime
 * switch so one build measures both (the plan's Task 6):
 *
 * - "copy": the scene's multisampled depth, resolved as the pass is broken
 *   before group 1 into the single-sample texture Babylon keeps beside it
 *   (`RenderTargetWrapper.resolveMSAADepth`, WebGPU's
 *   `resolveMSAADepthTexture`). That texture is not an attachment of the pass
 *   the water draws in, so the water reads it where it stands: device depth,
 *   linearised in the shader from the camera's near and far.
 * - "prepass": Babylon's PrePassRenderer writes linear view depth into a
 *   colour attachment of its own target. That attachment is still bound while
 *   the water draws, so it is copied out before group 1 like the colour.
 *
 * Both break the scene's render pass once a frame, between group 0 and group
 * 1: the colour must be copied out of the target the water draws into. The
 * copy runs before any other observer of the group, which keeps it outside
 * the async-pipeline scope (`scopeRenderingGroups`) that the water's own draws
 * are inside. WebGPU only, with a multisampled first pass
 * (`waterFrameSupported`); elsewhere the water stays on the blended path.
 * Renderer-only.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture.js";
import type { PrePassEffectConfiguration } from "@babylonjs/core/Rendering/prePassEffectConfiguration.js";
import type { PrePassRenderer } from "@babylonjs/core/Rendering/prePassRenderer.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CopyTextureToTexture } from "@babylonjs/core/Misc/copyTextureToTexture.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import type { RenderingGroupInfo } from "@babylonjs/core/Rendering/renderingManager.js";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent.js";

/** The water draws after every opaque mesh, in its own group. */
export const WATER_GROUP = 1;

export type WaterDepthMode = "copy" | "prepass";

/** The depth source a page gets without `?waterDepth=` (`app.ts`). */
export const WATER_DEPTH_MODE_DEFAULT: WaterDepthMode = "copy";

export type WaterFrame = {
  /** The opaque pass's colour, copied before group 1 each frame. */
  scene: BaseTexture;
  /** The depth behind each pixel in `.r`; no texture behind it until the first copy. */
  depth: BaseTexture;
  /** 1 / the target's size, updated in place when the target is resized. */
  screen: [number, number];
  /** True when `depth` holds linear view metres (prepass), false for device depth (copy). */
  depthLinear: boolean;
  dispose(): void;
};

/** The first post-process on the camera: its input is the target the scene draws into. */
function firstPostProcess(camera: Camera | null): PostProcess | null {
  return camera?._postProcesses.find((p): p is PostProcess => p !== null && p !== undefined) ?? null;
}

/**
 * Whether the frame can be made for `scene` as it stands: WebGPU, and a first
 * post-process that multisamples (post.ts sets it where the engine can). Only
 * a multisampled target keeps a resolved depth that is not also the pass's
 * attachment; on WebGL2 the target's depth is a renderbuffer, which no shader
 * reads.
 */
export function waterFrameSupported(scene: Scene): boolean {
  const first = firstPostProcess(scene.activeCamera);
  return scene.getEngine().isWebGPU && first !== null && first.samples > 1;
}

/** The field Babylon's own SSAO2 and SSR set on a post-process to ask the prepass for textures. */
type PrePassAsker = { _prePassEffectConfiguration: PrePassEffectConfiguration | undefined };

function enableDepthPrePass(scene: Scene, first: PostProcess | null): PrePassRenderer {
  const pre = scene.enablePrePassRenderer();
  if (pre === null || first === null) throw new Error("water frame: no prepass renderer or no post-process to feed");
  // The prepass writes a texture only for an effect configuration that a
  // material or post-process enables again on every update (its _update
  // disables them all first): a post-process carrying one is how.
  (first as unknown as PrePassAsker)._prePassEffectConfiguration = {
    name: "waterDepth",
    enabled: true,
    texturesRequired: [Constants.PREPASS_DEPTH_TEXTURE_TYPE],
  };
  // Every frame the prepass sets applyByPostProcess to whether the chain holds
  // Babylon's own ImageProcessingPostProcess. The game grades in its own pass
  // with applyByPostProcess on (lighting.ts), so the answer is pinned to yes.
  (pre as unknown as { _hasImageProcessing: () => boolean })._hasImageProcessing = () => true;
  // The prepass target replaces the first pass's input: it takes its samples.
  pre.samples = first.samples;
  pre.markAsDirty();
  return pre;
}

export function createWaterFrame(scene: Scene, engine: AbstractEngine, mode: WaterDepthMode): WaterFrame {
  let width = engine.getRenderWidth();
  let height = engine.getRenderHeight();
  const screen: [number, number] = [1 / width, 1 / height];
  // Depth is not cleared between group 0 and group 1: the water must test
  // against the opaque pass it reads.
  scene.setRenderingAutoClearDepthStencil(WATER_GROUP, false, false, false);

  const colour = new RenderTargetTexture("waterScene", { width, height }, scene, {
    generateMipMaps: false,
    type: Constants.TEXTURETYPE_HALF_FLOAT,
    samplingMode: Texture.BILINEAR_SAMPLINGMODE,
    generateDepthBuffer: false,
  });
  colour.wrapU = Texture.CLAMP_ADDRESSMODE;
  colour.wrapV = Texture.CLAMP_ADDRESSMODE;
  const copier = new CopyTextureToTexture(engine, false, false);

  // The depth the water binds. Its texture is set only after a copy has run,
  // so the material is not ready (and the water not drawn) before then.
  const depth = new BaseTexture(scene);
  depth.name = "waterDepth";
  depth.wrapU = Texture.CLAMP_ADDRESSMODE;
  depth.wrapV = Texture.CLAMP_ADDRESSMODE;

  const pre = mode === "prepass" ? enableDepthPrePass(scene, firstPostProcess(scene.activeCamera)) : null;
  const depthCopy =
    mode === "prepass"
      ? new RenderTargetTexture("waterDepthCopy", { width, height }, scene, {
          generateMipMaps: false,
          type: Constants.TEXTURETYPE_FLOAT,
          format: Constants.TEXTUREFORMAT_R,
          samplingMode: Texture.NEAREST_SAMPLINGMODE,
          generateDepthBuffer: false,
        })
      : null;

  const fit = (w: number, h: number): void => {
    if (w === width && h === height) return;
    width = w;
    height = h;
    screen[0] = 1 / w;
    screen[1] = 1 / h;
    colour.resize({ width: w, height: h });
    depthCopy?.resize({ width: w, height: h });
  };

  const observer: Observer<RenderingGroupInfo> = scene.onBeforeRenderingGroupObservable.add(
    (info) => {
      if (info.renderingGroupId !== WATER_GROUP || info.renderingManager !== scene.renderingManager) return;
      const camera = scene.activeCamera;
      const target = engine._currentRenderTarget;
      if (camera === null || target === null || target.texture === null || !copier.isReady()) return;
      let source: InternalTexture | null = null;
      if (pre === null) {
        // The resolved depth is only apart from the attachment when multisampled.
        if (target.samples <= 1 || target._depthStencilTexture === null) return;
      } else {
        const index: number | undefined = pre.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
        source = index === undefined || index < 0 ? null : (target.textures?.[index] ?? null);
        if (source === null) return;
      }
      fit(target.width, target.height);
      // Ending the pass resolves the colour into target.texture; the unbind
      // resolves the depth when asked, and only this once a frame.
      target.resolveMSAADepth = pre === null;
      engine.unBindFramebuffer(target, true);
      target.resolveMSAADepth = false;
      copier.copy(target.texture, colour);
      if (source !== null && depthCopy !== null) copier.copy(source, depthCopy);
      depth._texture = depthCopy === null ? target._depthStencilTexture : depthCopy.getInternalTexture();
      // Back into the scene's target: the next draw loads what the pass stored.
      engine.bindFramebuffer(target, 0, undefined, undefined, true);
      engine.setViewport(camera.viewport);
      pre?.restoreAttachments();
    },
    undefined,
    true,
  )!;

  return {
    scene: colour,
    depth,
    screen,
    depthLinear: pre !== null,
    dispose() {
      scene.onBeforeRenderingGroupObservable.remove(observer);
      // The texture behind it is the target's, not this frame's to release.
      depth._texture = null;
      depth.dispose();
      colour.dispose();
      depthCopy?.dispose();
      copier.dispose();
      if (pre !== null) {
        const first = firstPostProcess(scene.activeCamera);
        if (first !== null) (first as unknown as PrePassAsker)._prePassEffectConfiguration = undefined;
        pre._unlinkInternalTexture(pre.defaultRT);
        scene.disablePrePassRenderer();
      }
      scene.setRenderingAutoClearDepthStencil(WATER_GROUP, true, true, true);
    },
  };
}
