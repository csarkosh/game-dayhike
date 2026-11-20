
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
}
