
  out.vFadeBands=fadeBands;
  let dfD=distance(o,material.fadeEye.xz);
  out.vFadeDist=dfD;
  let dfK=1.0+material.fadeWiden.z*smoothstep(material.fadeWiden.x,material.fadeWiden.y,dfD);
  w=vec3<f32>(o.x+(w.x-o.x)*dfK,w.y,o.y+(w.z-o.y)*dfK);
