import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLLOW_FIGURE_M } from "../../../src/game/hollowLook.js";
import { SHADE_SMOKE_FEET, SHADE_SMOKE_FRAY, SHADE_SMOKE_RISE, SHADE_SMOKE_SCALE, SHADE_SMOKE_SOFT, SHADE_SMOKE_SWELL_M } from "../../../src/game/shadeMaskParams.js";
import { FRAME_BLOCK, SHADE_SMOKE_TIME_NAME, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import {
  SHADE_LOOK_FLOATS, SHADE_SMOKE_NOISE_WGSL, SHADE_SMOKE_VERTEX_WGSL, shadeMaskFragmentWgsl, shadeMaskPlugin, unseenPlugin, writeShadeLook,
} from "../../../src/game/lite/shadeMask.js";
import { tight } from "./wgslText.js";

const fx = (name: string): string => tight(readFileSync(new URL(`../../../src/game/shaders/${name}`, import.meta.url), "utf8"));
const SHARED = { name: FRAME_BLOCK } as never;

describe("the haunt's figures in their mask on Babylon Lite", () => {
  it("makes the smoke's noise as the game's stages do, statement for statement", () => {
    const g = fx("shadeSmokeNoise.fx");
    const w = tight(SHADE_SMOKE_NOISE_WGSL);
    expect(g).toContain(`constfloatSHADE_SMOKE_SCALE=${SHADE_SMOKE_SCALE};constfloatSHADE_SMOKE_RISE=${SHADE_SMOKE_RISE};constfloatSHADE_SMOKE_SOFT=${SHADE_SMOKE_SOFT};constfloatSHADE_SMOKE_FEET=${SHADE_SMOKE_FEET};`);
    expect(w).toContain(`constSHADE_SMOKE_SCALE:f32=${SHADE_SMOKE_SCALE};constSHADE_SMOKE_RISE:f32=${SHADE_SMOKE_RISE};constSHADE_SMOKE_SOFT:f32=${SHADE_SMOKE_SOFT};constSHADE_SMOKE_FEET:f32=${SHADE_SMOKE_FEET};`);
    for (const [a, b] of [
      ["p=fract(p*0.3183099+vec3(0.1,0.2,0.3));p*=17.0;returnfract(p.x*p.y*p.z*(p.x+p.y+p.z));", "varp=fract(q*0.3183099+vec3<f32>(0.1,0.2,0.3));p*=17.0;returnfract(p.x*p.y*p.z*(p.x+p.y+p.z));"],
      ["returnmix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);", "returnmix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);"],
      ["floatv=0.5*shadeSmokeNoise(p);v+=0.25*shadeSmokeNoise(p*2.03+vec3(1.7,9.2,4.4));v+=0.125*shadeSmokeNoise(p*4.01+vec3(8.3,2.8,6.1));returnv/0.875;", "varv=0.5*shadeSmokeNoise(p);v+=0.25*shadeSmokeNoise(p*2.03+vec3<f32>(1.7,9.2,4.4));v+=0.125*shadeSmokeNoise(p*4.01+vec3<f32>(8.3,2.8,6.1));returnv/0.875;"],
      ["returnworld*SHADE_SMOKE_SCALE+vec3(0.0,-seconds*SHADE_SMOKE_RISE*SHADE_SMOKE_SCALE,0.0);", "returnworld*SHADE_SMOKE_SCALE+vec3<f32>(0.0,-seconds*SHADE_SMOKE_RISE*SHADE_SMOKE_SCALE,0.0);"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
  });

  it("swells the outline along the normal and hands the place it came to on, with the figure's own values", () => {
    expect(fx("shadeSmokeWorldPos.vertex.fx")).toContain("floatshadeSmokeSwell=shadeSmokeFbm(shadeSmokeAt(worldPos.xyz,shadeSmoke.y)*0.5+vec3(shadeSmoke.y*0.11,0.0,shadeSmoke.y*0.07))-0.5;worldPos.xyz+=vNormalW*shadeSmokeSwell*2.0*shadeSmokeEdge.y;");
    const w = tight(SHADE_SMOKE_VERTEX_WGSL);
    expect(w).toContain(`letshadeSmokeSwell=shadeSmokeFbm(shadeSmokeAt(w,shadeSmokeTime)*0.5+vec3<f32>(shadeSmokeTime*0.11,0.0,shadeSmokeTime*0.07))-0.5;w+=normalize(out.worldNormal)*shadeSmokeSwell*2.0*${SHADE_SMOKE_SWELL_M};`);
    expect(w).toContain("out.worldPos=w;out.clipPos=scene.viewProjection*vec4<f32>(w,1.0);out.vShadeLook=shadeLook;out.vShadeFeet=shadeFeet.xy;");
    // The smoke's clock is the frame's block's.
    expect(inFrameBlock(SHADE_SMOKE_TIME_NAME)).toBe(true);
    expect(SHADE_SMOKE_VERTEX_WGSL).toContain(`${FRAME_BLOCK}.${SHADE_SMOKE_TIME_NAME}`);
  });

  it("keeps the figure where the smoke has it, as the game's fragment does, on its alpha", () => {
    const g = fx("shadeSmokeColour.fragment.fx");
    const w = tight(shadeMaskFragmentWgsl(true));
    for (const [a, b] of [
      ["floatshadeSmokeUp=clamp((vPositionW.y-shadeSmoke.z)/max(shadeSmoke.w,0.01),0.0,1.0);", "letshadeSmokeUp=clamp((vPositionW.y-shadeSmoke.z)/max(shadeSmoke.w,0.01),0.0,1.0);"],
      ["floatshadeSmokeN=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y));floatshadeSmokeCut=0.75*shadeSmokeN+0.25*shadeSmokeUp;", "letshadeSmokeN=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y));letshadeSmokeCut=0.75*shadeSmokeN+0.25*shadeSmokeUp;"],
      ["floatshadeSmokeIn=mix(-SHADE_SMOKE_SOFT,1.0+SHADE_SMOKE_SOFT,shadeSmoke.x);", "letshadeSmokeIn=mix(-SHADE_SMOKE_SOFT,1.0+SHADE_SMOKE_SOFT,shadeSmoke.x);"],
      ["floatshadeSmokeKeep=smoothstep(shadeSmokeCut-SHADE_SMOKE_SOFT,shadeSmokeCut+SHADE_SMOKE_SOFT,shadeSmokeIn);", "varshadeSmokeKeep=smoothstep(shadeSmokeCut-SHADE_SMOKE_SOFT,shadeSmokeCut+SHADE_SMOKE_SOFT,shadeSmokeIn);"],
      ["floatshadeSmokeRim=1.0-abs(dot(normalW,viewDirectionW));", "letshadeSmokeRim=1.0-abs(dot(normalW,viewDirectionW));"],
      ["floatshadeSmokeFray=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y*1.7)*2.0+vec3(shadeSmoke.y*0.23,0.0,shadeSmoke.y*0.17));", "letshadeSmokeFray=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y*1.7)*2.0+vec3<f32>(shadeSmoke.y*0.23,0.0,shadeSmoke.y*0.17));"],
      ["shadeSmokeKeep*=1.0-shadeSmokeEdge.x*smoothstep(0.35,0.9,shadeSmokeRim+(shadeSmokeFray-0.5)*0.9);", `shadeSmokeKeep*=1.0-${SHADE_SMOKE_FRAY}*smoothstep(0.35,0.9,shadeSmokeRim+(shadeSmokeFray-0.5)*0.9);`],
      ["shadeSmokeKeep*=smoothstep(0.0,SHADE_SMOKE_FEET,shadeSmokeUp);color.a*=shadeSmokeKeep;", "shadeSmokeKeep*=smoothstep(0.0,SHADE_SMOKE_FEET,shadeSmokeUp);shadeAlpha*=shadeSmokeKeep;"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
    expect(w).toContain("returnvec4<f32>(shadeColour,shadeAlpha);");
  });

  it("hands the figure's colour on in linear light under a post chain, and through the material colour path where there is none", () => {
    const raised = "varshadeColour=pow(clamp(vec3<f32>(input.vShadeLook.x,0.0,input.vShadeLook.y),vec3<f32>(0.0),vec3<f32>(1.0)),vec3<f32>(2.2));";
    expect(tight(shadeMaskFragmentWgsl(true))).toContain(raised);
    expect(tight(shadeMaskFragmentWgsl(true))).not.toContain("displayColour(");
    expect(tight(shadeMaskFragmentWgsl(false))).toContain(`${raised}shadeColour=displayColour(shadeColour,${FRAME_BLOCK}.frameExposure,${FRAME_BLOCK}.frameContrast);`);
    const material = shadeMaskPlugin(SHARED, false).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(material).toContain("fn displayColour(");
    expect(shadeMaskPlugin(SHARED, true).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_DEFINITIONS).not.toContain("fn displayColour(");
    expect(shadeMaskPlugin(SHARED, true).defines).toEqual({ linear: true });
  });

  it("reads a figure's own values from its instance: eight floats, as two vectors", () => {
    const plugin = shadeMaskPlugin(SHARED, true);
    expect(plugin.getInstanceAttributes?.()).toEqual([
      { name: "shadeLook", type: "vec4<f32>", format: "float32x4", stride: 32, offset: 0 }, { name: "shadeFeet", type: "vec4<f32>", format: "float32x4", stride: 32, offset: 16 },
    ]);
    expect(SHADE_LOOK_FLOATS).toBe(8);
    expect(plugin.getVaryings?.()).toEqual([{ name: "vShadeLook", type: "vec4<f32>" }, { name: "vShadeFeet", type: "vec2<f32>" }]);
    expect(plugin.getUniformBlocks?.()).toEqual([SHARED]);
    const out = new Float32Array(SHADE_LOOK_FLOATS * 2);
    expect(writeShadeLook(out, 1, { fade: 0.75, presence: 0.25, soft: 0.5, near: 0.5, feetY: 140 })).toBe(true);
    expect([...out.subarray(8)]).toEqual([0.25, 0.5, 0.75, 0.25, 140, Math.fround(HOLLOW_FIGURE_M), 0, 0]);
    expect([...out.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // The same values again change nothing, and nothing is sent.
    expect(writeShadeLook(out, 1, { fade: 0.75, presence: 0.25, soft: 0.5, near: 0.5, feetY: 140 })).toBe(false);
    expect(writeShadeLook(out, 1, { fade: 0.8, presence: 0.25, soft: 0.5, near: 0.5, feetY: 140 })).toBe(true);
  });

  it("puts a body's every vertex at one point outside the view in the frame's own pass", () => {
    const plugin = unseenPlugin();
    expect(plugin.getCustomCode?.("vertex")).toEqual({ CUSTOM_VERTEX_MAIN_END: "out.clipPos=vec4<f32>(2.0,2.0,2.0,1.0);" });
    expect(plugin.getCustomCode?.("fragment")).toBeNull();
    expect(plugin.priority).toBeGreaterThan(900);
  });
});
