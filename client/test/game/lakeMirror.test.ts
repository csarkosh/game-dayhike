import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import {
  createLakeMirror, createLakeMirrorTerrain, LAKE_MIRROR_TERRAIN_SHADER, MIRROR_CANOPY_SHADE, MIRROR_LIFT, MIRROR_SCALE, type LakeMirror,
} from "../../src/game/lakeMirror.js";
import type { LakeSource } from "../../src/sim/terrain.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");

/** A lake at level 50: its mirror's plane is at 50.02. */
const LAKE: LakeSource = { kind: "lake", level: 50, x: 0, z: 30, radius: 30, murk: 1, lobe: null };

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

/** A scene on a fresh NullEngine (512 × 256), the player 1.7 m over the mirror's plane, at the game's lens, looking level along +z. */
function scene(halfZ = false): { s: Scene; player: Camera } {
  engine = new NullEngine();
  if (halfZ) Object.defineProperty(engine, "isNDCHalfZRange", { get: () => true });
  const s = new Scene(engine);
  const player = new UniversalCamera("player", new Vector3(3, 51.72, -4), s);
  player.fov = 1.4;
  player.minZ = 0.05;
  player.maxZ = 10000;
  s.activeCamera = player;
  return { s, player };
}

/** The mirror's own camera: the scene's cameras minus the player's. */
function mirrorCamera(s: Scene): Camera {
  const cam = s.cameras.find((c) => c.name === "lake_mirror_cam");
  if (!cam) throw new Error("no mirror camera");
  return cam;
}

/** Device depth z / w of a world point through the mirror's view-projection (Babylon layout, row vector on the left). */
function deviceDepth(vp: Float32Array, x: number, y: number, z: number): number {
  const clipZ = x * vp[2]! + y * vp[6]! + z * vp[10]! + vp[14]!;
  const clipW = x * vp[3]! + y * vp[7]! + z * vp[11]! + vp[15]!;
  return clipZ / clipW;
}

describe("createLakeMirror", () => {
  it("is one half-size half-float RGBA target with a depth buffer, cleared to alpha 0, off the scene's targets until armed", () => {
    const { s } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const t = mirror.texture;
    expect(MIRROR_SCALE).toBe(0.5);
    expect(t.name).toBe("lake_mirror");
    expect([t.getRenderWidth(), t.getRenderHeight()]).toEqual([256, 128]);
    expect(t.renderTargetOptions.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(t.renderTargetOptions.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(t.samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
    expect(t.renderTargetOptions.generateDepthBuffer).toBe(true);
    expect(t.renderTargetOptions.generateMipMaps).toBe(false);
    expect(t.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(t.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(t.clearColor.asArray()).toEqual([0, 0, 0, 0]);
    expect(t.refreshRate).toBe(1);
    expect(t.renderParticles).toBe(false);
    expect(t.renderSprites).toBe(false);
    // Its readiness never waits on the scene's particles, which it never draws.
    expect(t.particleSystemList).toEqual([]);
    expect(t.renderList?.length).toBe(0);
    expect(s.customRenderTargets).not.toContain(t);
    mirror.dispose();
  });

  it("draws through its own camera, never the scene's active one", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const cam = mirrorCamera(s);
    expect(cam).toBeInstanceOf(TargetCamera);
    expect(mirror.texture.activeCamera).toBe(cam);
    mirror.update(player, true, 1);
    expect(s.activeCamera).toBe(player);
    expect(s.activeCameras ?? []).not.toContain(cam);
    mirror.dispose();
  });

  it("reflects the player's view in the plane 2 cm over the lake's level, the eye 1.7 m under it", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    expect(MIRROR_LIFT).toBe(0.02);
    expect(mirror.update(player, true, 1)).toBe(true);
    const cam = mirrorCamera(s);
    // The player's view is a translation by (−3, −51.72, 4); the reflection
    // first takes y to 100.04 − y, so the mirrored view takes it to 48.32 − y.
    const view = Array.from(cam.getViewMatrix().m);
    const want = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, -3, 48.32, 4, 1];
    view.forEach((v, i) => expect(v, `m[${i}]`).toBeCloseTo(want[i]!, 4));
    expect(cam.globalPosition.x).toBeCloseTo(3, 4);
    expect(cam.globalPosition.y).toBeCloseTo(48.32, 4);
    expect(cam.globalPosition.z).toBeCloseTo(-4, 4);
    mirror.dispose();
  });

  it("freezes the projection to the player's with its near plane on the water: [−1, 1] depth", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    mirror.update(player, true, 1);
    const cam = mirrorCamera(s);
    const projection = Array.from(cam.getProjectionMatrix().m);
    // Lengyel's third row (m[2], m[6], m[10], m[14]) for the water plane
    // (0, −1, 0, −1.7) in the mirrored camera's space; the rest is the
    // player's: the game's lens at the engine's 2:1.
    const want = [
      0.59362, 0, 0, 0,
      0, 1.18724, -2.37496, 0,
      0, 0, -1, 1,
      0, 0, -4.03744, 0,
    ];
    projection.forEach((v, i) => expect(v, `m[${i}]`).toBeCloseTo(want[i]!, 4));
    // Points on the water map to the near depth, points under it fall out,
    // points above it are kept.
    const vp = mirror.viewProjection;
    expect(deviceDepth(vp, 4, 50.02, 10)).toBeCloseTo(-1, 4);
    expect(deviceDepth(vp, -6, 50.02, 40)).toBeCloseTo(-1, 4);
    expect(deviceDepth(vp, 4, 49.5, 10)).toBeLessThan(-1);
    const above = deviceDepth(vp, 4, 60, 30);
    expect(above).toBeGreaterThan(-1);
    expect(above).toBeLessThan(1);
    mirror.dispose();
  });

  it("freezes the projection in [0, 1] depth where the engine's range is half", () => {
    const { s, player } = scene(true);
    const mirror = createLakeMirror(s, LAKE, true);
    mirror.update(player, true, 1);
    const projection = Array.from(mirrorCamera(s).getProjectionMatrix().m);
    const want = [
      0.59362, 0, 0, 0,
      0, 1.18724, -1.18748, 0,
      0, 0, 0, 1,
      0, 0, -2.01872, 0,
    ];
    projection.forEach((v, i) => expect(v, `m[${i}]`).toBeCloseTo(want[i]!, 4));
    const vp = mirror.viewProjection;
    expect(deviceDepth(vp, 4, 50.02, 10)).toBeCloseTo(0, 4);
    expect(deviceDepth(vp, 4, 49.5, 10)).toBeLessThan(0);
    const above = deviceDepth(vp, 4, 60, 30);
    expect(above).toBeGreaterThan(0);
    expect(above).toBeLessThan(1);
    mirror.dispose();
  });

  it("arms the pass only with the lake drawn last frame and the glass above 0, and once", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const t = mirror.texture;
    const listed = () => s.customRenderTargets.filter((x) => x === t).length;
    expect(mirror.update(player, false, 1)).toBe(false);
    expect(listed()).toBe(0);
    expect(mirror.update(player, true, 0)).toBe(false);
    expect(listed()).toBe(0);
    expect(mirror.update(player, true, 0.4)).toBe(true);
    expect(listed()).toBe(1);
    expect(mirror.update(player, true, 1)).toBe(true);
    expect(listed()).toBe(1);
    // Armed, it renders every frame.
    expect(t._shouldRender()).toBe(true);
    expect(t._shouldRender()).toBe(true);
    // A share that is not a number never arms it.
    expect(mirror.update(player, true, Number.NaN)).toBe(false);
    expect(listed()).toBe(0);
    expect(mirror.update(player, true, 1)).toBe(true);
    expect(mirror.update(player, false, 1)).toBe(false);
    expect(listed()).toBe(0);
    mirror.dispose();
  });

  it("stays off with the eye at the mirror's plane or under it, where the near plane would turn over", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const listed = () => s.customRenderTargets.filter((x) => x === mirror.texture).length;
    player.position.y = 50.02;
    expect(mirror.update(player, true, 1)).toBe(false);
    expect(listed()).toBe(0);
    player.position.y = 49;
    expect(mirror.update(player, true, 1)).toBe(false);
    expect(listed()).toBe(0);
    player.position.y = 50.03;
    expect(mirror.update(player, true, 1)).toBe(true);
    expect(listed()).toBe(1);
    player.position.y = 50.02;
    expect(mirror.update(player, true, 1)).toBe(false);
    expect(listed()).toBe(0);
    mirror.dispose();
  });

  it("follows the engine's size at half when it changes", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    vi.spyOn(engine!, "getRenderWidth").mockReturnValue(640);
    vi.spyOn(engine!, "getRenderHeight").mockReturnValue(360);
    // Not armed: left as it was.
    mirror.update(player, false, 1);
    expect([mirror.texture.getRenderWidth(), mirror.texture.getRenderHeight()]).toEqual([256, 128]);
    mirror.update(player, true, 1);
    expect([mirror.texture.getRenderWidth(), mirror.texture.getRenderHeight()]).toEqual([320, 180]);
    mirror.dispose();
  });

  it("holds the mirrored eye on the scene for the pass alone, so front faces flip, and never sets a clip plane", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    mirror.update(player, true, 1);
    const seen: number[][] = [];
    mirror.texture.onBeforeRenderObservable.add(() => {
      seen.push(s._mirroredCameraPosition?.asArray() ?? [], s._forcedViewPosition?.asArray() ?? []);
    });
    expect(s._mirroredCameraPosition).toBeFalsy();
    mirror.texture.render();
    expect(seen).toHaveLength(2);
    seen.forEach((p) => {
      expect(p[0]).toBeCloseTo(3, 4);
      expect(p[1]).toBeCloseTo(48.32, 4);
      expect(p[2]).toBeCloseTo(-4, 4);
    });
    expect(s._mirroredCameraPosition).toBeNull();
    expect(s._forcedViewPosition).toBeNull();
    expect(s.clipPlane).toBeFalsy();
    mirror.dispose();
  });

  it("registers a mesh with a stand-in or its own material for the pass, and takes it out again", () => {
    const { s } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    const cliff = MeshBuilder.CreateBox("cliff", { size: 1 }, s);
    cliff.material = new StandardMaterial("rock", s);
    mirror.register(ring, mirror.terrainMaterial);
    mirror.register(cliff, null);
    mirror.register(ring, mirror.terrainMaterial);
    const listed = () => mirror.texture.renderList?.map((m) => m.name);
    expect(listed()).toEqual(["ring", "cliff"]);
    const pass = mirror.texture.renderPassId;
    const over = (m: Mesh) => m.getMaterialForRenderPass(pass);
    expect(over(ring)).toBe(mirror.terrainMaterial);
    expect(over(cliff)).toBeUndefined();
    // The meshes keep their own materials for the main pass.
    expect(ring.material).toBeNull();
    expect(cliff.material?.name).toBe("rock");
    mirror.unregister(ring);
    expect(listed()).toEqual(["cliff"]);
    expect(over(ring)).toBeUndefined();
    mirror.unregister(ring);
    expect(listed()).toEqual(["cliff"]);
    mirror.dispose();
    // After dispose a registry call does nothing.
    mirror.register(ring, null);
    mirror.unregister(cliff);
  });

  it("builds the terrain's stand-in from one stored shader: position and canopy, a colour the renderer sets, no clip plane", () => {
    const { s } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const m = mirror.terrainMaterial;
    expect(m).toBeInstanceOf(ShaderMaterial);
    expect(m.name).toBe("lake_mirror_terrain");
    expect(LAKE_MIRROR_TERRAIN_SHADER).toBe("lakeMirrorTerrain");
    expect(Effect.ShadersStore["lakeMirrorTerrainVertexShader"]).toBe(fx("lakeMirrorTerrain.vertex.fx"));
    expect(Effect.ShadersStore["lakeMirrorTerrainFragmentShader"]).toBe(fx("lakeMirrorTerrain.fragment.fx"));
    const options = (m as unknown as { _options: { attributes: string[]; uniforms: string[]; useClipPlane?: boolean } })._options;
    expect(options.attributes).toEqual(["position", "terrainWeights2"]);
    expect(options.uniforms).toEqual(["world", "viewProjection", "lakeMirrorColour"]);
    expect(options.useClipPlane).toBe(false);
    const colour = () => (m as unknown as { _colors3: Record<string, Color3> })._colors3["lakeMirrorColour"]!.asArray();
    expect(colour()).toEqual([0, 0, 0]);
    mirror.setTerrainColour(0.25, 0.5, 0.125);
    expect(colour()).toEqual([0.25, 0.5, 0.125]);
    // The canopy's shade, in lockstep with its twin.
    expect(MIRROR_CANOPY_SHADE).toBe(0.5);
    expect(fx("lakeMirrorTerrain.fragment.fx")).toContain("const float LAKE_MIRROR_CANOPY_SHADE = 0.5;");
    expect(fx("lakeMirrorTerrain.fragment.fx")).toContain(
      "vec3 colour = lakeMirrorColour * (1.0 - LAKE_MIRROR_CANOPY_SHADE * vCanopy);",
    );
    expect(fx("lakeMirrorTerrain.vertex.fx")).toContain("vCanopy = terrainWeights2.w;");
    mirror.dispose();
  });

  it("makes the stand-in through one factory, which also makes one of its own for another pass", () => {
    const { s } = scene();
    const own = createLakeMirrorTerrain(s);
    expect(own).toBeInstanceOf(ShaderMaterial);
    expect(own.name).toBe("lake_mirror_terrain");
    const options = (own as unknown as { _options: { attributes: string[]; uniforms: string[]; useClipPlane?: boolean } })._options;
    expect(options.attributes).toEqual(["position", "terrainWeights2"]);
    expect(options.uniforms).toEqual(["world", "viewProjection", "lakeMirrorColour"]);
    expect(options.useClipPlane).toBe(false);
    expect((own as unknown as { _colors3: Record<string, Color3> })._colors3["lakeMirrorColour"]!.asArray()).toEqual([0, 0, 0]);
    expect(Effect.ShadersStore["lakeMirrorTerrainVertexShader"]).toBe(fx("lakeMirrorTerrain.vertex.fx"));
    const mirror = createLakeMirror(s, LAKE, false);
    expect(mirror.terrainMaterial).not.toBe(own);
    expect(mirror.terrainMaterial.getClassName()).toBe(own.getClassName());
    // The mirror disposes its own stand-in, never one made apart from it.
    mirror.dispose();
    expect(s.materials).toContain(own);
    own.dispose();
  });

  it("dispose takes the target off the scene's targets and the camera and stand-in out of the scene", () => {
    const { s, player } = scene();
    const mirror = createLakeMirror(s, LAKE, false);
    const cam = mirrorCamera(s);
    const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    mirror.register(ring, mirror.terrainMaterial);
    mirror.update(player, true, 1);
    expect(s.customRenderTargets).toContain(mirror.texture);
    mirror.dispose();
    expect(s.customRenderTargets).toEqual([]);
    expect(s.textures).not.toContain(mirror.texture);
    expect(s.cameras).not.toContain(cam);
    expect(s.materials.filter((m) => m.name === "lake_mirror_terrain")).toEqual([]);
    expect(ring.isDisposed()).toBe(false);
    // A stray update after dispose arms nothing and never lists the target again.
    expect(mirror.update(player, true, 1)).toBe(false);
    expect(s.customRenderTargets).toEqual([]);
  });
});

describe("the terrain stand-in's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL for a terrain ring under the scene's fog", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      gpuScene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      gpuScene.fogDensity = 0.002;
      const mirror: LakeMirror = createLakeMirror(gpuScene, LAKE, true);
      const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2, subdivisions: 1 }, gpuScene);
      ring.setVerticesData("terrainWeights2", new Float32Array(4 * 4), false, 4);
      // The stand-in as the pass draws it, on the mesh's own slot so the
      // helper compiles it.
      ring.material = mirror.terrainMaterial;
      const effect = await drawnEffect(ring);
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define FOG");
      expect(defines).not.toContain("CLIPPLANE");
      const stage = (kind: "vertex" | "fragment", code: string) =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", effect._vertexSourceCode);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex).toContain("terrainWeights2");
      expect(vertex).toContain("vFogDistance");
      expect(fragment).toContain("lakeMirrorColour");
      expect(fragment).toContain("vFogColor");
      mirror.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});
