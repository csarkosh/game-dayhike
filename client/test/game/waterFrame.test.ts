// client/test/game/waterFrame.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { PassPostProcess } from "@babylonjs/core/PostProcesses/passPostProcess.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { CopyTextureToTexture } from "@babylonjs/core/Misc/copyTextureToTexture.js";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper.js";
import { WATER_FRAME_MISS_WARN, WATER_GROUP, createWaterFrame, waterFrameSupported } from "../../src/game/waterFrame.js";

/** A NullEngine scene with a camera and a box in the water's group, so group 1 renders. */
function sceneWithGroup1(engine: NullEngine): Scene {
  const scene = new Scene(engine);
  new FreeCamera("c", Vector3.Zero(), scene);
  // Babylon skips an empty rendering group, observers and all
  // (RenderingManager.render), so group 1 needs something in it, and a mesh
  // with no material is never dispatched to a group (Scene._evaluateSubMesh).
  const box = MeshBuilder.CreateBox("b", { size: 1 }, scene);
  box.material = new StandardMaterial("m", scene);
  box.position.z = 5;
  box.renderingGroupId = WATER_GROUP;
  return scene;
}

describe("water frame (the high tier's copy of the opaque pass)", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("puts the water in rendering group 1 with the depth kept across the group boundary", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const frame = createWaterFrame(scene, engine, () => true);
    expect(WATER_GROUP).toBe(1);
    // Babylon clears depth between groups unless told not to
    const info = (scene as unknown as { _renderingManager: { _autoClearDepthStencil: Record<number, { autoClear: boolean }> } })._renderingManager._autoClearDepthStencil;
    expect(info[WATER_GROUP]?.autoClear).toBe(false);
    frame.dispose();
    expect(info[WATER_GROUP]?.autoClear).toBe(true);
  });

  it("copies before group 1 renders, once per frame, and exposes screen as 1/size", async () => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 200, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
    const scene = sceneWithGroup1(engine);
    const frame = createWaterFrame(scene, engine, () => true);
    expect(frame.screen).toEqual([1 / 320, 1 / 200]);
    let fired = 0;
    scene.onBeforeRenderingGroupObservable.add((ev) => { if (ev.renderingGroupId === WATER_GROUP) fired++; });
    scene.render();
    expect(fired).toBe(1);
    expect(scene.onBeforeRenderingGroupObservable.hasObservers()).toBe(true);
    frame.dispose();
    // Babylon's Observable.remove unregisters on a timeout of 0 (_deferUnregister)
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scene.onBeforeRenderingGroupObservable.observers.length).toBe(1); // only the test's
  });

  it("runs the copy before any other observer of the group, so it stays outside the async-pipeline scope", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const earlier = scene.onBeforeRenderingGroupObservable.add(() => undefined);
    const frame = createWaterFrame(scene, engine, () => true);
    expect(scene.onBeforeRenderingGroupObservable.observers[0]).not.toBe(earlier);
    expect(scene.onBeforeRenderingGroupObservable.observers[1]).toBe(earlier);
    frame.dispose();
  });

  it("is supported only on WebGPU with a multisampled first pass (the resolved depth is then not the attachment)", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    // no camera
    expect(waterFrameSupported(scene)).toBe(false);
    const camera = new FreeCamera("c", Vector3.Zero(), scene);
    // no post-process
    expect(waterFrameSupported(scene)).toBe(false);
    engine.getCaps().maxMSAASamples = 4;
    const pass = new PassPostProcess("p", 1, camera);
    pass.samples = 4;
    // NullEngine is not WebGPU
    expect(waterFrameSupported(scene)).toBe(false);
    Object.defineProperty(engine, "isWebGPU", { value: true, configurable: true });
    expect(waterFrameSupported(scene)).toBe(true);
    pass.samples = 1;
    expect(waterFrameSupported(scene)).toBe(false);
  });

  it("says once, and only after 120 frames, when group 1 keeps going without its copy", () => {
    engine = new NullEngine();
    const scene = sceneWithGroup1(engine);
    const frame = createWaterFrame(scene, engine, () => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // NullEngine draws into no render target, so no copy can run
      for (let i = 0; i < WATER_FRAME_MISS_WARN - 1; i++) scene.render();
      expect(warn).not.toHaveBeenCalled();
      scene.render();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("no render target");
      for (let i = 0; i < 10; i++) scene.render();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      frame.dispose();
    }
  });

  /**
   * NullEngine draws into no render target, so the copy is reached with a
   * stand-in: a multisampled target with a depth texture put in place just
   * before group 1 renders (an observer ahead of the frame's), the copier
   * ready, and the engine's framebuffer calls spied rather than run.
   */
  function withStandInTarget(scene: Scene): { unbind: ReturnType<typeof vi.spyOn>; copy: ReturnType<typeof vi.spyOn>; restore(): void } {
    const e = scene.getEngine() as NullEngine;
    const target = {
      texture: {},
      _depthStencilTexture: {},
      samples: 4,
      width: e.getRenderWidth(),
      height: e.getRenderHeight(),
      resolveMSAADepth: false,
    } as unknown as RenderTargetWrapper;
    const slot = e as unknown as { _currentRenderTarget: RenderTargetWrapper | null };
    const before = scene.onBeforeRenderingGroupObservable.add((ev) => { if (ev.renderingGroupId === WATER_GROUP) slot._currentRenderTarget = target; }, undefined, true);
    const after = scene.onAfterRenderingGroupObservable.add((ev) => { if (ev.renderingGroupId === WATER_GROUP) slot._currentRenderTarget = null; });
    const ready = vi.spyOn(CopyTextureToTexture.prototype, "isReady").mockReturnValue(true);
    const copy = vi.spyOn(CopyTextureToTexture.prototype, "copy").mockReturnValue(true);
    const unbind = vi.spyOn(e, "unBindFramebuffer").mockImplementation(() => undefined);
    const bind = vi.spyOn(e, "bindFramebuffer").mockImplementation(() => undefined);
    return {
      unbind,
      copy,
      restore() {
        scene.onBeforeRenderingGroupObservable.remove(before);
        scene.onAfterRenderingGroupObservable.remove(after);
        for (const s of [ready, copy, unbind, bind]) s.mockRestore();
      },
    };
  }

  it("copies once a frame when a water mesh is in view", () => {
    engine = new NullEngine();
    const scene = sceneWithGroup1(engine);
    const frame = createWaterFrame(scene, engine, () => true);
    const standIn = withStandInTarget(scene);
    try {
      for (let i = 0; i < 3; i++) scene.render();
      expect(standIn.unbind).toHaveBeenCalledTimes(3);
      expect(standIn.copy).toHaveBeenCalledTimes(3);
      expect(frame.depth.getInternalTexture()).not.toBeNull();
    } finally {
      standIn.restore();
      frame.depth._texture = null;
      frame.dispose();
    }
  });

  it("makes no copy when no water mesh is in view, though group 1 renders", () => {
    engine = new NullEngine();
    const scene = sceneWithGroup1(engine);
    let asked = 0;
    const frame = createWaterFrame(scene, engine, () => { asked++; return false; });
    const standIn = withStandInTarget(scene);
    try {
      for (let i = 0; i < 5; i++) scene.render();
      expect(asked).toBe(5);
      expect(standIn.unbind).not.toHaveBeenCalled();
      expect(standIn.copy).not.toHaveBeenCalled();
      expect(frame.depth.getInternalTexture()).toBeNull();
    } finally {
      standIn.restore();
      frame.dispose();
    }
  });

  it("never warns for frames with no water in view: they are not misses", () => {
    engine = new NullEngine();
    const scene = sceneWithGroup1(engine);
    const frame = createWaterFrame(scene, engine, () => false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // with water in view these frames would warn at 120 (the test above)
      for (let i = 0; i < 200; i++) scene.render();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      frame.dispose();
    }
  });
});
