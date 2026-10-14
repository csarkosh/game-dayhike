import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { defaultLoadBarkTexture } from "../../src/game/forestMeshes.js";
import { barkOutputs } from "../../src/game/barkParams.js";
import { textureUrl } from "../../src/game/assetUrls.js";

/**
 * The bark map loader the forest reads its KTX2 sets with, as it constructs
 * a map: the flags a compressed file needs (`defaultLoadBarkTexture`'s
 * comment). NullEngine makes the texture without reading the file, so the
 * load itself proves nothing here; the construction is what is checked.
 */
describe("defaultLoadBarkTexture", () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
    for (const e of engines.splice(0)) e.dispose();
  });

  function load(output: string, colour: boolean): Promise<Texture> {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    return new Promise((resolve) => {
      // Either callback settles: a load that fails under NullEngine would
      // otherwise leave the texture waited on for good. Both fire after the
      // construction returns (NullEngine's on a timer), so both see it.
      const settle = (): void => resolve(texture);
      const texture = defaultLoadBarkTexture(textureUrl(output), scene, colour, settle, settle);
    });
  }

  it("reads the colour map through an sRGB buffer, unflipped, trilinear, with mipmaps, from the set's KTX2 file", async () => {
    const texture = await load(barkOutputs("cedar", "2k").colour, true);
    expect(texture).toBeInstanceOf(Texture);
    expect(texture.url!.endsWith("textures/bark.cedar.2k.ktx2")).toBe(true);
    expect(texture.invertY).toBe(false);
    expect(texture.samplingMode).toBe(3);
    expect(texture.noMipmap).toBe(false);
    expect(texture._useSRGBBuffer).toBe(true);
  });

  it("reads the normal and ARM maps raw, the same flags otherwise", async () => {
    const outputs = barkOutputs("metasequoia", "1k");
    const normal = await load(outputs.normal, false);
    expect(normal.url!.endsWith("textures/bark.metasequoia.1k.normal.ktx2")).toBe(true);
    expect(normal.invertY).toBe(false);
    expect(normal.samplingMode).toBe(3);
    expect(normal.noMipmap).toBe(false);
    expect(normal._useSRGBBuffer).toBe(false);
    const arm = await load(outputs.arm, false);
    expect(arm.url!.endsWith("textures/bark.metasequoia.1k.arm.ktx2")).toBe(true);
    expect(arm.invertY).toBe(false);
    expect(arm.samplingMode).toBe(3);
    expect(arm._useSRGBBuffer).toBe(false);
  });
});
