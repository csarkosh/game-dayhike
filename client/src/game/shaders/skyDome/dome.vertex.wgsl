
struct SkyOut{@builtin(position)position:vec4<f32>,@location(0)dir:vec3<f32>}
@vertex fn mainVertex(input:VertexInput)->SkyOut{
  var out:SkyOut;
  out.dir=input.position;
  out.position=scene.viewProjection*vec4<f32>(scene.vEyePosition.xyz+input.position,1.0);
  return out;
}
