
surfaceAlbedo=baseColor*input.vTerrainColor.rgb;
{
  let P=input.worldPos;
  let uvXZ=P.xz;
  let uvG=uvXZ*terrainTiling.x;
  let uvF=uvXZ*terrainTiling.y;
  let uvS=uvXZ*terrainTiling.z;
  let uvP=uvXZ*terrainTiling.w;
  let gdx=dpdx(uvG);let gdy=dpdy(uvG);
  let uvD=uvXZ*terrainDetail.x;
  let ddx=dpdx(uvD);let ddy=dpdy(uvD);
  var gh=Hex(vec2<f32>(0.0),vec2<f32>(0.0),vec2<f32>(0.0),vec3<f32>(0.0));
  if(input.vTerrainW.x>0.0){
    gh=hexSetup(uvG);
  }
  let rt=terrainRock2.x;
  let terrainN=normalize(input.worldNormal);
  let an=abs(terrainN);
  let bw=an/max(an.x+an.y+an.z,1e-4);
  let dist=distance(P,terrainEye);
  let strength=input.vTerrainW2.y*(1.0-smoothstep(terrainFade.x,terrainFade.y,dist));
  var w0=input.vTerrainW.x;var w1=input.vTerrainW.y;var w2=input.vTerrainW.z;var w3=input.vTerrainW.w;var w4=input.vTerrainW2.x;
  var rah0=vec3<f32>(0.5,1.0,0.5);var rah1=rah0;var rah2=rah0;var rah3=rah0;var rah4=rah0;
  var nrm=terrainN;
  var detailAo=1.0;
  var rpX=vec2<f32>(0.0);var rpY=vec2<f32>(0.0);var rpZ=vec2<f32>(0.0);
  if(strength>0.0&&w2>0.05){
    let rDir=normalize(P-terrainEye);
    let rDepth=0.03*rt;
    var rAb:vec2<f32>;var rUv:vec2<f32>;
    if(bw.y>=bw.x&&bw.y>=bw.z){rAb=rDir.xz;rUv=P.xz*rt;}
    else if(bw.x>=bw.z){rAb=rDir.yz;rUv=P.yz*rt;}
    else{rAb=rDir.xy;rUv=P.xy*rt;}
    let rStep=rAb*rDepth/12.0;
    let rLayer=1.0/12.0;
    var rOff=vec2<f32>(0.0);var rD=0.0;
    var rPrev=-(1.0-textureSample(terrainRAH,terrainSmp,rUv,2).b);
    var rHit=rPrev>=0.0;
    for(var ri=0;ri<12;ri++){
      if(rHit){break;}
      let nOff=rOff+rStep;let nD=rD+rLayer;
      let rDiff=nD-(1.0-textureSample(terrainRAH,terrainSmp,rUv+nOff,2).b);
      if(rDiff>=0.0){let rT=rPrev/(rPrev-rDiff);rOff=rOff+rStep*rT;rHit=true;}
      else{rOff=nOff;rD=nD;rPrev=rDiff;}
    }
    rOff*=strength;
    if(bw.y>=bw.x&&bw.y>=bw.z){rpY=rOff;}else if(bw.x>=bw.z){rpX=rOff;}else{rpZ=rOff;}
  }
  if(strength>0.0){
    if(input.vTerrainW.x>0.0){
      rah0=hexFetch(terrainRAH,gh,0,gdx,gdy);
    }else{
      rah0=textureSampleGrad(terrainRAH,terrainSmp,uvG,0,gdx,gdy).rgb;
    }
    rah1=textureSample(terrainRAH,terrainSmp,uvF,1).rgb;
    rah2=textureSample(terrainRAH,terrainSmp,P.xz*rt+rpY,2).rgb;
    rah3=textureSample(terrainRAH,terrainSmp,uvS,3).rgb;
    rah4=textureSample(terrainRAH,terrainSmp,uvP,4).rgb;
    let m=max(max(w0+rah0.b,w1+rah1.b),max(max(w2+rah2.b,w3+rah3.b),w4+rah4.b))-0.200;
    var b0=max(w0+rah0.b-m,0.0);var b1=max(w1+rah1.b-m,0.0);var b2=max(w2+rah2.b-m,0.0);
    var b3=max(w3+rah3.b-m,0.0);var b4=max(w4+rah4.b-m,0.0);
    let bs=max(b0+b1+b2+b3+b4,1e-4);
    b0=mix(w0,b0/bs,terrainReliefOn);b1=mix(w1,b1/bs,terrainReliefOn);b2=mix(w2,b2/bs,terrainReliefOn);
    b3=mix(w3,b3/bs,terrainReliefOn);b4=mix(w4,b4/bs,terrainReliefOn);
    w0=mix(w0,b0,strength);w1=mix(w1,b1,strength);w2=mix(w2,b2,strength);
    w3=mix(w3,b3,strength);w4=mix(w4,b4,strength);
    var t0:vec3<f32>;
    if(input.vTerrainW.x>0.0){
      t0=hexFetch(terrainNormals,gh,0,gdx,gdy)*2.0-1.0;
    }else{
      t0=textureSampleGrad(terrainNormals,terrainSmp,uvG,0,gdx,gdy).rgb*2.0-1.0;
    }
    let t1=textureSample(terrainNormals,terrainSmp,uvF,1).rgb*2.0-1.0;
    let t3=textureSample(terrainNormals,terrainSmp,uvS,3).rgb*2.0-1.0;
    let t4=textureSample(terrainNormals,terrainSmp,uvP,4).rgb*2.0-1.0;
    let tx=textureSample(terrainNormals,terrainSmp,P.yz*rt+rpX,2).rgb*2.0-1.0;
    let ty=textureSample(terrainNormals,terrainSmp,P.xz*rt+rpY,2).rgb*2.0-1.0;
    let tz=textureSample(terrainNormals,terrainSmp,P.xy*rt+rpZ,2).rgb*2.0-1.0;
    var planar=t0.xy*w0+t1.xy*w1+t3.xy*w3+t4.xy*w4;
    let detailStrength=w0*(1.0-smoothstep(terrainDetail.y,terrainDetail.z,dist))*terrainReliefOn;
    if(detailStrength>0.0){
      let dh=hexSetup(uvD);
      let tD=hexFetch(terrainNormals,dh,0,ddx,ddy)*2.0-1.0;
      planar+=tD.xy*terrainDetail.w*detailStrength;
      let hD=hexFetch(terrainRAH,dh,0,ddx,ddy).b;
      detailAo=mix(1.0,smoothstep(terrainDetail2.y,terrainDetail2.z,hD),terrainDetail2.x*detailStrength);
    }
    let pert=vec3<f32>(planar.x,0.0,planar.y)
      +w2*(vec3<f32>(0.0,tx.x,tx.y)*bw.x+vec3<f32>(ty.x,0.0,ty.y)*bw.y+vec3<f32>(tz.x,tz.y,0.0)*bw.z);
    nrm=normalize(terrainN+pert*strength);
    N=nrm;
  }
  var grassAlbedo:vec3<f32>;
  if(input.vTerrainW.x>0.0){grassAlbedo=hexFetch(terrainGrass,gh,0,gdx,gdy)*${grassMeanInv};}
  else{grassAlbedo=textureSampleGrad(terrainGrass,terrainSmp,uvG,0,gdx,gdy).rgb*${grassMeanInv};}
  let blended=
      grassAlbedo*w0
    +tex2(terrainFloor,uvF)*${floorMeanInv}*w1
    +tex2(terrainSand,uvS)*${sandMeanInv}*w3
    +tex2(terrainPebble,uvP)*${pebbleMeanInv}*w4
    +w2*${rockMeanInv}*(
      tex2(terrainRock,P.yz*rt+rpX)*bw.x
    +tex2(terrainRock,P.xz*rt+rpY)*bw.y
    +tex2(terrainRock,P.xy*rt+rpZ)*bw.z);
  let ao=rah0.g*w0+rah1.g*w1+rah2.g*w2+rah3.g*w3+rah4.g*w4;
  surfaceAlbedo*=mix(vec3<f32>(1.0),blended,strength)*mix(1.0,ao/0.5,strength)*detailAo;
  let macroN18=macroValueNoise(P.xz,MACRO_WAVE.x);
  let macroN6=macroValueNoise(P.xz,MACRO_WAVE.y);
  let macroRgb=macroTint(MACRO_WEIGHT.x*macroN18+MACRO_WEIGHT.y*macroN6,1.0-terrainN.y);
  surfaceAlbedo*=mix(vec3<f32>(1.0),macroRgb,w0*terrainMacroOn*(1.0-smoothstep(terrainFade.x,terrainFade.y,dist)));
  surfaceAlbedo=mix(surfaceAlbedo,terrainTuft,w0*horizonWeight(dist));
  let swardW=terrainSward.w*smoothstep(terrainSwardBand.x,terrainSwardBand.y,input.vTerrainCover)*(1.0-smoothstep(terrainSwardBand.z,terrainSwardBand.w,dist));
  surfaceAlbedo=mix(surfaceAlbedo,terrainSward.rgb,swardW);
  let fcFw=fwidth(P.xz);
  let fcFoot=max(fcFw.x,fcFw.y);
  let fcFarMacro=macroTint(farMacro(P.xz),0.0);
  surfaceAlbedo*=mix(vec3<f32>(1.0),fcFarMacro,clamp(w0+input.vTerrainCover,0.0,1.0)*terrainMacroOn);
  let fcDrift=farDrift(P.xz,fcFoot);
  terrainFarW=farCoverWeight(input.vTerrainCover,input.vTerrainW2.z,dist);
  let fcBare=smoothstep(terrainFade.x,terrainFade.y,dist)*(1.0-terrainFarW);
  surfaceAlbedo*=mix(1.0,mix(FAR_BARE_AO,1.0,fcDrift.z),fcBare);
  if(terrainFarW>0.0){
    let fcClump=farClump(P.xz,fcFoot);
    let fcB18=1.0-smoothstep(0.5,1.0,fcFoot/MACRO_WAVE.x);
    let fcB6=1.0-smoothstep(0.5,1.0,fcFoot/MACRO_WAVE.y);
    let fcMacro=macroTint(MACRO_WEIGHT.x*mix(0.5,macroN18,fcB18)+MACRO_WEIGHT.y*mix(0.5,macroN6,fcB6),1.0-terrainN.y);
    let fcTarget=mix(FAR_SWARD,FAR_LITTER,clamp(input.vTerrainW2.z,0.0,1.0))
      *fcMacro
      *fcFarMacro
      *(1.0-FAR_CANOPY_SHADE*clamp(input.vTerrainW2.w,0.0,1.0))
      *mix(FAR_CLUMP_AO,1.0,fcClump.z)
      *mix(FAR_DRIFT_AO,1.0,fcDrift.z);
    surfaceAlbedo=mix(surfaceAlbedo,fcTarget,FAR_SWARD_MAX*terrainFarW);
    terrainFarN=normalize(N+vec3<f32>(-fcClump.x,0.0,-fcClump.y)*FAR_CLUMP_TILT+vec3<f32>(-fcDrift.x,0.0,-fcDrift.y)*FAR_DRIFT_TILT);
  }
  let rBase=terrainLayerRough.x*w0+terrainLayerRough.y*w1+terrainLayerRough.z*w2+terrainLayerRough.w*w3+terrainLayerRough2.x*w4;
  let rMap=rah0.r*w0+rah1.r*w1+rah2.r*w2+rah3.r*w3+rah4.r*w4;
  terrainRough=clamp(max(rBase*mix(1.0,rMap/0.5,strength),smoothstep(80.0,400.0,dist)),0.0,1.0);
  terrainF0=terrainLayerF0.x*w0+terrainLayerF0.y*w1+terrainLayerF0.z*w2+terrainLayerF0.w*w3+terrainLayerF02.x*w4;
}
