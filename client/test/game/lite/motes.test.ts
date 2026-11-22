import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { FRAME_BLOCK, stageClocks, stageOwn, stageReads } from "@csarkosh/engine/game/lite/frameBlock";
import { MOTES_FRAME_READS, MOTES_WGSL } from "@csarkosh/engine/game/lite/motes";
import { MOTE_SALT, emptyMoteUniforms } from "@csarkosh/engine/game/moteField";
import { inOrder, tight } from "@csarkosh/engine/testing/wgslText";

/** Babylon.js's particle stages, as it installs them (recorded). */
const PARTICLE_FRAGMENT = tight(babylonText("shaders/particlesPixelShader.glsl"));
const PARTICLE_VERTEX = tight(babylonText("shaders/particlesVertexShader.glsl"));
const VERTEX = tight(MOTES_WGSL.vertex);
const FRAGMENT = tight(MOTES_WGSL.fragment);

describe("the motes' stages on Babylon Lite", () => {
  it("colours a mote as Babylon's particle stage does on the material colour path: the sprite by the colour, to linear, the display curve", () => {
    expect(inOrder(PARTICLE_FRAGMENT, [
      "vec4textureColor=texture2D(diffuseSampler,vUV);", "vec4baseColor=(textureColor*textureMask+(vec4(1.,1.,1.,1.)-textureMask))*vColor;",
      "#ifdefIMAGEPROCESSINGbaseColor.rgb=toLinearSpace(baseColor.rgb);baseColor=applyImageProcessing(baseColor);", "gl_FragColor=baseColor;",
    ])).toBe(true);
    // The texture's mask is Babylon's default, all ones: the sprite itself.
    expect(inOrder(FRAGMENT, [
      "lettextureColor=textureSample(moteSprite,moteSpriteSampler,input.uv);", "varbaseColor=textureColor*input.colour;",
      "baseColor=vec4<f32>(pow(baseColor.rgb,vec3<f32>(2.2)),baseColor.a);",
      "baseColor=vec4<f32>(displayColour(baseColor.rgb,u.moteExposure,u.moteContrast),baseColor.a);", "returnbaseColor;",
    ])).toBe(true);
    // No fog: a particle system takes the scene's only where it is asked to.
    expect(MOTES_WGSL.fragment).not.toMatch(/fog/i);
  });

  it("lays the quad out in the view's space, facing the camera, as Babylon lays a particle's", () => {
    expect(PARTICLE_VERTEX).toContain("cornerPos=(vec2(offset.x-0.5,offset.y-0.5)-translationPivot)*size;");
    expect(PARTICLE_VERTEX).toContain("vec3viewPos=(view*vec4(position,1.0)).xyz+rotatedCorner;");
    expect(PARTICLE_VERTEX).toContain("gl_Position=projection*vec4(viewPos,1.0);");
    // A unit plane's corner is Babylon's offset less a half; no pivot, no turn.
    expect(inOrder(VERTEX, [
      "letcornerPos=input.position.xy*size;", "letviewPos=(scene.view*vec4<f32>(place,1.0)).xyz+vec3<f32>(cornerPos,0.0);",
      `${FRAME_BLOCK}.frameProjection*vec4<f32>(viewPos,1.0)`,
    ])).toBe(true);
    expect(VERTEX).toContain("out.uv=input.uv;");
  });

  it("reads every uniform the motes are drawn with, and no other", () => {
    const read = new Set([...`${MOTES_WGSL.vertex}${MOTES_WGSL.fragment}`.matchAll(/\bu\.(mote\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(emptyMoteUniforms()).sort());
  });

  it("is made reading its clock, the wind's carry and the display curve from the frame's block, its settings and colour its own", () => {
    const made = tight(`${stageReads(MOTES_WGSL.vertex, MOTES_FRAME_READS)}${stageReads(MOTES_WGSL.fragment, MOTES_FRAME_READS)}`);
    const own = ["moteColour", "moteFrostDrift", "moteFrostSpan", "motePollenDrift", "motePollenSpan"];
    expect([...new Set([...made.matchAll(/\bu\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(own);
    expect(Object.keys(stageOwn(emptyMoteUniforms(), MOTES_FRAME_READS)).sort()).toEqual(own);
    expect(Object.keys(stageClocks(emptyMoteUniforms()))).toEqual(["moteClock", "moteTravel"]);
    expect(made).toContain(`lett=${FRAME_BLOCK}.moteClock+moteRandom(slot,0u,${MOTE_SALT.phase}u)*life;`);
    expect(made).toContain(`letcarried=vec3<f32>(${FRAME_BLOCK}.moteTravel.x,0.0,${FRAME_BLOCK}.moteTravel.y);`);
    expect(made).toContain(`baseColor=vec4<f32>(displayColour(baseColor.rgb,${FRAME_BLOCK}.frameExposure,${FRAME_BLOCK}.frameContrast),baseColor.a);`);
  });
});
