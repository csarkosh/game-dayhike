import { describe, expect, it } from "vitest";
import { WING_GLSL } from "../../../src/game/wingPlugin.js";
import { WING_AMP_AT, WING_COLOURWAY_AT, WING_PHASE_AT, WING_WGSL, wingPlugin } from "../../../src/game/lite/wingPlugin.js";
import { FRAME_BLOCK, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import { inOrder, tight } from "./wgslText.js";
import type { PluginUniformBlock } from "@babylonjs/lite";

const SHARED = { name: FRAME_BLOCK } as unknown as PluginUniformBlock;
const WGSL = tight(WING_WGSL);
const GLSL = tight(WING_GLSL);

describe("a wing's beat on Babylon Lite", () => {
  it("is the game's stage statement for statement: the span's share, the angle, the turn of y and of x", () => {
    // Each line of the GLSL, its names as the WGSL has them: the vertex's position, the bird's own two floats.
    const lines = [
      "floatwingSide=positionUpdated.x<0.0?-1.0:1.0;",
      "floatwingAbsX=abs(positionUpdated.x);",
      "floatwingSpan=clamp(wingAbsX/wingHalfSpan,0.0,1.0);",
      "floatwingA=wing.y*sin(wingTime*wingOmega+wing.x)*wingSpan;",
      "floatwingC=cos(wingA);",
      "floatwingS=sin(wingA);",
      "floatwingY0=positionUpdated.y;",
      "positionUpdated.y=wingY0*wingC+wingAbsX*wingS;",
      "positionUpdated.x=wingSide*(wingAbsX*wingC-wingY0*wingS);",
    ];
    expect(inOrder(GLSL, lines)).toBe(true);
    expect(inOrder(WGSL, [
      "letwingSide=select(1.0,-1.0,wingPos.x<0.0);",
      "letwingAbsX=abs(wingPos.x);",
      "letwingSpan=clamp(wingAbsX/material.wingHalfSpan,0.0,1.0);",
      "letwingA=wingAmp*sin(material.wingTime*material.wingOmega+wingPhase)*wingSpan;",
      "letwingC=cos(wingA);",
      "letwingS=sin(wingA);",
      "letwingY0=wingPos.y;",
      "wingPos.y=wingY0*wingC+wingAbsX*wingS;",
      "wingPos.x=wingSide*(wingAbsX*wingC-wingY0*wingS);",
    ])).toBe(true);
  });

  it("reads the bird's phase and amplitude from its matrix's last row and places the turned vertex by the other three", () => {
    expect([WING_PHASE_AT, WING_AMP_AT, WING_COLOURWAY_AT]).toEqual([3, 7, 11]);
    expect(inOrder(WGSL, [
      "letwingPhase=finalWorld[0].w;", "letwingAmp=finalWorld[1].w;", "varwingPos=position;",
      "letwingWorld=(finalWorld*vec4<f32>(wingPos,1.0)).xyz;", "out.worldPos=wingWorld;", "out.clipPos=scene.viewProjection*vec4<f32>(wingWorld,1.0);",
    ])).toBe(true);
    // The normal is left as it is, as in the game's stage.
    expect(WGSL).not.toContain("worldNormal");
  });

  it("beats on the frame's clock, at its own rate against its own half span, a model of no width against one metre", () => {
    expect(inFrameBlock("wingTime")).toBe(true);
    const plugin = wingPlugin(0, 18.85, SHARED);
    const vertex = tight((plugin.getCustomCode?.("vertex") as Record<string, string>).CUSTOM_VERTEX_MAIN_END as string);
    expect(vertex).toContain(`${FRAME_BLOCK}.wingTime*material.wingOmega`);
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
    const fields = plugin.getUniforms?.().ubo ?? [];
    expect(fields.map((field) => field.name)).toEqual(["wingOmega", "wingHalfSpan"]);
    const data = new Float32Array(4);
    plugin.writeUbo?.(data, new Map([["wingOmega", 0], ["wingHalfSpan", 4]]));
    expect([data[0], data[1]]).toEqual([Math.fround(18.85), 1]);
  });

  it("tints a model worn in several colourways by the one its matrix names, over the shade its vertex carries", () => {
    const plugin = wingPlugin(0.045, 75.4, SHARED, [[0.8, 0.4, 0.05], [0.1, 0.3, 0.6], [0.86, 0.83, 0.72]]);
    const vertex = tight((plugin.getCustomCode?.("vertex") as Record<string, string>).CUSTOM_VERTEX_MAIN_END as string);
    expect(vertex).toContain("letwingWay=u32(clamp(finalWorld[2].w,0.0,2.0));");
    expect(vertex).toContain("out.vWingTint=wingTints[wingWay];");
    expect((plugin.getCustomCode?.("fragment") as Record<string, string>).CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe("surfaceAlbedo*=input.vWingTint*input.uv.x;");
    expect(plugin.getVaryings?.()).toEqual([{ name: "vWingTint", type: "vec3<f32>" }]);
  });
});
