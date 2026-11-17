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
 * mirror's plane and within MIRROR_REACH_M of the lake's bound (spec §10.2).
 * One mirror serves the nearest lake (§10.3): `setLake` moves it to another,
 * its plane and its reach with it. Armed, the target is on
 * `scene.customRenderTargets` in the frames it draws (the first armed frame,
 * then every MIRROR_EVERY-th), which the scene renders before its main pass;
 * between draws, and unarmed, it is off that list and the scene neither
 * renders it nor waits on it for its readiness. Between draws the lake
 * reads the last image through the view-projection it was drawn with. The
 * mirror camera's field is the player's widened by MIRROR_FOV_MARGIN, so a
 * turn over the frames between draws reads inside the image.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { LakeSource } from "../sim/terrain.js";
import { MIRROR_FOV_MARGIN, MIRROR_LIFT, MIRROR_MAX_HEIGHT, MIRROR_MAX_WIDTH, createMirrorCadence, mirrorArmed, mirrorTargetSize } from "./mirrorPass.js";
import { cameraSpacePlane, obliqueProjection, reflectionMatrix } from "./mirrorView.js";
import terrainVertex from "./shaders/lakeMirrorTerrain.vertex.fx?raw";
import terrainFragment from "./shaders/lakeMirrorTerrain.fragment.fx?raw";

// The picture's size, when the pass is armed and which armed frames draw, and the held frames' smear are kept with
// no engine (`mirrorPass.ts`), for this shell and the one on Babylon Lite alike.
export {
  MIRROR_EVERY, MIRROR_FOV_MARGIN, MIRROR_LIFT, MIRROR_MAX_HEIGHT, MIRROR_MAX_WIDTH, MIRROR_MOTION_SMEAR, MIRROR_MOTION_SMOOTH, MIRROR_MOTION_STEP_MAX_M, MIRROR_REACH_M,
  MIRROR_SCALE, mirrorMotion,
} from "./mirrorPass.js";
// How much darker the ground draws under a full canopy in the mirror is kept with no engine (`mirrorGround.ts`).
export { MIRROR_CANOPY_SHADE } from "./mirrorGround.js";
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
  /** Called each frame before the scene renders, with the player's camera, whether the lake is in its view this frame and the calm share: arms the pass or leaves it off (off too with the eye at or under the mirror's plane, or MIRROR_REACH_M or more past the lake's bound). Armed, the pass draws this frame or holds the last image. Returns whether it is armed, so whether the lake may read the target. */
  update(camera: Camera, lakeInView: boolean, calmShare: number): boolean;
  /** Moves the mirror to `lake`: its plane, its reach, and a fresh image on the next armed frame. Allocates nothing. */
  setLake(lake: LakeSource): void;
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

/** The high tier's mirror for `lake`; `halfZ` is the engine's depth range (`engine.isNDCHalfZRange`). */
export function createLakeMirror(scene: Scene, first: LakeSource, halfZ: boolean): LakeMirror {
  const engine = scene.getEngine();
  // The screen's size, never a render target's that happens to be bound.
  let width = mirrorTargetSize(engine.getRenderWidth(true), MIRROR_MAX_WIDTH);
  let height = mirrorTargetSize(engine.getRenderHeight(true), MIRROR_MAX_HEIGHT);

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
  // The far softening's prepass (post.ts) draws for the scene's camera alone: a
  // render target it took up would get a prepass target of its own and re-read
  // every material's defines the first time it cleared, so each of the game's
  // own opts out.
  texture.noPrePassRenderer = true;
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

  // The lake served, and its plane: `setLake` moves both.
  let lake = first;
  let level = lake.level + MIRROR_LIFT;
  // Made once: the reflection, and the scratch every armed frame writes into.
  const reflectionArray = new Float32Array(16);
  const reflection = Matrix.FromArray(reflectionMatrix(level, reflectionArray));
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

  // Which armed frames draw (`mirrorPass.ts`).
  const cadence = createMirrorCadence();
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
      const past = Math.hypot(player.position.x - lake.x, player.position.z - lake.z) - lake.bound;
      // The first armed frame draws, so no stale image is read, then every
      // MIRROR_EVERY-th; between draws the target holds its image and its
      // view-projection, and is off the scene's list.
      const draw = cadence.step(mirrorArmed(lakeInView, calmShare, player.position.y, level, past));
      if (!cadence.armed) {
        listTarget(false);
        return false;
      }
      listTarget(draw);
      if (!draw) return true;
      // The window may have changed size: the target follows, on a frame it
      // draws, so the image being read keeps its size.
      const w = mirrorTargetSize(engine.getRenderWidth(true), MIRROR_MAX_WIDTH);
      const h = mirrorTargetSize(engine.getRenderHeight(true), MIRROR_MAX_HEIGHT);
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
    setLake(next) {
      lake = next;
      level = next.level + MIRROR_LIFT;
      Matrix.FromArrayToRef(reflectionMatrix(level, reflectionArray), 0, reflection);
      // The image held is of the other lake: the next armed frame draws.
      cadence.rest();
      listTarget(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cadence.rest();
      listTarget(false);
      texture.onBeforeRenderObservable.remove(before);
      texture.onAfterRenderObservable.remove(after);
      texture.dispose();
      camera.dispose();
      terrainMaterial.dispose();
    },
  };
}
