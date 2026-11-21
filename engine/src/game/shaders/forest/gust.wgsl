fn foliageGust(p:vec2<f32>,t:f32)->f32{
  let u=material.windDir.x*p.x+material.windDir.y*p.y;
  let c=floor(p/${windRaggedCell});
  let ragged=${windRagged}*(fract(c.x*0.618034+c.y*0.381966)-0.5);
  return sin(${windK1}*u-${windOmegaGust}*t+ragged)+0.5*sin(${windK2}*u-${windOmegaGust2}*t+1.7*ragged);
}
