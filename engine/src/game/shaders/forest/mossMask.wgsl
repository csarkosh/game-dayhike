
  let mossBand=1.0-smoothstep(${mossBand0},${mossBand1},input.vMoss.x);
  let mossSide=smoothstep(0.0,${mossSideEdge},dot(normalize(input.worldNormal),MOSS_SIDE));
  let mossTree=mix(${mossAmount0},${mossAmount1},input.vMoss.y);
