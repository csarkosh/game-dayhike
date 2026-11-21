
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var sceneSampler:texture_2d<f32>;
@group(0)@binding(3)var paintSampler:texture_2d<f32>;
@group(0)@binding(4)var shadeSampler:texture_2d<f32>;
${halationBinding}
${compose}
const DITHER_LSB:f32=0.00392156862745098;
fn gradeNoise(p:vec2<f32>,seed:f32)->f32{
  return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y+seed));
}
const SRGB_TO_REC2020:mat3x3<f32>=mat3x3<f32>(0.6274,0.0691,0.0164,0.3293,0.9195,0.088,0.0433,0.0113,0.8956);
const REC2020_TO_SRGB:mat3x3<f32>=mat3x3<f32>(1.6605,-0.1246,-0.0182,-0.5876,1.1329,-0.1006,-0.0728,-0.0083,1.1187);
const AGX_INSET:mat3x3<f32>=mat3x3<f32>(0.856627153315983,0.137318972929847,0.11189821299995,0.0951212405381588,0.761241990602591,0.0767994186031903,0.0482516061458583,0.101439036467562,0.811302368396859);
const AGX_OUTSET:mat3x3<f32>=mat3x3<f32>(1.1271005818144368,-0.1413297634984383,-0.14132976349843826,-0.11060664309660323,1.157823702216272,-0.11060664309660294,-0.016493938717834573,-0.016493938717834257,1.2519364065950405);
const AGX_MIN_EV:f32=-12.47393;
const AGX_MAX_EV:f32=4.026069;
const SPLIT_TONE_DENSITY_SCALE:f32=0.35;
const SPLIT_TONE_SATURATION_SCALE:f32=0.5;
fn gradeLuma(c:vec3<f32>)->f32{
  return dot(c,vec3<f32>(0.2126,0.7152,0.0722));
}
fn agxContrast(x:vec3<f32>)->vec3<f32>{
  let x2=x*x;
  let x4=x2*x2;
  return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;
}
fn agxToneMap(c:vec3<f32>)->vec3<f32>{
  var v=AGX_INSET*(SRGB_TO_REC2020*c);
  v=max(v,vec3<f32>(1.0e-10));
  v=(log2(v)-AGX_MIN_EV)/(AGX_MAX_EV-AGX_MIN_EV);
  v=clamp(v,vec3<f32>(0.0),vec3<f32>(1.0));
  v=agxContrast(v);
  v=AGX_OUTSET*v;
  v=pow(max(v,vec3<f32>(0.0)),vec3<f32>(2.2));
  v=REC2020_TO_SRGB*v;
  return clamp(v,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn gradeBand(c:vec3<f32>,mask:f32,tintColour:vec3<f32>,amount:vec2<f32>)->vec3<f32>{
  let l=gradeLuma(c);
  let tinted=mix(c,tintColour*l,amount.x*SPLIT_TONE_DENSITY_SCALE);
  let grey=vec3<f32>(gradeLuma(tinted));
  let sat=mix(grey,tinted,1.0+amount.y*SPLIT_TONE_SATURATION_SCALE);
  return mix(c,sat,mask);
}
${shadeHelpers}
fn shadeRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(shadeSampler,postSampler,tx(uv),0.0).rgb;}
fn toSrgb(c:vec3<f32>)->vec3<f32>{
  return pow(c,vec3<f32>(1.0/2.2));
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  var c=composed(vUV)*u.exposure;
  c=agxToneMap(c);
  c=clamp(u.whitePoint*c,vec3<f32>(0.0),vec3<f32>(1.0));
  let l=gradeLuma(c);
  let rod=(1.0-smoothstep(0.0,u.purkinjeThreshold,l))*u.purkinjeStrength;
  c=mix(c,u.purkinje*c,rod);
  let shadowMask=1.0-smoothstep(0.0,0.35,l);
  let highlightMask=smoothstep(0.55,1.0,l);
  let midMask=1.0-shadowMask-highlightMask;
  c=gradeBand(c,shadowMask,u.paintShadowTint,u.paintShadowAmount);
  c=gradeBand(c,midMask,u.paintMidtoneTint,u.paintMidtoneAmount);
  c=gradeBand(c,highlightMask,u.paintHighlightTint,u.paintHighlightAmount);
  c=mix(vec3<f32>(gradeLuma(c)),c,1.0+u.paintSaturation);
  let paintLuma=gradeLuma(c);
  let paintLit=smoothstep(0.02,0.25,paintLuma)*(1.0-smoothstep(0.55,0.9,paintLuma));
  c=clamp(c+(c-u.paintCurve.y)*(u.paintCurve.x-1.0)*paintLit,vec3<f32>(0.0),vec3<f32>(1.0));
  c=u.paintLift+c*(1.0-u.paintLift);
  c=gradeBand(c,shadowMask,u.shadowTint,u.shadowAmount);
  c=gradeBand(c,midMask,u.midtoneTint,u.midtoneAmount);
  c=gradeBand(c,highlightMask,u.highlightTint,u.highlightAmount);
  c=mix(vec3<f32>(gradeLuma(c)),c,1.0+u.saturation);
  c=u.lift+c*(1.0-u.lift);
  if(u.chaseTint.w>0.0){
    c=mix(c,c*u.chaseTint.xyz+u.chaseLift,u.chaseTint.w);
  }
  let centred=(vUV-0.5)*2.0;
${shadeBlock}  let vr=length(centred)/1.41421356;
  let vig=1.0-smoothstep(0.55,1.0,vr)*clamp(u.vignetteWeight*0.22,0.0,0.8);
  c=mix(u.vignetteColour,c,vig);
${halation}
${stareBlock}  var shown=toSrgb(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)));
  let pixel=vUV/u.texelSize;
  let d1=gradeNoise(pixel,fract(u.time*3.17));
  let d2=gradeNoise(pixel+vec2<f32>(37.0,11.0),fract(u.time*5.03));
  shown+=(d1+d2-1.0)*DITHER_LSB;
  return vec4<f32>(clamp(shown,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}
