
const PAINT_CAP:f32=64.0;
const PAINT_JOINT_SHARPNESS:f32=60.0;
fn composeCompress(c:vec3<f32>)->vec3<f32>{
  return c/(1.0+c);
}
fn composeScene(uv:vec2<f32>)->vec3<f32>{
  return clamp(textureSampleLevel(sceneSampler,postSampler,tx(uv),0.0).rgb,vec3<f32>(0.0),vec3<f32>(PAINT_CAP));
}
fn composeWeight(bilinear:f32,at:vec3<f32>,guide:vec3<f32>)->f32{
  let d=composeCompress(at)-guide;
  return bilinear*exp(-PAINT_JOINT_SHARPNESS*dot(d,d))+1.0e-5;
}
fn composePaint(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(paintSampler,postSampler,tx(uv),0.0).rgb;}
fn composed(vUV:vec2<f32>)->vec3<f32>{
  let scene=composeScene(vUV);
  let guide=composeCompress(scene);
  let p=vUV/u.halfTexel-0.5;
  let base=floor(p);
  let f=p-base;
  let c00=(base+vec2<f32>(0.5,0.5))*u.halfTexel;
  let c10=(base+vec2<f32>(1.5,0.5))*u.halfTexel;
  let c01=(base+vec2<f32>(0.5,1.5))*u.halfTexel;
  let c11=(base+vec2<f32>(1.5,1.5))*u.halfTexel;
  let w00=composeWeight((1.0-f.x)*(1.0-f.y),composeScene(c00),guide);
  let w10=composeWeight(f.x*(1.0-f.y),composeScene(c10),guide);
  let w01=composeWeight((1.0-f.x)*f.y,composeScene(c01),guide);
  let w11=composeWeight(f.x*f.y,composeScene(c11),guide);
  let painted=(composePaint(c00)*w00+composePaint(c10)*w10+composePaint(c01)*w01+composePaint(c11)*w11)/(w00+w10+w01+w11);
  return mix(scene,painted,u.strength);
}
