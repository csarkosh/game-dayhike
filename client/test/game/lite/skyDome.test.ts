import { describe, expect, it } from "vitest";
import { FRAME_BLOCK, stageOwn, stageReads } from "../../../src/game/lite/frameBlock.js";
import { SKY_DOME_WGSL, SKY_FRAME_READS, SKY_RADIANCE_WGSL, SKY_TABLE_BYTES } from "../../../src/game/lite/skyDome.js";
import { emptySkyDomeUniforms } from "@csarkosh/engine/game/skyDomeParams";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "@csarkosh/engine/game/skyModel";
import { babylonText } from "../../helpers/babylonFixture.js";

/** The dome's fragment stage on Babylon.js (`skyDome.fragment.glsl`), its text recorded. */
const GLSL = babylonText("stages/skyDome.fragment.glsl");

/** `text` with every run of white space taken out, so a statement reads the same however it is laid out. */
const tight = (text: string): string => text.replace(/\s+/g, "");

/** Whether `parts` stand in `text` in that order. */
function inOrder(text: string, parts: readonly string[]): boolean {
  let at = 0;
  for (const part of parts) {
    const found = text.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return true;
}

describe("the sky's dome on Babylon Lite", () => {
  it("holds every constant of the game's stage at the game's value", () => {
    const glsl = Object.fromEntries([...GLSL.matchAll(/const float (SKY_\w+) = ([^;]+);/g)].map((m) => [m[1] as string, Number(m[2])]));
    const wgsl = Object.fromEntries([...SKY_RADIANCE_WGSL.matchAll(/const (SKY_\w+):f32=([^;]+);/g)].map((m) => [m[1] as string, Number(m[2])]));
    expect(Object.keys(wgsl)).toEqual(["SKY_PI", "SKY_AZIMUTHS", "SKY_ELEVATIONS", "SKY_MIST_HORIZON", "SKY_DISC_COS", "SKY_DISC_CAPTURE_MAX"]);
    for (const [name, value] of Object.entries(wgsl)) expect(value, name).toBe(glsl[name]);
  });

  it("finds a direction's place in the table as the game's stage does, statement for statement", () => {
    const glsl = tight(GLSL);
    const wgsl = tight(SKY_RADIANCE_WGSL);
    // The GLSL's selection is WGSL's `select`, its arms turned round; the rest is the same text.
    expect(glsl).toContain("floatc=(hl>1.0e-6&&sl>1.0e-6)?clamp(dot(h,s)/(hl*sl),-1.0,1.0):1.0;");
    expect(wgsl).toContain("letc=select(1.0,clamp(dot(h,s)/(hl*sl),-1.0,1.0),hl>1.0e-6&&sl>1.0e-6);");
    for (const line of [
      "u=acos(c)/SKY_PI;", "e=asin(clamp(d.y,0.0,1.0));", "v=0.5+0.5*sign(e)*sqrt(abs(e)/(0.5*SKY_PI));",
      "(u*(SKY_AZIMUTHS-1.0)+0.5)/SKY_AZIMUTHS,(v*(SKY_ELEVATIONS-1.0)+0.5)/SKY_ELEVATIONS);",
      "returnzenith*(1.0+2.0*max(sinE,0.0))/3.0;",
    ]) {
      expect(glsl, line).toContain(line);
      expect(wgsl, line).toContain(line);
    }
  });

  it("composes the sky in the game's order: the slice, the deck, the night, the disc capped in the capture, the mist", () => {
    expect(inOrder(tight(GLSL), [
      "skyScale*textureLod(skyTable,skyTableUv(d,skySunDir),0.0).rgb;", "sky=mix(sky,skyDeck(skyDeckZenith,d.y),skyCloud);", "sky+=skyNight;",
      "floatinDisc=step(SKY_DISC_COS,dot(d,skySunDir));", "sky+=inDisc*mix(skyDisc,min(skyDisc,vec3(SKY_DISC_CAPTURE_MAX)),skyCapture);",
      "floath=skyMistWeight*exp(-max(d.y,0.0)/SKY_MIST_HORIZON);", "sky=mix(sky,skyMistAir,h);",
    ])).toBe(true);
    expect(inOrder(tight(SKY_RADIANCE_WGSL), [
      "varsky=scale*textureSampleLevel(skyTable,skyTableSampler,skyTableUv(d,sunDir),0.0).rgb;", "sky=mix(sky,skyDeck(deckZenith,d.y),cloud);",
      "sky+=night;", "letinDisc=step(SKY_DISC_COS,dot(d,sunDir));", "sky+=inDisc*mix(disc,min(disc,vec3<f32>(SKY_DISC_CAPTURE_MAX)),capture);",
      "leth=mistWeight*exp(-max(d.y,0.0)/SKY_MIST_HORIZON);", "returnmix(sky,mistAir,h);",
    ])).toBe(true);
    // One read of the table, at its top level.
    expect(SKY_RADIANCE_WGSL.match(/textureSample\w*\(/g)).toEqual(["textureSampleLevel("]);
  });

  it("tone-maps the view as the game's stage does on the material colour path, and never the capture", () => {
    const glsl = tight(GLSL);
    const wgsl = tight(SKY_DOME_WGSL.fragment);
    // Khronos PBR Neutral's published constants, and Babylon's contrast.
    for (const [g, w] of [
      ["floatoffset=x<0.08?x-6.25*x*x:0.04;", "letoffset=select(0.04,x-6.25*x*x,x<0.08);"],
      ["floatnewPeak=1.0-k*k/(peak+k-SKY_NEUTRAL_START);", "letnewPeak=1.0-k*k/(peak+k-0.76);"],
      ["floatg=1.0-1.0/(SKY_NEUTRAL_DESATURATION*(peak-newPeak)+1.0);", "letg=1.0-1.0/(0.15*(peak-newPeak)+1.0);"],
      ["returnpeak<SKY_NEUTRAL_START?color:compressed;", "returnselect(compressed,color,peak<0.76);"],
      ["vec3high=c*c*(3.0-2.0*c);", "lethigh=c*c*(3.0-2.0*c);"],
    ] as const) {
      expect(glsl, g).toContain(g);
      expect(wgsl, w).toContain(w);
    }
    expect(glsl).toContain("constfloatSKY_NEUTRAL_START=0.76;");
    expect(glsl).toContain("constfloatSKY_NEUTRAL_DESATURATION=0.15;");
    // The exposure, the tone curve, the encode, the contrast, in Babylon's order; the view's radiance takes no cap.
    expect(inOrder(wgsl, [
      "skyRadiance(normalize(input.dir),u.skySunDir,u.skyScale,u.skyCloud,u.skyDeckZenith,u.skyNight,u.skyDisc,u.skyMistAir,u.skyMistWeight,0.0);",
      "vartoned=skyNeutral(sky*u.skyExposure);", "toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));",
      "toned=skyContrastOf(toned,u.skyContrast);", "returnvec4<f32>(clamp(toned,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);",
    ])).toBe(true);
  });

  it("hands the radiance on as it is where a post chain grades the frame, as the game's stage does with its tone map off", () => {
    expect(tight(GLSL)).toContain("vec3viewed=mix(sky,toned,step(0.5,skyToneMap));");
    const linear = tight(SKY_DOME_WGSL.fragmentLinear);
    // The same stage to the radiance, then the radiance itself: nothing of the display curve is reached.
    const radiance = "letsky=skyRadiance(normalize(input.dir),u.skySunDir,u.skyScale,u.skyCloud,u.skyDeckZenith,u.skyNight,u.skyDisc,u.skyMistAir,u.skyMistWeight,0.0);";
    expect(linear).toContain(`${radiance}returnvec4<f32>(sky,1.0);`);
    expect(tight(SKY_DOME_WGSL.fragment)).toContain(`${radiance}vartoned=skyNeutral(sky*u.skyExposure);`);
    expect(SKY_DOME_WGSL.fragmentLinear.replace("return vec4<f32>(sky,1.0);", "")).toBe(SKY_DOME_WGSL.fragment);
  });

  it("grades its own colour with no chain, as the game's stage does: the vignette ahead of the tone map, the curves and the dither after the contrast", () => {
    const glsl = tight(GLSL);
    expect(glsl).toContain("vec3toned=skyNeutral(skyVignetteOf(sky*skyExposure));");
    expect(glsl).toContain("toned=skyContrastOf(toned);toned=skyCurvesOf(toned);toned=skyDitherOf(toned);");
    const graded = tight(SKY_DOME_WGSL.fragmentGraded);
    expect(graded).toContain("vartoned=skyNeutral(gradeVignette(sky*u.skyExposure,input.position.xy));");
    expect(graded).toContain("toned=skyContrastOf(toned,u.skyContrast);toned=gradeCurves(toned);toned=gradeDither(toned,input.position.xy);");
    expect(graded).toContain("fngradeVignette(");
    expect(SKY_DOME_WGSL.fragment).not.toContain("gradeVignette");
  });

  it("reads every uniform the game draws the dome with from its own, and rides with the eye", () => {
    const read = new Set([...SKY_DOME_WGSL.fragment.matchAll(/\bu\.(sky\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(emptySkyDomeUniforms()).sort());
    expect(tight(SKY_DOME_WGSL.vertex)).toContain("out.position=scene.viewProjection*vec4<f32>(scene.vEyePosition.xyz+input.position,1.0);");
    // The view and the eye are the scene's own: no copy of them is the dome's.
    expect(`${SKY_DOME_WGSL.vertex}${SKY_DOME_WGSL.fragment}`).not.toMatch(/shaderSystem/);
    expect(tight(SKY_DOME_WGSL.vertex)).toContain("out.dir=input.position;");
  });

  it("is made reading the display curve from the frame's block, the sky's own numbers its own", () => {
    const made = tight(stageReads(SKY_DOME_WGSL.fragment, SKY_FRAME_READS));
    const own = Object.keys(emptySkyDomeUniforms()).filter((name) => name !== "skyExposure" && name !== "skyContrast").sort();
    expect([...new Set([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1] as string))].sort()).toEqual(own);
    expect(Object.keys(stageOwn(emptySkyDomeUniforms(), SKY_FRAME_READS)).sort()).toEqual(own);
    expect(made).toContain(`vartoned=skyNeutral(sky*${FRAME_BLOCK}.frameExposure);`);
    expect(made).toContain(`toned=skyContrastOf(toned,${FRAME_BLOCK}.frameContrast);`);
  });

  it("sends the table as four halves a texel", () => {
    expect(SKY_TABLE_BYTES).toBe(SLICE_AZIMUTHS * SLICE_ELEVATIONS * 8);
  });
});
