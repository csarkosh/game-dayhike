
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@group(0)@binding(3)var lensSampler:texture_2d<f32>;
@group(0)@binding(4)var lensRepeat:sampler;
const LENS_TILES:f32=2.0;
const LENS_OFFSET:f32=0.012;
const LENS_COLUMNS:f32=8.0;
const LENS_JITTER:f32=0.05;
const SLIDE_RADIUS:f32=0.025;
const SLIDE_TRAIL:f32=0.2;
const SLIDE_CAP:f32=0.8;
const FOLD:f32=3600.0;
const FROST_TEXELS:f32=2.0;
const FOG_GAIN:f32=0.25;
fn lensHash(p:vec2<f32>)->f32{
  return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y));
}
fn lensScene(uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(textureSampler,postSampler,tx(uv),0.0);}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let frame=vec2<f32>(vUV.x*u.aspect,vUV.y)*LENS_TILES;
  let cell=floor(frame);
  let inTile=frame-cell;
  let flip=step(0.5,lensHash(cell+vec2<f32>(17.0,31.0)));
  let tileX=mix(inTile.x,1.0-inTile.x,flip);
  let shift=(vec2<f32>(lensHash(cell+vec2<f32>(5.0,7.0)),lensHash(cell+vec2<f32>(11.0,13.0)))-0.5)*2.0*LENS_JITTER;
  let d=textureSampleLevel(lensSampler,lensRepeat,vec2<f32>(tileX,inTile.y)+shift,0.0);
  let nStatic=(d.rg*2.0-1.0)*vec2<f32>(1.0-2.0*flip,1.0)*d.b;

  let column=floor(vUV.x*LENS_COLUMNS);
  let speed=floor((0.1+0.15*lensHash(vec2<f32>(column,3.0)))*FOLD)/FOLD;
  let run=u.time*speed+lensHash(vec2<f32>(column,5.0));
  let cycle=floor(run);
  let present=step(0.45,lensHash(vec2<f32>(column,cycle)));
  let yDrop=1.0+SLIDE_RADIUS-fract(run)*(1.0+2.0*SLIDE_RADIUS+SLIDE_TRAIL);
  let xDrop=(column+0.5+0.5*(lensHash(vec2<f32>(column,cycle+100.0))-0.5))/LENS_COLUMNS
    +0.004*sin(yDrop*50.0+column);
  let toDrop=vec2<f32>((vUV.x-xDrop)*u.aspect,vUV.y-yDrop);
  let q=length(toDrop)/SLIDE_RADIUS;
  let mSlide=(1.0-smoothstep(0.8,1.0,q))*present;
  let nSlide=toDrop/SLIDE_RADIUS*SLIDE_CAP*mSlide;
  let above=toDrop.y;
  let tSlide=(1.0-smoothstep(0.0,SLIDE_TRAIL,above))*step(0.0,above)
    *(1.0-smoothstep(0.3,0.5,abs(toDrop.x)/SLIDE_RADIUS))*present;

  let mask=max(d.b,mSlide);
  let trail=max(d.a,tSlide);
  let n=nStatic+nSlide;
  let uvR=vUV-u.lensStrength*LENS_OFFSET*vec2<f32>(n.x/u.aspect,n.y);
  let col=lensScene(uvR);
  let step2=u.texelSize*FROST_TEXELS;
  let soft=0.25*(
    lensScene(uvR+step2)
    +lensScene(uvR-step2)
    +lensScene(uvR+vec2<f32>(step2.x,-step2.y))
    +lensScene(uvR+vec2<f32>(-step2.x,step2.y)));
  let fog=u.lensStrength*(1.0-mask)*(1.0-trail)*FOG_GAIN;
  return mix(col,soft,fog);
}
