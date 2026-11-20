
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var depthSamples:texture_depth_multisampled_2d;
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let at=vec2<i32>(input.position.xy);
  var sum=0.0;
  for(var i:i32=0;i<${samples};i++){
    let d=textureLoad(depthSamples,at,i);
    if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}
  }
  return vec4<f32>(sum/${samples}.0,0.0,0.0,1.0);
}
