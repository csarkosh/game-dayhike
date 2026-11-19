{
let wingPhase=finalWorld[0].w;
let wingAmp=finalWorld[1].w;
var wingPos=position;
let wingSide=select(1.0,-1.0,wingPos.x<0.0);
let wingAbsX=abs(wingPos.x);
let wingSpan=clamp(wingAbsX/material.wingHalfSpan,0.0,1.0);
let wingA=wingAmp*sin(material.wingTime*material.wingOmega+wingPhase)*wingSpan;
let wingC=cos(wingA);
let wingS=sin(wingA);
let wingY0=wingPos.y;
wingPos.y=wingY0*wingC+wingAbsX*wingS;
wingPos.x=wingSide*(wingAbsX*wingC-wingY0*wingS);
let wingWorld=(finalWorld*vec4<f32>(wingPos,1.0)).xyz;
out.worldPos=wingWorld;
out.clipPos=scene.viewProjection*vec4<f32>(wingWorld,1.0);
}
