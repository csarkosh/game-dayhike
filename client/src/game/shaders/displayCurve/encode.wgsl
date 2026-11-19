${displayCurve}
fn displayEncoded(color:vec3<f32>,contrast:f32)->vec3<f32>{
  var result=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
  result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));
  return displayContrastOf(result,contrast);
}
