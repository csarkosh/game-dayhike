  if(u.shadeShape.w>0.0){
    let shadeStep=vec2<f32>(u.shadeShape.x,u.shadeShape.x*u.shadeShape.z);
    var shadeInner=shadeRead(vUV)*2.0;
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.5,0.0));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.5,0.0));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,0.5));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,-0.5));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.35,0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.35,0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.35,-0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.35,-0.35));
    var shadeOuter=shadeRead(vUV+shadeStep*vec2<f32>(1.0,0.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-1.0,0.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,1.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,-1.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.7,0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-0.7,0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.7,-0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-0.7,-0.7));
    let shadeRGB=(shadeInner+shadeOuter)*u.shadeShape.w/18.0;
    let shadeReal=shadeInner.z*u.shadeShape.w/10.0;
    let shadeFigure=shadeRGB.x+shadeRGB.z;
    let shadeGone=shadeRGB.y/max(shadeFigure,1.0e-4);
    let shadeBlot=shadeNoise(vUV*vec2<f32>(u.shadeShape.z,1.0)*9.0+u.stareShade.w*0.12);
    let shadeKeep=smoothstep(shadeGone-0.35,shadeGone+0.05,shadeBlot);
    c*=1.0-min(1.0,shadeRGB.x*u.shadeShape.y+shadeReal*u.shadeMonster)*shadeKeep;
  }
