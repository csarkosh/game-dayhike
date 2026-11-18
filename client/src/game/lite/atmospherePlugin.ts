/**
 * The atmosphere as a material plugin on Babylon Lite: the air between the
 * eye and a surface, drawn by the surface's own material (`atmosphereParams.ts`
 * has the arithmetic and says what the air is; `cloudParams.ts` the ground
 * cloud). Where it goes in:
 *
 * - The fog is applied to the lit colour at the point before the final
 *   colour is composed, ahead of the display curve. Lite's scene fog stays
 *   off.
 * - The distance fog's density is a uniform of the plugin's
 *   (`atmBaseDensity`).
 * - With `atmOn` under a half the lit colour passes as it is, with no air at
 *   all. `atmOn` is 0 only while there is no record to draw the air by
 *   (`atmosphereUniforms`): before the sky's first slices are held
 *   (`lite/worldLight.ts`), or before the renderer's first frame is
 *   written. The hike's loop starts only once the sky is held
 *   (`Renderer.skyReady`), so no frame a player sees is drawn that way.
 *   The record's numbers are all 0 then, and the haze, whose constants are
 *   not, would darken the colour were it not for the early return.
 * - The uniforms are read as `material.<name>`, under the names
 *   `atmosphereUniforms` gives them; or, given the frame's block
 *   (`frameBlock.ts`), from the block, for the air is the same for every
 *   material and moves with the frame.
 * - The ground cloud is marched here only where the plugin is asked to
 *   (`cloud`): where a post chain marches it once a pixel, as the game's
 *   does (`postChain.ts`), a material draws none, and carries neither the
 *   march nor the cloud's map.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import type { AtmosphereUniforms } from "../atmosphereParams.js";
import { DISPLAY_ENCODE_WGSL, GRADE_BLOCK, MATERIAL_GRADE_WGSL } from "./displayCurve.js";
import { frameReads } from "./frameBlock.js";
import { uniformFields, writeUniforms } from "./pluginUniforms.js";

const atmWgsl = (cloud: boolean): string => /* wgsl */ `
const ATM_NEAR_DIM:f32=0.85;
const ATM_GRADIENT_BIAS:f32=1.6;
const ATM_AIR_POWER:vec3<f32>=vec3<f32>(0.72,0.92,1.3);
const ATM_HAZE_DENSITY:f32=0.002;
const ATM_HAZE_FALLOFF:f32=0.12;
const ATM_HAZE_SEAT:f32=1.5;
const ATM_HAZE_WARMTH:f32=0.5;
const ATM_CLOUD_EDGE:f32=0.5/64.0;
const ATM_CLOUD_STEPS_MAX:i32=12;
const ATM_LEVEL_SLOPE:f32=1.0e-3;
fn atmHeightFog(y0:f32,rdY:f32,t:f32,a:f32,b:f32)->f32{
  var slope=rdY;
  if(abs(rdY)<ATM_LEVEL_SLOPE){slope=select(ATM_LEVEL_SLOPE,-ATM_LEVEL_SLOPE,rdY<0.0);}
  return (a/b)*exp(-y0*b)*(1.0-exp(-t*slope*b))/slope;
}
${cloud ? ATM_CLOUD_WGSL : ""}
fn atmosphereFog(lit:vec3<f32>,worldPos:vec3<f32>,eye:vec3<f32>)->vec3<f32>{
  let toFrag=worldPos-eye;
  let d=length(toFrag);
  // The distance fog's factor, exponential squared (1 clear, 0 fogged), linearised: what Babylon's PBR hands the GLSL.
  let fog=pow(clamp(exp(-(d*material.atmBaseDensity)*(d*material.atmBaseDensity)),0.0,1.0),2.2);
  if(material.atmOn<0.5){return lit;}
  let rd=toFrag/max(d,1.0e-4);
  let y0=eye.y-material.atmReferenceLevel;
  let height=atmHeightFog(y0,rd.y,d,material.atmHeightDensity,material.atmHeightFalloff);
  let haze=atmHeightFog(ATM_HAZE_SEAT,rd.y,d,ATM_HAZE_DENSITY,ATM_HAZE_FALLOFF);
  let transmit=clamp(fog*exp(-max(height,0.0)),0.0,1.0);
  let gradient=material.atmFarColour*mix(ATM_NEAR_DIM,1.0,pow(clamp(d*material.atmGradientScale,0.0,1.0),1.0/ATM_GRADIENT_BIAS));
  let glow=pow(max(dot(rd,material.atmSunDir),0.0),material.atmSunPower)*material.atmSunWeight;
  let air=mix(gradient,material.atmSunColour,glow);
  var fogged=mix(air,lit,pow(vec3<f32>(transmit),ATM_AIR_POWER));
  fogged=mix(mix(air,material.atmSunColour,ATM_HAZE_WARMTH),fogged,exp(-max(haze,0.0)));
  ${cloud ? `if(material.atmCloudSteps<0.5){return fogged;}
  let od=atmCloudDepth(eye,rd,d);
  let cloudGlow=pow(max(dot(rd,material.atmSunDir),0.0),material.atmCloudGlow.y)*material.atmCloudGlow.x;
  let cloud=material.atmCloudColour+material.atmSunColour*cloudGlow;
  return mix(cloud,fogged,exp(-od));` : "return fogged;"}
}`;

/** The ground cloud's march, as the far softening's pass has it too (`postWgsl.ts`). */
const ATM_CLOUD_WGSL = /* wgsl */ `
fn atmCloudGround(xz:vec2<f32>)->vec2<f32>{
  let uv=clamp((xz-material.atmCloudGroundRect.xy)*material.atmCloudGroundRect.z+0.5,vec2<f32>(ATM_CLOUD_EDGE),vec2<f32>(1.0-ATM_CLOUD_EDGE));
  let g=textureSampleLevel(atmCloudMap,atmCloudMapSampler,uv,0.0);
  return vec2<f32>(material.atmCloudGroundRect.w+g.b*material.atmCloudGroundRange,g.a);
}
fn atmCloudAt(p:vec3<f32>,s:f32)->f32{
  let ground=atmCloudGround(p.xz);
  let above=p.y-ground.x+material.atmCloudSeat;
  let h=exp(-max(above,0.0)*material.atmCloudFalloff)*mix(material.atmCloudTrail,1.0,ground.y);
  var large=textureSampleLevel(atmCloudMap,atmCloudMapSampler,p.xz*material.atmCloudNoiseScale.x+material.atmCloudWind,0.0).r;
  var small=textureSampleLevel(atmCloudMap,atmCloudMapSampler,(p.xz+vec2<f32>(p.y,-p.y)*0.7)*material.atmCloudNoiseScale.y-material.atmCloudWind.yx,0.0).g;
  large=mix(0.7,large,smoothstep(0.0,material.atmCloudNear*0.5,s));
  small=mix(0.7,small,smoothstep(material.atmCloudNear*0.2,material.atmCloudNear,s));
  let n=clamp(large*small*2.4-0.2,0.0,1.0);
  return material.atmCloudDensity*h*n;
}
fn atmCloudDepth(ro:vec3<f32>,rd:vec3<f32>,t:f32)->f32{
  let reach=min(t,material.atmCloudRange);
  var od=0.0;
  var prev=0.0;
  for(var i:i32=1;i<=ATM_CLOUD_STEPS_MAX;i++){
    if(f32(i)>material.atmCloudSteps){break;}
    let f=f32(i)/material.atmCloudSteps;
    let s=reach*f*f;
    let mid=0.5*(prev+s);
    od+=atmCloudAt(ro+rd*mid,mid)*(s-prev);
    prev=s;
  }
  return od;
}`;

/** The plugin's place among a material's: after every plugin that shades the surface. */
export const ATMOSPHERE_PRIORITY = 900;

/**
 * The plugin, drawing the air by `uniforms`: one record, filled in place
 * every frame (`atmosphereUniforms`) and read whenever the material's
 * uniforms are written. `cloudMap` is the ground cloud's map
 * (`cloudNoiseMap`), repeating, read bilinearly. Given `shared`, the frame's
 * block, the air is read from it and the material carries none of it: the
 * renderer writes the block once a frame from the same record. `cloud`
 * false leaves the ground cloud to a post chain: the material marches none
 * and binds no map. `grade`: the tier has no post chain, and the material
 * grades its own colour as Babylon.js's image processing does there
 * (`displayCurve.ts`): the vignette on the fogged colour ahead of the tone
 * map, the colour curves and the dither after Lite's display curve.
 * `curve`: Lite's materials do not end with that curve (the page has
 * drawn a tier with a chain, and Lite's linear output is the whole page's
 * from then), so the plugin encodes the colour for the display itself,
 * ahead of the curves.
 */
export function atmospherePlugin(
  uniforms: AtmosphereUniforms, cloudMap: Texture2D, shared?: PluginUniformBlock, cloud = true, grade = false, curve = false,
): MaterialPlugin {
  if (grade && shared === undefined) throw new Error("the material path's grade is read from the frame's block");
  if (curve && !grade) throw new Error("the display curve is laid on by the material path's grade");
  const definitions = `${shared === undefined ? atmWgsl(cloud) : frameReads(atmWgsl(cloud))}${grade ? MATERIAL_GRADE_WGSL : ""}${curve ? DISPLAY_ENCODE_WGSL : ""}`;
  return {
    name: "Atmosphere",
    priority: ATMOSPHERE_PRIORITY,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: definitions,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `color=atmosphereFog(color,input.worldPos,scene.vEyePosition.xyz);${grade ? "color=gradeVignette(color,input.clipPos.xy);" : ""}`,
          // After Lite's own display curve, last in the fragment.
          ...(grade ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `${curve ? `color=displayEncoded(color,${GRADE_BLOCK}.frameContrast);` : ""}color=gradeDither(gradeCurves(color),input.clipPos.xy);` } : {}),
        }
        : null,
    ...(shared === undefined
      ? {
        getUniforms: () => ({ ubo: uniformFields(uniforms) }),
        writeUbo(data: Float32Array, offsets: ReadonlyMap<string, number>) {
          writeUniforms(data, offsets, uniforms);
        },
      }
      : { getUniformBlocks: () => [shared] }),
    ...(cloud
      ? {
        getSamplers: () => [{ texture: "atmCloudMap", sampler: "atmCloudMapSampler" }],
        bindTextures(out: { texture: Texture2D }[]) {
          out.push({ texture: cloudMap });
        },
        getActiveTextures(out: Texture2D[]) {
          out.push(cloudMap);
        },
      }
      : {}),
    // A material that marches no cloud is another program: the two are told apart.
    defines: { cloud, grade, curve },
  };
}
