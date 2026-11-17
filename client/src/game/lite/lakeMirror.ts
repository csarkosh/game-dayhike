/**
 * The lake's mirror on Babylon Lite: the high tier's picture of a lake's
 * shore as the player would see it reflected in the lake's plane, which the
 * lake's glass reads, as the game draws it on Babylon.js (`lakeMirror.ts`),
 * from what the game draws it with (`mirrorPass.ts`: the picture's size,
 * when the pass is armed and which armed frames draw, the mirrored camera
 * and its projection; `mirrorView.ts`: the oblique near plane;
 * `mirrorGround.ts`: the ground's flat colour).
 *
 * - **The mirror is a pass of the hike's own frame, drawn before it, and
 *   only on a frame that draws it**: a render task of the scene with a
 *   camera and a list of its own, as the shore panorama's is
 *   (`lakePanorama.ts`). It is armed only while the view holds the served
 *   lake's water with glass on it, the eye over the plane and within reach
 *   (`mirrorArmed`), and draws on the first armed frame and every third
 *   after (`createMirrorCadence`); between draws the lake reads the picture
 *   it holds through the view it was drawn with. With no lake's glass in
 *   view there is no pass and no write.
 * - **Its camera is the player's mirrored in the plane, of the ordinary
 *   kind** (`mirroredPose`): Lite cannot be told to turn its front faces
 *   over for one pass, which the reflection's own view would ask, as
 *   Babylon.js is told. The picture is the reflection's turned over left to
 *   right, and the lake's read turns it back (`mirrorRead`,
 *   `LAKE_MIRROR_WGSL`). The eye every material of the pass lights and
 *   fades by is the mirrored one, the pass's own.
 * - **Its projection is written whole by the camera's hook**: the player's
 *   with its field widened by the margin and its near plane made the
 *   water's, where depth runs from 1 to 0, so nothing under the water is
 *   drawn and no material needs a clip plane.
 * - **Its picture is half the frame each way**, up to the game's cap, in a
 *   target that follows the frame's size and stands while it does; cleared
 *   to nothing drawn, and the pass ends by writing an alpha of 1 wherever
 *   it drew, which is what the lake weighs the picture by.
 * - **The ground is the reflections' stand-in** (`panoramaGroundPlugin`):
 *   the rings and the patches in one flat lit colour under the scene's
 *   distance fog from the pass's eye. Everything else is drawn in its own
 *   material: the forest's billboards, the cliffs' far ring, the props and
 *   the lake's plants, the plants by the pass's own word whatever the
 *   frame's view holds of them.
 * - **Left out of it, which the game's mirror draws**: the near forest's
 *   coarsest level of full geometry, the cliffs' second ring, the lake's
 *   insects and the animals. The first cannot join a second pass yet: Lite
 *   builds such a mesh's bindings against a layout that orders the sky's
 *   two pictures the other way, and the device refuses the frame. So a
 *   tree within the near field's reach of the eye is not in the
 *   reflection; one beyond it is, as its billboard.
 */
import {
  addMeshToTask, addTaskAtStart, addToScene, createBankedFreeCamera, createMeshFromData, createPbrMaterial, createRenderTarget, createRenderTask,
  createTexture2DFromPixels, disposeMeshGpu, getGpuDevice, getProjectionMatrix, getRenderTargetAttachments, markMaterialUboDirty, removeFromScene,
  removeMeshFromTask, setMeshVisible, setTaskMeshVisible, setThinInstances, vec3,
  type BankedFreeCamera, type EngineContext, type Mesh, type PluginUniformBlock, type RenderTarget, type RenderTargetAttachments, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import type { LakeSource } from "../../sim/terrain.js";
import { mirrorGroundColour, type MirrorGroundSky } from "../mirrorGround.js";
import {
  MIRROR_LIFT, createMirrorCadence, mirrorArmed, mirrorProjection, mirrorRead, mirrorScale, mirroredPose, poseView, type MirrorPose,
} from "../mirrorPass.js";
import type { WeatherParams } from "../weather.js";
import type { FrameUploads } from "./frameUploads.js";
import { panoramaGroundPlugin, type PanoramaGroundUniforms, type ReflectionRegistry } from "./lakePanorama.js";

/** The picture's format: half floats, as the game's, for lit colour ahead of the display's curve. */
export const MIRROR_FORMAT = "rgba16float";
/** The picture's depth buffer. */
export const MIRROR_DEPTH_FORMAT = "depth24plus";
/** How far ahead of the mirrored eye the point its camera looks at is put, metres. */
const LOOK_AHEAD = 10;

/** A frame as the mirror reads it. */
export type MirrorFrame = {
  /** The player's eye and the way it looks, with its up. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  axes: { readonly fx: number; readonly fy: number; readonly fz: number; readonly ux: number; readonly uy: number; readonly uz: number };
  /** The frame's size, pixels. */
  frameWidth: number;
  frameHeight: number;
  /** The sky's state, null before its first slices, and the weather: the ground's colour. */
  sky: MirrorGroundSky | null;
  weather: WeatherParams;
};

/** What the mirror has drawn, for whoever counts it. */
export type MirrorCounts = {
  /** Meshes in its list: each is a draw of its pass while it is shown. */
  meshes: number;
  /** Frames it drew since it was made: each a pass. */
  draws: number;
  /** Frames it was armed and held the picture it had. */
  held: number;
};

export type LiteLakeMirror = {
  /** The picture as it now stands, for a lake's material to bind: nothing drawn before the frame's passes are first recorded. */
  texture(): Texture2D;
  /** The view-projection the picture was last drawn through, as the reflection's own camera has it (`mirrorRead`). */
  readonly viewProjection: Float32Array;
  /** The terrain's rings and patches, drawn through the stand-in. */
  readonly ground: ReflectionRegistry;
  /** What is drawn in its own material. */
  readonly own: ReflectionRegistry;
  /** Moves the mirror to `lake`: its plane, its reach, and a fresh picture on the next armed frame. */
  setLake(lake: LakeSource): void;
  /**
   * A frame: `inView` whether the served lake's water is in the view, and
   * `calmShare` its glass's share. Arms the pass or leaves it off, and
   * draws with this frame or holds the picture. Returns whether it is
   * armed, so whether the lake may read the picture.
   */
  update(inView: boolean, calmShare: number, frame: MirrorFrame): boolean;
  /** Says the frame is drawn: the pass is not drawn again until an `update` asks. */
  frameDrawn(): void;
  readonly counts: MirrorCounts;
  /** Takes every mesh out of the list. The pass and its target go with the scene. */
  dispose(): void;
};

export type MirrorOptions = {
  /** The hike's camera, whose projection the mirror's is made from. */
  player: BankedFreeCamera;
  /** The frame's block, for the scene's distance fog. */
  shared: PluginUniformBlock;
  uploads?: FrameUploads;
};

/** The mirror of `scene` for `lake`, made before the scene is registered. */
export function createLiteLakeMirror(engine: EngineContext, scene: SceneContext, lake: LakeSource, options: MirrorOptions): LiteLakeMirror {
  const { uploads, player } = options;
  // The picture and its depth: a share of the frame, which follows the frame's size and stands while it does.
  const size = { surface: engine, scale: mirrorScale(engine.canvas.width, engine.canvas.height) };
  const target: RenderTarget = createRenderTarget({ lbl: "lake_mirror", format: MIRROR_FORMAT, dFormat: MIRROR_DEPTH_FORMAT, samples: 1, size, keep: true });
  // Read through a sampler of its own: filtered, clamped, so a smeared read near its edge never wraps.
  const sampler = getGpuDevice(engine).createSampler({ label: "lake_mirror", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear" });
  const nothing: Texture2D = { ...createTexture2DFromPixels(engine, new Uint8Array(4), 1, 1), sampler };
  const now = {} as RenderTargetAttachments;
  let of: GPUTextureView | null = null;
  let picture: Texture2D = nothing;

  // The mirrored camera, the pass's own and never the scene's: placed each frame it draws, its projection written whole.
  const camera = createBankedFreeCamera(vec3(lake.x, lake.level + 1, lake.z), vec3(lake.x, lake.level + 1, lake.z + LOOK_AHEAD), vec3(0, 1, 0));
  const oblique = new Float32Array(16);
  let projected = false;
  camera.projectionHook = (projection) => {
    if (projected) projection.set(oblique);
  };
  const pose: MirrorPose = { eye: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0] };
  const view = new Float32Array(16);
  const viewProjection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const groundUniforms: PanoramaGroundUniforms = { lakeMirrorColour: new Float32Array(3) };
  const groundColour = { r: 0, g: 0, b: 0 };
  const groundMaterial = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  groundMaterial.plugins = [panoramaGroundPlugin(groundUniforms, options.shared)];

  // A mesh that joins a pass later is built by the scene's own build of its material's kind, which knows vertex
  // colours and instance lists only if a mesh of the scene had them when it was registered: one mesh that is never
  // shown stands in the scene from the start with both, a triangle of no size.
  const seed = createMeshFromData(
    engine, "lake_mirror_seed", new Float32Array(9), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), undefined, undefined, undefined,
    new Float32Array(12).fill(1),
  );
  seed.material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
  setThinInstances(seed, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  setMeshVisible(seed, false);
  addToScene(scene, seed);

  // Cleared to nothing drawn; an alpha of 1 wherever a draw landed, whatever alpha its material was cut at.
  const task = createRenderTask(
    { name: "lake_mirror", rt: target, cam: camera, clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false, alphaWhereDrawn: true }, engine, scene,
  );
  task.enabled = false;
  // Before the frame's own pass, which reads the picture.
  addTaskAtStart(scene, task);

  const cadence = createMirrorCadence();
  const registered = new Set<Mesh>();
  const counts: MirrorCounts = { meshes: 0, draws: 0, held: 0 };
  let at = lake;
  let plane = lake.level + MIRROR_LIFT;
  let drawing = false;
  let disposed = false;

  const registry = (ground: boolean): ReflectionRegistry => ({
    add(mesh, always) {
      if (disposed || registered.has(mesh)) return;
      registered.add(mesh);
      counts.meshes = registered.size;
      addMeshToTask(task, mesh, ground ? { material: groundMaterial } : undefined);
      if (always === true) setTaskMeshVisible(task, mesh, true);
    },
    remove(mesh) {
      if (disposed || !registered.delete(mesh)) return;
      counts.meshes = registered.size;
      removeMeshFromTask(task, mesh);
    },
  });

  return {
    viewProjection,
    ground: registry(true),
    own: registry(false),
    counts,
    texture() {
      const view = getRenderTargetAttachments(target, now);
      if (view.colorTexture === null || view.colorView === null) return nothing;
      if (view.colorView !== of) {
        of = view.colorView;
        picture = { texture: view.colorTexture, view: view.colorView, sampler, width: view.width, height: view.height };
      }
      return picture;
    },
    setLake(next) {
      if (disposed || next === at) return;
      at = next;
      plane = next.level + MIRROR_LIFT;
      // The picture held is of the other lake: the next armed frame draws.
      cadence.rest();
    },
    update(inView, calmShare, f) {
      task.enabled = false;
      drawing = false;
      if (disposed) return false;
      // The picture's share of the frame, where the frame has grown past the cap.
      size.scale = mirrorScale(f.frameWidth, f.frameHeight);
      const past = Math.hypot(f.eye.x - at.x, f.eye.z - at.z) - at.bound;
      const draw = cadence.step(f.sky !== null && mirrorArmed(inView, calmShare, f.eye.y, plane, past));
      if (!cadence.armed) return false;
      if (!draw || f.sky === null) {
        counts.held++;
        return true;
      }
      // The player's camera in the water's plane, and the plane as that camera's near plane.
      mirroredPose(plane, f.eye, f.axes, LOOK_AHEAD, pose);
      camera.position.x = pose.eye[0];
      camera.position.y = pose.eye[1];
      camera.position.z = pose.eye[2];
      camera.target.x = pose.target[0];
      camera.target.y = pose.target[1];
      camera.target.z = pose.target[2];
      camera.upVector.x = pose.up[0];
      camera.upVector.y = pose.up[1];
      camera.upVector.z = pose.up[2];
      poseView(pose, view);
      mirrorProjection(getProjectionMatrix(player, f.frameHeight > 0 ? f.frameWidth / f.frameHeight : 1), view, plane, oblique);
      projected = true;
      camera.projectionVersion = (camera.projectionVersion ?? 0) + 1;
      mirrorRead(view, oblique, viewProjection);
      // The ground's colour under the frame's light: written when it has moved.
      mirrorGroundColour(f.sky, f.weather, groundColour);
      const u = groundUniforms.lakeMirrorColour;
      if (u[0] !== Math.fround(groundColour.r) || u[1] !== Math.fround(groundColour.g) || u[2] !== Math.fround(groundColour.b)) {
        u[0] = groundColour.r;
        u[1] = groundColour.g;
        u[2] = groundColour.b;
        markMaterialUboDirty(groundMaterial);
        uploads?.marked();
      }
      task.enabled = true;
      drawing = true;
      return true;
    },
    frameDrawn() {
      if (drawing) counts.draws++;
      drawing = false;
      task.enabled = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of registered) removeMeshFromTask(task, mesh);
      registered.clear();
      counts.meshes = 0;
      task.enabled = false;
      camera.projectionHook = undefined;
      removeFromScene(scene, seed);
      disposeMeshGpu(seed);
    },
  };
}
