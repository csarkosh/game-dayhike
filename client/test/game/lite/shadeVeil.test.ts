import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK } from "@csarkosh/engine/game/postFrame";
import { GRADE_SHADE_BLOCK, GRADE_STARE_BLOCK, VEIL_GAMMA } from "@csarkosh/engine/game/shadeVeilParams";
import { SHADE_BLOCK_WGSL, STARE_BLOCK_WGSL, gradeWgsl } from "@csarkosh/engine/game/lite/postWgsl";
import { SHADE_VEIL_WGSL, holdTexture, veilShown, veilUniforms } from "@csarkosh/engine/game/lite/shadeVeil";
import { binder, picture } from "./textureClaims.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { tight } from "./wgslText.js";

/** The veil's fragment stage on Babylon.js (`shadeVeil.fragment.glsl`), its text recorded. */
const GLSL = babylonText("stages/shadeVeil.fragment.glsl");
const src = readFileSync(new URL("../../../../engine/src/game/lite/shadeVeil.ts", import.meta.url), "utf8");

describe("the shade veil on Babylon Lite", () => {
  it("carries the grade's shade block and its stare block, the very text the grade's pass runs", () => {
    const veil = SHADE_VEIL_WGSL.fragment;
    expect(veil).toContain(SHADE_BLOCK_WGSL);
    expect(veil).toContain(STARE_BLOCK_WGSL);
    for (const halation of [false, true]) {
      expect(gradeWgsl(halation)).toContain(SHADE_BLOCK_WGSL);
      expect(gradeWgsl(halation)).toContain(STARE_BLOCK_WGSL);
    }
    // The blocks are the game's, from their first statement to their last, as the game's veil carries them.
    for (const line of [...GRADE_SHADE_BLOCK, ...GRADE_STARE_BLOCK]) expect(GLSL, line).toContain(line);
    expect(tight(SHADE_BLOCK_WGSL)).toContain("letshadeStep=vec2<f32>(u.shadeShape.x,u.shadeShape.x*u.shadeShape.z);");
    expect(tight(SHADE_BLOCK_WGSL)).toContain("c*=1.0-min(1.0,shadeRGB.x*u.shadeShape.y+shadeReal*u.shadeMonster)*shadeKeep;");
    expect(tight(STARE_BLOCK_WGSL)).toContain("letsp=centred-u.stareShade.xy;");
    expect(tight(STARE_BLOCK_WGSL)).toContain("c*=1.0-0.97*dark;");
  });

  it("starts from a factor of one and raises what the blocks leave to the display's gamma, as the game's veil does", () => {
    const glsl = tight(GLSL);
    const wgsl = tight(SHADE_VEIL_WGSL.fragment);
    expect(glsl).toContain("vec3c=vec3(1.0);vec2centred=(vUV-0.5)*2.0;");
    expect(wgsl).toContain("varc=vec3<f32>(1.0);letcentred=(vUV-0.5)*2.0;");
    expect(glsl).toContain("gl_FragColor=vec4(pow(c,vec3(0.45454545454545453)),1.0);");
    expect(wgsl).toContain(`returnvec4<f32>(pow(c,vec3<f32>(${VEIL_GAMMA})),1.0);`);
    // One triangle over the frame, at the near plane, its coordinates counting up from the frame's foot as the game's do.
    expect(tight(SHADE_VEIL_WGSL.vertex)).toContain("out.position=vec4<f32>(input.position.xy,1.0,1.0);out.vUV=input.position.xy*0.5+0.5;");
  });

  it("is multiplied into the frame, over everything, and writes no depth", () => {
    expect(src).toContain('color: { srcFactor: "dst", dstFactor: "zero", operation: "add" }');
    expect(src).toContain('depthCompare: "always"');
    expect(src).toContain("depthWrite: false");
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.veil;");
  });

  it("is drawn only where it darkens anything: a figure in the mask, or the stare closed at all", () => {
    const rest = { x: 0, y: 0, reach: 0, time: 0 };
    expect(veilShown(rest, false)).toBe(false);
    expect(veilShown(rest, true)).toBe(true);
    expect(veilShown({ x: 0.1, y: 0, reach: 0.2, time: 3 }, false)).toBe(true);
    expect(veilUniforms({ x: 0.1, y: -0.2, reach: 0.5, time: 7 }, true, 980, 637)).toEqual({
      shadeShape: [SHADE_BLUR, SHADE_DARK, 980 / 637, 1], shadeMonster: [SHADE_MONSTER_DARK], stareShade: [0.1, -0.2, 0.5, 7],
    });
    expect(veilUniforms(rest, false, 980, 637).shadeShape[3]).toBe(0);
  });

  it("holds the black texel through the mask's binding in its place, which is otherwise its last release", () => {
    // Lite destroys a texture when the last claim on it is let go, and a texel only the veil's material ever bound
    // has no other: the first figure in the mask would destroy it, and the stare's darkness read it after.
    const unheld = picture();
    const mask = picture();
    const loose = binder();
    loose(unheld);
    loose(mask);
    expect(unheld.texture.destroyed).toBe(true);
    // Held, it stands through every figure that comes and goes, and goes when the veil lets it.
    const black = picture();
    const letGo = holdTexture(black);
    const bind = binder();
    for (let figure = 0; figure < 3; figure++) {
      bind(black);
      bind(mask);
      expect(black.texture.destroyed).toBe(false);
    }
    letGo();
    expect(black.texture.destroyed).toBe(true);
    // Let go once and no more: the claim is one.
    const again = picture();
    const once = holdTexture(again);
    const other = holdTexture(again);
    once();
    once();
    expect(again.texture.destroyed).toBe(false);
    other();
    expect(again.texture.destroyed).toBe(true);
    // The veil holds its texel from the start and lets it go with itself.
    expect(src).toContain("const letGo = holdTexture(black);");
    expect(src).toContain("letGo();");
  });
});
