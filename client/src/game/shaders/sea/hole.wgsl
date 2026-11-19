
  if(seaRing>0u&&uv.x>=0.0){
    let seaCell=uv-seaRecord.zw;
    if(seaCell.x>=0.0&&seaCell.x<${holeCells}.0&&seaCell.y>=0.0&&seaCell.y<${holeCells}.0){out.clipPos=vec4<f32>(0.0,0.0,-1.0,1.0);}
  }
