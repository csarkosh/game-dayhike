
  let fH=clamp(position.y/material.foliageHeight,0.0,1.0);
  let fH2=fH*fH;
  let fDist=distance(o,material.windEye.xz);
  let fCell=floor(o/${clumpCell});
  let fClump=fract(fCell.x*0.618034+fCell.y*0.381966);
  let fScale=length(finalWorld[1].xyz);
  let fNl=length(out.worldNormal);
  let fUp=out.worldNormal/max(fNl,1.0e-6)+vec3<f32>(0.0,material.foliageNormalUp,0.0);
  let fUl=length(fUp);
  if(fUl>1.0e-4){out.worldNormal=fUp/fUl*fNl;}else{out.worldNormal=vec3<f32>(0.0,fNl,0.0);}
  let fEdge=${edge};
  let fM=material.foliageAmp*fH2*material.foliageHeight*fScale*fEdge;
  let fDir=vec3<f32>(material.windDir.x,0.0,material.windDir.y);
  let fGust=foliageGust(o,material.windTime+0.6*(fClump-0.5));
  w+=fDir*(material.windLean+material.windGust*fGust)*fM;
  let fFlutter=sin(2.1*w.x+1.7*w.z+${flutterOmega}*material.windTime);
  let fF=material.windFlutter*fM*fFlutter*vec2<f32>(0.75,-0.35);
  w=vec3<f32>(w.x+fF.x,w.y,w.z+fF.y);
  if(material.foliageFlags.x>0.5){
    let fAway=o-material.windEye.xz;
    let fT=${tilt}*fH2*fAway/max(length(fAway),1.0e-3);
    w=vec3<f32>(w.x+fT.x,w.y,w.z+fT.y);
  }
  if(material.foliageFlags.y>0.5){
    for(var i:i32=0;i<${players};i++){
      let fD=o-bitcast<vec4<f32>>(material.windPlayers[i]).xz;
      let fL=length(fD);
      let fWt=1.0-clamp(fL/${bendRadius},0.0,1.0);
      let fB=(fD/max(fL,1.0e-3))*(${bend}*fH2*fWt*fWt);
      w=vec3<f32>(w.x+fB.x,w.y,w.z+fB.y);
    }
  }
  ${tinted}${collapse}
  out.vFoliageH=fH;out.vFoliageClump=fClump;out.vFoliageDist=fDist;
