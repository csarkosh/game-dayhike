
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
${cloudDefs}
fn atmosphereFog(lit:vec3<f32>,worldPos:vec3<f32>,eye:vec3<f32>)->vec3<f32>{
  let toFrag=worldPos-eye;
  let d=length(toFrag);
  // The distance fog's factor, exponential squared (1 clear, 0 fogged), linearised.
  let fog=pow(clamp(exp(-(d*material.atmBaseDensity)*(d*material.atmBaseDensity)),0.0,1.0),2.2);
  // No record to draw the air by yet: the lit colour as it is.
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
  ${cloudFog}
}
