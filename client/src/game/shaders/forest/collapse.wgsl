{
  let bRoot=(finalWorld*vec4<f32>(blade.x,0.0,blade.y,1.0)).xyz;
  let bGrow=smoothstep(material.foliageBladeEdges.x,material.foliageBladeEdges.y,fDist);
  let bThin=smoothstep(material.foliageBladeEdges.z,material.foliageBladeEdges.w,fDist);
  let bIn=clamp((${bladeSoftOuter}*bGrow-blade.z)/${bladeSoft},0.0,1.0);
  let bOut=clamp((blade.z-bThin*${bladeSoftOuter})/${bladeSoft}+1.0,0.0,1.0);
  let bAlive=bIn*bOut*step(fract(blade.x*37.31+blade.y*91.17+0.37),bladeStrength);
  w=bRoot+(w-bRoot)*bAlive;}
