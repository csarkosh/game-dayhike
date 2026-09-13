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
 * a test can pin.
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

import grassN from "../../assets/textures/ground.grass.normal.webp?url";
import floorN from "../../assets/textures/ground.forest_floor.normal.webp?url";
import rockN from "../../assets/textures/ground.rock.normal.webp?url";
import sandN from "../../assets/textures/ground.sand.normal.webp?url";
import pebbleN from "../../assets/textures/ground.pebble.normal.webp?url";
import asphaltN from "../../assets/textures/ground.asphalt.normal.webp?url";
import grassR from "../../assets/textures/ground.grass.rah.webp?url";
import floorR from "../../assets/textures/ground.forest_floor.rah.webp?url";
import rockR from "../../assets/textures/ground.rock.rah.webp?url";
import sandR from "../../assets/textures/ground.sand.rah.webp?url";
import pebbleR from "../../assets/textures/ground.pebble.rah.webp?url";
import asphaltR from "../../assets/textures/ground.asphalt.rah.webp?url";

export const GROUND_LAYERS = 6;
export const GROUND_MAP_SIZE = 512;
/** Layer order everywhere: grass, floor, rock, sand, pebble, asphalt. */
export const GROUND_LAYER_URLS = {
  normal: [grassN, floorN, rockN, sandN, pebbleN, asphaltN],
  rah: [grassR, floorR, rockR, sandR, pebbleR, asphaltR],
};
/** A flat, +Z tangent-space normal. */
export const NEUTRAL_NORMAL: Uint8ClampedArray = Uint8ClampedArray.from([128, 128, 255, 255]);
/** Mid roughness, AO's own neutral, mid height. All three RAH channels are
 * packed with their own mean centred on 0.5, so 128 raw is the shared
 * neutral byte for R, G and B alike: the
 * shader divides the blended AO (G) back by 0.5 (`terrainTexture.ts`,
 * `roadPaint.ts`), turning 128/255 ≈ 0.502 into ≈1.0 — a no-op multiplier,
 * not literally "no occlusion" as a flat 255 byte used to mean. */
export const NEUTRAL_RAH: Uint8ClampedArray = Uint8ClampedArray.from([128, 128, 128, 255]);

export type GroundArrays = { normals: BaseTexture; rah: BaseTexture; readonly ready: Promise<void>; dispose(): void };
export type GroundArraysFactory = (scene: Scene) => GroundArrays;

export function interleaveLayers(layers: readonly Uint8ClampedArray[], size: number): Uint8Array {
  if (layers.length !== GROUND_LAYERS) throw new Error(`${layers.length} layers, expected ${GROUND_LAYERS} layers`);
  const per = size * size * 4;
  const out = new Uint8Array(per * GROUND_LAYERS);
  layers.forEach((layer, i) => {
    if (layer.length !== per) throw new Error(`layer ${i}: ${layer.length} bytes, expected ${per}`);
    out.set(layer, i * per);
  });
  return out;
}

/** Reverse RGBA row order in place-equivalent fashion (row 0 <-> row
 * `size - 1`, etc.). Pure and Node-testable, unlike the decode around it —
 * see `decodeLayer`'s comment for why this exists instead of an `invertY`
 * flag on the GPU texture. */
export function flipRowsY(data: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const rowBytes = size * 4;
  const out = new Uint8ClampedArray(data.length);
  for (let row = 0; row < size; row++) {
    const src = row * rowBytes;
    out.set(data.subarray(src, src + rowBytes), (size - 1 - row) * rowBytes);
  }
  return out;
}

/** Browser decode: bytes → RGBA at `size`, no colour management — these are
 * data. Flips rows on the CPU (`flipRowsY`) rather than asking the GPU
 * texture to invert Y: WebGL rejects `UNPACK_FLIP_Y_WEBGL` for 3D/array
 * uploads (`texImage3D`: "FLIP_Y or PREMULTIPLY_ALPHA isn't allowed for
 * uploading 3D textures"), so `RawTexture2DArray`'s `invertY` below must stay
 * false and the flip has to happen before the data ever reaches the GPU, so
 * the array still agrees with the albedo `Texture`s' default invertY=true on
 * which way v runs over the same planar world-XZ UV. */
export async function decodeLayer(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return flipRowsY(ctx.getImageData(0, 0, size, size).data, size);
}

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
  decode: (url: string, size: number) => Promise<Uint8ClampedArray> = decodeLayer,
  options: { size?: number; createArray?: CreateArray; warn?: (message: string) => void } = {},
): GroundArrays {
  const size = options.size ?? GROUND_MAP_SIZE;
  const create = options.createArray ?? createRawArray(scene);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const placeholder = (texel: Uint8ClampedArray, name: string) =>
    create(interleaveLayers(new Array(GROUND_LAYERS).fill(texel), 1), 1, GROUND_LAYERS, name);
  let disposed = false;
  const arrays: GroundArrays = {
    normals: placeholder(NEUTRAL_NORMAL, "terrainNormals"),
    rah: placeholder(NEUTRAL_RAH, "terrainRAH"),
    ready: Promise.resolve(),
    dispose() { disposed = true; arrays.normals.dispose(); arrays.rah.dispose(); },
  };
  const load = async (kind: "normal" | "rah", field: "normals" | "rah") => {
    const layers = await Promise.all(urls[kind].map((u) => decode(u, size)));
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
    .catch((error: unknown) => { warn(`ground maps: keeping the flat placeholders — ${String(error)}`); });
  return arrays;
}
