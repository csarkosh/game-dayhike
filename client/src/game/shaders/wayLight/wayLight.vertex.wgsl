${varyings}
@vertex fn mainVertex(input:VertexInput)->WayOut{
  var out:WayOut;
  out.place=input.position;
  out.way=input.color;
  out.fromEye=input.position-scene.vEyePosition.xyz;
  out.position=scene.viewProjection*vec4<f32>(input.position,1.0);
  return out;
}
