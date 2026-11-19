
  let dwN=normalize(input.worldNormal);
  let dwLog=input.vDeadwood.x;
  let mossBand=mix(1.0-smoothstep(${mossBand0},${mossBand1},input.vDeadwood.y),1.0,dwLog);
  let mossSide=mix(smoothstep(0.0,${mossSideEdge},dot(dwN,MOSS_SIDE)),smoothstep(${deadwoodUp0},${deadwoodUp1},dwN.y),dwLog);
  let mossTree=mix(${mossAmount0},${mossAmount1},mix(input.vDeadwood.w,mix(${deadwoodLogDraw},1.0,input.vDeadwood.w),dwLog));
