import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { FRAME_BLOCK, stageClocks, stageOwn, stageReads } from "@csarkosh/engine/game/lite/frameBlock";
import { RAIN_FRAME_READS, RAIN_WGSL } from "@csarkosh/engine/game/lite/rain";
import { emptyRainStageUniforms } from "@csarkosh/engine/game/rainField";
import { inOrder, tight } from "./wgslText.js";

/**
 * The streak plugin's own code at its points on Babylon.js (where it updates the position, and
 * before the fragment's colour), and the Standard material's fragment stage with its fog, as Babylon.js installs
 * them (all recorded).
 */
const PLUGIN_VERTEX = babylonText("stages/rain.vertexUpdatePosition.glsl");
const PLUGIN_FRAGMENT = tight(babylonText("stages/rain.fragmentBeforeFragColor.glsl"));
const STANDARD = tight(babylonText("shaders/defaultPixelShader.glsl"));
const FOG_DECLARATION = tight(babylonText("shaders/fogFragmentDeclaration.glsl"));
const FOG_VERTEX = tight(babylonText("shaders/fogVertex.glsl"));
const OPEN = tight(RAIN_WGSL.vertex);
const COVERED = tight(RAIN_WGSL.vertexCovered);
const FRAGMENT = tight(RAIN_WGSL.fragment);

/** The plugin's uniforms as the stage reads them, and its two box uniforms, which the stage picks by the instance. */
const UNIFORMS = [
  "rainDrift", "rainFold", "rainDt", "rainWind", "rainCam", "rainLampPos", "rainLampDir", "rainLampColour", "rainLamp", "rainSpeeds", "rainWidths",
  "rainAlphas", "rainMapCentre", "rainMapExtent", "rainCanopyWater",
];

/** A GLSL expression as the stage writes it: the vector types, the uniforms through the material's record, the quad's corner from the input. */
function expr(glsl: string): string {
  let out = tight(glsl).replace(/vec([234])\(/g, "vec$1<f32>(").replace(/(?<![\w.])position\./g, "input.position.");
  for (const name of UNIFORMS) out = out.replace(new RegExp(`(?<![\\w.])${name}(?!\\w)`, "g"), `u.${name}`);
  return out;
}

/** A GLSL statement `type name = value;` as the stage's `let name=value;`. */
function statement(glsl: string): string {
  const m = /^\s*(?:float|vec[234])\s+(\w+)\s*=\s*(.*);\s*$/s.exec(glsl);
  if (m === null) throw new Error(`not a declaration: ${glsl}`);
  return `let${m[1]}=${expr(m[2] as string)};`;
}

/** The plugin's lines outside every `#ifdef`, in order, and the pairs it has under `RAIN_DRIP`: [the drip's, the streak's]. */
function pluginLines(): { plain: string[]; pairs: [string, string][] } {
  const plain: string[] = [];
  const pairs: [string, string][] = [];
  const lines = PLUGIN_VERTEX.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  // A stack of the conditions a line stands under.
  const under: string[] = [];
  let drip: string[] = [];
  let streak: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#ifdef")) {
      under.push(line.slice(7));
      continue;
    }
    if (line === "#else") {
      under.push(`!${under.pop() as string}`);
      continue;
    }
    if (line === "#endif") {
      const closed = under.pop() as string;
      if (closed.endsWith("RAIN_DRIP") && under.join() === "RAIN") {
        drip.forEach((d, i) => pairs.push([d, streak.filter((s) => /^(float|vec[234])\s/.test(s) && s.split("=")[0] === d.split("=")[0])[0] ?? streak[i] ?? ""]));
        drip = [];
        streak = [];
      }
      continue;
    }
    if (line === "{" || line === "}") continue;
    const at = under.join();
    if (at === "RAIN") plain.push(line);
    else if (at === "RAIN,RAIN_DRIP") drip.push(line);
    else if (at === "RAIN,!RAIN_DRIP") streak.push(line);
  }
  return { plain, pairs };
}

describe("the rain's vertex stage on Babylon Lite", () => {
  const { plain, pairs } = pluginLines();

  it("keeps every line the plugin runs for both volumes, in the plugin's order", () => {
    // What the plugin declares outside its conditions, bar the cover's seed of 1 and the two writes handled below.
    const declared = plain.filter((l) => /^(float|vec[234])\s/.test(l) && !l.startsWith("float rCover"));
    expect(declared.length).toBeGreaterThanOrEqual(14);
    const expected = declared.map(statement);
    for (const text of [OPEN, COVERED]) expect(inOrder(text, expected), expected.find((e) => !text.includes(e))).toBe(true);
    // The position, and the two varyings.
    const position = plain.find((l) => l.startsWith("positionUpdated")) as string;
    expect(OPEN).toContain(`let${expr(position)}`);
    expect(OPEN).toContain(`out.rainAlpha=${expr((plain.find((l) => l.startsWith("vRainAlpha")) as string).slice("vRainAlpha = ".length))}`);
    expect(OPEN).toContain(`out.rainLamp=${expr((plain.find((l) => l.startsWith("vRainLamp")) as string).slice("vRainLamp = ".length))}`);
  });

  it("takes the plugin's line under RAIN_DRIP for a drip and its other line for a streak, by the instance", () => {
    // The speed, the width, the class's alpha, the drift, the fall's direction and the length.
    const names = pairs.map(([d]) => (/(\w+)\s*=/.exec(d) as RegExpExecArray)[1]);
    expect(names).toEqual(["rSpeed", "rWidth", "rClassAlpha", "rDrift", "rAlong", "rLen"]);
    for (const [drip, streak] of pairs) {
      const name = (/(\w+)\s*=/.exec(drip) as RegExpExecArray)[1] as string;
      const value = (line: string): string => expr(line.slice(line.indexOf("=") + 1).replace(/;\s*$/, ""));
      expect(OPEN, name).toContain(`let${name}=select(${value(streak)},${value(drip)},drip);`);
    }
    // The class lane, which a streak alone reads.
    expect(PLUGIN_VERTEX).toContain("float rkI = floor(rainSeed.w * 3.0 + 0.5);");
    expect(PLUGIN_VERTEX).toContain("vec4 rkSel = vec4(equal(vec4(rkI), vec4(0.0, 1.0, 2.0, 3.0)));");
    expect(OPEN).toContain("letrkI=floor(rainSeed.w*3.0+0.5);letrkSel=vec4<f32>(vec4<f32>(rkI)==vec4<f32>(0.0,1.0,2.0,3.0));");
    // Which it is, its seed and its box come from its instance.
    expect(OPEN).toContain("letrainSeed=input.world0;letdrip=input.world1.x>0.5;");
    expect(OPEN).toContain("letrainBoxMin=select(u.rainBoxMin,u.dripBoxMin,drip);letrainBoxSize=select(u.rainBoxSize,u.dripBoxSize,drip);");
  });

  it("reads the cover map as the plugin does under RAIN_OCCLUSION, the nearest texel at the drop's place", () => {
    expect(PLUGIN_VERTEX).toContain("vec2 rMu = (rp.xz - rainMapCentre) / rainMapExtent + 0.5;");
    expect(PLUGIN_VERTEX).toContain("vec4 rMap = texture2D(rainMapSampler, rMu);");
    expect(PLUGIN_VERTEX).toContain("float rInMap = step(0.0, rMu.x) * step(rMu.x, 1.0) * step(0.0, rMu.y) * step(rMu.y, 1.0);");
    expect(PLUGIN_VERTEX).toContain("float rCovered = rInMap * step(rp.y, rMap.r + rMap.b);");
    expect(PLUGIN_VERTEX).toContain("rCover = rCovered * (1.0 - rMap.g) * rainCanopyWater;");
    expect(PLUGIN_VERTEX).toContain("rCover = mix(1.0, max(rMap.g, step(0.5, rMap.b)), rCovered);");
    expect(inOrder(COVERED, [
      "letrMu=(rp.xz-u.rainMapCentre)/u.rainMapExtent+0.5;",
      "letrMap=textureLoad(rainMap,vec2<i32>(clamp(rMu*512.0,vec2<f32>(0.0),vec2<f32>(511.0))),0);",
      "letrInMap=step(0.0,rMu.x)*step(rMu.x,1.0)*step(0.0,rMu.y)*step(rMu.y,1.0);",
      "letrCovered=rInMap*step(rp.y,rMap.r+rMap.b);",
      "letrCover=select(mix(1.0,max(rMap.g,step(0.5,rMap.b)),rCovered),rCovered*(1.0-rMap.g)*u.rainCanopyWater,drip);",
    ])).toBe(true);
    // Without a map a streak falls whole and a drip is never shown, as the plugin leaves them.
    expect(PLUGIN_VERTEX).toContain("float rCover = 1.0;");
    expect(PLUGIN_VERTEX).toContain("#else\n#ifdef RAIN_DRIP\n  rCover = 0.0;\n#endif\n#endif");
    expect(OPEN).toContain("letrCover=select(1.0,0.0,drip);");
    expect(OPEN).not.toContain("rainMap,");
    expect(RAIN_WGSL.vertex).not.toMatch(/textureLoad|textureSample/);
  });

  it("stands the corner in the world as the Standard material does a position already there, and puts a drip not shown out of sight", () => {
    expect(FOG_VERTEX).toContain("vFogDistance=(view*worldPos).xyz;");
    expect(inOrder(OPEN, [
      "letworldPos=vec4<f32>(positionUpdated,1.0);",
      "out.position=select(scene.viewProjection*worldPos,vec4<f32>(2.0,2.0,2.0,1.0),drip&&input.world1.y>=u.rainDripShown);",
      "out.fogDistance=(scene.view*worldPos).xyz;", "out.uv=input.uv;",
    ])).toBe(true);
  });

  it("reads every uniform of the volumes it draws, and none it was not handed", () => {
    const names = new Set(Object.keys(emptyRainStageUniforms()));
    const read = (wgsl: string): Set<string> => new Set([...wgsl.matchAll(/\bu\.(\w+)/g)].map((m) => m[1] as string));
    const stages = new Set([...read(RAIN_WGSL.vertexCovered), ...read(RAIN_WGSL.fragment)]);
    for (const name of stages) expect(names.has(name), name).toBe(true);
    expect([...stages].sort()).toEqual([...names].sort());
    // The open stage reads no map.
    for (const name of ["rainMapCentre", "rainMapExtent", "rainCanopyWater"]) expect(read(RAIN_WGSL.vertex).has(name), name).toBe(false);
  });

  it("is made reading its clocks, the eye, the scene's fog and the display curve from the frame's block", () => {
    const framed = ["rainCam", "rainCanopyWater", "rainContrast", "rainDrift", "rainDt", "rainExposure", "rainFogColour", "rainFogDensity", "rainFold"];
    const made = tight(`${stageReads(RAIN_WGSL.vertexCovered, RAIN_FRAME_READS)}${stageReads(RAIN_WGSL.fragment, RAIN_FRAME_READS)}`);
    const read = [...new Set([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1] as string))].sort();
    const own = Object.keys(stageOwn(emptyRainStageUniforms(), RAIN_FRAME_READS)).sort();
    expect(read).toEqual(own);
    expect(Object.keys(emptyRainStageUniforms()).filter((name) => !own.includes(name)).sort()).toEqual(framed);
    expect(Object.keys(stageClocks(emptyRainStageUniforms())).sort()).toEqual(["rainCanopyWater", "rainDrift", "rainDt", "rainFold"]);
    expect(made).toContain(`letrToCam=${FRAME_BLOCK}.fadeEye-rp;`);
    expect(made).toContain(`-rSpeed*${FRAME_BLOCK}.rainFold/rainBoxSize.y`);
    expect(made).toContain(`letfog=rainFogFactor(input.fogDistance,${FRAME_BLOCK}.atmBaseDensity);`);
    expect(made).toContain(`color=vec4<f32>(displayColour(color.rgb,${FRAME_BLOCK}.frameExposure,${FRAME_BLOCK}.frameContrast),color.a);`);
  });
});

describe("the rain's fragment stage on Babylon Lite", () => {
  it("fogs by Babylon's exponential-squared factor, at Babylon's constant", () => {
    expect(FOG_DECLARATION).toContain("#defineE2.71828");
    expect(FRAGMENT).toContain("constRAIN_E:f32=2.71828;");
    expect(FOG_DECLARATION).toContain("{fogCoeff=1.0/pow(E,fogDistance*fogDistance*fogDensity*fogDensity);}returnclamp(fogCoeff,0.0,1.0);}");
    expect(inOrder(FRAGMENT, [
      "letfogDistance=length(vFogDistance);", "letfogCoeff=1.0/pow(RAIN_E,fogDistance*fogDistance*fogDensity*fogDensity);", "returnclamp(fogCoeff,0.0,1.0);",
    ])).toBe(true);
  });

  it("composes the colour in the Standard material's order, then the plugin's two lines: the lamp's colour and the drop's alpha", () => {
    expect(inOrder(STANDARD, [
      "baseColor=TEXRD(diffuseSampler,vDiffuseUV+uvOffset);", "alpha*=baseColor.a;", "vec3emissiveColor=vEmissiveColor;",
      "vec3finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;",
      "vec4color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);", "color.rgb=max(color.rgb,0.);",
      "#include<fogFragment>", "color.rgb=toLinearSpace(color.rgb);color=applyImageProcessing(color);", "color.a*=visibility;",
      "#defineCUSTOM_FRAGMENT_BEFORE_FRAGCOLOR",
    ])).toBe(true);
    expect(PLUGIN_FRAGMENT).toContain("color.rgb=mix(color.rgb,rainLampColour,vRainLamp);color.a*=vRainAlpha;");
    // No light, no diffuse and no ambient colour: the emissive alone, by the sprite, whose alpha is the material's.
    expect(inOrder(FRAGMENT, [
      "varalpha=1.0;", "letbaseColor=textureSample(rainStreak,rainStreakSampler,input.uv);", "alpha*=baseColor.a;", "letemissiveColor=u.rainEmissive;",
      "letfinalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0))*baseColor.rgb;", "varcolor=vec4<f32>(finalDiffuse,alpha);",
      "color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);", "letfog=rainFogFactor(input.fogDistance,u.rainFogDensity);",
      "color=vec4<f32>(mix(u.rainFogColour,color.rgb,fog),color.a);", "color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);",
      "color=vec4<f32>(displayColour(color.rgb,u.rainExposure,u.rainContrast),color.a);",
      "color=vec4<f32>(mix(color.rgb,u.rainLampColour,input.rainLamp),color.a);", "color.a*=input.rainAlpha;", "returncolor;",
    ])).toBe(true);
    // One read of the sprite, at the level the streak's size on the screen picks.
    expect(RAIN_WGSL.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSample("]);
  });
});
