import { describe, expect, it } from "vitest";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions.js";
import { DISPLAY_CURVE_WGSL } from "../../../src/game/lite/displayCurve.js";
import { inOrder, tight } from "./wgslText.js";

const BABYLON = tight(ShaderStore.IncludesShadersStore["imageProcessingFunctions"] as string);
const WGSL = tight(DISPLAY_CURVE_WGSL);

describe("the material colour path in WGSL", () => {
  it("is Khronos PBR Neutral as Babylon's image processing has it, statement for statement", () => {
    expect(BABYLON).toContain("constfloatPBRNeutralStartCompression=0.8-0.04;constfloatPBRNeutralDesaturation=0.15;");
    for (const [glsl, wgsl] of [
      ["floatx=min(color.r,min(color.g,color.b));", "letx=min(input.r,min(input.g,input.b));"],
      ["floatoffset=x<0.08?x-6.25*x*x:0.04;", "letoffset=select(0.04,x-6.25*x*x,x<0.08);"],
      ["color-=offset;", "letcolor=input-offset;"],
      ["floatpeak=max(color.r,max(color.g,color.b));", "letpeak=max(color.r,max(color.g,color.b));"],
      ["if(peak<PBRNeutralStartCompression)returncolor;", "returnselect(compressed,color,peak<0.76);"],
      ["floatd=1.-PBRNeutralStartCompression;", "letd=1.0-0.76;"],
      ["floatnewPeak=1.-d*d/(peak+d-PBRNeutralStartCompression);", "letnewPeak=1.0-d*d/(peak+d-0.76);"],
      ["floatg=1.-1./(PBRNeutralDesaturation*(peak-newPeak)+1.);", "letg=1.0-1.0/(0.15*(peak-newPeak)+1.0);"],
      ["color*=newPeak/peak;", "color*(newPeak/max(peak,1.0e-6))"],
      ["returnmix(color,newPeak*vec3(1,1,1),g);", "vec3<f32>(newPeak),g);"],
    ] as const) {
      expect(BABYLON, glsl).toContain(glsl);
      expect(WGSL, wgsl).toContain(wgsl);
    }
  });

  it("takes a linear colour to the display in Babylon's order: the exposure, the tone map, the encode, the clamp, the contrast", () => {
    expect(inOrder(BABYLON, [
      "result.rgb*=exposureLinear;", "result.rgb=PBRNeutralToneMapping(result.rgb);", "result.rgb=toGammaSpace(result.rgb);result.rgb=saturate(result.rgb);",
      "vec3resultHighContrast=result.rgb*result.rgb*(3.0-2.0*result.rgb);",
      "if(contrast<1.0){result.rgb=mix(vec3(0.5,0.5,0.5),result.rgb,contrast);}else{result.rgb=mix(result.rgb,resultHighContrast,contrast-1.0);}",
      "result.rgb=max(result.rgb,0.);",
    ])).toBe(true);
    expect(inOrder(WGSL, [
      "fndisplayColour(linear:vec3<f32>,exposure:f32,contrast:f32)->vec3<f32>{", "varresult=linear*exposure;", "result=displayNeutral(result);",
      "result=pow(max(result,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));", "result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));",
      "result=displayContrastOf(result,contrast);",
    ])).toBe(true);
    expect(WGSL).toContain("lethigh=c*c*(3.0-2.0*c);");
    expect(WGSL).toContain("letshaped=select(mix(c,high,contrast-1.0),mix(vec3<f32>(0.5),c,contrast),contrast<1.0);");
    expect(WGSL).toContain("returnmax(shaped,vec3<f32>(0.0));");
  });

  it("draws no vignette, no colour curve and no dither: no material on Lite does", () => {
    expect(DISPLAY_CURVE_WGSL).not.toMatch(/vignette|curve|dither|rand/i);
  });
});
