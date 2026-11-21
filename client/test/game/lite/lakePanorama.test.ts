import type { PluginUniformBlock } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { FRAME_BLOCK, inFrameBlock } from "@csarkosh/engine/game/lite/frameBlock";
import { PANORAMA_FORMAT, PANORAMA_GROUND_WGSL, panoramaGroundPlugin } from "@csarkosh/engine/game/lite/lakePanorama";
import { REFLECTED_RINGS } from "@csarkosh/engine/game/lite/terrainMeshes";
import { TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT } from "@csarkosh/engine/game/lite/terrainPlugins";
import { MIRROR_CANOPY_SHADE } from "@csarkosh/engine/game/mirrorGround";
import { laidOut, readUniform } from "./pluginFixture.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { inOrder, tight } from "./wgslText.js";
import { sourceText } from "../../helpers/source.js";

/** A stage of the game's GLSL on Babylon.js, whole, as recorded from its `.fx` file. */
const fx = (name: string): string => babylonText(`stages/${name.replace(/\.fx$/, ".glsl")}`);
const src = (name: string): string => sourceText(`game/${name}`);
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
    expect(babylonText("stages/lakePanorama.target.txt")).toContain("type: Constants.TEXTURETYPE_HALF_FLOAT,");
    expect(REFLECTED_RINGS).toBe(5);
    expect(babylonText("stages/renderer.reflectedRings.txt")).toContain("for (const mesh of clipmap?.meshes.slice(0, 5) ?? []) {\n    lakeMirror?.register(mesh, mirrorTerrain);\n    lakePanorama?.register(mesh, mirrorTerrain);");
  });

  it("draws a sector only on a frame that reads the picture, straight into the sector's column, which the pass clears alone", () => {
    const text = src("lite/lakePanorama.ts");
    expect(text).toContain("if (sky === null || !read) return false;");
    // The column is the camera's viewport, as the capture recorded on Babylon.js has it.
    expect(text).toContain("camera.viewport = { x: (held * PANORAMA_SECTOR_WIDTH) / PANORAMA_WIDTH, y: 0, width: PANORAMA_SECTOR_WIDTH / PANORAMA_WIDTH, height: 1 };");
    expect(tight(babylonText("stages/lakePanorama.viewport.txt"))).toContain("camera.viewport.x=sector/PANORAMA_SECTORS;");
    // A texel is drawn or not: Babylon.js writes an alpha of 1 for a material cut out by its alpha, where Lite hands
    // on the alpha it was cut at, so the pass ends by writing an alpha of 1 wherever it drew.
    expect(tight(fx("lakeMirror.fragment.fx"))).toContain("returnmix(fallback,shore.rgb,hit.z*below*shore.a);");
    expect(text).toContain("clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, autoMirror: false, clearViewport: true, alphaWhereDrawn: true,");
    // Another lake's shore is emptied whole by the first sector of the new one's; every other sector clears its column alone.
    expect(text).toContain("config.clearViewport = !clearDue;");
    // No pass of the hike's own copies a sector, and none is made for it.
    expect(text).not.toContain("createCustomTask");
    expect(text).not.toContain("beginRenderPass");
    // The pass is the scene's only for the frame that draws a sector.
    expect(text).toContain("task.enabled = false;");
    expect(src("lite/renderer.ts")).toContain("standing.panorama?.frameDrawn();");
  });

  it("draws a lake's plants by its own word, whatever the frame's view holds of them: a sector's frame shows none for it", () => {
    // The pass's word on a mesh outranks the mesh's own, which the view sets.
    expect(src("lite/lakePanorama.ts")).toContain("      if (always === true) setTaskMeshVisible(task, mesh, true);");
    const renderer = src("lite/renderer.ts");
    expect(renderer).toContain("for (const mesh of waterPlants.meshes) (mirror ?? panorama)?.own.add(mesh, true);");
    // The frame's own pass shows each kind by the view alone.
    expect(renderer).toContain("standing.waterPlants?.seen(planes);");
    const plants = src("lite/waterPlantMeshes.ts");
    expect(plants).toContain("    seen(planes) {");
    expect(plants).toContain("        let now = false;");
  });
});
