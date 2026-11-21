${fftConsts}
fn oceanWindFrame(p:vec2<f32>)->vec2<f32>{
  let d=material.oceanWindDir.xy;
  let r=p-material.oceanWindPivot.xy;
  return vec2<f32>(dot(r,d),d.x*r.y-d.y*r.x);
}
fn oceanFromWind(v:vec2<f32>)->vec2<f32>{
  let d=material.oceanWindDir.xy;
  return vec2<f32>(v.x*d.x-v.y*d.y,v.x*d.y+v.y*d.x);
}
fn oceanLoopSize()->f32{
  return LOOP_SIZE*max(material.oceanWind.y,OCEAN_LOOP_SCALE_MIN);
}
fn oceanLoopRead(uv:vec2<f32>)->vec3<f32>{
  let f=material.oceanWind.z/LOOP_SECONDS*LOOP_FRAMES;
  let f0=floor(f);
  let a=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(f0),0.0).xyz;
  let b=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(${nextFrame}),0.0).xyz;
  return a+(b-a)*(f-f0);
}
fn oceanWindRingKeep(size:f32,cell:f32)->f32{
  return 1.0-smoothstep(1.0,2.0,OCEAN_WIND_TILE_CELLS*cell/size);
}
fn oceanWindDisplaceAt(p:vec2<f32>,cell:f32)->vec3<f32>{
  let w=oceanWindFrame(p);
  var t=vec3<f32>(0.0);
  ${cascadesDisplace}if(material.oceanCoast.w>0.5){
    let size=oceanLoopSize();
    t=oceanLoopRead(w/size)*(size/LOOP_SIZE)*oceanWindRingKeep(size,cell);
  }
  let across=oceanFromWind(t.yz);
  return vec3<f32>(across.x,t.x,across.y);
}
fn oceanWindDisplace(p:vec2<f32>)->vec3<f32>{
  return oceanWindDisplaceAt(p,0.0);
}
