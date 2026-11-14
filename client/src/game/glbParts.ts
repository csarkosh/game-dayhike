/**
 * What a model's file says of the primitives under one of its named nodes,
 * read from the file's own bytes: each primitive's vertex tangents, and of
 * its material what a tree's look is decided by (whether its cards are
 * alpha-tested and at what cutoff, whether it is drawn on both sides, its
 * specular weight and its index of refraction where the file carries them).
 *
 * A renderer whose model loader keeps a mesh's positions, normals and
 * coordinates but not its tangents, and a material's textures but not what
 * its file said of its specular weight, reads the rest here. Loads no
 * engine: a binary glTF is a header, a chunk of JSON and a chunk of bytes
 * (the Khronos glTF 2.0 specification, "GLB File Format").
 */

/** One primitive under a named node, in the order a loader's meshes stand in. */
export type GlbPart = {
  /** The material's name, or null where the primitive names none. */
  material: string | null;
  /** The material alpha-tests (glTF's MASK mode): a crown's cards. */
  alphaMask: boolean;
  /** The alpha a fragment is kept from (glTF's default 0.5). */
  alphaCutoff: number;
  doubleSided: boolean;
  /** `KHR_materials_specular`'s factor, or null where the file gives none. */
  specularWeight: number | null;
  /** `KHR_materials_ior`'s index, or null where the file gives none. */
  ior: number | null;
  /** How many vertices the primitive has. */
  vertices: number;
  /** The vertex tangents, xyzw a vertex, or null where the primitive has none. */
  tangents: Float32Array | null;
};

type GltfNode = { name?: string; mesh?: number; children?: number[] };
type GltfPrimitive = { attributes: Record<string, number>; material?: number };
type GltfMaterial = {
  name?: string;
  alphaMode?: string;
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: { KHR_materials_specular?: { specularFactor?: number }; KHR_materials_ior?: { ior?: number } };
};
type GltfAccessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string };
type GltfBufferView = { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number };
type Gltf = {
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;

/** The JSON and the bytes of a binary glTF; it throws on a file that is not one. */
function chunks(file: ArrayBuffer): { json: Gltf; bin: Uint8Array } {
  const view = new DataView(file);
  if (file.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a binary glTF file");
  let json: Gltf | null = null;
  let bin = new Uint8Array(0);
  let at = 12;
  while (at + 8 <= file.byteLength) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const bytes = new Uint8Array(file, at + 8, length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(bytes)) as Gltf;
    else if (type === CHUNK_BIN) bin = bytes;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new Error("a binary glTF file with no JSON chunk");
  return { json, bin };
}

/** The floats of a VEC4 float accessor, copied out of the file's bytes; null for any other kind. */
function vec4Floats(json: Gltf, bin: Uint8Array, index: number): Float32Array | null {
  const accessor = json.accessors?.[index];
  if (accessor === undefined || accessor.componentType !== FLOAT || accessor.type !== "VEC4" || accessor.bufferView === undefined) return null;
  const bufferView = json.bufferViews?.[accessor.bufferView];
  if (bufferView === undefined) return null;
  const stride = bufferView.byteStride ?? 16;
  const start = bin.byteOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, start);
  const out = new Float32Array(accessor.count * 4);
  for (let i = 0; i < accessor.count; i++) {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = view.getFloat32(i * stride + k * 4, true);
  }
  return out;
}

/**
 * The primitives under the node of `file` named `node`, the node's children
 * first and then its own mesh's, each mesh's primitives in the file's order:
 * the order a loader that mirrors the file's node tree, hanging a node's
 * meshes after its child nodes, stands its meshes in. Empty where the file
 * has no such node.
 */
export function glbParts(file: ArrayBuffer, node: string): GlbPart[] {
  const { json, bin } = chunks(file);
  const nodes = json.nodes ?? [];
  const root = nodes.findIndex((n) => n.name === node);
  if (root < 0) return [];
  const parts: GlbPart[] = [];
  const walk = (index: number): void => {
    const n = nodes[index];
    if (n === undefined) return;
    for (const child of n.children ?? []) walk(child);
    if (n.mesh === undefined) return;
    for (const primitive of json.meshes?.[n.mesh]?.primitives ?? []) {
      const material = primitive.material === undefined ? undefined : json.materials?.[primitive.material];
      const position = primitive.attributes.POSITION;
      const tangent = primitive.attributes.TANGENT;
      parts.push({
        material: material?.name ?? null,
        alphaMask: material?.alphaMode === "MASK",
        alphaCutoff: material?.alphaCutoff ?? 0.5,
        doubleSided: material?.doubleSided === true,
        specularWeight: material?.extensions?.KHR_materials_specular?.specularFactor ?? null,
        ior: material?.extensions?.KHR_materials_ior?.ior ?? null,
        vertices: position === undefined ? 0 : (json.accessors?.[position]?.count ?? 0),
        tangents: tangent === undefined ? null : vec4Floats(json, bin, tangent),
      });
    }
  };
  walk(root);
  return parts;
}
