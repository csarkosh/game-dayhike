
${varyings}
@vertex fn mainVertex(input:VertexInput)->PatchOut{
  var out:PatchOut;
  let worldPos=vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  out.position.z+=${ahead}*out.position.w;
  out.fogDistance=(scene.view*worldPos).xyz;
  out.uv=input.uv;
  return out;
}
