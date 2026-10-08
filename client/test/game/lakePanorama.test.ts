import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { LakeSource } from "../../src/sim/terrain.js";
import {
  createLakePanorama, createSkylineTexture, SKYLINE_READ_MAX, panoramaProjection, PANORAMA_EYE_UP, PANORAMA_FAR, PANORAMA_HEIGHT, PANORAMA_HEIGHT_M,
  PANORAMA_NEAR, PANORAMA_SECTORS, PANORAMA_WIDTH, type LakePanorama,
} from "../../src/game/lakePanorama.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });
function scene(): Scene {
  engine = new NullEngine();
  const s = new Scene(engine);
  s.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), s);
  return s;
}

/** The murky gate lake (room-3): centre (-97.4, 324), level 50.79 m, radius 26.1 m. */
const LAKE: LakeSource = { kind: "lake", level: 50.79, x: -97.4, z: 324, radius: 26.1, murk: 0.99, lobe: null };

/** The panorama's own camera: the scene's cameras minus the player's. */
function panoramaCamera(s: Scene): TargetCamera {
  const cam = s.cameras.find((c) => c.name === "lake_panorama_cam");
  if (!(cam instanceof TargetCamera)) throw new Error("no panorama camera");
  return cam;
}

/** Where a world point lands in the camera's frame: normalised device x, y, z. */
function ndc(camera: Camera, p: Vector3): Vector3 {
  return Vector3.TransformCoordinates(p, camera.getViewMatrix(true).multiply(camera.getProjectionMatrix()));
}

/** The point on the cylinder of the lake's radius at azimuth `azimuth` (0 facing +z) and `height` over the level. */
function onCylinder(azimuth: number, height: number): Vector3 {
  return new Vector3(LAKE.x + LAKE.radius * Math.sin(azimuth), LAKE.level + height, LAKE.z + LAKE.radius * Math.cos(azimuth));
}

describe("createLakePanorama", () => {
  it("is one 1024 by 128 half-float RGBA target with a depth buffer, round the turn in u, off the scene's targets until a capture", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const t = pano.texture;
    expect([PANORAMA_WIDTH, PANORAMA_HEIGHT, PANORAMA_SECTORS, PANORAMA_EYE_UP, PANORAMA_HEIGHT_M]).toEqual([1024, 128, 16, 0.4, 64]);
    expect([PANORAMA_NEAR, PANORAMA_FAR]).toEqual([0.5, 2500]);
    expect(t.name).toBe("lake_panorama");
    expect(t.getRenderWidth()).toBe(1024);
    expect(t.getRenderHeight()).toBe(128);
    expect(t.renderTargetOptions.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(t.renderTargetOptions.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(t.renderTargetOptions.generateDepthBuffer).toBe(true);
    expect(t.renderTargetOptions.generateMipMaps).toBe(false);
    expect(t.samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
    expect(t.wrapU).toBe(Texture.WRAP_ADDRESSMODE);
    expect(t.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    // A texel nothing drew is the sky between the trunks: alpha 0.
    expect(t.clearColor.asArray()).toEqual([0, 0, 0, 0]);
    expect(t.refreshRate).toBe(1);
    expect(t.renderParticles).toBe(false);
    expect(t.renderSprites).toBe(false);
    expect(t.ignoreCameraViewport).toBe(false);
    expect(t.renderList?.length).toBe(0);
    expect(s.customRenderTargets).not.toContain(t);
    pano.dispose();
  });

  it("looks out from the lake's centre 0.4 m over the level through its own camera, never the scene's active one", () => {
    const s = scene();
    const player = s.activeCamera;
    const pano = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    expect(pano.texture.activeCamera).toBe(cam);
    expect(s.activeCamera).toBe(player);
    expect(s.activeCameras ?? []).not.toContain(cam);
    expect(cam.position.x).toBe(-97.4);
    expect(cam.position.y).toBeCloseTo(51.19, 12);
    expect(cam.position.z).toBe(324);
    expect([cam.minZ, cam.maxZ]).toEqual([0.5, 2500]);
    pano.dispose();
  });

  it("captures in sixteen updates after a rearm, on the scene's targets only while it does", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    // Nothing to draw before the first capture.
    expect(pano.update()).toBe(false);
    expect(s.customRenderTargets).not.toContain(pano.texture);
    pano.rearm();
    for (let k = 0; k < 16; k++) {
      expect(pano.update(), `sector ${k}`).toBe(true);
      expect(s.customRenderTargets).toContain(pano.texture);
    }
    expect(pano.update()).toBe(false);
    expect(s.customRenderTargets).not.toContain(pano.texture);
    expect(pano.update()).toBe(false);
    // A rearm with none running starts at the sector next due: 16 and 0 are
    // the same place on the turn.
    pano.rearm();
    for (let k = 0; k < 16; k++) expect(pano.update(), `again ${k}`).toBe(true);
    expect(pano.update()).toBe(false);
    pano.dispose();
  });

  it("yaws to each sector's middle and draws it through its own column of the target", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    const yaws: number[] = [];
    const columns: number[] = [];
    pano.rearm();
    for (let k = 0; k < 16; k++) {
      pano.update();
      yaws.push(cam.rotation.y);
      columns.push(cam.viewport.x);
      expect([cam.rotation.x, cam.rotation.z]).toEqual([0, 0]);
      expect([cam.viewport.y, cam.viewport.width, cam.viewport.height]).toEqual([0, 0.0625, 1]);
    }
    // 22.5 degrees a sector, each centred on its own: pi / 16, 3 pi / 16, ... 31 pi / 16.
    expect(yaws[0]).toBeCloseTo(0.19634954084936207, 12);
    expect(yaws[1]).toBeCloseTo(0.5890486225480862, 12);
    expect(yaws[15]).toBeCloseTo(6.086835766330224, 12);
    expect(columns[0]).toBe(0);
    expect(columns[1]).toBe(0.0625);
    expect(columns[15]).toBe(0.9375);
    pano.dispose();
  });

  it("clears each sector's own column alone, in place of the target's whole clear", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const e = s.getEngine();
    const calls: string[] = [];
    vi.spyOn(e, "enableScissor").mockImplementation((x, y, w, h) => { calls.push(`scissor ${x} ${y} ${w} ${h}`); });
    vi.spyOn(e, "clear").mockImplementation((_c, color, depth, stencil) => { calls.push(`clear ${color} ${depth} ${stencil}`); });
    vi.spyOn(e, "disableScissor").mockImplementation(() => { calls.push("off"); });
    expect(pano.texture.skipInitialClear).toBe(true);
    pano.rearm();
    pano.update();
    pano.texture.onClearObservable.notifyObservers(e);
    pano.update();
    pano.update();
    pano.texture.onClearObservable.notifyObservers(e);
    expect(calls).toEqual([
      "scissor 0 0 64 128", "clear true true true", "off",
      "scissor 128 0 64 128", "clear true true true", "off",
    ]);
    expect(pano.texture.skipInitialClear).toBe(true);
    pano.dispose();
  });

  it("continues the turn on a rearm instead of restarting it, a rearm twice in a row counting once", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    const drawn = (): number => Math.round(cam.viewport.x * 16);
    pano.rearm();
    for (let k = 0; k < 5; k++) pano.update();
    expect(drawn()).toBe(4);
    pano.rearm();
    pano.rearm();
    const order: number[] = [];
    while (pano.update()) order.push(drawn());
    expect(order).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4]);
    expect(s.customRenderTargets).not.toContain(pano.texture);
    pano.dispose();
  });

  it("holds at its sector, off the list, until the target is ready to render", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    let ready = false;
    vi.spyOn(pano.texture, "isReadyForRendering").mockImplementation(() => ready);
    pano.rearm();
    for (let k = 0; k < 40; k++) {
      expect(pano.update(), `held ${k}`).toBe(true);
      expect(s.customRenderTargets).not.toContain(pano.texture);
    }
    ready = true;
    expect(pano.update()).toBe(true);
    expect(s.customRenderTargets).toContain(pano.texture);
    expect(cam.viewport.x).toBe(0);
    // The held frames did not count: sixteen sectors still follow in all.
    let more = 0;
    while (pano.update()) more++;
    expect(more).toBe(15);
    pano.dispose();
  });

  it("frames each sector on the cylinder of the lake's radius, from the level to 64 m over it, its edges the sector's", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    pano.rearm();
    pano.update();
    // Sector 0 runs from azimuth 0 to pi / 8; its middle is pi / 16. The
    // matrices are single floats about world coordinates in the hundreds: five places.
    const middle = Math.PI / 16;
    expect(ndc(cam, onCylinder(middle, 0)).y).toBeCloseTo(-1, 5);
    expect(ndc(cam, onCylinder(middle, 32)).y).toBeCloseTo(0, 5);
    expect(ndc(cam, onCylinder(middle, 64)).y).toBeCloseTo(1, 5);
    expect(ndc(cam, onCylinder(middle, 32)).x).toBeCloseTo(0, 5);
    expect(ndc(cam, onCylinder(0, 32)).x).toBeCloseTo(-1, 5);
    expect(ndc(cam, onCylinder(Math.PI / 8, 32)).x).toBeCloseTo(1, 5);
    // At the sector's edges the cylinder is nearer along the view by
    // cos(pi / 16): a height reads 2 percent farther from the eye's line, the
    // level just under the frame's foot and 64 m 4 percent over its top.
    expect(ndc(cam, onCylinder(0, 0)).y).toBeCloseTo(-1.000245, 5);
    expect(ndc(cam, onCylinder(0, 64)).y).toBeCloseTo(1.038937, 5);
    // Within the sector the planar frame departs from the angle by under a
    // quarter of a 64-texel column's texel: at 0.11386 rad past the middle
    // x is tan(d) / tan(pi / 16) = 0.5749 against the angle-linear 0.5799, 0.16 texel.
    expect(ndc(cam, onCylinder(middle + 0.11386, 32)).x).toBeCloseTo(0.5749, 4);
    // Sector 4 faces +x: its middle is 9 pi / 16, its left edge pi / 2.
    for (let k = 1; k < 5; k++) pano.update();
    expect(ndc(cam, onCylinder((9 * Math.PI) / 16, 0)).y).toBeCloseTo(-1, 5);
    expect(ndc(cam, onCylinder((9 * Math.PI) / 16, 32)).x).toBeCloseTo(0, 5);
    expect(ndc(cam, onCylinder(Math.PI / 2, 32)).x).toBeCloseTo(-1, 5);
    pano.dispose();
  });

  it("puts the near plane at 0.5 m and the far at 2500 m, in both depth ranges", () => {
    const at = (m: Matrix, z: number) => Vector3.TransformCoordinates(new Vector3(0, 0, z), m).z;
    const gl = panoramaProjection(26.1, false, new Matrix());
    expect(at(gl, 0.5)).toBeCloseTo(-1, 6);
    expect(at(gl, 2500)).toBeCloseTo(1, 6);
    const gpu = panoramaProjection(26.1, true, new Matrix());
    expect(at(gpu, 0.5)).toBeCloseTo(0, 6);
    expect(at(gpu, 2500)).toBeCloseTo(1, 6);
    // The frustum's spread across, and up and its shift, from the lake's radius alone.
    expect(gl.m[0]).toBeCloseTo(5.027339, 5);
    expect(gl.m[5]).toBeCloseTo(0.815625, 6);
    expect(gl.m[9]).toBeCloseTo(-0.9875, 6);
  });

  it("registers a mesh into the render list with a stand-in material or its own, and takes it out again", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    const cliff = MeshBuilder.CreateBox("cliff", { size: 1 }, s);
    const standIn = new StandardMaterial("stand_in", s);
    pano.register(ring, standIn);
    pano.register(cliff, null);
    pano.register(cliff, null);
    const listed = () => pano.texture.renderList?.map((m) => m.name);
    expect(listed()).toEqual(["ring", "cliff"]);
    const pass = pano.texture.renderPassId;
    const over = (m: Mesh) => m.getMaterialForRenderPass(pass);
    expect(over(ring)).toBe(standIn);
    expect(over(cliff)).toBeUndefined();
    expect(ring.material).toBeNull();
    pano.unregister(ring);
    expect(listed()).toEqual(["cliff"]);
    expect(over(ring)).toBeUndefined();
    pano.unregister(ring);
    expect(listed()).toEqual(["cliff"]);
    pano.dispose();
  });

  it("dispose takes the target off the scene's targets and the camera out of the scene, mid-capture too", () => {
    const s = scene();
    const pano: LakePanorama = createLakePanorama(s, LAKE);
    const cam = panoramaCamera(s);
    const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    pano.register(ring, null);
    // NullEngine compiles no effect, so a listed mesh never reads as ready on its own.
    vi.spyOn(pano.texture, "isReadyForRendering").mockReturnValue(true);
    pano.rearm();
    pano.update();
    expect(s.customRenderTargets).toContain(pano.texture);
    pano.dispose();
    expect(s.customRenderTargets).toEqual([]);
    expect(s.textures).not.toContain(pano.texture);
    expect(s.cameras).not.toContain(cam);
    expect(ring.isDisposed()).toBe(false);
    // A stray update after dispose ends the capture and never lists the target again.
    expect(pano.update()).toBe(false);
    expect(s.customRenderTargets).toEqual([]);
    // A registry call after dispose is a no-op.
    pano.register(ring, null);
    pano.unregister(ring);
  });
});

describe("createSkylineTexture", () => {
  it("is 512 by 1, one 32-bit float a texel, nearest and clamped", () => {
    const s = scene();
    const t = createSkylineTexture(s, Float32Array.from({ length: 512 }, (_, i) => i / 1024));
    expect(t.name).toBe("lake_skyline");
    expect(t.getSize()).toEqual({ width: 512, height: 1 });
    expect(t.format).toBe(Constants.TEXTUREFORMAT_R);
    expect(t.getInternalTexture()?.type).toBe(Constants.TEXTURETYPE_FLOAT);
    expect(t.getInternalTexture()?.format).toBe(Constants.TEXTUREFORMAT_R);
    expect(t.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
    expect([t.wrapU, t.wrapV]).toEqual([Texture.CLAMP_ADDRESSMODE, Texture.CLAMP_ADDRESSMODE]);
    expect(s.textures).toContain(t);
    t.dispose();
    expect(s.textures).not.toContain(t);
  });

  it("caps each elevation at 1.55 rad as it is written, so the read's tangent stays finite, and leaves the caller's array alone", () => {
    const s = scene();
    expect(SKYLINE_READ_MAX).toBe(1.55);
    const elevations = new Float32Array(512);
    elevations[0] = Math.PI / 2;
    elevations[1] = 1.6;
    elevations[2] = 1.2;
    elevations[3] = 0.3;
    const t = createSkylineTexture(s, elevations);
    const stored = (t.getInternalTexture() as unknown as { _bufferView: Float32Array })._bufferView;
    expect(Array.from(stored.slice(0, 5))).toEqual([Math.fround(1.55), Math.fround(1.55), Math.fround(1.2), Math.fround(0.3), 0]);
    expect(stored).toHaveLength(512);
    expect(elevations[0]).toBe(Math.fround(Math.PI / 2));
    expect(Math.tan(stored[0]!)).toBeCloseTo(48.08, 2);
  });

  it("refuses a skyline of any other length", () => {
    const s = scene();
    expect(() => createSkylineTexture(s, new Float32Array(511))).toThrow("a skyline is 512 elevations, not 511");
    expect(() => createSkylineTexture(s, new Float32Array(1024))).toThrow("a skyline is 512 elevations, not 1024");
  });
});
