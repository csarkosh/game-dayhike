
struct SkyOut{@builtin(position)position:vec4<f32>,@location(0)dir:vec3<f32>}
${grade}
${radiance}
fn skyNeutral(input:vec3<f32>)->vec3<f32>{
  let x=min(input.r,min(input.g,input.b));
  let offset=select(0.04,x-6.25*x*x,x<0.08);
  let color=input-offset;
  let peak=max(color.r,max(color.g,color.b));
  let k=1.0-0.76;
  let newPeak=1.0-k*k/(peak+k-0.76);
  let g=1.0-1.0/(0.15*(peak-newPeak)+1.0);
  let compressed=mix(color*(newPeak/max(peak,1.0e-6)),vec3<f32>(newPeak),g);
  return select(compressed,color,peak<0.76);
}
fn skyContrastOf(c:vec3<f32>,contrast:f32)->vec3<f32>{
  let high=c*c*(3.0-2.0*c);
  let shaped=select(mix(c,high,contrast-1.0),mix(vec3<f32>(0.5),c,contrast),contrast<1.0);
  return max(shaped,vec3<f32>(0.0));
}
@fragment fn mainFragment(input:SkyOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let sky=skyRadiance(normalize(input.dir),u.skySunDir,u.skyScale,u.skyCloud,u.skyDeckZenith,u.skyNight,u.skyDisc,u.skyMistAir,u.skyMistWeight,0.0);
  ${linearReturn}
  var toned=skyNeutral(${skyColour});
  toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));
  toned=skyContrastOf(toned,u.skyContrast);
  ${gradedTone}
  return vec4<f32>(clamp(toned,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}
