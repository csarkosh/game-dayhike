import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_BLOCK, stageOwn, stageReads } from "../../../src/game/lite/frameBlock.js";
import { SPLASH_WGSL } from "../../../src/game/lite/rainSplash.js";
import { SPRAY_FRAME_READS, SPRAY_WGSL } from "../../../src/game/lite/surfSpray.js";
import { SURF_SPRAY_BURSTS, emptySprayUniforms, sprayBurstName } from "../../../src/game/sprayField.js";
import { inOrder, tight } from "./wgslText.js";

const fx = (name: string): string => readFileSync(new URL(`../../../src/game/shaders/${name}`, import.meta.url), "utf8");
const GLSL_VERTEX = fx("surfSpray.vertex.fx");
const GLSL_FRAGMENT = fx("surfSpray.fragment.fx");
const VERTEX = tight(SPRAY_WGSL.vertex);
const FRAGMENT = tight(SPRAY_WGSL.fragment);

/** A GLSL expression of the spray's stage as the WGSL writes it. */
function expr(glsl: string): string {
  return tight(glsl)
    .replace(/vec([234])\(/g, "vec$1<f32>(")
    .replace(/\bcorner\./g, "input.position.")
    .replace(/\bsurfSprayWind\b/g, "u.sprayWind")
    .replace(/\bsurfSprayCam\b/g, "u.sprayCam")
    .replace(/\bint\(/g, "i32(");
}

describe("the surf's spray on Babylon Lite", () => {
  it("holds the plugin's constants at the plugin's values", () => {
    const constants = [...(GLSL_VERTEX + GLSL_FRAGMENT).matchAll(/const float ([A-Z_]+) = ([0-9.]+);/g)];
    expect(constants.map((c) => c[1])).toEqual([
      "SURF_SPRAY_G", "SURF_SPRAY_DRAG", "SURF_SPRAY_LIFE_MIN", "SURF_SPRAY_LIFE_MAX", "SURF_SPRAY_SIZE", "SURF_SPRAY_STRETCH", "SURF_SPRAY_ELEVATION_MIN",
      "SURF_SPRAY_ELEVATION_MAX", "SURF_SPRAY_SPEED_MIN", "SURF_SPRAY_OPACITY",
    ]);
    for (const [, name, value] of constants) expect(Number(new RegExp(`const${name}:f32=([0-9.]+);`).exec(VERTEX + FRAGMENT)?.[1]), name).toBe(Number(value));
  });

  it("places a sprite as the plugin's sprayPlace does, statement for statement, in its order", () => {
    const body = GLSL_VERTEX.slice(GLSL_VERTEX.indexOf("vec4 sprayPlace(vec2 corner) {"), GLSL_VERTEX.indexOf("#endif"));
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => /^(int|float|vec[234])\s+\w+\s*=/.test(l));
    expect(lines.length).toBe(21);
    const expected = lines.map((l) => {
      const m = /^(?:int|float|vec[234])\s+(\w+)\s*=\s*(.*);$/.exec(l) as RegExpExecArray;
      return `let${m[1]}=${expr(m[2] as string)};`;
    });
    expect(inOrder(VERTEX, expected), expected.find((e) => !VERTEX.includes(e))).toBe(true);
    // What the function returns: the corner's place in the world, and the sprite's alpha.
    expect(tight(body)).toContain("returnvec4(p+(right*corner.x+up*corner.y)*size,(1.0-lived)*alive);");
    expect(VERTEX).toContain("letsprayAt=vec4<f32>(p+(right*input.position.x+up*input.position.y)*size,(1.0-lived)*alive);");
    // And what the plugin does with it at the position's point.
    expect(inOrder(VERTEX, ["letpositionUpdated=sprayAt.xyz;", "out.sprayAlpha=sprayAt.w;", "out.sprayUv=input.position.xy+0.5;"])).toBe(true);
  });

  it("reads a sprite's seed and its slot from its instance, and the slots from a name a vec4", () => {
    expect(VERTEX).toContain("letspraySeed=input.world0;letsprayBurst=input.world1.x;");
    const names = Array.from({ length: SURF_SPRAY_BURSTS * 2 }, (_, i) => `u.${sprayBurstName(i)}`).join(",");
    expect(VERTEX).toContain(`varsurfSprayBursts=array<vec4<f32>,${SURF_SPRAY_BURSTS * 2}>(${names});`);
    expect(Object.keys(emptySprayUniforms()).filter((name) => name.startsWith("sprayBurst")).length).toBe(SURF_SPRAY_BURSTS * 2);
  });

  it("covers a sprite with the plugin's soft disc, on the alpha, after the Standard material's colour as the splashes' stage has it", () => {
    expect(tight(GLSL_FRAGMENT)).toContain("floatd=length(vSprayUv-0.5)*2.0;return(1.0-smoothstep(0.0,1.0,d))*vSprayAlpha*SURF_SPRAY_OPACITY;");
    expect(FRAGMENT).toContain("letd=length(vSprayUv-0.5)*2.0;return(1.0-smoothstep(0.0,1.0,d))*vSprayAlpha*SURF_SPRAY_OPACITY;");
    expect(FRAGMENT).toContain("color.a*=sprayCover(input.sprayUv,input.sprayAlpha);returncolor;");
    // The same unlit, fogged, emissive Standard material the splashes are drawn with: its lines, under the spray's names.
    const splash = tight(SPLASH_WGSL.fragment);
    const lines = [
      "letalpha=1.0;", "letfinalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));", "varcolor=vec4<f32>(finalDiffuse,alpha);",
      "color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);", "color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);",
    ];
    for (const line of lines) {
      expect(splash, line).toContain(line);
      expect(FRAGMENT, line).toContain(line);
    }
    expect(inOrder(FRAGMENT, [
      "letemissiveColor=u.sprayEmissive;", ...lines.slice(1, 4), "color=vec4<f32>(mix(u.sprayFogColour,color.rgb,fog),color.a);", lines[4] as string,
      "color=vec4<f32>(displayColour(color.rgb,u.sprayExposure,u.sprayContrast),color.a);", "color.a*=sprayCover(",
    ])).toBe(true);
  });

  it("reads the eye, the scene's fog and the display curve from the frame's block, and keeps the slots, the wind and the colour its own", () => {
    const own = stageOwn(emptySprayUniforms(), SPRAY_FRAME_READS);
    expect(Object.keys(own).sort()).toEqual([...Array.from({ length: SURF_SPRAY_BURSTS * 2 }, (_, i) => sprayBurstName(i)), "sprayEmissive", "sprayWind"].sort());
    const vertex = stageReads(SPRAY_WGSL.vertex, SPRAY_FRAME_READS);
    expect(vertex).toContain(`${FRAME_BLOCK}.fadeEye-p`);
    expect(vertex).not.toContain("u.sprayCam");
    const fragment = stageReads(SPRAY_WGSL.fragment, SPRAY_FRAME_READS);
    expect(fragment).toContain(`${FRAME_BLOCK}.atmFarColour`);
    expect(fragment).toContain(`${FRAME_BLOCK}.atmBaseDensity`);
    expect(fragment).not.toMatch(/u\.spray(FogColour|FogDensity|Exposure|Contrast)/);
  });
});
