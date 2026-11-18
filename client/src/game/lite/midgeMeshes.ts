/**
 * The midges on Babylon Lite: every swarm of a lake in one draw, one unit
 * card an instance,
 * placed in the vertex stage from its swarm's row in a small table and the
 * shared clock, and a fragment stage that adds the sun's glint and the
 * sky's and darkens by the speck's coverage.
 *
 * - **One buffer a frame, and none while no swarm is in sight.** The game's
 *   stages read a dozen uniforms and the table; here they are one run of
 *   floats (`packMidgeFrame`), a storage buffer both stages read, written
 *   once a frame the midges are drawn. They are drawn while the view's
 *   planes hold the sphere of a swarm that has a midge (`swarmSphere`);
 *   hidden, the mesh draws and writes nothing.
 * - **An instance is a row and a slot**, laid out once (`midgeSlots`). Lite's
 *   stages of this kind are handed an instance's matrix and nothing else,
 *   so the pair rides in the matrix's first two floats, which the stage
 *   reads in place of a matrix it never uses.
 * - **Blended premultiplied**, as the game blends them: the glints add, the
 *   speck's coverage darkens; tested against the depth, never written to
 *   it, never culled; toned on the material colour path by the stage's own
 *   copy of the display's curve.
 * - **The view is the scene's.** Lite declares its scene uniforms ahead of
 *   every stage and writes them once a pass, so the stage reads
 *   `scene.viewProjection` and declares no system uniform: a camera that
 *   moves writes no copy of its matrix for the midges, drawn or hidden.
 */
import {
  addToScene, createPlane, createShaderMaterial, createStorageBuffer, disposeMeshGpu, removeFromScene, setMeshVisible, setShaderStorageBuffer,
  setThinInstances, updateStorageBuffer,
  type EngineContext, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import { sphereInPlanes, type ViewPlane } from "../lakeSeen.js";
import { MIDGE_FRAME_FLOATS, midgeSlots, packMidgeFrame, swarmSphere, type MidgeFrame } from "../midgeLook.js";
import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS } from "../midgeMotion.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";

/** The frame's floats as the stages read them: `packMidgeFrame`'s five vec4s, then the table. */
const DATA = `struct MidgeData{eye:vec4<f32>,sun:vec4<f32>,sunLight:vec4<f32>,skyGlow:vec4<f32>,tone:vec4<f32>,swarms:array<vec4<f32>,${(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX) / 4}>}`;
const VARYINGS = "struct MidgeOut{@builtin(position)position:vec4<f32>,@location(0)vCorner:vec2<f32>,@location(1)vAlpha:f32,@location(2)vSunGlint:f32,@location(3)vSkyGlint:f32}";

/** The midges' vertex stage. The uniforms are read from the frame's floats by name. */
const VERTEX = /* wgsl */ `
${DATA}
${VARYINGS}
const MIDGE_TAU:f32=6.28318531;
const MIDGE_RATE_0:f32=0.7;
const MIDGE_RATE_1:f32=1.3;
const MIDGE_RATE_2:f32=2.1;
const MIDGE_AMP_0:f32=0.55;
const MIDGE_AMP_1:f32=0.3;
const MIDGE_AMP_2:f32=0.15;
const MIDGE_BALL_FLAT:f32=0.6666666666666666;
const MIDGE_CARD:f32=0.003;
const MIDGE_MIN_PX:f32=2.0;
const MIDGE_ALPHA_FLOOR:f32=0.6;
const MIDGE_FLOOR_NEAR:f32=6.0;
const MIDGE_FLOOR_FAR:f32=15.0;
const MIDGE_FLASH_LOW:f32=9.0;
const MIDGE_FLASH_HIGH:f32=14.0;
const MIDGE_LOBE_POWER:f32=8.0;
const MIDGE_FLASH_POWER:f32=24.0;
const MIDGE_FLASH_GAIN:f32=0.5;
const MIDGE_SKY_GLINT:f32=0.6;
const MIDGE_SKY_LOBE_POWER:f32=2.0;
fn midgeHash(i:f32,s:f32)->f32{
  var p=fract(vec3<f32>(i,s,i+s)*0.1031);
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
fn midgeAxis(slot:f32,seed:f32,axis:f32,t:f32)->f32{
  let base=seed+3.0*axis;
  var s=MIDGE_AMP_0*sin(MIDGE_TAU*MIDGE_RATE_0*(0.85+0.3*midgeHash(slot,base+11.0))*t+MIDGE_TAU*midgeHash(slot,base+41.0));
  s+=MIDGE_AMP_1*sin(MIDGE_TAU*MIDGE_RATE_1*(0.85+0.3*midgeHash(slot,base+12.0))*t+MIDGE_TAU*midgeHash(slot,base+42.0));
  s+=MIDGE_AMP_2*sin(MIDGE_TAU*MIDGE_RATE_2*(0.85+0.3*midgeHash(slot,base+13.0))*t+MIDGE_TAU*midgeHash(slot,base+43.0));
  return s;
}
@vertex fn mainVertex(input:VertexInput)->MidgeOut{
  var out:MidgeOut;
  let midge=input.world0.xy;
  let midgeEye=midgeData.eye.xyz;
  let midgeTime=midgeData.eye.w;
  let midgeSun=midgeData.sun.xyz;
  let midgePixel=midgeData.skyGlow.w;
  let at=3*i32(midge.x+0.5);
  let slot=midge.y;
  let place=midgeData.swarms[at];
  let shape=midgeData.swarms[at+1];
  let turn=midgeData.swarms[at+2];
  let seed=turn.z;
  let t=midgeTime;
  let across=place.w*vec2<f32>(midgeAxis(slot,seed,0.0,t),midgeAxis(slot,seed,2.0,t));
  let up=mix(place.w*MIDGE_BALL_FLAT,shape.x,shape.w)*midgeAxis(slot,seed,1.0,t)*(1.0-turn.y);
  let c=cos(turn.x);
  let n=sin(turn.x);
  let centre=place.xyz+vec3<f32>(across.x*c-across.y*n,up,across.x*n+across.y*c);
  let toEye=midgeEye-centre;
  let far=length(toEye);
  let view=toEye/max(far,1.0e-4);
  let size=max(MIDGE_CARD,MIDGE_MIN_PX*midgePixel*far);
  let alive=(1.0-step(shape.y,slot))*(1.0-step(shape.z,0.0));
  var side=cross(vec3<f32>(0.0,1.0,0.0),view);
  side=normalize(mix(vec3<f32>(1.0,0.0,0.0),side,step(1.0e-8,dot(side,side))));
  let rise=cross(view,side);
  let corner=centre+(side*input.position.x+rise*input.position.y)*size*alive;
  out.position=scene.viewProjection*vec4<f32>(corner,1.0);
  out.vCorner=2.0*input.position.xy;
  let nearFloor=MIDGE_ALPHA_FLOOR*clamp((MIDGE_FLOOR_FAR-far)/(MIDGE_FLOOR_FAR-MIDGE_FLOOR_NEAR),0.0,1.0);
  out.vAlpha=max(MIDGE_CARD/size,nearFloor)*shape.z*alive;
  let lobe=pow(max(dot(-view,midgeSun),0.0),MIDGE_LOBE_POWER);
  let rate=mix(MIDGE_FLASH_LOW,MIDGE_FLASH_HIGH,midgeHash(slot,seed+73.0));
  let flash=pow(max(sin(MIDGE_TAU*rate*t+MIDGE_TAU*midgeHash(slot,seed+71.0)),0.0),MIDGE_FLASH_POWER);
  out.vSunGlint=lobe+MIDGE_FLASH_GAIN*flash;
  let sunLevel=vec3<f32>(midgeSun.x,0.0,midgeSun.z);
  let sunFlat=normalize(mix(vec3<f32>(1.0,0.0,0.0),sunLevel,step(1.0e-8,dot(sunLevel,sunLevel))));
  out.vSkyGlint=MIDGE_SKY_GLINT*pow(max(dot(-view,sunFlat),0.0),MIDGE_SKY_LOBE_POWER);
  return out;
}`;

/** The midges' fragment stage. */
const FRAGMENT = /* wgsl */ `
${DATA}
${VARYINGS}
const MIDGE_DARK:f32=0.9;
const MIDGE_NEUTRAL_START:f32=0.76;
const MIDGE_NEUTRAL_DESATURATION:f32=0.15;
fn midgeNeutral(input:vec3<f32>)->vec3<f32>{
  var color=input;
  let x=min(color.r,min(color.g,color.b));
  let offset=mix(x-6.25*x*x,0.04,step(0.08,x));
  color-=offset;
  let peak=max(color.r,max(color.g,color.b));
  let top=max(peak,MIDGE_NEUTRAL_START);
  let k=1.0-MIDGE_NEUTRAL_START;
  let newPeak=1.0-k*k/(top+k-MIDGE_NEUTRAL_START);
  let g=1.0-1.0/(MIDGE_NEUTRAL_DESATURATION*(top-newPeak)+1.0);
  let compressed=mix(color*(newPeak/top),vec3<f32>(newPeak),g);
  return mix(color,compressed,step(MIDGE_NEUTRAL_START,peak));
}
fn midgeContrastOf(c:vec3<f32>,midgeContrast:f32)->vec3<f32>{
  let high=c*c*(3.0-2.0*c);
  let low=mix(vec3<f32>(0.5),c,midgeContrast);
  let raised=mix(c,high,midgeContrast-1.0);
  return max(mix(low,raised,step(1.0,midgeContrast)),vec3<f32>(0.0));
}
@fragment fn mainFragment(input:MidgeOut)->@location(0)vec4<f32>{
  let midgeSunLight=midgeData.sunLight.xyz;
  let midgeSkyGlow=midgeData.skyGlow.xyz;
  let midgeNight=midgeData.sun.w;
  let midgeSkyLuma=midgeData.sunLight.w;
  let midgeExposure=midgeData.tone.x;
  let midgeToneMap=midgeData.tone.y;
  let midgeContrast=midgeData.tone.z;
  let tent=clamp(1.0-abs(input.vCorner),vec2<f32>(0.0),vec2<f32>(1.0));
  let a=input.vAlpha*tent.x*tent.y;
  let day=1.0-midgeNight;
  let sunGlint=midgeSunLight*day*input.vSunGlint;
  let skyGlint=midgeSkyGlow*input.vSkyGlint;
  let speck=MIDGE_DARK*clamp(midgeSkyLuma,0.0,1.0);
  let light=(sunGlint+skyGlint)*a;
  var toned=midgeNeutral(light*midgeExposure);
  toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));
  toned=midgeContrastOf(toned,midgeContrast);
  return vec4<f32>(mix(light,toned,step(0.5,midgeToneMap)),speck*a);
}`;

/** The stages' text, for the tests that hold it to the game's. */
export const MIDGE_WGSL = { vertex: VERTEX, fragment: FRAGMENT } as const;

/** The midges as they stand in a scene. */
export type LiteMidges = {
  readonly mesh: Mesh;
  /** Draws the midges with `frame`, toned by `exposure` and `contrast` where `toned` (no post chain grades the frame); or hides them (null). */
  show(frame: MidgeFrame | null, exposure: number, contrast: number, toned?: boolean): void;
  /** Whether the midges are drawn, and the instances the one draw holds. */
  readonly shown: boolean;
  readonly instances: number;
  dispose(): void;
};

/**
 * The midges of one lake in `scene`: `blocks[r]` instances in row r, none
 * drawn until a frame has a swarm in sight and `planes`, the view's, hold
 * it. Null where no row holds any.
 */
export function createLiteMidges(
  engine: EngineContext, scene: SceneContext, blocks: readonly number[], planes: () => readonly ViewPlane[], uploads?: FrameUploads,
): LiteMidges | null {
  const { slots, total } = midgeSlots(blocks);
  if (total === 0) return null;
  const data = new Float32Array(MIDGE_FRAME_FLOATS);
  const buffer = createStorageBuffer(engine, data, "midge_frame");
  const material = createShaderMaterial({
    name: "midge",
    vertexSource: VERTEX,
    fragmentSource: FRAGMENT,
    attributes: ["position"],
    storageBuffers: [{ name: "midgeData", type: "MidgeData" }],
    needAlphaBlending: true,
    // Premultiplied: the light adds, the coverage darkens.
    blend: {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    },
    depthWrite: false,
    backFaceCulling: false,
  });
  setShaderStorageBuffer(material, "midgeData", buffer);
  // A row and a slot an instance, in the first two floats of a matrix the stage never reads as one.
  const matrices = new Float32Array(total * 16);
  for (let i = 0; i < total; i++) {
    matrices[i * 16] = slots[i * 2] as number;
    matrices[i * 16 + 1] = slots[i * 2 + 1] as number;
  }
  const mesh = createPlane(engine, { size: 1 });
  mesh.material = material;
  // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
  mesh.renderOrder = SEE_THROUGH_ORDER.midges;
  setThinInstances(mesh, matrices, total);
  uploads?.count("instances", matrices.byteLength);
  uploads?.made();
  setMeshVisible(mesh, false);
  addToScene(scene, mesh);
  let shown = false;
  let disposed = false;
  const sphere: [number, number, number, number] = [0, 0, 0, 0];
  /** Whether the view holds a swarm of `table` that has a midge. */
  function inView(table: Float32Array): boolean {
    const view = planes();
    for (let row = 0; row < MIDGE_SWARMS_MAX; row++) {
      if (swarmSphere(table, row, sphere) && sphereInPlanes(sphere[0], sphere[1], sphere[2], sphere[3], view)) return true;
    }
    return false;
  }
  return {
    mesh,
    instances: total,
    get shown() {
      return shown;
    },
    show(frame, exposure, contrast, toned = true) {
      if (disposed) return;
      const now = frame !== null && inView(frame.table);
      if (now !== shown) {
        shown = now;
        setMeshVisible(mesh, now);
      }
      if (frame === null || !now) return;
      packMidgeFrame(frame, exposure, toned, contrast, data);
      updateStorageBuffer(engine, buffer, data);
      uploads?.count("uniforms", data.byteLength);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      uploads?.dropped();
    },
  };
}
