import { describe, expect, it } from "vitest";
import { MOTES_WGSL } from "../../../src/game/lite/motes.js";
import { MOTE_BOX, MOTE_SALT } from "../../../src/game/moteField.js";
import { tight } from "../../../testing/wgslText.js";
import { sourceText } from "../../helpers/source.js";

const VERTEX = tight(MOTES_WGSL.vertex);
/** `moteField.ts`'s own text: the stage's steps in plain code. */
const FIELD = tight(sourceText("game/moteField.ts"));

describe("the motes' stages on Babylon Lite", () => {
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
});
