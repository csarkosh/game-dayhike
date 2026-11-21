/**
 * The ground's six layers as what they are loaded from: each layer's albedo
 * image, and the normal and RAH (roughness / AO / height) images that go into
 * the two texture arrays, with how each is read and the pure half of turning
 * the images into the arrays' bytes.
 *
 * Layer order everywhere: grass, forest floor, rock, sand, pebble, asphalt.
 *
 * An albedo is one 512² WebP, read by the terrain's fragment stage as it is
 * stored (no sRGB decode: the stage divides each layer by its own mean
 * colour, `LAYER_MEAN_RGB`), with mipmaps, trilinear, repeating both ways,
 * and turned over as it is uploaded, so v = 0 is the image's bottom row.
 *
 * A normal or RAH image is data: decoded with no colour management and no
 * premultiplied alpha, resized to the array's side, its rows turned over so
 * the array agrees with the albedos on which way v runs, and laid one layer
 * after another into an RGBA8 array of six layers, with mipmaps, trilinear,
 * repeating both ways. Until the images land, each array is one neutral
 * texel a layer.
 *
 * Babylon-free: `lite/groundTextures.ts` makes the albedos' textures and
 * the arrays.
 */
import { textureUrl } from "./assetUrls.js";
import { fetchRetried } from "@csarkosh/engine/game/fetchRetry";

export const GROUND_LAYERS = 6;
export const GROUND_MAP_SIZE = 512;

/** A ground image's address by its file's middle name: asked when it is read, since a game registers its files as its page starts. */
const ground = (name: string): string => textureUrl(`textures/ground.${name}.webp`);
/** The six layers' files, in layer order. */
const GROUND_FILES = ["grass", "forest_floor", "rock", "sand", "pebble", "asphalt"] as const;

/** Each layer's albedo: its image, and the sampler the terrain's fragment
 * stage reads it under. The asphalt is the road paint's, bound only in a
 * world with a road. */
export const GROUND_ALBEDOS = {
  grass: { get url() { return ground("grass"); }, sampler: "terrainGrass" },
  floor: { get url() { return ground("forest_floor"); }, sampler: "terrainFloor" },
  rock: { get url() { return ground("rock"); }, sampler: "terrainRock" },
  sand: { get url() { return ground("sand"); }, sampler: "terrainSand" },
  pebble: { get url() { return ground("pebble"); }, sampler: "terrainPebble" },
  asphalt: { get url() { return ground("asphalt"); }, sampler: "roadAsphalt" },
} as const;

/** The two arrays' images, a layer each, in layer order: `normal` goes into
 * the array read as `terrainNormals` (tangent space), `rah` into `terrainRAH`. */
export const GROUND_LAYER_URLS = {
  get normal(): string[] { return GROUND_FILES.map((file) => ground(`${file}.normal`)); },
  get rah(): string[] { return GROUND_FILES.map((file) => ground(`${file}.rah`)); },
};
/** A flat, +Z tangent-space normal. */
export const NEUTRAL_NORMAL: Uint8ClampedArray = Uint8ClampedArray.from([128, 128, 255, 255]);
/** Mid roughness, AO's own neutral, mid height. All three RAH channels are
 * packed with their own mean centred on 0.5, so 128 raw is the shared
 * neutral byte for R, G and B alike: the
 * shader divides the blended AO (G) back by 0.5 (`lite/terrainPlugins.ts`),
 * turning 128/255 ≈ 0.502 into ≈1.0 — a no-op multiplier, not literally
 * "no occlusion", which a flat 255 byte would be. */
export const NEUTRAL_RAH: Uint8ClampedArray = Uint8ClampedArray.from([128, 128, 128, 255]);

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
 * see `decodeGroundLayer`'s comment for why this exists instead of an
 * `invertY` flag on the GPU texture. */
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
 * texture to invert Y: the array texture is made with no flip, so the
 * flip has to happen before the data ever reaches the GPU, for
 * the array to agree with the albedo textures' own flip on
 * which way v runs over the same planar world-XZ UV. */
export async function decodeGroundLayer(url: string, size: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const blob = await fetchRetried(url, signal, (response) => response.blob());
  // The decode itself cannot be stopped once begun; this is the last point
  // before it where a teardown still saves the work.
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return flipRowsY(ctx.getImageData(0, 0, size, size).data, size);
}
