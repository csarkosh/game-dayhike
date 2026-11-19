
{
  let P=input.worldPos;
  let fMeta=textureLoad(featureTex,vec2<i32>(0,1),0);
  let fRim=textureLoad(featureTex,vec2<i32>(1,1),0);
  var fLake=0.0;
  for(var fi=0;fi<8;fi++){
    if(f32(fi)>=featureInfo.x){break;}
    let f=textureLoad(featureTex,vec2<i32>(fi,0),0);
    let fd=length(P.xz-f.xy);
    if(f.w>1.5&&f.w<2.5){
      let meadow=1.0-smoothstep(f.z,f.z+fMeta.z,fd);
      surfaceAlbedo*=mix(vec3<f32>(1.0),vec3<f32>(0.92,1.06,0.82),meadow*0.5);
    }else if(f.w>2.5){
      let fShore=-featureShoreAt(fLake,f.xy,f.z,P.xz);
      fLake+=1.0;
      var shore=1.0-smoothstep(fMeta.w,fMeta.w+2.0,fShore);
      shore*=smoothstep(-1.0,0.0,fShore);
      surfaceAlbedo*=mix(vec3<f32>(1.0),vec3<f32>(0.85,0.78,0.70),shore*0.8);
    }else if(f.w>0.5){
      let above=smoothstep(fMeta.x-fMeta.y,fMeta.x,P.y);
      let fNear=1.0-smoothstep(f.z-fRim.x,f.z,fd);
      let crest=1.0-smoothstep(25.0,40.0,fd);
      let rock=max(above*fNear,crest);
      let fLum=dot(surfaceAlbedo,vec3<f32>(0.299,0.587,0.114));
      surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(fLum)*1.1,rock*0.85);
    }
  }
}
