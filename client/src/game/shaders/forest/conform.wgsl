
  let gcOff=w.xz-o;
  let gcW=1.0-smoothstep(0.0,material.gcRamp,position.y);
  w.y+=gcW*min(0.0,material.gcOvershoot*dot(gcOff,groundGrad));
