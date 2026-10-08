/**
 * The lake's mirror on the high tier (spec §5): the shore as the player would
 * see it reflected in the lake's plane, drawn every third frame into a target
 * of half the frame's size, 960 × 540 at most, that the lake's material reads
 * (`lakeMirror.fragment.fx`).
 *
 * The target has its own camera, never the scene's active one and never in
 * `scene.activeCameras`, after the rain map (`rainMap.ts`): a `TargetCamera`
 * whose view is the player's with the reflection in the plane y = level +
 * `MIRROR_LIFT` applied first (`reflectionMatrix · view`), and whose
 * projection is frozen to the player's with its near plane made the water
 * plane (Lengyel's oblique projection, `mirrorView.ts`), in the depth range
 * the engine uses (`halfZ`, `engine.isNDCHalfZRange`). Nothing under the
 * water reaches the target, with no `scene.clipPlane`, no clip-distance
 * varying and no shader variant. The reflection turns the winding over, so
 * for the pass `scene._mirroredCameraPosition` holds the mirrored eye, as
 * Babylon's `MirrorTexture` sets it, and front faces flip; its clip plane is
 * not copied.
 *
 * Only registered meshes draw (the target's `renderList`), each with its own
 * material or a stand-in for the pass (`setMaterialForRendering`): the
 * terrain's rings with `terrainMaterial`, one flat lit colour fogged as the
 * scene fogs (`lakeMirrorTerrain.*.fx`). The target is cleared to alpha 0,
 * so where nothing is drawn the read falls back to the sky probe. Particles
 * and sprites are left out.
 *
 * The pass runs in a frame only when `update` arms it: the lake in the
 * player's view this frame, the glass's share above 0, the eye over the
 * mirror's plane and within MIRROR_REACH_M of the lake's rim. Armed, the
 * target is on `scene.customRenderTargets` in the frames it draws (the first
 * armed frame, then every MIRROR_EVERY-th), which the scene renders before its
 * main pass; between draws, and unarmed, it is off that list and the scene
 * neither renders it nor waits on it for its readiness. Between draws the lake
 * reads the last image through the view-projection it was drawn with. The
 * mirror camera's field is the player's widened by MIRROR_FOV_MARGIN, so a
 * turn over the frames between draws reads inside the image.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { LakeSource } from "../sim/terrain.js";
import { cameraSpacePlane, obliqueProjection, reflectionMatrix } from "./mirrorView.js";
import terrainVertex from "./shaders/lakeMirrorTerrain.vertex.fx?raw";
import terrainFragment from "./shaders/lakeMirrorTerrain.fragment.fx?raw";

/** The target's size as a share of the engine's render size, each way, up to MIRROR_MAX_WIDTH × MIRROR_MAX_HEIGHT. */
export const MIRROR_SCALE = 0.5;
/** The target's largest size each way: half the frame up to a 4K frame's quarter, 960 × 540. Past that the pass's cost is its draws, not its fill. */
export const MIRROR_MAX_WIDTH = 960;
export const MIRROR_MAX_HEIGHT = 540;
/** The pass draws every this many frames while armed, the first armed frame always: between draws the lake reads the last image through the view-projection it was drawn with, so on the frames between the reflection is up to two frames behind the camera. */
export const MIRROR_EVERY = 3;
/** The mirror camera's field is the player's widened by this, each way (the tangent of the half field scaled), so a turn over the frames between draws stays inside the drawn image. */
export const MIRROR_FOV_MARGIN = 1.2;
/** The held frames' smear, in pixels of the frame's height per metre of the eye's travel over them, divided in the shader by the water point's distance: the parallax a reflected point that far away moves by, about half of it. */
export const MIRROR_MOTION_SMEAR = 0.5;
/** How much of the way the eye's travel moves the smoothed travel each frame. */
export const MIRROR_MOTION_SMOOTH = 0.3;
/** The mirror's plane over the lake's level, metres: the lake's surface mesh's own lift (`lakeSurface`, renderer.ts). */
export const MIRROR_LIFT = 0.02;
/** How much darker the ground draws under a full canopy in the mirror: `lakeMirrorTerrain.fragment.fx`'s LAKE_MIRROR_CANOPY_SHADE. */
export const MIRROR_CANOPY_SHADE = 0.5;
/** How far (m, across the ground) the eye may stand from the lake's rim
 * with the pass armed: past it the lake is a sliver of the frame, and the
 * probe's sheen stands in for its image. */
export const MIRROR_REACH_M = 200;
/** The terrain stand-in's name in Babylon's shader store. */
export const LAKE_MIRROR_TERRAIN_SHADER = "lakeMirrorTerrain";

export type LakeMirror = {
  readonly texture: RenderTargetTexture;
  /** The mirrored camera's view-projection, for the read (Babylon layout). */
  readonly viewProjection: Float32Array;
  /** The terrain's stand-in for the pass: register the terrain's rings with it. */
  readonly terrainMaterial: ShaderMaterial;
  /** Registers a mesh to draw in the mirror, with a stand-in material or null for its own. */
  register(mesh: Mesh, material: Material | null): void;
  unregister(mesh: Mesh): void;
  /** The ground's lit base colour (linear), for the terrain's stand-in. */
  setTerrainColour(r: number, g: number, b: number): void;
  /** Called each frame before the scene renders, with the player's camera, whether the lake is in its view this frame and the calm share: arms the pass or leaves it off (off too with the eye at or under the mirror's plane, or MIRROR_REACH_M or more from the rim). Armed, the pass draws this frame or holds the last image. Returns whether it is armed, so whether the lake may read the target. */
  update(camera: Camera, lakeInView: boolean, calmShare: number): boolean;
  dispose(): void;
};

/** The mirrored camera: a `TargetCamera` whose view is the one `update` writes, never one made from a position and a rotation. */
class MirrorCamera extends TargetCamera {
  /** The mirrored view (Babylon layout), written in place each frame the pass draws. */
  readonly mirrorView = Matrix.Identity();

  override _getViewMatrix(): Matrix {
    return this.mirrorView;
  }
}

/** Puts the terrain stand-in's stages in the store once. */
function storeTerrainShader(): void {
  const vertex = `${LAKE_MIRROR_TERRAIN_SHADER}VertexShader`;
  if (Effect.ShadersStore[vertex] === undefined) {
    Effect.ShadersStore[vertex] = terrainVertex;
    Effect.ShadersStore[`${LAKE_MIRROR_TERRAIN_SHADER}FragmentShader`] = terrainFragment;
  }
}

/**
 * The terrain's stand-in, one flat lit colour darker under the canopy and
 * fogged as the scene fogs, named `lake_mirror_terrain`; its colour
 * (`lakeMirrorColour`, linear) starts black and is the caller's to set. The
 * mirror makes its own through this, and a pass of another tier may make one
 * of its own.
 */
export function createLakeMirrorTerrain(scene: Scene): ShaderMaterial {
  storeTerrainShader();
  const material = new ShaderMaterial("lake_mirror_terrain", scene, LAKE_MIRROR_TERRAIN_SHADER, {
    attributes: ["position", "terrainWeights2"],
    uniforms: ["world", "viewProjection", "lakeMirrorColour"],
    useClipPlane: false,
  });
  material.setColor3("lakeMirrorColour", new Color3(0, 0, 0));
  return material;
}

/** The target's size for an engine render size: half each way, at most `cap`, at least a texel. */
function targetSize(engineSize: number, cap: number): number {
  return Math.max(1, Math.min(cap, Math.round(engineSize * MIRROR_SCALE)));
}

/** The eye's travel the held frames can lag by, metres, smoothed: `motion` is the last value, `eyeStep` the eye's travel this frame. The frames between draws are MIRROR_EVERY − 1, so the lag is that many steps; the smoothing keeps it from flickering with the cadence. */
export function mirrorMotion(motion: number, eyeStep: number): number {
  return motion + ((MIRROR_EVERY - 1) * eyeStep - motion) * MIRROR_MOTION_SMOOTH;
}

/** The high tier's mirror for `lake`; `halfZ` is the engine's depth range (`engine.isNDCHalfZRange`). */
export function createLakeMirror(scene: Scene, lake: LakeSource, halfZ: boolean): LakeMirror {
  const engine = scene.getEngine();
  // The screen's size, never a render target's that happens to be bound.
  let width = targetSize(engine.getRenderWidth(true), MIRROR_MAX_WIDTH);
  let height = targetSize(engine.getRenderHeight(true), MIRROR_MAX_HEIGHT);

  const texture = new RenderTargetTexture(
    "lake_mirror",
    { width, height },
    scene,
    {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_HALF_FLOAT,
      format: Constants.TEXTUREFORMAT_RGBA,
      samplingMode: Texture.BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: true,
    },
  );
  // Clamped: a smeared read near the target's edge never wraps to the far side.
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.renderList = [];
  texture.renderParticles = false;
  texture.renderSprites = false;
  // Its readiness never waits on the scene's particles, which it never draws.
  texture.particleSystemList = [];
  // Alpha 0 where nothing is drawn: the read falls back to the sky probe there.
  texture.clearColor = new Color4(0, 0, 0, 0);
  texture.refreshRate = 1;

  const camera = new MirrorCamera("lake_mirror_cam", Vector3.Zero(), scene, false);
  texture.activeCamera = camera;

  const level = lake.level + MIRROR_LIFT;
  // Made once: the reflection, and the scratch every armed frame writes into.
  const reflection = Matrix.FromArray(reflectionMatrix(level, new Float32Array(16)));
  const projection = Matrix.Identity();
  camera.freezeProjectionMatrix(projection);
  const playerProjection = new Float32Array(16);
  const mirroredView = new Float32Array(16);
  const plane = new Float32Array(4);
  const oblique = new Float32Array(16);
  const viewProjectionMatrix = Matrix.Identity();
  const viewProjection = new Float32Array(16);
  const eye = new Vector3();

  // The pass, and only the pass, sees the mirrored eye: front faces flip with
  // the reflected view (Babylon's material binding reads it), and the eye
  // position the materials light and fog by is the mirrored one.
  const before = texture.onBeforeRenderObservable.add(() => {
    eye.copyFrom(camera.globalPosition);
    scene._mirroredCameraPosition = eye;
    scene._forcedViewPosition = eye;
  });
  const after = texture.onAfterRenderObservable.add(() => {
    scene._mirroredCameraPosition = null;
    scene._forcedViewPosition = null;
  });

  const terrainMaterial = createLakeMirrorTerrain(scene);
  const terrainColour = new Color3(0, 0, 0);

  let armed = false;
  // Frames since the pass last drew, while armed.
  let sinceDraw = 0;
  // Once disposed, an update arms nothing: the target is gone.
  let disposed = false;
  /** Puts the target on the scene's list for this frame's pass, or takes it off. */
  function listTarget(on: boolean): void {
    const targets = scene.customRenderTargets;
    const at = targets.indexOf(texture);
    if (on && at === -1) targets.push(texture);
    if (on || at === -1) return;
    // In place: nothing allocated per frame, the other targets' order kept.
    for (let i = at; i < targets.length - 1; i++) targets[i] = targets[i + 1] as RenderTargetTexture;
    targets.pop();
  }

  return {
    texture,
    viewProjection,
    terrainMaterial,
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
    setTerrainColour(r, g, b) {
      terrainColour.set(r, g, b);
      terrainMaterial.setColor3("lakeMirrorColour", terrainColour);
    },
    update(player, lakeInView, calmShare) {
      if (disposed) return false;
      // An eye at or under the plane would turn the near plane over (the
      // kept half clipped, the lake bed drawn): nothing to mirror. Nor from
      // beyond the reach.
      const rim = Math.hypot(player.position.x - lake.x, player.position.z - lake.z) - lake.radius;
      const on = lakeInView && calmShare > 0 && player.position.y > level && rim < MIRROR_REACH_M;
      if (!on) {
        armed = false;
        listTarget(false);
        return false;
      }
      // The first armed frame draws, so no stale image is read, then every
      // MIRROR_EVERY-th; between draws the target holds its image and its
      // view-projection, and is off the scene's list.
      const draw = !armed || sinceDraw >= MIRROR_EVERY - 1;
      armed = true;
      sinceDraw = draw ? 0 : sinceDraw + 1;
      listTarget(draw);
      if (!draw) return true;
      // The window may have changed size: the target follows, on a frame it
      // draws, so the image being read keeps its size.
      const w = targetSize(engine.getRenderWidth(true), MIRROR_MAX_WIDTH);
      const h = targetSize(engine.getRenderHeight(true), MIRROR_MAX_HEIGHT);
      if (w !== width || h !== height) {
        width = w;
        height = h;
        texture.resize({ width, height });
      }
      reflection.multiplyToRef(player.getViewMatrix(), camera.mirrorView);
      // Refreshes the camera's computed view and, from its inverse, the
      // mirrored eye (its global position).
      camera.getViewMatrix(true);
      camera.mirrorView.copyToArray(mirroredView);
      cameraSpacePlane(mirroredView, level, plane);
      player.getProjectionMatrix().copyToArray(playerProjection);
      // The field widened by the margin: the focal terms of x and y (Babylon's layout).
      playerProjection[0] = playerProjection[0]! / MIRROR_FOV_MARGIN;
      playerProjection[5] = playerProjection[5]! / MIRROR_FOV_MARGIN;
      obliqueProjection(playerProjection, plane, halfZ, oblique);
      Matrix.FromArrayToRef(oblique, 0, projection);
      camera.mirrorView.multiplyToRef(projection, viewProjectionMatrix);
      viewProjectionMatrix.copyToArray(viewProjection);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      armed = false;
      listTarget(false);
      texture.onBeforeRenderObservable.remove(before);
      texture.onAfterRenderObservable.remove(after);
      texture.dispose();
      camera.dispose();
      terrainMaterial.dispose();
    },
  };
}
