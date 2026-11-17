import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { babylonText } from "../../helpers/babylonFixture.js";
import { CAR_SHADOW_BIAS, CAR_SHADOW_HALF, CAR_SHADOW_LIFT, carShadowGrid } from "../../../src/game/carShadow.js";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import { stageOwn, stageReads } from "../../../src/game/lite/frameBlock.js";
import { MIST_WGSL } from "../../../src/game/lite/mistMeshes.js";
import {
  ATLAS_ROWS, PATCH_FRAME_READS, PATCH_WGSL, TAIL_FRAME_READS, TAIL_LAMP_INDICES, TAIL_WGSL, faceGeometry, labelAtlas, labelGeometry, paintAlphaPlugin, patchGeometry, unlitBlackPlugin,
  tailLampCorners,
} from "../../../src/game/lite/sceneryPaint.js";
import { TAIL_LAMP_APART, TAIL_LAMP_BACK, TAIL_LAMP_H, TAIL_LAMP_UP, TAIL_LAMP_W } from "../../../src/game/endScene.js";
import { LABEL_TEXTURE, signPlaces } from "../../../src/game/signParts.js";
import { inOrder, tight } from "./wgslText.js";

/** The Standard material's fragment stage, as Babylon.js installs it (recorded). */
const STANDARD = tight(babylonText("shaders/defaultPixelShader.glsl"));

describe("the planks' lettering as one picture", () => {
  it("gives every name a row as tall as the game's one texture a name, down a column", () => {
    const atlas = labelAtlas(["Summit", "Trailhead", "Mirror Pond"]);
    expect([atlas.width, atlas.height]).toEqual([LABEL_TEXTURE.width, 3 * LABEL_TEXTURE.height]);
    expect([...atlas.cells]).toEqual([["Summit", { column: 0, row: 0 }], ["Trailhead", { column: 0, row: 1 }], ["Mirror Pond", { column: 0, row: 2 }]]);
    // A row's own smaller levels are a single texture's down to the level where it is three texels tall:
    // a row starts on a texel of every level until then.
    for (let level = 0; LABEL_TEXTURE.height >> level >= 3; level++) expect(LABEL_TEXTURE.height % (1 << level)).toBe(0);
  });

  it("starts a new column where one is full, and stays a texture every device takes", () => {
    const names = Array.from({ length: ATLAS_ROWS + 5 }, (_, i) => `Pond ${i}`);
    const atlas = labelAtlas(names);
    expect([atlas.width, atlas.height]).toEqual([2 * LABEL_TEXTURE.width, ATLAS_ROWS * LABEL_TEXTURE.height]);
    expect(atlas.cells.get(`Pond ${ATLAS_ROWS}`)).toEqual({ column: 1, row: 0 });
    expect(atlas.height).toBeLessThanOrEqual(8192);
    expect(labelAtlas([]).height).toBe(LABEL_TEXTURE.height);
  });

  it("shows each face its own name's row, read from the side its normal points to", () => {
    const places = signPlaces([{ x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Summit", "Mirror Pond"], ranks: [0, 1] }] }], () => 0, 0.05);
    const atlas = labelAtlas(places.names);
    const geometry = labelGeometry(places.labels, atlas);
    expect(geometry.positions).toHaveLength(4 * 12);
    expect([...geometry.indices.subarray(0, 12)]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    // The first plank's two faces show the first row: its bottom corners at the row's foot, its top at the picture's.
    for (const face of [0, 1]) {
      expect([...geometry.uvs.subarray(face * 8, face * 8 + 8)]).toEqual([0, 0.5, 1, 0.5, 1, 0, 0, 0]);
    }
    for (const face of [2, 3]) {
      expect([...geometry.uvs.subarray(face * 8, face * 8 + 8)]).toEqual([0, 1, 1, 1, 1, 0.5, 0, 0.5]);
    }
    // A face's triangles turn about its normal as Babylon.js's own plane's do: the corners run from the bottom
    // left to the bottom right to the top, seen from the front, in a left-handed world.
    for (let f = 0; f < 4; f++) {
      const p = (c: number): number[] => [...geometry.positions.subarray(f * 12 + c * 3, f * 12 + c * 3 + 3)];
      const [a, b, c] = [p(0), p(1), p(2)] as [number[], number[], number[]];
      const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
      const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
      const cross = [(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number), (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number), (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number)];
      const n = [...geometry.normals.subarray(f * 12, f * 12 + 3)];
      const along = (cross[0] as number) * (n[0] as number) + (cross[1] as number) * (n[1] as number) + (cross[2] as number) * (n[2] as number);
      expect(along).toBeLessThan(0);
    }
    expect(() => labelGeometry(places.labels, labelAtlas(["Summit"]))).toThrow(/Mirror Pond/);
  });

  it("lays a whole picture over a face that shows all of it", () => {
    const corners = new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]);
    const geometry = faceGeometry([{ corners, normal: { x: 0, y: 0, z: -1 }, rect: { u: 0, v: 0, width: 1, height: 1 } }]);
    expect([...geometry.uvs]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect([...geometry.positions]).toEqual([...corners]);
  });
});

describe("a painted material on Babylon Lite", () => {
  it("is blended by its paint's alpha alone: the fragment returned at the last point, after the air's grade", () => {
    const plugin = paintAlphaPlugin();
    expect(plugin.getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "return vec4<f32>(color,alpha*material.materialAlpha);" });
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
    expect(plugin.priority).toBeGreaterThan(ATMOSPHERE_PRIORITY);
  });
});

describe("the patch under a staged scene's own car on Babylon Lite", () => {
  it("is black whatever lights it, put out just before the air is laid over it, and blended by its paint's alpha after", () => {
    const black = unlitBlackPlugin();
    expect(black.getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "color=vec3<f32>(0.0);" });
    expect(black.getCustomCode?.("vertex")).toBeNull();
    // The air's fog and the tier's curve follow it at the same point; the paint's alpha is taken after both.
    expect(black.priority).toBeLessThan(ATMOSPHERE_PRIORITY);
    expect(paintAlphaPlugin().priority).toBeGreaterThan(ATMOSPHERE_PRIORITY);
    // The material is the game's there: unlit and black under the air, where the hike's patch is the Standard material under the scene's own fog.
    const source = readFileSync(new URL("../../../src/game/lite/sceneryPaint.ts", import.meta.url), "utf8");
    expect(source).toContain("baseColorTexture: picture, baseColorFactor: [0, 0, 0, darkness], metallicFactor: 0, roughnessFactor: 1, doubleSided: true, alphaBlend: true,");
    expect(source).toContain("material.plugins = [unlitBlackPlugin(), air(), ahead, paintAlphaPlugin()];");
    // The patch's material as the trailhead's shell on Babylon.js made it, its lines recorded.
    const shell = babylonText("stages/carShadowPatch.material.txt");
    expect(shell).toContain("pbr.unlit = true;");
    expect(shell).toContain("pbr.albedoColor = new Color3(0, 0, 0);");
    expect(shell).toContain("material.alpha = darkness;");
    expect(shell).toContain("material.backFaceCulling = false;");
  });
});

describe("the patch under the car on Babylon Lite", () => {
  it("is the stage the mist banks are drawn by, with no colour of its own, its darkness the material's alpha, and no visibility", () => {
    // The game draws the patch by the shader it draws the banks by (`carShadow.ts`): the same holds here, name for name.
    const banks = MIST_WGSL.fragment
      .replace("@location(1)fogDistance:vec3<f32>,@location(2)visibility:f32}", "@location(1)fogDistance:vec3<f32>}")
      .replace("var alpha=1.0;", "var alpha=u.patchDark;")
      .replace("let emissiveColor=u.mistEmissive;", "let emissiveColor=vec3<f32>(0.0);")
      .replace("  color.a*=input.visibility;\n", "")
      .replace(/mistSprite/g, "patchMap").replace(/MIST_E/g, "PATCH_E").replace(/MistOut/g, "PatchOut").replace(/\bmist(\w)/g, "patch$1");
    expect(tight(PATCH_WGSL.fragment).replace(/\/\*\*?[^]*?\*\//g, "")).toBe(tight(banks).replace(/\/\*\*?[^]*?\*\//g, ""));
    // The Standard material's alpha starts at the material's own and takes the opacity map's.
    expect(inOrder(STANDARD, ["floatalpha=vDiffuseColor.a;", "alpha*=opacityMap.a*vOpacityInfos.y;"])).toBe(true);
    expect(inOrder(tight(PATCH_WGSL.fragment), ["varalpha=u.patchDark;", "alpha*=opacityMap.a;"])).toBe(true);
  });

  it("is set ahead of the ground by the game's bias, in a 24-bit depth buffer's steps toward the eye", () => {
    expect(CAR_SHADOW_BIAS).toBeLessThan(0);
    expect(tight(PATCH_WGSL.vertex)).toContain(`out.position.z+=${(-CAR_SHADOW_BIAS / 2 ** 24).toExponential(6)}*out.position.w;`);
    // Its corners are already in the world's coordinates: no matrix of the mesh's is read.
    expect(PATCH_WGSL.vertex).not.toMatch(/input\.world|shaderSystem|shaderUniforms/);
    expect(tight(PATCH_WGSL.vertex)).toContain("letworldPos=vec4<f32>(input.position,1.0);");
  });

  it("reads the scene's fog and the display curve from the frame's block, its darkness alone its own", () => {
    const made = tight(stageReads(PATCH_WGSL.fragment, PATCH_FRAME_READS));
    expect([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1])).toEqual(["patchDark"]);
    expect(Object.keys(stageOwn({ patchDark: [1], patchFogColour: [0, 0, 0], patchFogDensity: [0], patchExposure: [1], patchContrast: [1] }, PATCH_FRAME_READS))).toEqual(["patchDark"]);
  });

  it("stands the grid in the world as its mesh's place and scale stand it on Babylon.js", () => {
    const groundH = (x: number, z: number): number => 5 + 0.1 * x - 0.05 * z;
    const grid = carShadowGrid({ x: 10, z: 20 }, groundH);
    const geometry = patchGeometry(grid);
    for (let i = 0; i < geometry.positions.length; i += 3) {
      const x = geometry.positions[i] as number, y = geometry.positions[i + 1] as number, z = geometry.positions[i + 2] as number;
      expect(Math.abs(x - 10)).toBeLessThanOrEqual(CAR_SHADOW_HALF.x + 1e-5);
      expect(Math.abs(z - 20)).toBeLessThanOrEqual(CAR_SHADOW_HALF.z + 1e-5);
      // Every corner on the ground under it, the lift above.
      expect(y).toBeCloseTo(groundH(x, z) + CAR_SHADOW_LIFT, 4);
    }
    expect(geometry.uvs).toBe(grid.uvs);
    expect([...geometry.indices]).toEqual([...grid.indices]);
  });

  it("turns a patch that lies flat under a car with the car, about its own middle", () => {
    const flat = carShadowGrid({ x: 0, z: 0 }, () => 0);
    const turned = patchGeometry({ ...flat, origin: { x: 10, y: 3, z: 20 } }, Math.PI / 2);
    const straight = patchGeometry({ ...flat, origin: { x: 10, y: 3, z: 20 } });
    for (let i = 0; i < turned.positions.length; i += 3) {
      // A quarter turn about the vertical carries +z to +x, as the sim's yaw does.
      expect((turned.positions[i] as number) - 10).toBeCloseTo((straight.positions[i + 2] as number) - 20, 4);
      expect((turned.positions[i + 2] as number) - 20).toBeCloseTo(-((straight.positions[i] as number) - 10), 4);
      expect(turned.positions[i + 1]).toBeCloseTo(3 + CAR_SHADOW_LIFT, 5);
    }
  });
});

describe("the film's car's tail lamps on Babylon Lite", () => {
  it("are the patch's stage with the lamp's colour given off, no texture, no fog and nothing blended", () => {
    // The game sets the Standard material the same way for both, but for the lamps' colour and their fog turned off.
    const patch = PATCH_WGSL.fragment
      .replace(",@location(0)uv:vec2<f32>,@location(1)fogDistance:vec3<f32>}", "}")
      .replace(/const PATCH_E[^]*?\n}\n/, "")
      .replace("var alpha=u.patchDark;", "let alpha=1.0;")
      .replace("  let opacityMap=textureSample(patchMap,patchMapSampler,input.uv);\n  alpha*=opacityMap.a;\n", "")
      .replace("let emissiveColor=vec3<f32>(0.0);", "let emissiveColor=u.tailColour;")
      .replace("  let fog=patchFogFactor(input.fogDistance,u.patchFogDensity);\n  color=vec4<f32>(mix(u.patchFogColour,color.rgb,fog),color.a);\n", "")
      .replace(/PatchOut/g, "TailOut").replace(/\bpatch(\w)/g, "tail$1");
    expect(tight(TAIL_WGSL.fragment).replace(/\/\*\*?[^]*?\*\//g, "")).toBe(tight(patch).replace(/\/\*\*?[^]*?\*\//g, ""));
    // Its corners are in the world's coordinates, and its colour is taken to linear and down the tier's colour path as the patch's is.
    expect(tight(TAIL_WGSL.vertex)).toContain("out.position=scene.viewProjection*worldPos;");
    expect(TAIL_WGSL.vertex).not.toMatch(/input\.world|shaderSystem|shaderUniforms/);
    expect(inOrder(tight(TAIL_WGSL.fragment), ["letemissiveColor=u.tailColour;", "pow(color.rgb,vec3<f32>(2.2))", "displayColour(color.rgb,u.tailExposure,u.tailContrast)"])).toBe(true);
    expect(TAIL_WGSL.fragment).not.toMatch(/fog/i);
  });

  it("read the display curve from the frame's block, their colour alone their own", () => {
    const made = tight(stageReads(TAIL_WGSL.fragment, TAIL_FRAME_READS));
    expect([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1])).toEqual(["tailColour"]);
    expect(Object.keys(stageOwn({ tailColour: [0, 0, 0], tailExposure: [1], tailContrast: [1] }, TAIL_FRAME_READS))).toEqual(["tailColour"]);
  });

  it("stand at the car's rear corners, turned with it, and in its middle through their first frames", () => {
    const at = tailLampCorners(10, 3, 20, 0, new Float32Array(24));
    // Nose to +z: the lamps are behind the middle, either side of it, a quad each.
    const xs = [...at].filter((_, i) => i % 3 === 0), ys = [...at].filter((_, i) => i % 3 === 1), zs = [...at].filter((_, i) => i % 3 === 2);
    for (const z of zs) expect(z).toBeCloseTo(20 - TAIL_LAMP_BACK, 5);
    expect(Math.min(...xs)).toBeCloseTo(10 - TAIL_LAMP_APART / 2 - TAIL_LAMP_W / 2, 5);
    expect(Math.max(...xs)).toBeCloseTo(10 + TAIL_LAMP_APART / 2 + TAIL_LAMP_W / 2, 5);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([expect.closeTo(3 + TAIL_LAMP_UP - TAIL_LAMP_H / 2, 5), expect.closeTo(3 + TAIL_LAMP_UP + TAIL_LAMP_H / 2, 5)]);
    // Turned a quarter (nose to +x), its rear is toward -x.
    const turned = tailLampCorners(10, 3, 20, Math.PI / 2, new Float32Array(24));
    for (let i = 0; i < 24; i += 3) expect(turned[i]).toBeCloseTo(10 - TAIL_LAMP_BACK, 5);
    // Hidden in the car's middle until they are lit.
    const inside = tailLampCorners(10, 3, 20, 0, new Float32Array(24), 0);
    for (let i = 2; i < 24; i += 3) expect(inside[i]).toBeCloseTo(20, 5);
    expect([...TAIL_LAMP_INDICES]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  });
});
