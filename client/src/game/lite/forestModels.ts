/**
 * The forest's and the ground cover's models and maps on Babylon Lite,
 * loaded by Lite's own loaders from the game's asset URLs: a model's file as
 * the geometry and the textures of each of its LODs, and a bark set's or the
 * moss's KTX2 map.
 *
 * A model's file is fetched once and handed to Lite's glTF loader as bytes,
 * which uploads its textures and keeps each mesh's positions, normals,
 * coordinates and triangles. Two things a bucket needs the loader does not
 * hand over: a mesh's vertex tangents and what the file says of its
 * material's specular weight, both read from the same bytes
 * (`glbParts.ts`). Each LOD's geometry is then stood where the file's node
 * tree puts it, the loader's handedness mirror included (`modelBake.ts`),
 * for a mesh that draws thin instances must stand at the origin; the
 * loader's own meshes, which nothing draws, are let go.
 */
import {
  disposeMeshGpu, getContainerMeshes, getMeshGeometry, loadGltf, loadKtx2Texture2D, setKtx2DecoderUrl,
  type EngineContext, type Mesh, type PbrMaterialProps, type SceneNode, type Texture2D,
} from "@babylonjs/lite";
import { glbParts, type GlbPart } from "../glbParts.js";
import { bakeGeometry, boundsOf, chainMatrix, type PlacedNode } from "../modelBake.js";
import type { Vec3 } from "../instancePose.js";
import { BASE } from "../router.js";

/** One primitive of a LOD: its geometry at the origin, what its file says of its material, and the loader's textures of it. */
export type ModelPart = {
  facts: GlbPart;
  positions: Float32Array;
  normals: Float32Array;
  /** The file's coordinates, or zeros for a primitive that has none (it reads no map). */
  uvs: Float32Array;
  /** xyzw a vertex, or null where the file has none. */
  tangents: Float32Array | null;
  indices: Uint32Array;
  /** The box of the baked positions. */
  min: Vec3;
  max: Vec3;
  /** The file's own colour and normal maps, as the loader uploaded them. */
  colour: Texture2D | undefined;
  normal: Texture2D | undefined;
  /** The file's base colour factor, linear: white where it gives none. */
  factor: readonly [number, number, number];
};

/** A model's LODs by the name of their node. */
export type LoadedModel = ReadonlyMap<string, readonly ModelPart[]>;

/** The chain of nodes from `node` down to the node named `name`, or null where the tree has none. */
function chainTo(node: SceneNode, name: string, above: readonly SceneNode[]): SceneNode[] | null {
  const here = [...above, node];
  if (node.name === name) return here;
  for (const child of node.children) {
    const found = chainTo(child, name, here);
    if (found !== null) return found;
  }
  return null;
}

/** Every mesh under `node` with the chain of nodes down to it, in the order the loader hangs them. */
function meshesUnder(node: SceneNode, above: readonly SceneNode[], meshes: ReadonlySet<SceneNode>, out: { mesh: Mesh; chain: SceneNode[] }[]): void {
  const here = [...above, node];
  if (meshes.has(node)) out.push({ mesh: node as Mesh, chain: here });
  for (const child of node.children) meshesUnder(child, here, meshes, out);
}

/**
 * The model at `url`, the LODs under its nodes named `lods`. A node the file
 * does not name is a LOD of no parts. It throws where the file cannot be
 * fetched or read, or where the loader's meshes are not the file's
 * primitives vertex for vertex.
 */
export async function loadModel(engine: EngineContext, url: string, lods: readonly string[], signal: AbortSignal): Promise<LoadedModel> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const file = await response.arrayBuffer();
  const container = await loadGltf(engine, file);
  const all = getContainerMeshes(container);
  const meshes = new Set<SceneNode>(all);
  const model = new Map<string, ModelPart[]>();
  try {
    const root = container.entities[0] as SceneNode | undefined;
    for (const lod of lods) {
      const chain = root === undefined ? null : chainTo(root, lod, []);
      const found: { mesh: Mesh; chain: SceneNode[] }[] = [];
      if (chain !== null) meshesUnder(chain[chain.length - 1] as SceneNode, chain.slice(0, -1), meshes, found);
      const facts = glbParts(file, lod);
      if (facts.length !== found.length) throw new Error(`${url} ${lod}: ${found.length} meshes loaded for ${facts.length} primitives`);
      const parts = found.map(({ mesh, chain: nodes }, i) => {
        const geometry = getMeshGeometry(mesh);
        const fact = facts[i] as GlbPart;
        if (geometry === null) throw new Error(`${url} ${lod}: a mesh with no geometry kept`);
        if (geometry.positions.length !== fact.vertices * 3) throw new Error(`${url} ${lod}: ${geometry.positions.length / 3} vertices loaded for ${fact.vertices}`);
        const baked = { positions: geometry.positions, normals: geometry.normals, tangents: fact.tangents, indices: geometry.indices };
        bakeGeometry(chainMatrix(nodes as unknown as PlacedNode[]), baked);
        const material = mesh.material as PbrMaterialProps;
        return {
          facts: fact, ...boundsOf(baked.positions),
          positions: baked.positions, normals: baked.normals, uvs: geometry.uvs ?? new Float32Array(fact.vertices * 2), tangents: baked.tangents,
          indices: baked.indices, colour: material.baseColorTexture, normal: material.normalTexture,
          factor: [material.baseColorFactor?.[0] ?? 1, material.baseColorFactor?.[1] ?? 1, material.baseColorFactor?.[2] ?? 1] as const,
        };
      });
      model.set(lod, parts);
    }
  } finally {
    // Nothing draws the loader's own meshes: their buffers go, their materials' textures stay.
    for (const mesh of all) disposeMeshGpu(mesh);
  }
  return model;
}

const KTX2_BASE = `${BASE}libs/ktx2`;
let decoderPointed = false;

/**
 * Points Lite's KTX2 decoder at the copies the game vendors under its own
 * base (`tools/vendor-ktx2.mjs`), every transcoder by name, so nothing
 * reaches for a CDN: a transcoder left unnamed keeps the address it was
 * built with. Once a page, before the first map is read.
 */
function pointKtx2Decoder(): void {
  if (decoderPointed) return;
  decoderPointed = true;
  const wasm = (file: string): { WasmModuleURL: string } => ({ WasmModuleURL: `${KTX2_BASE}/${file}` });
  setKtx2DecoderUrl(`${KTX2_BASE}/babylon.ktx2Decoder.js`, {
    LiteTranscoder_UASTC_ASTC: wasm("uastc_astc.wasm"),
    LiteTranscoder_UASTC_BC7: wasm("uastc_bc7.wasm"),
    LiteTranscoder_UASTC_RGBA_UNORM: wasm("uastc_rgba8_unorm_v2.wasm"),
    LiteTranscoder_UASTC_RGBA_SRGB: wasm("uastc_rgba8_srgb_v2.wasm"),
    LiteTranscoder_UASTC_R8_UNORM: wasm("uastc_r8_unorm.wasm"),
    LiteTranscoder_UASTC_RG8_UNORM: wasm("uastc_rg8_unorm.wasm"),
    MSCTranscoder: { JSModuleURL: `${KTX2_BASE}/msc_basis_transcoder.js`, WasmModuleURL: `${KTX2_BASE}/msc_basis_transcoder.wasm` },
    ZSTDDecoder: wasm("zstddec.wasm"),
  });
}

/**
 * A KTX2 map from `url`, with the file's own smaller levels, tiling: a
 * colour map (`colour`) in an sRGB format, which the sampler decodes before
 * it filters; a normal or an occlusion, roughness and metalness map raw.
 */
export function loadKtx2Map(engine: EngineContext, url: string, colour: boolean): Promise<Texture2D> {
  pointKtx2Decoder();
  return loadKtx2Texture2D(engine, url, colour);
}
