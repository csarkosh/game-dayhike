
const SKY_PI:f32=${mathPi};
const SKY_AZIMUTHS:f32=${sliceAzimuths};
const SKY_ELEVATIONS:f32=${sliceElevations};
const SKY_MIST_HORIZON:f32=${mistHorizon};
const SKY_DISC_COS:f32=${sunDiscCos};
const SKY_DISC_CAPTURE_MAX:f32=${sunDiscCaptureMax};
fn skyTableUv(d:vec3<f32>,sunDir:vec3<f32>)->vec2<f32>{
  let h=d.xz;
  let s=sunDir.xz;
  let hl=length(h);
  let sl=length(s);
  let c=select(1.0,clamp(dot(h,s)/(hl*sl),-1.0,1.0),hl>1.0e-6&&sl>1.0e-6);
  let u=acos(c)/SKY_PI;
  let e=asin(clamp(d.y,0.0,1.0));
  let v=0.5+0.5*sign(e)*sqrt(abs(e)/(0.5*SKY_PI));
  return vec2<f32>((u*(SKY_AZIMUTHS-1.0)+0.5)/SKY_AZIMUTHS,(v*(SKY_ELEVATIONS-1.0)+0.5)/SKY_ELEVATIONS);
}
fn skyDeck(zenith:vec3<f32>,sinE:f32)->vec3<f32>{
  return zenith*(1.0+2.0*max(sinE,0.0))/3.0;
}
fn skyRadiance(d:vec3<f32>,sunDir:vec3<f32>,scale:f32,cloud:f32,deckZenith:vec3<f32>,night:vec3<f32>,disc:vec3<f32>,mistAir:vec3<f32>,mistWeight:f32,capture:f32)->vec3<f32>{
  var sky=scale*textureSampleLevel(skyTable,skyTableSampler,skyTableUv(d,sunDir),0.0).rgb;
  sky=mix(sky,skyDeck(deckZenith,d.y),cloud);
  sky+=night;
  let inDisc=step(SKY_DISC_COS,dot(d,sunDir));
  sky+=inDisc*mix(disc,min(disc,vec3<f32>(SKY_DISC_CAPTURE_MAX)),capture);
  let h=mistWeight*exp(-max(d.y,0.0)/SKY_MIST_HORIZON);
  return mix(sky,mistAir,h);
}
