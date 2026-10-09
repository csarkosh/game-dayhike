// client/test/game/swashTexture.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createSwashTexture } from "../../src/game/swashTexture.js";
import { SWASH_COLUMNS, SWASH_STRIDE, SwashTable, type SwashCove } from "../../src/game/swashTable.js";
import { coastRead, oceanFieldFor, type OceanField } from "../../src/game/oceanWaves.js";
import { seedFromToken } from "../../src/game/seed.js";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");

/** The world's swash table, as the renderer makes it: the seed's cove on the field's own coastline. */
function tableFor(field: OceanField): SwashTable {
  const { z0, halfWidth } = coveFor(SEED);
  const cove: SwashCove = {
    z0, halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE, coastX: (z) => coastRead(field.tables, z)[0],
  };
  return new SwashTable(field, cove);
}

/** The data a raw texture was made or last updated with: NullEngine keeps it on the internal texture. */
const uploaded = (texture: Texture): Float32Array =>
  (texture.getInternalTexture() as unknown as { _bufferView: Float32Array })._bufferView;

describe("the swash's table as the sea reads it (createSwashTexture)", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("makes one RGBA32F row, 512 by 1, nearest and clamped, from the table's own array", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const table = tableFor(oceanFieldFor(SEED, 12));
    const swash = createSwashTexture(scene, table);
    expect(SWASH_COLUMNS).toBe(512);
    expect(SWASH_STRIDE).toBe(4);
    expect(swash.texture.getSize()).toEqual({ width: 512, height: 1 });
    const internal = swash.texture.getInternalTexture()!;
    expect(internal.type).toBe(Constants.TEXTURETYPE_FLOAT);
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.generateMipMaps).toBe(false);
    expect(swash.texture.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
    expect(swash.texture.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(swash.texture.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(swash.texture.name).toBe("oceanSwash");
    expect(uploaded(swash.texture)).toBe(table.data);
    swash.dispose();
  });

  it("uploads the table's array in place on every update, the same array each frame and nothing made for it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const table = tableFor(oceanFieldFor(SEED, 12));
    const swash = createSwashTexture(scene, table);
    const upload = vi.spyOn(engine, "updateRawTexture");
    // a sheet in the cove's middle column, as the table's update writes one
    table.data[256 * SWASH_STRIDE] = 9.5;
    table.data[256 * SWASH_STRIDE + 1] = 0.25;
    table.data[256 * SWASH_STRIDE + 2] = 9.5;
    table.data[256 * SWASH_STRIDE + 3] = 0;
    swash.update();
    table.data[256 * SWASH_STRIDE] = 4.75;
    swash.update();
    swash.update();
    expect(upload).toHaveBeenCalledTimes(3);
    for (const call of upload.mock.calls) {
      expect(call[0]).toBe(swash.texture.getInternalTexture());
      expect(call[1]).toBe(table.data);
      expect(call[2]).toBe(Constants.TEXTUREFORMAT_RGBA);
      expect(call[5]).toBe(Constants.TEXTURETYPE_FLOAT);
    }
    expect(uploaded(swash.texture)).toBe(table.data);
    expect(Array.from(uploaded(swash.texture).subarray(256 * 4, 256 * 4 + 4))).toEqual([4.75, 0.25, 9.5, 0]);
    swash.dispose();
  });

  it("disposes its texture and nothing else", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const table = tableFor(oceanFieldFor(SEED, 12));
    const swash = createSwashTexture(scene, table);
    const other = createSwashTexture(scene, table);
    swash.dispose();
    expect(swash.texture.getInternalTexture()).toBeNull();
    expect(scene.textures).not.toContain(swash.texture);
    expect(other.texture.getInternalTexture()).not.toBeNull();
    // the table outlives it: the sound and the wet ground read it too
    expect(table.data.length).toBe(2048);
    other.dispose();
  });
});
