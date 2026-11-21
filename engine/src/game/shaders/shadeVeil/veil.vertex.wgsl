
struct VeilOut{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
@vertex fn mainVertex(input:VertexInput)->VeilOut{
  var out:VeilOut;
  out.position=vec4<f32>(input.position.xy,1.0,1.0);
  out.vUV=input.position.xy*0.5+0.5;
  return out;
}
