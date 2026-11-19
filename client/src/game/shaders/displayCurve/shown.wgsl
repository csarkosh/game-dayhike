
fn displayShown(linear:vec3<f32>,exposure:f32,contrast:f32,at:vec2<f32>)->vec3<f32>{
  return gradeDither(gradeCurves(displayColour(gradeVignette(linear,at),exposure,contrast)),at);
}
