import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginInterfaces, pluginTexts } from "./helpers/pluginText.js";
import groundHexHead from "../../src/game/shaders/groundHex.fragment.fx?raw";
import groundHexFetch from "../../src/game/shaders/groundHexFetch.fragment.fx?raw";
import groundHexNoise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
import finishFx from "../../src/game/shaders/finish.fragment.fx?raw";
import { terrainFarCoverDefs, TERRAIN_FRAGMENT_FAR_COVER, TERRAIN_MACRO_OCTAVES } from "../../src/game/terrainTexture.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// WebGL2's shader text at the branch's base (ba0fd95), one hash per text: what
// every plugin injects per stage, and the three post shaders as stored. A
// change here is a change to what every WebGL2 player compiles.
const PINS: Record<string, string> = {
  "atmosphere.fragment": "2f8a58972f2bd3a2af532928ec9f540aabf60eef0963d25bb776a27fe41ffaf6",
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
  "foliage.REEDS.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.TREE.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.REEDS.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.TREE.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.UNDERSTORY.fragment": "b0130d6ef6b87a30998655a0ea50ebbd6d2eba1de66e4fe720fe50b4bdf6cea9",
  "foliage.UNDERSTORY.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliageLight.fragment": "ae5b873be2cb7e2c35baaa379a229a37cdf5df08f9ccc3cab48060d173dbe14c",
  "groundConform.vertex": "a9f54562519ab094b2883463cec48050737f16a4f17e4a18852cfb414e227cea",
  "post.finish": "4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5",
  "post.grade": "74e331711356b6afe2ce371d749cfff39c64bc02473988dd2ba26bc9653ecd3a",
  "post.halationExtract": "1ee9b9ed30d66fd1e10e4a327104c3e9016a91a2b4ed6aa2cec64cb09df5d3fd",
  "skin.fragment": "111388dbf745542db596dae9ac3c41d726c7c0c61aeb4c8e87cc16e9e8c07fdf",
  // Re-pinned for the WGSL-reserved local `macro` renamed `macroRgb`. The
  // puddles' ripples under rain (trailPaint.ts) are stripped before hashing
  // (`withoutRipples`), and the test below shows the rename and the ripples
  // are the whole difference from the base. Re-pinned again for the shore
  // tint's one added line in `featurePaint.ts`, which begins it at the lake's
  // rim (the bed under the water paints itself); the foliage plugin for reeds
  // is the tree's text and interface.
  // The far ground's cover is taken out before hashing (`withoutFarCover`), so
  // the pin is still the text before it.
  "terrain.fragment": "393cbde35c652291d03850619cfdf4b67c6065aac4e84e87c4f9e865ffd71e10",
  "terrain.vertex": "6cb77a03482fa718ab0d086337dc427868eae556169055748622a8eec6ced007",
  "wing.vertex": "689d8ea88a0daa33ea1fc7e032e9e90c754ef7bd6ed0bec0bf55defcd341068e",
};

// The rest of what shapes each plugin's WebGL2 program, per state it is
// drawn in: its uniforms (UBO layout and GLSL declarations), samplers,
// attributes and the defines it sets. Taken at the branch's tip, where none of
// those has changed since the base.
const INTERFACE_PINS: Record<string, string> = {
  "atmosphere.interface": "b3abd6248a3183ba01bc79d415b4a92efa7f63962e43609b041db61bab7a96a6",
  "cliffTint.interface": "17f58097180ad484779cd5302189b01c65ae910a947d6d347ac9eff595479115",
  "distanceFade.interface": "c59e5c6bd9a213d90f127332528ef16d234392159113be81a6cc47b38d2709cb",
  "foliage.BLADES.interface": "38e133af1b4e6322274d74a695851032e14b221b6ff26d3d1a7d783265e6ec29",
  "foliage.BUSH.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.DUFF.interface": "38e133af1b4e6322274d74a695851032e14b221b6ff26d3d1a7d783265e6ec29",
  "foliage.FLOWER.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.GRASS.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.MEADOW.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliage.REEDS.interface": "6ad630100290345752cb3563eefdb5cfaa5accaa8739e74d9329337cdb7dc640",
  "foliage.TREE.interface": "6ad630100290345752cb3563eefdb5cfaa5accaa8739e74d9329337cdb7dc640",
  "foliage.UNDERSTORY.interface": "fae1fc5cd58faeef68e40265e525943f3bb209eadaa23b7b27b2104a3ca22651",
  "foliageLight.interface": "a86a666d70d9ecddd600f74e67b8028f7795551c775a05e786e4ee73bea725e8",
  "groundConform.interface": "d1318897a8b44958dc6d4ba703fe861a79590ee61c6d7cb830bc54cb33e7b75a",
  "skin.interface": "d39b98bf284499c66f8b2765d9947ff326b97a8a716bcb4f2c89cf5b9c1bc2de",
  // Re-pinned for `terrainRain` and `terrainTime`, the two floats the
  // puddles' ripples read, declared on both uniform paths.
  "terrain.interface": "c0528421aedd3e5f0c3030247b528331ea69f7bf78fcd8b9c59201a21ce63ad2",
  "wing.interface": "bb03268d86b3711b1e489d0f2a62c81f60556c063d98fc835954b43a11cff985",
};

/** The puddles' ripples (trailPaint.ts) taken out of the terrain fragment:
 * from their comment through the normal they tilt, which goes back to the
 * flat puddle normal it replaced. The text is the base's again. */
function withoutRipples(text: string): string {
  const from = text.indexOf("    // Rain on the puddles:");
  const last = "normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), tPuddleN, tPuddle));\n";
  const to = text.indexOf(last) + last.length;
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return `${text.slice(0, from)}    normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), vec3(0.0, 1.0, 0.0), tPuddle));\n${text.slice(to)}`;
}

/** The far ground's cover (terrainTexture.ts, roadPaint.ts, trailPaint.ts)
 * taken out of the terrain fragment: each piece it adds, removed where it
 * stands (each must stand there once), and the macro tint's octaves put back
 * as the one line they were. The text is the one before the far cover. */
function withoutFarCover(text: string): string {
  const pieces: (readonly [string, string])[] = [
    [terrainFarCoverDefs(), ""],
    ["float terrainSpecW = 1.0;\nfloat terrainFarW = 0.0;\nfloat terrainPaintW = 0.0;\nvec3 terrainFarN = vec3(0.0, 1.0, 0.0);\n", ""],
    [TERRAIN_MACRO_OCTAVES, "  vec3 macroRgb = macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y);\n"],
    [TERRAIN_FRAGMENT_FAR_COVER, ""],
  ];
  let out = text;
  for (const [piece, was] of pieces) {
    expect(out.split(piece).length - 1, piece.slice(0, 60)).toBe(1);
    out = out.replace(piece, () => was);
  }
  return out;
}

describe("WebGL2's shader text", () => {
  it("is byte for byte what it was", () => {
    const texts = pluginTexts();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(PINS).sort());
    for (const [key, text] of Object.entries(texts)) {
      expect(sha(key === "terrain.fragment" ? withoutFarCover(withoutRipples(text)) : text), key).toBe(PINS[key]);
    }
  });

  it("changes the terrain fragment by one renamed identifier and the puddles' ripples, and nothing else", () => {
    const text = pluginTexts()["terrain.fragment"] as string;
    // The WGSL-reserved local `macro` renamed at source on both engines. The
    // word survives only in the hex include's comments, which glslang drops.
    expect(text).toContain("vec3 macroRgb = macroTint(");
    expect(text).not.toContain("vec3 macro =");
    // The ripples: four hashed-ring layers in the trail paint's puddle normal,
    // reading `terrainRain` and `terrainTime` (rainParams.ts, trailPaint.ts),
    // run only under rain.
    expect(text.match(/vec2 tRc = floor\(tRp\);/g)).toHaveLength(4);
    expect(text).toContain("if (terrainRain > 0.0) {");
    expect(text).toContain("vec3 tPuddleN = normalize(vec3(tRipple.x * terrainRain, 1.0, tRipple.y * terrainRain));");
    // With the ripples taken out and the rename undone, the base's text and
    // the shore tint's one line.
    const base = withoutFarCover(withoutRipples(text)).replaceAll("macroRgb", "macro");
    expect(base).not.toContain("tRipple");
    expect(sha(base)).toBe("fd74235171f3b423ebdc8126972fa2ca1b6aee08fba3eef1a0cca297e4d21669");
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
