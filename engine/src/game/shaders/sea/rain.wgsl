
const WATER_RAIN_RADIUS:f32=0.25;
const WATER_RAIN_INSET:f32=0.25;
fn waterRainLayer(xz:vec2<f32>,t:f32,layer:f32,scale:f32,offset:vec2<f32>,timeMul:f32,timeAdd:f32)->vec2<f32>{
  let p=xz*scale+offset;
  let c=floor(p);
  let h=c-512.0*floor(c/512.0);
  let centre=vec2<f32>(waterSkinHash(h+vec2<f32>(37.0,0.0)),waterSkinHash(h+vec2<f32>(0.0,91.0)))*(1.0-2.0*WATER_RAIN_INSET)+WATER_RAIN_INSET;
  let d=p-c-centre;
  let dist=length(d);
  let r=clamp(1.0-dist/WATER_RAIN_RADIUS,0.0,1.0);
  let dir=d/max(dist,0.0001);
  let w=clamp(material.waterRain*4.0-layer,0.0,1.0);
  let drop=fract(waterSkinHash(h)+t*timeMul+timeAdd);
  let rt=drop-1.0+r;
  let f=clamp(0.2+w*0.8-drop,0.0,1.0);
  return dir*f*r*sin(clamp(rt*9.0,0.0,3.0)*3.14159)*0.35;
}
fn waterRainSlope(xz:vec2<f32>)->vec2<f32>{
  if(material.waterRain<=0.0){return vec2<f32>(0.0);}
  let t=${rainTime};
  return waterRainLayer(xz,t,0.0,2.5,vec2<f32>(0.0,0.0),1.0,0.0)
    +waterRainLayer(xz,t,1.0,3.2,vec2<f32>(0.37,0.61),0.85,0.2)
    +waterRainLayer(xz,t,2.0,2.1,vec2<f32>(0.71,0.13),0.93,0.45)
    +waterRainLayer(xz,t,3.0,3.8,vec2<f32>(0.19,0.83),1.13,0.7);
}
