
{
  let P=input.worldPos;
  let rfi=(P.z-roadTable.x)/roadTable.y;
  let rfl=clamp(floor(rfi),0.0,roadTable.z-2.0);
  let rft=clamp(rfi-rfl,0.0,1.0);
  let rx0=textureLoad(roadCenter,vec2<i32>(i32(rfl),0),0).r;
  let rx1=textureLoad(roadCenter,vec2<i32>(i32(rfl)+1,0),0).r;
  let ru=P.x-mix(rx0,rx1,rft);
  let rau=abs(ru);
  let raa=fwidth(rau);
  if(rau<30.0){
    let rk=1.0-smoothstep(terrainFade.x,terrainFade.y,distance(P,terrainEye));
    let rGravelTex=mix(vec3<f32>(1.0),tex2(terrainPebble,P.xz*terrainTiling.w)/terrainRock2.y,rk);
    let rUv=vec2<f32>(ru,P.z)*roadTable.w;
    var rAsphaltTex=mix(vec3<f32>(1.0),tex2(roadAsphalt,rUv)/terrainRock2.y,rk);
    let rAsphaltN=textureSample(terrainNormals,terrainSmp,rUv,5).rgb*2.0-1.0;
    let rAsphaltRAH=textureSample(terrainRAH,terrainSmp,rUv,5).rgb;
    rAsphaltTex*=mix(1.0,rAsphaltRAH.g/0.5,rk);
    let rVerge=0.5*(1.0-smoothstep(5.5,30.0,rau));
    let rGravel=1.0-smoothstep(3.5,5.5,rau);
    let rE=max(0.4,raa);
    let rAsphalt=1.0-smoothstep(3.5-rE,3.5+rE,rau);
    let rRelief=rAsphalt*rk;
    N=normalize(mix(N,normalize(N+vec3<f32>(rAsphaltN.x,0.0,rAsphaltN.y)),rRelief));
    terrainRough=mix(terrainRough,clamp(terrainLayerRough2.y*mix(1.0,rAsphaltRAH.r/0.5,rk),0.0,1.0),rAsphalt);
    terrainF0=mix(terrainF0,terrainLayerF02.y,rAsphalt);
    terrainPaintW=max(terrainPaintW,rGravel);
    let rPhase=gmod(P.z,12.0);
    var rh=u32(i32(floor(P.z/12.0)))*2654435761u;
    rh^=rh>>15u;
    rh*=2246822519u;
    rh^=rh>>13u;
    let rKeep=f32(rh&65535u)/65536.0;
    let rOn=select(0.0,1.0,rPhase<3.0&&rKeep<0.65);
    let rLe=max(0.2,raa);
    let rLine=rOn*0.55*(1.0-smoothstep(0.15,0.15+rLe,rau));
    var rCol=mix(surfaceAlbedo,vec3<f32>(0.17,0.14,0.1)*terrainAlbedo,rVerge);
    rCol=mix(rCol,vec3<f32>(0.3,0.28,0.24)*rGravelTex*terrainAlbedo,rGravel);
    rCol=mix(rCol,vec3<f32>(0.14,0.14,0.15)*rAsphaltTex*terrainAlbedo,rAsphalt);
    rCol=mix(rCol,vec3<f32>(0.42,0.36,0.18)*terrainAlbedo,rLine);
    surfaceAlbedo=rCol;
  }
}
