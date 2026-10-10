// client/src/game/swashTexture.ts
/**
 * The swash's table as the sea's material reads it (`oceanSwash.fx`): one row
 * of SWASH_COLUMNS RGBA32F texels, (front, thickness, wet reach, age) each, a
 * column a metre of the cove's shore, sampled nearest and clamped. It is made
 * once from the table's own `Float32Array` and uploaded from it in place each
 * frame, so nothing is made per frame. Renderer-only.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { SWASH_COLUMNS, type SwashTable } from "./swashTable.js";

export type SwashTexture = {
  readonly texture: RawTexture;
  /** Uploads the table's data as it stands: once a frame, after `table.update`. */
  update(): void;
  dispose(): void;
};

/** A RawTexture RGBA32F, SWASH_COLUMNS × 1, NEAREST, CLAMP, updated in place from `table.data` each frame. */
export function createSwashTexture(scene: Scene, table: SwashTable): SwashTexture {
  const texture = new RawTexture(
    table.data,
    SWASH_COLUMNS,
    1,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
  texture.name = "oceanSwash";
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return {
    texture,
    update(): void {
      texture.update(table.data);
    },
    dispose(): void {
      texture.dispose();
    },
  };
}
