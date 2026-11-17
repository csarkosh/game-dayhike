/**
 * The ground's normal and RAH (roughness / AO / height) maps as two
 * texture arrays. Twelve more samplers would
 * not fit beside the terrain material's eleven; two do.
 *
 * Placeholder-first: a 1×1×6 neutral array is bound immediately so the
 * terrain never waits on twelve downloads, and the decoded 512×512×6 arrays
 * are swapped in when they land. The plugin re-reads `normals`/`rah` every
 * bind, so the swap is a field write. A failed decode keeps the placeholder
 * (the ground stays flat, as it is today) and warns once.
 *
 * Decoding is a browser affair (`createImageBitmap`, `OffscreenCanvas`);
 * NullEngine has no 2D-array textures either, so both are injectable and
 * the pure `interleaveLayers` (and `flipRowsY`) carry the logic
 * a test can pin. The images, the decode and those two are
 * `groundLayers.ts`'s, which loads no Babylon; what is here makes the
 * textures of them.
 *
 * Orientation: WebGL rejects `UNPACK_FLIP_Y_WEBGL` for 3D/array
 * uploads, so `RawTexture2DArray`'s `invertY` is false and `decodeLayer`
 * flips each layer's rows on the CPU instead, so the array still agrees with
 * the albedo `Texture`s' invertY=true over the same planar world-XZ UV.
 */
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { reportLayer } from "./loadReport.js";

import {
  GROUND_LAYERS, GROUND_LAYER_URLS, GROUND_MAP_SIZE, NEUTRAL_NORMAL, NEUTRAL_RAH, decodeGroundLayer, flipRowsY, interleaveLayers,
} from "./groundLayers.js";

// What the arrays are made from is `groundLayers.ts`'s; named from here too.
export { GROUND_LAYERS, GROUND_LAYER_URLS, GROUND_MAP_SIZE, NEUTRAL_NORMAL, NEUTRAL_RAH, flipRowsY, interleaveLayers };

export type GroundArrays = { normals: BaseTexture; rah: BaseTexture; readonly ready: Promise<void>; dispose(): void };
export type GroundArraysFactory = (scene: Scene) => GroundArrays;

/** A layer's decode (`decodeGroundLayer`: its rows turned over on the CPU,
 * since `RawTexture2DArray`'s `invertY` below must stay false), told to the
 * loading bar as it starts and as it ends, however it ends. */
export async function decodeLayer(url: string, size: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  reportLayer("start", url);
  try {
    return await decodeGroundLayer(url, size, signal);
  } finally {
    reportLayer("done", url);
  }
}

// The ground's downloads are one stage of the loading bar, told by name with no engine (`loadReport.ts`); named from here too.
export { GROUND_STAGE_TOTAL, reportLayer } from "./loadReport.js";

type CreateArray = (data: Uint8Array, size: number, depth: number, name: string) => BaseTexture;

function createRawArray(scene: Scene): CreateArray {
  return (data, size, depth, name) => {
    // invertY FALSE: WebGL forbids the flip-on-upload flag for 3D/array
    // textures (see `decodeLayer`'s comment), so `decodeLayer` flips the rows
    // itself before this ever runs, and the two neutral placeholder texels
    // (1x1, flip-invariant) need no flip either way.
    const tex = new RawTexture2DArray(data, size, size, depth, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    tex.name = name;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  };
}

export function loadGroundArrays(
  scene: Scene,
  urls: { normal: string[]; rah: string[] } = GROUND_LAYER_URLS,
  decode: (url: string, size: number, signal?: AbortSignal) => Promise<Uint8ClampedArray> = decodeLayer,
  options: { size?: number; createArray?: CreateArray; warn?: (message: string) => void } = {},
): GroundArrays {
  const size = options.size ?? GROUND_MAP_SIZE;
  const create = options.createArray ?? createRawArray(scene);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const placeholder = (texel: Uint8ClampedArray, name: string) =>
    create(interleaveLayers(new Array(GROUND_LAYERS).fill(texel), 1), 1, GROUND_LAYERS, name);
  let disposed = false;
  // Aborted in `dispose`, the way every model load is (`modelLoad.ts`): the
  // twelve downloads stop with the scene rather than run on for nothing.
  const loads = new AbortController();
  const arrays: GroundArrays = {
    normals: placeholder(NEUTRAL_NORMAL, "terrainNormals"),
    rah: placeholder(NEUTRAL_RAH, "terrainRAH"),
    ready: Promise.resolve(),
    dispose() { disposed = true; loads.abort(); arrays.normals.dispose(); arrays.rah.dispose(); },
  };
  const load = async (kind: "normal" | "rah", field: "normals" | "rah") => {
    const layers = await Promise.all(urls[kind].map((u) => decode(u, size, loads.signal)));
    // `dispose()` may have already run while these twelve decodes were in
    // flight — the scene is torn down, so the late array must not be created
    // (and bound into `arrays[field]`) at all; that would orphan a GPU
    // resource nothing would ever dispose.
    if (disposed) return;
    const real = create(interleaveLayers(layers, size), size, GROUND_LAYERS, field === "normals" ? "terrainNormals" : "terrainRAH");
    const old = arrays[field];
    arrays[field] = real;
    old.dispose();
  };
  (arrays as { ready: Promise<void> }).ready = Promise.all([load("normal", "normals"), load("rah", "rah")])
    .then(() => undefined)
    .catch((error: unknown) => {
      // Stopped by `dispose`: nothing failed, and there is no scene to keep.
      if (disposed) return;
      warn(`ground maps: keeping the flat placeholders — ${String(error)}`);
    });
  return arrays;
}
