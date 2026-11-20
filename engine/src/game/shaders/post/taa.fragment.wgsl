
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@group(0)@binding(3)var historySampler:texture_2d<f32>;
@group(0)@binding(4)var depthSampler:texture_2d<f32>;
fn taaToYCoCg(c:vec3<f32>)->vec3<f32>{
  return vec3<f32>(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);
}
fn taaFromYCoCg(c:vec3<f32>)->vec3<f32>{
  return vec3<f32>(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);
}
fn taaRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(historySampler,postSampler,tx(uv),0.0).rgb;}
fn taaHistory(uv:vec2<f32>)->vec3<f32>{
  let texel=u.texel;
  let pos=uv/texel;
  let tc1=floor(pos-0.5)+0.5;
  let f=pos-tc1;
  let w0=f*(-0.5+f*(1.0-0.5*f));
  let w1=1.0+f*f*(-2.5+1.5*f);
  let w2=f*(0.5+f*(2.0-1.5*f));
  let w3=f*f*(-0.5+0.5*f);
  let w12=w1+w2;
  let tc0=(tc1-1.0)*texel;
  let tc3=(tc1+2.0)*texel;
  let tc12=(tc1+w2/w12)*texel;
  let r=taaRead(vec2<f32>(tc12.x,tc0.y))*(w12.x*w0.y)
    +taaRead(vec2<f32>(tc0.x,tc12.y))*(w0.x*w12.y)
    +taaRead(tc12)*(w12.x*w12.y)
    +taaRead(vec2<f32>(tc3.x,tc12.y))*(w3.x*w12.y)
    +taaRead(vec2<f32>(tc12.x,tc3.y))*(w12.x*w3.y);
  let wsum=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y;
  return max(r/wsum,vec3<f32>(0.0));
}
fn taaClip(p:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->vec3<f32>{
  let centre=0.5*(hi+lo);
  let extent=0.5*(hi-lo)+1.0e-5;
  let v=p-centre;
  let q=abs(v/extent);
  let m=max(q.x,max(q.y,q.z));
  if(m>1.0){return centre+v/m;}
  return p;
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let texel=u.texel;
  let cur=textureSampleLevel(textureSampler,postSampler,tx(vUV),0.0);
  var m1=vec3<f32>(0.0);
  var m2=vec3<f32>(0.0);
  var nmin=vec3<f32>(1.0e9);
  var nmax=vec3<f32>(-1.0e9);
  for(var y:i32=-1;y<=1;y++){
    for(var x:i32=-1;x<=1;x++){
      let s=taaToYCoCg(textureSampleLevel(textureSampler,postSampler,tx(vUV+vec2<f32>(f32(x),f32(y))*texel),0.0).rgb);
      m1+=s;
      m2+=s*s;
      nmin=min(nmin,s);
      nmax=max(nmax,s);
    }
  }
  let mean=m1/9.0;
  let sigma=sqrt(max(m2/9.0-mean*mean,vec3<f32>(0.0)));
  let lo=max(nmin,mean-u.taaParams.y*sigma);
  let hi=min(nmax,mean+u.taaParams.y*sigma);

  let d=textureSampleLevel(depthSampler,postSampler,tx(vUV),0.0).r;
  let ndc=vUV*2.0-1.0;
  let ray=u.taaForward+ndc.x*u.taaRight+ndc.y*u.taaUp;
  let v=select(ray,u.taaEye+ray*d-u.taaPrevEye,d>0.0);
  let z=dot(v,u.taaPrevForward);
  let pndc=vec2<f32>(dot(v,u.taaPrevRight)/dot(u.taaPrevRight,u.taaPrevRight),dot(v,u.taaPrevUp)/dot(u.taaPrevUp,u.taaPrevUp))/max(z,1.0e-4);
  let puv=pndc*0.5+0.5;
  let ok=u.taaParams.z*step(1.0e-4,z)*step(0.0,puv.x)*step(puv.x,1.0)*step(0.0,puv.y)*step(puv.y,1.0);

  let hist=taaFromYCoCg(taaClip(taaToYCoCg(taaHistory(clamp(puv,vec2<f32>(0.0),vec2<f32>(1.0)))),lo,hi));
  let blended=mix(hist,cur.rgb,u.taaParams.x);
  return vec4<f32>(mix(cur.rgb,blended,ok),cur.a);
}
