import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { DISPLAY_CURVE_WGSL, DISPLAY_ENCODE_WGSL, DISPLAY_SHOWN_WGSL, GRADE_BLOCK, LINEAR_COLOUR_WGSL, MATERIAL_GRADE_WGSL, onColourPath } from "@csarkosh/engine/game/lite/displayCurve";
import { FRAME_BLOCK, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import { emptyMaterialGradeUniforms } from "../../../src/game/materialGrade.js";
import { inOrder, tight } from "./wgslText.js";

/** Babylon.js's image processing include, as it installs it (recorded). */
const BABYLON = tight(babylonText("shaders/imageProcessingFunctions.glsl"));
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

  it("keeps the curve itself free of the grade: the vignette, the colour curves and the dither are laid round it", () => {
    expect(DISPLAY_CURVE_WGSL).not.toMatch(/vignette|curve|dither|rand/i);
  });

  it("grades as Babylon's image processing does on the material path: the vignette, the colour curves and the dither, statement for statement", () => {
    const grade = tight(MATERIAL_GRADE_WGSL);
    const b = GRADE_BLOCK;
    for (const [glsl, wgsl] of [
      ["vec2viewportXY=gl_FragCoord.xy*vInverseScreenSize;viewportXY=viewportXY*2.0-1.0;", `varviewportXY=gradeAt(at)*${b}.gradeScreen.xy;viewportXY=viewportXY*2.0-1.0;`],
      ["vec3vignetteXY1=vec3(viewportXY*vignetteSettings1.xy+vignetteSettings1.zw,1.0);floatvignetteTerm=dot(vignetteXY1,vignetteXY1);floatvignette=pow(vignetteTerm,vignetteSettings2.w);", `letvignetteXY1=vec3<f32>(viewportXY*${b}.gradeVignette1.xy+${b}.gradeVignette1.zw,1.0);letvignetteTerm=dot(vignetteXY1,vignetteXY1);letvignette=pow(vignetteTerm,${b}.gradeVignette2.w);`],
      ["vec3vignetteColorMultiplier=mix(vignetteColor,vec3(1,1,1),vignette);result.rgb*=vignetteColorMultiplier;", "letvignetteColorMultiplier=mix(vignetteColor,vec3<f32>(1.0,1.0,1.0),vignette);returncolor*vignetteColorMultiplier;"],
      ["vec2curveMix=clamp(vec2(luma*3.0-1.5,luma*-3.0+1.5),vec2(0.0),vec2(1.0));", "letcurveMix=clamp(vec2<f32>(luma*3.0-1.5,luma*-3.0+1.5),vec2<f32>(0.0),vec2<f32>(1.0));"],
      ["vec4colorCurve=vCameraColorCurveNeutral+curveMix.x*vCameraColorCurvePositive-curveMix.y*vCameraColorCurveNegative;result.rgb*=colorCurve.rgb;result.rgb=mix(vec3(luma),result.rgb,colorCurve.a);", `letcolorCurve=${b}.gradeCurveNeutral+curveMix.x*${b}.gradeCurvePositive-curveMix.y*${b}.gradeCurveNegative;color*=colorCurve.rgb;color=mix(vec3<f32>(luma),color,colorCurve.a);`],
      ["floatrand=getRand(gl_FragCoord.xy*vInverseScreenSize);floatdither=mix(-ditherIntensity,ditherIntensity,rand);result.rgb=saturate(result.rgb+vec3(dither));", `letrand=gradeRand(gradeAt(at)*${b}.gradeScreen.xy);letdither=mix(-${b}.gradeScreen.z,${b}.gradeScreen.z,rand);returnclamp(color+vec3<f32>(dither),vec3<f32>(0.0),vec3<f32>(1.0));`],
    ] as const) {
      expect(BABYLON, glsl).toContain(glsl);
      expect(grade, wgsl).toContain(wgsl);
    }
    // The place is the game's: its rows counted up from the frame's foot.
    expect(grade).toContain(`fngradeAt(at:vec2<f32>)->vec2<f32>{returnvec2<f32>(at.x,1.0/${b}.gradeScreen.y-at.y);}`);
    // Babylon's luminance and its random number, from its helpers.
    expect(grade).toContain("letluma=clamp(dot(color,vec3<f32>(0.2126,0.7152,0.0722)),0.0,1.0);");
    expect(grade).toContain("returnfract(sin(dot(seed.xy,vec2<f32>(12.9898,78.233)))*43758.5453);");
    // In Babylon's order: the vignette ahead of the tone map, the curves after the contrast, the dither last.
    expect(inOrder(BABYLON, ["vignetteColorMultiplier", "PBRNeutralToneMapping(result.rgb)", "resultHighContrast", "vCameraColorCurveNeutral", "ditherIntensity"])).toBe(true);
    expect(tight(DISPLAY_SHOWN_WGSL)).toContain("returngradeDither(gradeCurves(displayColour(gradeVignette(linear,at),exposure,contrast)),at);");
    // Every number it reads is the frame's block's, under the names the material grade's record gives them.
    expect(GRADE_BLOCK).toBe(FRAME_BLOCK);
    const read = [...new Set([...MATERIAL_GRADE_WGSL.matchAll(new RegExp(`${GRADE_BLOCK}\\.(\\w+)`, "g"))].map((m) => m[1] as string))];
    expect(read.sort()).toEqual(Object.keys(emptyMaterialGradeUniforms()).sort());
    for (const name of read) expect(inFrameBlock(name), name).toBe(true);
  });

  it("encodes a tone-mapped colour for the display as the curve's own last steps do: the encode, the clamp, the contrast", () => {
    const encode = tight(DISPLAY_ENCODE_WGSL);
    expect(encode).toContain("fndisplayEncoded(color:vec3<f32>,contrast:f32)->vec3<f32>{varresult=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));returndisplayContrastOf(result,contrast);}");
    // The same three statements `displayColour` ends with, after its exposure and its tone map.
    expect(inOrder(WGSL, ["result=pow(max(result,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));", "result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));", "result=displayContrastOf(result,contrast);"])).toBe(true);
    expect(DISPLAY_ENCODE_WGSL.startsWith(DISPLAY_CURVE_WGSL)).toBe(true);
  });

  it("hands a stage's linear colour on where a post chain grades the frame, and leaves the stage as it is where none does", () => {
    const stage = `struct U{a:f32}\n${DISPLAY_CURVE_WGSL}\n@fragment fn f()->@location(0)vec4<f32>{return vec4<f32>(displayColour(c,e,k),1.0);}`;
    // With no chain the stage grades its own colour: the grade follows the curve, and each call takes the fragment's place.
    const graded = onColourPath(stage, false);
    expect(graded).toContain(`${DISPLAY_CURVE_WGSL}${MATERIAL_GRADE_WGSL}${DISPLAY_SHOWN_WGSL}`);
    expect(graded).toContain("return vec4<f32>(displayShown(c,e,k,input.position.xy),1.0);");
    expect(graded.startsWith("struct U{a:f32}\n")).toBe(true);
    const linear = onColourPath(stage, true);
    expect(linear).not.toContain("displayNeutral");
    expect(tight(linear)).toContain("fndisplayColour(linear:vec3<f32>,exposure:f32,contrast:f32)->vec3<f32>{returnlinear;}");
    expect(linear).toContain("return vec4<f32>(displayColour(c,e,k),1.0);");
    expect(tight(LINEAR_COLOUR_WGSL)).toBe("fndisplayColour(linear:vec3<f32>,exposure:f32,contrast:f32)->vec3<f32>{returnlinear;}");
    // A stage that does not end with the curve has no colour path to choose.
    expect(() => onColourPath("fn f(){}", true)).toThrow(/display curve/);
  });
});
