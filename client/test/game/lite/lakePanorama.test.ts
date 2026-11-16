import type { PluginUniformBlock } from "@babylonjs/lite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRAME_BLOCK, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import { PANORAMA_COLUMN_WGSL, PANORAMA_FORMAT, PANORAMA_GROUND_WGSL, panoramaGroundPlugin } from "../../../src/game/lite/lakePanorama.js";
import { REFLECTED_RINGS } from "../../../src/game/lite/terrainMeshes.js";
import { TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT } from "../../../src/game/lite/terrainPlugins.js";
import { MIRROR_CANOPY_SHADE } from "../../../src/game/mirrorGround.js";
import { laidOut, readUniform } from "./pluginFixture.js";
import { inOrder, tight } from "./wgslText.js";

const fx = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../src/game/shaders/${name}`, import.meta.url)), "utf8");
const src = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../src/game/${name}`, import.meta.url)), "utf8");
const SHARED = { name: FRAME_BLOCK } as unknown as PluginUniformBlock;

describe("the ground in a lake's shore panorama on Babylon Lite", () => {
  it("is the stand-in's fragment statement for statement: the flat colour under the canopy's shade, then the scene's distance fog", () => {
    const glsl = tight(fx("lakeMirrorTerrain.fragment.fx"));
    expect(inOrder(glsl, [
      "vec3colour=lakeMirrorColour*(1.0-LAKE_MIRROR_CANOPY_SHADE*vCanopy);",
      "floatfogDepth=length(vFogDistance)*vFogInfos.w;",
      "floatfog=pow(clamp(exp(-fogDepth*fogDepth),0.0,1.0),2.2);",
      "colour=mix(vFogColor,colour,fog);",
      "gl_FragColor=vec4(colour,1.0);",
    ])).toBe(true);
    // The fog's distance is the fragment's from the eye of the pass that draws it, as the stand-in's vertex stage hands it on.
    expect(tight(fx("lakeMirrorTerrain.vertex.fx"))).toContain("vFogDistance=(view*worldPos).xyz;");
    expect(tight(PANORAMA_GROUND_WGSL)).toBe(tight(`{
      var pgColour=material.lakeMirrorColour*(1.0-${MIRROR_CANOPY_SHADE.toFixed(1)}*input.vPanoramaCanopy);
      let pgDepth=length(input.worldPos-scene.vEyePosition.xyz)*${FRAME_BLOCK}.atmBaseDensity;
      let pgFog=pow(clamp(exp(-pgDepth*pgDepth),0.0,1.0),2.2);
      pgColour=mix(${FRAME_BLOCK}.atmFarColour,pgColour,pgFog);
      color=pgColour;
      alpha=1.0;
    }`));
    // The scene's fog is the frame's: its density and its colour are the air's own fields of the block.
    expect(inFrameBlock("atmBaseDensity")).toBe(true);
    expect(inFrameBlock("atmFarColour")).toBe(true);
  });

  it("writes in place of the lit colour, last in the fragment, and hands the canopy's density on from the terrain's own vertex data", () => {
    const uniforms = { lakeMirrorColour: new Float32Array([0.25, 0.5, 0.75]) };
    const plugin = panoramaGroundPlugin(uniforms, SHARED);
    expect(Object.keys(plugin.getCustomCode?.("fragment") ?? {})).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR"]);
    const canopy = TERRAIN_VERTEX_LAYOUT.find((part) => part.varying === "vTerrainW2");
    expect(canopy).toBeDefined();
    // The stand-in's vertex stage reads the canopy from the second weight set's last float.
    expect(tight(fx("lakeMirrorTerrain.vertex.fx"))).toContain("vCanopy=terrainWeights2.w;");
    expect(plugin.getCustomCode?.("vertex")).toEqual({ CUSTOM_VERTEX_MAIN_END: `out.vPanoramaCanopy=${canopy?.name}.w;` });
    expect(plugin.getVertexAttributes?.()).toEqual([
      { name: canopy?.name, type: "vec4<f32>", format: "float32x4", stride: TERRAIN_VERTEX_FLOATS * 4, offset: (canopy?.offset ?? 0) * 4 },
    ]);
    expect(plugin.getVaryings?.()).toEqual([{ name: "vPanoramaCanopy", type: "f32" }]);
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
    // Its one uniform of its own is the ground's colour, written as the record stands.
    expect((plugin.getUniforms?.().ubo ?? []).map((field) => [field.name, field.type])).toEqual([["lakeMirrorColour", "vec3<f32>"]]);
    const { data, offsets } = laidOut(plugin);
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "lakeMirrorColour", 3)).toEqual([0.25, 0.5, 0.75]);
  });

  it("holds the picture in half floats, and draws the ground's rings the game's reflections draw", () => {
    expect(PANORAMA_FORMAT).toBe("rgba16float");
    expect(src("lakePanorama.ts")).toContain("type: Constants.TEXTURETYPE_HALF_FLOAT,");
    expect(REFLECTED_RINGS).toBe(5);
    expect(src("renderer.ts")).toContain("for (const mesh of clipmap?.meshes.slice(0, 5) ?? []) {\n    lakeMirror?.register(mesh, mirrorTerrain);\n    lakePanorama?.register(mesh, mirrorTerrain);");
  });

  it("draws a sector only on a frame that reads the picture, into a target of its own that one triangle lays into the sector's column", () => {
    const text = src("lite/lakePanorama.ts");
    expect(text).toContain("if (sky === null || !read) return false;");
    expect(text).toContain("pass.setViewport(column * PANORAMA_SECTOR_WIDTH, 0, PANORAMA_SECTOR_WIDTH, PANORAMA_HEIGHT, 0, 1);");
    expect(text).toContain("pass.setScissorRect(column * PANORAMA_SECTOR_WIDTH, 0, PANORAMA_SECTOR_WIDTH, PANORAMA_HEIGHT);");
    // A texel is read whole at the column's own texel, and is drawn or not: Babylon.js writes an alpha of 1 for a
    // material cut out by its alpha, where Lite hands on the alpha it was cut at.
    const column = tight(PANORAMA_COLUMN_WGSL);
    expect(column).toContain("lettexel=textureLoad(sectorColour,vec2<i32>(input.uv*size),0);");
    expect(column).toContain("returnvec4<f32>(texel.rgb,step(1.0e-4,texel.a));");
    expect(tight(fx("lakeMirror.fragment.fx"))).toContain("returnmix(fallback,shore.rgb,hit.z*below*shore.a);");
    expect(text).toContain("clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false");
    // The pass is the scene's only for the frame that draws a sector.
    expect(text).toContain("task.enabled = false;");
    expect(src("lite/renderer.ts")).toContain("standing.panorama?.frameDrawn();");
  });
});
