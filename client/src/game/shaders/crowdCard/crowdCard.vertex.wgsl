${varyings}
@vertex fn mainVertex(input:VertexInput)->CardOut{
  var out:CardOut;
  let crowdCard=input.color;
  var right=vec2<f32>(scene.view[0][0],scene.view[2][0]);
  right=right/max(length(right),0.0001);
  var at=input.position;
  let corner=sign(crowdCard.x);
  let reach=clamp(abs(crowdCard.x)-1.0,0.0,1.0);
  let across=right*(corner*crowdCard.z*0.25*(1.0+reach));
  at=vec3<f32>(at.x+across.x,at.y+crowdCard.y*crowdCard.z,at.z+across.y);
  out.card=vec4<f32>(corner,crowdCard.y,crowdCard.z,crowdCard.w);
  out.reach=reach;
  out.stir=input.uv;
  out.position=scene.viewProjection*vec4<f32>(at,1.0);
  return out;
}
