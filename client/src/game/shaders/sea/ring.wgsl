
  let seaRing=u32(position.y+0.5);
  let seaRecord=bitcast<vec4<f32>>(material.seaRings[seaRing]);
  let seaSpacing=f32(1u<<seaRing);
