/**
 * Every suite's NullEngine can make a raw 2D array texture. Babylon's
 * NullEngine makes a raw 2D texture without a GPU (`createRawTexture`: an
 * internal texture that holds the data, never uploaded, so never ready), but
 * its 2D array maker is WebGL's, which reads a GL context NullEngine does not
 * have. The water material binds one (`oceanArrayPlaceholder`) wherever a
 * water material is made, so the maker here does for an array what
 * `createRawTexture` does for a 2D texture. Loaded before every test file
 * (`vite.config.ts`, `setupFiles`).
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture.js";

type ArrayMaker = {
  createRawTexture2DArray(
    data: ArrayBufferView | null, width: number, height: number, depth: number, format: number,
    generateMipMaps: boolean, invertY: boolean, samplingMode: number, compression?: string | null, textureType?: number,
  ): InternalTexture;
  updateRawTexture2DArray(texture: InternalTexture, data: ArrayBufferView | null, format: number, invertY: boolean, compression?: string | null, textureType?: number): void;
};

const engine = NullEngine.prototype as unknown as ArrayMaker;

engine.createRawTexture2DArray = function (this: NullEngine, data, width, height, depth, format, generateMipMaps, invertY, samplingMode, compression = null, textureType = 0) {
  const texture = new InternalTexture(this, InternalTextureSource.Raw2DArray);
  texture.baseWidth = width;
  texture.baseHeight = height;
  texture.baseDepth = depth;
  texture.width = width;
  texture.height = height;
  texture.depth = depth;
  texture.format = format;
  texture.type = textureType;
  texture.generateMipMaps = generateMipMaps;
  texture.samplingMode = samplingMode;
  texture.invertY = invertY;
  texture.is2DArray = true;
  texture._compression = compression;
  texture._bufferView = data;
  return texture;
};

engine.updateRawTexture2DArray = function (texture, data, format, invertY, compression = null, textureType = 0) {
  texture._bufferView = data;
  texture.format = format;
  texture.invertY = invertY;
  texture._compression = compression;
  texture.type = textureType;
};
