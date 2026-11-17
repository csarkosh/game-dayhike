/**
 * A skinned model on Babylon Lite, drawn as many bodies in one draw a
 * primitive: the model's clips baked once into a table of bone matrices,
 * and each body an instance with its own matrix and its own place in a
 * clip (`skinInstances.ts` has the arithmetic).
 *
 * Lite skins a mesh from a texture of bone matrices it writes again every
 * frame a pose moves, one texture a mesh, so five hikers were ten such
 * writes a frame and a herd one a head. Baked, the clips are a table read
 * by row (Lite's baked vertex animation), a body costs no write while it
 * plays on, and every body of a model is one draw a primitive.
 *
 * **One clock for every model** (`createSkinClock`): Lite gives each baked
 * mesh a small buffer of its own for the clock its rows are read by. Every
 * mesh here is handed the same one instead, so a frame in which anything
 * skinned is shown writes four bytes once, and a frame in which nothing is
 * writes none.
 *
 * **A model's primitives share their bodies' clips**: one table of them,
 * sent once a change whatever the primitives. Their matrices are one array
 * here and a buffer a primitive on the GPU, sent once each when a body
 * moves: Lite keeps a mesh's draw arguments with its instances, so two
 * meshes of different geometry cannot share them.
 *
 * The loader's own materials are kept, each dressed by its owner
 * (`dress`); its textures are claimed, since the loader leaves them
 * unowned. A model stands in the scene from when it lands, hidden while it
 * has no body to draw; a primitive that only a pass of its owner's draws
 * (`elsewhere`) stays hidden whatever the bodies.
 */
import {
  acquireTexture, addToScene, attachVat, bakeVatMany, disposeMeshGpu, getContainerMeshes, getGpuDevice, loadGltf, releaseTexture, removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances,
  type AssetContainer, type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext, type SceneNode, type Texture2D, type VatHandle,
} from "@babylonjs/lite";
import { glbEmissive } from "../glbParts.js";
import { CLIP_FLOATS, SKIN_CLOCK_FOLD, type BakedClip } from "../skinInstances.js";
import type { FrameUploads } from "./frameUploads.js";
import { MATRIX_BYTES } from "./listMeshes.js";

/** The clock every baked mesh's rows are read by, seconds, folded. */
export type SkinClock = {
  /** The clock now, seconds: under `SKIN_CLOCK_FOLD`. */
  readonly seconds: number;
  /** How many times the clock has started again: a body's clips are written again for each. */
  readonly folds: number;
  /** Runs the clock on by `dt`. Nothing is sent: `send` does, on a frame that shows a body. */
  step(dt: number): void;
  /** Sends the clock where it has moved since it was last sent: four bytes. */
  send(uploads?: FrameUploads): void;
  /** Hands `mesh` (a baked one) this clock in place of its own. */
  adopt(mesh: Mesh): void;
  dispose(): void;
};

/** WebGPU's buffer usages for a uniform buffer written from the page (`GPUBufferUsage`), by their values. */
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;

/** Bytes of a baked mesh's settings: its clip's four floats, which an instanced mesh does not read, and the clock's four. */
const SETTINGS_BYTES = 32;
/** Where the clock stands in them. */
const CLOCK_OFFSET = 16;

type BakedMesh = { vat?: { settingsBuffer: GPUBuffer; instanceTexture?: GPUTexture | null } | null };

export function createSkinClock(engine: EngineContext): SkinClock {
  const device = getGpuDevice(engine);
  const buffer = device.createBuffer({ label: "skin clock", size: SETTINGS_BYTES, usage: UNIFORM | COPY_DST });
  const value = new Float32Array(1);
  let seconds = 0;
  let folds = 0;
  let sent = Number.NaN;
  return {
    get seconds() {
      return seconds;
    },
    get folds() {
      return folds;
    },
    step(dt) {
      seconds += dt;
      if (seconds >= SKIN_CLOCK_FOLD) {
        seconds -= SKIN_CLOCK_FOLD;
        folds++;
      }
    },
    send(uploads) {
      if (seconds === sent) return;
      sent = seconds;
      value[0] = seconds;
      device.queue.writeBuffer(buffer, CLOCK_OFFSET, value);
      uploads?.count("uniforms", value.byteLength);
    },
    adopt(mesh) {
      const vat = (mesh as unknown as BakedMesh).vat;
      if (vat === undefined || vat === null) throw new Error(`${mesh.name} is not a baked mesh: it has no clock to hand over`);
      const own = vat.settingsBuffer;
      vat.settingsBuffer = buffer;
      own.destroy();
    },
    dispose() {
      buffer.destroy();
    },
  };
}

/** One primitive of a model: the loader's mesh and its material. */
export type SkinnedPart = {
  readonly mesh: Mesh;
  readonly material: PbrMaterialProps;
  /** The material's name in the file. */
  readonly name: string;
  /** What the file says the material gives off: its emissive factor, which the loader keeps to itself. */
  readonly emissive: readonly [number, number, number];
  /** Whether the primitive is drawn at all: its owner's to say (`dress`). One that is not stays hidden. */
  drawn: boolean;
  /**
   * Whether a pass of its owner's alone draws the primitive (`dress` sets it): it is given its bodies as the others
   * are, and stays hidden, which leaves it out of every pass but one that shows it by its own word.
   */
  elsewhere: boolean;
};

export type SkinnedModel = {
  readonly parts: readonly SkinnedPart[];
  /** Where each of the file's clips landed in the table, by the clip's name. */
  readonly clips: ReadonlyMap<string, BakedClip>;
  /** The most bodies drawn at once. */
  readonly capacity: number;
  /** A matrix a body, sixteen floats each: written in place, then shown. */
  readonly matrices: Float32Array;
  /** A body's clips, `CLIP_FLOATS` each: written in place (`writeClipParams`), then shown. */
  readonly clipParams: Float32Array;
  /** Bodies drawn. */
  readonly count: number;
  /**
   * Draws the first `count` bodies. `moved`: a matrix among them has changed,
   * or the count has; `reclipped`: a body's clips have. The clips are sent
   * once whatever the primitives, the matrices once a primitive drawn, and a
   * model shown no body is hidden.
   */
  show(count: number, moved: boolean, reclipped: boolean): void;
  dispose(): void;
};

export type SkinnedModelOptions = {
  /** The most bodies drawn at once. */
  capacity: number;
  clock: SkinClock;
  signal: AbortSignal;
  /** Dresses a primitive's material and places it among the draws, before it joins the scene; false for one that is not drawn. */
  dress(part: SkinnedPart, index: number): boolean;
  uploads?: FrameUploads;
};

/** The textures a loader's material reads. */
function texturesOf(material: PbrMaterialProps): Texture2D[] {
  return [material.baseColorTexture, material.normalTexture, material.ormTexture, material.emissiveTexture, material.occlusionTexture].filter(
    (texture): texture is Texture2D => texture !== undefined,
  );
}

/**
 * The model at `url`, standing in `scene` with no body shown. It throws
 * where the file cannot be fetched or read, or holds no skinned mesh or no
 * clip.
 */
export async function loadSkinnedModel(engine: EngineContext, scene: SceneContext, url: string, options: SkinnedModelOptions): Promise<SkinnedModel> {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const file = await response.arrayBuffer();
  const emissive = glbEmissive(file);
  const container: AssetContainer = await loadGltf(engine, file);
  const meshes = getContainerMeshes(container);
  const groups = container.animationGroups ?? [];
  // The clips are baked, not played: the scene's own mixer never hears of them.
  container.animationGroups = undefined;
  if (meshes.length === 0 || groups.length === 0 || meshes.some((mesh) => mesh.skeleton === undefined || mesh.skeleton === null)) {
    for (const mesh of meshes) disposeMeshGpu(mesh);
    throw new Error(`${url}: ${meshes.length} meshes and ${groups.length} clips, where a skinned model has both`);
  }
  const baked = bakeVatMany(engine, meshes.map((mesh) => ({ mesh })), groups);
  const clips = new Map<string, BakedClip>();
  for (const [name, clip] of Object.entries(baked[0]?.clips ?? {})) {
    const group = groups.find((candidate) => candidate.name === name);
    clips.set(name, { fromRow: clip.fromRow, frames: clip.frameCount, fps: clip.fps, seconds: group?.duration ?? (clip.frameCount - 1) / clip.fps });
  }

  const capacity = options.capacity;
  const matrices = new Float32Array(capacity * 16);
  for (let i = 0; i < capacity; i++) matrices[i * 16] = matrices[i * 16 + 5] = matrices[i * 16 + 10] = matrices[i * 16 + 15] = 1;
  const clipParams = new Float32Array(capacity * CLIP_FLOATS);
  const held = new Set<Texture2D>();
  const parts: SkinnedPart[] = [];
  const handles: VatHandle[] = [];
  meshes.forEach((mesh, index) => {
    const handle = attachVat(engine, mesh, baked[index] as (typeof baked)[number]);
    handles.push(handle);
    options.clock.adopt(mesh);
    const material = mesh.material as PbrMaterialProps;
    for (const texture of texturesOf(material)) {
      if (held.has(texture)) continue;
      held.add(texture);
      acquireTexture(texture);
    }
    const name = (material as { name?: string }).name ?? "";
    const part: SkinnedPart = { mesh, material, name, emissive: emissive.get(name) ?? [0, 0, 0], drawn: true, elsewhere: false };
    part.drawn = options.dress(part, index);
    parts.push(part);
    // Every primitive draws the same bodies, from the same array of matrices, and reads the first one's clips.
    setThinInstances(mesh, matrices, capacity);
    setThinInstanceCount(mesh, 0);
    handle.setInstancesBlend(clipParams);
    const first = meshes[0] as Mesh;
    if (index > 0) {
      const own = (mesh as unknown as BakedMesh).vat;
      const shared = (first as unknown as BakedMesh).vat;
      if (own !== undefined && own !== null && shared !== undefined && shared !== null) {
        own.instanceTexture?.destroy();
        own.instanceTexture = shared.instanceTexture;
      }
    }
    setMeshVisible(mesh, false);
  });
  const roots = container.entities as SceneNode[];
  for (const root of roots) addToScene(scene, root);
  options.uploads?.made(meshes.length);

  let count = 0;
  let disposed = false;
  return {
    parts,
    clips,
    capacity,
    matrices,
    clipParams,
    get count() {
      return count;
    },
    show(next, moved, reclipped) {
      if (disposed) return;
      if (next > capacity) throw new Error(`${url}: ${next} bodies, where the model was made for ${capacity}`);
      if (reclipped && next > 0) {
        (handles[0] as VatHandle).setInstancesBlend(clipParams);
        options.uploads?.count("textures", clipParams.byteLength);
      }
      if (moved || next !== count) {
        for (const part of parts) {
          if (!part.drawn) continue;
          setThinInstanceCount(part.mesh, next);
          if (next > 0) options.uploads?.count("instances", next * MATRIX_BYTES);
        }
      }
      if ((next > 0) !== (count > 0)) for (const part of parts) if (part.drawn && !part.elsewhere) setMeshVisible(part.mesh, next > 0);
      count = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const root of roots) removeFromScene(scene, root);
      for (const mesh of meshes) disposeMeshGpu(mesh);
      for (const texture of held) releaseTexture(texture);
      options.uploads?.dropped(meshes.length);
    },
  };
}
