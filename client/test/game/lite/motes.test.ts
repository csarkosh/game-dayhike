import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { FRAME_BLOCK, stageClocks, stageOwn, stageReads } from "@csarkosh/engine/game/lite/frameBlock";
import { MOTES_FRAME_READS, MOTES_WGSL } from "@csarkosh/engine/game/lite/motes";
import { MOTE_BOX, MOTE_SALT, emptyMoteUniforms } from "@csarkosh/engine/game/moteField";
import { inOrder, tight } from "@csarkosh/engine/testing/wgslText";

/** Babylon.js's particle stages, as it installs them (recorded). */
const PARTICLE_FRAGMENT = tight(babylonText("shaders/particlesPixelShader.glsl"));
const PARTICLE_VERTEX = tight(babylonText("shaders/particlesVertexShader.glsl"));
const VERTEX = tight(MOTES_WGSL.vertex);
const FRAGMENT = tight(MOTES_WGSL.fragment);
/** `moteField.ts`'s own text: the stage's steps in plain code. */
const FIELD = tight((await import("node:fs")).readFileSync(new URL("../../../../engine/src/game/moteField.ts", import.meta.url), "utf8"));

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

  it("places a mote by the field's own steps, one for one", () => {
    // The hash, in integers.
    for (const [ts, wgsl] of [
      ["leth=(Math.imul(n>>>0,747796405)+2891336453)>>>0;", "varh=n*747796405u+2891336453u;"],
      ["h=Math.imul((h>>>((h>>>28)+4))^h,277803737)>>>0;", "h=((h>>((h>>28u)+4u))^h)*277803737u;"],
      ["return((h>>>22)^h)>>>0;", "return(h>>22u)^h;"],
      ["return(moteHash((slot^moteHash((Math.imul(life>>>0,0x9e3779b9)+salt)>>>0))>>>0)>>>8)/16777216;", "returnf32(moteHash(slot^moteHash(life*0x9e3779b9u+salt))>>8u)/16777216.0;"],
      // A life, weighted by its length; the slot's phase of it; the life it is in and its age.
      ["constlife=Math.sqrt(span[2]*span[2]+(span[3]*span[3]-span[2]*span[2])*moteRandom(slot,0,MOTE_SALT.life));", `letlife=sqrt(span.z*span.z+(span.w*span.w-span.z*span.z)*moteRandom(slot,0u,${MOTE_SALT.life}u));`],
      ["constt=u.moteClock[0]+moteRandom(slot,0,MOTE_SALT.phase)*life;", `lett=u.moteClock+moteRandom(slot,0u,${MOTE_SALT.phase}u)*life;`],
      ["constlives=Math.floor(t/life);", "letlives=floor(t/life);"],
      ["constage=t-lives*life;", "letage=t-lives*life;"],
      ["constn=lives+1;", "letn=u32(lives)+1u;"],
      // Its drift within the species' jitter, about the species' rise.
      ["constvelocity=[drift[1]*jitter[0],drift[0]+0.5*drift[1]*jitter[1],drift[1]*jitter[2]]asconst;", "letvelocity=vec3<f32>(drift.y*jitter.x,drift.x+0.5*drift.y*jitter.y,drift.y*jitter.z);"],
      // Its birth in the box, carried by the wind, seen through the box round the eye; then its drift.
      ["constanchored=((born[axis]asnumber)-0.5)*box+(carried[axis]asnumber)-(at[axis]asnumber);", "letanchored=(born-0.5)*MOTE_BOX+carried-eye;"],
      ["return(at[axis]asnumber)+(fract(anchored/box+0.5)-0.5)*box+(velocity[axis]asnumber)*age;", "letplace=eye+(fract(anchored/MOTE_BOX+0.5)-0.5)*MOTE_BOX+velocity*age;"],
      ["size:span[0]+(span[1]-span[0])*moteRandom(slot,n,MOTE_SALT.size),", `letsize=span.x+(span.y-span.x)*moteRandom(slot,n,${MOTE_SALT.size}u);`],
      ["shown:rank<drift[2],", "input.world0.z<drift.z);"],
      ["alpha:u.moteColour[3]*(1-age/life),", "out.colour=vec4<f32>(u.moteColour.rgb,u.moteColour.a*(1.0-age/life));"],
    ] as const) {
      expect(FIELD, ts).toContain(ts);
      expect(VERTEX, wgsl).toContain(wgsl);
    }
    // Each random of a life under its own salt, as the field draws it.
    expect(VERTEX).toContain(`letborn=vec3<f32>(moteRandom(slot,n,${MOTE_SALT.x}u),moteRandom(slot,n,${MOTE_SALT.y}u),moteRandom(slot,n,${MOTE_SALT.z}u));`);
    expect(VERTEX).toContain(`letjitter=vec3<f32>(moteRandom(slot,n,${MOTE_SALT.driftX}u),moteRandom(slot,n,${MOTE_SALT.driftY}u),moteRandom(slot,n,${MOTE_SALT.driftZ}u))*2.0-1.0;`);
    expect(VERTEX).toContain(`constMOTE_BOX:vec3<f32>=vec3<f32>(${MOTE_BOX[0]}.0,${MOTE_BOX[1]}.0,${MOTE_BOX[2]}.0);`);
    // A slot's number, its species and its rank, from its instance; the emitter's box round the camera the frame is drawn from.
    expect(VERTEX).toContain("letslot=u32(input.world0.x);");
    expect(VERTEX).toContain("letfrost=input.world0.y>0.5;");
    expect(VERTEX).toContain("leteye=scene.vEyePosition.xyz;");
    // The view and the eye are the scene's own and the projection the frame's: no copy of them is the motes'.
    expect(`${MOTES_WGSL.vertex}${MOTES_WGSL.fragment}`).not.toMatch(/shaderSystem/);
    // A slot not shown stands outside the view.
    expect(VERTEX).toContain("out.position=select(vec4<f32>(2.0,2.0,2.0,1.0),");
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
