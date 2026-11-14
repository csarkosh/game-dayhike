/**
 * The wet look in WGSL, for the materials Babylon Lite draws: what water and
 * weather do to a surface (`wetSurface.ts` has the numbers and says what the
 * look is). Statement for statement the GLSL of `shaders/wet.fragment.fx` and
 * `shaders/wetWeather.fragment.fx`, its uniforms read as `material.<name>`
 * under the names `wetUniforms` gives them.
 *
 * The swash's table is 256 vec4s of floats. Lite lays out a plugin's array
 * only as `array<vec4<u32>, N>`, so the floats ride as their bits and the
 * shader casts them back.
 */
import { WET_SWASH_VECS, emptyWetUniforms, type WetUniforms } from "../wetSurface.js";
import { uniformFields, writeUniforms, type UniformField, type UniformOffsets, type UniformRecord } from "./pluginUniforms.js";

/** The wet look's constants and functions: a material's fragment definitions. */
export const WET_WGSL = /* wgsl */ `
const WET_ALBEDO:f32=0.4;
const WET_ROUGHNESS:f32=0.15;
const WET_BAND:f32=0.1;
const WET_DAMP_ALBEDO:f32=0.7;
const WET_DAMP_ROUGHNESS:f32=0.5;
const WET_DRY_S:f32=60.0;
const WET_SOAKED_S:f32=0.5;
const WET_SPECKLE:f32=0.2;
const WET_SPECKLE_S:f32=10.0;
const WET_SPECKLE_CELL:f32=0.05;
const WET_SPECKLE_COVER:f32=0.25;
const WET_SPECKLE_NEAR:f32=10.0;
const WET_SPECKLE_FAR:f32=25.0;
const WET_COVE_END:f32=30.0;
const WET_SWASH_COLUMNS:f32=512.0;
const WET_SWASH_HALF:f32=256.0;
fn wetBelow(y:f32,line:f32)->f32{return 1.0-smoothstep(line-WET_BAND*0.5,line+WET_BAND*0.5,y);}
fn wetInside(xz:vec2<f32>,centre:vec2<f32>,radius:f32)->f32{return 1.0-smoothstep(radius+1.0,radius+3.0,length(xz-centre));}
fn wetCoveShare(z:f32)->f32{return 1.0-smoothstep(material.wetCove.y-WET_COVE_END,material.wetCove.y+WET_COVE_END,abs(z-material.wetCove.x));}
fn wetSwashAt(z:f32)->vec2<f32>{
  let c=floor(clamp(z-material.wetCove.x+WET_SWASH_HALF,0.0,WET_SWASH_COLUMNS-1.0)+0.5);
  let pair=bitcast<vec4<f32>>(material.wetSwash[i32(c*0.5)]);
  return mix(pair.xy,pair.zw,c%2.0);
}
fn wetShore(xz:vec2<f32>,y:f32)->vec3<f32>{
  let col=wetSwashAt(xz.y);
  let band=wetBelow(y,material.wetLevel+col.x*material.wetCove.w)*wetCoveShare(xz.y);
  let soaked=1.0-smoothstep(WET_SOAKED_S,WET_DRY_S/3.0,col.y);
  let damp=smoothstep(WET_SOAKED_S,WET_DRY_S/3.0,col.y)-smoothstep(WET_DRY_S/3.0,WET_DRY_S,col.y);
  let fresh=clamp(1.0-col.y/WET_SPECKLE_S,0.0,1.0);
  let above=1.0-wetBelow(y,material.wetLevel);
  return vec3<f32>(soaked,damp,WET_SPECKLE*fresh*above)*band;
}
fn wetSpeckle(xz:vec2<f32>,far:f32)->f32{
  let c=floor(xz/WET_SPECKLE_CELL);
  var p3=fract(vec3<f32>(c.x,c.y,c.x)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  let on=step(1.0-WET_SPECKLE_COVER,fract((p3.x+p3.y)*p3.z));
  return mix(on,WET_SPECKLE_COVER,smoothstep(WET_SPECKLE_NEAR,WET_SPECKLE_FAR,far));
}`;

/** The weather's share, where a material's base colour and roughness are
 * known and its albedo is not yet split from its F0: a porous surface darkens
 * and glosses with the weather's wetness, up to the material's cap. */
export const WET_WEATHER = `{let wetPorosity=min(material.wetCap,clamp((roughness-0.5)/0.4,0.0,1.0));let wetFactor=mix(1.0,0.2,wetPorosity);baseColor*=mix(1.0,wetFactor,material.wetWeather);let wetGloss=mix(1.0,1.0-roughness,mix(1.0,wetFactor,0.5*material.wetWeather));roughness=1.0-wetGloss;}`;

/**
 * The wet look where a material's albedo and roughness are known and no
 * light has run (`shaders/wetLights.fragment.fx`, without the terrain's
 * made features): the surface under a body's wet line and inside its disc
 * darkens and glosses, the swash's band soaks, dampens and speckles it, and
 * the water above takes its colour a channel.
 */
export const WET_LIGHTS = /* wgsl */ `let wetIn=wetInside(input.worldPos.xz,material.wetCentre,material.wetRadius);
let wetStill=wetBelow(input.worldPos.y,material.wetLine)*wetIn;
let wetCoveW=wetShore(input.worldPos.xz,input.worldPos.y)*wetIn;
let wetW=max(wetStill,wetCoveW.x);
let wetDamp=wetCoveW.y*(1.0-wetStill);
surfaceAlbedo*=mix(1.0,WET_ALBEDO,wetW)*mix(1.0,WET_DAMP_ALBEDO,wetDamp);
surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(1.0),wetCoveW.z*wetSpeckle(input.worldPos.xz,length(input.worldPos-scene.vEyePosition.xyz)));
let wetKdMean=(material.wetKd.r+material.wetKd.g+material.wetKd.b)/3.0;
let wetResidual=min(vec3<f32>(1.0),exp(-2.0*(material.wetKd-vec3<f32>(wetKdMean))*max(0.0,material.wetLevel-input.worldPos.y)*wetIn));
surfaceAlbedo*=mix(vec3<f32>(1.0),wetResidual,material.wetAttenuate);
roughness=mix(mix(roughness,min(roughness,WET_DAMP_ROUGHNESS),wetDamp),WET_ROUGHNESS,wetW);`;

/** The swash table's field: its vec4s as bits (above). */
export const WET_SWASH_FIELD: UniformField = { name: "wetSwash", type: `array<vec4<u32>,${WET_SWASH_VECS}>` };

/** The wet look's uniforms but the swash's table, which is laid out as bits (`WET_SWASH_FIELD`). */
function wetScalars(values: WetUniforms): UniformRecord {
  const { wetSwash: _swash, ...scalars } = values;
  void _swash;
  return scalars;
}

/** A wet plugin's fields: one a uniform, in the record's order, the swash's table last. */
export const WET_FIELDS: readonly UniformField[] = [...uniformFields(wetScalars(emptyWetUniforms())), WET_SWASH_FIELD];

/** Writes `values` (`wetUniforms`) into a material's uniform buffer at the wet fields' offsets, the swash's table float for float. */
export function writeWetUniforms(data: Float32Array, offsets: UniformOffsets, values: WetUniforms): void {
  writeUniforms(data, offsets, wetScalars(values));
  const swash = offsets.get(WET_SWASH_FIELD.name);
  if (swash === undefined) throw new Error(`no uniform ${WET_SWASH_FIELD.name} in the material's buffer`);
  data.set(values.wetSwash, swash / 4);
}
