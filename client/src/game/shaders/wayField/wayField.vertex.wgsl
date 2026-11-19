${varyings}
@vertex fn mainVertex(input:VertexInput)->FieldOut{
  var out:FieldOut;
  out.place=input.position;
  out.field=input.color;
  out.fromEye=input.position-scene.vEyePosition.xyz;
  out.position=scene.viewProjection*vec4<f32>(input.position,1.0);
  return out;
}
