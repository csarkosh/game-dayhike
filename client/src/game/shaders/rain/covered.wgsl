
  let rMu=(rp.xz-u.rainMapCentre)/u.rainMapExtent+0.5;
  let rMap=textureLoad(rainMap,vec2<i32>(clamp(rMu*${rainMapTexels},vec2<f32>(0.0),vec2<f32>(${rainMapLast}))),0);
  let rInMap=step(0.0,rMu.x)*step(rMu.x,1.0)*step(0.0,rMu.y)*step(rMu.y,1.0);
  let rCovered=rInMap*step(rp.y,rMap.r+rMap.b);
  let rCover=select(mix(1.0,max(rMap.g,step(0.5,rMap.b)),rCovered),rCovered*(1.0-rMap.g)*u.rainCanopyWater,drip);
