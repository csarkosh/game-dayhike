/**
 * The shore panorama: the medium tier's picture of the lake's shore, which
 * its water reflects (spec §6.1).
 *
 * A render target of PANORAMA_WIDTH by PANORAMA_HEIGHT texels, half float,
 * holds the shore as seen from the lake's centre, PANORAMA_EYE_UP metres
 * over the water, so the trees are seen from beneath as a mirror sees them.
 * Its u is the azimuth, a whole turn across, 0 facing +z and a quarter facing
 * +x (`atan2(dx, dz)`, the skyline's and the cylinder read's u); its v is the
 * height over the level on the vertical cylinder of the lake's radius about
 * its centre, 0 at the level and 1 at PANORAMA_HEIGHT_M, so the water reads
 * it where its reflected ray meets that cylinder (`lakeMirror.fragment.fx`).
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
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Viewport } from "@babylonjs/core/Maths/math.viewport.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { LakeSource } from "../sim/terrain.js";
import { SKYLINE_EYE_UP } from "./lakeSkyline.js";

export const PANORAMA_WIDTH = 1024, PANORAMA_HEIGHT = 128, PANORAMA_SECTORS = 16;
/** The capture's eye over the level (m): the skyline's own, so the panorama
 * and the skyline that masks it see the shore from one place. */
export const PANORAMA_EYE_UP = SKYLINE_EYE_UP;
/**
 * The height over the level the capture reaches on the cylinder of the
 * lake's radius (m): the texture's v is a hit's height over this. It holds
 * the tallest giant (17.18 m model × GIANT_SCALE_MAX 4.1 = 70.4 m) standing
 * at the forest's edge 8 m past the rim of the smallest lake (25 m), on
 * ground 8 m over the level: seen from the eye 0.4 m up, its crown crosses
 * the cylinder at 0.4 + 25 × (70.4 + 8 − 0.4) / 33 = 59.5 m. Anything taller
 * clamps to the top row, the crowns.
 */
export const PANORAMA_HEIGHT_M = 64;
/** The capture camera's near and far planes (m): nothing it draws stands
 * within half a metre of the lake's centre, and the forest's impostors reach
 * 2 km. */
export const PANORAMA_NEAR = 0.5, PANORAMA_FAR = 2500;

export type LakePanorama = {
  readonly texture: RenderTargetTexture;
  register(mesh: Mesh, material: Material | null): void;
  unregister(mesh: Mesh): void;
  /** Asks for a whole turn (sixteen sectors, one a frame) from the next sector due; called at load and when the probe re-arms. */
  rearm(): void;
  /** Advances one sector when a capture is in progress, or holds while the target is not ready; true while capturing. */
  update(): boolean;
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
  const across = 1 / Math.tan(Math.PI / PANORAMA_SECTORS);
  // The tangents of the frustum's lowest and highest elevations.
  const bottom = -PANORAMA_EYE_UP / radius;
  const top = (PANORAMA_HEIGHT_M - PANORAMA_EYE_UP) / radius;
  const up = 2 / (top - bottom);
  const shift = -(top + bottom) / (top - bottom);
  const n = PANORAMA_NEAR;
  const f = PANORAMA_FAR;
  const depth = halfZ ? f / (f - n) : (f + n) / (f - n);
  const offset = halfZ ? (-f * n) / (f - n) : (-2 * f * n) / (f - n);
  Matrix.FromValuesToRef(across, 0, 0, 0, 0, up, 0, 0, 0, shift, depth, 1, 0, 0, offset, 0, out);
  return out;
}

/** The yaw of sector `sector`'s middle (rad): 0 faces +z, a quarter turn +x. */
export function sectorYaw(sector: number): number {
  return ((sector + 0.5) * 2 * Math.PI) / PANORAMA_SECTORS;
}

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
  // Round the turn: u wraps, so the seam at +z filters across; v clamps.
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.renderList = [];
  texture.renderParticles = false;
  texture.renderSprites = false;
  texture.clearColor = new Color4(0, 0, 0, 0);
  // While on the list, a sector every frame.
  texture.refreshRate = 1;

  const camera = new TargetCamera(
    "lake_panorama_cam", new Vector3(lake.x, lake.level + PANORAMA_EYE_UP, lake.z), scene, false,
  );
  camera.minZ = PANORAMA_NEAR;
  camera.maxZ = PANORAMA_FAR;
  camera.viewport = new Viewport(0, 0, 1 / PANORAMA_SECTORS, 1);
  camera.freezeProjectionMatrix(panoramaProjection(lake.radius, scene.getEngine().isNDCHalfZRange, new Matrix()));
  texture.activeCamera = camera;

  // The sector the next draw is of, and how many are still to draw in the
  // capture running (0 when none). The strip holds a whole turn when the count
  // runs out: a rearm gives sixteen more from the current sector, so one that
  // lands mid-capture continues the turn rather than restarting it.
  let sector = 0;
  let remaining = 0;
  // The column the sector now being drawn owns, for the clear.
  let column = 0;
  const columnWidth = PANORAMA_WIDTH / PANORAMA_SECTORS;

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
      remaining = PANORAMA_SECTORS;
    },
    update() {
      if (remaining <= 0) {
        listed(false);
        return false;
      }
      // A stand-in whose effect is still compiling would draw nothing: hold
      // at this sector, off the list, until the target can render.
      if (!texture.isReadyForRendering()) {
        listed(false);
        return true;
      }
      camera.rotation.y = sectorYaw(sector);
      camera.viewport.x = sector / PANORAMA_SECTORS;
      column = sector;
      listed(true);
      sector = (sector + 1) % PANORAMA_SECTORS;
      remaining--;
      return true;
    },
    dispose() {
      remaining = 0;
      listed(false);
      texture.dispose();
      camera.dispose();
    },
  };
}
