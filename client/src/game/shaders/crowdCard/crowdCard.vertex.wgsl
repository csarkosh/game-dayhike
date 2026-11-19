${varyings}
@vertex fn mainVertex(input:VertexInput)->CardOut{
  var out:CardOut;
  let crowdCard=input.color;
  var right=vec2<f32>(scene.view[0][0],scene.view[2][0]);
  right=right/max(length(right),0.0001);
  var at=input.position;
  let across=right*(crowdCard.x*crowdCard.z*0.25);
  at=vec3<f32>(at.x+across.x,at.y+crowdCard.y*crowdCard.z,at.z+across.y);
  out.card=crowdCard;
  out.stir=input.uv;
  out.position=scene.viewProjection*vec4<f32>(at,1.0);
  return out;
}
