vec3 hemisphereImportanceSampleDggxAnisotropic(vec2 Xi,float alphaTangent,float alphaBitangent)
{alphaTangent=max(alphaTangent,0.0001);
alphaBitangent=max(alphaBitangent,0.0001);
float phi=atan(alphaBitangent/alphaTangent*tan(2.0*3.14159265*Xi.x));
if (Xi.x>0.5) phi+=3.14159265;
float cosPhi=cos(phi);
float sinPhi=sin(phi);
float alpha2=(cosPhi*cosPhi)/(alphaTangent*alphaTangent) +
(sinPhi*sinPhi)/(alphaBitangent*alphaBitangent);
float tanTheta2=Xi.y/(1.0-Xi.y)/alpha2;
float cosTheta=1.0/sqrt(1.0+tanTheta2);
float sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
return vec3(sinTheta*cosPhi,sinTheta*sinPhi,cosTheta);
}