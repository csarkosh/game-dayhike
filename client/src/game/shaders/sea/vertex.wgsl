{${ring}
  var oceanMorph=0.0;
  var oceanCoarse=vec2<f32>(0.0);
  if(seaRing<${ringLast}u){
    let seaOut=min(min(position.x,${ringCells}.0-position.x),min(position.z,${ringCells}.0-position.z));
    var seaIn=max(abs(position.x-${ringMid}.0),abs(position.z-${ringMid}.0));
    if(seaRing>0u){
      let seaDx=max(max(seaRecord.z-position.x,position.x-(seaRecord.z+${holeCells}.0)),0.0);
      let seaDz=max(max(seaRecord.w-position.z,position.z-(seaRecord.w+${holeCells}.0)),0.0);
      seaIn=max(seaDx,seaDz);
    }
    let seaSpan=seaIn+seaOut;
    oceanMorph=select(seaIn/seaSpan,1.0,seaSpan==0.0);
    let seaOddX=(i32(position.x)&1)==1;
    let seaOddZ=(i32(position.z)&1)==1;
    oceanCoarse=vec2<f32>(select(0.0,seaSpacing,seaOddX),select(0.0,select(seaSpacing,-seaSpacing,seaOddX),seaOddZ));
  }
  let seaAt=seaRecord.xy+position.xz*seaSpacing;
  var positionUpdated=vec3<f32>(seaAt.x,material.waterLevel,seaAt.y);
  positionUpdated=vec3<f32>(positionUpdated.x-oceanMorph*oceanCoarse.x,positionUpdated.y,positionUpdated.z-oceanMorph*oceanCoarse.y);
  let vOceanXZ=positionUpdated.xz;
  let oceanVertex=oceanDisplace(positionUpdated.xz);
  positionUpdated+=oceanVertex.disp;
  out.vOceanXZ=vOceanXZ;
  out.vOceanSwellA=oceanVertex.swell;
  out.vOceanSwellB=vec4<f32>(oceanVertex.env,length(oceanVertex.env),0.0);
  positionUpdated.y+=swashLift(vOceanXZ,swashDepth(vOceanXZ),oceanVertex.disp.y);
  out.worldPos=positionUpdated;
  out.clipPos=scene.viewProjection*vec4<f32>(positionUpdated,1.0);
  out.uv=seaAt/${uvScale}.0;
  out.vBedDepth=textureLoad(seaBed,vec2<i32>(position.xz),i32(seaRing),0).r;
  out.vWaterViewDepth=out.clipPos.w;${hole}
}
