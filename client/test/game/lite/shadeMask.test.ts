import { readFileSync } from "node:fs";
import { acquireTexture, releaseTexture } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { HOLLOW_FIGURE_M } from "../../../src/game/hollowLook.js";
import { SHADE_SMOKE_FEET, SHADE_SMOKE_FRAY, SHADE_SMOKE_RISE, SHADE_SMOKE_SCALE, SHADE_SMOKE_SOFT, SHADE_SMOKE_SWELL_M } from "../../../src/game/shadeMaskParams.js";
import { FRAME_BLOCK, SHADE_SMOKE_TIME_NAME, inFrameBlock } from "../../../src/game/lite/frameBlock.js";
import {
  SHADE_LOOK_FLOATS, SHADE_SMOKE_NOISE_WGSL, SHADE_SMOKE_VERTEX_WGSL, createMaskTargets, shadeMaskFragmentWgsl, shadeMaskPlugin, writeShadeLook,
  type MaskTargets,
} from "../../../src/game/lite/shadeMask.js";
import { binder, picture, type FakePicture } from "./textureClaims.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { tight } from "./wgslText.js";

const src = readFileSync(new URL("../../../src/game/lite/shadeMask.ts", import.meta.url), "utf8");
/** One of the smoke's stages on Babylon.js (named `<name>.fx`, kept as `stages/<name>.glsl`), its text recorded, with no white space. */
const fx = (name: string): string => tight(babylonText(`stages/${name.replace(/\.fx$/, ".glsl")}`));
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
    expect(tight(shadeMaskFragmentWgsl(false))).toContain(`${raised}shadeColour=gradeCurves(displayColour(shadeColour,${FRAME_BLOCK}.frameExposure,${FRAME_BLOCK}.frameContrast));`);
    const material = shadeMaskPlugin(SHARED, false).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(material).toContain("fn displayColour(");
    expect(material).toContain("fn gradeCurves(");
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

  it("draws a body in the mask's pass alone: the body stands hidden, and the mask shows it by its own word", () => {
    const read = (name: string): string => readFileSync(new URL(`../../../src/game/lite/${name}`, import.meta.url), "utf8");
    // The mask's pass draws what it is handed whatever the mesh's own word.
    expect(src).toContain("      addMeshToTask(task, mesh, { material });\n      setTaskMeshVisible(task, mesh, true);");
    // A Hollow's body is the mask's alone, and a model never shows such a primitive: no pass of the frame draws it,
    // as nothing or otherwise, and its own material wears no plugin for that.
    expect(read("entityMeshes.ts")).toContain("        if (mask === null) return false;\n        part.elsewhere = true;\n        bodyMeshes.push(part.mesh);");
    expect(read("skinnedModels.ts")).toContain("for (const part of parts) if (part.drawn && !part.elsewhere) setMeshVisible(part.mesh, next > 0);");
    expect(read("skinnedModels.ts").split("setMeshVisible(").length).toBe(3);
    expect(src).not.toContain("Unseen");
    expect(read("entityMeshes.ts")).not.toContain("unseenPlugin");
  });
});

describe("the mask's targets on Babylon Lite", () => {
  /** Targets as Lite's with a picture are: Lite claims a target's texture when it makes it, and lets that claim go when the target is disposed. */
  const lites = (): { targets: MaskTargets<FakePicture>; made: FakePicture[] } => {
    const made: FakePicture[] = [];
    const targets = createMaskTargets<FakePicture>(
      512, 256,
      () => {
        const target = picture();
        acquireTexture(target);
        made.push(target);
        return target;
      },
      (target) => void releaseTexture(target),
    );
    return { targets, made };
  };

  it("keeps its target when the frame's passes are recorded again at the same size: a hiker's lamp joining makes no texture", () => {
    const { targets, made } = lites();
    const first = targets.current;
    for (let recording = 0; recording < 10; recording++) {
      expect(targets.fit(512, 256)).toBe(false);
      targets.settle();
    }
    expect(targets.current).toBe(first);
    expect(made).toEqual([first]);
    expect(first.texture.destroyed).toBe(false);
  });

  it("makes another target only when the mask's size moves, and lets the one it replaced go the frame after, not before", () => {
    const { targets, made } = lites();
    const first = targets.current;
    expect(targets.fit(512, 512)).toBe(true);
    const second = targets.current;
    expect(second).not.toBe(first);
    expect(made).toEqual([first, second]);
    // The frame that fitted the window is drawn with whatever was handed the first picture: it stands.
    expect(first.texture.destroyed).toBe(false);
    targets.settle();
    expect(first.texture.destroyed).toBe(true);
    expect(second.texture.destroyed).toBe(false);
    // Fitted twice before a frame: both replaced targets go with that frame, and the last stands.
    expect(targets.fit(256, 256)).toBe(true);
    expect(targets.fit(512, 256)).toBe(true);
    expect(made).toHaveLength(4);
    expect(made.map((target) => target.texture.destroyed)).toEqual([true, false, false, false]);
    targets.settle();
    expect(made.map((target) => target.texture.destroyed)).toEqual([true, true, true, false]);
    expect(targets.current).toBe(made[3]);
  });

  it("never leaves the veil with a destroyed texture: when a light joins, on the frame the window is fitted, and after it", () => {
    const { targets } = lites();
    // The veil's material, bound each frame to the picture the mask hands out: Lite claims what it binds.
    const bind = binder();
    const frame = (): FakePicture => {
      targets.settle();
      bind(targets.current);
      return targets.current;
    };
    const first = frame();
    // A light joins: the passes are recorded again, and the frames after read the same texture, alive.
    expect(targets.fit(512, 256)).toBe(false);
    expect(frame()).toBe(first);
    expect(first.texture.destroyed).toBe(false);
    // The window is fitted after the veil was bound for the frame: that frame reads the first picture, which stands.
    expect(targets.fit(512, 512)).toBe(true);
    expect(first.texture.destroyed).toBe(false);
    // The frame after reads the second, and the first goes only now that nothing holds it.
    const second = frame();
    expect(second).not.toBe(first);
    expect(first.texture.destroyed).toBe(true);
    expect(second.texture.destroyed).toBe(false);
    // And so on through joins and fittings: what is read is alive.
    for (const [width, height] of [[512, 512], [256, 256], [256, 256], [512, 256]] as const) {
      const before = targets.current;
      targets.fit(width, height);
      expect(before.texture.destroyed).toBe(false);
      expect(frame().texture.destroyed).toBe(false);
    }
  });

  it("never leaves the grade, which claims nothing, with a destroyed texture either", () => {
    const { targets } = lites();
    let read = targets.current;
    expect(targets.fit(512, 512)).toBe(true);
    // The frame that fitted the window: the grade's pass reads what it was handed before.
    expect(read.texture.destroyed).toBe(false);
    targets.settle();
    read = targets.current;
    expect(read.texture.destroyed).toBe(false);
  });

  it("hands out a picture that names one texture: Lite lets a claim go on whatever texture a picture names at that moment", () => {
    // What went wrong with a picture that named whatever the target held: bound, it claimed the first texture; the
    // target was made again; unbound, the claim let go was the second texture's, which nobody had claimed, and Lite
    // destroys a texture at its last release.
    const first = picture().texture;
    const second = picture().texture;
    let held = first;
    const whatever = { get texture() { return held; }, view: {} } as unknown as FakePicture;
    acquireTexture(whatever);
    held = second;
    releaseTexture(whatever);
    expect(second.destroyed).toBe(true);
    // The targets' own: a picture is one object for one texture, and another target's is another object.
    const { targets } = lites();
    const one = targets.current;
    const texture = one.texture;
    targets.fit(512, 512);
    expect(one.texture).toBe(texture);
    expect(targets.current).not.toBe(one);
    expect(targets.current.texture).not.toBe(texture);
    expect(src).toContain("createRenderTargetTexture(engine, { lbl: \"shade_mask\"");
    expect(src).not.toContain("_colorTexture");
  });
});
