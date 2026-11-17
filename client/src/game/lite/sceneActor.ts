/**
 * A staged scene's actor on Babylon Lite: one skinned body, stood where a
 * scene's frame has it and posed at the frame's own clip time, with a second
 * clip mixed in where the frame says so.
 *
 * The hike's bodies are instances of a baked model, a row of bone matrices
 * a baked frame (`skinnedModels.ts`): a body costs nothing a frame, but it
 * stands on whole baked frames, mixes no two clips and has no joint to read.
 * A film's actor is one body that has to be at an exact time of each clip,
 * be held by a joint (a seated ranger by his chest) and hand a prop its
 * hand. So its model is loaded as it is, not baked, and its bones are the
 * pose worked out from the file with no engine (`scene/actorPose.ts`), sent
 * to the skin Lite gave each of its meshes: one texture a mesh, written on a
 * frame whose pose differs from the last one sent, and on no other. The
 * clips are never handed to the scene's own mixer.
 *
 * The loader's own materials are kept, each dressed by its owner; its
 * textures are claimed, since the loader leaves them unowned. The actor
 * stands in the scene from when it lands, hidden while its frame hides it.
 */
import {
  acquireTexture, addToScene, disposeMeshGpu, getContainerMeshes, getGpuDevice, loadGltf, releaseTexture, removeFromScene, setMeshVisible,
  type AssetContainer, type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext, type SceneNode, type Texture2D,
} from "@babylonjs/lite";
import { quatFromEuler, type Quat } from "../instancePose.js";
import {
  actorBones, actorNode, createActorPosed, poseActor, readActorRig, rootForJoint, type ActorPosed, type ActorRig,
} from "../scene/actorPose.js";
import type { ActorPose } from "../scene/timeline.js";
import type { FrameUploads } from "./frameUploads.js";

/** How far (the largest float of a bone's sixteen) the rig's bones at rest may stand from the ones the loader made, in the mesh's own units. */
export const REST_BONES_APART = 1e-2;

/** The skin Lite gives a skinned mesh: its bones as it holds them, and the texture a vertex stage reads them from. */
type Skin = { boneTexture: GPUTexture; boneCount: number; boneMatrices: Float32Array };

export type SceneActor = {
  /** The model's rig, for whoever reads its clips. */
  readonly rig: ActorRig;
  /** Meshes drawn: a primitive each. */
  readonly meshes: readonly Mesh[];
  /**
   * Stands the actor as `pose` has it: at its place facing its yaw, or held
   * so its anchor's joint is at the anchor; in its clip at its time, mixed
   * toward its blend's. Hidden where the pose hides it. False for a clip the
   * model lacks, the pose left as it was.
   */
  stage(pose: ActorPose): boolean;
  /** Where the actor's root last stood, and whether it is shown. */
  readonly at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  readonly shown: boolean;
  /** Shows or hides the meshes of an actor its pose shows: its owner's word on the view. */
  inView(on: boolean): number;
  /** The matrix in the world of the node named `name` as last staged, into `out`; null for a name the model lacks. */
  joint(name: string, out: Float64Array): Float64Array | null;
  dispose(): void;
};

export type SceneActorOptions = {
  signal: AbortSignal;
  /** Dresses a primitive's material and places it among the draws, before it joins the scene. */
  dress(material: PbrMaterialProps, mesh: Mesh, index: number): void;
  uploads?: FrameUploads;
};

/** The textures a loader's material reads. */
function texturesOf(material: PbrMaterialProps): Texture2D[] {
  return [material.baseColorTexture, material.normalTexture, material.ormTexture, material.emissiveTexture, material.occlusionTexture].filter(
    (texture): texture is Texture2D => texture !== undefined,
  );
}

/** How far two runs of floats stand apart at most. */
export function floatsApart(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length && i < b.length; i++) worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)));
  return worst;
}

/**
 * The actor of the model at `url`, standing in `scene`, hidden until a pose
 * shows it. It throws where the file cannot be fetched or read, holds no
 * skinned mesh, or its skin as the loader made it is not the rig's.
 */
export async function loadSceneActor(engine: EngineContext, scene: SceneContext, url: string, options: SceneActorOptions): Promise<SceneActor> {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const file = await response.arrayBuffer();
  const rig = readActorRig(file);
  const container: AssetContainer = await loadGltf(engine, file);
  const meshes = getContainerMeshes(container);
  // The clips are posed here, not played: the scene's own mixer never hears of them.
  container.animationGroups = undefined;
  const skins = meshes.map((mesh) => (mesh as unknown as { skeleton?: Skin | null }).skeleton ?? null);
  const posed: ActorPosed = createActorPosed(rig);
  const bones = new Float32Array((rig.skins[0]?.joints.length ?? 0) * 16);
  const fail = (why: string): never => {
    for (const mesh of meshes) disposeMeshGpu(mesh);
    throw new Error(`${url}: ${why}`);
  };
  if (meshes.length === 0 || rig.skins.length !== 1 || skins.some((skin) => skin === null || skin.boneMatrices.length !== bones.length)) {
    fail(`${meshes.length} meshes and ${rig.skins.length} skins, where a scene's actor is one skin's meshes`);
  }
  // The rig's bones at rest are the ones the loader gave the skin: the same frames, the same order of joints.
  actorBones(rig, 0, posed, bones);
  const apart = floatsApart(bones, (skins[0] as Skin).boneMatrices);
  if (!(apart <= REST_BONES_APART)) fail(`its bones at rest stand ${apart} from the loader's`);

  const held = new Set<Texture2D>();
  meshes.forEach((mesh, index) => {
    const material = mesh.material as PbrMaterialProps;
    for (const texture of texturesOf(material)) {
      if (held.has(texture)) continue;
      held.add(texture);
      acquireTexture(texture);
    }
    options.dress(material, mesh, index);
    setMeshVisible(mesh, false);
  });
  const roots = container.entities as SceneNode[];
  const root = roots[0] as SceneNode;
  for (const node of roots) addToScene(scene, node);
  options.uploads?.made(meshes.length);

  const device = getGpuDevice(engine);
  const sent = new Float32Array(bones.length).fill(Number.NaN);
  const at = { x: 0, y: 0, z: 0, yaw: 0 };
  const turn: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const place = { x: 0, y: 0, z: 0 };
  let wanted = false;
  let viewed = true;
  let drawn = false;
  let disposed = false;
  const show = (): number => {
    const on = wanted && viewed;
    if (on !== drawn) {
      drawn = on;
      for (const mesh of meshes) setMeshVisible(mesh, on);
    }
    return on ? meshes.length : 0;
  };

  return {
    rig,
    meshes,
    at,
    get shown() {
      return wanted;
    },
    stage(pose) {
      if (disposed) return false;
      wanted = pose.visible;
      if (!pose.visible) {
        show();
        return true;
      }
      const blend = pose.blend === undefined ? undefined : { clip: pose.blend.clip, seconds: pose.blend.clipTime, weight: pose.blend.weight };
      const known = poseActor(rig, pose.clip, pose.clipTime, blend, posed);
      const joint = pose.anchor === undefined ? -1 : actorNode(rig, pose.anchor.joint);
      if (pose.anchor !== undefined && joint >= 0) {
        rootForJoint(posed, joint, pose.yaw, pose.anchor, place);
      } else {
        place.x = pose.x;
        place.y = pose.y;
        place.z = pose.z;
      }
      at.x = place.x;
      at.y = place.y;
      at.z = place.z;
      at.yaw = pose.yaw;
      root.position.x = place.x;
      root.position.y = place.y;
      root.position.z = place.z;
      quatFromEuler(0, pose.yaw, 0, turn);
      root.rotationQuaternion.x = turn.x;
      root.rotationQuaternion.y = turn.y;
      root.rotationQuaternion.z = turn.z;
      root.rotationQuaternion.w = turn.w;
      // The bones, where the pose is not the one last sent: a texture a mesh.
      actorBones(rig, 0, posed, bones);
      if (floatsApart(bones, sent) !== 0) {
        sent.set(bones);
        const width = bones.length / 4;
        for (const skin of skins as Skin[]) {
          skin.boneMatrices.set(bones);
          device.queue.writeTexture({ texture: skin.boneTexture }, skin.boneMatrices, { bytesPerRow: width * 16 }, { width, height: 1 });
        }
        options.uploads?.count("textures", bones.byteLength * skins.length, skins.length);
      }
      show();
      return known;
    },
    inView(on) {
      viewed = on;
      return show();
    },
    joint(name, out) {
      const node = actorNode(rig, name);
      if (node < 0) return null;
      // The node in the model's frame, turned by the actor's yaw and stood at its place.
      const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
      for (let column = 0; column < 4; column++) {
        const x = posed.world[node * 16 + column * 4] as number, y = posed.world[node * 16 + column * 4 + 1] as number, z = posed.world[node * 16 + column * 4 + 2] as number;
        const w = posed.world[node * 16 + column * 4 + 3] as number;
        out[column * 4] = x * c + z * s + at.x * w;
        out[column * 4 + 1] = y + at.y * w;
        out[column * 4 + 2] = -x * s + z * c + at.z * w;
        out[column * 4 + 3] = w;
      }
      return out;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of roots) removeFromScene(scene, node);
      for (const mesh of meshes) disposeMeshGpu(mesh);
      for (const texture of held) releaseTexture(texture);
      options.uploads?.dropped(meshes.length);
    },
  };
}
