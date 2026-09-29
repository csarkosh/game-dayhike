vec2 getAARoughnessFactors(vec3 normalVector) {
vec3 nDfdx=dFdx(normalVector.xyz);
vec3 nDfdy=(-yFactor_)*dFdy(normalVector.xyz);
float slopeSquare=max(dot(nDfdx,nDfdx),dot(nDfdy,nDfdy));
float geometricRoughnessFactor=pow(saturate(slopeSquare),0.333);
float geometricAlphaGFactor=sqrt(slopeSquare);
geometricAlphaGFactor*=0.75;
return vec2(geometricRoughnessFactor,geometricAlphaGFactor);
}