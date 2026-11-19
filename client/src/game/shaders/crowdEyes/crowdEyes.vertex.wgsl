${varyings}
@vertex fn mainVertex(input:VertexInput)->EyesOut{
  var out:EyesOut;
  let crowdEye=input.tangent;
  let right=vec3<f32>(scene.view[0][0],scene.view[1][0],scene.view[2][0]);
  let upward=vec3<f32>(scene.view[0][1],scene.view[1][1],scene.view[2][1]);
  let at=input.position+right*(crowdEye.w+crowdEye.x*crowdEye.z)+upward*(crowdEye.y*crowdEye.z);
  out.corner=crowdEye.xy;
  out.colour=input.color;
  out.position=scene.viewProjection*vec4<f32>(at,1.0);
  return out;
}
