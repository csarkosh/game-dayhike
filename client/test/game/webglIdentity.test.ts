import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginInterfaces, pluginTexts } from "./helpers/pluginText.js";
import groundHexHead from "../../src/game/shaders/groundHex.fragment.fx?raw";
import groundHexFetch from "../../src/game/shaders/groundHexFetch.fragment.fx?raw";
import groundHexNoise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
import {
  terrainFarCoverDefs, TERRAIN_FRAGMENT_FAR_COVER, TERRAIN_MACRO_OCTAVES,
  TERRAIN_FRAGMENT_FAR_LIGHT, TERRAIN_SPEC_INJECTION_POINT, TERRAIN_SPEC_INJECTION_CODE, TERRAIN_SUN_INJECTION_CODE,
} from "../../src/game/terrainTexture.js";
import { FOLIAGE_LIGHT_INJECTION_POINT } from "../../src/game/foliageLightPlugin.js";
import { timeLimit } from "../helpers/timeLimit.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// WebGL2's shader text at the branch's base (ba0fd95), one hash per text: what
// every plugin injects per stage, and the three post shaders as stored. A
// change here is a change to what every WebGL2 player compiles. Re-pinned
// 2026-10-17 for the painted look: the haze's warmth and density
// (atmosphere.fragment), the cover's sage green and floor and the long
// grass's patch hue and base in the foliage fragment, the far sward
// (terrain.fragment), and the palette's uniforms in the grade.
const PINS: Record<string, string> = {
  "atmosphere.fragment": "62c5991129522bd873adeff3c6bd4b7d5875ab17388c3736dbb94090d12b9ca0",
  "cliffTint.fragment": "34b80348c2b278087d42892dd31129fc6aac2b12c93f275293617b88e9e2bccd",
  "cliffTint.vertex": "3fcb23ae5aab79e441e6d140e71ad0c149a0702f72c48fa093fc0b9fd3076de1",
  "distanceFade.fragment": "e9fd42d78c56e2f364ac16691996386de60dd9717060cc3822bd296c9c09281f",
  "distanceFade.vertex": "3f81eacd1008ff5306bdf04629d9cf733e410af4effaf6c51b4e261bd606a526",
  // The foliage plugin's fragment re-pinned for the canopy's share of the sky
  // (foliageSky.fragment.fx), the cards' contrast toward the cover's green
  // and the albedo floor (foliage.fragment.fx, foliageLights.fragment.fx).
  // The nurse log's fern wears the plugin under a profile of its own
  // (`foliage.NURSE.*`), with every other profile's text.
  // Re-pinned 2026-10-27 for the cover matched to the ground
  // (`FOLIAGE_MATCH`, foliagePlugin.ts): the matched block in the foliage
  // fragment, the define on every profile's interface, and the floor's
  // guard in the light plugin's injection.
  "foliage.BLADES.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.BLADES.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.BUSH.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.BUSH.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.DUFF.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.DUFF.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.FLOWER.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.FLOWER.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.GRASS.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.GRASS.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.MEADOW.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.MEADOW.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.NURSE.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.NURSE.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.REEDS.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.TREE.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.REEDS.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.TREE.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  "foliage.UNDERSTORY.fragment": "5aa823a5dd82391bbb5c1c44603dd46060438610de1d167c7f603232aa79f3c2",
  "foliage.UNDERSTORY.vertex": "1f71ad1ad3d7e4a14f2a4c1be37fdaccb5479d92b80a736723eb2ac52c338e96",
  // Re-pinned for the `#ifdef FOLIAGE` guard on the injected per-light call
  // (foliageLightPlugin.ts): compiled with FOLIAGE, the guard resolves to the
  // call it always made; without it — a late reprocess of an effect compiled
  // before the plugins attached — to Babylon's own line. Re-pinned again for
  // the call keyed on the light's directional define (`DIRLIGHT$2`) rather
  // than its index: it compiles into the sun's line alone, whatever order the
  // lights were made in, and the function lost its index parameter.
  // Re-pinned for the canopy's share of the sun, read from the
  // `foliageCanopySun` uniform, and the half-Lambert wrap
  // (foliageDiffuse.fragment.fx), and the cast shadow held at three quarters
  // on foliage (`FOLIAGE_SHADOW_INJECTION_POINT`).
  "foliageLight.fragment": "a536529fe6639528fab76610137faee444d99f8fd08e5895271a99066d70ec2c",
  "groundConform.vertex": "a9f54562519ab094b2883463cec48050737f16a4f17e4a18852cfb414e227cea",
  // The trunks' moss (mossPlugin.ts, moss*.fx), pinned at its first text:
  // the varying and the hash, the mask and the albedo, and the roughness
  // written into the reflectivity block's output before Babylon's own line.
  // The fragment re-pinned for its block keyed on the albedo it samples at
  // (`MOSS` and `ALBEDO` both), so a trunk without a map compiles without it.
  "impostorBake.fragment": "223ebdbbd9e79f5fcc071441e651566fc95bb551eadd9248d099e3a37f281e24",
  "moss.fragment": "d9add135f40f3b235b0d009a880005ffbf8fae937333dd439ac92262dc22d138",
  "moss.vertex": "c27e94af368ce3ae552266d9c14d9ae34bada23df9a3150d7c9018e101e68816",
  // The dead trees' dressing (deadwoodPlugin.ts, deadwood*.fx), pinned at its
  // first text: the bark's coordinates laid along the trunk and round it over
  // the material's own, the moss by the role and the contact band.
  "deadwood.fragment": "012e902e87f6870e8c9d8a7b0ec99102277d6faec927d9db3aa548cd934681cf",
  "deadwood.vertex": "ed84af0f7f03c0c16fcb52292e468a318e043231ac2162ec80b5fcc9ad5d51fe",
  "post.grade": "db0f4203e05446ed0f2cc5d1f837bbf9e0909c88891ff7688807e2c6a0bb0f97",
  "post.halationExtract": "1ee9b9ed30d66fd1e10e4a327104c3e9016a91a2b4ed6aa2cec64cb09df5d3fd",
  "skin.fragment": "111388dbf745542db596dae9ac3c41d726c7c0c61aeb4c8e87cc16e9e8c07fdf",
  // Re-pinned for the WGSL-reserved local `macro` renamed `macroRgb`. The
  // puddles' ripples under rain (trailPaint.ts) are stripped before hashing
  // (`withoutRipples`), and the test below shows the rename and the ripples
  // are the whole difference from the base. Re-pinned again for the shore
  // tint's one added line in `featurePaint.ts`, which begins it at the lake's
  // rim (the bed under the water paints itself); the foliage plugin for reeds
  // is the tree's text and interface.
  // Re-pinned for the far ground's cover (terrainTexture.ts,
  // groundFarCover.fragment.fx, the road's and the trail's paint weights); the
  // test below shows it is the whole difference.
  // Re-pinned for the lakes' shore atlas (featurePaint.ts: the feature table
  // read texel by texel, its eight entries, the atlas's read and the shore
  // tint by it; the wet line's footprint by the shore on the terrain,
  // wetLights.fragment.fx), which stays in the texts the tests below take
  // their pieces out of.
  // Re-pinned for the far ground's olive sward and its metre-scale clumps
  // (groundFarCover.fragment.fx: its constants and its comments); the test
  // below takes the far cover out and finds the text before it unchanged, so
  // the far cover is the whole difference.
  // Re-pinned for the trail's two tables read from one texture (trailPaint.ts:
  // `trailTable`, 512 × 18, the segment list on rows 0 and 1 and the bucket
  // grid from row 2, one sampler where there were two); its three reads and
  // the declaration are the difference, and they stay in the texts the tests
  // below take their pieces out of.
  "terrain.fragment": "b00471ab26ef4dcdc16f7c5cef8b1c1a2e320386244f1ccee299c5529de10b28",
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
  "distanceFade.interface": "a3cd043ba841b5ae90f0bed3e03d89476d4dc0642265659becf46c113fdc0953",
  // Re-pinned for the foliage plugin's two floats, `foliageCanopySun` and
  // `foliageContrast`, declared on both uniform paths. `foliage.NURSE`, the
  // nurse log's fern's profile, has the tree's and the reeds' interface.
  "foliage.BLADES.interface": "25ff7db306766f50e6873f0becc72c3d371faa4d81022aa88d2503e8e4a983bd",
  "foliage.BUSH.interface": "a04fef458dcb17073b0668295044332784cbb59bc213ad2d8ac0415de554a8c0",
  "foliage.DUFF.interface": "6df1a0d767d73acc0663b22d2cdbf21b1579926475090159e09b122ed65c6934",
  "foliage.FLOWER.interface": "a04fef458dcb17073b0668295044332784cbb59bc213ad2d8ac0415de554a8c0",
  "foliage.GRASS.interface": "9f66e0058d5b2bcbd1cf7caa250d2e6bf0cd16c5f48331c6b4db2c6de1e1107c",
  "foliage.MEADOW.interface": "9f66e0058d5b2bcbd1cf7caa250d2e6bf0cd16c5f48331c6b4db2c6de1e1107c",
  "foliage.NURSE.interface": "9f81764746444eac5d750aa413992938892b586cd7c9aaa2e2b1d7f5ea279b34",
  "foliage.REEDS.interface": "9f81764746444eac5d750aa413992938892b586cd7c9aaa2e2b1d7f5ea279b34",
  "foliage.TREE.interface": "9f81764746444eac5d750aa413992938892b586cd7c9aaa2e2b1d7f5ea279b34",
  "foliage.UNDERSTORY.interface": "a04fef458dcb17073b0668295044332784cbb59bc213ad2d8ac0415de554a8c0",
  "foliageLight.interface": "a86a666d70d9ecddd600f74e67b8028f7795551c775a05e786e4ee73bea725e8",
  "groundConform.interface": "d1318897a8b44958dc6d4ba703fe861a79590ee61c6d7cb830bc54cb33e7b75a",
  // The trunks' moss: one sampler, no uniform, one define, no attribute.
  "impostorBake.interface": "c31f8eb93689db015c895c45cd18282c3bdd7a5dc7107f1483d6c99a4b9bc1d7",
  "moss.interface": "1d4bc4eabead2dd9a9ff3444a09e3be683f72b7e15a000f5e4fd37c6019f7bd3",
  // The dead trees' dressing: the moss sampler, two uniforms, one define, the role attribute.
  "deadwood.interface": "3bf55f85ee3071a28520a18057b042165a6879d1b1d4be70899c746f226ece7c",
  "skin.interface": "d39b98bf284499c66f8b2765d9947ff326b97a8a716bcb4f2c89cf5b9c1bc2de",
  // Re-pinned for `terrainRain` and `terrainTime`, the two floats the
  // puddles' ripples read, declared on both uniform paths, and again for
  // TERRAINFARLOW, the far cover's low band, false on medium and high.
  // Re-pinned for the trail's one sampler, `trailTable`, where `trailSegs`
  // and `trailIndex` were (trailPaint.ts, terrainTexture.ts).
  "terrain.interface": "e03d08f797f76a0ed886258abaf8b55ecf8c8b3415f08fad5c398d14cbfb2cb4",
  // Re-pinned for INSTANCESCOLOR, which the wing plugin now sets on every
  // preparation from whether the draw is instanced (wingPlugin.ts): the text
  // it injects is unchanged.
  "wing.interface": "6b8c288e7f4baa2375ce52816f90791d14ad2c1405e1a1c44d87fc9eb1f37e42",
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
    [TERRAIN_FRAGMENT_FAR_LIGHT, ""],
    [`${TERRAIN_SPEC_INJECTION_POINT}\n${TERRAIN_SPEC_INJECTION_CODE}\n`, ""],
    [`${FOLIAGE_LIGHT_INJECTION_POINT}\n${TERRAIN_SUN_INJECTION_CODE}\n`, ""],
    ["    terrainPaintW = max(terrainPaintW, rGravel);\n", ""],
    ["    terrainPaintW = max(terrainPaintW, max(tBank, tOnBench));\n", ""],
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
      expect(sha(key === "terrain.fragment" ? withoutRipples(text) : text), key).toBe(PINS[key]);
    }
  });

  it("changes the terrain fragment by one renamed identifier, the puddles' ripples, the shore atlas and the trail's one table, and nothing else", () => {
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
    // The trail's one table: the sampler declared once, read three times at
    // texel centres, and the two it replaced gone.
    expect(text.match(/uniform sampler2D trailTable;/g)).toHaveLength(1);
    expect(text.match(/texture2D\(trailTable, /g)).toHaveLength(3);
    expect(text).not.toMatch(/trailSegs|trailIndex/);
    // With the ripples taken out and the rename undone, the base's text, the
    // shore tint's one line, the lakes' shore atlas (2026-10-10), the
    // trail's one table (2026-10-14) and the far roughness ramp (2026-10-15).
    const base = withoutFarCover(withoutRipples(text)).replaceAll("macroRgb", "macro");
    expect(base).not.toContain("tRipple");
    expect(sha(base)).toBe("62726619d20723f0b3f76cad50ae68943a87c74965fe973e156754d8cce726a1");
  });

  it("takes the far cover out and gets the text before it", () => {
    const text = pluginTexts()["terrain.fragment"] as string;
    // With the lakes' shore atlas (2026-10-10), the trail's one table
    // (2026-10-14) and the far roughness ramp (2026-10-15) in it.
    expect(sha(withoutFarCover(withoutRipples(text)))).toBe("9276a32ad797f7b5fe4361d3281ce51316a225887779afd8492c8730d7bf06e1");
  }, timeLimit(20_000));

  it("keeps every plugin's uniforms, samplers, attributes and defines what they were", () => {
    const texts = pluginInterfaces();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(INTERFACE_PINS).sort());
    for (const [key, text] of Object.entries(texts)) expect(sha(text), key).toBe(INTERFACE_PINS[key]);
  });

  it("changes the terrain's interface by the far cover's one define and the trail's one sampler, and nothing else", () => {
    const text = pluginInterfaces()["terrain.interface"] as string;
    expect(text.split('"TERRAINFARLOW":false,').length - 1).toBe(2);
    // The trail's sampler list: `trailTable` where `trailSegs` and `trailIndex` were.
    expect(text).toContain("trailTable");
    expect(text).not.toMatch(/trailSegs|trailIndex/);
    expect(sha(text.replaceAll('"TERRAINFARLOW":false,', ""))).toBe(
      "01ca60e01032fa2d77bece34b788d571a44381fc5fd50708ca3a6f6fd2ab95f7",
    );
  }, timeLimit(20_000));

  it("pins the hex include and the finish pass as files", () => {
    // The hex include is three files, joined on WebGL2 into the one it was.
    expect(sha(groundHexHead + groundHexFetch + groundHexNoise)).toBe(
      "21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb",
    );
  });
});
