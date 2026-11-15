import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKYLINE_TEXELS } from "../../../src/game/lakeSkyline.js";
import {
  LAKE_COMPOSE_WGSL, LAKE_LIGHTS_WGSL, LAKE_RIPPLES_WGSL, LAKE_SHORE_WGSL, WATER_BUMP_WGSL, WATER_DEFS_WGSL, WATER_SPLIT_WGSL, WATER_VERTEX_WGSL,
} from "../../../src/game/lite/waterWgsl.js";
import { WATER_F0 } from "../../../src/game/waterShading.js";
import { inOrder, tight } from "./wgslText.js";

const fx = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../src/game/shaders/${name}`, import.meta.url)), "utf8");
/** A stage's GLSL with its comments taken out. */
const code = (name: string): string => fx(name).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

/**
 * A GLSL statement as the WGSL writes it: a declared local is a `let`, a
 * vector's constructor names its floats, a uniform is the material's, and
 * Babylon.js's names for the fragment's place, its eye, its normal and its
 * view are Lite's.
 */
function asWgsl(glsl: string): string {
  return tight(glsl)
    .replace(/^(?:float|vec[234]|bool)(?=[A-Za-z_])/, "let")
    .replace(/\bvec([234])\(/g, "vec$1<f32>(")
    .replace(/\bfloat\(/g, "f32(")
    .replace(/\b(water[A-Z][A-Za-z0-9]*)\b(?!\()/g, (name) => (/^water(SkinHash|SkinNoise|SkinMask|SkinColour|BedDepth|HorizonNormal|Azimuth|SkylineRadiance|Ripple2)$/.test(name) ? name : `material.${name}`))
    .replace(/\bvPositionW\b/g, "input.worldPos")
    .replace(/\bvEyePosition\b/g, "scene.vEyePosition")
    .replace(/\bvWaterViewDepth\b/g, "input.vWaterViewDepth")
    .replace(/\bnormalW\b/g, "N")
    .replace(/\bviewDirectionW\b/g, "V");
}

/** The statements of the GLSL function `name` in `source`, one a line as the file lays them. */
function body(source: string, name: string): string[] {
  const start = source.search(new RegExp(`\\b${name}\\(`));
  expect(start, name).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 1, at = open + 1;
  for (; depth > 0; at++) depth += source[at] === "{" ? 1 : source[at] === "}" ? -1 : 0;
  return source.slice(open + 1, at - 1).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

describe("the lakes' water in WGSL, against the game's GLSL", () => {
  const water = code("water.fragment.fx");
  const ripples = code("lakeRipples.fragment.fx");
  const shore = code("lakeMirror.fragment.fx");
  const lights = code("waterLights.fragment.fx");
  const compose = code("waterCompose.fragment.fx");

  it("holds the GLSL's constants at the GLSL's values", () => {
    const wgsl = tight(WATER_DEFS_WGSL + LAKE_RIPPLES_WGSL);
    const constants = [...(water + ripples).matchAll(/const float ([A-Z0-9_]+) = ([-0-9.e]+);/g)];
    expect(constants.length).toBeGreaterThan(40);
    let held = 0;
    for (const [, name, value] of constants) {
      if (!wgsl.includes(`const${name}:f32=`)) continue;
      expect(wgsl, name).toContain(`const${name}:f32=${value};`);
      held++;
    }
    // Every constant a lake's blended water reads: the rest belong to the tier that reads through the surface, the sea, or the paws' mask.
    expect(held).toBe(34);
    expect(wgsl).toContain(`constWATER_F0:f32=${WATER_F0};`);
    expect(wgsl).toContain("constWATER_F0_FACTOR:f32=0.5000;");
  });

  it("is the GLSL's functions statement for statement, where a statement is plain arithmetic", () => {
    const wgsl = tight(WATER_DEFS_WGSL + LAKE_RIPPLES_WGSL + LAKE_SHORE_WGSL);
    // What WGSL writes otherwise, and so is pinned by hand below: a texture's read, a remainder, a local written again,
    // a branch, a loop.
    const byHand = /texture2D|textureLod|\bmod\(|^(if|for|return|\}|#|r\.|r = |p3|p \+=|vec3 p |vec3 r |vec3 f |f = |sum|vec2 sum|vec2 texel|vec2 uv0|vec2 t = |bool outside|vec2 uv =)/;
    const functions: [string, string[]][] = [
      [water, ["waterBedDepth", "waterHorizonNormal", "waterSkinNoise", "waterSkinMask", "waterSkinColour"]],
      [ripples, ["lakeGust", "lakePawDrift", "lakePawNoise", "lakePawField", "lakeBreeze", "lakeLiveRings", "lakeRingDh", "lakeRainSlope"]],
      [shore, ["waterSkylineRadiance"]],
    ];
    let pinned = 0;
    for (const [source, names] of functions) {
      for (const name of names) {
        for (const line of body(source, name)) {
          if (byHand.test(line)) continue;
          expect(wgsl, `${name}: ${line}`).toContain(asWgsl(line));
          pinned++;
        }
      }
    }
    expect(pinned).toBeGreaterThan(50);
  });

  it("reads the bed's four heights at the texels a nearest read of the GLSL's coordinates lands on, clamped at the edges", () => {
    expect(tight(water)).toContain("vec2uv0=(i+0.5)*texel;floath00=texture2D(waterBedHeight,uv0).r;floath10=texture2D(waterBedHeight,uv0+vec2(texel.x,0.0)).r;");
    expect(inOrder(tight(WATER_DEFS_WGSL), [
      "leti0=clamp(vec2<i32>(i),vec2<i32>(0),last);",
      "leti1=clamp(vec2<i32>(i)+vec2<i32>(1),vec2<i32>(0),last);",
      "leth00=textureLoad(waterBedHeight,i0,0).r;",
      "leth10=textureLoad(waterBedHeight,vec2<i32>(i1.x,i0.y),0).r;",
      "leth01=textureLoad(waterBedHeight,vec2<i32>(i0.x,i1.y),0).r;",
      "leth11=textureLoad(waterBedHeight,i1,0).r;",
      "leth=mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);",
      "returnselect(material.waterLevel-h,vBedDepth,outside);",
    ])).toBe(true);
    expect(tight(water)).toContain("returnoutside?vBedDepth:waterLevel-h;");
  });

  it("folds a ring's cell and its cycle as the GLSL's mod does, never by a truncating remainder", () => {
    expect(tight(ripples)).toContain("vec2h=mod(cell,LAKE_RING_FOLD);");
    expect(tight(ripples)).toContain("floatcycle=mod(floor(s),LAKE_TIME_WRAP);");
    const wgsl = tight(LAKE_RIPPLES_WGSL);
    expect(wgsl).toContain("leth=cell-LAKE_RING_FOLD*floor(cell/LAKE_RING_FOLD);");
    expect(wgsl).toContain("letcycle=floor(s)-LAKE_TIME_WRAP*floor(floor(s)/LAKE_TIME_WRAP);");
    expect(tight(WATER_DEFS_WGSL + LAKE_RIPPLES_WGSL + LAKE_SHORE_WGSL + LAKE_LIGHTS_WGSL)).not.toContain("%");
  });

  it("reads the skyline at the texel a nearest read of the azimuth lands on, and takes the shade as it is handed", () => {
    expect(tight(shore)).toContain("floatskyline=texture2D(waterSkyline,vec2(waterAzimuth(dir.xz),0.5)).r;");
    expect(tight(shore)).toContain("returnmix(probeRadiance,waterShadeColour*vLightingIntensity.z,below);");
    const wgsl = tight(LAKE_SHORE_WGSL);
    expect(wgsl).toContain(`constWATER_SKYLINE_TEXELS:i32=${SKYLINE_TEXELS};`);
    expect(wgsl).toContain("letx=clamp(i32(floor(u*f32(WATER_SKYLINE_TEXELS))),0,WATER_SKYLINE_TEXELS-1);returntextureLoad(waterSkyline,vec2<i32>(x,0),0).r;");
    expect(wgsl).toContain("letskyline=waterSkylineAt(waterAzimuth(dir.xz));");
    // The environment's intensity is in the shade already: the sky's capture holds the scene's share.
    expect(wgsl).toContain("returnmix(probeRadiance,material.waterShadeColour,below);");
    expect(wgsl).toContain("returnfract(atan2(d.x,d.y+1.0e-20)*0.15915494309189535+1.0);");
  });

  it("shades a lake's blended surface by the GLSL's statements in the GLSL's order", () => {
    const all = tight(lights);
    const glsl = [
      "floatwDepth=waterBedDepth(vPositionW.xz);",
      "vec3wBreeze=lakeBreeze(vPositionW.xz,waterLakeTime,waterWind,lakeGust(vPositionW.xz,waterLakeTime,waterWind));",
      "floatwBreezeAt=clamp(wBreeze.x,0.0,1.0);",
      "floatwPaw=waterPawCover*LAKE_BREEZE_GAIN*mix(LAKE_BREEZE_FLOOR,1.0,wBreezeAt);",
      "vec2wRippleXz=vPositionW.xz+(2.0*wBreezeAt-1.0)*LAKE_WARP_M*vec2(-waterWind.y,waterWind.x);",
      "floatwOctave=octaveAmplitude(wPaw,waterCalmShare);",
      "normalW=normalize(vec3(normalW.x*wOctave,normalW.y,normalW.z*wOctave));",
      "if(waterOctaves>1.5){vec2wSlope=lakeRipple2(wRippleXz);normalW=normalize(normalW+vec3(wSlope.x,0.0,wSlope.y)*wOctave);}",
      "if(waterRain>0.0){vec2wRs=lakeRainSlope(vPositionW.xz,waterLakeTime,waterRain,length(vPositionW-vEyePosition.xyz));normalW=normalize(normalW+vec3(wRs.x,0.0,wRs.y));}",
    ];
    const after = [
      "normalW=waterHorizonNormal(normalW,viewDirectionW);",
      "floatwNdV=clamp(dot(normalW,viewDirectionW),0.0,1.0);",
      "floatwF=WATER_F0+(1.0-WATER_F0)*pow(1.0-wNdV,5.0);",
      "alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);",
      "floatwSkin=waterSkinMask(vPositionW.xz,wDepth);",
      "if(waterSkin.x>0.0){surfaceAlbedo=mix(surfaceAlbedo,waterSkinColour(vPositionW.xz,vWaterViewDepth),wSkin);",
      "alpha=mix(alpha,1.0,wSkin);",
      "normalW=normalize(mix(normalW,vec3(0.0,1.0,0.0),wSkin));}",
    ];
    expect(inOrder(all, [glsl[0] as string, "if(wDepth<=0.0)discard;", "floatwKdMean=(waterKd.r+waterKd.g+waterKd.b)/3.0;", ...glsl.slice(1), ...after])).toBe(true);
    const wgsl = tight(LAKE_LIGHTS_WGSL);
    expect(inOrder(wgsl, [
      "letwDepth=waterBedDepth(input.worldPos.xz,input.vBedDepth);",
      "if(wDepth<=0.0){discard;}",
      "letwKdMean=(material.waterKd.r+material.waterKd.g+material.waterKd.b)/3.0;",
      ...glsl.slice(1, 7).map(asWgsl),
      "if(material.waterOctaves>1.5){letwSlope=lakeRipple2(wRippleXz);N=normalize(N+vec3<f32>(wSlope.x,0.0,wSlope.y)*wOctave);}",
      "if(material.waterRain>0.0){letwRs=lakeRainSlope(input.worldPos.xz,material.waterLakeTime,material.waterRain,length(input.worldPos-scene.vEyePosition.xyz));N=normalize(N+vec3<f32>(wRs.x,0.0,wRs.y));}",
      ...after.slice(0, 5).map(asWgsl),
      "if(material.waterSkin.x>0.0){surfaceAlbedo=mix(surfaceAlbedo,waterSkinColour(input.worldPos.xz,input.vWaterViewDepth),wSkin);",
      "alpha=mix(alpha,1.0,wSkin);",
      "N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wSkin));}",
    ])).toBe(true);
  });

  it("lays the first octave on the level surface's own axes before the lake's statements, from the base colour Babylon.js's point is handed", () => {
    const wgsl = tight(WATER_BUMP_WGSL);
    expect(wgsl).toContain("surfaceAlbedo=baseColor;");
    expect(wgsl).toContain("letwMap=textureSample(waterBump,waterBumpSampler,input.uv+material.waterBumpOffset).xyz*2.0-1.0;");
    // Both axes turned over: the frame Babylon.js derives for a level surface seen from above.
    expect(wgsl).toContain("N=normalize(vec3<f32>(-wMap.x,wMap.z,-wMap.y));");
    // The second octave reads the same picture at its own tile, drifting against the wind's integral, as the GLSL's.
    expect(tight(ripples)).toContain("vec2uv=xz/WATER_OCTAVE2_TILE-waterWindTime*WATER_OCTAVE2_DRIFT;");
    expect(tight(LAKE_RIPPLES_WGSL)).toContain(
      "letuv=xz/WATER_OCTAVE2_TILE-material.waterWindTime*WATER_OCTAVE2_DRIFT;letn=textureSample(waterBump,waterBumpSampler,uv).xyz*2.0-1.0;returnn.xy*WATER_OCTAVE2_WEIGHT;",
    );
  });

  it("splits the base colour by water's F0 after the lake's statements, and reads the view's angle on the normal they left", () => {
    expect(inOrder(tight(WATER_SPLIT_WGSL), [
      "NdotVUnclamped=dot(N,V);", "NdotV=abs(NdotVUnclamped)+0.0000001;", "letwF0=dielectricF0*WATER_F0_FACTOR;", "colorF0=vec3<f32>(wF0);",
      "colorF90=vec3<f32>(WATER_F0_FACTOR);", "surfaceAlbedo*=1.0-wF0;",
    ])).toBe(true);
  });

  it("puts the shore in place of the probe's radiance by the GLSL's weights, holds the skin matte, and sums the colour again", () => {
    const glsl = tight(compose);
    expect(inOrder(glsl, [
      "if(waterMirrorWeight*waterCalmShare>0.0){",
      "vec3wProbeRadiance=reflectionOut.environmentRadiance.rgb*vLightingIntensity.z;",
      "vec3wShoreRay=reflect(-viewDirectionW,normalW);",
      "vec3wShore=mix(wProbeRadiance,waterSkylineRadiance(wShoreRay,wProbeRadiance),step(0.5,waterSkylineOn));",
      "floatwMirrorW=waterMirrorWeight*(1.0-wPaw)*waterCalmShare;",
      "finalRadianceScaled=mix(finalRadianceScaled,wShore*colorSpecularEnvironmentReflectance,wMirrorW);",
      "finalRadianceScaled*=1.0-wSkin;",
      "finalSpecularScaled*=1.0-wSkin;",
    ])).toBe(true);
    expect(inOrder(tight(LAKE_COMPOSE_WGSL), [
      "varwRadianceScaled=finalRadianceScaled;",
      "if(material.waterMirrorWeight*material.waterCalmShare>0.0){",
      "letwProbeRadiance=environmentRadiance;",
      "letwShoreRay=reflect(-V,N);",
      "letwShore=mix(wProbeRadiance,waterSkylineRadiance(wShoreRay,wProbeRadiance),step(0.5,material.waterSkylineOn));",
      "letwMirrorW=material.waterMirrorWeight*(1.0-wPaw)*material.waterCalmShare;",
      "wRadianceScaled=mix(wRadianceScaled,wShore*colorSpecularEnvReflectance,wMirrorW);",
      "wRadianceScaled*=1.0-wSkin;",
      "letwSpecularScaled=finalSpecularScaled*(1.0-wSkin);",
      "color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;",
    ])).toBe(true);
  });

  it("hands the fragment the bed's depth under the vertex and the vertex's view depth", () => {
    expect(tight(fx("waterWorldPos.vertex.fx"))).toContain("vBedDepth=bedDepth;");
    expect(tight(fx("waterWorldPos.vertex.fx"))).toContain("vWaterViewDepth=(view*worldPos).z;");
    expect(WATER_VERTEX_WGSL).toBe("out.vBedDepth=bedDepth;out.vWaterViewDepth=out.clipPos.w;");
  });
});
