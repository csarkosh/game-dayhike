// client/src/game/waterFrame.ts
/**
 * The high tier's view of the opaque pass for the water to read through
 * (spec §4.4, §5.2): the frame's colour copied before the water's rendering
 * group draws, and the depth behind each pixel.
 *
 * The depth is the scene's multisampled depth, resolved as the pass is broken
 * before group 1 into the single-sample texture Babylon keeps beside it
 * (`RenderTargetWrapper.resolveMSAADepth`, WebGPU's
 * `resolveMSAADepthTexture`). That texture is not an attachment of the pass
 * the water draws in, so the water reads it where it stands: device depth,
 * linearised in the shader from the camera's near and far. The colour is an
 * attachment (the pass's resolve target), so it is copied out.
 *
 * The pass is broken once a frame, between group 0 and group 1. The copy runs
 * before any other observer of the group, which keeps it outside the
 * async-pipeline scope (`scopeRenderingGroups`) that the water's own draws
 * are inside. WebGPU only, with a multisampled first pass
 * (`waterFrameSupported`); elsewhere the water stays on the blended path.
 * Renderer-only.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CopyTextureToTexture } from "@babylonjs/core/Misc/copyTextureToTexture.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import type { RenderingGroupInfo } from "@babylonjs/core/Rendering/renderingManager.js";

/** The water draws after every opaque mesh, in its own group. */
export const WATER_GROUP = 1;

/** Frames of group 1 without a copy before the frame says so, once: the
 * water is not drawn until its first copy, so a copy that never comes would
 * otherwise be an invisible sea with nothing said. */
export const WATER_FRAME_MISS_WARN = 120;

export type WaterFrame = {
  /** The opaque pass's colour, copied before group 1 each frame. */
  scene: BaseTexture;
  /** Device depth behind each pixel in `.r`; no texture behind it until the first copy. */
  depth: BaseTexture;
  /** 1 / the target's size, updated in place when the target is resized. */
  screen: [number, number];
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

export function createWaterFrame(scene: Scene, engine: AbstractEngine): WaterFrame {
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

  const fit = (w: number, h: number): void => {
    if (w === width && h === height) return;
    width = w;
    height = h;
    screen[0] = 1 / w;
    screen[1] = 1 / h;
    colour.resize({ width: w, height: h });
  };

  let copied = false;
  let missed = 0;
  /** Counts a group 1 that went without its copy, and says why once, late. */
  const miss = (reason: string): void => {
    if (copied || ++missed !== WATER_FRAME_MISS_WARN) return;
    console.warn(`Water: no copy of the opaque pass after ${WATER_FRAME_MISS_WARN} frames (${reason}); the high tier's water is not drawn.`);
  };

  const observer: Observer<RenderingGroupInfo> = scene.onBeforeRenderingGroupObservable.add(
    (info) => {
      if (info.renderingGroupId !== WATER_GROUP || info.renderingManager !== scene.renderingManager) return;
      const camera = scene.activeCamera;
      const target = engine._currentRenderTarget;
      if (camera === null) return miss("no active camera");
      if (target === null || target.texture === null) return miss("the scene draws into no render target");
      // The resolved depth is only apart from the attachment when multisampled.
      if (target.samples <= 1) return miss(`the scene's target has ${target.samples} sample`);
      if (target._depthStencilTexture === null) return miss("the scene's target has no depth texture");
      if (!copier.isReady()) return miss("the copy's shader is not ready");
      fit(target.width, target.height);
      // Ending the pass resolves the colour into target.texture; the unbind
      // resolves the depth when asked, and only this once a frame.
      target.resolveMSAADepth = true;
      engine.unBindFramebuffer(target, true);
      target.resolveMSAADepth = false;
      copier.copy(target.texture, colour);
      depth._texture = target._depthStencilTexture;
      copied = true;
      // Back into the scene's target: the next draw loads what the pass stored.
      engine.bindFramebuffer(target, 0, undefined, undefined, true);
      engine.setViewport(camera.viewport);
    },
    undefined,
    true,
  )!;

  return {
    scene: colour,
    depth,
    screen,
    dispose() {
      scene.onBeforeRenderingGroupObservable.remove(observer);
      // The texture behind it is the target's, not this frame's to release.
      depth._texture = null;
      depth.dispose();
      colour.dispose();
      copier.dispose();
      scene.setRenderingAutoClearDepthStencil(WATER_GROUP, true, true, true);
    },
  };
}
