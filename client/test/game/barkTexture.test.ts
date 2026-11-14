import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { defaultLoadBarkTexture } from "../../src/game/forestMeshes.js";
import { GIANT_SETS, SAPLING_BARKS, barkOutputs, barkTransform, barkUv } from "../../src/game/barkParams.js";
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

/**
 * A dressing's transform as coordinates (`barkUv`) against the matrix
 * Babylon makes of the same scales and turn: what a material with no texture
 * transform does to its mesh's coordinates is what Babylon's does in its
 * vertex stage.
 */
describe("barkUv", () => {
  it("lays a coordinate where Babylon's texture matrix lays it, for every bark a tree wears", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const out = [0, 0];
    for (const bark of [...GIANT_SETS.map((set) => set.bark), ...SAPLING_BARKS]) {
      const transform = barkTransform(bark);
      const texture = new Texture(null, scene);
      texture.uOffset = 0;
      texture.vOffset = 0;
      texture.uScale = transform.uScale;
      texture.vScale = transform.vScale;
      texture.wAng = transform.wAng;
      const m = texture.getTextureMatrix().m;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [0.37, -2.5], [4.6, 1.9]] as const) {
        barkUv(transform, u, v, out, 0);
        // The vertex stage's own product: the matrix times (u, v, 1, 0).
        expect(out[0], `${bark.set} u`).toBeCloseTo((m[0] as number) * u + (m[4] as number) * v + (m[8] as number), 5);
        expect(out[1], `${bark.set} v`).toBeCloseTo((m[1] as number) * u + (m[5] as number) * v + (m[9] as number), 5);
      }
      texture.dispose();
    }
    scene.dispose();
    engine.dispose();
  });
});
