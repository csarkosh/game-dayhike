import { describe, expect, it } from "vitest";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/default.fragment.js";
import "@babylonjs/core/Shaders/ShadersInclude/fogVertex.js";
import { FRAME_BLOCK, stageOwn, stageReads } from "../../../src/game/lite/frameBlock.js";
import { MIST_FRAME_READS, MIST_INSTANCE_BYTES, MIST_WGSL } from "../../../src/game/lite/mistMeshes.js";
import { emptyMistUniforms } from "../../../src/game/mistBanks.js";
import { inOrder, tight } from "./wgslText.js";

/** The Standard material's fragment stage and the fog it includes, as installed. */
const STANDARD = tight(ShaderStore.ShadersStore["defaultPixelShader"] as string);
const FOG_DECLARATION = tight(ShaderStore.IncludesShadersStore["fogFragmentDeclaration"] as string);
const FOG = tight(ShaderStore.IncludesShadersStore["fogFragment"] as string);
const FOG_VERTEX = tight(ShaderStore.IncludesShadersStore["fogVertex"] as string);
const VERTEX = tight(MIST_WGSL.vertex);
const FRAGMENT = tight(MIST_WGSL.fragment);

describe("the mist banks' stage on Babylon Lite", () => {
  it("fogs by Babylon's exponential-squared factor, at Babylon's constant, on the distance in the view's space", () => {
    expect(FOG_DECLARATION).toContain("#defineE2.71828");
    expect(FRAGMENT).toContain("constMIST_E:f32=2.71828;");
    expect(FOG_DECLARATION).toContain("floatfogDistance=length(vFogDistance);");
    expect(FOG_DECLARATION).toContain("{fogCoeff=1.0/pow(E,fogDistance*fogDistance*fogDensity*fogDensity);}returnclamp(fogCoeff,0.0,1.0);}");
    expect(inOrder(FRAGMENT, [
      "letfogDistance=length(vFogDistance);", "letfogCoeff=1.0/pow(MIST_E,fogDistance*fogDistance*fogDensity*fogDensity);", "returnclamp(fogCoeff,0.0,1.0);",
    ])).toBe(true);
    expect(FOG_VERTEX).toContain("vFogDistance=(view*worldPos).xyz;");
    expect(VERTEX).toContain("out.fogDistance=(scene.view*worldPos).xyz;");
  });

  it("composes the colour in the Standard material's order: the opacity, the emissive, the fog, to linear, the display curve, the visibility", () => {
    expect(inOrder(STANDARD, [
      "vec4opacityMap=TEXRD(opacitySampler,vOpacityUV+uvOffset);", "alpha*=opacityMap.a*vOpacityInfos.y;", "vec3emissiveColor=vEmissiveColor;",
      "vec3finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;",
      "vec4color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);", "color.rgb=max(color.rgb,0.);",
      "#include<fogFragment>", "color.rgb=toLinearSpace(color.rgb);color=applyImageProcessing(color);", "color.a*=visibility;",
    ])).toBe(true);
    expect(FOG).toContain("floatfog=CalcFogFactor();");
    expect(FOG).toContain("color.rgb=mix(vFogColor,color.rgb,fog);");
    // No light, no diffuse and no ambient colour, a white base: the emissive alone, clamped as the sum is.
    expect(inOrder(FRAGMENT, [
      "letopacityMap=textureSample(mistSprite,mistSpriteSampler,input.uv);", "alpha*=opacityMap.a;", "letemissiveColor=u.mistEmissive;",
      "letfinalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));", "varcolor=vec4<f32>(finalDiffuse,alpha);",
      "color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);", "letfog=mistFogFactor(input.fogDistance,u.mistFogDensity);",
      "color=vec4<f32>(mix(u.mistFogColour,color.rgb,fog),color.a);", "color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);",
      "color=vec4<f32>(displayColour(color.rgb,u.mistExposure,u.mistContrast),color.a);", "color.a*=input.visibility;", "returncolor;",
    ])).toBe(true);
    // One read of the sprite, at the level the quad's size on the screen picks.
    expect(MIST_WGSL.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSample("]);
  });

  it("reads every uniform the banks are drawn with, and no other", () => {
    const read = new Set([...MIST_WGSL.fragment.matchAll(/\bu\.(mist\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(emptyMistUniforms()).sort());
    expect(MIST_WGSL.vertex).not.toMatch(/shaderUniforms/);
  });

  it("is made reading the scene's fog and the display curve from the frame's block, the banks' colour alone its own", () => {
    const made = tight(stageReads(MIST_WGSL.fragment, MIST_FRAME_READS));
    expect([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1])).toEqual(["mistEmissive"]);
    expect(Object.keys(stageOwn(emptyMistUniforms(), MIST_FRAME_READS))).toEqual(["mistEmissive"]);
    expect(made).toContain(`letfog=mistFogFactor(input.fogDistance,${FRAME_BLOCK}.atmBaseDensity);`);
    expect(made).toContain(`color=vec4<f32>(mix(${FRAME_BLOCK}.atmFarColour,color.rgb,fog),color.a);`);
    expect(made).toContain(`color=vec4<f32>(displayColour(color.rgb,${FRAME_BLOCK}.frameExposure,${FRAME_BLOCK}.frameContrast),color.a);`);
    expect(stageReads(MIST_WGSL.vertex, MIST_FRAME_READS)).toBe(MIST_WGSL.vertex);
  });

  it("stands a corner through its instance's matrix, whose last float is the bank's visibility and not the matrix's", () => {
    expect(VERTEX).toContain("letworld=mat4x4<f32>(input.world0,input.world1,input.world2,vec4<f32>(input.world3.xyz,1.0));");
    expect(VERTEX).toContain("letworldPos=world*vec4<f32>(input.position,1.0);");
    expect(VERTEX).toContain("out.position=scene.viewProjection*worldPos;");
    // The view is the scene's own: no copy of it is the banks'.
    expect(`${MIST_WGSL.vertex}${MIST_WGSL.fragment}`).not.toMatch(/shaderSystem/);
    expect(VERTEX).toContain("out.visibility=input.world3.w;");
    expect(VERTEX).toContain("out.uv=input.uv;");
    expect(MIST_INSTANCE_BYTES).toBe(64);
  });
});
