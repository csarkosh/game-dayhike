import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOLE_CELLS } from "../../../src/game/clipmap.js";
import {
  SEA_ALBEDO_WGSL, SEA_BUMP_WGSL, SEA_COMPOSE_WGSL, SEA_LIP_SHAPE_WGSL, SEA_LIP_VERTEX_WGSL, SEA_RAIN_WGSL, SEA_VERTEX_WGSL, seaLightsWgsl, seaRestVertexWgsl,
  seaShadeWgsl, seaSurfaceWgsl,
} from "../../../src/game/lite/seaWgsl.js";
import { WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE } from "../../../src/game/water.js";
import { inOrder, tight } from "./wgslText.js";

const fx = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../src/game/shaders/${name}`, import.meta.url)), "utf8");
/** A stage's GLSL with its comments taken out. */
const code = (name: string): string => fx(name).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

const LOW = { loop: false, bump: true };
const LOOP = { loop: true, bump: false };

/** The uniforms the sea's GLSL reads, and the name each is the material's under here. */
const UNIFORMS: Record<string, string> = {
  oceanCoast: "oceanCoast", oceanSwell: "oceanSwell", oceanTips: "oceanTips", oceanWind: "oceanWind", oceanWindDir: "oceanWindDir", oceanWindStats: "oceanWindStats",
  oceanWindPivot: "oceanWindPivot", oceanCove: "oceanCove", oceanPhase0: "oceanPhase0", oceanPhase1: "oceanPhase1", oceanPhase2: "oceanPhase2",
  waterSkin: "waterSkin", waterRain: "waterRain", waterKd: "waterKd", waterTime: "seaTime", waterWindTime: "seaWindTime",
};

/**
 * A GLSL statement as the WGSL writes it: a declared local is a `let`, a
 * vector's constructor names its floats, a uniform is the material's (the
 * clock and the wind's integral under the sea's own names), and Babylon.js's
 * names for the fragment's place, its eye, its normal, its view and its
 * varyings are Lite's.
 */
function asWgsl(glsl: string): string {
  return tight(glsl)
    .replace(/^(?:float|vec[234]|bool)(?=[A-Za-z_])/, "let")
    .replace(/\bvec([234])\(/g, "vec$1<f32>(")
    .replace(/\bfloat\(/g, "f32(")
    .replace(/\b(ocean[A-Z][A-Za-z0-9]*|water[A-Z][A-Za-z0-9]*)\b(?!\()/g, (name) => (name in UNIFORMS ? `material.${UNIFORMS[name]}` : name))
    .replace(/\bvPositionW\b/g, "input.worldPos")
    .replace(/\bvEyePosition\b/g, "scene.vEyePosition")
    .replace(/\b(vOceanXZ|vOceanSwellA|vOceanSwellB|vBedDepth)\b/g, "input.$1")
    .replace(/\bdFd([xy])\(/g, "dpd$1(")
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

/**
 * What WGSL writes otherwise, and so is pinned by hand below: a texture's
 * read, a remainder, a two-way choice, a local written again or declared
 * with no value, a result handed back through a parameter, a branch, a loop.
 */
const BY_HAND = /texture2D|textureLod|\bmod\(|\?|^(if|for|return|else|\}|#)|^(float|vec[234]) [A-Za-z0-9_]+(\[\d+\])?;|^(float|vec[234]) (scale|height|across|slope|fold|steepness|g|t) = |^[A-Za-z0-9_]+(\[[a-z0-9]+\])?(\.[xyzw]+)? ?[-+*]?= |phaseDz|^float (phi|amp|q0|sn|cs|theta)\[|^vec2 kv\[|oceanSwellSum\(|oceanWindSlopesAt\(|oceanDisplace\(|oceanK\[|atan\(|\bdrawn\b|\benv\b = /;

describe("the sea's waves and shading in WGSL, against the game's GLSL", () => {
  const surface = code("oceanSurface.fx");
  const swash = code("oceanSwash.fx");
  const shade = code("oceanShade.fragment.fx");
  const water = code("water.fragment.fx");
  const lights = code("waterLights.fragment.fx");
  const all = seaSurfaceWgsl(LOOP) + seaShadeWgsl(LOOP) + seaShadeWgsl(LOW) + SEA_RAIN_WGSL;

  it("holds the GLSL's constants at the GLSL's values", () => {
    const wgsl = tight(all);
    const constants = [...(surface + swash + shade + water).matchAll(/const float ([A-Z0-9_]+) = ([-0-9.e]+);/g)];
    expect(constants.length).toBeGreaterThan(90);
    const left: string[] = [];
    let held = 0;
    for (const [, name, value] of constants) {
      if (!wgsl.includes(`const${name}:f32=`)) {
        left.push(name as string);
        continue;
      }
      expect(wgsl, name).toContain(`const${name}:f32=${value};`);
      held++;
    }
    expect(held).toBe(constants.length - left.length);
    // What the sea reads none of here: the three cascades of the wind sea's FFT, the swash's columns as a share of a
    // texture's width (the table is read at a whole texel), and the water's own that a lake's module holds or that
    // belong to the read through the surface.
    expect(left.sort()).toEqual([
      "FFT_CASCADE_0", "FFT_CASCADE_1", "FFT_CASCADE_2", "FFT_N", "WATER_F0", "WATER_HORIZON", "WATER_OCTAVE2_DRIFT", "WATER_OCTAVE2_TILE", "WATER_OCTAVE2_WEIGHT",
      "WATER_REFRACT", "WATER_REFRACT_DEPTH", "WATER_REFRACT_MIN", "WATER_SKIN_DRIFT",
    ]);
  });

  it("is the GLSL's functions statement for statement, where a statement is plain arithmetic", () => {
    const wgsl = tight(all);
    const functions: [string, string[]][] = [
      [surface, [
        "oceanAtlasRead", "oceanAtlasRow", "oceanCoastAt", "oceanShelterTip", "oceanShelter", "oceanSwellSum", "oceanFoamFromEnvelope", "oceanSwellPixelKeep",
        "oceanRingCell", "oceanWindAmp", "oceanWindFrame", "oceanFromWind", "oceanLoopSize", "oceanLoopRead", "oceanWindRingKeep",
      ]],
      [swash, ["swashSheet", "oceanCoveShare", "swashLift", "swashDepth"]],
      [shade, [
        "oceanUndrawnVariance", "oceanLace", "oceanFoamLookAge", "oceanFoamShare", "oceanLaceLevel", "oceanFoamCover", "oceanFoamWhite", "oceanCapDamp",
        "oceanCapCoverage", "oceanCapThreshold", "oceanWhitecap", "oceanCapFire", "oceanCapCells", "oceanWindPixelKeep", "oceanBumpScale", "oceanWindSlopeLimit",
        "oceanLipFromEnvelope", "oceanLipNormal", "oceanLipFoam",
      ]],
      [water, ["waterRainLayer"]],
    ];
    let pinned = 0;
    const missing: string[] = [];
    for (const [source, names] of functions) {
      for (const name of names) {
        for (const line of body(source, name)) {
          if (BY_HAND.test(line)) continue;
          if (!wgsl.includes(asWgsl(line))) missing.push(`${name}: ${line}`);
          pinned++;
        }
      }
    }
    expect(missing).toEqual([]);
    expect(pinned).toBeGreaterThan(110);
  });

  it("writes by hand what WGSL says otherwise: the tables' reads at a whole texel, the remainders, the choices", () => {
    const wgsl = tight(all);
    // A texel of the atlas at its column and row; the coastline's row with the phase weight's slope beside it.
    expect(wgsl).toContain("fnoceanAtlasTexel(row:f32,column:f32)->vec4<f32>{returntextureLoad(oceanAtlas,vec2<i32>(i32(column),i32(row)),0);}");
    expect(wgsl).toContain("o.phaseDz=select((b.w-a.w)/material.oceanCoast.y,0.0,column<0.0);");
    // The swash's column nearest z: the GLSL's coordinate lands on the texel its clamp and half give.
    expect(wgsl).toContain("textureLoad(oceanSwash,vec2<i32>(i32(floor(clamp(z-material.oceanCove.x+SWASH_HALF,0.0,SWASH_COLUMNS-1.0)+0.5)),0),0)");
    // The swell's loop reads its constants as bits, stops at the count, and skips a component faded whole.
    expect(wgsl).toContain("letk=bitcast<vec4<f32>>(material.oceanK[c]);");
    expect(wgsl.split("if(f32(c)>=material.oceanCoast.z){break;}").length + wgsl.split("if(fc>=material.oceanCoast.z){break;}").length - 2).toBe(3);
    expect(wgsl).toContain("if(turn>=OCEAN_RESOLVE_PHASE_HI){continue;}");
    expect(wgsl).toContain("letcrestPhase=select(0.0,atan2(env.y,env.x),dot(env,env)>0.0);");
    // The remainders, written out.
    expect(wgsl).toContain("letfoamAge=((-crestPhase)-OCEAN_TWO_PI*floor(((-crestPhase))/OCEAN_TWO_PI))/(OCEAN_TWO_PI/material.oceanSwell.z);");
    expect(wgsl).toContain("letcycle=(material.seaTime-(OCEAN_CAP_CYCLES*OCEAN_CAP_PERIOD)*floor((material.seaTime)/(OCEAN_CAP_CYCLES*OCEAN_CAP_PERIOD)))/OCEAN_CAP_PERIOD+waterSkinHash(h);");
    expect(wgsl).toContain("lett=(material.seaTime-3600.0*floor((material.seaTime)/3600.0));");
    expect(wgsl).toContain("leth=c-512.0*floor(c/512.0);");
    // The loop's two frames about its time, the second folded to the loop's count.
    expect(wgsl).toContain("leta=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(f0),0.0).xyz;");
    expect(wgsl).toContain("letb=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(((f0+1.0)-LOOP_FRAMES*floor(((f0+1.0))/LOOP_FRAMES))),0.0).xyz;");
    // The rain's four layers at the puddles' scales, offsets and rates.
    for (const layer of ["0.0,2.5,vec2<f32>(0.0,0.0),1.0,0.0", "1.0,3.2,vec2<f32>(0.37,0.61),0.85,0.2", "2.0,2.1,vec2<f32>(0.71,0.13),0.93,0.45", "3.0,3.8,vec2<f32>(0.19,0.83),1.13,0.7"]) {
      expect(wgsl).toContain(`waterRainLayer(xz,t,${layer})`);
    }
  });

  it("reads the three cascades before the loop on the tier that computes them, as the GLSL's first branch does, and on no tier below", () => {
    const FFT = { loop: true, bump: false, fft: true };
    const high = tight(seaSurfaceWgsl(FFT) + seaShadeWgsl(FFT) + seaLightsWgsl(FFT));
    const below = tight(seaSurfaceWgsl(LOOP) + seaShadeWgsl(LOOP) + seaLightsWgsl(LOOP) + seaSurfaceWgsl(LOW) + seaShadeWgsl(LOW) + seaLightsWgsl(LOW));
    expect(below).not.toMatch(/FFT_|oceanWindSlope\b|oceanCoast\.w>1\.5/);
    expect(seaSurfaceWgsl({ ...LOOP, fft: false })).toBe(seaSurfaceWgsl(LOOP));
    expect(seaShadeWgsl({ ...LOOP, fft: false })).toBe(seaShadeWgsl(LOOP));
    // The cascades' constants at the GLSL's values.
    const constants = [...surface.matchAll(/const float (FFT_[A-Z0-9_]+) = ([-0-9.e]+);/g)];
    expect(constants.map((c) => c[1])).toEqual(["FFT_N", "FFT_CASCADE_0", "FFT_CASCADE_1", "FFT_CASCADE_2"]);
    for (const [, name, value] of constants) expect(high).toContain(`const${name}:f32=${value};`);
    // The displacement: each cascade at its own tile's coordinate and layer, faded on a ring too coarse for it, then the loop's branch.
    const glslDisp = tight(surface.slice(surface.indexOf("vec3 oceanWindDisplaceAt"), surface.indexOf("vec3 oceanWindDisplace(vec2 p)")));
    for (const c of [0, 1, 2]) {
      expect(glslDisp).toContain(`textureLod(oceanWindDisp,vec3(w/FFT_CASCADE_${c},${c}.0),0.0).xyz*oceanWindRingKeep(FFT_CASCADE_${c},cell)`);
    }
    expect(high).toContain(
      "if(material.oceanCoast.w>1.5){t=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_0,0,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_0,cell)"
      + "+textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_1,1,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_1,cell)"
      + "+textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_2,2,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_2,cell);}elseif(material.oceanCoast.w>0.5){letsize=oceanLoopSize();",
    );
    // The slopes: each cascade's kept by the pixel's footprint, and the variance they carry by the share squared.
    const glslSlope = tight(shade.slice(shade.indexOf("vec2 oceanWindSlopesAt"), shade.indexOf("vec2 oceanWindSlopes(vec2 p)")));
    for (const c of [0, 1, 2]) {
      expect(glslSlope).toContain(`floatk${c}=oceanWindPixelKeep(FFT_CASCADE_${c},FFT_N,pixel);`);
      expect(high).toContain(`letk${c}=oceanWindPixelKeep(FFT_CASCADE_${c},FFT_N,pixel);`);
      expect(glslSlope).toContain(`textureLod(oceanWindSlope,vec3(w/FFT_CASCADE_${c},${c}.0),0.0).xy*k${c}`);
      expect(high).toContain(`textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_${c},${c},0.0).xy*k${c}`);
    }
    expect(glslSlope).toContain("drawn=k0*k0*oceanWindStats.y+k1*k1*oceanWindStats.z+k2*k2*oceanWindStats.w;");
    expect(high).toContain("o.drawn=k0*k0*material.oceanWindStats.y+k1*k1*material.oceanWindStats.z+k2*k2*material.oceanWindStats.w;}elseif(material.oceanCoast.w>0.5){");
    // The crests' fade: cascade 1's shortest wave where the cascades are drawn, the loop's otherwise.
    expect(tight(shade)).toContain("if(oceanCoast.w>1.5)returnoceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);returnoceanWindPixelKeep(oceanLoopSize(),LOOP_N,pixel);");
    expect(high).toContain("fnoceanCrestKeep(pixel:f32)->f32{if(material.oceanCoast.w>1.5){returnoceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);}returnoceanWindPixelKeep(oceanLoopSize(),LOOP_N,pixel);}");
    // The fragment lip stands down while the cascades are drawn: the strip draws the curl then.
    expect(high).toContain("step(material.oceanCoast.w,1.5)");
  });

  it("places the plunging lip's strip as oceanLipShape.vertex.fx does: the crest's slot, the cross-section between two keyframes, the swell's sum at its foot", () => {
    const lipShape = code("oceanLipShape.vertex.fx");
    const wgsl = tight(SEA_LIP_SHAPE_WGSL);
    const constants = [...lipShape.matchAll(/const float ([A-Z0-9_]+) = ([-0-9.e]+);/g)];
    expect(constants.length).toBe(10);
    for (const [, name, value] of constants) expect(wgsl, name).toContain(`const${name}:f32=${value};`);
    // The plain statements of the three functions, as the sea's own are held.
    let pinned = 0;
    const missing: string[] = [];
    for (const name of ["oceanLipKey", "oceanLipShape", "oceanLipPlace"]) {
      for (const line of body(lipShape, name)) {
        if (BY_HAND.test(line) || /oceanCoastAt|oceanDisplace|^vec2 travel|^float u = |^vec4 sum;|^vec2 sumEnv;|^float phaseDz;|^xz = |^swell = |^env = /.test(line)) continue;
        if (!wgsl.includes(asWgsl(line))) missing.push(`${name}: ${line}`);
        pinned++;
      }
    }
    expect(missing).toEqual([]);
    expect(pinned).toBeGreaterThanOrEqual(12);
    // By hand: the tables at the texel the GLSL's nearest read lands on, and what the GLSL hands back through its out parameters.
    const glsl = tight(lipShape);
    expect(glsl).toContain("vec4slot=textureLod(oceanLipState,vec2((column+0.5)/LIP_COLUMNS,(strip.y+0.5)/LIP_SLOTS),0.0);");
    expect(wgsl).toContain("letslot=textureLoad(oceanLipState,vec2<i32>(i32(floor(column+0.5)),i32(floor(strip.y+0.5))),0);");
    expect(glsl).toContain("floatu=(v+0.5)/LIP_PROFILE_VERTS;vec4a=textureLod(oceanLipProfile,vec2(u,(k0+0.5)/LIP_KEYFRAMES),0.0);vec4b=textureLod(oceanLipProfile,vec2(u,(k0+1.5)/LIP_KEYFRAMES),0.0);");
    expect(wgsl).toContain("leta=textureLoad(oceanLipProfile,vec2<i32>(i32(floor(v+0.5)),i32(k0)),0);letb=textureLoad(oceanLipProfile,vec2<i32>(i32(floor(v+0.5)),i32(k0)+1),0);");
    expect(glsl).toContain("xz=vec2(oceanCoastAt(strip.x,phaseDz).x+slot.x,strip.x)+travel*(shape.x*size);");
    expect(wgsl).toContain("o.xz=vec2<f32>(oceanCoastAt(strip.x).coast.x+slot.x,strip.x)+travel*(shape.x*size);");
    expect(glsl).toContain("swell=vec4(normal.x,normal.z,sum.z+lift,sum.w);");
    expect(wgsl).toContain("o.swell=vec4<f32>(normal.x,normal.z,sum.z+lift,sum.w);");
    expect(glsl).toContain("env=mix(vec4(sumEnv,length(sumEnv),0.0),vec4(LIP_FOAM_ENVELOPE,0.0,LIP_FOAM_ENVELOPE,0.0),edge);");
    expect(wgsl).toContain("o.env=mix(vec4<f32>(sumEnv,length(sumEnv),0.0),vec4<f32>(LIP_FOAM_ENVELOPE,0.0,LIP_FOAM_ENVELOPE,0.0),edge);");
    expect(glsl).toContain("returnvec3(xz.x,waterLevel,xz.y)+disp+vec3(0.0,lift,0.0);");
    expect(wgsl).toContain("o.place=vec3<f32>(o.xz.x,material.waterLevel,o.xz.y)+disp+vec3<f32>(0.0,lift,0.0);");
    // The strip's vertex hands the fragment stage what the lattice's does, and no depth of its own.
    const vertex = tight(SEA_LIP_VERTEX_WGSL);
    expect(tight(code("oceanLip.vertex.fx"))).toContain("positionUpdated=oceanLipPlace(positionUpdated,oceanLipXZ,oceanLipSwell,oceanLipEnv);vOceanXZ=oceanLipXZ;vOceanSwellA=oceanLipSwell;vOceanSwellB=oceanLipEnv;");
    expect(inOrder(vertex, [
      "letoceanLip=oceanLipPlace(position);", "out.vOceanXZ=oceanLip.xz;", "out.vOceanSwellA=oceanLip.swell;", "out.vOceanSwellB=oceanLip.env;", "out.worldPos=oceanLip.place;",
      "out.clipPos=scene.viewProjection*vec4<f32>(oceanLip.place,1.0);", "out.vBedDepth=0.0;", "out.vWaterViewDepth=out.clipPos.w;",
    ])).toBe(true);
    expect(vertex).not.toMatch(/swashLift|seaRing|seaBed/);
  });

  it("reads the wind sea's field only where the look bakes one, and the bump only where it draws the wind sea", () => {
    const low = tight(seaSurfaceWgsl(LOW) + seaShadeWgsl(LOW) + seaLightsWgsl(LOW));
    const loop = tight(seaSurfaceWgsl(LOOP) + seaShadeWgsl(LOOP) + seaLightsWgsl(LOOP));
    expect(low).not.toMatch(/oceanWindDisp|oceanLoopRead|oceanWindSlopesAt|oceanWhitecap|wWindSteep/);
    expect(loop).not.toMatch(/oceanBumpScale|waterBump/);
    // With no field its displacement and slopes are nothing: the swell alone moves a vertex and sets the water's edge.
    expect(low).toContain("o.disp=sum.disp;");
    expect(low).toContain("letwSurfaceHeight=wOceanHeight;");
    expect(low).toContain("letwOceanExtra=N.xz/max(N.y,0.05)*oceanBumpScale(wWindShare,wOceanFoam.y,wOceanChop);");
    expect(low).toContain("wOceanCap=oceanCapCells(input.vOceanXZ,wOceanPixel,wWindShare);");
    expect(loop).toContain("letchop=oceanWindAmp(p)*(1.0-sum.foam.y)*oceanShelter(p,SHELTER_CHOP);o.disp=sum.disp+oceanWindDisplaceAt(p,cell)*chop;");
    expect(loop).toContain("letwSurfaceHeight=wOceanHeight+wWind.y*wWindAmp;");
    expect(loop).toContain("letwOceanExtra=wWindSlope*wWindSteep;");
    expect(loop).toContain("wOceanCap=mix(wCapCover,oceanWhitecap(wCapCover,wWind.y/max(material.oceanWindStats.x,1.0e-4)),oceanCrestKeep(wOceanPixel));");
  });

  it("shades the sea in waterLights' order: the swell at the pixel, the depth, the normal, the rain, the alpha, the white water, then the roughness", () => {
    const wgsl = tight(seaLightsWgsl(LOW));
    // The sea's statements of the GLSL that are plain arithmetic, in the GLSL's order.
    const sea = lights.split("\n").map((line) => line.trim());
    const plain = sea.filter((line) => /^(float|vec[234]) w[A-Z]/.test(line) && !/wWind = |wWindDrawn;|wOceanCap;|wWindSlope|wWindSteep|wSurfaceHeight|wOceanExtra|wOceanVar|waterBedDepth|wKdMean|wDepth|wTransmit|wSkin|wUv|wRaw|wSceneDepth|wRayOn|wBehind|wOff|wBed |wT |wLens|wShallow|wBreeze|wPaw|wRippleXz|wOctave|wSlope|wRs|wFoamWhite|wCapCover|wFoam = /.test(line));
    expect(plain.length).toBeGreaterThan(15);
    for (const line of plain) expect(wgsl, line).toContain(asWgsl(line));
    expect(inOrder(wgsl, plain.map(asWgsl))).toBe(true);
    expect(inOrder(wgsl, [
      "letwBedRead=waterBedDepth(input.worldPos.xz,input.vBedDepth);",
      "varwDepth=wBedDepth+wSurfaceHeight+swashLift(input.vOceanXZ,wOceanFoam.w,wSurfaceHeight);",
      "wDepth=select(0.0,wDepth,wDepth>OCEAN_REST_EPS);",
      "if(wDepth<=0.0){discard;}",
      "N=normalize(wOceanNormal+vec3<f32>(wOceanExtra.x,0.0,wOceanExtra.y)*wOceanNormal.y);",
      "N=oceanLipNormal(N,wOceanLip);",
      "letwOceanVar=oceanUndrawnVariance(material.oceanWindDir.z,wOceanChop,wOceanDrawn);",
      "if(material.waterRain>0.0){letwRs=waterRainSlope(input.worldPos.xz);N=normalize(N+vec3<f32>(wRs.x,0.0,wRs.y)*material.waterRain);}",
      "N=waterHorizonNormal(N,V);",
      "alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);",
      "wOceanCap*=1.0-wOceanFoam.y;",
      "varwFoam=max(wOceanLace,wOceanCap);",
      "wFoam=oceanLipFoam(wFoam,wOceanLip,wOceanFoam.z);",
      "letwFoamWhite=select(OCEAN_FOAM_ALBEDO,oceanFoamWhite(wFoamAge),wOceanLace>=wOceanCap);",
      "surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(wFoamWhite),wFoam);",
      "alpha=mix(alpha,1.0,wFoam);",
      "N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wFoam));",
      // The game writes this over Babylon.js's own line (`OCEAN_ROUGHNESS_CODE`).
      "roughness=min(sqrt(sqrt(2.0*wOceanVar)),1.0);",
    ])).toBe(true);
    // The white water held matte, and the lit colour summed again.
    expect(tight(SEA_COMPOSE_WGSL)).toBe("letwRadianceScaled=finalRadianceScaled*(1.0-wFoam);letwSpecularScaled=finalSpecularScaled*(1.0-wFoam);color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;");
  });

  it("turns the ripple bump on the frame Babylon.js builds with no tangents, about a normal that is up", () => {
    const wgsl = tight(SEA_BUMP_WGSL);
    expect(inOrder(wgsl, [
      "surfaceAlbedo=baseColor;",
      "textureSample(waterBump,waterBumpSampler,input.uv+material.seaBumpOffset).xyz*2.0-1.0;",
      "letwDp2=-dpdy(input.worldPos);",
      "letwDuv2=-dpdy(input.uv);",
      "letwDp2perp=cross(wDp2,wUp);",
      "letwDp1perp=cross(wUp,wDp1);",
      "letwTangent=wDp2perp*wDuv1.x+wDp1perp*wDuv2.x;",
      "letwBitangent=wDp2perp*wDuv1.y+wDp1perp*wDuv2.y;",
      "letwDet=max(dot(wTangent,wTangent),dot(wBitangent,wBitangent));",
      "N=normalize(wTangent*(wInvmax*wMap.x)+wBitangent*(wInvmax*wMap.y)+wUp*wMap.z);",
    ])).toBe(true);
    expect(tight(SEA_ALBEDO_WGSL)).toBe("surfaceAlbedo=baseColor;");
  });

  it("places a lattice's vertex on its ring, then moves it as oceanDisplace.vertex.fx does", () => {
    const wgsl = tight(SEA_VERTEX_WGSL);
    const displace = code("oceanDisplace.vertex.fx");
    expect(displace).toContain("positionUpdated.xz -= oceanMorph * oceanCoarse;");
    expect(displace).toContain("positionUpdated.y += swashLift(vOceanXZ, swashDepth(vOceanXZ), oceanVertexDisplace.y);");
    expect(inOrder(wgsl, [
      // The ring and where it and its hole stand.
      "letseaRing=u32(position.y+0.5);",
      "letseaRecord=bitcast<vec4<f32>>(material.seaRings[seaRing]);",
      "letseaSpacing=f32(1u<<seaRing);",
      // The stitch, as `blendWeight` and the lattice's parity give it: none on the outermost ring.
      `if(seaRing<${WATER_RING_COUNT - 1}u){`,
      `letseaOut=min(min(position.x,${WATER_RING_CELLS}.0-position.x),min(position.z,${WATER_RING_CELLS}.0-position.z));`,
      `varseaIn=max(abs(position.x-${WATER_RING_CELLS / 2}.0),abs(position.z-${WATER_RING_CELLS / 2}.0));`,
      `letseaDx=max(max(seaRecord.z-position.x,position.x-(seaRecord.z+${HOLE_CELLS}.0)),0.0);`,
      "oceanMorph=select(seaIn/seaSpan,1.0,seaSpan==0.0);",
      "oceanCoarse=vec2<f32>(select(0.0,seaSpacing,seaOddX),select(0.0,select(seaSpacing,-seaSpacing,seaOddX),seaOddZ));",
      // The place on the lattice, at the level; then the GLSL's statements.
      "letseaAt=seaRecord.xy+position.xz*seaSpacing;",
      "varpositionUpdated=vec3<f32>(seaAt.x,material.waterLevel,seaAt.y);",
      "positionUpdated=vec3<f32>(positionUpdated.x-oceanMorph*oceanCoarse.x,positionUpdated.y,positionUpdated.z-oceanMorph*oceanCoarse.y);",
      "letvOceanXZ=positionUpdated.xz;",
      "letoceanVertex=oceanDisplace(positionUpdated.xz);",
      "positionUpdated+=oceanVertex.disp;",
      "out.vOceanSwellA=oceanVertex.swell;",
      "out.vOceanSwellB=vec4<f32>(oceanVertex.env,length(oceanVertex.env),0.0);",
      "positionUpdated.y+=swashLift(vOceanXZ,swashDepth(vOceanXZ),oceanVertex.disp.y);",
      "out.worldPos=positionUpdated;",
      "out.clipPos=scene.viewProjection*vec4<f32>(positionUpdated,1.0);",
      `out.uv=seaAt/${WATER_UV_SCALE}.0;`,
      "out.vBedDepth=textureLoad(seaBed,vec2<i32>(position.xz),i32(seaRing),0).r;",
      "out.vWaterViewDepth=out.clipPos.w;",
      // A frame cell the hole covers is drawn as nothing.
      `if(seaCell.x>=0.0&&seaCell.x<${HOLE_CELLS}.0&&seaCell.y>=0.0&&seaCell.y<${HOLE_CELLS}.0){out.clipPos=vec4<f32>(0.0,0.0,-1.0,1.0);}`,
    ])).toBe(true);
  });

  it("places a vertex at rest as it places one under the waves: the same ring, the same place, the same cells drawn as nothing", () => {
    const rest = tight(seaRestVertexWgsl(0));
    const moved = tight(SEA_VERTEX_WGSL);
    for (const shared of [
      "letseaRing=u32(position.y+0.5);letseaRecord=bitcast<vec4<f32>>(material.seaRings[seaRing]);letseaSpacing=f32(1u<<seaRing);",
      "letseaAt=seaRecord.xy+position.xz*seaSpacing;",
      `if(seaRing>0u&&uv.x>=0.0){letseaCell=uv-seaRecord.zw;if(seaCell.x>=0.0&&seaCell.x<${HOLE_CELLS}.0&&seaCell.y>=0.0&&seaCell.y<${HOLE_CELLS}.0){out.clipPos=vec4<f32>(0.0,0.0,-1.0,1.0);}}`,
    ]) {
      expect(rest).toContain(shared);
      expect(moved).toContain(shared);
    }
    expect(rest).toContain("out.worldPos=vec3<f32>(seaAt.x,0.0000,seaAt.y);out.clipPos=scene.viewProjection*vec4<f32>(out.worldPos,1.0);");
    // The map's rings are not stitched: its material draws the game's rings where their vertices stand.
    expect(rest).not.toMatch(/oceanMorph|oceanDisplace/);
  });
});
