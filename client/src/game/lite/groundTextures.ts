/**
 * The terrain material's textures on Babylon Lite: the ground layers'
 * images decoded into layer arrays (`groundLayers.ts` says what each image
 * is and how it is read), a world's float tables as float textures
 * (`terrainTables.ts`), and the ground cloud's map (`cloudParams.ts`), which
 * is written again as the eye moves.
 *
 * A layer's albedo is an array of one layer, since the terrain's plugin
 * reads every image through one sampler. Every image is decoded as data,
 * its rows turned over (`decodeGroundLayer`), so v = 0 is its bottom row in
 * the albedos and the two arrays alike. Lite's samplers filter between levels and repeat; they
 * take no anisotropy.
 */
import {
  createRenderTexture2D, createTexture2DArrayFromPixels, createTexture2DFromPixels, updateTexture2DFromPixels, updateTextureRegion,
  type EngineContext, type Texture2D, type Texture2DArray,
} from "@babylonjs/lite";
import { CLOUD_NOISE_SIZE, cloudNoiseMap, writeCloudGround, type CloudGround } from "@csarkosh/engine/game/cloudParams";
import { GROUND_ALBEDOS, GROUND_LAYERS, GROUND_LAYER_URLS, GROUND_MAP_SIZE, decodeGroundLayer, interleaveLayers } from "../groundLayers.js";
import { reportGroundImage } from "../loadReport.js";
import type { FloatTable } from "@csarkosh/engine/game/terrainTables";
import type { TerrainTextures } from "@csarkosh/engine/game/lite/terrainPlugins";

/** The layer arrays: each layer's albedo, the normals and the RAH maps. */
export type GroundArrays = Pick<TerrainTextures, "grass" | "floor" | "rock" | "sand" | "pebble" | "asphalt" | "normals" | "rah">;

/** How many images the ground's arrays are decoded from. */
export const GROUND_IMAGES = Object.keys(GROUND_ALBEDOS).length + 2 * GROUND_LAYERS;

/**
 * The ground's arrays, once every image has been fetched and decoded.
 * `landed` is called as each image is in, for whoever counts the loads in
 * flight, and the loading bar is told of each as it starts and as it is in
 * (`reportGroundImage`); `signal` ends the fetches of a renderer that has
 * gone, and the promise then rejects.
 */
export async function loadGroundArrays(engine: EngineContext, signal: AbortSignal, landed: () => void): Promise<GroundArrays> {
  const decode = async (url: string): Promise<Uint8ClampedArray> => {
    const told = reportGroundImage(url, signal);
    try {
      return await decodeGroundLayer(url, GROUND_MAP_SIZE, signal);
    } finally {
      landed();
      told.landed();
    }
  };
  const albedo = async (url: string): Promise<Uint8Array> => {
    const pixels = await decode(url);
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  };
  const layers = async (urls: readonly string[]): Promise<Uint8Array> => interleaveLayers(await Promise.all(urls.map(decode)), GROUND_MAP_SIZE);
  const [grass, floor, rock, sand, pebble, asphalt, normals, rah] = await Promise.all([
    albedo(GROUND_ALBEDOS.grass.url), albedo(GROUND_ALBEDOS.floor.url), albedo(GROUND_ALBEDOS.rock.url),
    albedo(GROUND_ALBEDOS.sand.url), albedo(GROUND_ALBEDOS.pebble.url), albedo(GROUND_ALBEDOS.asphalt.url),
    layers(GROUND_LAYER_URLS.normal), layers(GROUND_LAYER_URLS.rah),
  ]);
  signal.throwIfAborted();
  const array = (data: Uint8Array, count: number): Texture2DArray =>
    createTexture2DArrayFromPixels(engine, data, GROUND_MAP_SIZE, GROUND_MAP_SIZE, count, { mipMaps: true, srgb: false });
  return {
    grass: array(grass, 1), floor: array(floor, 1), rock: array(rock, 1), sand: array(sand, 1), pebble: array(pebble, 1), asphalt: array(asphalt, 1),
    normals: array(normals, GROUND_LAYER_URLS.normal.length), rah: array(rah, GROUND_LAYER_URLS.rah.length),
  };
}

/** A float table's texture, and the table written into it again. */
export type TableTexture = {
  readonly texture: Texture2D;
  /** Writes the table's floats as they now stand (the road's follows the eye). */
  write(): void;
  /** The bytes a write sends. */
  readonly bytes: number;
};

/**
 * `table` as a 32-bit float texture, four floats a texel, read at the
 * nearest texel: a table of one channel goes into red. A world with no such
 * table gets one texel of zeros, which its material binds and never reads.
 */
export function tableTexture(engine: EngineContext, table: FloatTable | null): TableTexture {
  const width = table?.width ?? 1;
  const height = table?.height ?? 1;
  const texture = createRenderTexture2D(engine, width, height, { format: "rgba32float", minFilter: "nearest", magFilter: "nearest" });
  const texels = table === null || table.channels === 1 ? new Float32Array(width * height * 4) : table.data;
  const write = (): void => {
    if (table !== null && table.channels === 1) for (let i = 0; i < width * height; i++) texels[i * 4] = table.data[i] as number;
    updateTextureRegion(engine, texture, texels, { width, height, bytesPerRow: width * 16 });
  };
  write();
  return { texture, write, bytes: width * height * 16 };
}

/** The ground cloud's map, and the ground laid into it again. */
export type CloudMapTexture = {
  readonly texture: Texture2D;
  /** Lays `ground` into the map beside the noise (`writeCloudGround`) and sends the map whole. */
  lay(ground: CloudGround): void;
  /** The bytes a lay sends. */
  readonly bytes: number;
};

/**
 * The ground cloud's map: its noise, repeating both ways, read bilinearly,
 * one level. The ground's two channels are flat until the first lay: the
 * air's plugin binds the map from the start and reads the ground only while
 * the cloud is marched.
 */
export function cloudMapTexture(engine: EngineContext): CloudMapTexture {
  const map = cloudNoiseMap();
  const texture = createTexture2DFromPixels(engine, map, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, {
    addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear",
  });
  return {
    texture,
    bytes: map.byteLength,
    lay(ground) {
      writeCloudGround(map, ground);
      updateTexture2DFromPixels(engine, texture, map);
    },
  };
}
