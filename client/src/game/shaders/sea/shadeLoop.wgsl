
fn oceanWindPixelKeep(size:f32,n:f32,pixel:f32)->f32{
  return 1.0-smoothstep(OCEAN_RESOLVE_PHASE_LO,OCEAN_RESOLVE_PHASE_HI,0.5*OCEAN_TWO_PI*n*pixel/size);
}
struct OceanWindSlopes{slope:vec2<f32>,drawn:f32}
fn oceanWindSlopesAt(p:vec2<f32>,pixel:f32)->OceanWindSlopes{
  let w=oceanWindFrame(p);
  var g=vec2<f32>(0.0);
  var o:OceanWindSlopes;
  o.drawn=0.0;
  ${cascadesSlopes}if(material.oceanCoast.w>0.5){
    let size=oceanLoopSize();
    let uv=w/size;
    let e=1.0/LOOP_N;
    let keep=oceanWindPixelKeep(size,LOOP_N,pixel);
    let gx=oceanLoopRead(uv+vec2<f32>(e,0.0)).x-oceanLoopRead(uv-vec2<f32>(e,0.0)).x;
    let gz=oceanLoopRead(uv+vec2<f32>(0.0,e)).x-oceanLoopRead(uv-vec2<f32>(0.0,e)).x;
    g=vec2<f32>(gx,gz)*(LOOP_N/(2.0*LOOP_SIZE))*keep;
    o.drawn=keep*keep*material.oceanWindStats.y;
  }
  o.slope=-oceanFromWind(g);
  return o;
}
fn oceanCrestKeep(pixel:f32)->f32{
  ${crestKeepBranch}return oceanWindPixelKeep(oceanLoopSize(),LOOP_N,pixel);
}
fn oceanCapThreshold(coverage:f32)->f32{
  let s=sqrt(-2.0*log(clamp(coverage,1.0e-6,0.5)));
  return s-(2.515517+0.802853*s+0.010328*s*s)/(1.0+1.432788*s+0.189269*s*s+0.001308*s*s*s);
}
fn oceanWhitecap(coverage:f32,crest:f32)->f32{
  let t=oceanCapThreshold(coverage);
  return smoothstep(t-0.5*OCEAN_CAP_SOFT,t+0.5*OCEAN_CAP_SOFT,crest)*step(1.0e-6,coverage);
}
fn oceanWindSlopeLimit(u10:f32,shelter:f32,drawn:f32)->f32{
  return min(1.0,sqrt((WATER_COX_MUNK_A+WATER_COX_MUNK_B*u10)*shelter/max(drawn,1.0e-6)));
}
