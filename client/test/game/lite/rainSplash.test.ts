import { describe, expect, it } from "vitest";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/default.fragment.js";
import { SPLASH_WGSL } from "../../../src/game/lite/rainSplash.js";
import { SplashPlugin } from "../../../src/game/rainSplash.js";
import { emptySplashStageUniforms, emptySplashUniforms } from "../../../src/game/splashField.js";
import { inOrder, tight } from "./wgslText.js";

/** The splash plugin's own code at its points, and the Standard material's fragment stage, as installed. */
const code = (stage: "vertex" | "fragment"): Record<string, string> => SplashPlugin.prototype.getCustomCode.call({}, stage) as Record<string, string>;
const PLUGIN_DEFS = code("vertex")["CUSTOM_VERTEX_DEFINITIONS"] as string;
const PLUGIN_VERTEX = code("vertex")["CUSTOM_VERTEX_UPDATE_POSITION"] as string;
const PLUGIN_FRAGMENT = code("fragment")["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR"] as string;
const STANDARD = tight(ShaderStore.ShadersStore["defaultPixelShader"] as string);
const VERTEX = tight(SPLASH_WGSL.vertex);
const FRAGMENT = tight(SPLASH_WGSL.fragment);

const UNIFORMS = Object.keys(emptySplashUniforms());

/** A GLSL expression as the stage writes it. */
function expr(glsl: string): string {
  let out = tight(glsl).replace(/vec([234])\(/g, "vec$1<f32>(").replace(/(?<![\w.])position\./g, "input.position.");
  for (const name of UNIFORMS) out = out.replace(new RegExp(`(?<![\\w.])${name}(?!\\w)`, "g"), `u.${name}`);
  return out;
}

describe("the splashes' vertex stage on Babylon Lite", () => {
  it("keeps every line of the plugin's placement, in its order", () => {
    const lines = PLUGIN_VERTEX.split("\n").map((l) => l.trim()).filter((l) => /^(float|vec[234])\s/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(20);
    const expected = lines
      // The cycle's modulo and the map's read are written out below.
      .filter((l) => !l.startsWith("float sCycle") && !l.startsWith("vec4 sMap"))
      .map((l) => {
        const m = /^(?:float|vec[234])\s+(\w+)\s*=\s*(.*);$/.exec(l) as RegExpExecArray;
        return `let${m[1]}=${expr(m[2] as string)};`;
      });
    expect(inOrder(VERTEX, expected), expected.find((e) => !VERTEX.includes(e))).toBe(true);
  });

  it("counts the cycle modulo the fold's cycles as GLSL's mod does, and reads the map's nearest texel at the ring's place", () => {
    expect(PLUGIN_VERTEX).toContain("float sCycle = mod(floor(sT), 300.0);");
    expect(VERTEX).toContain("letsCycle=floor(sT)-300.0*floor(floor(sT)/300.0);");
    expect(PLUGIN_VERTEX).toContain("vec4 sMap = texture2D(splashMapSampler, sMu);");
    expect(VERTEX).toContain("letsMap=textureLoad(splashMap,vec2<i32>(clamp(sMu*512.0,vec2<f32>(0.0),vec2<f32>(511.0))),0);");
  });

  it("hashes a cycle as the plugin does", () => {
    expect(tight(PLUGIN_DEFS)).toContain(
      "vec2splashHash(vec2p){vec3p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yzx+33.33);returnfract((p3.xx+p3.yz)*p3.zy);}",
    );
    expect(VERTEX).toContain(
      "fnsplashHash(p:vec2<f32>)->vec2<f32>{varp3=fract(vec3<f32>(p.xyx)*vec3<f32>(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yzx+33.33);returnfract((p3.xx+p3.yz)*p3.zy);}",
    );
  });

  it("writes the position and the three varyings as the plugin does, then the Standard material's own", () => {
    const line = (start: string): string => (PLUGIN_VERTEX.split("\n").map((l) => l.trim()).find((l) => l.startsWith(start)) as string).replace(/;$/, "");
    expect(VERTEX).toContain(`let${expr(line("positionUpdated"))};`);
    expect(VERTEX).toContain(`out.splashAlpha=${expr(line("vSplashAlpha").slice("vSplashAlpha = ".length))};`);
    expect(VERTEX).toContain("out.splashPhase=sPhase;");
    expect(VERTEX).toContain("out.splashUv=input.position.xy+0.5;");
    expect(inOrder(VERTEX, [
      "letsplashSeed=input.world0;", "letworldPos=vec4<f32>(positionUpdated,1.0);", "out.position=shaderSystem.viewProjection*worldPos;",
      "out.fogDistance=(shaderSystem.view*worldPos).xyz;",
    ])).toBe(true);
  });

  it("reads every uniform the rings are drawn with, and no other", () => {
    const read = (wgsl: string): string[] => [...wgsl.matchAll(/\bu\.(\w+)/g)].map((m) => m[1] as string);
    expect([...new Set([...read(SPLASH_WGSL.vertex), ...read(SPLASH_WGSL.fragment)])].sort()).toEqual(Object.keys(emptySplashStageUniforms()).sort());
    expect([...new Set(read(SPLASH_WGSL.vertex))].sort()).toEqual([...UNIFORMS].sort());
  });
});

describe("the splashes' fragment stage on Babylon Lite", () => {
  it("composes the colour in the Standard material's order with no texture, then the plugin's ring on the alpha", () => {
    expect(inOrder(STANDARD, [
      "vec3emissiveColor=vEmissiveColor;", "vec3finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;",
      "color.rgb=max(color.rgb,0.);", "#include<fogFragment>", "color.rgb=toLinearSpace(color.rgb);color=applyImageProcessing(color);", "color.a*=visibility;",
      "#defineCUSTOM_FRAGMENT_BEFORE_FRAGCOLOR",
    ])).toBe(true);
    expect(tight(PLUGIN_FRAGMENT)).toContain(
      "floatsD=length(vSplashUv-0.5)*2.0;floatsRing=1.0-smoothstep(0.0,0.15,abs(sD-(0.3+0.7*vSplashPhase)));color.a*=sRing*vSplashAlpha;",
    );
    expect(inOrder(FRAGMENT, [
      "letalpha=1.0;", "letemissiveColor=u.splashEmissive;", "letfinalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));",
      "varcolor=vec4<f32>(finalDiffuse,alpha);", "color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);",
      "letfog=splashFogFactor(input.fogDistance,u.splashFogDensity);", "color=vec4<f32>(mix(u.splashFogColour,color.rgb,fog),color.a);",
      "color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);", "color=vec4<f32>(displayColour(color.rgb,u.splashExposure,u.splashContrast),color.a);",
      "letsD=length(input.splashUv-0.5)*2.0;", "letsRing=1.0-smoothstep(0.0,0.15,abs(sD-(0.3+0.7*input.splashPhase)));", "color.a*=sRing*input.splashAlpha;",
      "returncolor;",
    ])).toBe(true);
    // No texture is read: the ring is drawn from the quad's own coordinates.
    expect(SPLASH_WGSL.fragment).not.toMatch(/textureSample|textureLoad/);
  });
});
