import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginTexts } from "./helpers/pluginText.js";
import groundHexFx from "../../src/game/shaders/groundHex.fragment.fx?raw";
import finishFx from "../../src/game/shaders/finish.fragment.fx?raw";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// WebGL2's shader text at the branch's base (ba0fd95), one hash per text: what
// every plugin injects per stage, and the three post shaders as stored. A
// change here is a change to what every WebGL2 player compiles.
const PINS: Record<string, string> = {
  "atmosphere.fragment": "35f73a93548808b564e05c9687e4e20ab54ec34be04fe3baca9e9ab04fef5d13",
  "cliffTint.fragment": "34b80348c2b278087d42892dd31129fc6aac2b12c93f275293617b88e9e2bccd",
  "cliffTint.vertex": "3fcb23ae5aab79e441e6d140e71ad0c149a0702f72c48fa093fc0b9fd3076de1",
  "distanceFade.fragment": "e9fd42d78c56e2f364ac16691996386de60dd9717060cc3822bd296c9c09281f",
  "distanceFade.vertex": "230ec584603269b72bb5be0710463bb2cf58096cb6cdabaf513941807db4112b",
  "foliage.BLADES.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.BLADES.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.BUSH.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.BUSH.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.DUFF.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.DUFF.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.FLOWER.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.FLOWER.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.GRASS.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.GRASS.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.MEADOW.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.MEADOW.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.TREE.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.TREE.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.UNDERSTORY.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.UNDERSTORY.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliageLight.fragment": "ae5b873be2cb7e2c35baaa379a229a37cdf5df08f9ccc3cab48060d173dbe14c",
  "groundConform.vertex": "a9f54562519ab094b2883463cec48050737f16a4f17e4a18852cfb414e227cea",
  "post.finish": "4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5",
  "post.grade": "403c4b90876053e751bc21e76711f81212fef9437e422f0e7757337b3b5b71c4",
  "post.halationExtract": "1ee9b9ed30d66fd1e10e4a327104c3e9016a91a2b4ed6aa2cec64cb09df5d3fd",
  "skin.fragment": "111388dbf745542db596dae9ac3c41d726c7c0c61aeb4c8e87cc16e9e8c07fdf",
  "terrain.fragment": "748f988e8d74740112ecea806c8494d9811861224f78165aef7d2f646e6742b2",
  "terrain.vertex": "6cb77a03482fa718ab0d086337dc427868eae556169055748622a8eec6ced007",
  "wing.vertex": "689d8ea88a0daa33ea1fc7e032e9e90c754ef7bd6ed0bec0bf55defcd341068e",
};

describe("WebGL2's shader text", () => {
  it("is byte for byte what it was", () => {
    const texts = pluginTexts();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(PINS).sort());
    for (const [key, text] of Object.entries(texts)) expect(sha(text), key).toBe(PINS[key]);
  });

  it("pins the hex include and the finish pass as files", () => {
    expect(sha(groundHexFx)).toBe("21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb");
    expect(sha(finishFx)).toBe("4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5");
  });
});
