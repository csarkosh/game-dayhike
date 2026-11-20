/**
 * A model placed once on Babylon Lite (a fingerpost, the trailhead's car and
 * board, the body at the crest): its file's first LOD through the forest's
 * loader (`forestModels.ts`), its geometry stood where its nodes put it, and
 * its primitives gathered a material.
 *
 * - **One mesh a material.** A file holds a mesh for every primitive, each
 *   under one of its few materials: the film's car is thirty primitives of
 *   seven materials. Nothing here moves
 *   one of them against another, so the primitives of a material are one
 *   geometry and one draw.
 * - **The materials are the file's own**, as the loader made them, under the
 *   game's stack: the base colour's block and the wet look at a prop's cap
 *   where the weather soaks the model, and the air. The loader leaves a
 *   file's maps to the draws that take them up; a model holds a claim on
 *   each of its own until it is let go.
 * - **A see-through material's geometry is laid in the world's own
 *   coordinates** (`placed`), so its mesh stands at the origin with every
 *   other see-through mesh and its place alone orders it (`drawOrder.ts`).
 * - **A tangent's handedness is turned with the loader's mirror.** The
 *   loader stands these models under nodes of its own, a mirror among
 *   them; here their geometry is baked across it, which
 *   carries a tangent's direction and leaves its sign, so the sign is
 *   turned (`partsByMaterial`) and a map of normals is read the way up its
 *   file means. (The forest's buckets keep
 *   the file's sign.)
 * - **A material's occlusion is its file's** (`glbOcclusion`). Lite's loader
 *   packs occlusion, roughness and metalness into one map and takes every
 *   occlusion map at full strength; a material with an occlusion map and no
 *   map of roughness and metalness (the cars' paint) it hands the occlusion
 *   map alone, whose green and blue are then read as a roughness and a
 *   metalness the file never gave. Such a material's map is made again here:
 *   the occlusion in its red, the file's two factors in its green and blue
 *   (`loneOcclusionMap`); and every occlusion map takes the file's strength.
 * - **A car's parts are turned in the vertex stage** (`carTurnsPlugin`). A
 *   wheel, the steering wheel and the driver's door are runs of a material's
 *   one mesh, with no node to turn. Each vertex of such a mesh carries the
 *   number of the turn it takes (a float a vertex, sent once), and the turns
 *   are a small block of the car's own (`carParts.ts`: three rows a turn),
 *   which the stage carries the vertex and its normal by before the mesh's
 *   own place does. A pose that turns a part sends that part's rows, and no
 *   vertex.
 */
import {
  acquireTexture, createMeshFromData, createTexture2DFromExternalImage, getMaterialTextures, releaseTexture,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type PluginUniformBlock, type Texture2D,
} from "@babylonjs/lite";
import { TURN_ROW_FLOATS } from "../carParts.js";
import { modelUrl } from "../assetUrls.js";
import { glbOcclusion, glbParts, type GlbOcclusion } from "@csarkosh/engine/game/glbParts";
import { composeInto, quatFromEuler } from "@csarkosh/engine/game/instancePose";
import { bakeGeometry } from "@csarkosh/engine/game/modelBake";
import type { WetUniforms } from "../wetSurface.js";
import { loadModelFile, type ModelPart } from "./forestModels.js";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import carTurnsFrameSource from "../shaders/sceneryModels/carTurnsFrame.wgsl?raw";
import carTurnsSource from "../shaders/sceneryModels/carTurns.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

/** The LOD of a placed model that is drawn: these stand in one place and are seen up close. */
export const SCENERY_LOD = "LOD0";

/** The primitives of one material, as one geometry in the model's own frame. */
export type SceneryPart = {
  /** The material's name in the file. */
  name: string;
  material: PbrMaterialProps;
  /** The material is blended over what lies behind it (the car's glass). */
  blended: boolean;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** xyzw a vertex, or null where a primitive of the material has none. */
  tangents: Float32Array | null;
  indices: Uint32Array;
  /** The file's primitives the part is gathered from: each one's run of the triangles, and the middle of its box. */
  panes: Pane[];
};

/**
 * One primitive of a part: where its triangles lie in the part's list, and
 * the middle of its box; where its vertices lie in the part's, the nodes it
 * hangs under in the file (the model's root first) and its own frame in the
 * model's, for a part of the model that is turned in place.
 */
export type Pane = { first: number; count: number; x: number; y: number; z: number; vertexFirst: number; vertexCount: number; nodes: readonly string[]; local: Float32Array };

/** A model as it is placed: a part a material, in the file's order of materials. */
export type SceneryModel = {
  parts: SceneryPart[];
  /** The names of the materials of the primitives under each node asked about (`under`). */
  under: ReadonlyMap<string, ReadonlySet<string>>;
  /** The primitives of each other LOD asked for (`also`), as the loader stood them: read, never drawn. */
  also: ReadonlyMap<string, readonly ModelPart[]>;
  /** Lets the model's claims on its file's maps go. */
  release(): void;
};

/** Gathers `parts` a material, in the order their materials first come. */
export function partsByMaterial(parts: readonly ModelPart[]): SceneryPart[] {
  const groups = new Map<PbrMaterialProps, ModelPart[]>();
  for (const part of parts) {
    const group = groups.get(part.material);
    if (group === undefined) groups.set(part.material, [part]);
    else group.push(part);
  }
  const out: SceneryPart[] = [];
  for (const [material, group] of groups) {
    let vertices = 0;
    let triangles = 0;
    for (const part of group) {
      vertices += part.positions.length / 3;
      triangles += part.indices.length;
    }
    const tangent = group.every((part) => part.tangents !== null);
    const merged: SceneryPart = {
      name: (group[0] as ModelPart).facts.material ?? "",
      material,
      blended: material.alphaBlend === true,
      positions: new Float32Array(vertices * 3),
      normals: new Float32Array(vertices * 3),
      uvs: new Float32Array(vertices * 2),
      tangents: tangent ? new Float32Array(vertices * 4) : null,
      indices: new Uint32Array(triangles),
      panes: [],
    };
    let v = 0;
    let t = 0;
    for (const part of group) {
      merged.positions.set(part.positions, v * 3);
      merged.normals.set(part.normals, v * 3);
      merged.uvs.set(part.uvs, v * 2);
      if (merged.tangents !== null && part.tangents !== null) {
        merged.tangents.set(part.tangents, v * 4);
        // The loader's root mirrors the file's geometry, and the bake carries a normal and a tangent across it but
        // leaves the tangent's handedness as the file has it: the frame Lite makes of the two, their cross product
        // by that sign, then comes out turned over, a map of normals read with its green the wrong way up. The
        // sign is turned with the mirror here.
        for (let i = v * 4 + 3; i < (v + part.positions.length / 3) * 4; i += 4) merged.tangents[i] = -(merged.tangents[i] as number);
      }
      for (let i = 0; i < part.indices.length; i++) merged.indices[t + i] = (part.indices[i] as number) + v;
      merged.panes.push({
        first: t, count: part.indices.length, x: (part.min.x + part.max.x) / 2, y: (part.min.y + part.max.y) / 2, z: (part.min.z + part.max.z) / 2,
        vertexFirst: v, vertexCount: part.positions.length / 3, nodes: part.nodes, local: part.local,
      });
      v += part.positions.length / 3;
      t += part.indices.length;
    }
    out.push(merged);
  }
  return out;
}

/** A byte of a map for a factor in [0, 1]. */
export function factorByte(factor: number): number {
  return Math.round(Math.max(0, Math.min(1, factor)) * 255);
}

/**
 * The packed map of a material whose file gives it an occlusion map alone:
 * the occlusion map's own red, with the material's roughness in the green
 * and its metalness in the blue of every texel, tiled and with its smaller
 * levels, as the loader's own maps are.
 *
 * The image is read on a canvas the browser keeps in the page's memory
 * (`willReadFrequently`), and the packed pixels are handed to the GPU as
 * pixels: a canvas the GPU draws would be read back through the GPU's own
 * process to be packed, and drawn again to be uploaded, which holds that
 * process (the one that presents the intro's film) while a hike loads.
 */
export async function loneOcclusionMap(engine: EngineContext, alone: NonNullable<GlbOcclusion["alone"]>): Promise<Texture2D> {
  const image = await createImageBitmap(new Blob([alone.bytes as Uint8Array<ArrayBuffer>], { type: alone.mime }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no canvas to pack a map on");
  ctx.drawImage(image, 0, 0);
  image.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const roughness = factorByte(alone.roughness);
  const metallic = factorByte(alone.metallic);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i + 1] = roughness;
    pixels.data[i + 2] = metallic;
    pixels.data[i + 3] = 255;
  }
  return createTexture2DFromExternalImage(engine, pixels, {
    mipMaps: true, invertY: false, srgb: false, premultiplyAlpha: false, addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear",
  });
}

/**
 * The model at the catalog's `output`, its first LOD a part a material.
 * `under` names nodes of the file whose materials are asked about, `also`
 * other LODs whose geometry is read. It throws where the file cannot be
 * fetched or read.
 */
export async function loadSceneryModel(
  engine: EngineContext, output: string, signal: AbortSignal, { under = [], also = [] }: { under?: readonly string[]; also?: readonly string[] } = {},
): Promise<SceneryModel> {
  const { model, file } = await loadModelFile(engine, modelUrl(output), [SCENERY_LOD, ...also], signal);
  const parts = partsByMaterial(model.get(SCENERY_LOD) ?? []);
  // Each material's occlusion as its file has it: its strength, and a map of its own where the file gives it an
  // occlusion map alone.
  const packed: Texture2D[] = [];
  const occlusion = glbOcclusion(file);
  for (const part of parts) {
    const facts = occlusion.get(part.name);
    if (facts === undefined) continue;
    part.material.occlusionStrength = facts.strength;
    if (facts.alone === null) continue;
    const made = await loneOcclusionMap(engine, facts.alone);
    packed.push(made);
    // The loader's map is the occlusion's alone, which nothing reads now: it goes.
    const lone = part.material.ormTexture;
    part.material.ormTexture = made;
    if (lone !== undefined) releaseTexture(lone);
  }
  if (signal.aborted) {
    for (const texture of packed) releaseTexture(texture);
    throw new Error(`${output}: let go while its maps were made`);
  }
  const held = new Set<Texture2D>();
  for (const part of parts) {
    for (const texture of getMaterialTextures(part.material)) {
      if (held.has(texture) || packed.includes(texture)) continue;
      held.add(texture);
      acquireTexture(texture);
    }
  }
  const names = new Map<string, Set<string>>();
  for (const node of under) {
    names.set(node, new Set(glbParts(file, node).map((part) => part.material).filter((name): name is string => name !== null)));
  }
  return {
    parts,
    under: names,
    also: new Map(also.map((lod) => [lod, model.get(lod) ?? []])),
    release() {
      for (const texture of held) releaseTexture(texture);
      held.clear();
      for (const texture of packed) releaseTexture(texture);
      packed.length = 0;
    },
  };
}

/** What a placed model's materials are dressed with. */
export type SceneryDress = {
  /** The wet look's uniforms at a prop's cap; null for a model the weather does not soak. */
  wet: WetUniforms | null;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block (`frameBlock.ts`). */
  shared: PluginUniformBlock;
};

/** Dresses a part's material with the game's stack: the base colour's block and the wet look where it is soaked, and the air. */
export function dress(part: SceneryPart, by: SceneryDress): void {
  part.material.usePhysicalLightFalloff = true;
  part.material.plugins = by.wet === null ? [by.air()] : [baseColourPlugin(), surfaceWetPlugin(by.wet, by.shared), by.air()];
}

/** The block of a car's turns in WGSL, and its one field: the turns' rows. */
export const CAR_TURNS_BLOCK = "carTurns";
export const CAR_TURNS_ROWS = "rows";
/** The vertex attribute that names a vertex's turn: 0 for none, else one more than the turn's place in the block. */
export const CAR_PART_ATTRIBUTE = "carPart";

/** The block's fields for a car of `turns` turns: their rows, a vec4 a row, laid out as Lite lays a table out (bits, which the stage casts back). */
export function carTurnsFields(turns: number): { name: string; type: string }[] {
  return [{ name: CAR_TURNS_ROWS, type: `array<vec4<u32>,${turns * (TURN_ROW_FLOATS / 4)}>` }];
}

/** A vector against a turn's three rows, each coordinate summed in the order the processor's carrying sums it (`poseVertices`); `move` adds each row's fourth float. */
const byRows = (v: string, move: boolean): string =>
  `vec3<f32>(${["ctX", "ctY", "ctZ"].map((row) => `${v}.x*${row}.x+${v}.y*${row}.y+${v}.z*${row}.z${move ? `+${row}.w` : ""}`).join(",")})`;

/**
 * The vertex stage's carrying of a turned part, at the stage's end: a vertex
 * that names a turn is carried by the turn's rows, its normal (and its
 * tangent, where the material reads a map of normals through the mesh's
 * tangents) turned by them, and what the stage hands on is made again from
 * those in Lite's own statements, so a turned vertex goes through the
 * arithmetic a vertex sent already turned went through. A vertex that names
 * none keeps what the stage made of it.
 */
export function carTurnsWgsl(tangents: boolean): string {
  const frame = !tangents ? "" : fill(wgsl(carTurnsFrameSource), { tangentRows: byRows("tangent", false) });
  return fill(wgsl(carTurnsSource), { carPartAttribute: CAR_PART_ATTRIBUTE, carTurnsBlock: CAR_TURNS_BLOCK, carTurnsRows: CAR_TURNS_ROWS, positionRows: byRows("position", true), normalRows: byRows("normal", false), frame });
}

/**
 * The plugin that turns a car's parts in the vertex stage, for a material
 * whose mesh holds a part a pose turns: every vertex of the mesh names its
 * turn (`CAR_PART_ATTRIBUTE`, the mesh's plugin vertex data, a float a
 * vertex) and the turns are read from `block` (`carTurnsFields`).
 * `tangents`: the material reads its map of normals through the mesh's
 * tangents, which are then turned too. It writes nothing of the material's
 * own.
 */
export function carTurnsPlugin(block: PluginUniformBlock, tangents: boolean): MaterialPlugin {
  return {
    name: "CarTurns",
    priority: 210,
    defines: { tangents },
    getCustomCode: (stage) => (stage === "vertex" ? { CUSTOM_VERTEX_MAIN_END: carTurnsWgsl(tangents) } : null),
    getVertexAttributes: () => [{ name: CAR_PART_ATTRIBUTE, type: "f32", format: "float32" as const, stride: 4, offset: 0 }],
    getUniformBlocks: () => [block],
  };
}

/** Whether a part's material reads its map of normals through the part's own tangents: Lite's rule for the tangent's attribute. */
export function readsTangents(part: SceneryPart): boolean {
  return part.tangents !== null && part.material.normalTexture !== undefined && part.material.normalTexture !== null;
}

/** The matrix of a place on the ground turned by `yaw` about the vertical (the sim's: 0 faces +z, a quarter turn +x). */
export function placeMatrix(x: number, y: number, z: number, yaw: number): Float32Array {
  const out = new Float32Array(16);
  composeInto(out, 0, 1, 1, 1, quatFromEuler(0, yaw, 0, { x: 0, y: 0, z: 0, w: 1 }), x, y, z);
  return out;
}

/** `part`'s geometry carried to the world by `matrix`: copies, the part's own left as they are. */
export function placed(part: SceneryPart, matrix: Float32Array): { positions: Float32Array; normals: Float32Array; tangents: Float32Array | null; indices: Uint32Array } {
  const geometry = { positions: part.positions.slice(), normals: part.normals.slice(), tangents: part.tangents?.slice() ?? null, indices: part.indices.slice() };
  // The part's triangles already face outward: a place on the ground mirrors nothing, and the bake of one that
  // does not would turn them over.
  bakeGeometry(matrix, geometry);
  for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
    const second = geometry.indices[i + 1] as number;
    geometry.indices[i + 1] = geometry.indices[i + 2] as number;
    geometry.indices[i + 2] = second;
  }
  return geometry;
}

/**
 * The order a see-through part's panes are drawn in from `eye`: farthest
 * first by the middle of each pane's box, so a pane seen through another is
 * laid under it. `centres` is xyz a pane, in the world; `order` is filled
 * with the panes' numbers and returned.
 */
export function farthestFirst(centres: ArrayLike<number>, eye: { x: number; y: number; z: number }, order: number[]): number[] {
  const count = Math.floor(centres.length / 3);
  order.length = count;
  for (let i = 0; i < count; i++) order[i] = i;
  const far = (i: number): number => {
    const dx = (centres[i * 3] as number) - eye.x, dy = (centres[i * 3 + 1] as number) - eye.y, dz = (centres[i * 3 + 2] as number) - eye.z;
    return dx * dx + dy * dy + dz * dz;
  };
  // Two panes as far as each other keep the file's order.
  return order.sort((a, b) => far(b) - far(a) || a - b);
}

/** A part's triangles listed pane by pane in `order`, from `indices` into `out`, which is as long. */
export function listPanes(indices: Uint32Array, panes: readonly Pick<Pane, "first" | "count">[], order: readonly number[], out: Uint32Array): Uint32Array {
  let at = 0;
  for (const n of order) {
    const pane = panes[n] as Pick<Pane, "first" | "count">;
    out.set(indices.subarray(pane.first, pane.first + pane.count), at);
    at += pane.count;
  }
  return out;
}

/** A mesh of `part` named `name`: its geometry as it is, or as `at` carries it to the world. The caller gives it its material's place and adds it to the scene. */
export function partMesh(engine: EngineContext, name: string, part: SceneryPart, at?: Float32Array): Mesh {
  const geometry = at === undefined ? part : placed(part, at);
  const mesh = createMeshFromData(engine, name, geometry.positions, geometry.normals, geometry.indices, part.uvs, undefined, geometry.tangents ?? undefined);
  mesh.material = part.material;
  return mesh;
}

/** Bytes a part's geometry is on the GPU. */
export function partBytes(part: SceneryPart): number {
  return part.positions.byteLength + part.normals.byteLength + part.uvs.byteLength + (part.tangents?.byteLength ?? 0) + part.indices.byteLength;
}
