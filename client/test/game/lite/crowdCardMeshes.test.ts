import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "../../../src/game/dayhikeAssets.js";
import "../../../src/sim/passes/index.js";
import { CROWD_CARD_WGSL, CROWD_PASS } from "../../../src/game/lite/crowdCardMeshes.js";
import { CROWD_CARD_WIDE } from "../../../src/game/crowdCards.js";
import { tight } from "./wgslText.js";

const src = readFileSync(new URL("../../../src/game/lite/crowdCardMeshes.ts", import.meta.url), "utf8");
const mask = readFileSync(new URL("../../../../engine/src/game/lite/shadeMask.ts", import.meta.url), "utf8");
const VERTEX = tight(CROWD_CARD_WGSL.vertex);
const FRAGMENT = tight(CROWD_CARD_WGSL.fragment);

describe("the crowd's cards' stages on Babylon Lite", () => {
  it("stands a card upright on its figure's feet, turned about the vertical to the camera by the scene's view, half as wide as it is tall", () => {
    expect(VERTEX).toContain("letcrowdCard=input.color;");
    // The camera's right in the world, laid flat.
    expect(VERTEX).toContain("varright=vec2<f32>(scene.view[0][0],scene.view[2][0]);right=right/max(length(right),0.0001);");
    // The corner's x carries the figure's reach in its length (crowdCards.ts): its sign is the corner. And the card
    // of one that reaches is as wide again, for its arms to open in.
    expect(VERTEX).toContain("letcorner=sign(crowdCard.x);");
    expect(VERTEX).toContain("letreach=clamp(abs(crowdCard.x)-1.0,0.0,1.0);");
    expect(VERTEX).toContain("letacross=right*(corner*crowdCard.z*0.25*(1.0+reach));");
    expect(VERTEX).toContain("out.card=vec4<f32>(corner,crowdCard.y,crowdCard.z,crowdCard.w);");
    expect(VERTEX).toContain("out.reach=reach;");
    expect(CROWD_CARD_WIDE / 2).toBe(0.25);
    expect(VERTEX).toContain("at=vec3<f32>(at.x+across.x,at.y+crowdCard.y*crowdCard.z,at.z+across.y);");
    expect(VERTEX).toContain("out.position=scene.viewProjection*vec4<f32>(at,1.0);");
    expect(VERTEX).toContain("out.stir=input.uv;");
  });

  it("draws the figure's shape in shares of its height, the same on both sides of its middle, leaning on a beat of its own, its feet lost in the mist", () => {
    expect(FRAGMENT).toContain("letreach=input.reach;");
    expect(FRAGMENT).toContain("varp=vec2<f32>(vCard.x*0.25*(1.0+reach),vCard.y);");
    expect(FRAGMENT).toContain("p.x-=sin(u.crowdTime*vStir.y+vStir.x)*0.012*p.y;");
    expect(FRAGMENT).toContain("letq=vec2<f32>(abs(p.x),p.y);");
    // A torso, a head, a leg, an arm with its hand and three strokes of antler.
    expect(CROWD_CARD_WGSL.fragment.match(/d=min\(d,/g)).toHaveLength(7);
    expect(FRAGMENT).toContain("letfeet=smoothstep(0.0,0.14,p.y);");
    expect(FRAGMENT).toContain("letshape=body*feet*vCard.w;");
  });

  it("opens both arms wide round whoever stands in front of it as the figure reaches: each hand from its side out to an eye's height, well clear of the body, opening as it comes", () => {
    expect(FRAGMENT).toContain("lethand=mix(vec2<f32>(0.135,0.33),vec2<f32>(0.3,0.5),reach);");
    // The same shoulder as the arm that hangs; and the arm is drawn once, mirrored, so both come up together.
    expect(FRAGMENT).toContain("d=min(d,crowdLimb(q,vec2<f32>(0.105,0.64),hand)-mix(0.024,0.03,reach));");
    expect(FRAGMENT).toContain("d=min(d,length(q-hand)-0.045*reach);");
  });

  it("is a shade in the mask's red, and in the frame a dark body with a faint, wide rim the mist lights, premultiplied", () => {
    expect(FRAGMENT).toContain("letinMask=vec4<f32>(1.0,0.0,0.0,shape);");
    // The rim is brighter on one that reaches, so its arms are read against the dark of the woods.
    expect(FRAGMENT).toContain("letinFrame=vec4<f32>(u.crowdTint*(0.05+(0.2+0.6*reach)*rim)*shape,shape*0.75);");
    expect(FRAGMENT).toContain("returnmix(inMask,inFrame,u.crowdPass);");
    expect(CROWD_PASS).toEqual({ mask: 0, frame: 1 });
    const read = new Set([...CROWD_CARD_WGSL.fragment.matchAll(/\bu\.(crowd\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(["crowdPass", "crowdTime", "crowdTint"]);
    expect(CROWD_CARD_WGSL.vertex).not.toMatch(/shaderUniforms/);
  });
});

describe("the crowd's cards on Babylon Lite", () => {
  it("is one mesh with two materials of one pair of stages: the frame's premultiplied as the way's mist is, the mask's blended as a shade is", () => {
    expect(src.match(/createMeshFromData\(/g)).toHaveLength(1);
    expect(src).toContain('const material = make("crowdCards", frameValues, { blend: PREMULTIPLIED_BLEND });');
    expect(src).toContain('const maskMaterial = make("crowdCardsMask", maskValues, { blendMode: "alpha" });');
    expect(src).toContain("crowdPass: [CROWD_PASS.frame]");
    expect(src).toContain("crowdPass: [CROWD_PASS.mask]");
    expect(src).toContain('attributes: ["position", "uv", "color"],');
    expect(src).toContain("depthWrite: false,");
    expect(src).toContain("backFaceCulling: false,");
    expect(src).toContain("mesh.material = material;");
    // Before the mist among the frame's see-through draws, so the mist veils it and it stands in the mist, never on it.
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.crowdCards;");
  });

  it("is hidden with no card, and sends its vertices, the clock and the rim's colour only on a frame with one", () => {
    expect(src).toContain("const drawn = writeCrowdCards(vertices, most, figures, heights, eye, seconds, skip, from, to);\n      const now = drawn > 0;");
    expect(src).toContain("if (now) {\n        updateMeshPositions(engine, mesh, vertices.positions);\n        updateMeshColors(engine, mesh, vertices.cards);\n        updateMeshUvs(engine, mesh, vertices.stirs);");
    expect(src).toContain("const time = crowdCardTime(seconds);\n        frameValues.crowdTime[0] = time;\n        maskValues.crowdTime[0] = time;");
    expect(src).toContain("frameValues.crowdTint[0] = tint[0];");
  });

  it("is drawn in the shade mask with the mask's material in place of its own, and brings the mask up while a card is, with or without a figure", () => {
    expect(mask).toContain("addMeshToTask(task, mesh, { material: cardMaterial });");
    expect(mask).toContain("figures = anyNow && count > 0 && looks.size > 0;\n      any = figures || cardsUp;\n      task.enabled = any;");
    expect(mask).toContain("cardsUp = up && cardsMesh !== null;\n      any = figures || cardsUp;\n      task.enabled = any;");
    expect(mask).toContain("if (cardsMesh !== null) removeMeshFromTask(task, cardsMesh);");
  });
});
