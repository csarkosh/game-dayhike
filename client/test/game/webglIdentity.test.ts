import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginInterfaces, pluginTexts } from "./helpers/pluginText.js";
import groundHexHead from "../../src/game/shaders/groundHex.fragment.fx?raw";
import groundHexFetch from "../../src/game/shaders/groundHexFetch.fragment.fx?raw";
import groundHexNoise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
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
  // Re-pinned for the WGSL-reserved local `macro` renamed `macroRgb`; the
  // test below shows that rename is the whole difference.
  "terrain.fragment": "a58cc4cbf6c22175636e3a7a941c55671dc1cbc81b23b9004a3f56958ea53ff0",
  "terrain.vertex": "6cb77a03482fa718ab0d086337dc427868eae556169055748622a8eec6ced007",
  "wing.vertex": "689d8ea88a0daa33ea1fc7e032e9e90c754ef7bd6ed0bec0bf55defcd341068e",
};

// The rest of what shapes each plugin's WebGL2 program, per state it is
// drawn in: its uniforms (UBO layout and GLSL declarations), samplers,
// attributes and the defines it sets. Taken at the branch's tip, where none of
// those has changed since the base.
const INTERFACE_PINS: Record<string, string> = {
  "atmosphere.interface": "8d2b4a4042179853de33a6c9f4ff2a4c5ecb33ab7a48d44661530b757a19c34f",
  "cliffTint.interface": "17f58097180ad484779cd5302189b01c65ae910a947d6d347ac9eff595479115",
  "distanceFade.interface": "c59e5c6bd9a213d90f127332528ef16d234392159113be81a6cc47b38d2709cb",
  "foliage.BLADES.interface": "38e133af1b4e6322274d74a695851032e14b221b6ff26d3d1a7d783265e6ec29",
  "foliage.BUSH.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.DUFF.interface": "38e133af1b4e6322274d74a695851032e14b221b6ff26d3d1a7d783265e6ec29",
  "foliage.FLOWER.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.GRASS.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.MEADOW.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.TREE.interface": "6ad630100290345752cb3563eefdb5cfaa5accaa8739e74d9329337cdb7dc640",
  "foliage.UNDERSTORY.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliageLight.interface": "a86a666d70d9ecddd600f74e67b8028f7795551c775a05e786e4ee73bea725e8",
  "groundConform.interface": "d1318897a8b44958dc6d4ba703fe861a79590ee61c6d7cb830bc54cb33e7b75a",
  "skin.interface": "d39b98bf284499c66f8b2765d9947ff326b97a8a716bcb4f2c89cf5b9c1bc2de",
  "terrain.interface": "7f8eeb214ca436ea7e63d024459ba86645c3557a3f5e5e4345376bdb8259fb78",
  "wing.interface": "bb03268d86b3711b1e489d0f2a62c81f60556c063d98fc835954b43a11cff985",
};

describe("WebGL2's shader text", () => {
  it("is byte for byte what it was", () => {
    const texts = pluginTexts();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(PINS).sort());
    for (const [key, text] of Object.entries(texts)) expect(sha(text), key).toBe(PINS[key]);
  });

  it("changes the terrain fragment by one renamed identifier and nothing else", () => {
    const text = pluginTexts()["terrain.fragment"] as string;
    // The WGSL-reserved local `macro` renamed at source on both engines. The
    // word survives only in the hex include's comments, which glslang drops.
    expect(text).toContain("vec3 macroRgb = macroTint(");
    expect(text).not.toContain("vec3 macro =");
    expect(sha(text.replaceAll("macroRgb", "macro"))).toBe("748f988e8d74740112ecea806c8494d9811861224f78165aef7d2f646e6742b2");
  });

  it("keeps every plugin's uniforms, samplers, attributes and defines what they were", () => {
    const texts = pluginInterfaces();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(INTERFACE_PINS).sort());
    for (const [key, text] of Object.entries(texts)) expect(sha(text), key).toBe(INTERFACE_PINS[key]);
  });

  it("pins the hex include and the finish pass as files", () => {
    // The hex include is three files, joined on WebGL2 into the one it was.
    expect(sha(groundHexHead + groundHexFetch + groundHexNoise)).toBe(
      "21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb",
    );
    expect(sha(finishFx)).toBe("4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5");
  });
});
