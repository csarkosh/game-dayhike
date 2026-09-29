#define CUSTOM_FRAGMENT_DEFINITIONS
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
/**
*--------------------------------------------------------------------------------------------------
* Sky Color
*--------------------------------------------------------------------------------------------------
*/
float sunfade=1.0-clamp(1.0-exp((sunPosition.y/450000.0)),0.0,1.0);
float rayleighCoefficient=rayleigh-(1.0*(1.0-sunfade));
vec3 sunDirection=normalize(sunPosition);
float sunE=sunIntensity(dot(sunDirection,up));
vec3 betaR=simplifiedRayleigh()*rayleighCoefficient;
vec3 betaM=totalMie(lambda,K,turbidity)*mieCoefficient;
float zenithAngle=acos(max(0.0,dot(up,normalize(vPositionW-cameraPosition+cameraOffset))));
float sR=rayleighZenithLength/(cos(zenithAngle)+0.15*pow(93.885-((zenithAngle*180.0)/pi),-1.253));
float sM=mieZenithLength/(cos(zenithAngle)+0.15*pow(93.885-((zenithAngle*180.0)/pi),-1.253));
vec3 Fex=exp(-(betaR*sR+betaM*sM));
float cosTheta=dot(normalize(vPositionW-cameraPosition),sunDirection);
float rPhase=rayleighPhase(cosTheta*0.5+0.5);
vec3 betaRTheta=betaR*rPhase;
float mPhase=hgPhase(cosTheta,mieDirectionalG);
vec3 betaMTheta=betaM*mPhase;
vec3 Lin=pow(sunE*((betaRTheta+betaMTheta)/(betaR+betaM))*(1.0-Fex),vec3(1.5));
Lin*=mix(vec3(1.0),pow(sunE*((betaRTheta+betaMTheta)/(betaR+betaM))*Fex,vec3(1.0/2.0)),clamp(pow(1.0-dot(up,sunDirection),5.0),0.0,1.0));
vec3 direction=normalize(vPositionW-cameraPosition);
float theta=acos(direction.y);
float phi=atan(direction.z,direction.x);
vec2 uv=vec2(phi,theta)/vec2(2.0*pi,pi)+vec2(0.5,0.0);
vec3 L0=vec3(0.1)*Fex;
float sundisk=smoothstep(sunAngularDiameterCos,sunAngularDiameterCos+0.00002,cosTheta);
L0+=(sunE*19000.0*Fex)*sundisk;
vec3 whiteScale=1.0/Uncharted2Tonemap(vec3(W));
vec3 texColor=(Lin+L0);
texColor*=0.04;
texColor+=vec3(0.0,0.001,0.0025)*0.3;
float g_fMaxLuminance=1.0;
float fLumScaled=0.1/luminance;
float fLumCompressed=(fLumScaled*(1.0+(fLumScaled/(g_fMaxLuminance*g_fMaxLuminance))))/(1.0+fLumScaled);
float ExposureBias=fLumCompressed;
vec3 curr=Uncharted2Tonemap((log2(2.0/pow(luminance,4.0)))*texColor);
vec3 retColor=curr*whiteScale;
/**
*--------------------------------------------------------------------------------------------------
* Sky Color
*--------------------------------------------------------------------------------------------------
*/
float alpha=1.0;
vec4 color=clamp(vec4(retColor.rgb,alpha),0.0,1.0);
glFragColor=color;
glFragColor.rgb=pow(glFragColor.rgb,vec3(2.2));
#define CUSTOM_FRAGMENT_MAIN_END
}