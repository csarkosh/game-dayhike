
struct PostVertex{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
@vertex fn postVertex(@builtin(vertex_index)i:u32)->PostVertex{
  var corners=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  let c=corners[i];
  return PostVertex(vec4<f32>(c,0.0,1.0),c*0.5+0.5);
}
fn tx(uv:vec2<f32>)->vec2<f32>{return vec2<f32>(uv.x,1.0-uv.y);}
