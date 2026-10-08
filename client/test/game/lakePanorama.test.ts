import { describe, it, expect, afterEach } from "vitest";
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
  createLakePanorama, panoramaProjection, PANORAMA_EYE_UP, PANORAMA_FAR, PANORAMA_HEIGHT, PANORAMA_HEIGHT_M,
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
    // A rearm mid-capture starts the turn again from the first sector.
    pano.rearm();
    for (let k = 0; k < 5; k++) pano.update();
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

  it("clears the whole target on the first sector and draws the rest over it", () => {
    const s = scene();
    const pano = createLakePanorama(s, LAKE);
    pano.rearm();
    const skips: boolean[] = [];
    for (let k = 0; k < 16; k++) {
      pano.update();
      skips.push(pano.texture.skipInitialClear);
    }
    expect(skips[0]).toBe(false);
    expect(skips.slice(1)).toEqual(new Array(15).fill(true));
    pano.rearm();
    pano.update();
    expect(pano.texture.skipInitialClear).toBe(false);
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
    pano.rearm();
    pano.update();
    expect(s.customRenderTargets).toContain(pano.texture);
    pano.dispose();
    expect(s.customRenderTargets).toEqual([]);
    expect(s.textures).not.toContain(pano.texture);
    expect(s.cameras).not.toContain(cam);
    expect(ring.isDisposed()).toBe(false);
    // A registry call after dispose is a no-op.
    pano.register(ring, null);
    pano.unregister(ring);
  });
});
