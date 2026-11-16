/**
 * The shore panorama: the medium tier's picture of the lake's shore, which
 * its water reflects (spec §6.1).
 *
 * A render target of PANORAMA_WIDTH by PANORAMA_HEIGHT texels, half float,
 * holds the shore as seen from the lake's centre, PANORAMA_EYE_UP metres
 * over the water, so the trees are seen from beneath as a mirror sees them.
 * Its u is the azimuth, a whole turn across, 0 facing +z and a quarter facing
 * +x (`atan2(dx, dz)`, the skyline's and the cylinder read's u); its v is the
 * height over the level on the vertical cylinder of the lake's mean radius
 * (`shape.meanRadius`) about its centre, 0 at the level and 1 at
 * PANORAMA_HEIGHT_M, so the water reads it where its reflected ray meets
 * that cylinder (`lakeMirror.fragment.fx`). One panorama serves the nearest
 * lake (spec §10.3): `setLake` moves its eye and re-captures the turn.
 * A texel nothing drew holds alpha 0: the sky between the trunks, which the
 * read leaves to the probe.
 *
 * The turn is drawn in PANORAMA_SECTORS sectors, one a frame, through its own
 * camera (never the scene's active one): yawed to the sector's middle, drawn
 * into the sector's column through the camera's viewport, its projection
 * fixed for the lake by `panoramaProjection`. Each sector clears its own
 * column alone, so the rest keep what they hold. The target is on
 * `scene.customRenderTargets`, which the scene renders before its main pass,
 * only while a capture runs: `rearm` (at load, and whenever the sky probe is
 * re-armed by the hour or the weather) asks for a whole turn from the sector
 * next due, so a rearm in the middle of a capture continues the turn and
 * every column is at most sixteen frames old however often it is called;
 * each `update` sets up the next sector for that frame's render, holds where
 * it is while the target cannot yet render, and the one after the last takes
 * the target off the list, so nothing is drawn between captures.
 *
 * Only registered meshes draw into it, each with a stand-in material or its
 * own (`setMaterialForRendering`). Particles and sprites are left out.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Viewport } from "@babylonjs/core/Maths/math.viewport.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { LakeSource } from "../sim/terrain.js";
import { SKYLINE_TEXELS, skylineTexels } from "./lakeSkyline.js";
import {
  PANORAMA_EYE_UP, PANORAMA_FAR, PANORAMA_HEIGHT, PANORAMA_NEAR, PANORAMA_SECTORS, PANORAMA_SECTOR_WIDTH, PANORAMA_WIDTH, TURN_HOLD, createPanoramaTurn,
  panoramaFrustum, sectorYaw, type PanoramaFrustum,
} from "./panoramaTurn.js";

// The picture's size, its sectors, its eye and its reach are kept with no engine (`panoramaTurn.ts`).
export { PANORAMA_EYE_UP, PANORAMA_FAR, PANORAMA_HEIGHT, PANORAMA_HEIGHT_M, PANORAMA_NEAR, PANORAMA_SECTORS, PANORAMA_WIDTH, sectorYaw } from "./panoramaTurn.js";

export type LakePanorama = {
  readonly texture: RenderTargetTexture;
  register(mesh: Mesh, material: Material | null): void;
  unregister(mesh: Mesh): void;
  /** Asks for a whole turn (sixteen sectors, one a frame) from the next sector due; called at load and when the probe re-arms. */
  rearm(): void;
  /** Advances one sector when a capture is in progress, or holds while the target is not ready; true while capturing. */
  update(): boolean;
  /** Moves the capture to `lake`: its eye over its centre, its projection by its mean radius, and a whole turn from the sector next due. */
  setLake(lake: LakeSource): void;
  dispose(): void;
};

/**
 * The capture's projection for a lake of `radius` (Babylon's layout, row
 * vectors): a sector's turn across, tan(π / PANORAMA_SECTORS) either side,
 * and from the level to PANORAMA_HEIGHT_M over it on the cylinder of the
 * lake's radius, seen from PANORAMA_EYE_UP over the level. The frustum is
 * shifted up rather than tilted, so v runs linearly with height on the
 * cylinder. Depth in [0, 1] with `halfZ` (WebGPU), else [−1, 1]. Writes into
 * `out` and returns it.
 */
export function panoramaProjection(radius: number, halfZ: boolean, out: Matrix): Matrix {
  const { across, up, shift } = panoramaFrustum(radius, frustum);
  const n = PANORAMA_NEAR;
  const f = PANORAMA_FAR;
  const depth = halfZ ? f / (f - n) : (f + n) / (f - n);
  const offset = halfZ ? (-f * n) / (f - n) : (-2 * f * n) / (f - n);
  Matrix.FromValuesToRef(across, 0, 0, 0, 0, up, 0, 0, 0, shift, depth, 1, 0, 0, offset, 0, out);
  return out;
}

/** The frustum's terms, reused. */
const frustum: PanoramaFrustum = { across: 0, up: 0, shift: 0 };

/** The medium tier's shore panorama for `lake`. */
export function createLakePanorama(scene: Scene, lake: LakeSource): LakePanorama {
  const texture = new RenderTargetTexture(
    "lake_panorama",
    { width: PANORAMA_WIDTH, height: PANORAMA_HEIGHT },
    scene,
    {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_HALF_FLOAT,
      format: Constants.TEXTUREFORMAT_RGBA,
      samplingMode: Texture.BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: true,
    },
  );
  // The far softening's prepass (post.ts) draws for the scene's camera alone: a
  // render target it took up would get a prepass target of its own and re-read
  // every material's defines the first time it cleared, so each of the game's
  // own opts out.
  texture.noPrePassRenderer = true;
  // Round the turn: u wraps, so the seam at +z filters across; v clamps.
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.renderList = [];
  texture.renderParticles = false;
  texture.renderSprites = false;
  // Its readiness never waits on the scene's particles, which it never draws.
  texture.particleSystemList = [];
  texture.clearColor = new Color4(0, 0, 0, 0);
  // While on the list, a sector every frame.
  texture.refreshRate = 1;

  const camera = new TargetCamera(
    "lake_panorama_cam", new Vector3(lake.x, lake.level + PANORAMA_EYE_UP, lake.z), scene, false,
  );
  camera.minZ = PANORAMA_NEAR;
  camera.maxZ = PANORAMA_FAR;
  camera.viewport = new Viewport(0, 0, 1 / PANORAMA_SECTORS, 1);
  const projection = new Matrix();
  camera.freezeProjectionMatrix(panoramaProjection(lake.shape.meanRadius, scene.getEngine().isNDCHalfZRange, projection));
  texture.activeCamera = camera;

  // The sector the next draw is of, and how many are still to draw in the
  // capture running (0 when none). The strip holds a whole turn when the count
  // runs out: a rearm gives sixteen more from the current sector, so one that
  // lands mid-capture continues the turn rather than restarting it.
  const turn = createPanoramaTurn();
  // Once disposed, a rearm asks for nothing: the target is gone.
  let disposed = false;
  // The column the sector now being drawn owns, for the clear.
  let column = 0;
  const columnWidth = PANORAMA_SECTOR_WIDTH;

  // A sector clears its own column and nothing else, colour and depth, so
  // the columns of the other fifteen keep what they hold. This replaces the
  // target's own clear, which would take the whole attachment.
  texture.skipInitialClear = true;
  texture.onClearObservable.add((engine) => {
    engine.enableScissor(columnWidth * column, 0, columnWidth, PANORAMA_HEIGHT);
    engine.clear(texture.clearColor, true, true, true);
    engine.disableScissor();
  });

  const listed = (on: boolean): void => {
    const at = scene.customRenderTargets.indexOf(texture);
    if (on && at === -1) scene.customRenderTargets.push(texture);
    if (!on && at !== -1) scene.customRenderTargets.splice(at, 1);
  };

  return {
    texture,
    // Both guard the list: `dispose` leaves it null, and a registry call can
    // land after it.
    register(mesh, material) {
      const list = texture.renderList;
      if (list === null) return;
      if (!list.includes(mesh)) list.push(mesh);
      texture.setMaterialForRendering(mesh, material ?? undefined);
    },
    unregister(mesh) {
      const list = texture.renderList;
      if (list === null) return;
      const at = list.indexOf(mesh);
      if (at !== -1) list.splice(at, 1);
      if (!mesh.isDisposed()) texture.setMaterialForRendering(mesh, undefined);
    },
    rearm() {
      turn.rearm();
    },
    setLake(next) {
      if (disposed) return;
      camera.position.set(next.x, next.level + PANORAMA_EYE_UP, next.z);
      camera.freezeProjectionMatrix(panoramaProjection(next.shape.meanRadius, scene.getEngine().isNDCHalfZRange, projection));
      turn.rearm();
    },
    update() {
      if (turn.remaining <= 0) {
        listed(false);
        return false;
      }
      // A stand-in whose effect is still compiling would draw nothing: hold
      // at this sector, off the list, until the target can render.
      const sector = turn.step(texture.isReadyForRendering());
      if (sector === TURN_HOLD) {
        listed(false);
        return true;
      }
      camera.rotation.y = sectorYaw(sector);
      camera.viewport.x = sector / PANORAMA_SECTORS;
      column = sector;
      listed(true);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      turn.end();
      listed(false);
      texture.dispose();
      camera.dispose();
    },
  };
}

export { SKYLINE_READ_MAX } from "./lakeSkyline.js";

/**
 * The skyline as the water reads it (`waterSkyline`, on medium and low):
 * SKYLINE_TEXELS by 1, one 32-bit float a texel, the treeline's elevation
 * from `skylineElevations`, each capped at SKYLINE_READ_MAX as it is written
 * (the caller's array is left as it was). Nearest, as a 32-bit float must be
 * sampled on WebGPU, and clamped: a u in 0 to 1 never reaches past the last
 * texel.
 */
export function createSkylineTexture(scene: Scene, elevations: Float32Array): RawTexture {
  const capped = skylineTexels(elevations);
  const texture = RawTexture.CreateRTexture(
    capped, SKYLINE_TEXELS, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
  );
  texture.name = "lake_skyline";
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}
