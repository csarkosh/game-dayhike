{
  let dwScale=length(finalWorld[0].xyz);
  let dwAlong=position.x*dwScale*material.deadwoodBark.x;
  let dwTurn=atan2(position.y-material.deadwoodAxis.x,position.z-material.deadwoodAxis.y)/6.283185307179586;
  let dwTiles=max(1.0,floor(6.283185307179586*material.deadwoodBark.z*dwScale*material.deadwoodBark.y+0.5));
  out.uv=vec2<f32>(dwTurn*dwTiles,dwAlong);
  out.vDeadwood=vec4<f32>(deadwoodRole,(position.x+material.deadwoodBark.w)*dwScale,position.y,mossHash(o));}
