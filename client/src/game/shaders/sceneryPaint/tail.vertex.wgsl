
${tailVaryings}
@vertex fn mainVertex(input:VertexInput)->TailOut{
  var out:TailOut;
  let worldPos=vec4<f32>(input.position,1.0);
  out.position=scene.viewProjection*worldPos;
  return out;
}
