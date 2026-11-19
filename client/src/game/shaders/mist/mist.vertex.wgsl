
${varyings}
@vertex fn mainVertex(input:VertexInput)->MistOut{
  var out:MistOut;
  let world=mat4x4<f32>(input.world0,input.world1,input.world2,vec4<f32>(input.world3.xyz,1.0));
  let worldPos=world*vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  out.fogDistance=(scene.view*worldPos).xyz;
  out.uv=input.uv;
  out.visibility=input.world3.w;
  return out;
}
